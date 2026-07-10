import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ---- Gemini model fallback chain: newest first, proven stable as backup ----
const MODEL_CHAIN = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-2.5-flash"].filter(
  Boolean
);
let activeModel = null;

const SHAPE = `{"area":"<neighbourhood, city>","areaLat":0,"areaLng":0,"happyHours":[{"name":"","detail":"","when":"","price":"","lat":0,"lng":0}],"foodDeals":[{"name":"","detail":"","when":"","price":"","lat":0,"lng":0}],"deals":[{"name":"","detail":"","price":"","source":"","url":"","lat":0,"lng":0}],"landmarks":[{"name":"","detail":"","price":"","lat":0,"lng":0}],"photoSpots":[{"name":"","detail":"","lat":0,"lng":0}],"familyPicks":[{"name":"","detail":"","price":"","lat":0,"lng":0}]}`;

const JSON_RULES = `Strings must escape any internal double quotes so the JSON parses cleanly.`;

// ---- Gemini call: Google Search grounding on, or strict JSON mode when off ----
async function callGemini(prompt, { useSearch = true } = {}) {
  const models = activeModel ? [activeModel] : MODEL_CHAIN;
  let lastErr;
  for (const model of models) {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4000,
        temperature: 0.4,
        ...(useSearch ? {} : { responseMimeType: "application/json" }),
      },
      ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
    };
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );
    const data = await upstream.json();
    if (upstream.ok) {
      activeModel = model;
      const parts =
        (data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts) ||
        [];
      return parts.map((p) => p.text || "").join("\n");
    }
    const msg = (data && data.error && data.error.message) || `HTTP ${upstream.status}`;
    lastErr = new Error(msg);
    // Fall through the chain when the model is missing OR has no quota on this tier
    const canFallThrough =
      upstream.status === 404 ||
      upstream.status === 429 ||
      /not found|not supported|quota|rate limit/i.test(msg);
    if (!canFallThrough) throw lastErr;
  }
  throw lastErr || new Error("Gemini call failed.");
}

// ---- Tolerant JSON extraction: brace-matching + light repair ----
const tryParse = (s) => {
  try {
    return JSON.parse(s);
  } catch (e) {
    return undefined;
  }
};

function extractJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  let inStr = false;
  let esc = false;
  let end = -1;
  const stack = [];

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === "{" || c === "[") {
      stack.push(c);
    } else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) {
        end = i;
        break;
      }
    }
  }

  let candidate = end !== -1 ? text.slice(start, end + 1) : text.slice(start);
  let parsed = tryParse(candidate.replace(/,\s*([}\]])/g, "$1"));
  if (parsed !== undefined) return parsed;

  // Truncated reply: progressively chop back to a clean boundary and re-close
  let base = end !== -1 ? candidate : text.slice(start);
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = tryParse(closeAll(base));
    if (p !== undefined) return p;
    const p2 = tryParse(closeAll(base.replace(/:\s*[A-Za-z0-9+\-.Ee]*$/, ":null")));
    if (p2 !== undefined) return p2;
    const cut = Math.max(base.lastIndexOf(","), base.lastIndexOf("{"), base.lastIndexOf("["));
    if (cut <= 0) break;
    base = base[cut] === "," ? base.slice(0, cut) : base.slice(0, cut + 1);
  }
  return undefined;
}

// Close an arbitrary JSON prefix into something parseable
function closeAll(s) {
  let inStr = false;
  let esc = false;
  const stack = [];
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  out = out.replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/, ""); // dangling key after a comma
  out = out.replace(/{\s*"(?:[^"\\]|\\.)*"\s*$/, "{"); // dangling key right after an opener
  out = out.replace(/[,\s]+$/, "");
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out.replace(/,\s*([}\]])/g, "$1");
}

async function askModel(prompt) {
  const text = await callGemini(prompt, { useSearch: true });
  let parsed = extractJson(text);
  if (parsed !== undefined) return parsed;

  // Rescue pass: no search, strict JSON mode, just fix the output
  const fixed = await callGemini(
    `Convert the following into strictly valid JSON — same content and structure, nothing added, no commentary, no markdown fences. Output only the JSON:\n\n${text.slice(0, 12000)}`,
    { useSearch: false }
  );
  parsed = extractJson(fixed);
  if (parsed !== undefined) return parsed;

  throw new Error("The guide's reply came back garbled — tap Try again.");
}

// ---- API ----
app.post("/api/tips", async (req, res) => {
  const { locationLine, localTime, interests } = req.body || {};
  if (!locationLine || typeof locationLine !== "string" || locationLine.length > 300) {
    return res.status(400).json({ error: "Invalid location." });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Server is missing its GEMINI_API_KEY — add it in Railway → Variables.",
    });
  }
  const fam =
    typeof interests === "string" && interests.trim()
      ? interests.trim().slice(0, 200)
      : "a travelling family with teenagers";
  const now = localTime || new Date().toString();

  const findPrompt = `You are a sharp hyper-local city guide. ${locationLine} The user's local device time is ${now}.

Step 1: identify the neighbourhood and city for that location.
Step 2: use Google Search to find, within roughly a 15-minute walk of it:
- happyHours: bars or restaurants with happy hour deals active now or starting soon today (include times)
- foodDeals: current food specials, set lunches, or promotions
- landmarks: famous landmarks or attractions
- photoSpots: instagrammable viewpoints, streets, or spots
- familyPicks: nearby things well-suited to this travelling family: ${fam}

Leave "deals" as an empty array — it is filled elsewhere.
Include each place's approximate "lat" and "lng" in decimal degrees, from search results or your knowledge; use 0 if genuinely unknown. Set "areaLat"/"areaLng" to the coordinates of the identified area.
Include "price" for any item where search results show a current price — local currency, short (e.g. "S$8 pints", "\u0e3f120", "free entry"). Use "" if no price was seen.

Respond with ONLY valid JSON — no markdown fences, no preamble. Exactly this shape:
${SHAPE}

At most 3 items per category, "detail" max 12 words, empty arrays where nothing solid is found. ${JSON_RULES} Only include places genuinely close to that location, drawn from your search results — never invented.`;

  const dealsPrompt = `You are a deal hunter. ${locationLine} The user's local device time is ${now}.

Use Google Search to find CURRENT deals near this location on dining, drinking, and local attractions from deal and voucher platforms. Check whichever platforms actually operate in this market — e.g. Groupon, Fave, Klook, KKday, Eatigo, Chope, Pelago, ShopBack — plus any prominent local deal sites your searches surface.

Respond with ONLY valid JSON — no markdown fences, no preamble:
{"deals":[{"name":"","detail":"","price":"","source":"","url":"","lat":0,"lng":0}]}

Max 4 deals. "detail" max 12 words. "price" short (e.g. "\u0e3f299 for two", "40% off"). "source" is the platform name. "url" must be copied verbatim from a search result, or "" if unsure. Include each venue's approximate "lat"/"lng" in decimal degrees, or 0 if unknown. ${JSON_RULES} Only genuine current deals for places near the location, drawn from search results — never invented. Empty array if none found.`;

  try {
    const [findR, dealsR] = await Promise.allSettled([
      askModel(findPrompt),
      askModel(dealsPrompt),
    ]);
    if (findR.status !== "fulfilled") throw findR.reason;
    const draft = findR.value;
    draft.deals =
      dealsR.status === "fulfilled" && Array.isArray(dealsR.value.deals)
        ? dealsR.value.deals.slice(0, 4)
        : [];

    draft.meta = { verified: false, pending: true, model: activeModel };
    return res.json(draft);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Tips lookup failed. Try again." });
  }
});

// ---- Background verification: takes a draft, returns the corrected version ----
app.post("/api/verify", async (req, res) => {
  const { draft, localTime } = req.body || {};
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || !draft.area) {
    return res.status(400).json({ error: "Invalid draft." });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "Server is missing its GEMINI_API_KEY \u2014 add it in Railway \u2192 Variables.",
    });
  }
  const now = localTime || new Date().toString();
  try {
    const clean = { ...draft };
    delete clean.meta;
    const checkPrompt = `You are a fact-checker for a travel app. Today is ${now}. Verify this list of places, offers, and deals near ${clean.area || "the user's location"} using targeted Google searches:

${JSON.stringify(clean)}

Rules:
- For happyHours, foodDeals, and deals: confirm the offer, times, and prices are current; correct anything wrong, and REMOVE any offer you cannot reasonably confirm from search results.
- For landmarks, photoSpots, and familyPicks: the bar is existence \u2014 keep the item if the place exists and is roughly as described; only remove it if it appears closed, wrong, or not near the area. Never remove these just because there is no offer to confirm.
- Keep "url", "source", "lat", "lng", "areaLat", and "areaLng" fields as given, correcting coordinates only if clearly wrong.
- Do not add new items. Keep "detail" max 12 words. ${JSON_RULES}
Respond with ONLY the corrected JSON in exactly the same shape \u2014 no commentary.`;
    const verified = await askModel(checkPrompt);
    if (verified && verified.area) {
      verified.meta = { verified: true, model: activeModel };
      return res.json(verified);
    }
    throw new Error("bad verify shape");
  } catch (e) {
    const out = { ...draft, meta: { verified: false, model: activeModel } };
    return res.json(out);
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`pocket-fx listening on :${port}`));

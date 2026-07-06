import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const MODEL = "claude-sonnet-4-6";

const SHAPE = `{"area":"<neighbourhood, city>","happyHours":[{"name":"","detail":"","when":"","price":""}],"foodDeals":[{"name":"","detail":"","when":"","price":""}],"deals":[{"name":"","detail":"","price":"","source":"","url":""}],"landmarks":[{"name":"","detail":"","price":""}],"photoSpots":[{"name":"","detail":""}],"familyPicks":[{"name":"","detail":"","price":""}]}`;

const JSON_RULES = `Strings must escape any internal double quotes so the JSON parses cleanly.`;

// ---- Anthropic call helpers ----
async function callModel(body) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  if (!upstream.ok) {
    throw new Error((data && data.error && data.error.message) || "Upstream API error.");
  }
  return data;
}

const joinText = (data) =>
  (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

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

async function askClaude(prompt) {
  const data = await callModel({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
  });
  const text = joinText(data);
  let parsed = extractJson(text);
  if (parsed !== undefined) return parsed;

  // Rescue pass: no search tools, just fix the JSON
  const fixData = await callModel({
    model: MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: `Convert the following into strictly valid JSON — same content and structure, nothing added, no commentary, no markdown fences. Output only the JSON:\n\n${text.slice(0, 12000)}`,
      },
    ],
  });
  parsed = extractJson(joinText(fixData));
  if (parsed !== undefined) return parsed;

  throw new Error("The guide's reply came back garbled — tap Try again.");
}

// ---- API ----
app.post("/api/tips", async (req, res) => {
  const { locationLine, localTime, interests } = req.body || {};
  if (!locationLine || typeof locationLine !== "string" || locationLine.length > 300) {
    return res.status(400).json({ error: "Invalid location." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server is missing its ANTHROPIC_API_KEY — add it in Railway → Variables.",
    });
  }
  const fam =
    typeof interests === "string" && interests.trim()
      ? interests.trim().slice(0, 200)
      : "a travelling family with teenagers";
  const now = localTime || new Date().toString();

  const findPrompt = `You are a sharp hyper-local city guide. ${locationLine} The user's local device time is ${now}.

Step 1: identify the neighbourhood and city for that location.
Step 2: use web search to find, within roughly a 15-minute walk of it:
- happyHours: bars or restaurants with happy hour deals active now or starting soon today (include times)
- foodDeals: current food specials, set lunches, or promotions
- landmarks: famous landmarks or attractions
- photoSpots: instagrammable viewpoints, streets, or spots
- familyPicks: nearby things well-suited to this travelling family: ${fam}

Leave "deals" as an empty array — it is filled elsewhere.
Include "price" for any item where search results show a current price — local currency, short (e.g. "S$8 pints", "S$5.80", "free entry"). Use "" if no price was seen.

Respond with ONLY valid JSON — no markdown fences, no preamble. Exactly this shape:
${SHAPE}

At most 3 items per category, "detail" max 12 words, empty arrays where nothing solid is found. ${JSON_RULES} Only include places genuinely close to that location, drawn from your search results — never invented.`;

  const dealsPrompt = `You are a deal hunter. ${locationLine} The user's local device time is ${now}.

Use web search to find CURRENT deals near this location on dining, drinking, and local attractions from deal and voucher platforms. Check whichever platforms actually operate in this market — e.g. Groupon, Fave, Klook, KKday, Eatigo, Chope, Pelago, ShopBack — plus any prominent local deal sites your searches surface.

Respond with ONLY valid JSON — no markdown fences, no preamble:
{"deals":[{"name":"","detail":"","price":"","source":"","url":""}]}

Max 4 deals. "detail" max 12 words. "price" short (e.g. "S$29 for two", "40% off"). "source" is the platform name. "url" must be copied verbatim from a search result, or "" if unsure. ${JSON_RULES} Only genuine current deals for places near the location, drawn from search results — never invented. Empty array if none found.`;

  try {
    const [findR, dealsR] = await Promise.allSettled([
      askClaude(findPrompt),
      askClaude(dealsPrompt),
    ]);
    if (findR.status !== "fulfilled") throw findR.reason;
    const draft = findR.value;
    draft.deals =
      dealsR.status === "fulfilled" && Array.isArray(dealsR.value.deals)
        ? dealsR.value.deals.slice(0, 4)
        : [];

    // Best-effort verification pass — falls back to the draft if anything goes wrong
    try {
      const checkPrompt = `You are a fact-checker for a travel app. Today is ${now}. Verify this list of places, offers, and deals near ${draft.area || "the user's location"} using targeted web searches:

${JSON.stringify(draft)}

Rules:
- Confirm each place exists and is currently operating, and that offers, times, deals, and prices are current. Correct anything wrong.
- REMOVE any item you cannot reasonably confirm from search results.
- Keep "url" and "source" fields exactly as given unless the item is removed.
- Do not add new items. Keep "detail" max 12 words. ${JSON_RULES}
Respond with ONLY the corrected JSON in exactly the same shape — no commentary.`;
      const verified = await askClaude(checkPrompt);
      if (verified && verified.area) return res.json(verified);
      return res.json(draft);
    } catch (e) {
      return res.json(draft);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || "Tips lookup failed. Try again." });
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`pocket-fx listening on :${port}`));

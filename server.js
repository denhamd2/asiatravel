import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// ---- Local Tips: keeps the Anthropic API key on the server, never in the browser ----
app.post("/api/tips", async (req, res) => {
  const { locationLine, localTime } = req.body || {};
  if (!locationLine || typeof locationLine !== "string" || locationLine.length > 300) {
    return res.status(400).json({ error: "Invalid location." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server is missing its ANTHROPIC_API_KEY — add it in Railway → Variables.",
    });
  }

  const prompt = `You are a sharp hyper-local city guide. ${locationLine} The user's local device time is ${localTime || new Date().toString()}.

Step 1: identify the neighbourhood and city for that location.
Step 2: use web search to find, within roughly a 15-minute walk of it:
- happyHours: bars or restaurants with happy hour deals active now or starting soon today (include times)
- foodDeals: current food specials, set lunches, or promotions
- landmarks: famous landmarks or attractions
- photoSpots: instagrammable viewpoints, streets, or spots

Respond with ONLY valid JSON — no markdown fences, no preamble, no commentary. Exactly this shape:
{"area":"<neighbourhood, city>","happyHours":[{"name":"","detail":"","when":""}],"foodDeals":[{"name":"","detail":"","when":""}],"landmarks":[{"name":"","detail":""}],"photoSpots":[{"name":"","detail":""}]}

At most 3 items per category, "detail" max 12 words, use an empty array if nothing solid is found. Only include places genuinely close to that location.`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return res
        .status(502)
        .json({ error: (data && data.error && data.error.message) || "Upstream API error." });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return res.status(502).json({ error: "Model reply contained no JSON." });
    }
    return res.json(JSON.parse(text.slice(start, end + 1)));
  } catch (err) {
    return res.status(500).json({ error: "Tips lookup failed. Try again." });
  }
});

// ---- Static app ----
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`pocket-fx listening on :${port}`));

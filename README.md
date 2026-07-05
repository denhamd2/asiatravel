# Pocket FX — SGD ⇄ EUR

A mobile-first currency converter for the Southeast Asia trip. Type SGD, see EUR instantly. Tap banknotes to count cash in your hand. A "Local tips" button uses your GPS (or a typed place) and asks Claude to search the live web for nearby happy hours, food deals, landmarks, and photo spots.

## How it's put together

- **Frontend**: React (Vite) — everything in `src/App.jsx`
- **Server**: `server.js` — a small Express app that serves the built site and handles `/api/tips`, which calls the Anthropic API using a key that stays on the server (never in the browser)

## Deploy on Railway

1. In Railway: **New Project → Deploy from GitHub repo** → pick this repo
2. Once created, open the service → **Variables** → add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com (Settings → API Keys)
3. **Settings → Networking → Generate Domain** to get your public URL
4. Open that URL on your phone → Chrome menu → **Add to Home screen**

Railway auto-detects Node, runs `npm install`, `npm run build`, then `npm start`. No other config needed.

> The converter works without the API key — only the Local Tips button needs it.

## Run locally (optional)

```bash
npm install
npm run build
ANTHROPIC_API_KEY=sk-... npm start
# open http://localhost:3000
```

## Updating the exchange rate

The default rate (1 SGD = 0.678 EUR, mid-market 5 Jul 2026) is set in `src/App.jsx` (`DEFAULT_RATE`). You can also just tap the rate in the app to override it — it's saved on your device.

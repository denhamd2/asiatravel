import { useState, useEffect, useRef } from "react";

// ---- Rate (mid-market, editable in-app) ----
const DEFAULT_RATE = 0.678; // 1 SGD in EUR
const STORE_KEY = "pocket-fx-sgd-eur";
const DEFAULT_INTERESTS =
  "football, street food and markets, things a 17-year-old and a 10-year-old will enjoy";

// ---- Design tokens ----
const PAPER = "#EFF1EA";
const INK = "#1B241F";
const SGD_RED = "#CE2B37";
const EUR_BLUE = "#003399";
const MUTED = "#6B746D";

const SGD_NOTES = [
  { value: 2, color: "#8A63B8" },
  { value: 5, color: "#3B8A5F" },
  { value: 10, color: "#CE3A34" },
  { value: 50, color: "#3E6FB4" },
  { value: 100, color: "#D9822B" },
];
const EUR_NOTES = [
  { value: 5, color: "#8E979E" },
  { value: 10, color: "#C94F44" },
  { value: 20, color: "#3F6FBF" },
  { value: 50, color: "#E08A2E" },
  { value: 100, color: "#3E9B6E" },
];

const TIP_SECTIONS = [
  { key: "happyHours", label: "Happy hours", color: "#D9822B" },
  { key: "foodDeals", label: "Food deals", color: "#3B8A5F" },
  { key: "deals", label: "Deals", color: "#B23A6B" },
  { key: "landmarks", label: "Landmarks", color: "#3E6FB4" },
  { key: "photoSpots", label: "Photo spots", color: "#8A63B8" },
  { key: "familyPicks", label: "For the family", color: "#2E7D74" },
];

const LOADING_MSGS = [
  "Pinning your location…",
  "Scouting the neighbourhood…",
  "Checking today’s happy hours…",
  "Hunting down food deals…",
  "Finding the photo spots…",
  "Double-checking everything…",
];

const toNumber = (s) => {
  const n = parseFloat(String(s).replace(/,/g, ""));
  return isFinite(n) && n >= 0 ? n : 0;
};
const fmt = (n) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const loadStored = () => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      rate: typeof s.rate === "number" && s.rate > 0 ? s.rate : DEFAULT_RATE,
      direction: s.direction === "EUR_SGD" ? "EUR_SGD" : "SGD_EUR",
      interests: typeof s.interests === "string" && s.interests ? s.interests : DEFAULT_INTERESTS,
    };
  } catch (e) {
    return { rate: DEFAULT_RATE, direction: "SGD_EUR", interests: DEFAULT_INTERESTS };
  }
};

const Rosette = ({ size, style }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={style}>
    {Array.from({ length: 14 }).map((_, i) => (
      <ellipse
        key={i}
        cx="100"
        cy="100"
        rx="96"
        ry="32"
        fill="none"
        stroke={INK}
        strokeWidth="0.6"
        transform={`rotate(${i * (180 / 14)} 100 100)`}
      />
    ))}
  </svg>
);

const Pin = ({ color = PAPER, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"
      fill={color}
    />
    <circle cx="12" cy="9" r="2.6" fill={INK} />
  </svg>
);

export default function App() {
  const initial = useRef(loadStored()).current;
  const [direction, setDirection] = useState(initial.direction);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(initial.rate);
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState("");
  const inputRef = useRef(null);

  // ---- Local tips state ----
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tipsPhase, setTipsPhase] = useState("idle"); // idle | locating | searching | done | geoError | apiError
  const [tips, setTips] = useState(null);
  const [tipsError, setTipsError] = useState("");
  const [msgIdx, setMsgIdx] = useState(0);
  const [manualPlace, setManualPlace] = useState("");
  const [interests, setInterests] = useState(initial.interests);
  const [editingFam, setEditingFam] = useState(false);
  const [famDraft, setFamDraft] = useState("");
  const lastRequest = useRef({ type: "gps" });

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ rate, direction, interests }));
    } catch (e) {
      /* private mode etc — in-memory only */
    }
  }, [rate, direction, interests]);

  useEffect(() => {
    if (tipsPhase !== "locating" && tipsPhase !== "searching") return;
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MSGS.length), 2600);
    return () => clearInterval(id);
  }, [tipsPhase]);

  const isSgdFirst = direction === "SGD_EUR";
  const amt = toNumber(amount);
  const result = isSgdFirst ? amt * rate : rate > 0 ? amt / rate : 0;

  const fromName = isSgdFirst ? "Singapore dollars" : "Euros";
  const toName = isSgdFirst ? "Euros" : "Singapore dollars";
  const fromSym = isSgdFirst ? "S$" : "€";
  const toSym = isSgdFirst ? "€" : "S$";
  const fromColor = isSgdFirst ? SGD_RED : EUR_BLUE;
  const toColor = isSgdFirst ? EUR_BLUE : SGD_RED;
  const notes = isSgdFirst ? SGD_NOTES : EUR_NOTES;
  const noteSym = isSgdFirst ? "$" : "€";
  const isCustomRate = Math.abs(rate - DEFAULT_RATE) > 1e-9;

  const handleAmount = (raw) => {
    let clean = raw.replace(/[^\d.]/g, "");
    const firstDot = clean.indexOf(".");
    if (firstDot !== -1)
      clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, "");
    setAmount(clean.slice(0, 12));
  };

  const addNote = (v) => {
    const next = Math.round((amt + v) * 100) / 100;
    setAmount(String(next));
  };

  const swap = () => {
    const carried = result > 0 ? String(Math.round(result * 100) / 100) : amount;
    setDirection(isSgdFirst ? "EUR_SGD" : "SGD_EUR");
    setAmount(carried);
    if (inputRef.current) inputRef.current.focus();
  };

  const openRate = () => {
    setRateDraft(String(rate));
    setEditingRate(true);
  };
  const saveRate = () => {
    const r = parseFloat(rateDraft);
    if (isFinite(r) && r > 0) setRate(r);
    setEditingRate(false);
  };

  // ---- Local tips flow ----
  const runSearch = async (locationLine) => {
    setTipsPhase("searching");
    try {
      const r = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationLine, localTime: new Date().toString(), interests }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data && data.error) || "Request failed");
      setTips(data);
      setTipsPhase("done");
    } catch (e) {
      setTipsError(e.message || "Couldn’t fetch tips. Try again in a moment.");
      setTipsPhase("apiError");
    }
  };

  const fetchTipsGps = () => {
    lastRequest.current = { type: "gps" };
    setTips(null);
    setTipsError("");
    setMsgIdx(0);
    setTipsPhase("locating");

    if (!navigator.geolocation) {
      setTipsPhase("geoError");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        runSearch(
          `I am standing at latitude ${latitude}, longitude ${longitude} (GPS accuracy ~${Math.round(accuracy)}m).`
        );
      },
      () => {
        setTipsPhase("geoError");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const fetchTipsManual = () => {
    const place = manualPlace.trim();
    if (!place) return;
    lastRequest.current = { type: "place", place };
    setTips(null);
    setTipsError("");
    setMsgIdx(0);
    runSearch(`I am near: ${place}.`);
  };

  const retryLast = () => {
    if (lastRequest.current.type === "place") {
      setManualPlace(lastRequest.current.place);
      setTips(null);
      setTipsError("");
      runSearch(`I am near: ${lastRequest.current.place}.`);
    } else {
      fetchTipsGps();
    }
  };

  const openTips = () => {
    setTipsOpen(true);
    if (!tips && tipsPhase !== "locating" && tipsPhase !== "searching") fetchTipsGps();
  };

  const mapsHref = (name) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      name + (tips && tips.area ? ", " + tips.area : "")
    )}`;

  const dealHref = (it) =>
    it.url && /^https:\/\//.test(it.url)
      ? it.url
      : `https://www.google.com/search?q=${encodeURIComponent((it.name || "") + " " + (it.source || "deal"))}`;

  const resultText = amt > 0 ? `${toSym}${fmt(result)}` : `${toSym}0.00`;
  const busy = tipsPhase === "locating" || tipsPhase === "searching";

  const manualInputBlock = (
    <div style={{ marginTop: 12 }}>
      <label htmlFor="place" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.11em", textTransform: "uppercase", color: MUTED }}>
        Where are you?
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          id="place"
          value={manualPlace}
          onChange={(e) => setManualPlace(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchTipsManual()}
          placeholder="e.g. Clarke Quay, Singapore"
          style={{ flex: 1, minWidth: 0, border: `1.5px solid ${INK}`, borderRadius: 8, padding: "10px 12px", fontSize: 15, background: "#FDFDFB", color: INK }}
        />
        <button
          onClick={fetchTipsManual}
          disabled={!manualPlace.trim()}
          style={{ padding: "10px 16px", background: manualPlace.trim() ? INK : MUTED, color: PAPER, borderRadius: 8, fontWeight: 700, fontSize: 14, flexShrink: 0 }}
        >
          Search
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK, fontFamily: "'Bricolage Grotesque', system-ui, sans-serif", display: "flex", justifyContent: "center", padding: "0 16px", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; background: ${PAPER}; }
        input { font-family: inherit; }
        input:focus, button:focus { outline: none; }
        input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid ${INK}; outline-offset: 3px; border-radius: 4px; }
        button { cursor: pointer; border: none; background: none; padding: 0; color: inherit; font-family: inherit; }
        button:disabled { cursor: default; }
        .note-btn:active { transform: translateY(1px) scale(0.97); }
        @media (prefers-reduced-motion: no-preference) {
          .tick { animation: tick 220ms ease-out; }
          @keyframes tick { from { opacity: 0.4; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
          .note-btn { transition: transform 120ms ease; }
          .sheet { animation: sheetUp 260ms cubic-bezier(.2,.8,.3,1); }
          @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          .pulse { animation: pulse 1.4s ease-in-out infinite; }
          @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        }
        input::placeholder { color: ${INK}; opacity: 0.28; }
      `}</style>

      <Rosette size={300} style={{ position: "absolute", top: -120, right: -120, opacity: 0.06, pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 420, padding: "12px 0 24px", position: "relative" }}>
        {/* Compact header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em" }}>
            <span style={{ color: fromColor }}>{isSgdFirst ? "SGD" : "EUR"}</span>
            <span style={{ color: MUTED, fontWeight: 500 }}> → </span>
            <span style={{ color: toColor }}>{isSgdFirst ? "EUR" : "SGD"}</span>
          </h1>
          <button
            onClick={swap}
            aria-label="Swap conversion direction"
            style={{ width: 38, height: 38, borderRadius: 999, border: `1.5px solid ${INK}`, background: "#FDFDFB", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            ⇅
          </button>
        </div>

        {/* Rate line */}
        <div style={{ marginTop: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {editingRate ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              1 SGD =
              <input
                autoFocus
                inputMode="decimal"
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value.replace(/[^\d.]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && saveRate()}
                style={{ width: 72, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, border: `1.5px solid ${INK}`, borderRadius: 4, padding: "2px 5px", background: "#fff", color: INK }}
                aria-label="Rate: 1 SGD in EUR"
              />
              EUR
              <button onClick={saveRate} style={{ fontWeight: 500, color: INK, textDecoration: "underline" }}>Save</button>
              <button onClick={() => setEditingRate(false)}>Cancel</button>
            </span>
          ) : (
            <span>
              <button onClick={openRate} style={{ fontFamily: "inherit", fontSize: "inherit", color: INK, borderBottom: `1px dotted ${MUTED}` }} aria-label="Edit exchange rate">
                1 SGD = {rate} EUR ✎
              </button>
              {isCustomRate ? (
                <>
                  {" "}· custom{" "}
                  <button onClick={() => setRate(DEFAULT_RATE)} style={{ fontFamily: "inherit", fontSize: "inherit", color: MUTED, textDecoration: "underline" }}>
                    reset
                  </button>
                </>
              ) : (
                <span> · 5 Jul ’26</span>
              )}
            </span>
          )}
        </div>

        {/* Converter card */}
        <div style={{ marginTop: 12, background: "#FDFDFB", border: `1.5px solid ${INK}`, borderRadius: 12, padding: "14px 16px 16px", boxShadow: `3px 3px 0 ${INK}1A` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label htmlFor="amt" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.11em", textTransform: "uppercase", color: fromColor, fontWeight: 500 }}>
              {fromName}
            </label>
            {amt > 0 && (
              <button onClick={() => setAmount("")} aria-label="Clear amount" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, border: `1px solid ${MUTED}`, borderRadius: 999, padding: "2px 9px" }}>
                clear
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, borderBottom: `2.5px solid ${fromColor}`, paddingBottom: 4, marginTop: 2 }}>
            <span style={{ fontSize: 19, fontWeight: 700, color: fromColor }}>{fromSym}</span>
            <input
              id="amt"
              ref={inputRef}
              inputMode="decimal"
              value={amount}
              onChange={(e) => handleAmount(e.target.value)}
              placeholder="0"
              style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: 34, fontWeight: 800, color: INK, letterSpacing: "-0.01em", padding: 0 }}
              aria-label={`Amount in ${fromName}`}
            />
          </div>

          <div style={{ marginTop: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.11em", textTransform: "uppercase", color: toColor, fontWeight: 500 }}>
            {toName}
          </div>
          <div
            key={resultText}
            className="tick"
            style={{ marginTop: 2, fontSize: resultText.length > 10 ? 34 : 42, fontWeight: 800, color: toColor, letterSpacing: "-0.015em", lineHeight: 1.1, wordBreak: "break-all" }}
            aria-live="polite"
          >
            {resultText}
          </div>
        </div>

        {/* Note counter */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.11em", textTransform: "uppercase", color: MUTED }}>
            Tap notes to count them up
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {notes.map((n) => (
              <button
                key={n.value}
                className="note-btn"
                onClick={() => addNote(n.value)}
                aria-label={`Add ${noteSym}${n.value}`}
                style={{ width: 62, height: 34, borderRadius: 5, background: n.color, color: "#fff", position: "relative", fontWeight: 700, fontSize: 14.5, boxShadow: "0 1.5px 0 rgba(0,0,0,0.22)" }}
              >
                <span style={{ position: "absolute", inset: 3, border: "1px solid rgba(255,255,255,0.45)", borderRadius: 3, pointerEvents: "none" }} />
                {noteSym}{n.value}
              </button>
            ))}
          </div>
        </div>

        {/* Local tips button */}
        <button
          onClick={openTips}
          style={{ marginTop: 20, width: "100%", padding: "13px 16px", background: INK, color: PAPER, border: `1.5px solid ${INK}`, borderRadius: 10, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: `3px 3px 0 ${INK}33` }}
        >
          <Pin color={SGD_RED} size={16} />
          Local tips near me
        </button>

        <p style={{ marginTop: 14, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: MUTED, lineHeight: 1.6 }}>
          v7 · Mid-market rate — cards and ATMs add a margin. Tap the rate to update it.
        </p>
      </div>

      {/* ---- Local tips modal ---- */}
      {tipsOpen && (
        <div role="dialog" aria-modal="true" aria-label="Local tips" style={{ position: "fixed", inset: 0, zIndex: 50 }}>
          <div onClick={() => setTipsOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(27,36,31,0.55)" }} />
          <div
            className="sheet"
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%", background: PAPER, borderTop: `1.5px solid ${INK}`, borderRadius: "16px 16px 0 0", padding: "16px 18px 24px", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 800, display: "flex", alignItems: "center", gap: 7 }}>
                  <Pin color={SGD_RED} size={15} /> Local tips
                </div>
                {tips && tips.area && (
                  <div style={{ marginTop: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {tips.area}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {!busy && (
                  <button
                    onClick={retryLast}
                    aria-label="Refresh tips"
                    style={{ width: 36, height: 36, borderRadius: 999, border: `1.5px solid ${INK}`, background: "#FDFDFB", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    ↻
                  </button>
                )}
                <button
                  onClick={() => setTipsOpen(false)}
                  aria-label="Close local tips"
                  style={{ width: 36, height: 36, borderRadius: 999, border: `1.5px solid ${INK}`, background: "#FDFDFB", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  ✕
                </button>
              </div>
            </div>


            {/* Family interests — sent with every lookup */}
            <div style={{ marginTop: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
              {editingFam ? (
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    autoFocus
                    value={famDraft}
                    onChange={(e) => setFamDraft(e.target.value.slice(0, 200))}
                    style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, border: `1.5px solid ${INK}`, borderRadius: 4, padding: "4px 6px", background: "#fff", color: INK }}
                    aria-label="Family interests"
                  />
                  <button
                    onClick={() => {
                      if (famDraft.trim()) setInterests(famDraft.trim());
                      setEditingFam(false);
                    }}
                    style={{ fontFamily: "inherit", fontSize: "inherit", fontWeight: 500, color: INK, textDecoration: "underline", flexShrink: 0 }}
                  >
                    Save
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setFamDraft(interests);
                    setEditingFam(true);
                  }}
                  style={{ textAlign: "left", fontFamily: "inherit", fontSize: "inherit", color: MUTED, lineHeight: 1.5 }}
                  aria-label="Edit family interests"
                >
                  <span style={{ color: "#2E7D74", fontWeight: 500 }}>FAMILY:</span> {interests} ✎
                </button>
              )}
            </div>

            {busy && (
              <div style={{ padding: "42px 0 34px", textAlign: "center" }}>
                <div className="pulse" style={{ display: "inline-flex", marginBottom: 12 }}>
                  <Pin color={SGD_RED} size={26} />
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: MUTED }}>
                  {tipsPhase === "locating" ? LOADING_MSGS[0] : LOADING_MSGS[msgIdx]}
                </div>
                <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: MUTED, opacity: 0.7 }}>
                  Searching + verifying on the live web — ~30–60s
                </div>
              </div>
            )}

            {tipsPhase === "geoError" && (
              <div style={{ marginTop: 16 }}>
                <div style={{ background: "#FDFDFB", border: `1.5px solid ${INK}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>GPS isn’t available</div>
                  <p style={{ margin: "5px 0 0", fontSize: 13.5, lineHeight: 1.5, color: MUTED }}>
                    Location was blocked or unavailable — no problem, just type where you are (or where you’re headed).
                  </p>
                  {manualInputBlock}
                  <button
                    onClick={fetchTipsGps}
                    style={{ marginTop: 12, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: MUTED, textDecoration: "underline" }}
                  >
                    retry GPS instead
                  </button>
                </div>
              </div>
            )}

            {tipsPhase === "apiError" && (
              <div style={{ marginTop: 16, background: "#FDFDFB", border: `1.5px solid ${SGD_RED}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 700, color: SGD_RED, fontSize: 14 }}>Couldn’t load tips</div>
                <p style={{ margin: "6px 0 12px", fontSize: 13.5, lineHeight: 1.5 }}>{tipsError}</p>
                <button
                  onClick={retryLast}
                  style={{ padding: "8px 16px", background: INK, color: PAPER, borderRadius: 8, fontWeight: 700, fontSize: 13.5 }}
                >
                  Try again
                </button>
              </div>
            )}

            {tipsPhase === "done" && tips && (
              <div style={{ marginTop: 6 }}>
                {TIP_SECTIONS.map((sec) => {
                  const items = Array.isArray(tips[sec.key]) ? tips[sec.key] : [];
                  return (
                    <div key={sec.key} style={{ marginTop: 18 }}>
                      <div style={{ display: "inline-block", background: sec.color, color: "#fff", borderRadius: 5, padding: "3px 10px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500, boxShadow: "0 1.5px 0 rgba(0,0,0,0.2)" }}>
                        {sec.label}
                      </div>
                      {items.length === 0 ? (
                        <p style={{ margin: "8px 0 0", fontSize: 13, color: MUTED }}>
                          Nothing solid found right nearby.
                        </p>
                      ) : (
                        items.map((it, i) => (
                          <div key={i} style={{ marginTop: 9, background: "#FDFDFB", border: `1.5px solid ${INK}`, borderRadius: 10, padding: "10px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{it.name}</div>
                              <a
                                href={sec.key === "deals" ? dealHref(it) : mapsHref(it.name)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: EUR_BLUE, textDecoration: "underline", flexShrink: 0 }}
                              >
                                {sec.key === "deals" ? "deal" : "map"} ↗
                              </a>
                            </div>
                            {it.detail && (
                              <div style={{ marginTop: 2, fontSize: 13, color: INK, lineHeight: 1.45 }}>{it.detail}</div>
                            )}
                            {it.when && (
                              <div style={{ marginTop: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: sec.color, fontWeight: 500 }}>
                                {it.when}
                              </div>
                            )}
                            {it.price && (
                              <div style={{ marginTop: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK, fontWeight: 500 }}>
                                {it.price}
                              </div>
                            )}
                            {it.source && (
                              <div style={{ marginTop: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: MUTED }}>
                                via {it.source}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}

                <div style={{ marginTop: 18, background: "#FDFDFB", border: `1.5px solid ${INK}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: "0.11em", textTransform: "uppercase", color: MUTED }}>
                    Somewhere else?
                  </div>
                  {manualInputBlock}
                </div>

                <p style={{ marginTop: 16, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: MUTED, lineHeight: 1.6 }}>
                  Web-sourced and auto-verified — but offers change fast, so glance before you order.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

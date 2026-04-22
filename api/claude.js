// Vercel Serverless Function — proxies Claude API calls.
//
// The browser cannot call api.anthropic.com directly (CORS + the x-api-key
// header must stay server-side). The frontend POSTs { mode, ...args } to this
// endpoint and we build the correct Claude request, attach the API key from
// environment, and forward.
//
// Environment variables required:
//   ANTHROPIC_API_KEY   — starts with sk-ant-...
//   ANTHROPIC_MODEL_TEXT    (optional) — defaults to claude-sonnet-4-5
//   ANTHROPIC_MODEL_PRELUDE (optional) — defaults to claude-haiku-4-5
//
// Modes the frontend uses:
//   "chapter" → reproduce a chapter of a public-domain work (long, needs quality → Sonnet)
//   "prelude" → write a 2–3 sentence scene-setter (short, speed matters → Haiku)

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Lock down CORS to same-origin in production. In local dev (no host header
// match) we fall back to * so `vite dev` on :5173 can still hit a deployed
// preview if needed.
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  // Same-origin: Vercel sets x-forwarded-host; browser-origin host matches.
  const allowSameOrigin = origin && host && origin.endsWith(host);
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowSameOrigin ? origin : (process.env.ALLOWED_ORIGIN || "*")
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY not configured" });
  }

  const textModel = process.env.ANTHROPIC_MODEL_TEXT || "claude-sonnet-4-5";
  const preludeModel = process.env.ANTHROPIC_MODEL_PRELUDE || "claude-haiku-4-5";

  let body = req.body;
  // Some Vercel configurations deliver the body as a raw string.
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { mode } = body || {};

  let payload;
  try {
    if (mode === "chapter") {
      const { title, author, label } = body;
      if (!title || !author || !label) {
        return res.status(400).json({ ok: false, error: "chapter mode requires title, author, label" });
      }
      payload = {
        model: textModel,
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: `Reproduce the full text of ${label} of "${title}" by ${author}. This is a public domain work. Output ONLY the chapter text, no commentary.`,
        }],
      };
    } else if (mode === "prelude") {
      const { title, chNum, snippet } = body;
      if (!title || !chNum || !snippet) {
        return res.status(400).json({ ok: false, error: "prelude mode requires title, chNum, snippet" });
      }
      // Hard-cap the snippet to prevent a malicious client from stuffing a
      // giant prompt through our key.
      const clipped = String(snippet).slice(0, 2000);
      payload = {
        model: preludeModel,
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Write a brief, evocative 2-3 sentence prelude for Chapter ${chNum} of "${title}". Set the scene and mood without spoilers. Based on this opening:\n\n${clipped}\n\nWrite ONLY the prelude, no labels or quotes.`,
        }],
      };
    } else {
      return res.status(400).json({ ok: false, error: "Invalid mode. Use 'chapter' or 'prelude'." });
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: "Bad request: " + e.message });
  }

  // 25s timeout — Vercel's default hobby function timeout is 10s, so users
  // should bump this in vercel.json if chapter fetches time out.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Claude API error:", r.status, data);
      return res.status(r.status).json({
        ok: false,
        error: data?.error?.message || `Claude API HTTP ${r.status}`,
      });
    }

    // Join all text blocks. Claude's v1/messages returns content as an array
    // of blocks; for these prompts we only expect text, but the join handles
    // multi-block output gracefully.
    const text = Array.isArray(data?.content)
      ? data.content.map((c) => c?.text || "").join("")
      : "";

    return res.status(200).json({ ok: true, text });
  } catch (err) {
    clearTimeout(timer);
    const msg = err?.name === "AbortError" ? "Claude request timed out" : err.message;
    console.error("Claude proxy error:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}

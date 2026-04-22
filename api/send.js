// Vercel Serverless Function — proxies email sends to Resend.
//
// Environment variables required:
//   RESEND_API_KEY   — starts with re_...
//   FROM_EMAIL       — e.g. "The Chapter <chapters@yourdomain.com>"
//                      For testing you can use "onboarding@resend.dev" but
//                      Resend will only deliver to the address that owns the
//                      Resend account until you verify a domain.
//   ALLOWED_ORIGIN   (optional) — if set, only this origin can call the API

const RESEND_URL = "https://api.resend.com/emails";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const allowSameOrigin = origin && host && origin.endsWith(host);
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowSameOrigin ? origin : (process.env.ALLOWED_ORIGIN || "*")
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

// Very light email syntax check — just enough to reject typos and obvious
// junk before we burn a Resend API call.
function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { to, subject, html, text, unsubscribeUrl } = body || {};

  if (!to || !subject) {
    return res.status(400).json({ ok: false, error: "Missing required fields: to, subject" });
  }

  const recipients = Array.isArray(to) ? to : [to];
  const clean = recipients.filter(isValidEmail);
  if (clean.length === 0) {
    return res.status(400).json({ ok: false, error: "No valid recipient email addresses" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "The Chapter <onboarding@resend.dev>";

  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "RESEND_API_KEY not configured" });
  }

  // Build the Resend payload. List-Unsubscribe headers are required by
  // Gmail/Yahoo's bulk-sender rules (Feb 2024). Without them mail is
  // increasingly likely to land in spam or be rejected outright.
  const payload = {
    from: fromEmail,
    to: clean,
    subject: String(subject).slice(0, 998), // RFC 5322 subject line limit
    html: html || "",
    text: text || "",
  };
  if (unsubscribeUrl && /^https?:\/\//.test(unsubscribeUrl)) {
    payload.headers = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return res.status(200).json({ ok: true, id: data.id });
    }
    console.error("Resend error:", response.status, data);
    return res.status(response.status).json({
      ok: false,
      error: data?.message || data?.name || `Resend HTTP ${response.status}`,
    });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Vercel Serverless Function — proxies email sends to Resend.
//
// Environment variables required:
//   RESEND_API_KEY   — starts with re_...
//   FROM_EMAIL       — e.g. "The Chapter <chapters@yourdomain.com>"
//                      For testing you can use "onboarding@resend.dev" but
//                      Resend will only deliver to the address that owns the
//                      Resend account until you verify a domain.
//   ALLOWED_ORIGIN   (optional) — if set, only this origin can call the API

import { threadHeaders } from "./_lib/email.js";

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
  const { to, subject, html, text, unsubscribeUrl, thread } = body || {};

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
  // Threading so each book is ONE conversation in the reader's inbox rather
  // than a pile of separate emails. The headers are computed here rather than
  // accepted from the client: the browser doesn't know the sending domain, and
  // taking raw Message-ID/References from a public endpoint would be a header
  // injection risk. The client only supplies {bookId, token, chNum}.
  if (thread && typeof thread === "object") {
    const th = threadHeaders({
      bookId: String(thread.bookId || "").replace(/[^a-zA-Z0-9_-]/g, ""),
      token: String(thread.token || "").replace(/[^a-zA-Z0-9_-]/g, ""),
      chNum: parseInt(thread.chNum, 10),
      fromEmail,
    });
    if (th) payload.headers = { ...(payload.headers || {}), ...th };
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
      console.log(`Resend OK: id=${data.id}, to=${clean.join(",")}, from=${fromEmail}`);
      return res.status(200).json({ ok: true, id: data.id });
    }

    // Known-failure diagnostics — translate Resend's terse errors into something
    // an operator reading Vercel logs can act on.
    let diagnostic = "";
    const msg = (data?.message || data?.name || "").toLowerCase();
    if (msg.includes("you can only send testing emails to your own email") || msg.includes("verify a domain")) {
      diagnostic = " — DIAGNOSTIC: Your Resend account doesn't have a verified domain yet. Until you verify one in resend.com → Settings → Domains, Resend will ONLY deliver to the email address registered on your Resend account. Currently trying to send to: " + clean.join(", ");
    } else if (msg.includes("api key") || response.status === 401) {
      diagnostic = " — DIAGNOSTIC: RESEND_API_KEY is invalid or revoked. Generate a new key at resend.com/api-keys and update the Vercel env var.";
    } else if (msg.includes("from")) {
      diagnostic = " — DIAGNOSTIC: FROM_EMAIL ('" + fromEmail + "') uses a domain that isn't verified in your Resend account. Either verify the domain or use 'onboarding@resend.dev' for testing.";
    }
    console.error(`Resend error ${response.status}:`, JSON.stringify(data) + diagnostic);
    return res.status(response.status).json({
      ok: false,
      error: (data?.message || data?.name || `Resend HTTP ${response.status}`) + diagnostic,
    });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Vercel Serverless Function — Stripe Checkout (create + verify).
//
// Deliberately minimal: no Stripe SDK, no webhooks. We call Stripe's REST API
// directly with fetch, and instead of webhook plumbing we verify the session
// server-side when the user returns to /app?checkout=success&session_id=...
// — the verify step retrieves the session from Stripe with the secret key,
// checks payment_status, and only then records the plan in the database.
// That's tamper-proof (the client never asserts "I paid", Stripe does) and
// removes an entire class of webhook-delivery failure modes. Webhooks become
// worth adding when you need subscription-lifecycle events (renewals,
// cancellations); for launch this is enough.
//
// Environment variables:
//   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
//   STRIPE_PRICE_MONTHLY   price id for $5/mo   (recurring)
//   STRIPE_PRICE_ANNUAL    price id for $40/yr  (recurring)
//   STRIPE_PRICE_ALACARTE  price id for $3      (one-time)
//
// If STRIPE_SECRET_KEY is unset, POST returns { ok:false, reason:"not-configured" }
// and the frontend falls back to the current free-beta behavior.
//
//   POST { plan: "monthly"|"annual"|"alacarte", email, bookId? }
//        → { ok, url }  (redirect the browser to url)
//   GET  ?session_id=cs_...
//        → { ok, plan, email, bookId }  (after verifying with Stripe)

import { hasDb, setUserPlan, query } from "./_lib/db.js";

const STRIPE_API = "https://api.stripe.com/v1";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const allowSameOrigin = origin && host && origin.endsWith(host);
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowSameOrigin ? origin : (process.env.ALLOWED_ORIGIN || "*")
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

async function stripe(path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  const opts = {
    method: params ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}` },
  };
  if (params) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(params).toString();
  }
  const r = await fetch(`${STRIPE_API}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Stripe HTTP ${r.status}`);
  return data;
}

const PLAN_PRICES = () => ({
  monthly: { price: process.env.STRIPE_PRICE_MONTHLY, mode: "subscription" },
  annual: { price: process.env.STRIPE_PRICE_ANNUAL, mode: "subscription" },
  alacarte: { price: process.env.STRIPE_PRICE_ALACARTE, mode: "payment" },
});

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(200).json({ ok: false, reason: "not-configured" });
  }

  const origin = process.env.PUBLIC_ORIGIN
    || (req.headers.host ? `https://${req.headers.host}` : "https://the-chapter-one.vercel.app");

  try {
    // ─── Create a Checkout Session ───
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const { plan, email, bookId } = body || {};
      const cfg = PLAN_PRICES()[plan];
      if (!cfg) return res.status(400).json({ ok: false, error: "Unknown plan" });
      if (!cfg.price) return res.status(200).json({ ok: false, reason: "not-configured", error: `Price id for '${plan}' not set` });

      const session = await stripe("/checkout/sessions", {
        mode: cfg.mode,
        "line_items[0][price]": cfg.price,
        "line_items[0][quantity]": "1",
        customer_email: email || "",
        "metadata[plan]": plan,
        "metadata[bookId]": bookId || "",
        success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/app?checkout=cancel`,
        allow_promotion_codes: "true",
      });
      return res.status(200).json({ ok: true, url: session.url });
    }

    // ─── Verify a session after return ───
    if (req.method === "GET") {
      const sid = req.query?.session_id;
      if (!sid || !/^cs_/.test(sid)) return res.status(400).json({ ok: false, error: "session_id required" });

      const session = await stripe(`/checkout/sessions/${sid}`);
      const paid = session.payment_status === "paid"
        || (session.mode === "subscription" && session.status === "complete");
      if (!paid) return res.status(200).json({ ok: false, error: "Payment not completed" });

      const plan = session.metadata?.plan;
      const bookId = session.metadata?.bookId || null;
      const email = session.customer_details?.email || session.customer_email || null;

      // Record server-side so the cron honors the paid plan. Skips silently
      // when no DB — the frontend still unlocks locally from this response.
      if (hasDb() && email) {
        if (plan === "monthly" || plan === "annual") {
          await setUserPlan(email, plan, sid);
        } else if (plan === "alacarte" && bookId) {
          await query(
            `UPDATE subscriptions SET plan = 'alacarte' WHERE email = $1 AND book_id = $2`,
            [email.toLowerCase().trim(), bookId]
          );
        }
      }
      return res.status(200).json({ ok: true, plan, email, bookId });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

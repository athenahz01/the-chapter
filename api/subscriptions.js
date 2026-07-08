// Vercel Serverless Function — server-side subscription records.
//
// This is what makes scheduled email delivery real: the browser registers
// each subscription here, and /api/cron reads this table every morning to
// send due chapters — no browser tab required.
//
// Endpoints (single file, method-routed):
//   POST   { email, bookId, plan, scheduleDays, chaptersPerDelivery,
//            friends, currentChapter, lastDeliveryDate }
//          → upserts, returns { ok, token, currentChapter }
//   GET    ?token=...   → returns the subscription row (for cross-device sync)
//   PATCH  { token, ...fields }  → update schedule/pause/email/etc.
//   DELETE { token }    → remove entirely
//
// If DATABASE_URL is not configured, every call returns
// { ok:false, reason:"no-db" } and the frontend silently continues in its
// original local-only mode — this layer is strictly additive.

import {
  hasDb, upsertSubscription, getSubByToken, patchSubByToken, deleteSubByToken, getReading,
} from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const allowSameOrigin = origin && host && origin.endsWith(host);
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowSameOrigin ? origin : (process.env.ALLOWED_ORIGIN || "*")
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!hasDb()) {
    return res.status(200).json({ ok: false, reason: "no-db" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    if (req.method === "POST") {
      const { email, bookId } = body;
      if (!EMAIL_RE.test(email || "")) return res.status(400).json({ ok: false, error: "Invalid email" });
      if (!byId(bookId)) return res.status(400).json({ ok: false, error: "Unknown book" });
      const friends = (body.friends || []).filter(f => EMAIL_RE.test(f)).slice(0, 5);
      const scheduleDays = (body.scheduleDays || []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
      if (!scheduleDays.length) return res.status(400).json({ ok: false, error: "No delivery days" });
      // Joining a reading? Validate it exists and matches the book.
      let readingId = null;
      if (body.readingId) {
        const rd = await getReading(body.readingId);
        if (rd && rd.book_id === bookId) readingId = rd.id;
      }
      const row = await upsertSubscription({
        email, bookId, friends, scheduleDays,
        plan: ["free", "alacarte", "paid", "monthly", "annual"].includes(body.plan) ? body.plan : "free",
        chaptersPerDelivery: Math.min(5, Math.max(1, body.chaptersPerDelivery | 0 || 1)),
        currentChapter: Math.max(0, body.currentChapter | 0),
        lastDeliveryDate: body.lastDeliveryDate || null,
        readingId,
        wantQuestions: !!body.wantQuestions,
        deliveryHour: Number.isInteger(body.deliveryHour) && body.deliveryHour >= 0 && body.deliveryHour <= 23 ? body.deliveryHour : null,
      });
      return res.status(200).json({ ok: true, token: row.token, currentChapter: row.current_chapter, readingId });
    }

    if (req.method === "GET") {
      const token = req.query?.token;
      if (!token) return res.status(400).json({ ok: false, error: "token required" });
      const sub = await getSubByToken(token);
      if (!sub) return res.status(404).json({ ok: false, error: "Not found" });
      return res.status(200).json({
        ok: true,
        sub: {
          bookId: sub.book_id, email: sub.email, plan: sub.plan,
          scheduleDays: sub.schedule_days, chaptersPerDelivery: sub.chapters_per_delivery,
          currentChapter: sub.current_chapter, paused: sub.paused,
          friends: sub.friends, lastDeliveryDate: sub.last_delivery_date,
          readingId: sub.reading_id || null, wantQuestions: !!sub.want_questions,
        },
      });
    }

    if (req.method === "PATCH") {
      const { token, ...fields } = body;
      if (!token) return res.status(400).json({ ok: false, error: "token required" });
      if (fields.email !== undefined && !EMAIL_RE.test(fields.email)) {
        return res.status(400).json({ ok: false, error: "Invalid email" });
      }
      if (fields.friends !== undefined) {
        fields.friends = fields.friends.filter(f => EMAIL_RE.test(f)).slice(0, 5);
      }
      if (fields.scheduleDays !== undefined) {
        fields.scheduleDays = fields.scheduleDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
        if (!fields.scheduleDays.length) return res.status(400).json({ ok: false, error: "No delivery days" });
      }
      const row = await patchSubByToken(token, fields);
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const token = body.token || req.query?.token;
      if (!token) return res.status(400).json({ ok: false, error: "token required" });
      const removed = await deleteSubByToken(token);
      return res.status(200).json({ ok: removed });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Subscriptions API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

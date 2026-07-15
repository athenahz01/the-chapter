// Vercel Serverless Function — communal readings.
//
// The Chapter's primary product is not "receive chapters by email"; it's
// "join our reading of Moby-Dick." This endpoint serves the reading cohorts:
//
//   GET  /api/readings                → list public readings + participant counts
//   GET  /api/readings?id=<id>        → one reading (with count)
//   GET  /api/readings?code=<invite>  → resolve a private group's invite code
//   POST { bookId, title, deliveryDays, isPublic:false, createdBy }
//        → create a private group reading; returns invite code + join URL
//
// Public reading creation is intentionally NOT exposed here — flagship
// readings are seeded (see scripts/seed-readings.sql or the auto-seed below)
// so the homepage funnel stays curated. Private groups are open to anyone.

import { hasDb, listPublicReadings, getReading, getReadingByCode, createReading, participantCount, query } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  res.setHeader("Access-Control-Allow-Origin",
    origin && host && origin.endsWith(host) ? origin : (process.env.ALLOWED_ORIGIN || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

// Flagship reading, seeded on first request so a fresh deploy has a live
// funnel with zero manual steps. Idempotent (ON CONFLICT DO NOTHING).
async function ensureFlagship() {
  await createReading({
    id: "great-mobydick-reading",
    bookId: "mobydick",
    title: "The Great Moby-Dick Reading",
    blurb: "One chapter a day, five days a week, all summer. Melville's chapters are famously short — most take under ten minutes — and famously strange. Read the whale with us.",
    startDate: "2026-07-13",
    deliveryDays: [1, 2, 3, 4, 5],
    isPublic: true,
  });
}

function shape(r, participants) {
  const book = byId(r.book_id);
  return {
    id: r.id, bookId: r.book_id, title: r.title, blurb: r.blurb,
    startDate: r.start_date, deliveryDays: r.delivery_days,
    isPublic: r.is_public, inviteCode: r.is_public ? undefined : r.invite_code,
    participants: participants ?? r.participants ?? 0,
    book: book ? { title: book.title, author: book.author, chapters: book.chapters } : null,
    weeks: book ? Math.ceil(book.chapters / (r.delivery_days?.length || 5)) : null,
  };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!hasDb()) return res.status(200).json({ ok: false, reason: "no-db" });

  try {
    if (req.method === "GET") {
      await ensureFlagship();
      const { id, code } = req.query || {};
      if (id) {
        const r = await getReading(id);
        if (!r) return res.status(404).json({ ok: false, error: "Not found" });
        return res.status(200).json({ ok: true, reading: shape(r, await participantCount(r.id)) });
      }
      if (code) {
        const r = await getReadingByCode(code);
        if (!r) return res.status(404).json({ ok: false, error: "Invalid invite code" });
        return res.status(200).json({ ok: true, reading: shape(r, await participantCount(r.id)) });
      }
      const rows = await listPublicReadings();
      // Participant counts get a friendly floor of 0; no fake numbers.
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({ ok: true, readings: rows.map(r => shape(r)) });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const { bookId, title, createdBy } = body || {};
      const book = byId(bookId);
      if (!book) return res.status(400).json({ ok: false, error: "Unknown book" });
      const cleanTitle = String(title || `Reading ${book.title} together`).slice(0, 80);
      const deliveryDays = (body.deliveryDays || [1]).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
      if (!deliveryDays.length) return res.status(400).json({ ok: false, error: "No delivery days" });
      const r = await createReading({
        bookId, title: cleanTitle, deliveryDays,
        isPublic: false, // user-created groups are always private (invite-only)
        createdBy: createdBy || null,
      });
      const origin = process.env.PUBLIC_ORIGIN || (req.headers.host ? `https://${req.headers.host}` : "");
      return res.status(200).json({
        ok: true,
        reading: shape(r, 0),
        inviteCode: r.invite_code,
        inviteUrl: `${origin}/app?join=${r.invite_code}`,
      });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Readings API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

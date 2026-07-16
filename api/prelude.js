// Vercel Serverless Function — chapter prelude, get-or-generate (cached).
//
// Preludes used to be generated per reader, per chapter: every subscriber to a
// public reading triggered its own Claude call for the *same* prelude. They are
// now cached per (book, chapter) in Postgres, so generation happens once and the
// whole cohort reads the same prelude — cheaper, and truer to the communal idea.
//
//   GET /api/prelude?book=<id>&ch=<n>  →  { ok, prelude }
//
// Falls back gracefully: no DB → generates each time (still works, just uncached).

import { hasDb, getExtras, setPrelude } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";
import { getChapter } from "./_lib/gutenberg.js";
import { getPrelude, cleanModelText } from "./_lib/services.js";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  res.setHeader("Access-Control-Allow-Origin",
    origin && host && origin.endsWith(host) ? origin : (process.env.ALLOWED_ORIGIN || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const book = byId(req.query?.book);
  const ch = parseInt(req.query?.ch, 10);
  if (!book || !ch || ch < 1 || ch > book.chapters) {
    return res.status(400).json({ ok: false, error: "Valid book and ch required" });
  }

  try {
    // Cache hit — the common path once a chapter has been read once by anyone.
    if (hasDb()) {
      const hit = await getExtras(book.id, ch);
      if (hit?.prelude) {
        // Clean on read as well as on write: preludes cached before the
        // sanitiser existed still carry model scaffolding like "# Prelude to
        // Chapter 1", and that would render literally in the email.
        const clean = cleanModelText(hit.prelude);
        if (clean) {
          if (clean !== hit.prelude) { try { await setPrelude(book.id, ch, clean); } catch {} }
          res.setHeader("Cache-Control", "public, s-maxage=604800");
          return res.status(200).json({ ok: true, prelude: clean, cached: true });
        }
      }
    }

    // Generate once from the real chapter text (gid keeps us off the blocked
    // Gutendex resolver and on the DB-cached book text).
    const g = await getChapter({ gid: book.gid, q: book.gq || `${book.title} ${book.author}`, ch });
    if (!g.ok) return res.status(502).json({ ok: false, error: "Could not fetch chapter text" });

    const prelude = await getPrelude(book.title, ch, g.text.slice(0, 1200));
    if (!prelude) return res.status(200).json({ ok: false, error: "Prelude generation unavailable" });

    if (hasDb()) { try { await setPrelude(book.id, ch, prelude); } catch { /* non-fatal */ } }
    res.setHeader("Cache-Control", "public, s-maxage=604800");
    return res.status(200).json({ ok: true, prelude });
  } catch (err) {
    console.error("Prelude API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

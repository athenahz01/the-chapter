// Vercel Serverless Function — the shareable line for a chapter (cached).
//
// This is the quote-card engine: "It is not down on any map; true places never
// are." Nobody reposts an email, but they will repost a beautiful card of a
// great line — so every chapter needs to produce an *object*, not just a
// private feeling.
//
// Cached per (book, chapter) in Postgres: the whole cohort shares one line
// (that's the point — it becomes the day's line), and we pay for generation
// once rather than once per reader.
//
//   GET /api/quote?book=<id>&ch=<n>  →  { ok, quote }
//
// The line is verified verbatim against the chapter text before we store it —
// we will not put invented words in an author's mouth.

import { hasDb, getExtras, setQuote } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";
import { getChapter } from "./_lib/gutenberg.js";
import { getQuote } from "./_lib/services.js";

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
    if (hasDb()) {
      const hit = await getExtras(book.id, ch);
      if (hit?.quote) {
        res.setHeader("Cache-Control", "public, s-maxage=604800");
        return res.status(200).json({ ok: true, quote: hit.quote, book: book.title, author: book.author, ch, cached: true });
      }
    }

    const g = await getChapter({ gid: book.gid, q: book.gq || `${book.title} ${book.author}`, ch });
    if (!g.ok) return res.status(502).json({ ok: false, error: "Could not fetch chapter text" });

    const quote = await getQuote(book.title, ch, g.text);
    if (!quote) return res.status(200).json({ ok: false, error: "No quote available" });

    if (hasDb()) { try { await setQuote(book.id, ch, quote); } catch { /* non-fatal */ } }
    res.setHeader("Cache-Control", "public, s-maxage=604800");
    return res.status(200).json({ ok: true, quote, book: book.title, author: book.author, ch });
  } catch (err) {
    console.error("Quote API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

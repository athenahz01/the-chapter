// Vercel Serverless Function — discussion questions, get-or-generate.
//
// Questions are cached per (book, chapter) in Postgres so the entire cohort
// discusses the SAME questions — the communal point — and generation happens
// once, not once per reader. The chapter text snippet comes from the same
// Gutenberg pipeline as everything else.
//
//   GET /api/questions?book=<id>&ch=<n>  →  { ok, questions: [ ... ] }

import { hasDb, getExtras, setExtras } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";
import { getChapter } from "./_lib/gutenberg.js";
import { getDiscussionQuestions } from "./_lib/services.js";

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
    // Cache hit?
    if (hasDb()) {
      const hit = await getExtras(book.id, ch);
      if (hit?.questions) {
        res.setHeader("Cache-Control", "public, s-maxage=86400");
        return res.status(200).json({ ok: true, questions: hit.questions.split("\n").filter(Boolean) });
      }
    }
    // Generate from the real chapter text.
    const g = await getChapter({ q: book.gq || `${book.title} ${book.author}`, ch });
    if (!g.ok) return res.status(502).json({ ok: false, error: "Could not fetch chapter text" });
    const raw = await getDiscussionQuestions(book.title, ch, g.text.slice(0, 2500));
    if (!raw) return res.status(200).json({ ok: false, error: "Question generation unavailable" });
    const questions = raw.split("\n").map(q => q.replace(/^[\d.\-•)\s]+/, "").trim()).filter(q => q.length > 8).slice(0, 5);
    if (hasDb() && questions.length) await setExtras(book.id, ch, questions.join("\n"));
    res.setHeader("Cache-Control", "public, s-maxage=86400");
    return res.status(200).json({ ok: true, questions });
  } catch (err) {
    console.error("Questions API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

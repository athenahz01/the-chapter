// Vercel Serverless Function — per-chapter discussion threads.
//
// Scoped to a reading (public cohort or private group), keyed by chapter.
// This is the "community thread" of the V1 spec, kept in-product rather than
// bounced out to Discord: the conversation lives next to the text.
//
//   GET  /api/comments?reading=<id>&ch=<n>     → latest 100, oldest first
//   POST { reading, ch, name, body }           → add a comment

import { hasDb, query, getReading } from "./_lib/db.js";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  res.setHeader("Access-Control-Allow-Origin",
    origin && host && origin.endsWith(host) ? origin : (process.env.ALLOWED_ORIGIN || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!hasDb()) return res.status(200).json({ ok: false, reason: "no-db" });

  try {
    if (req.method === "GET") {
      const { reading, ch } = req.query || {};
      const chapter = parseInt(ch, 10);
      if (!reading || !chapter) return res.status(400).json({ ok: false, error: "reading and ch required" });
      const r = await query(
        `SELECT id, name, body, created_at FROM comments
          WHERE reading_id = $1 AND chapter = $2
          ORDER BY created_at ASC LIMIT 100`,
        [reading, chapter]
      );
      return res.status(200).json({ ok: true, comments: r.rows });
    }

    if (req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
      const chapter = parseInt(b?.ch, 10);
      const name = String(b?.name || "").trim().slice(0, 40);
      const body = String(b?.body || "").trim().slice(0, 1000);
      if (!b?.reading || !chapter || !name || !body) {
        return res.status(400).json({ ok: false, error: "reading, ch, name, body required" });
      }
      if (!(await getReading(b.reading))) return res.status(404).json({ ok: false, error: "Unknown reading" });
      const r = await query(
        `INSERT INTO comments (reading_id, chapter, name, body) VALUES ($1,$2,$3,$4)
         RETURNING id, name, body, created_at`,
        [b.reading, chapter, name, body]
      );
      return res.status(200).json({ ok: true, comment: r.rows[0] });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("Comments API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

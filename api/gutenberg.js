// Vercel Serverless Function — fetches REAL chapter text from Project Gutenberg.
//
// This is the primary text source for the ~60 books in the catalog that don't
// have a clean per-chapter Wikisource page. Before this existed, those books
// fell straight through to the Claude API with a prompt asking it to
// "reproduce the full text" — which a language model cannot actually do.
// Gutenberg has the genuine article for essentially the whole catalog, free.
//
// GET /api/gutenberg?q=<title+author>&ch=<n>[&gid=<gutenberg id>]
// The heavy lifting (Gutendex resolution, download, boilerplate stripping,
// chapter splitting) lives in _lib/gutenberg.js, shared with /api/cron.
// Responses are CDN-cached — public-domain text does not change.
//
// No environment variables required.

import { getChapter } from "./_lib/gutenberg.js";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  const allowSameOrigin = origin && host && origin.endsWith(host);
  res.setHeader(
    "Access-Control-Allow-Origin",
    allowSameOrigin ? origin : (process.env.ALLOWED_ORIGIN || "*")
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const q = req.query?.q;
  const ch = parseInt(req.query?.ch, 10);
  const gid = parseInt(req.query?.gid, 10) || null;

  if ((!q && !gid) || !ch || ch < 1) {
    return res.status(400).json({ ok: false, error: "Requires ?q=<title author> (or gid) and ?ch=<chapter number>" });
  }

  try {
    const result = await getChapter({ q, gid, ch });
    if (result.ok) {
      // Immutable public-domain text — cache hard at the CDN (1 week).
      res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
      return res.status(200).json(result);
    }
    if (result.total) {
      // Out-of-range: still useful to cache (tells client the real count).
      res.setHeader("Cache-Control", "public, s-maxage=86400");
      return res.status(200).json(result);
    }
    return res.status(result.gid ? 502 : 404).json(result);
  } catch (err) {
    console.error("Gutenberg proxy error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

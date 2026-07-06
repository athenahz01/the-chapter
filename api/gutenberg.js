// Vercel Serverless Function — fetches REAL chapter text from Project Gutenberg.
//
// This is the primary text source for the ~60 books in the catalog that don't
// have a clean per-chapter Wikisource page. Before this existed, those books
// fell straight through to the Claude API with a prompt asking it to
// "reproduce the full text" — which a language model cannot actually do.
// Users were getting plausible-sounding *invented* text. Gutenberg has the
// genuine article for essentially the whole catalog, for free.
//
// Flow:
//   GET /api/gutenberg?q=<title+author>&ch=<n>[&gid=<gutenberg id>]
//
//   1. Resolve the work → Gutenberg ID. If the client passes a `gid` (cached
//      from a previous resolution) we use it directly. Otherwise we search
//      the Gutendex API (a maintained public JSON index of the PG catalog,
//      sorted by popularity) and take the best English text match.
//   2. Download the plain-text ebook, strip the PG license boilerplate.
//   3. Split into chapters (CHAPTER / STAVE / LETTER headings, with PART/BOOK
//      and bare-numeral fallbacks), drop table-of-contents stubs.
//   4. Return just the requested chapter + metadata.
//
// Responses are CDN-cached (s-maxage) — the text of Bleak House is not going
// to change — so repeat requests for popular chapters never hit Gutenberg.
//
// No environment variables required.

const GUTENDEX = "https://gutendex.com/books";

// Warm-invocation caches (module scope survives between requests on a warm
// lambda). bookCache maps gid → { chapters: [...], title }. resolveCache maps
// normalized query → gid.
const bookCache = new Map();
const resolveCache = new Map();
const BOOK_CACHE_MAX = 6; // full texts are 0.5–3 MB each; keep memory sane

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

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Score how well a Gutendex result matches the query: fraction of query words
// present in "title + author". Gutendex sorts by download count, so among
// close scores the first (most popular ≈ canonical edition) wins.
function matchScore(queryWords, entry) {
  const hay = norm(entry.title + " " + (entry.authors || []).map(a => a.name).join(" "));
  let hit = 0;
  for (const w of queryWords) if (hay.includes(w)) hit++;
  return hit / Math.max(1, queryWords.length);
}

function pickTextUrl(formats) {
  for (const [mime, url] of Object.entries(formats || {})) {
    if (mime.startsWith("text/plain") && !/\.zip($|\?)/.test(url)) return url;
  }
  return null;
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(timer); return null; }
}

async function resolveGid(q) {
  const key = norm(q);
  if (resolveCache.has(key)) return resolveCache.get(key);

  const data = await fetchJson(`${GUTENDEX}?search=${encodeURIComponent(q)}&languages=en`);
  const results = data?.results || [];
  const queryWords = key.split(" ").filter(w => w.length > 2);

  let best = null, bestScore = 0;
  for (const entry of results.slice(0, 10)) {
    if (!pickTextUrl(entry.formats)) continue;
    const score = matchScore(queryWords, entry);
    if (score > bestScore) { best = entry; bestScore = score; }
    if (bestScore === 1) break;
  }
  // Require at least half the query words to match — otherwise we'd rather
  // fail (and let the frontend fall back) than serve the wrong book.
  const gid = best && bestScore >= 0.5 ? best.id : null;
  if (gid) resolveCache.set(key, gid);
  return gid;
}

// ─── Text processing ───────────────────────────────────────────

function stripBoilerplate(raw) {
  let text = raw;
  const startRe = /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*/i;
  const endRe = /\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i;
  const sm = text.match(startRe);
  if (sm) text = text.slice(sm.index + sm[0].length);
  const em = text.match(endRe);
  if (em) text = text.slice(0, em.index);
  return text.replace(/\r\n/g, "\n");
}

// Unwrap Gutenberg's ~70-char hard line wrapping. Single newlines inside a
// paragraph become spaces; blank lines (paragraph breaks) are preserved.
function unwrap(text) {
  return text.replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/[ \t]+/g, " ");
}

const HEADING_PATTERNS = [
  // "CHAPTER I", "Chapter 12.", "CHAPTER THE FIRST", "STAVE ONE", "LETTER IV"
  /^[ \t]*(?:CHAPTER|Chapter|STAVE|Stave|LETTER|Letter)\s+(?:[IVXLCDM]+|\d+|[A-Za-z-]+)\b[^\n]*$/gm,
  // "PART I" / "BOOK SECOND" — some books use only these
  /^[ \t]*(?:PART|Part|BOOK|Book)\s+(?:[IVXLCDM]+|\d+|[A-Za-z-]+)\b[^\n]*$/gm,
  // Bare roman/arabic numeral on its own line ("XIV." style, e.g. some Twain)
  /^[ \t]*(?:[IVXLCDM]{1,7}|\d{1,3})\.?[ \t]*$/gm,
];

function splitChapters(text) {
  for (const pattern of HEADING_PATTERNS) {
    pattern.lastIndex = 0;
    const marks = [];
    let m;
    while ((m = pattern.exec(text)) !== null) marks.push(m.index);
    if (marks.length < 3) continue;

    const segments = [];
    for (let i = 0; i < marks.length; i++) {
      const seg = text.slice(marks[i], marks[i + 1] ?? text.length);
      // Drop the heading line itself, keep the body.
      const body = seg.slice(seg.indexOf("\n") + 1).trim();
      // Table-of-contents entries and PART/BOOK divider pages produce
      // near-empty segments — skip them so chapter numbering stays true.
      if (body.length > 400) segments.push(unwrap(body).trim());
    }
    if (segments.length >= 3) return segments;
  }
  // No recognizable chapter structure — return whole text as one "chapter".
  const whole = unwrap(text).trim();
  return whole ? [whole] : [];
}

async function loadBook(gid) {
  if (bookCache.has(gid)) return bookCache.get(gid);

  // Gutenberg's canonical stable text URL. Falls back to the format URL from
  // Gutendex metadata if the canonical path 404s.
  const urls = [
    `https://www.gutenberg.org/ebooks/${gid}.txt.utf-8`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.txt`,
  ];
  let raw = null;
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(timer);
      if (r.ok) { raw = await r.text(); break; }
    } catch { /* try next */ }
  }
  if (!raw) {
    // Last resort: ask Gutendex where the text lives.
    const meta = await fetchJson(`${GUTENDEX}/${gid}`);
    const url = meta && pickTextUrl(meta.formats);
    if (url) {
      try {
        const r = await fetch(url, { redirect: "follow" });
        if (r.ok) raw = await r.text();
      } catch { /* give up */ }
    }
  }
  if (!raw || raw.length < 5000) return null;

  const chapters = splitChapters(stripBoilerplate(raw));
  if (chapters.length === 0) return null;

  const book = { chapters };
  if (bookCache.size >= BOOK_CACHE_MAX) {
    bookCache.delete(bookCache.keys().next().value); // evict oldest
  }
  bookCache.set(gid, book);
  return book;
}

// ─── Handler ───────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const q = req.query?.q;
  const ch = parseInt(req.query?.ch, 10);
  let gid = parseInt(req.query?.gid, 10) || null;

  if ((!q && !gid) || !ch || ch < 1) {
    return res.status(400).json({ ok: false, error: "Requires ?q=<title author> (or gid) and ?ch=<chapter number>" });
  }

  try {
    if (!gid) gid = await resolveGid(q);
    if (!gid) {
      return res.status(404).json({ ok: false, error: "Could not resolve this work on Project Gutenberg" });
    }

    const book = await loadBook(gid);
    if (!book) {
      return res.status(502).json({ ok: false, error: `Could not fetch/parse Gutenberg text #${gid}` });
    }

    if (ch > book.chapters.length) {
      // Tell the client the real chapter count so it can decide what to do.
      res.setHeader("Cache-Control", "public, s-maxage=86400");
      return res.status(200).json({ ok: false, gid, total: book.chapters.length, error: "Chapter out of range" });
    }

    // Immutable public-domain text — cache hard at the CDN (1 week) so repeat
    // reads never re-hit Gutenberg or re-run the split.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({ ok: true, gid, total: book.chapters.length, text: book.chapters[ch - 1] });
  } catch (err) {
    console.error("Gutenberg proxy error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Shared Project Gutenberg fetch/split logic.
// Used by /api/gutenberg (browser-facing route) and /api/cron (scheduled
// email delivery). Module-scope caches survive warm invocations.

const GUTENDEX = "https://gutendex.com/books";

import { hasDb, getBookCache, setBookCache } from "./db.js";

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

// ─── Chinese chapter splitting ─────────────────────────────────
// Chinese classics mark chapters with 第一回 / 第一章 / 學而第一 — none of the
// English patterns match. Notes on the tricky parts:
//  · numerals include ○ (U+25CB) as well as 〇 — 紅樓夢/三國演義 use both.
//  · full-width space (U+3000) is the usual indent, so it must count as space.
//  · the lookahead rejects prose that merely starts with 第X回 (e.g.
//    "第四回中既將薛家母子…" is narrative, not a heading).
//  · Chinese is far denser than English: a 道德經 chapter is ~80 characters,
//    so the English 400-char floor would throw 25 of its 81 chapters away.
//  · some files repeat a heading; we keep the copy with the real body.
const ZH_NUM = "一二三四五六七八九十百千零〇○两兩0-9";
const ZH_PATTERNS = [
  new RegExp(`^[ \\t\\u3000]*第[${ZH_NUM}]+[回章](?![\\u4e00-\\u9fff])[^\\n]*$`, "gm"),
  new RegExp(`^[ \\t\\u3000]*\\S{1,8}第[${ZH_NUM}]+[ \\t\\u3000]*$`, "gm"),
  new RegExp(`^[ \\t\\u3000]*第[${ZH_NUM}]+[節节篇折](?![\\u4e00-\\u9fff])[^\\n]*$`, "gm"),
];
const ZH_MIN_BODY = 20;

function splitChineseChapters(text) {
  for (const pattern of ZH_PATTERNS) {
    pattern.lastIndex = 0;
    const hits = [];
    let m;
    while ((m = pattern.exec(text)) !== null) hits.push({ i: m.index, h: m[0] });
    if (hits.length < 3) continue;

    const segs = hits.map((hit, i) => {
      const seg = text.slice(hit.i, hits[i + 1]?.i ?? text.length);
      const body = seg.slice(seg.indexOf("\n") + 1).trim();
      const num = (hit.h.match(new RegExp(`第([${ZH_NUM}]+)`)) || [])[1] || `_${i}`;
      return { num, body };
    }).filter(s => s.body.length > ZH_MIN_BODY);

    const best = new Map();
    for (const s of segs) {
      const prev = best.get(s.num);
      if (!prev || s.body.length > prev.body.length) best.set(s.num, s);
    }
    const out = [...best.values()].map(s => unwrap(s.body).trim());
    if (out.length >= 3) return out;
  }
  return null;
}

function splitChapters(text) {
  // Chinese first — these patterns require 第, so they can never match an
  // English text; English books fall straight through to the patterns below.
  const zh = splitChineseChapters(text);
  if (zh && zh.length >= 3) return zh;

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

  // Persistent DB cache: once a book is fetched + parsed it lives here, so
  // cold lambdas and the cron never re-hit gutenberg.org (which is slow for
  // big books and throttles cloud IPs — the cause of the intermittent 502s).
  if (hasDb()) {
    try {
      const cached = await getBookCache(gid);
      if (Array.isArray(cached) && cached.length) { rememberWarm(gid, { chapters: cached }); return bookCache.get(gid); }
    } catch { /* DB miss/erroring is fine — fall through to the network */ }
  }

  const urls = [
    `https://www.gutenberg.org/ebooks/${gid}.txt.utf-8`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.txt`,
  ];
  let raw = null;
  // Two full URLs at 25s each stays under the 60s function ceiling; the real
  // durability comes from the DB cache above, this just needs to succeed once.
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(timer);
      if (r.ok) { raw = await r.text(); break; }
    } catch { /* try next url */ }
  }
  if (!raw || raw.length < 5000) return null;

  const chapters = splitChapters(stripBoilerplate(raw));
  if (chapters.length === 0) return null;

  rememberWarm(gid, { chapters });
  if (hasDb()) { try { await setBookCache(gid, chapters); } catch { /* non-fatal */ } }
  return bookCache.get(gid);
}

function rememberWarm(gid, book) {
  if (bookCache.size >= BOOK_CACHE_MAX) bookCache.delete(bookCache.keys().next().value);
  bookCache.set(gid, book);
}


export async function getChapter({ q, gid, ch }) {
  if (!gid) gid = await resolveGid(q);
  if (!gid) return { ok: false, error: "Could not resolve this work on Project Gutenberg" };
  const book = await loadBook(gid);
  if (!book) return { ok: false, gid, error: `Could not fetch/parse Gutenberg text #${gid}` };
  if (ch > book.chapters.length) return { ok: false, gid, total: book.chapters.length, error: "Chapter out of range" };
  return { ok: true, gid, total: book.chapters.length, text: book.chapters[ch - 1] };
}

export { resolveGid, loadBook, stripBoilerplate, splitChapters, unwrap, norm, matchScore };

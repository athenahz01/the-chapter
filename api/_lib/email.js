import { readingMinutes } from "./gutenberg.js";

// Server-side email builder — used by /api/cron for scheduled deliveries.
//
// Design decision (deliberate): the email is a REMINDER, not the reading
// surface. It carries the book, the chapter number, an estimated reading
// time, and a prelude that sets the scene — then one button that deep-links
// straight into the app reader (/app?read=bookId.ch&token=...). The full text
// lives in the app. This keeps chapters from getting buried in the inbox,
// improves deliverability (small, consistent emails), and lets reading feel
// like reading instead of email triage. The token in the deep link lets a
// new device adopt the subscription (progress sync) on first open.

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One serif stack for both scripts. Font fallback resolves per glyph, so Latin
// takes Georgia and CJK drops through to Songti/Source Han — which is why the
// Chinese classics needn't (and mustn't) have a separate template.
const SERIF = `Georgia,'Songti SC','Source Han Serif SC','Noto Serif CJK SC','SimSun',serif`;
const SANS = `Helvetica,Arial,'PingFang SC','Microsoft YaHei',sans-serif`;

// Chinese has no spaces, so the old words/220 count scored an entire chapter of
// 三国演义 as a single "word" and every Chinese email promised "about 1 min" for
// a 7-minute read. readingMinutes() already handles both scripts — use it.
function readMinutes(chapters) {
  const mins = chapters.reduce((n, ch) => n + readingMinutes(ch.text || ""), 0);
  return Math.max(1, Math.round(mins));
}

// The chapter text decides the language, not the catalogue: a book can be
// Chinese without being filed under Chinese Classics.
export function isCJK(chapters) {
  const s = String(chapters?.[0]?.text || "").slice(0, 400);
  return (s.match(/[一-鿿]/g) || []).length > 40;
}

// The reader of 三国演义 was getting Chinese prose wrapped in English furniture
// — "Chapter 7 of 120", "Your chapter is ready". The chapter decides the
// language of the whole email, chrome included.
const ZH = {
  "Your chapter is ready": "今日章节已送达",
  "readers": "位读者",
  "A prelude to set the scene": "导读 · 为你入戏",
  "Today's line": "今日之句",
  "Share today's line": "分享今日之句",
  "To discuss as you read": "边读边聊",
  "Share your thoughts in the chapter discussion in the app.": "在应用的章节讨论中分享你的想法。",
  "Open in the app": "在应用中打开",
  "Track your progress, adjust your schedule, or join the discussion.": "查看进度、调整节奏，或加入讨论。",
  "Sent by The Chapter · Classic literature, chapter by chapter": "由 The Chapter 发送 · 经典文学，一章一章",
  "Manage subscriptions": "管理订阅",
  "Unsubscribe": "退订",
  "of": "共",
  "about": "约",
  "complete": "已读",
};
const T = (zh, s) => (zh && ZH[s]) || s;

export function chapterLabel(chapters, zh = false) {
  // A long chapter is delivered as "Chapter 7 · Part 1 of 2" so no single
  // email is a 45-minute wall of Dickens.
  if (chapters.length === 1) {
    const c = chapters[0];
    if (zh) {
      return c.parts > 1
        ? `第 ${c.chNum} 章 · 第 ${c.part} 部分（共 ${c.parts} 部分）`
        : `第 ${c.chNum} 章`;
    }
    return c.parts > 1
      ? `Chapter ${c.chNum} · Part ${c.part} of ${c.parts}`
      : `Chapter ${c.chNum}`;
  }
  const [a, b] = [chapters[0].chNum, chapters[chapters.length - 1].chNum];
  return zh ? `第 ${a}–${b} 章` : `Chapters ${a}–${b}`;
}

// The stats line, as segments. Built here rather than by appending "of N" to
// chapterLabel(), which produced "Chapter 7 · Part 1 of 2 of 135" — the total
// colliding with the part count. The chapter takes the book total; the part
// keeps its own.
function statsSegments(book, chapters, mins, pct, cjk) {
  const first = chapters[0], last = chapters[chapters.length - 1];
  const seg = [];
  if (chapters.length > 1) {
    seg.push(cjk ? `第 ${first.chNum}–${last.chNum} 章（共 ${book.chapters} 章）`
                 : `Chapters ${first.chNum}–${last.chNum} of ${book.chapters}`);
  } else {
    seg.push(cjk ? `第 ${first.chNum} 章（共 ${book.chapters} 章）`
                 : `Chapter ${first.chNum} of ${book.chapters}`);
    if (first.parts > 1) {
      seg.push(cjk ? `第 ${first.part} 部分（共 ${first.parts} 部分）`
                   : `Part ${first.part} of ${first.parts}`);
    }
  }
  seg.push(cjk ? `约 ${mins} 分钟` : `about ${mins} min`);
  seg.push(cjk ? `已读 ${pct}%` : `${pct}% complete`);
  return seg;
}

function links(book, chapters, { origin, token }) {
  const t = token ? `&token=${encodeURIComponent(token)}` : "";
  return {
    readUrl: `${origin}/app?read=${encodeURIComponent(book.id)}.${chapters[0].chNum}${t}`,
    manageUrl: `${origin}/app`,
    unsubUrl: token
      ? `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`
      : `${origin}/app#unsubscribe`,
  };
}

export function buildEmailHTML(book, chapters, { origin, token, readingTitle, participants, questions, quote }) {
  const { readUrl, manageUrl, unsubUrl } = links(book, chapters, { origin, token });
  const cjk = isCJK(chapters);
  const label = chapterLabel(chapters, cjk);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;
  const pct = Math.min(100, Math.round((chapters[chapters.length - 1].chNum / Math.max(1, book.chapters)) * 100));

  const readingLine = readingTitle
    ? `<p style="font-size:12px;color:#B8964E;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px">${esc(readingTitle)}${participants > 1 ? ` &nbsp;·&nbsp; ${participants.toLocaleString()} ${T(cjk, "readers")}` : ""}</p>`
    : `<p style="font-size:12px;color:#B8964E;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px">${T(cjk, "Your chapter is ready")}</p>`;

  // The day's line. Nobody reposts an email, but they will repost a beautiful
  // card of a great sentence — so give every chapter a shareable object, and
  // put the prompt at the emotional peak: right under the reading.
  const shareUrl = `${origin}/share?b=${encodeURIComponent(book.id)}&c=${chapters[0].chNum}`;
  const quoteBlock = quote ? `
  <div style="margin:34px 0 0;padding:26px 24px;background:#FBF5EC;border:1px solid #EADFC8;border-radius:8px;text-align:center">
    <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.8px;margin:0 0 12px;font-family:${SANS}">${T(cjk, "Today's line")}</p>
    <p style="font-family:${SERIF};font-size:19px;line-height:1.65;color:#1A1612;margin:0 0 18px;font-style:italic">&ldquo;${esc(quote)}&rdquo;</p>
    <a href="${shareUrl}" style="display:inline-block;background:#6B1D2A;color:#FAF6F0;text-decoration:none;padding:11px 26px;border-radius:6px;font-size:13px;font-family:${SANS}">${T(cjk, "Share today's line")} &rarr;</a>
  </div>` : "";

  const questionsBlock = (questions && questions.length) ? `
  <div style="text-align:left;background:#FAF6F0;border:1px solid #E8E2DA;border-radius:6px;padding:16px 20px;margin:24px 0 0">
    <p style="font-size:10px;color:#8A7E73;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;font-family:${SANS}">${T(cjk, "To discuss as you read")}</p>
    ${questions.map(q => `<p style="font-family:${SERIF};font-size:14px;line-height:1.6;color:#2C2419;margin:0 0 8px">· ${esc(q)}</p>`).join("")}
    <p style="font-size:11px;color:#B0A79A;margin:8px 0 0;font-family:${SANS}">${T(cjk, "Share your thoughts in the chapter discussion in the app.")}</p>
  </div>` : "";

  const preludeBlock = prelude ? `
  <div style="background:#FBF5EC;border-left:3px solid #B8964E;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0;text-align:left">
    <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-family:${SANS}">${T(cjk, "A prelude to set the scene")}</p>
    <p style="font-family:${SERIF};font-size:15.5px;line-height:1.7;color:#2C2419;margin:0;font-style:italic">${esc(prelude)}</p>
  </div>` : "";

  const chapterBody = chapters.map(ch => {
    const heading = chapters.length > 1
      ? `<h2 style="font-family:${SERIF};font-size:20px;color:#6B1D2A;margin:34px 0 14px;text-align:left">${cjk ? `第 ${esc(ch.chNum)} 章` : `Chapter ${esc(ch.chNum)}`}</h2>` : "";
    const paras = String(ch.text || "").split(/\n\n+/).filter(p => p.trim()).map((p, i) =>
      `<p style="font-family:${SERIF};font-size:17px;line-height:1.85;color:#2C2419;margin:0 0 1.1em;text-align:left;${i > 0 ? "text-indent:1.4em" : ""}">${esc(p.trim())}</p>`
    ).join("");
    return heading + paras;
  }).join('<hr style="border:none;border-top:1px solid #E8E2DA;margin:34px 0">');
  // The preheader is the grey line Gmail and Apple Mail show beside the subject.
  // Left alone it scrapes the first text in the body — which here was the
  // "T H E   C H A P T E R" letterhead, i.e. the one thing the reader already
  // knows. Give it the prelude instead: the actual reason to open.
  const preheader = esc(
    String(prelude || quote || `${book.title} — ${label}`).replace(/\s+/g, " ").trim().slice(0, 115)
  );

  return `<!DOCTYPE html><html lang="${cjk ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(book.title)} — ${esc(label)}</title>
</head>
<body style="margin:0;padding:0;background:#FAF6F0;font-family:${SANS}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${preheader}</div>
<div style="display:none;max-height:0;overflow:hidden">&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;</div>
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8E2DA">
<div style="padding:22px;border-bottom:1px solid #E8E2DA;text-align:center">
  <p style="font-size:11px;letter-spacing:4px;color:#8A7E73;margin:0;text-transform:uppercase">T H E &ensp; C H A P T E R</p>
</div>
<div style="padding:34px 28px;text-align:center">
  ${readingLine}
  <h1 style="font-family:${SERIF};font-size:26px;color:#1A1612;margin:0 0 6px">${esc(book.title)}</h1>
  <p style="font-size:14px;color:#8A7E73;margin:0 0 4px;font-style:italic">by ${esc(book.author)}</p>
  <p style="font-size:13px;color:#8A7E73;margin:14px 0 0">${statsSegments(book, chapters, mins, pct, cjk).map(esc).join(" &nbsp;·&nbsp; ")}</p>
  <div style="max-width:240px;margin:12px auto 0;background:#EDE7DD;border-radius:3px;height:5px"><div style="width:${pct}%;height:5px;background:#B8964E;border-radius:3px"></div></div>
  ${preludeBlock}
  <div style="text-align:left;margin:26px 0 0">${chapterBody}</div>
  ${quoteBlock}
  ${questionsBlock}
  <div style="margin:34px 0 0;padding-top:24px;border-top:1px solid #E8E2DA">
    <a href="${readUrl}" style="display:inline-block;background:#6B1D2A;color:#FAF6F0;text-decoration:none;padding:12px 30px;border-radius:6px;font-size:14px">${T(cjk, "Open in the app")} →</a>
    <p style="font-size:12px;color:#B0A79A;margin:14px 0 0">${T(cjk, "Track your progress, adjust your schedule, or join the discussion.")}</p>
  </div>
</div>
<div style="padding:18px 24px;border-top:1px solid #E8E2DA;text-align:center;background:#FAF6F0">
  <p style="font-size:11px;color:#8A7E73;margin:0 0 6px">${T(cjk, "Sent by The Chapter · Classic literature, chapter by chapter")}</p>
  <p style="font-size:11px;color:#8A7E73;margin:0">
    <a href="${manageUrl}" style="color:#8A7E73;text-decoration:underline">${T(cjk, "Manage subscriptions")}</a>
    &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#8A7E73;text-decoration:underline">${T(cjk, "Unsubscribe")}</a>
  </p>
</div>
</div></body></html>`;
}

export function buildEmailText(book, chapters, { origin, token, readingTitle, participants, questions, quote }) {
  const { readUrl, unsubUrl } = links(book, chapters, { origin, token });
  const cjk = isCJK(chapters);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;
  let out = readingTitle
    ? `${readingTitle}${participants > 1 ? ` · ${participants} ${T(cjk, "readers")}` : ""}\n\n`
    : `${T(cjk, "Your chapter is ready")}\n\n`;
  const pct = Math.min(100, Math.round((chapters[chapters.length - 1].chNum / Math.max(1, book.chapters)) * 100));
  out += (cjk ? `${book.title}　${book.author}\n` : `${book.title} by ${book.author}\n`)
    + statsSegments(book, chapters, mins, pct, cjk).join(" · ") + "\n";
  if (prelude) out += `\n${T(cjk, "A prelude to set the scene")}:\n${prelude}\n`;
  out += `\n${"─".repeat(40)}\n\n`;
  out += chapters.map(ch => (chapters.length > 1 ? (cjk ? `第 ${ch.chNum} 章\n\n` : `Chapter ${ch.chNum}\n\n`) : "") + String(ch.text || "").trim()).join(`\n\n${"─".repeat(40)}\n\n`);
  if (quote) out += `\n\n${T(cjk, "Today's line")}:\n"${quote}"\n${cjk ? "分享" : "Share it"}: ${origin}/share?b=${encodeURIComponent(book.id)}&c=${chapters[0].chNum}\n`;
  if (questions && questions.length) out += `\n\n${T(cjk, "To discuss as you read")}:\n${questions.map(q => `· ${q}`).join("\n")}\n`;
  out += `\n\n${"─".repeat(40)}\n${cjk ? "在应用中继续阅读" : "Continue in the app"}: ${readUrl}\n${T(cjk, "Unsubscribe")}: ${unsubUrl}`;
  return out;
}

// ─── Email threading ───────────────────────────────────────────
// Every chapter for a given subscription replies into one thread, so a reader
// gets ONE conversation per book instead of 61 separate emails. Message-IDs are
// derived from (book, token, chapter) rather than stored, so they can never
// drift out of sync: chapter N always references chapter N-1 and the root.
// Requires the subscription token; without one we simply don't thread.
export function threadHeaders({ bookId, token, chNum, fromEmail }) {
  if (!token || !chNum) return null;
  const domain = (String(fromEmail || "").match(/@([^>\s]+)/) || [])[1] || "thechapter.app";
  const id = (n) => `<the-chapter.${bookId}.${token}.${n}@${domain}>`;
  const headers = { "Message-ID": id(chNum) };
  if (chNum > 1) {
    const root = id(1), prev = id(chNum - 1);
    headers["In-Reply-To"] = prev;
    headers["References"] = root === prev ? root : `${root} ${prev}`;
  }
  return headers;
}

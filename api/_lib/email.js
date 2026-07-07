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

function readMinutes(chapters) {
  const words = chapters.reduce((n, ch) => n + (ch.text ? ch.text.split(/\s+/).length : 0), 0);
  return Math.max(1, Math.round(words / 220));
}

export function chapterLabel(chapters) {
  return chapters.length === 1
    ? `Chapter ${chapters[0].chNum}`
    : `Chapters ${chapters[0].chNum}–${chapters[chapters.length - 1].chNum}`;
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

export function buildEmailHTML(book, chapters, { origin, token, readingTitle, participants, questions }) {
  const { readUrl, manageUrl, unsubUrl } = links(book, chapters, { origin, token });
  const label = chapterLabel(chapters);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;

  const readingLine = readingTitle
    ? `<p style="font-size:12px;color:#B8964E;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px">${esc(readingTitle)}${participants > 1 ? ` &nbsp;·&nbsp; ${participants.toLocaleString()} readers` : ""}</p>`
    : `<p style="font-size:12px;color:#B8964E;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px">Your chapter is ready</p>`;

  const questionsBlock = (questions && questions.length) ? `
  <div style="text-align:left;background:#FAF6F0;border:1px solid #E8E2DA;border-radius:6px;padding:16px 20px;margin:24px 0 0">
    <p style="font-size:10px;color:#8A7E73;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 10px;font-family:Helvetica,sans-serif">To discuss as you read</p>
    ${questions.map(q => `<p style="font-family:Georgia,serif;font-size:14px;line-height:1.6;color:#2C2419;margin:0 0 8px">· ${esc(q)}</p>`).join("")}
    <p style="font-size:11px;color:#B0A79A;margin:8px 0 0;font-family:Helvetica,sans-serif">Share your thoughts in the chapter discussion in the app.</p>
  </div>` : "";

  const preludeBlock = prelude ? `
  <div style="background:#FBF5EC;border-left:3px solid #B8964E;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0;text-align:left">
    <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-family:Helvetica,sans-serif">A prelude to set the scene</p>
    <p style="font-family:Georgia,serif;font-size:15.5px;line-height:1.7;color:#2C2419;margin:0;font-style:italic">${esc(prelude)}</p>
  </div>` : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF6F0;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8E2DA">
<div style="padding:22px;border-bottom:1px solid #E8E2DA;text-align:center">
  <p style="font-size:11px;letter-spacing:4px;color:#8A7E73;margin:0;text-transform:uppercase">T H E &ensp; C H A P T E R</p>
</div>
<div style="padding:34px 28px;text-align:center">
  ${readingLine}
  <h1 style="font-family:Georgia,serif;font-size:26px;color:#1A1612;margin:0 0 6px">${esc(book.title)}</h1>
  <p style="font-size:14px;color:#8A7E73;margin:0 0 4px;font-style:italic">by ${esc(book.author)}</p>
  <p style="font-size:13px;color:#8A7E73;margin:14px 0 0">${esc(label)} of ${esc(book.chapters)} &nbsp;·&nbsp; about ${mins} min</p>
  ${preludeBlock}
  <a href="${readUrl}" style="display:inline-block;background:#6B1D2A;color:#FAF6F0;text-decoration:none;padding:14px 34px;border-radius:6px;font-size:15px;margin-top:8px">Read ${esc(label)} →</a>
  <p style="font-size:12px;color:#B0A79A;margin:16px 0 0">Opens in your Chapter app — no scrolling through email.</p>
  ${questionsBlock}
</div>
<div style="padding:18px 24px;border-top:1px solid #E8E2DA;text-align:center;background:#FAF6F0">
  <p style="font-size:11px;color:#8A7E73;margin:0 0 6px">Sent by The Chapter · Classic literature, chapter by chapter</p>
  <p style="font-size:11px;color:#8A7E73;margin:0">
    <a href="${manageUrl}" style="color:#8A7E73;text-decoration:underline">Manage subscriptions</a>
    &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#8A7E73;text-decoration:underline">Unsubscribe</a>
  </p>
</div>
</div></body></html>`;
}

export function buildEmailText(book, chapters, { origin, token, readingTitle, participants, questions }) {
  const { readUrl, unsubUrl } = links(book, chapters, { origin, token });
  const label = chapterLabel(chapters);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;
  let out = readingTitle
    ? `${readingTitle}${participants > 1 ? ` · ${participants} readers` : ""}\n\n`
    : `Your chapter is ready\n\n`;
  out += `${book.title} — by ${book.author}\n${label} of ${book.chapters} · about ${mins} min\n`;
  if (prelude) out += `\nA prelude to set the scene:\n${prelude}\n`;
  if (questions && questions.length) out += `\nTo discuss as you read:\n${questions.map(q => `· ${q}`).join("\n")}\n`;
  out += `\nRead now: ${readUrl}\n\n${"─".repeat(40)}\nUnsubscribe: ${unsubUrl}`;
  return out;
}

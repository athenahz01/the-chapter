// Server-side email builder — used by /api/cron for scheduled deliveries.
// Mirrors the frontend's buildEmailHTML (App.jsx) with one upgrade: the
// unsubscribe link carries the subscription's token, so it works from any
// device with one click (GET /api/unsubscribe?token=...).

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildEmailHTML(book, chapters, { origin, token }) {
  const manageUrl = `${origin}/app`;
  const unsubUrl = token
    ? `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`
    : `${origin}/app#unsubscribe`;

  const chBlocks = chapters.map(ch => {
    const pre = ch.prelude ? `<div style="background:#FBF5EC;border-left:3px solid #B8964E;padding:14px 18px;margin:20px 0;border-radius:0 6px 6px 0">
      <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-family:Helvetica,sans-serif">Chapter Prelude</p>
      <p style="font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#2C2419;margin:0;white-space:pre-wrap">${esc(ch.prelude)}</p>
    </div>` : "";
    const aiNote = ch.src === "AI reconstruction" ? `<p style="font-size:11px;color:#8A5C24;background:#FBF3E4;border-radius:4px;padding:8px 12px;margin:0 0 14px;font-family:Helvetica,sans-serif">⚠ We couldn't retrieve this chapter from our text archives, so this version was reconstructed by AI and may differ from the original. We're working on sourcing the authentic text.</p>` : "";
    const paras = ch.text.split(/\n\n+/).filter(p => p.trim()).map((p, i) =>
      `<p style="font-family:Georgia,serif;font-size:16px;line-height:1.85;color:#2C2419;margin:0 0 1.1em;${i > 0 ? "text-indent:1.5em" : ""}">${esc(p.trim())}</p>`
    ).join("\n");
    return `<h2 style="font-family:Georgia,serif;font-size:19px;color:#6B1D2A;margin:28px 0 8px">Chapter ${esc(ch.chNum)} <span style="font-size:13px;color:#8A7E73;font-weight:400">of ${esc(book.chapters)}</span></h2>${aiNote}${pre}${paras}`;
  }).join('<hr style="border:none;border-top:1px solid #DDD5CA;margin:36px 0">');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF6F0;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E8E2DA">
<div style="padding:24px;border-bottom:1px solid #E8E2DA;text-align:center">
  <p style="font-size:11px;letter-spacing:4px;color:#8A7E73;margin:0 0 4px;text-transform:uppercase">T H E &ensp; C H A P T E R</p>
</div>
<div style="padding:24px;border-bottom:1px solid #E8E2DA;text-align:center">
  <h1 style="font-family:Georgia,serif;font-size:24px;color:#1A1612;margin:0 0 4px">${esc(book.title)}</h1>
  <p style="font-size:14px;color:#8A7E73;margin:0;font-style:italic">by ${esc(book.author)}</p>
</div>
<div style="padding:28px 24px">${chBlocks}</div>
<div style="padding:20px 24px;border-top:1px solid #E8E2DA;text-align:center;background:#FAF6F0">
  <p style="font-size:11px;color:#8A7E73;margin:0 0 6px">Sent by The Chapter · Classic literature, chapter by chapter</p>
  <p style="font-size:11px;color:#8A7E73;margin:0">
    <a href="${manageUrl}" style="color:#8A7E73;text-decoration:underline">Manage subscriptions</a>
    &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#8A7E73;text-decoration:underline">Unsubscribe</a>
  </p>
</div>
</div></body></html>`;
}

export function buildEmailText(book, chapters, { origin, token }) {
  const div = "─".repeat(40);
  const body = chapters.map(ch => {
    const ai = ch.src === "AI reconstruction" ? "[Note: AI-reconstructed text — may differ from the original]\n\n" : "";
    const pre = ch.prelude ? `\n✦ Prelude\n${div}\n${ch.prelude}\n${div}\n\n` : "";
    return `Chapter ${ch.chNum} of ${book.chapters}\n${div}\n${ai}${pre}${ch.text}`;
  }).join(`\n\n${"═".repeat(40)}\n\n`);
  const unsub = token
    ? `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`
    : `${origin}/app#unsubscribe`;
  return `${body}\n\n${div}\nUnsubscribe: ${unsub}`;
}

export function chapterLabel(chapters) {
  return chapters.length === 1
    ? `Chapter ${chapters[0].chNum}`
    : `Chapters ${chapters[0].chNum}–${chapters[chapters.length - 1].chNum}`;
}

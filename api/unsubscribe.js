// Vercel Serverless Function — one-click unsubscribe.
//
// Every scheduled email carries a link to this endpoint with the
// subscription's token, so unsubscribing works from ANY device in one click —
// no login, no localStorage dependency. This also backs the
// List-Unsubscribe-Post header (Gmail/Yahoo one-click), which arrives as a
// POST with no body beyond the query token.
//
//   GET  /api/unsubscribe?token=...            → pause deliveries, show page
//   GET  /api/unsubscribe?token=...&remove=1   → delete the subscription
//   POST /api/unsubscribe?token=...            → pause (one-click header path)
//
// Pausing (rather than deleting) is the default: it stops all email
// immediately but lets the reader resume without losing their place.

import { hasDb, getSubByToken, patchSubByToken, deleteSubByToken } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";

function page(title, message, extra = "") {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — The Chapter</title>
<style>
  body{margin:0;background:#FAF6F0;color:#1A1612;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:440px;background:#fff;border:1px solid #DDD5CA;border-radius:10px;padding:36px 32px;text-align:center}
  .brand{font-size:11px;letter-spacing:4px;color:#8A7E73;text-transform:uppercase;margin:0 0 18px;font-family:Helvetica,sans-serif}
  h1{font-size:24px;margin:0 0 10px}
  p{font-size:15px;line-height:1.6;color:#5A5248;margin:0 0 8px}
  a.btn{display:inline-block;margin-top:16px;background:#6B1D2A;color:#FAF6F0;text-decoration:none;padding:10px 22px;border-radius:6px;font-family:Helvetica,sans-serif;font-size:13px}
  a.link{color:#8A7E73;font-family:Helvetica,sans-serif;font-size:12px}
</style></head><body><div class="card">
  <p class="brand">T H E &nbsp; C H A P T E R</p>
  <h1>${title}</h1>
  ${message}
  ${extra}
</div></body></html>`;
}

export default async function handler(req, res) {
  const token = req.query?.token;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!hasDb()) {
    return res.status(200).send(page(
      "Almost there",
      `<p>Delivery management isn't set up on the server yet.</p>
       <p>Open the app on the device where you subscribed to pause or remove books, or reply to any chapter email and we'll remove you manually.</p>`,
      `<a class="btn" href="/app#unsubscribe">Open the app</a>`
    ));
  }

  if (!token) {
    return res.status(400).send(page("Missing link", `<p>This unsubscribe link is incomplete. Please use the link at the bottom of any chapter email.</p>`));
  }

  try {
    const sub = await getSubByToken(token);
    if (!sub) {
      return res.status(200).send(page(
        "Already unsubscribed",
        `<p>This subscription no longer exists — you won't receive any more chapters from it.</p>`,
        `<a class="link" href="/">← The Chapter</a>`
      ));
    }
    const book = byId(sub.book_id);
    const title = book ? book.title : "this book";

    if (req.query?.remove === "1") {
      await deleteSubByToken(token);
      return res.status(200).send(page(
        "Unsubscribed",
        `<p>Your subscription to <em>${title}</em> has been removed. No more emails.</p>
         <p>Changed your mind? You can always start again from chapter one.</p>`,
        `<a class="btn" href="/app">Browse the library</a>`
      ));
    }

    // Default (GET or one-click POST): pause.
    await patchSubByToken(token, { paused: true });
    return res.status(200).send(page(
      "Deliveries paused",
      `<p>You won't receive any more chapters of <em>${title}</em>.</p>
       <p>Your place is saved at chapter ${sub.current_chapter} — resume anytime from the app.</p>`,
      `<p><a class="link" href="/api/unsubscribe?token=${encodeURIComponent(token)}&remove=1">Remove this subscription entirely</a></p>
       <a class="btn" href="/app">Open the app</a>`
    ));
  } catch (err) {
    console.error("Unsubscribe error:", err);
    return res.status(500).send(page("Something went wrong", `<p>Please try the link again, or reply to any chapter email and we'll handle it manually.</p>`));
  }
}

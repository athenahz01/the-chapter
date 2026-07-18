// Vercel Serverless Function — the reader's control panel, reachable from email.
//
// Cole's list ("pause delivery / change cadence / read ahead / skip") mostly
// already existed in the database — `paused` and `schedule_days` have been
// there all along, and the cron already honours both. What was missing was a
// surface: the only way to reach any of it was the app, on the device you
// happened to subscribe from. Every chapter email now links here, and the
// subscription token is the identity — no login, works on any device.
//
//   GET /api/manage?token=…                      → the panel
//   GET /api/manage?token=…&do=pause             → pause, then panel
//   GET /api/manage?token=…&do=resume            → resume, then panel
//   GET /api/manage?token=…&do=cadence&v=daily   → set delivery days, then panel
//
// On mutating via GET: mail clients and safe-browsing scanners do fetch links,
// so a GET that changes state can fire without a human. Every action here is
// reversible in one tap from this same page, and /api/unsubscribe has always
// worked this way (its one-click path pauses on GET). Anything destructive —
// removing a subscription — stays behind /api/unsubscribe?remove=1 and its own
// confirmation, and is deliberately not offered here.

import { hasDb, getSubByToken, patchSubByToken } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";

// Cadence presets. Cole asked for daily / weekdays / weekends; "weekly" is kept
// because it's the current default and the pace most readers actually finish at.
const CADENCE = {
  daily:    { days: [0, 1, 2, 3, 4, 5, 6], en: "Every day",        zh: "每天" },
  weekdays: { days: [1, 2, 3, 4, 5],       en: "Weekdays",         zh: "工作日" },
  weekends: { days: [0, 6],                en: "Weekends only",    zh: "仅周末" },
  weekly:   { days: [1],                   en: "Once a week",      zh: "每周一次" },
};

const sameDays = (a, b) => {
  const x = [...(a || [])].sort().join(","), y = [...(b || [])].sort().join(",");
  return x === y;
};
const cadenceKey = (days) =>
  Object.keys(CADENCE).find((k) => sameDays(CADENCE[k].days, days)) || null;

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The book decides the language, matching how the emails now choose theirs.
const isZh = (book) => /[一-鿿]/.test(String(book?.title || ""));
const T = (zh, en, cn) => (zh ? cn : en);

function shell(title, inner, zh) {
  return `<!DOCTYPE html><html lang="${zh ? "zh-CN" : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — The Chapter</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#FAF6F0;color:#1A1612;font-family:Georgia,'Songti SC','Noto Serif CJK SC',serif;
    display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px}
  .card{max-width:460px;width:100%;background:#fff;border:1px solid #DDD5CA;border-radius:10px;padding:32px 28px}
  .brand{font-size:11px;letter-spacing:4px;color:#8A7E73;text-transform:uppercase;margin:0 0 20px;
    font-family:Helvetica,Arial,sans-serif;text-align:center}
  h1{font-size:22px;margin:0 0 4px;line-height:1.2}
  .sub{font-size:13px;color:#8A7E73;font-style:italic;margin:0 0 18px}
  .note{background:#FBF5EC;border-left:3px solid #B8964E;padding:10px 14px;border-radius:0 6px 6px 0;
    font-size:13px;color:#5A5248;margin:0 0 18px;font-family:Helvetica,Arial,sans-serif}
  .lab{font-size:10px;letter-spacing:1.8px;text-transform:uppercase;color:#8A7E73;
    font-family:Helvetica,Arial,sans-serif;margin:22px 0 8px}
  .row{display:flex;gap:6px;flex-wrap:wrap}
  a.opt{flex:1 1 auto;text-align:center;min-width:96px;padding:10px 8px;border:1.5px solid #DDD5CA;border-radius:6px;
    text-decoration:none;color:#5A5248;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;
    transition:border-color .2s,color .2s,transform .12s}
  a.opt:hover{border-color:#6B1D2A;color:#6B1D2A}
  a.opt:active{transform:translateY(1px) scale(.985)}
  a.opt.on{background:#6B1D2A;border-color:#6B1D2A;color:#FAF6F0}
  a.btn{display:block;text-align:center;margin-top:20px;background:#6B1D2A;color:#FAF6F0;text-decoration:none;
    padding:12px;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;
    transition:background .2s,transform .12s}
  a.btn:hover{background:#8B2E3D}
  a.btn:active{transform:translateY(1px) scale(.99)}
  a.btn.ghost{background:none;border:1.5px solid #DDD5CA;color:#5A5248}
  a.btn.ghost:hover{border-color:#6B1D2A;color:#6B1D2A}
  .fine{font-size:11px;color:#8A7E73;text-align:center;margin-top:18px;font-family:Helvetica,Arial,sans-serif}
  .fine a{color:#8A7E73}
  a:focus-visible{outline:2px solid #6B1D2A;outline-offset:3px;border-radius:6px}
  @media (prefers-reduced-motion: reduce){*{transition-duration:.01ms !important}}
</style></head><body><div class="card">
  <p class="brand">T H E &nbsp; C H A P T E R</p>
  ${inner}
</div></body></html>`;
}

function simple(title, msg, zh = false) {
  return shell(title, `<h1>${esc(title)}</h1><p class="sub">${msg}</p>
    <a class="btn ghost" href="/app">${T(zh, "Open the app", "打开应用")}</a>`, zh);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Never let a proxy cache one reader's control panel and hand it to another.
  res.setHeader("Cache-Control", "private, no-store");

  const token = req.query?.token;
  if (!hasDb()) return res.status(200).send(simple("Not available yet",
    "Delivery settings aren't set up on the server yet. Open the app to manage your books."));
  if (!token) return res.status(400).send(simple("Missing link",
    "This link is incomplete. Please use the links at the bottom of any chapter email."));

  try {
    let sub = await getSubByToken(token);
    if (!sub) return res.status(200).send(simple("Subscription not found",
      "This subscription no longer exists. You won't receive any more chapters from it."));

    const book = byId(sub.book_id);
    const zh = isZh(book);
    const act = String(req.query?.do || "");
    let note = "";

    if (act === "pause" && !sub.paused) {
      sub = (await patchSubByToken(token, { paused: true })) || sub;
      note = T(zh, "Deliveries paused. Your place is saved.", "已暂停投递。你的进度已保存。");
    } else if (act === "resume" && sub.paused) {
      sub = (await patchSubByToken(token, { paused: false })) || sub;
      note = T(zh, "Deliveries resumed — your next chapter arrives on schedule.",
                   "已恢复投递 — 下一章将按计划送达。");
    } else if (act === "cadence") {
      const c = CADENCE[String(req.query?.v || "")];
      if (c) {
        sub = (await patchSubByToken(token, { scheduleDays: c.days })) || sub;
        note = T(zh, `Cadence changed to: ${c.en.toLowerCase()}.`, `投递节奏已改为：${c.zh}。`);
      }
    }

    const title = book ? book.title : sub.book_id;
    const total = book?.chapters || 0;
    const cur = sub.current_chapter || 0;
    const pct = total ? Math.min(100, Math.round((cur / total) * 100)) : 0;
    const curKey = cadenceKey(sub.schedule_days);
    const link = (q) => `/api/manage?token=${encodeURIComponent(token)}&${q}`;

    const progress = zh
      ? `${esc(book?.author || "")}　·　已读第 ${cur} 章（共 ${total} 章）· ${pct}%`
      : `${esc(book?.author || "")} &nbsp;·&nbsp; chapter ${cur} of ${total} &nbsp;·&nbsp; ${pct}% read`;

    const inner = `
      <h1>${esc(title)}</h1>
      <p class="sub">${progress}</p>
      ${note ? `<p class="note">${esc(note)}</p>` : ""}

      <p class="lab">${T(zh, "Delivery", "投递")}</p>
      <div class="row">
        <a class="opt ${sub.paused ? "" : "on"}" href="${link("do=resume")}">${T(zh, "Active", "进行中")}</a>
        <a class="opt ${sub.paused ? "on" : ""}" href="${link("do=pause")}">${T(zh, "Paused", "已暂停")}</a>
      </div>

      <p class="lab">${T(zh, "How often", "投递频率")}</p>
      <div class="row">
        ${Object.entries(CADENCE).map(([k, c]) =>
          `<a class="opt ${curKey === k ? "on" : ""}" href="${link(`do=cadence&v=${k}`)}">${T(zh, c.en, c.zh)}</a>`
        ).join("")}
      </div>

      <a class="btn" href="/app?book=${encodeURIComponent(sub.book_id)}">${T(zh, "Open in the app", "在应用中打开")}</a>
      <p class="fine">
        <a href="/api/unsubscribe?token=${encodeURIComponent(token)}&remove=1">${T(zh, "Remove this subscription entirely", "彻底取消该订阅")}</a>
      </p>`;

    return res.status(200).send(shell(title, inner, zh));
  } catch (err) {
    console.error("Manage error:", err);
    return res.status(500).send(simple("Something went wrong",
      "Please try the link again, or reply to any chapter email and we'll sort it out."));
  }
}

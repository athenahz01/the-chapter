// Vercel Cron — the scheduled delivery engine.
//
// Runs once daily (see "crons" in vercel.json). For every subscription due
// today it fetches the next chapter(s) — Project Gutenberg first, Claude
// reconstruction as a labeled last resort — writes an AI prelude, sends the
// email through Resend, and advances the progress pointer. This replaces the
// old in-browser setInterval, which only worked while someone had a tab open.
//
// Requirements: DATABASE_URL, RESEND_API_KEY. Optional: ANTHROPIC_API_KEY
// (preludes + text fallback), CRON_SECRET (Vercel passes it as a Bearer
// token; if set, requests without it are rejected).
//
// Safe to re-run: last_delivery_date guards against double-sends within a
// day, and each subscription is updated only after its email succeeds.

import { hasDb, query } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";
import { getChapter } from "./_lib/gutenberg.js";
import { getPrelude, getChapterFallback, sendEmailDirect } from "./_lib/services.js";
import { buildEmailHTML, buildEmailText, chapterLabel } from "./_lib/email.js";

const FREE_CHAPTERS = 3; // keep in sync with App.jsx
const TIME_BUDGET_MS = 50_000; // stay under the 60s function ceiling
const BATCH_LIMIT = 200; // rows fetched per run; time budget is the real cap

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when the env var is set. If it's set, enforce it.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!hasDb()) {
    return res.status(200).json({ ok: false, reason: "no-db", note: "Set DATABASE_URL to enable scheduled delivery." });
  }

  const started = Date.now();
  const now = new Date();
  const dow = now.getUTCDay(); // cron runs mid-day UTC ≈ US morning, same calendar day
  const today = now.toISOString().slice(0, 10);
  const origin = process.env.PUBLIC_ORIGIN
    || (req.headers.host ? `https://${req.headers.host}` : "https://the-chapter-one.vercel.app");

  const summary = { checked: 0, sent: 0, skipped: 0, failed: 0, outOfBudget: false, details: [] };

  try {
    // Everything due today, with the account-level plan joined in.
    const { rows } = await query(
      `SELECT s.*, COALESCE(u.plan, 'free') AS account_plan
         FROM subscriptions s
         LEFT JOIN user_plans u ON u.email = s.email
        WHERE s.paused = FALSE
          AND $1 = ANY(s.schedule_days)
          AND (s.last_delivery_date IS NULL OR s.last_delivery_date < $2)
        ORDER BY s.last_delivery_date ASC NULLS FIRST
        LIMIT $3`,
      [dow, today, BATCH_LIMIT]
    );

    for (const sub of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) { summary.outOfBudget = true; break; }
      summary.checked++;

      const book = byId(sub.book_id);
      if (!book) { summary.skipped++; continue; }

      const premium = ["monthly", "annual"].includes(sub.account_plan)
        || ["alacarte", "paid"].includes(sub.plan);
      const maxCh = premium ? book.chapters : FREE_CHAPTERS;
      if (sub.current_chapter >= Math.min(maxCh, book.chapters)) { summary.skipped++; continue; }

      // Which chapters go out today?
      const chNums = [];
      for (let c = 1; c <= (sub.chapters_per_delivery || 1); c++) {
        const ch = sub.current_chapter + c;
        if (ch > book.chapters || ch > maxCh) break;
        chNums.push(ch);
      }
      if (!chNums.length) { summary.skipped++; continue; }

      // Fetch texts — Gutenberg (real) first, Claude (labeled) as last resort.
      const chapters = [];
      for (const chNum of chNums) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const g = await getChapter({ gid: book.gid, q: book.gq || `${book.title} ${book.author}`, ch: chNum });
        if (g.ok) {
          chapters.push({ chNum, text: g.text, src: "Project Gutenberg", prelude: null });
          continue;
        }
        const t = await getChapterFallback(book.title, book.author, chNum);
        if (t) chapters.push({ chNum, text: t, src: "AI reconstruction", prelude: null });
      }
      if (!chapters.length) {
        summary.failed++;
        summary.details.push({ book: sub.book_id, email: sub.email, error: "text-fetch-failed" });
        continue;
      }

      // Preludes: best-effort, never block the send.
      for (const ch of chapters) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        ch.prelude = await getPrelude(book.title, ch.chNum, ch.text.slice(0, 1200)).catch(() => null);
      }

      const recipients = [sub.email, ...(sub.friends || [])].filter(Boolean);
      const unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(sub.token)}`;
      const result = await sendEmailDirect({
        to: recipients,
        subject: `📖 ${book.title} — ${chapterLabel(chapters)}`,
        html: buildEmailHTML(book, chapters, { origin, token: sub.token }),
        text: buildEmailText(book, chapters, { origin, token: sub.token }),
        unsubscribeUrl,
      });

      if (result.ok) {
        await query(
          `UPDATE subscriptions SET current_chapter = $1, last_delivery_date = $2 WHERE id = $3`,
          [sub.current_chapter + chapters.length, today, sub.id]
        );
        summary.sent++;
      } else {
        summary.failed++;
        summary.details.push({ book: sub.book_id, email: sub.email, error: result.error });
      }
    }

    console.log("Cron summary:", JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("Cron error:", err);
    return res.status(500).json({ ok: false, error: err.message, ...summary });
  }
}

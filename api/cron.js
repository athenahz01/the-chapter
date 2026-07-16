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

import { hasDb, query, getExtras, setExtras, setPrelude, setQuote } from "./_lib/db.js";
import { byId } from "./_lib/catalog.js";
import { getChapter } from "./_lib/gutenberg.js";
import { getPrelude, getChapterFallback, getDiscussionQuestions, getQuote, sendEmailDirect } from "./_lib/services.js";
import { buildEmailHTML, buildEmailText, chapterLabel, threadHeaders } from "./_lib/email.js";

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
    // Everything due today, with the account plan and reading joined in.
    const { rows } = await query(
      `SELECT s.*, COALESCE(u.plan, 'free') AS account_plan,
              r.is_public AS reading_public, r.title AS reading_title
         FROM subscriptions s
         LEFT JOIN user_plans u ON u.email = s.email
         LEFT JOIN readings r ON r.id = s.reading_id
        WHERE s.paused = FALSE
          AND $1 = ANY(s.schedule_days)
          AND (s.last_delivery_date IS NULL OR s.last_delivery_date < $2)
        ORDER BY s.last_delivery_date ASC NULLS FIRST
        LIMIT $3`,
      [dow, today, BATCH_LIMIT]
    );

    // Hour-of-day preferences only apply when the cron runs hourly
    // (Vercel Pro: schedule "0 * * * *" + CRON_HOURLY=1). On the default
    // daily cron every due subscription delivers regardless of preference,
    // so nobody is silently skipped forever.
    const hourly = process.env.CRON_HOURLY === "1";
    const curHour = now.getUTCHours();

    // Participant counts per reading, computed once per run.
    const participantCache = new Map();
    const countFor = async (rid) => {
      if (!participantCache.has(rid)) {
        const r = await query(`SELECT COUNT(*)::int AS n FROM subscriptions WHERE reading_id=$1 AND paused=FALSE`, [rid]);
        participantCache.set(rid, r.rows[0]?.n || 0);
      }
      return participantCache.get(rid);
    };

    for (const sub of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) { summary.outOfBudget = true; break; }
      summary.checked++;

      const book = byId(sub.book_id);
      if (!book) { summary.skipped++; continue; }

      if (hourly && Number.isInteger(sub.delivery_hour) && sub.delivery_hour !== curHour) { continue; }

      // Public communal readings are the acquisition funnel: free all the
      // way through. Premium and per-book purchases unlock everything else.
      // Circle Host is a superset of The Library; "community" is a Big Read
      // cohort member, who reads the whole book free — the funnel is the point.
      const premium = ["monthly", "annual", "circle"].includes(sub.account_plan)
        || ["alacarte", "paid", "circle", "community"].includes(sub.plan)
        || (sub.reading_id && sub.reading_public === true);
      const maxCh = premium ? book.chapters : FREE_CHAPTERS;
      const cap = Math.min(maxCh, book.chapters);
      if (sub.current_chapter > cap) { summary.skipped++; continue; }
      const q = book.gq || `${book.title} ${book.author}`;

      // Walk the (chapter, part) pointer forward. Only chapters long enough to
      // be split have parts (~22min+); for everything else parts === 1 and this
      // behaves exactly as it did before. The probe is a cached read, not a
      // download, so asking "how many parts does this chapter have?" is cheap.
      const units = [];
      let curCh = sub.current_chapter || 0;
      let curPart = sub.current_part || 0;
      for (let i = 0; i < (sub.chapters_per_delivery || 1); i++) {
        let ch, part;
        if (curCh === 0) { ch = 1; part = 1; }
        else {
          const probe = await getChapter({ gid: book.gid, q, ch: curCh, part: 1 });
          const parts = (probe.ok && probe.parts) || 1;
          if (curPart < parts) { ch = curCh; part = curPart + 1; }   // finish this chapter first
          else { ch = curCh + 1; part = 1; }                          // move to the next
        }
        if (ch > cap || ch > book.chapters) break;
        units.push({ ch, part });
        curCh = ch; curPart = part;
      }
      if (!units.length) { summary.skipped++; continue; }

      // Fetch texts — Gutenberg (real) first, Claude (labeled) as last resort.
      const chapters = [];
      for (const u of units) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        const g = await getChapter({ gid: book.gid, q, ch: u.ch, part: u.part });
        if (g.ok) {
          chapters.push({ chNum: u.ch, part: g.part || 1, parts: g.parts || 1, text: g.text, src: "Project Gutenberg", prelude: null });
          continue;
        }
        const t = await getChapterFallback(book.title, book.author, u.ch);
        if (t) chapters.push({ chNum: u.ch, part: 1, parts: 1, text: t, src: "AI reconstruction", prelude: null });
      }
      if (!chapters.length) {
        summary.failed++;
        summary.details.push({ book: sub.book_id, email: sub.email, error: "text-fetch-failed" });
        continue;
      }

      // Preludes: best-effort, never block the send.
      for (const ch of chapters) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        // Cached per (book, chapter) — generated once for the whole cohort.
        let pre = null;
        try { pre = (await getExtras(book.id, ch.chNum))?.prelude || null; } catch {}
        if (!pre) {
          pre = await getPrelude(book.title, ch.chNum, ch.text.slice(0, 1200)).catch(() => null);
          if (pre) { try { await setPrelude(book.id, ch.chNum, pre); } catch {} }
        }
        ch.prelude = pre;
      }

      // Reading extras: cohort size + shared discussion questions (cached
      // per book+chapter so the whole cohort discusses the same ones).
      const extras = {};
      // Today's shareable line — cached per (book, chapter) like the prelude, so
      // the whole cohort gets the SAME line (that's what makes it "today's line")
      // and we generate it once rather than once per reader.
      try {
        let ql = (await getExtras(book.id, chapters[0].chNum))?.quote || null;
        if (!ql) {
          ql = await getQuote(book.title, chapters[0].chNum, chapters[0].text).catch(() => null);
          if (ql) { try { await setQuote(book.id, chapters[0].chNum, ql); } catch {} }
        }
        if (ql) extras.quote = ql;
      } catch { /* the line is a bonus, never a blocker */ }
      if (sub.reading_id) {
        extras.readingTitle = sub.reading_title;
        extras.participants = await countFor(sub.reading_id).catch(() => 0);
        if (sub.want_questions) {
          try {
            const hit = await getExtras(book.id, chapters[0].chNum);
            if (hit?.questions) {
              extras.questions = hit.questions.split("\n").filter(Boolean);
            } else {
              const raw = await getDiscussionQuestions(book.title, chapters[0].chNum, chapters[0].text.slice(0, 2500));
              if (raw) {
                extras.questions = raw.split("\n").map(q => q.replace(/^[\d.\-•)\s]+/, "").trim()).filter(q => q.length > 8).slice(0, 5);
                if (extras.questions.length) await setExtras(book.id, chapters[0].chNum, extras.questions.join("\n"));
              }
            }
          } catch { /* questions are enrichment, never a blocker */ }
        }
      }

      const recipients = [sub.email, ...(sub.friends || [])].filter(Boolean);
      const unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(sub.token)}`;
      const result = await sendEmailDirect({
        to: recipients,
        subject: `📖 Your chapter is ready — ${book.title}, ${chapterLabel(chapters)}`,
        html: buildEmailHTML(book, chapters, { origin, token: sub.token, ...extras }),
        text: buildEmailText(book, chapters, { origin, token: sub.token, ...extras }),
        unsubscribeUrl,
        // Reply into the same thread as this reader's previous chapters.
        threadHeaders: threadHeaders({
          bookId: book.id, token: sub.token, chNum: chapters[0].chNum,
          fromEmail: process.env.FROM_EMAIL,
        }),
      });

      if (result.ok) {
        // Advance to the last unit actually delivered (chapter AND part), so a
        // half-delivered long chapter resumes at the right place tomorrow.
        const last = chapters[chapters.length - 1];
        await query(
          `UPDATE subscriptions SET current_chapter = $1, current_part = $2, last_delivery_date = $3 WHERE id = $4`,
          [last.chNum, last.part || 1, today, sub.id]
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

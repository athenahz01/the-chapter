// Shared database layer for server-side subscriptions.
//
// Works with any Postgres connection string (Neon, Supabase, Vercel Postgres,
// Railway…) via the DATABASE_URL env var. The schema auto-creates on first
// use — no manual migration step. If DATABASE_URL is unset, every export
// signals "no database" and the frontend gracefully continues in its original
// local-only mode, so this layer is strictly additive.
//
// Tables:
//   subscriptions — one row per (email, book). Carries the delivery schedule,
//     progress pointer, and a random `token` used for manage/unsubscribe
//     links (so the links work from ANY device, not just the browser that
//     created the subscription).
//   user_plans — one row per email, tracks paid plan (set by Stripe verify).

import pg from "pg";

let pool = null;
let schemaReady = false;

export function hasDb() {
  return !!process.env.DATABASE_URL;
}

function getPool() {
  if (!hasDb()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1, // serverless: one connection per warm instance
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL not configured");
  if (!schemaReady) {
    await ensureSchema(p);
    schemaReady = true;
  }
  return p.query(text, params);
}

async function ensureSchema(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      friends TEXT[] NOT NULL DEFAULT '{}',
      book_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      schedule_days INT[] NOT NULL DEFAULT '{1}',
      chapters_per_delivery INT NOT NULL DEFAULT 1,
      current_chapter INT NOT NULL DEFAULT 0,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_delivery_date DATE,
      UNIQUE (email, book_id)
    );
    CREATE TABLE IF NOT EXISTS user_plans (
      email TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_ref TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_subs_due
      ON subscriptions (paused, last_delivery_date);

    -- ─── Communal readings (V1 spec) ───
    -- A reading is a cohort: everyone shares a book, a start date, and a
    -- delivery rhythm. Public readings ("The Great Moby-Dick Reading") are
    -- the acquisition funnel and are FREE past the trial cap; private
    -- readings are invite-code groups (families, classes, clubs).
    CREATE TABLE IF NOT EXISTS readings (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      blurb TEXT,
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      delivery_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      invite_code TEXT UNIQUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Per-chapter community discussion, scoped to a reading.
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      reading_id TEXT NOT NULL,
      chapter INT NOT NULL,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments (reading_id, chapter, created_at);
    -- Cached AI extras per book chapter (discussion questions). Cached so the
    -- whole cohort discusses the SAME questions — that's the communal point —
    -- and so we generate once, not once per reader.
    CREATE TABLE IF NOT EXISTS chapter_extras (
      book_id TEXT NOT NULL,
      chapter INT NOT NULL,
      questions TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (book_id, chapter)
    );
    -- Full parsed book text, cached after the first successful fetch from
    -- Project Gutenberg. gutenberg.org is slow for big books and throttles
    -- cloud IPs; once a book is here we never hit it again.
    CREATE TABLE IF NOT EXISTS book_cache (
      gid INT PRIMARY KEY,
      chapters JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Columns added after v1 shipped — safe to re-run.
  await p.query(`
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reading_id TEXT;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS want_questions BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS delivery_hour INT;
    -- Preludes cached per (book, chapter): one generation for the whole
    -- cohort instead of one Claude call per reader.
    ALTER TABLE chapter_extras ADD COLUMN IF NOT EXISTS prelude TEXT;
    -- The shareable line for each chapter (the quote-card artifact).
    ALTER TABLE chapter_extras ADD COLUMN IF NOT EXISTS quote TEXT;
    -- Bumping PARSER_VERSION in gutenberg.js invalidates every cached book,
    -- so a parser change (e.g. Traditional -> Simplified) can't serve stale text.
    ALTER TABLE book_cache ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
    -- Long chapters go out as "Part 1 of 2" across deliveries, so the progress
    -- pointer is (current_chapter, current_part) rather than a chapter alone.
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_part INT NOT NULL DEFAULT 0;
  `);
}

export function newToken() {
  // 24 bytes of randomness, URL-safe. crypto is global in Node 18+.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24)))
    .toString("base64url");
}

// ─── Subscription helpers ──────────────────────────────────────

export async function upsertSubscription(s) {
  const token = newToken();
  const r = await query(
    `INSERT INTO subscriptions
       (token, email, friends, book_id, plan, schedule_days, chapters_per_delivery, current_chapter, last_delivery_date, reading_id, want_questions, delivery_hour, current_part)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (email, book_id) DO UPDATE SET
       friends = EXCLUDED.friends,
       plan = EXCLUDED.plan,
       schedule_days = EXCLUDED.schedule_days,
       chapters_per_delivery = EXCLUDED.chapters_per_delivery,
       current_chapter = GREATEST(subscriptions.current_chapter, EXCLUDED.current_chapter),
       current_part = GREATEST(subscriptions.current_part, EXCLUDED.current_part),
       last_delivery_date = COALESCE(EXCLUDED.last_delivery_date, subscriptions.last_delivery_date),
       reading_id = COALESCE(EXCLUDED.reading_id, subscriptions.reading_id),
       want_questions = EXCLUDED.want_questions,
       delivery_hour = EXCLUDED.delivery_hour,
       paused = FALSE
     RETURNING token, current_chapter`,
    [
      token,
      s.email.toLowerCase().trim(),
      s.friends || [],
      s.bookId,
      s.plan || "free",
      s.scheduleDays || [1],
      s.chaptersPerDelivery || 1,
      s.currentChapter || 0,
      s.lastDeliveryDate ? new Date(s.lastDeliveryDate) : null,
      s.readingId || null,
      !!s.wantQuestions,
      Number.isInteger(s.deliveryHour) ? s.deliveryHour : null,
      Number.isInteger(s.currentPart) ? s.currentPart : 0,
    ]
  );
  return r.rows[0];
}

// ─── Readings (communal cohorts) ───────────────────────────────

export async function getReading(id) {
  const r = await query(`SELECT * FROM readings WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

export async function getReadingByCode(code) {
  const r = await query(`SELECT * FROM readings WHERE invite_code = $1`, [code]);
  return r.rows[0] || null;
}

export async function listPublicReadings() {
  const r = await query(
    `SELECT r.*, COUNT(s.id)::int AS participants
       FROM readings r
       LEFT JOIN subscriptions s ON s.reading_id = r.id AND s.paused = FALSE
      WHERE r.is_public = TRUE
      GROUP BY r.id
      ORDER BY r.start_date DESC`, []
  );
  return r.rows;
}

export async function participantCount(readingId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM subscriptions WHERE reading_id = $1 AND paused = FALSE`,
    [readingId]
  );
  return r.rows[0]?.n || 0;
}

export async function createReading(rd) {
  const inviteCode = rd.isPublic ? null : newToken().slice(0, 10);
  const id = rd.id || `${rd.bookId}-${newToken().slice(0, 6).toLowerCase()}`;
  const r = await query(
    `INSERT INTO readings (id, book_id, title, blurb, start_date, delivery_days, is_public, invite_code, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [id, rd.bookId, rd.title, rd.blurb || null, rd.startDate || new Date(),
     rd.deliveryDays || [1, 2, 3, 4, 5], rd.isPublic !== false, inviteCode, rd.createdBy || null]
  );
  return r.rows[0] || (await getReading(id));
}

// ─── Chapter extras (cached discussion questions) ──────────────

export async function getExtras(bookId, chapter) {
  const r = await query(`SELECT questions, prelude, quote FROM chapter_extras WHERE book_id=$1 AND chapter=$2`, [bookId, chapter]);
  return r.rows[0] || null;
}

export async function setExtras(bookId, chapter, questions) {
  await query(
    `INSERT INTO chapter_extras (book_id, chapter, questions) VALUES ($1,$2,$3)
     ON CONFLICT (book_id, chapter) DO UPDATE SET questions = EXCLUDED.questions`,
    [bookId, chapter, questions]
  );
}

export async function getSubByToken(token) {
  const r = await query(`SELECT * FROM subscriptions WHERE token = $1`, [token]);
  return r.rows[0] || null;
}

export async function patchSubByToken(token, fields) {
  const allowed = {
    email: "email",
    friends: "friends",
    scheduleDays: "schedule_days",
    chaptersPerDelivery: "chapters_per_delivery",
    paused: "paused",
    plan: "plan",
  };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (fields[k] !== undefined) {
      vals.push(fields[k]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (!sets.length) return null;
  vals.push(token);
  const r = await query(
    `UPDATE subscriptions SET ${sets.join(", ")} WHERE token = $${vals.length} RETURNING *`,
    vals
  );
  return r.rows[0] || null;
}

export async function deleteSubByToken(token) {
  const r = await query(`DELETE FROM subscriptions WHERE token = $1 RETURNING id`, [token]);
  return r.rowCount > 0;
}

export async function getUserPlan(email) {
  const r = await query(`SELECT plan FROM user_plans WHERE email = $1`, [email.toLowerCase().trim()]);
  return r.rows[0]?.plan || "free";
}

export async function setUserPlan(email, plan, stripeRef) {
  await query(
    `INSERT INTO user_plans (email, plan, stripe_ref, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (email) DO UPDATE SET plan=$2, stripe_ref=$3, updated_at=NOW()`,
    [email.toLowerCase().trim(), plan, stripeRef || null]
  );
}

// ─── Book text cache (parsed Gutenberg chapters) ───────────────

export async function getBookCache(gid, version = 1) {
  const r = await query(`SELECT chapters FROM book_cache WHERE gid = $1 AND version = $2`, [gid, version]);
  return r.rows[0]?.chapters || null; // node-pg returns JSONB already parsed
}

export async function setBookCache(gid, chapters, version = 1) {
  await query(
    `INSERT INTO book_cache (gid, chapters, version) VALUES ($1, $2, $3)
     ON CONFLICT (gid) DO UPDATE SET chapters = EXCLUDED.chapters, version = EXCLUDED.version, created_at = NOW()`,
    [gid, JSON.stringify(chapters), version]
  );
}

export async function setPrelude(bookId, chapter, prelude) {
  await query(
    `INSERT INTO chapter_extras (book_id, chapter, prelude) VALUES ($1,$2,$3)
     ON CONFLICT (book_id, chapter) DO UPDATE SET prelude = EXCLUDED.prelude`,
    [bookId, chapter, prelude]
  );
}

export async function setQuote(bookId, chapter, quote) {
  await query(
    `INSERT INTO chapter_extras (book_id, chapter, quote) VALUES ($1,$2,$3)
     ON CONFLICT (book_id, chapter) DO UPDATE SET quote = EXCLUDED.quote`,
    [bookId, chapter, quote]
  );
}

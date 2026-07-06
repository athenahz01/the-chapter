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
      schedule_days INT[] NOT NULL DEFAULT '{1,3,5}',
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
       (token, email, friends, book_id, plan, schedule_days, chapters_per_delivery, current_chapter, last_delivery_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (email, book_id) DO UPDATE SET
       friends = EXCLUDED.friends,
       plan = EXCLUDED.plan,
       schedule_days = EXCLUDED.schedule_days,
       chapters_per_delivery = EXCLUDED.chapters_per_delivery,
       current_chapter = GREATEST(subscriptions.current_chapter, EXCLUDED.current_chapter),
       last_delivery_date = COALESCE(EXCLUDED.last_delivery_date, subscriptions.last_delivery_date),
       paused = FALSE
     RETURNING token, current_chapter`,
    [
      token,
      s.email.toLowerCase().trim(),
      s.friends || [],
      s.bookId,
      s.plan || "free",
      s.scheduleDays || [1, 3, 5],
      s.chaptersPerDelivery || 1,
      s.currentChapter || 0,
      s.lastDeliveryDate ? new Date(s.lastDeliveryDate) : null,
    ]
  );
  return r.rows[0];
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

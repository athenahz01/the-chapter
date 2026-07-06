# The Chapter

Classic literature delivered to your inbox, chapter by chapter.

Vite + React app on Vercel, with a serverless backend: real chapter text from Project Gutenberg, server-side subscriptions in Postgres, a daily delivery cron, one-click unsubscribe, and Stripe checkout. Every backend feature degrades gracefully when its env var is unset, so a bare deploy still works.

## Project Structure

```
index.html          Landing page (served at /)
app.html            React app entry (served at /app)
src/App.jsx         Main React component — all app logic, book catalog, UI
src/main.jsx        React bootstrap
api/send.js         Serverless proxy → Resend (email delivery)
api/gutenberg.js    Serverless fetcher → Project Gutenberg (primary chapter text)
api/claude.js       Serverless proxy → Anthropic Claude API (preludes + last-resort text)
api/subscriptions.js  Server-side subscription records (create/update/delete)
api/cron.js         Daily scheduled delivery engine (Vercel Cron, 12:00 UTC)
api/unsubscribe.js  One-click token unsubscribe (works from any device)
api/checkout.js     Stripe Checkout create + verify (no SDK, no webhooks)
api/_lib/           Shared server code: db, catalog, gutenberg, email, services
public/og-image.jpg 1200×630 social preview image
vite.config.js      Vite multi-page build config
vercel.json         Vercel routing + function timeout config
.env.example        Documents all required environment variables
```

## Why three serverless functions?

Both Resend and Anthropic block direct browser calls — Resend via CORS, Anthropic both via CORS and because the `x-api-key` header must stay server-side. Those two `/api/*` functions forward requests with the key attached at request time.

`api/gutenberg.js` exists for a different reason: it's the **primary text source** for the ~60 books without a per-chapter Wikisource page. It resolves title+author → a Project Gutenberg ID via the Gutendex catalog API, downloads the real ebook text, strips the license boilerplate, splits it into chapters, and returns the requested one. Responses are CDN-cached for a week (public-domain text doesn't change), so repeat reads never re-hit Gutenberg. It requires **no API key**.

## Chapter text: source order

Every chapter fetch tries, in order:

1. **Local cache** (localStorage) — instant.
2. **Wikisource** — for books with a curated `wsPage` mapping.
3. **Project Gutenberg** (`/api/gutenberg`) — real text, covers essentially the whole catalog.
4. **Claude reconstruction** (`/api/claude`, mode `chapter`) — last resort only. A language model *cannot* faithfully reproduce a novel's text, so anything served from this path is visibly labeled "AI reconstruction" in the reader, the in-app email view, and the delivered email itself. Before the Gutenberg layer existed this fallback was serving invented text for most of the catalog — that is fixed.

## Deployment

1. Push to GitHub (the remote in the original guide is `github.com/whetstone1/the-chapter`).
2. Import the repo on [vercel.com/new](https://vercel.com/new) — Vercel auto-detects Vite.
3. Add the environment variables below under **Project → Settings → Environment Variables**.
4. Deploy.

Vercel will serve:
- `/` → landing page
- `/app` → React app
- `/api/send` → email proxy
- `/api/claude` → Claude API proxy

## Environment variables

See `.env.example` for the canonical list. The three required ones:

| Variable | What it is |
| --- | --- |
| `RESEND_API_KEY` | From [resend.com/api-keys](https://resend.com/api-keys). Starts with `re_`. |
| `FROM_EMAIL` | The sender, e.g. `The Chapter <chapters@yourdomain.com>`. You must verify a domain in Resend before you can send to anyone other than yourself. |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Starts with `sk-ant-`. |

Optional:

| Variable | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_MODEL_TEXT` | `claude-sonnet-4-5` | Used for chapter-text fallback (long output, quality matters). |
| `ANTHROPIC_MODEL_PRELUDE` | `claude-haiku-4-5` | Used for 2–3 sentence preludes (short, fast, ~5× cheaper than Sonnet). |
| `ALLOWED_ORIGIN` | unset | Lock API access to one origin in production, e.g. `https://thechapter.co`. |

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the three required keys
npm run dev
```

Note: `vite dev` only serves the frontend. The `/api/*` functions don't run under plain Vite — use `vercel dev` (`npm i -g vercel` first) if you need the serverless proxies locally:

```bash
vercel dev
```

## Resend setup

1. Sign up at [resend.com](https://resend.com) (free tier: 100 emails/day, 3,000/month).
2. Get an API key from **Dashboard → API Keys**.
3. Verify a sending domain under **Settings → Domains**. You'll add 2–3 DNS TXT records (SPF, DKIM, optional DMARC) at your registrar. Propagation usually takes minutes, sometimes hours.
4. Add `RESEND_API_KEY` and `FROM_EMAIL` as Vercel environment variables.

**Without domain verification**, you can send from `onboarding@resend.dev`, but Resend will only deliver to the email address that owns your Resend account. Good for smoke-testing, useless for real users.

## Book catalog

All ~80 books are hardcoded in the `BOOKS` array at the top of `src/App.jsx`. Each entry:

```js
{
  id: "pp",                                    // unique string
  title: "Pride and Prejudice",
  author: "Jane Austen",
  year: 1813,
  genre: "Romance",
  chapters: 61,
  wsPage: (n) => `Pride_and_Prejudice/Chapter_${n}`,  // or null → Claude fallback
  imgFile: "Some_File.jpg",                    // Wikimedia Commons filename
  color: "#3A5A3A",                            // accent color
  featured: true                               // optional
}
```

If the book is on Wikisource, set `wsPage` to a function returning the page path. Either way, every book also carries a `gid` — its Project Gutenberg ebook number — so the app (and the delivery cron) can fetch real text straight from Gutenberg. Find a book's `gid` at gutenberg.org (the number in the ebook URL).

**Why `gid` is hardcoded, not looked up:** `api/_lib/gutenberg.js` *can* resolve title→ID via the Gutendex catalog API, but **Gutendex blocks Vercel's serverless egress**, so live resolution fails for every book in production. Passing a baked-in `gid` skips that lookup entirely (direct `gutenberg.org` text fetches work fine from Vercel). The Gutendex resolver remains only as a best-effort fallback for a book missing a `gid`. The optional `gq` field is just a hint for that fallback and is ignored when `gid` is present.

**Copyright note:** every work must have a public-domain **English** text on Gutenberg. *The Adolescent* (Dostoevsky) and *The Knight of Sainte-Hermine* (Dumas) were removed because their only English translations are still under copyright.

**Copyright note:** everything in the catalog must have a public-domain *English text* — a public-domain original is not enough if the only translations are modern. This is why *The Knight of Sainte-Hermine* was removed (its English translation dates from 2008).

## Server-side delivery (the cron)

When `DATABASE_URL` is set, every new subscription is mirrored to Postgres and a daily Vercel Cron (`/api/cron`, 12:00 UTC ≈ US morning) sends due chapters — **no browser tab required**. The schema auto-creates on first use; setup is literally pasting a connection string (Neon's free tier works great). The in-browser delivery loop automatically skips server-managed subscriptions to prevent double-sends, and the app pulls the server's progress counters on load so local progress bars stay accurate.

Without `DATABASE_URL`, the app runs exactly as before: instant first-chapter emails work, and follow-ups send from the browser while a tab is open.

## Payments (Stripe)

`/api/checkout` creates Stripe Checkout Sessions and verifies them on return — deliberately no SDK and no webhooks. The plan is recorded server-side only after the verify step retrieves the session from Stripe with the secret key and confirms `payment_status`, so the client can never assert "I paid." Set `STRIPE_SECRET_KEY` + the three price ids to go live; until then, paid plans activate free with the "beta" notice, same as before. Webhooks become worth adding when you care about renewal/cancellation lifecycle events.

## Unsubscribe

Every scheduled email carries `/api/unsubscribe?token=…` — a one-click, any-device link (also wired into the `List-Unsubscribe-Post` header Gmail/Yahoo require). Default action pauses deliveries and saves the reader's place; a secondary link removes the subscription entirely.

## Known limitations (remaining)

1. **Inbox/streaks are per-browser.** Subscriptions and delivery now live server-side, but the in-app inbox and reading streaks are still localStorage. Chapters delivered by the cron arrive by email; the in-app chapter list reflects progress, but past cron emails aren't backfilled into the inbox view.
2. **No subscription lifecycle webhooks.** A canceled Stripe subscription keeps premium until you clear it in the `user_plans` table. Fine at beta scale; add webhooks when it isn't.

## Wikisource URL patterns

Wikisource regularly moves works to year-stamped page titles (e.g. `Pride_and_Prejudice` → `Pride_and_Prejudice_(1817)`). Two things make this work:

1. The Wikisource fetch in `App.jsx` passes `redirects=1` so the API resolves redirects server-side.
2. Books whose canonical Wikisource URL is a multi-volume index have `wsPage: null` and fetch from Project Gutenberg instead. `ANTHROPIC_API_KEY` is now only needed for AI preludes and the rare chapter that both Wikisource and Gutenberg fail to serve.

If you add a book and its `wsPage` always returns nothing, check the actual Wikisource title with `redirects=1` enabled before assuming the path is wrong.

## Outstanding items needing manual setup

- [ ] **`DATABASE_URL` in Vercel** — create a free Postgres at [neon.tech](https://neon.tech) (or Supabase), paste the connection string. This turns on real scheduled delivery. Optionally set `CRON_SECRET` (any long random string) to lock down the cron endpoint.
- [ ] **Stripe** — 
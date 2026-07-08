# The Chapter

Classic literature delivered to your inbox, chapter by chapter.

An installable web app (PWA) on Vercel with a serverless backend. **Product shape: the email is a reminder, the app is the reading room** — reminder emails carry the book, chapter number, reading time, and a prelude that sets the scene, with one button that deep-links into the app reader. Backend: real chapter text from Project Gutenberg, server-side subscriptions in Postgres, a daily delivery cron, one-click unsubscribe, and Stripe checkout. Every backend feature degrades gracefully when its env var is unset, so a bare deploy still works.

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
public/manifest.webmanifest  PWA manifest (installable app)
public/sw.js        Service worker: offline shell + cached chapter text
public/icons/       App icons (Android, iOS, maskable)
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

If the book is on Wikisource, set `wsPage` to a function returning the page path. Either way, every book carries a hardcoded `gid` — its Project Gutenberg ebook number — which the reader and the delivery cron pass straight to `/api/gutenberg?gid=…`.

**Why `gid` is hardcoded:** the Gutendex catalog API that resolves title→ID is **blocked from Vercel's serverless egress**, so live resolution fails in production. Baking the `gid` in skips that lookup (direct gutenberg.org text fetches work fine from Vercel). The Gutendex resolver stays only as a fallback for a book missing a `gid`; the optional `gq` field is ignored when `gid` is present.

**Copyright:** every work needs a public-domain **English** text on Gutenberg. *The Adolescent* (Dostoevsky) and *The Knight of Sainte-Hermine* (Dumas) are excluded because their only English translations are still under copyright.

**Copyright note:** everything in the catalog must have a public-domain *English text* — a public-domain original is not enough if the only translations are modern. This is why *The Knight of Sainte-Hermine* was removed (its English translation dates from 2008).

## Server-side delivery (the cron)

When `DATABASE_URL` is set, every new subscription is mirrored to Postgres and a daily Vercel Cron (`/api/cron`, 12:00 UTC ≈ US morning) sends due chapters — **no browser tab required**. The schema auto-creates on first use; setup is literally pasting a connection string (Neon's free tier works great). The in-browser delivery loop automatically skips server-managed subscriptions to prevent double-sends, and the app pulls the server's progress counters on load so local progress bars stay accurate.

Without `DATABASE_URL`, the app runs exactly as before: instant first-chapter emails work, and follow-ups send from the browser while a tab is open.

## Payments (Stripe)

`/api/checkout` creates Stripe Checkout Sessions and verifies them on return — deliberately no SDK and no webhooks. The plan is recorded server-side only after the verify step retrieves the session from Stripe with the secret key and confirms `payment_status`, so the client can never assert "I paid." Set `STRIPE_SECRET_KEY` + the three price ids to go live; until then, paid plans activate free with the "beta" notice, same as before. Webhooks become worth adding when you care about renewal/cancellation lifecycle events.

## Communal readings (the V1 spec)

The primary product is "**join our reading of Moby-Dick**," not "subscribe to a book." Implementation:

**Public readings** are seeded cohorts (the flagship — *The Great Moby-Dick Reading*, starting July 13 — auto-seeds on first API call, so a fresh deploy has a live funnel). They're featured on the landing page with a live participant count, and they are **free start to finish**: the trial cap doesn't apply to public-reading subscriptions, because these are the acquisition engine. Joining offers "send my first chapter immediately," discussion questions, and a delivery-time preference.

**Private groups** — anyone can start one from any book page ("Start a group reading"). Creating a group returns an invite link (`/app?join=<code>`); everyone who opens it joins the same cohort: same book, same rhythm, same discussion thread. Families, classrooms, Philosophy Club chapters.

**Discussion** — every reading gets a per-chapter comment thread in the reader, plus AI-generated discussion questions cached per (book, chapter) so the whole cohort discusses the *same* questions. Questions appear in the reminder email (opt-in) and in the app.

**Delivery-time preference** is stored per subscription but only takes effect when the cron runs hourly (Vercel Pro: change the cron schedule to `0 * * * *` and set `CRON_HOURLY=1`). On the default daily cron, everyone delivers at the daily run — nobody is silently skipped.

**Spec deviations, deliberate:** audio = the in-app TTS reader (no server-side narration yet); community threads live in-product rather than Discord/Slack; "N readers opened this chapter" is participant count rather than open-tracking (no pixels); late joiners start at chapter 1 on the cohort's rhythm rather than mid-book.

## The app (PWA)

The Chapter installs to the home screen on iOS (Share → Add to Home Screen), Android, and desktop (an "📲 Install app" button appears in the header when the browser offers it). The service worker caches the app shell and every chapter a reader opens — so a chapter started on WiFi finishes on the subway. Caching is deliberately conservative (network-first for the app itself) so deploys never leave users on a stale version. Bump the `VERSION` string in `public/sw.js` when you want to force old caches cleared.

Reminder emails deep-link to `/app?read=<bookId>.<chapter>&token=…`. On a device that's never seen the subscription, the token is adopted from the server — schedule, progress, and manage actions all work there from then on.

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
- [ ] **Stripe** — create the three Prices, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PRICE_ALACARTE`. Until then paid plans activate free (beta behavior).
- [ ] **`ANTHROPIC_API_KEY` in Vercel** — required for AI preludes; also the last-resort text fallback (rarely hit now that Gutenberg is the primary source).
- [ ] **Resend domain verification** — currently using `onboarding@resend.dev`, which only delivers to the address that owns the Resend account. Verify a sending domain in Resend (Settings → Domains) and update `FROM_EMAIL` in Vercel.
- [ ] **Footer contact email** — currently `cole@whetstoneadvisory.com`. Swap to a brand-aligned address once a domain is set up.

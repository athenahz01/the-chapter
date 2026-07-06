# The Chapter

Classic literature delivered to your inbox, chapter by chapter.

Vite + React app on Vercel, with three serverless functions.

## Project Structure

```
index.html          Landing page (served at /)
app.html            React app entry (served at /app)
src/App.jsx         Main React component — all app logic, book catalog, UI
src/main.jsx        React bootstrap
api/send.js         Serverless proxy → Resend (email delivery)
api/gutenberg.js    Serverless fetcher → Project Gutenberg (primary chapter text)
api/claude.js       Serverless proxy → Anthropic Claude API (preludes + last-resort text)
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

If the book is on Wikisource, set `wsPage` to a function returning the page path. If not, set `wsPage: null` and the app fetches the real text from Project Gutenberg via `/api/gutenberg`. If Gutenberg's title for the work differs from yours (translations, alternate titles), add a `gq` field with the search query to use — e.g. Demons carries `gq: "The Possessed Dostoyevsky"`.

**Copyright note:** everything in the catalog must have a public-domain *English text* — a public-domain original is not enough if the only translations are modern. This is why *The Knight of Sainte-Hermine* was removed (its English translation dates from 2008).

## Known limitations (not yet built)

Three things from the original product guide are **not implemented**. They're all flagged as "Future Considerations" in the guide for a reason — each is a meaningful scope in its own right:

1. **Payments.** The upgrade flow shows "Payment integration coming soon — free during beta." To launch paid, integrate Stripe Checkout with three prices ($5/mo, $40/yr, $3 one-time) and enforce them against the `plan` field on each subscription.
2. **Server-side scheduler.** The delivery engine currently runs in the user's browser (a `setInterval` in `App.jsx`). Emails only go out while someone has the tab open. For production, move this to a Vercel Cron that queries a real database and hits an internal send endpoint.
3. **Database.** All subscriptions, inbox items, and streak state live in `localStorage` per browser. A user who subscribes on their phone gets nothing on their laptop. Moving to Supabase or Postgres is a prerequisite for #2.

Everything else in the guide — email delivery, AI preludes, Wikisource fetching, the reader, TTS, the landing page — is wired up and working.

## Wikisource URL patterns

Wikisource regularly moves works to year-stamped page titles (e.g. `Pride_and_Prejudice` → `Pride_and_Prejudice_(1817)`). Two things make this work:

1. The Wikisource fetch in `App.jsx` passes `redirects=1` so the API resolves redirects server-side.
2. Books whose canonical Wikisource URL is a multi-volume index have `wsPage: null` and fetch from Project Gutenberg instead. `ANTHROPIC_API_KEY` is now only needed for AI preludes and the rare chapter that both Wikisource and Gutenberg fail to serve.

If you add a book and its `wsPage` always returns nothing, check the actual Wikisource title with `redirects=1` enabled before assuming the path is wrong.

## Outstanding items needing manual setup

- [ ] **`ANTHROPIC_API_KEY` in Vercel** — required for AI preludes; also the last-resort text fallback (rarely hit now that Gutenberg is the primary source).
- [ ] **`og-image.jpg`** — currently no Open Graph image is set. Drop a 1200×630 JPG into the project root and re-add `<meta property="og:image" content="/og-image.jpg">` in `index.html` for nice social-media previews.
- [ ] **Resend domain verification** — currently using `onboarding@resend.dev`, which only delivers to the address that owns the Resend account. Verify a sending domain in Resend (Settings → Domains) and update `FROM_EMAIL` in Vercel.
- [ ] **Footer contact email** — currently `cole@whetstoneadvisory.com`. Swap to a brand-aligned address once a domain is set up.

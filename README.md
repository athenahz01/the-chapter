# The Chapter

Classic literature delivered to your inbox, chapter by chapter.

Vite + React app on Vercel, with two serverless proxy functions.

## Project Structure

```
index.html          Landing page (served at /)
app.html            React app entry (served at /app)
src/App.jsx         Main React component — all app logic, book catalog, UI
src/main.jsx        React bootstrap
api/send.js         Serverless proxy → Resend (email delivery)
api/claude.js       Serverless proxy → Anthropic Claude API (preludes + fallback text)
vite.config.js      Vite multi-page build config
vercel.json         Vercel routing + function timeout config
.env.example        Documents all required environment variables
```

## Why two serverless functions?

Both Resend and Anthropic block direct browser calls — Resend via CORS, Anthropic both via CORS and because the `x-api-key` header must stay server-side. The two `/api/*` functions forward requests to those services with the key attached at request time.

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

All 22 books are hardcoded in the `BOOKS` array at the top of `src/App.jsx`. Each entry:

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

If the book is on Wikisource, set `wsPage` to a function returning the page path. If not, set `wsPage: null` and the app will use the Claude API to reproduce the public-domain text.

## Known limitations (not yet built)

Three things from the original product guide are **not implemented**. They're all flagged as "Future Considerations" in the guide for a reason — each is a meaningful scope in its own right:

1. **Payments.** The upgrade flow shows "Payment integration coming soon — free during beta." To launch paid, integrate Stripe Checkout with three prices ($5/mo, $40/yr, $3 one-time) and enforce them against the `plan` field on each subscription.
2. **Server-side scheduler.** The delivery engine currently runs in the user's browser (a `setInterval` in `App.jsx`). Emails only go out while someone has the tab open. For production, move this to a Vercel Cron that queries a real database and hits an internal send endpoint.
3. **Database.** All subscriptions, inbox items, and streak state live in `localStorage` per browser. A user who subscribes on their phone gets nothing on their laptop. Moving to Supabase or Postgres is a prerequisite for #2.

Everything else in the guide — email delivery, AI preludes, Wikisource fetching, the reader, TTS, the landing page — is wired up and working.

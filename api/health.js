// GET /api/health
//
// Quick diagnostic endpoint. Visit this URL in a browser after deployment to
// confirm everything is configured correctly. NEVER returns the actual values
// of any secret — only "set / not set" booleans.
//
// Example:
//   https://the-chapter-one.vercel.app/api/health
//
// Optional smoke test of Resend + Anthropic connectivity (does not actually
// send anything, just confirms the credentials are accepted):
//   https://the-chapter-one.vercel.app/api/health?probe=true

export default async function handler(req, res) {
  const env = process.env;
  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    env_vars: {
      RESEND_API_KEY: !!env.RESEND_API_KEY,
      FROM_EMAIL: env.FROM_EMAIL ? env.FROM_EMAIL : null, // not secret, fine to show
      ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL_TEXT: env.ANTHROPIC_MODEL_TEXT || "(default: claude-sonnet-4-5)",
      ANTHROPIC_MODEL_PRELUDE: env.ANTHROPIC_MODEL_PRELUDE || "(default: claude-haiku-4-5)",
      ALLOWED_ORIGIN: env.ALLOWED_ORIGIN || null,
    },
    notes: [],
  };

  // Sanity warnings the user should fix
  if (!env.RESEND_API_KEY) {
    result.notes.push("⚠ RESEND_API_KEY not set — emails cannot be sent.");
  }
  if (!env.ANTHROPIC_API_KEY) {
    result.notes.push("⚠ ANTHROPIC_API_KEY not set — books that need Claude fallback (most non-Wikisource books) will fail to fetch, and AI preludes will be missing for all books.");
  }
  if (!env.FROM_EMAIL) {
    result.notes.push("ℹ FROM_EMAIL not set — using default 'onboarding@resend.dev'. Resend will only deliver to the email address on your Resend account until you verify a domain.");
  } else if (env.FROM_EMAIL.includes("onboarding@resend.dev")) {
    result.notes.push("ℹ FROM_EMAIL is using onboarding@resend.dev — Resend will only deliver to the email registered on your Resend account. Verify a domain to send to anyone.");
  }

  // Optional connectivity probe — actually hits each external service
  if (req.query?.probe === "true") {
    result.probes = {};

    // Resend probe — call /domains (cheap, requires only the API key)
    if (env.RESEND_API_KEY) {
      try {
        const r = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
        });
        result.probes.resend = {
          status: r.status,
          ok: r.ok,
          message: r.ok ? "API key accepted" : `API returned ${r.status}`,
        };
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          result.probes.resend.verified_domains = (d?.data || [])
            .filter(x => x.status === "verified")
            .map(x => x.name);
        }
      } catch (e) {
        result.probes.resend = { ok: false, error: e.message };
      }
    }

    // Anthropic probe — call /v1/models (free, requires only the key)
    if (env.ANTHROPIC_API_KEY) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        });
        result.probes.anthropic = {
          status: r.status,
          ok: r.ok,
          message: r.ok ? "API key accepted" : `API returned ${r.status}`,
        };
      } catch (e) {
        result.probes.anthropic = { ok: false, error: e.message };
      }
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(result);
}

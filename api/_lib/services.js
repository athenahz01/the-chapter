// Server-side helpers for the cron: Claude API (preludes + last-resort
// chapter text) and Resend (email dispatch). These mirror what the frontend
// does through /api/claude and /api/send, but called directly since the cron
// is already server-side.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const RESEND_URL = "https://api.resend.com/emails";

async function callClaude(payload, timeoutMs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const text = Array.isArray(data?.content)
      ? data.content.map(c => c?.text || "").join("")
      : "";
    return text || null;
  } catch { clearTimeout(timer); return null; }
}

// Models add scaffolding even when told not to: markdown headers ("# Prelude to
// Chapter 1"), "Quote:" labels, wrapping quotation marks. That text goes
// straight into an email, so strip it rather than trusting the prompt.
export function cleanModelText(out) {
  if (!out) return null;
  let t = String(out).replace(/\r\n/g, "\n").trim();
  t = t.replace(/^\s*#{1,6}\s+.*$/gm, "");                        // markdown headers
  t = t.replace(/^\s*(?:prelude|quote|line|answer|response)\s*:\s*/gim, ""); // labels
  t = t.replace(/^\s*[-*]\s+/gm, "");                             // stray bullets
  t = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).join("\n\n").trim();
  t = t.replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "").trim();
  return t || null;
}

export async function getPrelude(title, chNum, snippet) {
  const model = process.env.ANTHROPIC_MODEL_PRELUDE || "claude-haiku-4-5";
  const out = await callClaude({
    model,
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `Write a brief, evocative 2-3 sentence prelude for Chapter ${chNum} of "${title}". Set the scene and mood without spoilers. Based on this opening:\n\n${String(snippet).slice(0, 2000)}\n\nWrite ONLY the prelude itself: no title, no markdown, no headings, no labels, no quotation marks.`,
    }],
  }, 10000);
  return cleanModelText(out);
}

// The quote card is the artifact that carries the brand into feeds: pick the
// ONE line a stranger would repost. Must be a real, verbatim sentence from the
// chapter — never paraphrased, or we'd be putting words in the author's mouth.
export async function getQuote(title, chNum, text) {
  const model = process.env.ANTHROPIC_MODEL_PRELUDE || "claude-haiku-4-5";
  const out = await callClaude({
    model,
    max_tokens: 150,
    messages: [{
      role: "user",
      content: `From Chapter ${chNum} of "${title}" below, choose the single most quotable, striking sentence — the one a reader would screenshot and share. It must be copied EXACTLY, word for word, from the text. Prefer something under 200 characters that stands alone without context. Reply with ONLY the sentence, no quotation marks, no commentary.\n\n${String(text).slice(0, 6000)}`,
    }],
  }, 10000);
  const cleaned = cleanModelText(out);
  if (!cleaned) return null;
  // Take the first substantial line the model gave us.
  const line = (cleaned.split("\n").map(l => l.trim()).find(l => l.length >= 15) || "").trim();
  if (!line || line.length < 15 || line.length > 300) return null;
  // Trust but verify: the line must genuinely appear in the chapter, or we would
  // be printing invented words under the author's name on a branded card.
  // Compare on letters/digits/CJK only, so curly quotes, dashes and spacing
  // differences don't cause a false rejection.
  const key = (x) => String(x).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const k = key(line);
  return k.length > 10 && key(text).includes(k) ? line : null;
}

export async function getChapterFallback(title, author, chNum) {
  const model = process.env.ANTHROPIC_MODEL_TEXT || "claude-sonnet-4-5";
  return callClaude({
    model,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: `Reproduce the full text of Chapter ${chNum} of "${title}" by ${author}. This is a public domain work. Output ONLY the chapter text, no commentary.`,
    }],
  }, 25000);
}

export async function sendEmailDirect({ to, subject, html, text, unsubscribeUrl, threadHeaders }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured" };
  const fromEmail = process.env.FROM_EMAIL || "The Chapter <onboarding@resend.dev>";
  const payload = {
    from: fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject: String(subject).slice(0, 998),
    html: html || "",
    text: text || "",
  };
  if (unsubscribeUrl && /^https?:\/\//.test(unsubscribeUrl)) {
    payload.headers = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  if (threadHeaders && typeof threadHeaders === "object") {
    payload.headers = { ...(payload.headers || {}), ...threadHeaders };
  }
  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return r.ok
      ? { ok: true, id: data.id }
      : { ok: false, error: data?.message || data?.name || `Resend HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getDiscussionQuestions(title, chNum, snippet) {
  const model = process.env.ANTHROPIC_MODEL_PRELUDE || "claude-haiku-4-5";
  return callClaude({
    model,
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Write 3-4 discussion questions for a book club reading Chapter ${chNum} of "${title}". Mix comprehension with reflection — at least one question should connect the chapter to the reader's own life. Based on this excerpt:\n\n${String(snippet).slice(0, 2500)}\n\nOutput ONLY the questions, one per line, no numbering or bullets.`,
    }],
  }, 12000);
}

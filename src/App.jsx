import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Storage polyfill (maps artifact API to localStorage) ───
if (!window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v } : null;
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!prefix || k.startsWith(prefix)) keys.push(k);
      }
      return { keys };
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   THE CHAPTER v7 — Classic literature delivered to your inbox
   
   Text: Anthropic Claude API + Wikisource API fallback
   Images: Wikimedia Commons thumb.php
   AI: Claude API for chapter preludes
   Email: Resend API (configured once by admin below)
   Audio: Chunked browser TTS
   ═══════════════════════════════════════════════════════════════════ */

// ╔═══════════════════════════════════════════════════════════════╗
// ║  ADMIN CONFIG — Set these once. Users never see this.        ║
// ║  Deploy api/send.js on Vercel, set RESEND_API_KEY env var.   ║
// ╚═══════════════════════════════════════════════════════════════╝
const EMAIL_API_URL = "/api/send"; // Your deployed serverless endpoint
const FREE_CHAPTERS = 3; // Free trial length per book
const PRICE_MONTHLY = 5; // $/month for unlimited
const PRICE_ANNUAL = 40; // $/year for unlimited (2 months free)
const PRICE_ALACARTE = 3; // $/book one-time

// ─── BOOK CATALOG ───────────────────────────────────────────────
const BOOKS = [
  { id:"pp", title:"Pride and Prejudice", author:"Jane Austen", year:1813, genre:"Romance", chapters:61,
    wsPage:(n)=>`Pride_and_Prejudice/Chapter_${n}`,
    imgFile:"Arthur_Hughes_-_The_Long_Engagement_-_Google_Art_Project.jpg", color:"#3A5A3A", featured:true },
  { id:"ttc", title:"A Tale of Two Cities", author:"Charles Dickens", year:1859, genre:"Historical Fiction", chapters:15,
    wsPage:(n)=>{const bk=n<=6?["Book_the_First",n]:n<=9?["Book_the_Second",n-6]:["Book_the_Third",n-9];const rom=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];return`A_Tale_of_Two_Cities/${bk[0]}/Chapter_${rom[bk[1]]}`;},
    imgFile:"Eugène_Delacroix_-_Le_28_Juillet._La_Liberté_guidant_le_peuple.jpg", color:"#3E2723", featured:true },
  { id:"ge", title:"Great Expectations", author:"Charles Dickens", year:1861, genre:"Coming of Age", chapters:59,
    wsPage:(n)=>`Great_Expectations/Chapter_${n}`,
    imgFile:"Atkinson_Grimshaw_-_Moonlight_on_the_Thames_at_Greenwich.jpg", color:"#1A2632", featured:true },
  { id:"cc", title:"A Christmas Carol", author:"Charles Dickens", year:1843, genre:"Novella", chapters:5,
    wsPage:(n)=>`A_Christmas_Carol/Stave_${n}`,
    imgFile:"Marley's_Ghost-John_Leech,_1843.jpg", color:"#1A3A2A" },
  { id:"je", title:"Jane Eyre", author:"Charlotte Brontë", year:1847, genre:"Gothic Romance", chapters:38,
    wsPage:(n)=>{const rom=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIII","XXIX","XXX","XXXI","XXXII","XXXIII","XXXIV","XXXV","XXXVI","XXXVII","XXXVIII"];return`Jane_Eyre_(1st_edition)/Chapter_${rom[n]}`;},
    imgFile:"Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg", color:"#2A3A4A", featured:true },
  { id:"wh", title:"Wuthering Heights", author:"Emily Brontë", year:1847, genre:"Gothic Fiction", chapters:34,
    wsPage:(n)=>`Wuthering_Heights/Chapter_${n}`,
    imgFile:"Caspar_David_Friedrich_-_Two_Men_Contemplating_the_Moon.jpg", color:"#1A1A2A" },
  { id:"frank", title:"Frankenstein", author:"Mary Shelley", year:1818, genre:"Gothic Horror", chapters:24,
    wsPage:null,
    imgFile:"Caspar_David_Friedrich_-_The_Sea_of_Ice_-_WGA09138.jpg", color:"#1A2A3A", featured:true },
  { id:"drac", title:"Dracula", author:"Bram Stoker", year:1897, genre:"Gothic Horror", chapters:27,
    wsPage:(n)=>`Dracula/Chapter_${n}`,
    imgFile:"Caspar_David_Friedrich_-_Abtei_im_Eichwald_-_Google_Art_Project.jpg", color:"#0D0D1A" },
  { id:"ss", title:"Sense and Sensibility", author:"Jane Austen", year:1811, genre:"Romance", chapters:50,
    wsPage:(n)=>`Sense_and_Sensibility/Chapter_${n}`,
    imgFile:"Thomas_Gainsborough_-_The_Morning_Walk.jpg", color:"#4A5A3A" },
  { id:"emma", title:"Emma", author:"Jane Austen", year:1815, genre:"Comedy of Manners", chapters:55,
    wsPage:null,
    imgFile:"Charles_Edward_Perugini_-_Girl_Reading.jpg", color:"#5A4A3A" },
  { id:"ti", title:"Treasure Island", author:"R. L. Stevenson", year:1883, genre:"Adventure", chapters:34,
    wsPage:(n)=>`Treasure_Island/Chapter_${n}`,
    imgFile:"N.C._Wyeth_-_Treasure_Island,_1911_-_p047.jpg", color:"#1E3A4A" },
  { id:"tess", title:"Tess of the d'Urbervilles", author:"Thomas Hardy", year:1891, genre:"Tragedy", chapters:59,
    wsPage:(n)=>`Tess_of_the_d'Urbervilles/Phase_the_First/Chapter_${n}`,
    imgFile:"George_Clausen_-_Summer_Afternoon.jpg", color:"#5A4A2A" },
  { id:"dq", title:"Don Quixote", author:"Miguel de Cervantes", year:1605, genre:"Satire", chapters:52,
    wsPage:null,
    imgFile:"Honoré_Daumier_-_Don_Quixote_and_Sancho_Panza_-_WGA5961.jpg", color:"#5A3A1A" },
  { id:"mc", title:"The Count of Monte Cristo", author:"Alexandre Dumas", year:1844, genre:"Adventure", chapters:40,
    wsPage:null,
    imgFile:"The_Château_d'If.jpg", color:"#1A3A4A" },
  { id:"odyss", title:"The Odyssey", author:"Homer (Butler transl.)", year:-800, genre:"Epic Poetry", chapters:24,
    wsPage:(n)=>`The_Odyssey_(Butler)/Book_${["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV"][n]}`,
    imgFile:"Waterhouse-Ulysses_and_the_Sirens.jpg", color:"#1A4A5A" },
  { id:"war", title:"The Art of War", author:"Sun Tzu (Giles transl.)", year:-500, genre:"Philosophy", chapters:13,
    wsPage:(n)=>`The_Art_of_War_(Sun)/Chapter_${n}`,
    imgFile:"Erta_Rivale%2C_Italian._The_Fall_of_Jericho%2C_ca._1920.jpg", color:"#4A1A1A" },
  { id:"med", title:"Meditations", author:"Marcus Aurelius", year:180, genre:"Philosophy", chapters:12,
    wsPage:null,
    imgFile:"Bronze_equestrian_statue_of_Marcus_Aurelius.jpg", color:"#3A3A5A" },
  { id:"rep", title:"The Republic", author:"Plato (Jowett transl.)", year:-375, genre:"Philosophy", chapters:10,
    wsPage:null,
    imgFile:"Sanzio_01.jpg", color:"#2A3A1A" },
  { id:"prince", title:"The Prince", author:"Niccolò Machiavelli", year:1532, genre:"Political Philosophy", chapters:26,
    wsPage:(n)=>`The_Prince_(Hill)/Chapter_${n}`,
    imgFile:"Santi_di_Tito_-_Niccolo_Machiavelli's_portrait_headcrop.jpg", color:"#2A1A1A" },
  { id:"alice", title:"Alice in Wonderland", author:"Lewis Carroll", year:1865, genre:"Fantasy", chapters:12,
    wsPage:(n)=>`Alice's_Adventures_in_Wonderland_(1866)/Chapter_${n}`,
    imgFile:"Alice_par_John_Tenniel_04.png", color:"#4A5A6A" },
  { id:"dorian", title:"The Picture of Dorian Gray", author:"Oscar Wilde", year:1890, genre:"Gothic Fiction", chapters:20,
    wsPage:null,
    imgFile:"Ivan_Kramskoi_-_Christ_in_the_Wilderness_-_Google_Art_Project.jpg", color:"#2A2A1A" },
  { id:"sher", title:"Adventures of Sherlock Holmes", author:"Arthur Conan Doyle", year:1892, genre:"Mystery", chapters:12,
    wsPage:(n)=>{const t=["","A_Scandal_in_Bohemia","The_Red-Headed_League","A_Case_of_Identity","The_Boscombe_Valley_Mystery","The_Five_Orange_Pips","The_Man_with_the_Twisted_Lip","The_Adventure_of_the_Blue_Carbuncle","The_Adventure_of_the_Speckled_Band","The_Adventure_of_the_Engineer%27s_Thumb","The_Adventure_of_the_Noble_Bachelor","The_Adventure_of_the_Beryl_Coronet","The_Adventure_of_the_Copper_Beeches"];return t[n]?`The_Adventures_of_Sherlock_Holmes/${t[n]}`:null;},
    imgFile:"Strand_paget.jpg", color:"#3A2A1A", featured:true },
];

// ─── WIKISOURCE FETCHER ────────────────────────────────────────
async function fetchChapterWS(page) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000); // 6s timeout
    const url = `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&origin=*`;
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(timer); if (!r.ok) return null;
    const d = await r.json(); if (!d?.parse?.text?.["*"]) return null;
    const html = d.parse.text["*"];
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll(".mw-editsection, .noprint, .reference, sup.reference, table, .licensetpl, .prp-pages-output, style, script, .ws-noexport").forEach(el => el.remove());
    let text = "";
    doc.querySelectorAll("p, div.poem p").forEach(p => {
      const t = p.textContent?.trim();
      if (t && t.length > 20) text += t + "\n\n";
    });
    return text.trim().length > 100 ? text.trim() : null;
  } catch { return null; }
}

// ─── CLAUDE PROXY (server-side, /api/claude) ───────────────────
// The browser can't call api.anthropic.com directly (CORS + the API key must
// stay server-side). All Claude requests go through our Vercel function.
const CLAUDE_API_URL = "/api/claude";

async function callClaude(payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify(payload),
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.ok && typeof d.text === "string" ? d.text : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchChapterViaAPI(title, author, num, label) {
  return callClaude({ mode: "chapter", title, author, label }, 25000);
}

async function getAIPrelude(text, title, chNum) {
  const snippet = text.substring(0, 1200);
  return callClaude({ mode: "prelude", title, chNum, snippet }, 12000);
}

// ─── SEND EMAIL VIA SERVER PROXY ────────────────────────────────
async function sendEmail(to, subject, html, text) {
  if (!EMAIL_API_URL) return { ok: false, error: "Email not configured" };
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const r = await fetch(EMAIL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients, subject, html, text }),
    });
    if (r.ok) return { ok: true, ...(await r.json()) };
    const err = await r.json().catch(() => ({}));
    return { ok: false, error: err.error || `HTTP ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHTML(book, chapters) {
  const chBlocks = chapters.map(ch => {
    const pre = ch.prelude ? `<div style="background:#FBF5EC;border-left:3px solid #B8964E;padding:14px 18px;margin:20px 0;border-radius:0 6px 6px 0">
      <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-family:Helvetica,sans-serif">Chapter Prelude</p>
      <p style="font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#2C2419;margin:0;white-space:pre-wrap">${esc(ch.prelude)}</p>
    </div>` : "";
    const paras = ch.text.split(/\n\n+/).filter(p => p.trim()).map((p,i) =>
      `<p style="font-family:Georgia,serif;font-size:16px;line-height:1.85;color:#2C2419;margin:0 0 1.1em;${i>0?"text-indent:1.5em":""}">${esc(p.trim())}</p>`
    ).join("\n");
    return `<h2 style="font-family:Georgia,serif;font-size:19px;color:#6B1D2A;margin:28px 0 8px">Chapter ${esc(ch.chNum)} <span style="font-size:13px;color:#8A7E73;font-weight:400">of ${esc(book.chapters)}</span></h2>${pre}${paras}`;
  }).join('<hr style="border:none;border-top:1px solid #DDD5CA;margin:36px 0">');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF6F0;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E8E2DA">
<div style="padding:24px;border-bottom:1px solid #E8E2DA;text-align:center">
  <p style="font-size:11px;letter-spacing:4px;color:#8A7E73;margin:0 0 4px;text-transform:uppercase">T H E &ensp; C H A P T E R</p>
</div>
<div style="padding:24px;border-bottom:1px solid #E8E2DA;text-align:center">
  <h1 style="font-family:Georgia,serif;font-size:24px;color:#1A1612;margin:0 0 4px">${esc(book.title)}</h1>
  <p style="font-size:14px;color:#8A7E73;margin:0;font-style:italic">by ${esc(book.author)}</p>
</div>
<div style="padding:28px 24px">${chBlocks}</div>
<div style="padding:20px 24px;border-top:1px solid #E8E2DA;text-align:center;background:#FAF6F0">
  <p style="font-size:11px;color:#8A7E73;margin:0">Sent by The Chapter · Classic literature, chapter by chapter</p>
</div>
</div></body></html>`;
}

function buildEmailText(book, chapters) {
  const div = "─".repeat(40);
  return chapters.map(ch => {
    const pre = ch.prelude ? `\n✦ Prelude\n${div}\n${ch.prelude}\n${div}\n\n` : "";
    return `Chapter ${ch.chNum} of ${book.chapters}\n${div}\n${pre}${ch.text}`;
  }).join(`\n\n${"═".repeat(40)}\n\n`);
}

// ─── WIKIMEDIA IMAGE URL ───────────────────────────────────────
function imgUrl(f, w) { return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${w}`; }

// ─── TTS (speech synthesis) ────────────────────────────────────
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
function useTTS() {
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const chunksRef = useRef([]);
  const idxRef = useRef(0);
  const totalRef = useRef(0);

  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis?.getVoices() || [];
      if (v.length) { setVoices(v); if (!selectedVoiceURI) { const en = v.filter(x => x.lang.startsWith("en")); const prem = en.find(x => /enhanced|premium|natural|neural|online/i.test(x.name)); setSelectedVoiceURI((prem || en[0] || v[0]).voiceURI); } }
    };
    load(); window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", load);
  }, []);

  const getVoice = useCallback(() => {
    const v = window.speechSynthesis?.getVoices() || [];
    return v.find(x => x.voiceURI === selectedVoiceURI) || v.find(x => x.lang.startsWith("en")) || v[0];
  }, [selectedVoiceURI]);

  const speakChunk = useCallback((idx) => {
    if (idx >= chunksRef.current.length) { setSpeaking(false); setPaused(false); setProgress(100); return; }
    const u = new SpeechSynthesisUtterance(chunksRef.current[idx]);
    u.voice = getVoice(); u.rate = speed;
    u.onend = () => { idxRef.current = idx + 1; setProgress(Math.round(((idx + 1) / totalRef.current) * 100)); speakChunk(idx + 1); };
    u.onerror = (e) => { if (e.error !== "interrupted") speakChunk(idx + 1); };
    window.speechSynthesis?.speak(u);
  }, [getVoice, speed]);

  const prepare = useCallback((text) => {
    const sentences = text.match(/[^.!?]+[.!?]+[\s"]*/g) || [text];
    const chunks = []; let buf = "";
    sentences.forEach(s => { buf += s; if (buf.length >= 180) { chunks.push(buf.trim()); buf = ""; } });
    if (buf.trim()) chunks.push(buf.trim());
    chunksRef.current = chunks; totalRef.current = chunks.length; idxRef.current = 0;
    setPanelOpen(true); setProgress(0);
  }, []);

  const play = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(true); setPaused(false); speakChunk(idxRef.current);
  }, [speakChunk]);

  const pause = useCallback(() => { window.speechSynthesis?.pause(); setPaused(true); }, []);
  const resume = useCallback(() => { window.speechSynthesis?.resume(); setPaused(false); }, []);
  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false); setPaused(false); setPanelOpen(false); idxRef.current = 0; setProgress(0);
  }, []);
  const rewind = useCallback(() => {
    window.speechSynthesis?.cancel();
    idxRef.current = Math.max(0, idxRef.current - 3);
    setProgress(Math.round((idxRef.current / totalRef.current) * 100));
    speakChunk(idxRef.current);
  }, [speakChunk]);
  const changeSpeed = useCallback((s) => { setSpeed(s); if (speaking) { window.speechSynthesis?.cancel(); setTimeout(() => speakChunk(idxRef.current), 50); } }, [speaking, speakChunk]);
  const cycleSpeed = useCallback(() => { const i = SPEEDS.indexOf(speed); changeSpeed(SPEEDS[(i + 1) % SPEEDS.length]); }, [speed, changeSpeed]);
  const preview = useCallback(() => {
    window.speechSynthesis?.cancel();
    const u = new SpeechSynthesisUtterance("The evening sun cast long shadows across the moor."); u.voice = getVoice(); u.rate = speed;
    window.speechSynthesis?.speak(u);
  }, [getVoice, speed]);

  return { voices, selectedVoiceURI, setSelectedVoiceURI, speaking, paused, progress, speed, panelOpen, prepare, play, pause, resume, stop, rewind, changeSpeed, cycleSpeed, preview };
}

// ─── SVG COVER GENERATOR ───────────────────────────────────────
function GenCover({ title, author, color, w, h }) {
  const lines = Array.from({length:Math.ceil(h/8)},(_,i)=>
    `<line x1="0" y1="${i*8}" x2="${w}" y2="${i*8}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}"/>${lines}<text x="${w/2}" y="${h*.55}" text-anchor="middle" fill="rgba(255,255,255,.82)" font-family="serif" font-size="${Math.min(13,w/10)}" font-weight="600">${title.length>30?title.slice(0,28)+"…":title}</text><text x="${w/2}" y="${h*.55+16}" text-anchor="middle" fill="rgba(255,255,255,.45)" font-family="sans-serif" font-size="${Math.min(9,w/14)}">${author}</text></svg>`;
  return <img src={`data:image/svg+xml,${encodeURIComponent(svg)}`} alt={title} style={{width:w,height:h,display:"block"}} />;
}

function CoverImg({ book, style, w, h }) {
  const [err, setErr] = useState(false);
  if (!book.imgFile || err) return <GenCover title={book.title} author={book.author} color={book.color} w={w||80} h={h||110} />;
  return <img src={imgUrl(book.imgFile, w > 200 ? 800 : 400)} alt={book.title} style={{...style, objectFit:"cover"}} onError={()=>setErr(true)} loading="lazy" />;
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function App() {
  const [view, setView] = useState("library");
  const [book, setBook] = useState(null);
  const [subs, setSubs] = useState([]);
  const [chIdx, setChIdx] = useState(null);
  const [chText, setChText] = useState("");
  const [chCache, setChCache] = useState({});
  const [preCache, setPreCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [aiPre, setAiPre] = useState("");
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("All");
  const [fontSize, setFontSize] = useState(19);
  const [theme, setTheme] = useState("sepia");
  const [fontFam, setFontFam] = useState("serif");
  const [streak, setStreak] = useState({ current: 0, best: 0, lastDate: null });
  const [textSrc, setTextSrc] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [subModal, setSubModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [inboxItem, setInboxItem] = useState(null);
  const [delivering, setDelivering] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [userPlan, setUserPlan] = useState("free"); // "free" | "monthly" | "annual"
  const tts = useTTS();
  const subsRef = useRef(subs);
  const inboxRef = useRef(inbox);
  const delRef = useRef(false);
  const planRef = useRef(userPlan);

  useEffect(() => { subsRef.current = subs; }, [subs]);
  useEffect(() => { inboxRef.current = inbox; }, [inbox]);
  useEffect(() => { planRef.current = userPlan; }, [userPlan]);

  const showToast = (msg, type="info") => { setToast({msg,type}); setTimeout(()=>setToast(null), 4000); };
  const nav = (v) => { setView(v); window.scrollTo({top:0,behavior:"smooth"}); };

  // ─── Storage ───
  useEffect(() => { (async () => {
    try { const r = await window.storage.get("ch7-subs"); if (r?.value) { const s = JSON.parse(r.value); setSubs(s); subsRef.current = s; } } catch {}
    try { const r = await window.storage.get("ch7-inbox"); if (r?.value) { const x = JSON.parse(r.value); setInbox(x); inboxRef.current = x; } } catch {}
    try { const r = await window.storage.get("ch7-streak"); if (r?.value) setStreak(JSON.parse(r.value)); } catch {}
    try { const r = await window.storage.get("ch7-prefs"); if (r?.value) { const p = JSON.parse(r.value); setTheme(p.t||"sepia"); setFontFam(p.f||"serif"); setFontSize(p.s||19); } } catch {}
    try { const r = await window.storage.get("ch7-email"); if (r?.value) setUserEmail(r.value); } catch {}
    try { const r = await window.storage.get("ch7-plan"); if (r?.value) setUserPlan(r.value); } catch {}
  })(); }, []);

  // ─── URL params (from landing page CTA) ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const bookId = params.get("book");
    if (bookId) {
      const b = BOOKS.find(x => x.id === bookId);
      if (b) {
        setBook(b);
        setView("book");
        setTimeout(() => {
          setSubModal({ bookId: b.id, step: 1, email: email || userEmail || "", days: [1, 3, 5], cpd: 1, friends: "", plan: "free" });
        }, 400);
      }
    }
    // Clean URL
    if (params.toString()) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const saveSubs = async (s) => { setSubs(s); subsRef.current = s; try { await window.storage.set("ch7-subs", JSON.stringify(s)); } catch {} };
  const saveInbox = async (x) => { setInbox(x); inboxRef.current = x; try { await window.storage.set("ch7-inbox", JSON.stringify(x)); } catch {} };
  const saveStreak = async (s) => { setStreak(s); try { await window.storage.set("ch7-streak", JSON.stringify(s)); } catch {} };
  const savePrefs = async (t,f,s) => { setTheme(t); setFontFam(f); setFontSize(s); try { await window.storage.set("ch7-prefs", JSON.stringify({t,f,s})); } catch {} };
  const svEmail = async (e) => { setUserEmail(e); try { await window.storage.set("ch7-email", e); } catch {} };
  const svPlan = async (p) => { setUserPlan(p); try { await window.storage.set("ch7-plan", p); } catch {} };
  const isPremium = userPlan === "monthly" || userPlan === "annual";

  const cacheText = async (k,t) => { setChCache(c=>({...c,[k]:t})); try { await window.storage.set(`ch7-t-${k}`,t); } catch {} };
  const cachePre = async (k,p) => { setPreCache(c=>({...c,[k]:p})); try { await window.storage.set(`ch7-p-${k}`,p); } catch {} };
  const getT = async (k) => { if(chCache[k]) return chCache[k]; try { const r = await window.storage.get(`ch7-t-${k}`); if(r?.value){setChCache(c=>({...c,[k]:r.value}));return r.value;} } catch {} return null; };
  const getP = async (k) => { if(preCache[k]) return preCache[k]; try { const r = await window.storage.get(`ch7-p-${k}`); if(r?.value){setPreCache(c=>({...c,[k]:r.value}));return r.value;} } catch {} return null; };

  const recordRead = () => {
    const today = new Date().toDateString();
    if (streak.lastDate === today) return;
    const y = new Date(Date.now()-86400000).toDateString();
    const nc = streak.lastDate === y ? streak.current+1 : 1;
    saveStreak({ current:nc, best:Math.max(streak.best,nc), lastDate:today });
  };

  const genres = useMemo(()=>["All",...new Set(BOOKS.map(b=>b.genre))].sort(),[]);
  const filtered = useMemo(()=>BOOKS.filter(b=>{
    const s=!search||(b.title+b.author).toLowerCase().includes(search.toLowerCase());
    return s&&(genre==="All"||b.genre===genre);
  }),[search,genre]);
  const featured = useMemo(()=>BOOKS.filter(b=>b.featured),[]);
  const getSub = (id) => subs.find(s=>s.bookId===id);
  const unreadCount = inbox.filter(x=>!x.read).length;

  // ─── Fetch helpers ───
  const fetchText = async (b,num) => {
    const k=`${b.id}-${num}`; let t = await getT(k);
    if(t) return t;
    if(b.wsPage){ const ws=b.wsPage(num); if(ws) t = await fetchChapterWS(ws); }
    if(!t) t = await fetchChapterViaAPI(b.title,b.author,num,`Chapter ${num}`);
    if(t) await cacheText(k,t);
    return t;
  };
  const fetchPre = async (b,num,text) => {
    const k=`${b.id}-${num}`; let p = await getP(k);
    if(p) return p;
    p = await getAIPrelude(text,b.title,num);
    if(p) await cachePre(k,p);
    return p;
  };

  // ═══ DELIVER CHAPTERS (parallel fetch, non-blocking email) ═══
  const deliverChapters = async (sub, startCh, count) => {
    const b = BOOKS.find(x=>x.id===sub.bookId);
    if(!b) return [];
    const unlocked = isPremium || sub.plan==="alacarte" || sub.plan==="paid";
    const maxCh = unlocked ? b.chapters : FREE_CHAPTERS;

    // Build list of chapters to fetch
    const chNums = [];
    for(let c=0; c<count; c++){
      const ch = startCh+c;
      if(ch>b.chapters || ch>maxCh) break;
      chNums.push(ch);
    }
    if(chNums.length===0) return [];

    // Fetch ALL chapter texts in parallel
    const texts = await Promise.all(chNums.map(ch => fetchText(b, ch)));
    const chapters = chNums.map((ch,i) => ({ chNum:ch, text:texts[i], prelude:null })).filter(c => c.text);
    if(chapters.length===0) return [];

    // Create inbox items immediately (no prelude yet = fast)
    const items = chapters.map(ch => ({
      id: `${sub.bookId}-${ch.chNum}-${Date.now()}`,
      bookId: sub.bookId, ch: ch.chNum, text: ch.text, prelude: null,
      at: new Date().toISOString(), read: false,
    }));

    // Background: fetch preludes + send email (don't block UI)
    (async () => {
      const preludes = await Promise.all(chapters.map(ch => fetchPre(b, ch.chNum, ch.text)));
      chapters.forEach((ch,i) => { ch.prelude = preludes[i]; });

      // Update inbox items with preludes
      const currentInbox = inboxRef.current;
      const updated = currentInbox.map(ix => {
        const match = items.find(it => it.id === ix.id);
        if(match){
          const ch = chapters.find(c => c.chNum === ix.ch);
          return ch?.prelude ? { ...ix, prelude: ch.prelude } : ix;
        }
        return ix;
      });
      saveInbox(updated);

      // Send email with preludes included
      const recipients = [sub.email,...(sub.friends||[])].filter(Boolean);
      if(EMAIL_API_URL && recipients.length > 0){
        const chLabel = chapters.length===1 ? `Chapter ${chapters[0].chNum}` : `Chapters ${chapters[0].chNum}–${chapters[chapters.length-1].chNum}`;
        const subject = `📖 ${b.title} — ${chLabel}`;
        const html = buildEmailHTML(b, chapters);
        const txt = buildEmailText(b, chapters);
        const result = await sendEmail(recipients, subject, html, txt);
        if(!result.ok) console.warn("Email send failed:", result.error);
        else showToast(`📧 Email sent to ${sub.email}!`, "success");
      }
    })();

    return items;
  };

  // ═══ SUBSCRIBE ═══
  const subscribe = async (bookId, email, scheduleDays, cpd, friendsStr, plan) => {
    const b = BOOKS.find(x=>x.id===bookId); if(!b) return;
    if(email && email !== userEmail) svEmail(email);
    const friends = friendsStr.split(",").map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    const newSub = {
      bookId, email, friends, plan, scheduleDays, chaptersPerDelivery:cpd,
      currentChapter:0, lastDeliveryDate:null,
      startDate: new Date().toISOString(), paused:false,
    };

    // Instant delivery of first batch
    setDelivering(true);
    showToast("Preparing your first chapter…","info");
    const items = await deliverChapters(newSub, 1, cpd);
    newSub.currentChapter = items.length;
    newSub.lastDeliveryDate = new Date().toISOString();

    const updSubs = [...subs.filter(s=>s.bookId!==bookId), newSub];
    await saveSubs(updSubs);
    await saveInbox([...items, ...inbox]);
    setDelivering(false);
    setSubModal(null);

    if(items.length > 0){
      const lbl = items.length===1 ? "Chapter 1" : `Chapters 1–${items.length}`;
      showToast(EMAIL_API_URL
        ? `📧 ${lbl} of ${b.title} sent to ${email}!`
        : `📖 ${lbl} of ${b.title} delivered to your inbox!`, "success");
    }
  };

  // ═══ AUTONOMOUS DELIVERY ENGINE ═══
  const checkDeliveries = useCallback(async () => {
    if(delRef.current) return;
    delRef.current = true;
    const now = new Date();
    const today = now.getDay();
    const current = [...subsRef.current];
    let updated = [...current];
    let newItems = [];
    let any = false;

    for(let i=0; i<updated.length; i++){
      const sub = updated[i];
      if(sub.paused || !sub.email) continue;
      const b = BOOKS.find(x=>x.id===sub.bookId);
      if(!b || sub.currentChapter>=b.chapters) continue;
      const prem = planRef.current==="monthly" || planRef.current==="annual" || sub.plan==="alacarte" || sub.plan==="paid";
      const maxCh = prem ? b.chapters : FREE_CHAPTERS;
      if(sub.currentChapter>=maxCh) continue;
      if(!sub.scheduleDays?.includes(today)) continue;
      if(sub.lastDeliveryDate && new Date(sub.lastDeliveryDate).toDateString()===now.toDateString()) continue;

      const cpd = sub.chaptersPerDelivery||1;
      const items = await deliverChapters(sub, sub.currentChapter+1, cpd);
      if(items.length===0) continue;

      updated[i] = { ...sub, currentChapter: sub.currentChapter+items.length, lastDeliveryDate: now.toISOString() };
      newItems.push(...items);
      any = true;
    }

    if(any){
      await saveSubs(updated);
      await saveInbox([...newItems, ...inboxRef.current]);
      showToast(`📧 ${newItems.length} new chapter${newItems.length>1?"s":""} delivered!`,"success");
    }
    delRef.current = false;
  },[]);

  useEffect(()=>{
    const t = setTimeout(()=>checkDeliveries(), 2500);
    const iv = setInterval(()=>checkDeliveries(), 60000);
    return ()=>{ clearTimeout(t); clearInterval(iv); };
  },[checkDeliveries]);

  // ─── Read chapter in app ───
  const readCh = async (b,num) => {
    setBook(b); setChIdx(num); setChText(""); setAiPre(""); tts.stop(); setTextSrc(""); nav("reader"); recordRead();
    const k=`${b.id}-${num}`;
    // Load prelude in background (non-blocking)
    const loadPrelude = async (txt) => { const p = await fetchPre(b,num,txt); if(p) setAiPre(p); };
    // Try cache first (instant)
    const cached = await getT(k);
    if(cached){ setChText(cached); setTextSrc("cached"); loadPrelude(cached); return; }
    // Try Wikisource
    setLoading(true);
    if(b.wsPage){ const ws=b.wsPage(num); if(ws){ const t = await fetchChapterWS(ws); if(t){ setChText(t); setLoading(false); setTextSrc("Wikisource"); cacheText(k,t); loadPrelude(t); return; } } }
    // Fall back to Claude API
    const t = await fetchChapterViaAPI(b.title,b.author,num,`Chapter ${num}`);
    if(t){ setChText(t); setTextSrc("AI text"); cacheText(k,t); loadPrelude(t); } else setChText("Could not load chapter.");
    setLoading(false);
  };

  const openInboxItem = (item) => {
    const upd = inbox.map(x=>x.id===item.id?{...x,read:true}:x);
    saveInbox(upd); setInboxItem(item); recordRead(); nav("email");
  };

  // Helpers
  const readTime = (t) => t ? Math.max(1,Math.ceil(t.split(/\s+/).length/250)) : 0;
  const curSub = book ? getSub(book.id) : null;
  const timeAgo = (d) => { const s=Math.floor((Date.now()-new Date(d).getTime())/1000); if(s<60) return "Just now"; if(s<3600) return `${Math.floor(s/60)}m ago`; if(s<86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`; };
  const schedLabel = (days,cpd) => { if(!days?.length) return "No schedule"; const d=days.sort((a,b)=>a-b).map(i=>DAYS[i]).join(", "); return `${cpd} ch. on ${d}`; };

  const themes = { light:{bg:"#FFF",fg:"#1A1612",mt:"#8A7E73",bd:"#E8E2DA",card:"#FAFAFA"}, sepia:{bg:"#FBF5EC",fg:"#2C2419",mt:"#8A7E6A",bd:"#E0D6C8",card:"#F5EFE4"}, dark:{bg:"#1C1914",fg:"#D4CCBE",mt:"#7A7164",bd:"#2E2A24",card:"#252119"} };
  const fonts = { serif:{l:"Serif",f:"'Cormorant Garamond',Georgia,serif"}, sans:{l:"Sans",f:"'DM Sans','Helvetica Neue',sans-serif"}, mono:{l:"Mono",f:"'IBM Plex Mono','Courier New',monospace"} };
  const th = themes[theme];

  // ─── TTS Player UI (reusable) ───
  const TTSPlayer = ({text, dark}) => {
    if(!text || text.length < 200) return null;
    const bg = dark ? th.card : "#1A1612";
    const fg = dark ? th.fg : "#FAF6F0";
    const mt = dark ? th.mt : "rgba(255,255,255,.5)";
    const acc = "#B8964E";
    if(!tts.panelOpen) return <button className="b" onClick={()=>tts.prepare(text)} style={{width:"100%",justifyContent:"center",padding:"10px 16px",background:bg,color:fg,borderRadius:8,fontSize:13,fontWeight:500,border:dark?`1px solid ${th.bd}`:"none"}}>🎧 Listen to this chapter</button>;
    return <div style={{background:bg,borderRadius:8,overflow:"hidden",border:dark?`1px solid ${th.bd}`:"none"}}>
      {tts.speaking && <div style={{height:3,background:"rgba(255,255,255,.1)"}}><div style={{height:"100%",width:`${tts.progress}%`,background:acc,transition:"width .4s"}} /></div>}
      {!tts.speaking && <div style={{padding:"12px"}}>
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
          <select value={tts.selectedVoiceURI} onChange={e=>tts.setSelectedVoiceURI(e.target.value)} style={{flex:1,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:5,color:fg,padding:"6px 8px",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
            {tts.voices.map(v=><option key={v.voiceURI} value={v.voiceURI} style={{background:"#1A1612",color:"#FAF6F0"}}>{v.name}{/enhanced|premium|natural|neural|online/i.test(v.name)?" ★":""}</option>)}
            {tts.voices.length===0&&<option>Loading…</option>}
          </select>
          <button onClick={tts.preview} style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",borderRadius:5,color:fg,padding:"6px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:11}}>▶ Test</button>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:mt}}>Speed:</span>
          {SPEEDS.map(s=><button key={s} onClick={()=>tts.changeSpeed(s)} style={{background:tts.speed===s?acc:"rgba(255,255,255,.08)",border:`1px solid ${tts.speed===s?acc:"rgba(255,255,255,.12)"}`,borderRadius:4,color:tts.speed===s?"#1A1612":fg,padding:"4px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:tts.speed===s?700:400}}>{s}×</button>)}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={tts.play} style={{flex:1,background:acc,border:"none",borderRadius:5,color:"#1A1612",padding:"9px 0",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>▶ Play</button>
          <button onClick={tts.stop} style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:5,color:fg,padding:"9px 14px",cursor:"pointer",fontSize:12,opacity:.7}}>✕</button>
        </div>
      </div>}
      {tts.speaking && <div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:6}}>
        <button style={{background:"none",border:"none",color:fg,cursor:"pointer",padding:"3px 4px",fontSize:16}} onClick={tts.paused?tts.resume:tts.pause}>{tts.paused?"▶":"⏸"}</button>
        <button style={{background:"none",border:"none",color:fg,cursor:"pointer",padding:"3px 4px",fontSize:16,opacity:.7}} onClick={tts.stop}>⏹</button>
        <button style={{background:"none",border:"none",color:fg,cursor:"pointer",padding:"2px 6px",fontSize:11,fontFamily:"'DM Sans',sans-serif"}} onClick={tts.rewind}>↺ 15s</button>
        <div style={{flex:1}} />
        <button style={{background:"rgba(255,255,255,.12)",border:"none",color:acc,cursor:"pointer",padding:"3px 10px",fontSize:12,fontFamily:"'DM Sans',sans-serif",fontWeight:600,borderRadius:4}} onClick={tts.cycleSpeed}>{tts.speed}×</button>
        <span style={{fontSize:11,fontFamily:"'DM Sans',sans-serif",color:mt}}>{tts.progress}%</span>
      </div>}
    </div>;
  };

  // ═══ RENDER ═══
  return (
    <div style={{minHeight:"100vh",background:"#FAF6F0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;1,400;1,600&family=IBM+Plex+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0} body{background:#FAF6F0}
        ::selection{background:#6B1D2A;color:#FAF6F0}
        .fi{animation:fi .4s ease both}@keyframes fi{from{opacity:0}to{opacity:1}}
        .fu{animation:fu .5s ease both}@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .b{cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .2s;display:inline-flex;align-items:center;gap:6px;line-height:1.4}
        .bp{background:#6B1D2A;color:#FAF6F0;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:500;letter-spacing:.3px}
        .bp:hover{background:#8B2E3D} .bp:disabled{opacity:.5;cursor:not-allowed}
        .bo{background:transparent;color:#1A1612;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:500;border:1.5px solid #DDD5CA}
        .bo:hover{border-color:#6B1D2A;color:#6B1D2A}
        .bg{background:transparent;color:#8A7E73;padding:6px 12px;border-radius:4px;font-size:12.5px;border:none}
        .bg:hover{color:#1A1612;background:#EDE7DD}
        input,select,textarea{font-family:'DM Sans',sans-serif;border:1.5px solid #DDD5CA;border-radius:6px;padding:9px 13px;font-size:13.5px;background:#fff;color:#1A1612;outline:none;width:100%}
        input:focus,textarea:focus{border-color:#6B1D2A}
        .chip{display:inline-block;padding:5px 12px;border-radius:16px;font-family:'DM Sans',sans-serif;font-size:11.5px;font-weight:500;cursor:pointer;border:1.5px solid #DDD5CA;background:transparent;color:#8A7E73;transition:all .15s}
        .chip.on{background:#6B1D2A;color:#FAF6F0;border-color:#6B1D2A}
        .card{background:#fff;border:1px solid #DDD5CA;border-radius:8px;transition:transform .25s,box-shadow .25s;overflow:hidden}
        .card:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(26,22,18,.06)}
        .prg{height:3px;background:#DDD5CA;border-radius:2px;overflow:hidden}
        .prg-f{height:100%;background:linear-gradient(90deg,#6B1D2A,#B8964E);border-radius:2px;transition:width .5s}
        .mod-bg{position:fixed;inset:0;background:rgba(26,22,18,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:1000;animation:fi .2s}
        .mod{background:#fff;border-radius:10px;padding:24px;max-width:440px;width:92%;max-height:85vh;overflow-y:auto}
        .skel{background:linear-gradient(90deg,#EDE7DD 25%,#DDD5CA 50%,#EDE7DD 75%);background-size:200% 100%;animation:sk 1.5s infinite;border-radius:4px}
        @keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .drop::first-letter{float:left;font-family:'Playfair Display',serif;font-size:3.4em;line-height:.78;padding-right:8px;padding-top:4px;color:#6B1D2A;font-weight:700}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;z-index:2000;animation:fu .3s;box-shadow:0 4px 20px rgba(0,0,0,.15);max-width:90%}
        .toast-success{background:#2D5A27;color:#fff} .toast-info{background:#1A1612;color:#FAF6F0}
        .dayB{width:38px;height:38px;border-radius:50%;border:1.5px solid #DDD5CA;background:transparent;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:#8A7E73;transition:all .15s;display:flex;align-items:center;justify-content:center}
        .dayB.on{background:#6B1D2A;color:#FAF6F0;border-color:#6B1D2A}
        .dayB:hover{border-color:#6B1D2A}
        .ixC{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid #E8E2DA;cursor:pointer;transition:background .15s;align-items:flex-start}
        .ixC:hover{background:#F5EFE4}
        .ixC.ur{background:#FDFBF7;border-left:3px solid #6B1D2A}
      `}</style>

      {toast && <div className={`toast toast-${toast.type||"info"}`}>{toast.msg}</div>}

      {/* ─── HEADER ─── */}
      <header style={{background:"rgba(250,246,240,.96)",backdropFilter:"blur(8px)",position:"sticky",top:0,zIndex:100,borderBottom:"1px solid #DDD5CA"}}>
        <div style={{maxWidth:1060,margin:"0 auto",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{cursor:"pointer",display:"flex",alignItems:"baseline",gap:8}} onClick={()=>{nav("library");tts.stop();}}>
            <span style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:800,color:"#1A1612"}}>The Chapter</span>
          </div>
          <nav style={{display:"flex",gap:4,alignItems:"center"}}>
            {[["library","Library"],["inbox","Inbox"],["mybooks","My Books"]].map(([v,l])=>(
              <button key={v} className="b bg" style={{fontWeight:view===v?600:400,color:view===v?"#1A1612":"#8A7E73",position:"relative"}} onClick={()=>nav(v)}>
                {l}
                {v==="inbox"&&unreadCount>0&&<span style={{background:"#6B1D2A",color:"#FAF6F0",borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:700}}>{unreadCount}</span>}
                {v==="mybooks"&&subs.length>0&&<span style={{background:"#DDD5CA",color:"#1A1612",borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:600}}>{subs.length}</span>}
              </button>
            ))}
            {delivering && <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E"}}>📧</span>}
          </nav>
        </div>
      </header>

      {/* ═══ LIBRARY ═══ */}
      {view==="library" && (
        <main style={{maxWidth:1060,margin:"0 auto",padding:"0 20px 60px"}} className="fi">
          <section style={{textAlign:"center",padding:"44px 0 36px",maxWidth:560,margin:"0 auto"}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"#B8964E",marginBottom:12}}>Classic literature, chapter by chapter</p>
            <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"clamp(24px,3.6vw,36px)",fontWeight:700,lineHeight:1.18,marginBottom:14}}>The greatest stories were never meant to be binged.</h1>
            <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,lineHeight:1.6,color:"#8A7E73",fontStyle:"italic"}}>Pick a book. Enter your email. Get chapters delivered on your schedule — with AI preludes to set the scene. First {FREE_CHAPTERS} chapters free, then ${PRICE_MONTHLY}/mo for unlimited.</p>
          </section>

          <section style={{marginBottom:36}}>
            <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:"#8A7E73",marginBottom:10}}>Featured</h2>
            <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:6}}>
              {featured.map((b,i)=>{const sub=getSub(b.id); return (
                <div key={b.id} className="card fu" style={{minWidth:210,maxWidth:230,flex:"0 0 auto",cursor:"pointer",animationDelay:`${i*.06}s`}} onClick={()=>{setBook(b);nav("book");}}>
                  <div style={{height:130,overflow:"hidden",position:"relative"}}>
                    <CoverImg book={b} style={{width:"100%",height:"100%"}} w={240} h={130} />
                    <div style={{position:"absolute",bottom:0,left:0,right:0,height:50,background:"linear-gradient(transparent,rgba(0,0,0,.5))"}} />
                    <span style={{position:"absolute",bottom:6,left:8,fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#fff9",letterSpacing:.8,textTransform:"uppercase"}}>{b.chapters} ch.</span>
                  </div>
                  <div style={{padding:"8px 10px 10px"}}>
                    <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:600,lineHeight:1.22,marginBottom:1}}>{b.title}</h3>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73"}}>{b.author}</p>
                    {sub && <div className="prg" style={{marginTop:5}}><div className="prg-f" style={{width:`${Math.round((sub.currentChapter/b.chapters)*100)}%`}} /></div>}
                  </div>
                </div>
              );})}
            </div>
          </section>

          <div style={{marginBottom:16}}>
            <input type="text" placeholder="Search titles or authors…" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:380,marginBottom:8}} />
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {genres.map(g=><button key={g} className={`chip ${genre===g?"on":""}`} onClick={()=>setGenre(g)}>{g}</button>)}
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",marginLeft:4,alignSelf:"center"}}>{filtered.length} titles</span>
            </div>
          </div>

          <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
            {filtered.map((b,i)=>{const sub=getSub(b.id); return (
              <div key={b.id} className="card fu" style={{display:"flex",cursor:"pointer",animationDelay:`${i*.02}s`}} onClick={()=>{setBook(b);nav("book");}}>
                <div style={{width:76,flexShrink:0,overflow:"hidden"}}><CoverImg book={b} style={{width:"100%",height:"100%",minHeight:96}} w={80} h={110} /></div>
                <div style={{padding:"8px 12px",flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#4A6741",letterSpacing:.5,textTransform:"uppercase"}}>{b.genre}</span>
                  <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:600,lineHeight:1.2,marginTop:1}}>{b.title}</h3>
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73"}}>{b.author} · {b.chapters} ch.</p>
                  {sub && <div className="prg" style={{marginTop:3}}><div className="prg-f" style={{width:`${Math.round((sub.currentChapter/b.chapters)*100)}%`}} /></div>}
                </div>
              </div>
            );})}
          </section>
        </main>
      )}

      {/* ═══ BOOK DETAIL ═══ */}
      {view==="book"&&book&&(
        <main style={{maxWidth:800,margin:"0 auto",padding:"0 20px 60px"}} className="fi">
          <button className="b bg" style={{margin:"16px 0"}} onClick={()=>nav("library")}>← Library</button>
          <div style={{height:220,borderRadius:10,overflow:"hidden",position:"relative",marginBottom:16}}>
            <CoverImg book={book} style={{width:"100%",height:"100%"}} w={800} h={220} />
            <div style={{position:"absolute",inset:0,background:"linear-gradient(transparent 30%,rgba(0,0,0,.7))"}} />
            <div style={{position:"absolute",bottom:18,left:18,right:18}}>
              <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"clamp(20px,3.2vw,30px)",fontWeight:700,color:"#fff",lineHeight:1.15,marginBottom:3,textShadow:"0 2px 8px rgba(0,0,0,.4)"}}>{book.title}</h1>
              <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:"#ffffffcc",fontStyle:"italic"}}>{book.author} · {book.year}</p>
            </div>
          </div>

          {/* Main CTA */}
          {!curSub ? (
            <div style={{background:"#fff",border:"1.5px solid #DDD5CA",borderRadius:10,padding:"20px 24px",marginBottom:16}}>
              <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:14}}>
                <span style={{fontSize:28}}>📧</span>
                <div>
                  <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600}}>Get this book delivered to you</h3>
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73"}}>{book.chapters} chapters · First {FREE_CHAPTERS} free, then ${PRICE_MONTHLY}/mo · AI preludes · Read with friends</p>
                </div>
              </div>
              <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"13px 20px",fontSize:14}} onClick={()=>setSubModal({bookId:book.id,step:1,email:userEmail,days:[1,3,5],cpd:1,friends:"",plan:"free"})}>
                Start Reading — Free
              </button>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",textAlign:"center",marginTop:6}}>Enter your email, pick your schedule, get Chapter 1 instantly.</p>
            </div>
          ) : (
            <div style={{background:isPremium||curSub.plan==="alacarte"?"#EDE7DD":"#F5F0E8",borderRadius:10,padding:"16px 20px",marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:8}}>
                <div>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,color:isPremium?"#6B1D2A":curSub.plan==="alacarte"?"#6B1D2A":"#4A6741"}}>
                    {isPremium?"★ Premium":curSub.plan==="alacarte"||curSub.plan==="paid"?"★ Unlocked":`○ Free Trial (${Math.max(0,FREE_CHAPTERS-curSub.currentChapter)} left)`}
                  </span>
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",marginTop:2}}>📧 {curSub.email} · {schedLabel(curSub.scheduleDays,curSub.chaptersPerDelivery)}</p>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button className="b bg" onClick={()=>setSettingsFor(book.id)}>⚙</button>
                  <button className="b bg" onClick={()=>saveSubs(subs.map(s=>s.bookId===book.id?{...s,paused:!s.paused}:s))}>{curSub.paused?"▶":"⏸"}</button>
                </div>
              </div>
              <div className="prg" style={{marginBottom:4}}><div className="prg-f" style={{width:`${Math.round((curSub.currentChapter/book.chapters)*100)}%`}} /></div>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73"}}>Ch. {curSub.currentChapter}/{book.chapters} · {Math.round((curSub.currentChapter/book.chapters)*100)}%</p>
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                {curSub.plan==="free"&&curSub.currentChapter>=FREE_CHAPTERS&&<button className="b bp" onClick={()=>setSubModal({bookId:book.id,step:1,email:curSub.email,days:curSub.scheduleDays||[1,3,5],cpd:curSub.chaptersPerDelivery||1,friends:(curSub.friends||[]).join(", "),plan:"monthly",isUpgrade:true})}>Upgrade — ${PRICE_MONTHLY}/mo for unlimited</button>}
                <button className="b bo" onClick={()=>nav("inbox")}>View Inbox</button>
                <button className="b bo" onClick={()=>readCh(book,Math.min(curSub.currentChapter+1,book.chapters))}>Read in App</button>
              </div>
            </div>
          )}

          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600,marginBottom:10,marginTop:8}}>Chapters</h2>
          <div style={{maxHeight:460,overflowY:"auto"}}>
            {Array.from({length:book.chapters},(_,i)=>i+1).map(n=>{
              const del = curSub && n<=curSub.currentChapter;
              const cur = curSub && n===curSub.currentChapter+1;
              const ix = inbox.find(x=>x.bookId===book.id&&x.ch===n);
              return <div key={n} style={{padding:"10px 14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",borderLeft:`3px solid ${cur?"#6B1D2A":del?"rgba(74,103,65,.3)":"transparent"}`,background:cur?"#EDE7DD":"transparent",opacity:del?.65:1,borderRadius:"0 4px 4px 0",transition:"all .12s"}} onClick={()=>ix?openInboxItem(ix):readCh(book,n)} onMouseEnter={e=>e.currentTarget.style.background=cur?"#EDE7DD":"#F5EFE4"} onMouseLeave={e=>e.currentTarget.style.background=cur?"#EDE7DD":"transparent"}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",width:24,textAlign:"right"}}>{del?"✓":n}</span>
                  <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14}}>Chapter {n}</span>
                </div>
                {ix&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:ix.read?"#8A7E73":"#6B1D2A"}}>{ix.read?"Read":"New"}</span>}
              </div>;
            })}
          </div>
        </main>
      )}

      {/* ═══ INBOX ═══ */}
      {view==="inbox"&&(
        <main style={{maxWidth:700,margin:"0 auto",padding:"24px 20px 60px"}} className="fi">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:16}}>
            <div>
              <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700,marginBottom:2}}>Inbox</h1>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73"}}>{inbox.length} delivered · {unreadCount} unread</p>
            </div>
            {streak.current>0&&<span style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#B8964E"}}>🔥 {streak.current}</span>}
          </div>

          {inbox.length===0?(
            <div style={{textAlign:"center",padding:"50px 20px"}}>
              <div style={{fontSize:48,marginBottom:12}}>📭</div>
              <p style={{fontFamily:"'Playfair Display',serif",fontSize:17,marginBottom:5}}>Your inbox is empty</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73",marginBottom:16}}>Subscribe to a book to start receiving chapters.</p>
              <button className="b bp" onClick={()=>nav("library")}>Browse Library</button>
            </div>
          ):(
            <div style={{background:"#fff",border:"1px solid #DDD5CA",borderRadius:8,overflow:"hidden"}}>
              {inbox.map((item,i)=>{
                const b=BOOKS.find(x=>x.id===item.bookId); if(!b) return null;
                const preview = item.text?.substring(0,120).replace(/\n/g," ").trim()+"…";
                return (
                  <div key={item.id} className={`ixC ${!item.read?"ur":""} fu`} style={{animationDelay:`${i*.03}s`}} onClick={()=>openInboxItem(item)}>
                    <div style={{width:44,height:56,borderRadius:4,overflow:"hidden",flexShrink:0}}>
                      <CoverImg book={b} style={{width:"100%",height:"100%"}} w={44} h={56} />
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                        <h3 style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:item.read?400:600}}>{b.title} — Ch. {item.ch}</h3>
                        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73",flexShrink:0}}>{timeAgo(item.at)}</span>
                      </div>
                      {item.prelude&&<p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:12,color:"#B8964E",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>✦ {item.prelude.substring(0,80)}…</p>}
                      <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{preview}</p>
                    </div>
                    {!item.read&&<div style={{width:8,height:8,borderRadius:"50%",background:"#6B1D2A",flexShrink:0,marginTop:4}} />}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* ═══ EMAIL VIEW ═══ */}
      {view==="email"&&inboxItem&&(()=>{
        const b=BOOKS.find(x=>x.id===inboxItem.bookId); if(!b) return null;
        return (
          <main style={{maxWidth:640,margin:"0 auto",padding:"20px 20px 60px"}} className="fi">
            <button className="b bg" style={{marginBottom:16}} onClick={()=>nav("inbox")}>← Inbox</button>
            <div style={{background:"#fff",border:"1px solid #DDD5CA",borderRadius:10,overflow:"hidden",boxShadow:"0 2px 16px rgba(26,22,18,.06)"}}>
              <div style={{padding:"16px 20px",borderBottom:"1px solid #E8E2DA",textAlign:"center",background:"#FAFAFA"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,letterSpacing:4,textTransform:"uppercase",color:"#8A7E73",marginBottom:8}}>T H E &nbsp; C H A P T E R</p>
                <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,marginBottom:4}}>{b.title}</h1>
                <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14,color:"#8A7E73",fontStyle:"italic"}}>by {b.author}</p>
              </div>
              <div style={{padding:"8px 20px",background:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",display:"flex",justifyContent:"space-between"}}>
                <span>Chapter {inboxItem.ch} of {b.chapters}</span>
                <span>{readTime(inboxItem.text)} min · {timeAgo(inboxItem.at)}</span>
              </div>
              {/* TTS */}
              <div style={{padding:"16px 20px 0"}}><TTSPlayer text={inboxItem.text} /></div>
              {inboxItem.prelude&&(
                <div style={{margin:"20px 20px 0",background:"#FBF5EC",borderLeft:"3px solid #B8964E",borderRadius:"0 6px 6px 0",padding:"12px 16px"}}>
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E",letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Chapter Prelude</p>
                  <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14.5,lineHeight:1.7,color:"#2C2419",whiteSpace:"pre-wrap"}}>{inboxItem.prelude}</p>
                </div>
              )}
              <article style={{padding:"24px 20px",fontSize:16,lineHeight:1.85,color:"#2C2419",fontFamily:"'Cormorant Garamond',Georgia,serif"}}>
                {inboxItem.text.split(/\n\n+/).filter(p=>p.trim()).map((para,i)=>(
                  <p key={i} className={i===0?"drop":""} style={{marginBottom:"1.2em",textIndent:i>0?"1.5em":0}}>{para.trim()}</p>
                ))}
              </article>
              <div style={{padding:"14px 20px",background:"#FAF6F0",borderTop:"1px solid #E8E2DA",textAlign:"center"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73"}}>The Chapter · Classic literature, chapter by chapter</p>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",padding:"16px 0"}}>
              {(()=>{
                const prev=inbox.find(x=>x.bookId===inboxItem.bookId&&x.ch===inboxItem.ch-1);
                const next=inbox.find(x=>x.bookId===inboxItem.bookId&&x.ch===inboxItem.ch+1);
                return <>
                  <button className="b bo" disabled={!prev} style={{opacity:prev?1:.3}} onClick={()=>prev&&openInboxItem(prev)}>← Ch. {inboxItem.ch-1}</button>
                  <button className="b bo" onClick={()=>readCh(b,inboxItem.ch)}>Open in Reader</button>
                  <button className="b bp" disabled={!next} style={{opacity:next?1:.3}} onClick={()=>next&&openInboxItem(next)}>Ch. {inboxItem.ch+1} →</button>
                </>;
              })()}
            </div>
          </main>
        );
      })()}

      {/* ═══ READER ═══ */}
      {view==="reader"&&book&&chIdx!==null&&(
        <main className="fi" style={{background:th.bg,minHeight:"100vh"}}>
          <div style={{maxWidth:620,margin:"0 auto",padding:"20px 20px 90px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:5}}>
              <button className="b bg" style={{color:th.mt}} onClick={()=>{nav("book");tts.stop();}}>← Back</button>
              <div style={{display:"flex",gap:2,alignItems:"center"}}>
                <button className="b bg" style={{color:th.mt,fontSize:11}} onClick={()=>savePrefs(theme,fontFam,Math.max(14,fontSize-2))}>A−</button>
                <button className="b bg" style={{color:th.mt,fontSize:13}} onClick={()=>savePrefs(theme,fontFam,Math.min(28,fontSize+2))}>A+</button>
                {[["light","L"],["sepia","S"],["dark","D"]].map(([t,l])=><button key={t} className="b bg" style={{color:theme===t?th.fg:th.mt,fontWeight:theme===t?600:400,fontSize:11}} onClick={()=>savePrefs(t,fontFam,fontSize)}>{l}</button>)}
              </div>
            </div>
            <div style={{textAlign:"center",marginBottom:32,paddingBottom:20,borderBottom:`1px solid ${th.bd}`}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:th.mt,letterSpacing:2.5,textTransform:"uppercase",marginBottom:6}}>{book.title}</p>
              <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:th.fg}}>Chapter {chIdx}</h1>
              {chText&&!loading&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:th.mt}}>{readTime(chText)} min{textSrc&&` · ${textSrc}`}</p>}
            </div>
            {loading&&<div style={{padding:"24px 0"}}>{[1,2,3,4,5].map(i=><div key={i} className="skel" style={{height:14,width:`${70+Math.random()*20}%`,marginBottom:8}} />)}</div>}
            {/* TTS */}
            {!loading&&chText&&<div style={{marginBottom:20}}><TTSPlayer text={chText} dark={theme==="dark"} /></div>}
            {!loading&&aiPre&&<div style={{background:theme==="dark"?"rgba(184,150,78,.1)":"#FBF5EC",borderLeft:"3px solid #B8964E",borderRadius:"0 6px 6px 0",padding:"12px 16px",marginBottom:20}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E",letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Chapter Prelude</p>
              <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14.5,lineHeight:1.7,color:th.fg,whiteSpace:"pre-wrap"}}>{aiPre}</p>
            </div>}
            {!loading&&chText&&<article style={{fontSize,lineHeight:1.88,color:th.fg,fontFamily:fonts[fontFam].f}}>
              {chText.split(/\n\n+/).filter(p=>p.trim()).map((para,i)=>(
                <p key={i} className={i===0?"drop":""} style={{marginBottom:"1.2em",textIndent:i>0?"1.5em":0}}>{para.trim()}</p>
              ))}
            </article>}
            <div style={{display:"flex",justifyContent:"space-between",padding:"20px 0",borderTop:`1px solid ${th.bd}`,marginTop:16}}>
              <button className="b bo" disabled={chIdx<=1} onClick={()=>readCh(book,chIdx-1)} style={{opacity:chIdx<=1?.3:1,borderColor:th.bd,color:th.fg}}>← Prev</button>
              <button className="b bp" disabled={chIdx>=book.chapters} onClick={()=>readCh(book,chIdx+1)} style={{opacity:chIdx>=book.chapters?.3:1}}>Next →</button>
            </div>
          </div>
        </main>
      )}

      {/* ═══ MY BOOKS ═══ */}
      {view==="mybooks"&&(
        <main style={{maxWidth:1060,margin:"0 auto",padding:"24px 20px 60px"}} className="fi">
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700,marginBottom:16}}>My Books</h1>
          {subs.length===0?(
            <div style={{textAlign:"center",padding:"40px 20px"}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73",marginBottom:16}}>No subscriptions yet.</p>
              <button className="b bp" onClick={()=>nav("library")}>Browse Library</button>
            </div>
          ):subs.map((sub,i)=>{
            const b=BOOKS.find(x=>x.id===sub.bookId); if(!b) return null;
            const pct=Math.round((sub.currentChapter/b.chapters)*100);
            const ur=inbox.filter(x=>x.bookId===sub.bookId&&!x.read);
            return (
              <div key={sub.bookId} className="card fu" style={{marginBottom:12,animationDelay:`${i*.06}s`}}>
                {ur.length>0&&<div style={{background:"linear-gradient(90deg,#6B1D2A,#8B2E3D)",padding:"4px 14px",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,color:"#FAF6F0"}}>📧 {ur.length} unread chapter{ur.length>1?"s":""}</div>}
                <div style={{display:"flex"}}>
                  <div style={{width:90,flexShrink:0,overflow:"hidden",cursor:"pointer"}} onClick={()=>{setBook(b);nav("book");}}>
                    <CoverImg book={b} style={{width:"100%",height:"100%",minHeight:120}} w={90} h={120} />
                  </div>
                  <div style={{padding:"12px 14px",flex:1}}>
                    <h3 style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:600,marginBottom:1,cursor:"pointer"}} onClick={()=>{setBook(b);nav("book");}}>{b.title}</h3>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",marginBottom:4}}>{b.author} · {schedLabel(sub.scheduleDays,sub.chaptersPerDelivery)}</p>
                    <div className="prg" style={{marginBottom:3}}><div className="prg-f" style={{width:`${pct}%`}} /></div>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73",marginBottom:6}}>Ch. {sub.currentChapter}/{b.chapters} · {pct}% · {isPremium?"★ Premium":sub.plan==="alacarte"||sub.plan==="paid"?"★ Unlocked":"Free trial"}{sub.paused?" · Paused":""}</p>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <button className="b bo" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>nav("inbox")}>Inbox</button>
                      <button className="b bo" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setBook(b);nav("book");}}>View</button>
                      <button className="b bg" style={{fontSize:11}} onClick={()=>saveSubs(subs.map(s=>s.bookId===sub.bookId?{...s,paused:!s.paused}:s))}>{sub.paused?"▶":"⏸"}</button>
                      <button className="b bg" style={{fontSize:11,color:"#B55"}} onClick={()=>{saveSubs(subs.filter(s=>s.bookId!==sub.bookId));saveInbox(inbox.filter(x=>x.bookId!==sub.bookId));showToast("Unsubscribed.","info");}}>✕</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </main>
      )}

      {/* ═══ SUBSCRIBE MODAL ═══ */}
      {subModal&&(()=>{
        const wb=BOOKS.find(x=>x.id===subModal.bookId); if(!wb) return null;
        const isUp = subModal.isUpgrade;
        const weeksNeeded = subModal.days?.length ? Math.ceil((wb.chapters - (isUp?getSub(wb.id)?.currentChapter||0:0)) / (subModal.cpd * subModal.days.length)) : "∞";
        return <div className="mod-bg" onClick={e=>e.target===e.currentTarget&&setSubModal(null)}><div className="mod" style={{maxWidth:440}}>
          <div style={{display:"flex",gap:12,marginBottom:16,alignItems:"center"}}>
            <div style={{width:50,height:65,borderRadius:4,overflow:"hidden",flexShrink:0}}>
              <CoverImg book={wb} style={{width:"100%",height:"100%"}} w={50} h={65} />
            </div>
            <div>
              <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600,lineHeight:1.2}}>{isUp?"Upgrade: ":""}{wb.title}</h2>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73"}}>{wb.author} · {wb.chapters} chapters</p>
            </div>
          </div>

          {/* Plan toggle (not shown on upgrade or if already premium) */}
          {!isUp && !isPremium && (
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
              {[["free",`Free Trial · ${FREE_CHAPTERS} chapters`,""],["monthly",`$${PRICE_MONTHLY}/month · Unlimited`,"All books, all chapters"],["annual",`$${PRICE_ANNUAL}/year · Save 33%`,"All books — 2 months free"],["alacarte",`$${PRICE_ALACARTE} · This book only`,"One-time, all chapters"]].map(([p,l,sub])=>(
                <button key={p} onClick={()=>setSubModal(m=>({...m,plan:p}))} style={{padding:"10px 14px",border:`1.5px solid ${subModal.plan===p?"#6B1D2A":"#DDD5CA"}`,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,background:subModal.plan===p?"#6B1D2A":"#fff",color:subModal.plan===p?"#FAF6F0":"#1A1612",transition:"all .2s",borderRadius:6,textAlign:"left"}}>
                  <span style={{fontWeight:600}}>{l}</span>
                  {sub&&<span style={{display:"block",fontSize:10,opacity:.7,marginTop:1}}>{sub}</span>}
                </button>
              ))}
            </div>
          )}
          {isPremium && !isUp && (
            <div style={{background:"#EDE7DD",borderRadius:6,padding:10,marginBottom:12,fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B1D2A",fontWeight:600,textAlign:"center"}}>★ Premium — all chapters unlocked</div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Email */}
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Your email</label>
              <input value={subModal.email} onChange={e=>setSubModal(m=>({...m,email:e.target.value}))} placeholder="you@email.com" type="email" />
            </div>

            {/* Schedule: Day picker */}
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:6}}>Delivery days</label>
              <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                {DAYS.map((d,i)=>(
                  <button key={i} className={`dayB ${subModal.days?.includes(i)?"on":""}`} onClick={()=>setSubModal(m=>{
                    const cur = m.days||[];
                    return {...m, days: cur.includes(i) ? cur.filter(x=>x!==i) : [...cur,i].sort((a,b)=>a-b)};
                  })}>{d}</button>
                ))}
              </div>
            </div>

            {/* Chapters per delivery */}
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Chapters per delivery</label>
              <div style={{display:"flex",gap:6}}>
                {[1,2,3,4,5].map(n=>(
                  <button key={n} onClick={()=>setSubModal(m=>({...m,cpd:n}))} style={{flex:1,padding:"8px 0",borderRadius:6,border:`1.5px solid ${subModal.cpd===n?"#6B1D2A":"#DDD5CA"}`,background:subModal.cpd===n?"#6B1D2A":"#fff",color:subModal.cpd===n?"#FAF6F0":"#8A7E73",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:subModal.cpd===n?600:400,cursor:"pointer",transition:"all .15s"}}>{n}</button>
                ))}
              </div>
            </div>

            {/* Friends */}
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Read with friends <span style={{fontWeight:400,color:"#8A7E73"}}>(optional)</span></label>
              <input value={subModal.friends} onChange={e=>setSubModal(m=>({...m,friends:e.target.value}))} placeholder="friend@email.com, another@email.com" />
            </div>

            {/* Preview */}
            <div style={{background:"#EDE7DD",borderRadius:6,padding:10,fontFamily:"'DM Sans',sans-serif",fontSize:12,textAlign:"center"}}>
              {subModal.days?.length > 0
                ? <>{subModal.cpd} chapter{subModal.cpd>1?"s":""} on {subModal.days.map(i=>DAYS[i]).join(", ")} — <strong>~{weeksNeeded} week{weeksNeeded!==1&&weeksNeeded!=="∞"?"s":""}</strong>{subModal.plan==="free"?` (first ${FREE_CHAPTERS} free)`:""}</>
                : <span style={{color:"#B55"}}>Select at least one day</span>
              }
            </div>

            {/* Submit */}
            <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"13px",fontSize:14}} disabled={!subModal.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subModal.email)||!subModal.days?.length||delivering} onClick={async ()=>{
              if(isUp){
                const friends = subModal.friends.split(",").map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
                if(subModal.plan==="monthly"||subModal.plan==="annual") svPlan(subModal.plan);
                saveSubs(subs.map(s=>s.bookId===wb.id?{...s,plan:subModal.plan,email:subModal.email,friends,scheduleDays:subModal.days,chaptersPerDelivery:subModal.cpd}:s));
                if(subModal.email!==userEmail) svEmail(subModal.email);
                setSubModal(null);
                showToast(subModal.plan==="monthly"||subModal.plan==="annual"?"★ Premium activated! All books unlocked.":`★ ${wb.title} fully unlocked!`,"success");
              } else {
                if(subModal.plan==="monthly"||subModal.plan==="annual") svPlan(subModal.plan);
                await subscribe(subModal.bookId, subModal.email, subModal.days, subModal.cpd, subModal.friends||"", subModal.plan);
              }
            }}>
              {delivering ? "Preparing…" : isUp
                ? (subModal.plan==="monthly"?`★ Subscribe — $${PRICE_MONTHLY}/mo`:subModal.plan==="annual"?`★ Subscribe — $${PRICE_ANNUAL}/yr`:`★ Unlock — $${PRICE_ALACARTE}`)
                : subModal.plan==="monthly"?`Subscribe — $${PRICE_MONTHLY}/month`
                : subModal.plan==="annual"?`Subscribe — $${PRICE_ANNUAL}/year`
                : subModal.plan==="alacarte"?`Unlock This Book — $${PRICE_ALACARTE}`
                : "Start Reading — Free"}
            </button>
            {(subModal.plan==="monthly"||subModal.plan==="annual"||subModal.plan==="alacarte")&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73",textAlign:"center"}}>Payment integration coming soon — free during beta.</p>}
            <button className="b bg" style={{textAlign:"center",display:"block"}} onClick={()=>setSubModal(null)}>Cancel</button>
          </div>
        </div></div>;
      })()}

      {/* ═══ SETTINGS MODAL ═══ */}
      {settingsFor&&(()=>{
        const sub=getSub(settingsFor); const b=BOOKS.find(x=>x.id===settingsFor);
        if(!sub||!b) return null;
        const [sf,setSf] = [sub, (fn)=>saveSubs(subs.map(s=>s.bookId===settingsFor?fn(s):s))];
        return <div className="mod-bg" onClick={e=>e.target===e.currentTarget&&setSettingsFor(null)}><div className="mod">
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600,marginBottom:12}}>Settings — {b.title}</h2>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Email</label>
              <input value={sf.email} onChange={e=>setSf(s=>({...s,email:e.target.value}))} />
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:6}}>Delivery days</label>
              <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                {DAYS.map((d,i)=>(
                  <button key={i} className={`dayB ${sf.scheduleDays?.includes(i)?"on":""}`} onClick={()=>setSf(s=>{
                    const cur=s.scheduleDays||[];
                    return {...s, scheduleDays: cur.includes(i)?cur.filter(x=>x!==i):[...cur,i].sort((a,b)=>a-b)};
                  })}>{d}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Chapters per delivery</label>
              <div style={{display:"flex",gap:6}}>
                {[1,2,3,4,5].map(n=><button key={n} onClick={()=>setSf(s=>({...s,chaptersPerDelivery:n}))} style={{flex:1,padding:"8px 0",borderRadius:6,border:`1.5px solid ${sf.chaptersPerDelivery===n?"#6B1D2A":"#DDD5CA"}`,background:sf.chaptersPerDelivery===n?"#6B1D2A":"#fff",color:sf.chaptersPerDelivery===n?"#FAF6F0":"#8A7E73",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:sf.chaptersPerDelivery===n?600:400,cursor:"pointer"}}>{n}</button>)}
              </div>
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Friends</label>
              <input value={(sf.friends||[]).join(", ")} onChange={e=>setSf(s=>({...s,friends:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)}))} placeholder="friend@email.com" />
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="b bp" style={{flex:1}} onClick={()=>{setSettingsFor(null);showToast("Settings saved.","success");}}>Save</button>
              <button className="b bo" onClick={()=>setSettingsFor(null)}>Cancel</button>
            </div>
          </div>
        </div></div>;
      })()}

      {/* Footer */}
      {view!=="reader"&&<footer style={{borderTop:"1px solid #DDD5CA",padding:"20px",textAlign:"center"}}>
        <p style={{fontFamily:"'Playfair Display',serif",fontSize:14,marginBottom:3}}>The Chapter</p>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10.5,color:"#8A7E73"}}>Classic literature delivered to your inbox · Text via Wikisource & Claude AI</p>
        {!EMAIL_API_URL&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"#B8964E",marginTop:4}}>Demo mode — chapters delivered to in-app inbox. Deploy api/send.js for real email delivery.</p>}
      </footer>}
    </div>
  );
}

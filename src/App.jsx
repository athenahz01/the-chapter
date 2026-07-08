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
   THE CHAPTER v8 — Classic literature delivered to your inbox
   
   Text: Wikisource → Project Gutenberg (/api/gutenberg) → Claude fallback
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
// Cole's curated list, organized by author. Books with `wsPage` use Wikisource
// directly; books with wsPage:null fall back to Claude (requires
// ANTHROPIC_API_KEY env var on the server). All books work either way.
const BOOKS = [
  // ─── CHARLES DICKENS (15) ────────────────────────────────────
  { id:"pickwick", gid:580, title:"The Pickwick Papers", author:"Charles Dickens", year:1837, genre:"Comic Fiction", chapters:57, wsPage:null,
    cover:{ accent:"#5A4A2A", motif:"P" }, group:"Charles Dickens" },
  { id:"oliver", gid:47530, title:"Oliver Twist", author:"Charles Dickens", year:1838, genre:"Social Novel", chapters:53,
    // Three volumes: I (Ch I-XXII), II (XXIII-XXXVII), III (XXXVIII-LIII).
    wsPage:(n)=>{
      const ROM=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIII","XXIX","XXX","XXXI","XXXII","XXXIII","XXXIV","XXXV","XXXVI","XXXVII","XXXVIII","XXXIX","XL","XLI","XLII","XLIII","XLIV","XLV","XLVI","XLVII","XLVIII","XLIX","L","LI","LII","LIII"];
      let vol;
      if (n <= 22) vol = 1;
      else if (n <= 37) vol = 2;
      else if (n <= 53) vol = 3;
      else return null;
      return `Oliver_Twist_(1838)/Volume_${vol}/Chapter_${ROM[n]}`;
    },
    cover:{ accent:"#3A2A1A", motif:"O" }, group:"Charles Dickens", featured:true },
  { id:"nickleby", gid:967, title:"Nicholas Nickleby", author:"Charles Dickens", year:1839, genre:"Picaresque", chapters:65, wsPage:null,
    cover:{ accent:"#4A3A2A", motif:"N" }, group:"Charles Dickens" },
  { id:"oldcuriosity", gid:700, title:"The Old Curiosity Shop", author:"Charles Dickens", year:1841, genre:"Sentimental Fiction", chapters:73, wsPage:null,
    cover:{ accent:"#3A2A3A", motif:"C" }, group:"Charles Dickens" },
  { id:"barnaby", gid:917, title:"Barnaby Rudge", author:"Charles Dickens", year:1841, genre:"Historical Fiction", chapters:82, wsPage:null,
    cover:{ accent:"#4A2A2A", motif:"B" }, group:"Charles Dickens" },
  { id:"chuzzlewit", gid:968, title:"Martin Chuzzlewit", author:"Charles Dickens", year:1844, genre:"Picaresque", chapters:54, wsPage:null,
    cover:{ accent:"#5A3A2A", motif:"M" }, group:"Charles Dickens" },
  { id:"dombey", gid:821, title:"Dombey and Son", author:"Charles Dickens", year:1848, genre:"Family Saga", chapters:62, wsPage:null,
    cover:{ accent:"#3A3A4A", motif:"D" }, group:"Charles Dickens" },
  { id:"copperfield", gid:766, title:"David Copperfield", author:"Charles Dickens", year:1850, genre:"Bildungsroman", chapters:64, wsPage:null,
    cover:{ accent:"#2A3A4A", motif:"D" }, group:"Charles Dickens", featured:true },
  { id:"bleakhouse", gid:1023, title:"Bleak House", author:"Charles Dickens", year:1853, genre:"Mystery", chapters:67, wsPage:null,
    cover:{ accent:"#1A1A2A", motif:"B" }, group:"Charles Dickens" },
  { id:"hardtimes", gid:786, title:"Hard Times", author:"Charles Dickens", year:1854, genre:"Social Novel", chapters:37, wsPage:null,
    cover:{ accent:"#2A2A2A", motif:"H" }, group:"Charles Dickens" },
  { id:"dorrit", gid:963, title:"Little Dorrit", author:"Charles Dickens", year:1857, genre:"Social Novel", chapters:70, wsPage:null,
    cover:{ accent:"#3A2A4A", motif:"L" }, group:"Charles Dickens" },
  { id:"ttc", gid:98, title:"A Tale of Two Cities", author:"Charles Dickens", year:1859, genre:"Historical Fiction", chapters:45,
    wsPage:(n)=>{
      const ROM=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV"];
      let book, ch;
      if (n <= 6) { book = "Book_the_First"; ch = n; }
      else if (n <= 30) { book = "Book_the_Second"; ch = n - 6; }
      else if (n <= 45) { book = "Book_the_Third"; ch = n - 30; }
      else return null;
      return `A_Tale_of_Two_Cities/${book}/Chapter_${ROM[ch]}`;
    },
    cover:{ accent:"#3E2723", motif:"T" }, group:"Charles Dickens", featured:true },
  { id:"ge", gid:1400, title:"Great Expectations", author:"Charles Dickens", year:1861, genre:"Coming of Age", chapters:59,
    wsPage:(n)=>{const ROM=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIII","XXIX","XXX","XXXI","XXXII","XXXIII","XXXIV","XXXV","XXXVI","XXXVII","XXXVIII","XXXIX","XL","XLI","XLII","XLIII","XLIV","XLV","XLVI","XLVII","XLVIII","XLIX","L","LI","LII","LIII","LIV","LV","LVI","LVII","LVIII","LIX"]; return ROM[n]?`Great_Expectations_(1890)/Chapter_${ROM[n]}`:null;},
    cover:{ accent:"#1A2632", motif:"G" }, group:"Charles Dickens", featured:true },
  { id:"mutual", gid:883, title:"Our Mutual Friend", author:"Charles Dickens", year:1865, genre:"Social Novel", chapters:67, wsPage:null,
    cover:{ accent:"#2A3A2A", motif:"O" }, group:"Charles Dickens" },
  { id:"drood", gid:564, title:"The Mystery of Edwin Drood", author:"Charles Dickens", year:1870, genre:"Mystery", chapters:23, wsPage:null,
    cover:{ accent:"#1A2A2A", motif:"E" }, group:"Charles Dickens" },
  { id:"cc", gid:46, title:"A Christmas Carol", author:"Charles Dickens", year:1843, genre:"Novella", chapters:5,
    wsPage:(n)=>`A_Christmas_Carol_(Dickens,_1843)/Stave_${n}`,
    cover:{ accent:"#1A3A2A", motif:"C" }, group:"Charles Dickens" },

  // ─── ALEXANDRE DUMAS (10) ────────────────────────────────────
  { id:"mc", gid:1184, title:"The Count of Monte Cristo", author:"Alexandre Dumas", year:1844, genre:"Adventure", chapters:117, wsPage:null,
    cover:{ accent:"#1A3A4A", motif:"M" }, group:"Alexandre Dumas", featured:true },
  { id:"musketeers", gid:1257, title:"The Three Musketeers", author:"Alexandre Dumas", year:1844, genre:"Adventure", chapters:67, wsPage:null,
    cover:{ accent:"#4A1A1A", motif:"3" }, group:"Alexandre Dumas", featured:true },
  { id:"twentyyears", gid:1259, title:"Twenty Years After", author:"Alexandre Dumas", year:1845, genre:"Adventure", chapters:78, wsPage:null,
    cover:{ accent:"#3A1A2A", motif:"X" }, group:"Alexandre Dumas" },
  { id:"bragelonne", gid:18997, title:"The Vicomte of Bragelonne", author:"Alexandre Dumas", year:1847, genre:"Adventure", chapters:75, wsPage:null,
    cover:{ accent:"#2A1A3A", motif:"V" }, group:"Alexandre Dumas" },
  { id:"ironmask", gid:2759, title:"The Man in the Iron Mask", author:"Alexandre Dumas", year:1850, genre:"Adventure", chapters:53, wsPage:null,
    cover:{ accent:"#1A1A1A", motif:"I" }, group:"Alexandre Dumas" },
  { id:"blacktulip", gid:965, title:"The Black Tulip", author:"Alexandre Dumas", year:1850, genre:"Historical Fiction", chapters:30, wsPage:null,
    cover:{ accent:"#1A1A2A", motif:"B" }, group:"Alexandre Dumas" },
  { id:"queensnecklace", gid:20122, title:"The Queen's Necklace", author:"Alexandre Dumas", year:1849, genre:"Historical Fiction", chapters:120, wsPage:null,
    cover:{ accent:"#3A2A1A", motif:"Q" }, group:"Alexandre Dumas" },
  { id:"balsamo", gid:45822, title:"Joseph Balsamo", author:"Alexandre Dumas", year:1846, genre:"Historical Fiction", chapters:135, wsPage:null,
    cover:{ accent:"#2A2A3A", motif:"J" }, group:"Alexandre Dumas" },
  { id:"corsican", gid:41881, title:"The Corsican Brothers", author:"Alexandre Dumas", year:1844, genre:"Drama", chapters:11, wsPage:null,
    cover:{ accent:"#3A3A2A", motif:"C" }, group:"Alexandre Dumas" },
  // NOTE: "The Knight of Sainte-Hermine" removed — the French original is
  // public domain but the only English translation dates from 2008 and is
  // still under copyright. We cannot serve it.

  // ─── FYODOR DOSTOEVSKY (8) ───────────────────────────────────
  { id:"crime", gid:2554, title:"Crime and Punishment", author:"Fyodor Dostoevsky", year:1866, genre:"Psychological Fiction", chapters:41, wsPage:null,
    cover:{ accent:"#3A1A1A", motif:"C" }, group:"Fyodor Dostoevsky", featured:true },
  { id:"idiot", gid:2638, title:"The Idiot", author:"Fyodor Dostoevsky", year:1869, genre:"Philosophical Fiction", chapters:46, wsPage:null,
    cover:{ accent:"#2A1A2A", motif:"I" }, group:"Fyodor Dostoevsky" },
  { id:"demons", gid:8117, title:"Demons", author:"Fyodor Dostoevsky", year:1872, genre:"Political Fiction", chapters:43, wsPage:null,
    gq:"The Possessed Dostoyevsky", // Garnett's PD translation title on Gutenberg
    cover:{ accent:"#1A1A1A", motif:"D" }, group:"Fyodor Dostoevsky" },
  { id:"karamazov", gid:28054, title:"The Brothers Karamazov", author:"Fyodor Dostoevsky", year:1880, genre:"Philosophical Fiction", chapters:96, wsPage:null,
    cover:{ accent:"#2A2A3A", motif:"K" }, group:"Fyodor Dostoevsky", featured:true },
  { id:"underground", gid:600, title:"Notes from the Underground", author:"Fyodor Dostoevsky", year:1864, genre:"Novella", chapters:21, wsPage:null,
    cover:{ accent:"#2A2A1A", motif:"U" }, group:"Fyodor Dostoevsky" },
  { id:"gambler", gid:2197, title:"The Gambler", author:"Fyodor Dostoevsky", year:1867, genre:"Novella", chapters:17, wsPage:null,
    cover:{ accent:"#3A2A1A", motif:"G" }, group:"Fyodor Dostoevsky" },
  // NOTE: "The Adolescent"/"A Raw Youth" removed — no public-domain English text on Gutenberg.
  { id:"poorfolk", gid:2302, title:"Poor Folk", author:"Fyodor Dostoevsky", year:1846, genre:"Epistolary", chapters:1, wsPage:null,
    cover:{ accent:"#2A3A3A", motif:"P" }, group:"Fyodor Dostoevsky" },

  // ─── LEO TOLSTOY (4) ─────────────────────────────────────────
  { id:"warpeace", gid:2600, title:"War and Peace", author:"Leo Tolstoy", year:1869, genre:"Historical Fiction", chapters:361, wsPage:null,
    cover:{ accent:"#2A3A2A", motif:"W" }, group:"Leo Tolstoy", featured:true },
  { id:"karenina", gid:1399, title:"Anna Karenina", author:"Leo Tolstoy", year:1877, genre:"Realist Fiction", chapters:239, wsPage:null,
    cover:{ accent:"#3A2A2A", motif:"A" }, group:"Leo Tolstoy", featured:true },
  { id:"cossacks", gid:4761, title:"The Cossacks", author:"Leo Tolstoy", year:1863, genre:"Novella", chapters:42, wsPage:null,
    cover:{ accent:"#3A3A1A", motif:"C" }, group:"Leo Tolstoy" },
  { id:"resurrection", gid:1938, title:"Resurrection", author:"Leo Tolstoy", year:1899, genre:"Realist Fiction", chapters:129, wsPage:null,
    cover:{ accent:"#2A1A3A", motif:"R" }, group:"Leo Tolstoy" },

  // ─── VICTOR HUGO (3) ─────────────────────────────────────────
  { id:"miserables", gid:135, title:"Les Misérables", author:"Victor Hugo", year:1862, genre:"Historical Fiction", chapters:365, wsPage:null,
    cover:{ accent:"#1A2A3A", motif:"M" }, group:"Victor Hugo", featured:true },
  { id:"hunchback", gid:2610, title:"The Hunchback of Notre-Dame", author:"Victor Hugo", year:1831, genre:"Gothic Fiction", chapters:59, wsPage:null,
    gq:"Notre-Dame de Paris Hugo", // Gutenberg's title for the Hapgood translation
    cover:{ accent:"#2A1A2A", motif:"H" }, group:"Victor Hugo" },
  { id:"toilers", gid:32338, title:"Toilers of the Sea", author:"Victor Hugo", year:1866, genre:"Adventure", chapters:64, wsPage:null,
    cover:{ accent:"#1A3A4A", motif:"T" }, group:"Victor Hugo" },

  // ─── WILKIE COLLINS (6) ──────────────────────────────────────
  { id:"womaninwhite", gid:583, title:"The Woman in White", author:"Wilkie Collins", year:1859, genre:"Mystery", chapters:120, wsPage:null,
    cover:{ accent:"#3A3A4A", motif:"W" }, group:"Wilkie Collins" },
  { id:"moonstone", gid:155, title:"The Moonstone", author:"Wilkie Collins", year:1868, genre:"Detective Fiction", chapters:44, wsPage:null,
    cover:{ accent:"#2A2A4A", motif:"M" }, group:"Wilkie Collins" },
  { id:"noname", gid:1438, title:"No Name", author:"Wilkie Collins", year:1862, genre:"Sensation Novel", chapters:54, wsPage:null,
    cover:{ accent:"#3A2A3A", motif:"N" }, group:"Wilkie Collins" },
  { id:"armadale", gid:1895, title:"Armadale", author:"Wilkie Collins", year:1866, genre:"Sensation Novel", chapters:60, wsPage:null,
    cover:{ accent:"#1A3A2A", motif:"A" }, group:"Wilkie Collins" },
  { id:"lawlady", gid:26481, title:"The Law and the Lady", author:"Wilkie Collins", year:1875, genre:"Detective Fiction", chapters:52, wsPage:null,
    cover:{ accent:"#3A2A1A", motif:"L" }, group:"Wilkie Collins" },
  { id:"missfinch", gid:3632, title:"Poor Miss Finch", author:"Wilkie Collins", year:1872, genre:"Sensation Novel", chapters:50, wsPage:null,
    cover:{ accent:"#2A3A1A", motif:"P" }, group:"Wilkie Collins" },

  // ─── HENRY JAMES (5) ─────────────────────────────────────────
  { id:"portrait", gid:2833, title:"The Portrait of a Lady", author:"Henry James", year:1881, genre:"Realist Fiction", chapters:55, wsPage:null,
    cover:{ accent:"#3A2A2A", motif:"P" }, group:"Henry James" },
  { id:"wings", gid:29452, title:"The Wings of the Dove", author:"Henry James", year:1902, genre:"Psychological Fiction", chapters:38, wsPage:null,
    cover:{ accent:"#2A3A3A", motif:"W" }, group:"Henry James" },
  { id:"ambassadors", gid:432, title:"The Ambassadors", author:"Henry James", year:1903, genre:"Psychological Fiction", chapters:36, wsPage:null,
    cover:{ accent:"#3A3A2A", motif:"A" }, group:"Henry James" },
  { id:"goldenbowl", gid:4264, title:"The Golden Bowl", author:"Henry James", year:1904, genre:"Psychological Fiction", chapters:42, wsPage:null,
    cover:{ accent:"#4A3A1A", motif:"G" }, group:"Henry James" },
  { id:"bostonians", gid:19717, title:"The Bostonians", author:"Henry James", year:1886, genre:"Realist Fiction", chapters:42, wsPage:null,
    cover:{ accent:"#2A2A3A", motif:"B" }, group:"Henry James" },

  // ─── MARK TWAIN (5) ──────────────────────────────────────────
  { id:"tomsawyer", gid:74, title:"The Adventures of Tom Sawyer", author:"Mark Twain", year:1876, genre:"Coming of Age", chapters:35, wsPage:null,
    cover:{ accent:"#3A2A1A", motif:"T" }, group:"Mark Twain", featured:true },
  { id:"huck", gid:76, title:"Adventures of Huckleberry Finn", author:"Mark Twain", year:1884, genre:"Picaresque", chapters:43, wsPage:null,
    cover:{ accent:"#2A3A2A", motif:"H" }, group:"Mark Twain", featured:true },
  { id:"connecticut", gid:86, title:"A Connecticut Yankee in King Arthur's Court", author:"Mark Twain", year:1889, genre:"Satire", chapters:44, wsPage:null,
    cover:{ accent:"#1A2A3A", motif:"C" }, group:"Mark Twain" },
  { id:"americanclaimant", gid:3179, title:"The American Claimant", author:"Mark Twain", year:1892, genre:"Satire", chapters:25, wsPage:null,
    cover:{ accent:"#3A3A1A", motif:"A" }, group:"Mark Twain" },
  { id:"joanofarc", gid:2874, title:"Personal Recollections of Joan of Arc", author:"Mark Twain", year:1896, genre:"Historical Fiction", chapters:60, wsPage:null,
    cover:{ accent:"#2A1A2A", motif:"J" }, group:"Mark Twain" },

  // ─── ARTHUR CONAN DOYLE (6) ──────────────────────────────────
  { id:"scarlet", gid:244, title:"A Study in Scarlet", author:"Arthur Conan Doyle", year:1887, genre:"Mystery", chapters:14, wsPage:null,
    cover:{ accent:"#4A1A1A", motif:"S" }, group:"Arthur Conan Doyle" },
  { id:"signoffour", gid:2097, title:"The Sign of the Four", author:"Arthur Conan Doyle", year:1890, genre:"Mystery", chapters:12, wsPage:null,
    cover:{ accent:"#3A2A2A", motif:"4" }, group:"Arthur Conan Doyle" },
  { id:"baskervilles", gid:2852, title:"The Hound of the Baskervilles", author:"Arthur Conan Doyle", year:1902, genre:"Mystery", chapters:15, wsPage:null,
    cover:{ accent:"#1A2A1A", motif:"H" }, group:"Arthur Conan Doyle", featured:true },
  { id:"sher", gid:1661, title:"The Adventures of Sherlock Holmes", author:"Arthur Conan Doyle", year:1892, genre:"Mystery", chapters:12,
    wsPage:(n)=>{const t=["","A_Scandal_in_Bohemia","The_Red-Headed_League","A_Case_of_Identity","The_Boscombe_Valley_Mystery","The_Five_Orange_Pips","The_Man_with_the_Twisted_Lip","The_Adventure_of_the_Blue_Carbuncle","The_Adventure_of_the_Speckled_Band","The_Adventure_of_the_Engineer's_Thumb","The_Adventure_of_the_Noble_Bachelor","The_Adventure_of_the_Beryl_Coronet","The_Adventure_of_the_Copper_Beeches"];return t[n]?`The_Adventures_of_Sherlock_Holmes/${t[n]}`:null;},
    cover:{ accent:"#3A2A1A", motif:"S" }, group:"Arthur Conan Doyle", featured:true },
  { id:"memoirssh", gid:834, title:"The Memoirs of Sherlock Holmes", author:"Arthur Conan Doyle", year:1894, genre:"Mystery", chapters:12, wsPage:null,
    cover:{ accent:"#2A2A1A", motif:"M" }, group:"Arthur Conan Doyle" },
  { id:"returnsh", gid:108, title:"The Return of Sherlock Holmes", author:"Arthur Conan Doyle", year:1905, genre:"Mystery", chapters:13, wsPage:null,
    cover:{ accent:"#2A1A1A", motif:"R" }, group:"Arthur Conan Doyle" },

  // ─── JULES VERNE (6) ─────────────────────────────────────────
  { id:"eightydays", gid:103, title:"Around the World in Eighty Days", author:"Jules Verne", year:1873, genre:"Adventure", chapters:37, wsPage:null,
    cover:{ accent:"#2A3A4A", motif:"8" }, group:"Jules Verne", featured:true },
  { id:"twentyleagues", gid:2488, title:"Twenty Thousand Leagues Under the Seas", author:"Jules Verne", year:1870, genre:"Science Fiction", chapters:46, wsPage:null,
    cover:{ accent:"#1A2A4A", motif:"2" }, group:"Jules Verne" },
  { id:"journey", gid:18857, title:"Journey to the Center of the Earth", author:"Jules Verne", year:1864, genre:"Science Fiction", chapters:45, wsPage:null,
    cover:{ accent:"#2A1A1A", motif:"J" }, group:"Jules Verne" },
  { id:"earthtomoon", gid:83, title:"From the Earth to the Moon", author:"Jules Verne", year:1865, genre:"Science Fiction", chapters:28, wsPage:null,
    cover:{ accent:"#1A1A3A", motif:"M" }, group:"Jules Verne" },
  { id:"mysteriousisland", gid:1268, title:"The Mysterious Island", author:"Jules Verne", year:1875, genre:"Adventure", chapters:62, wsPage:null,
    cover:{ accent:"#2A3A2A", motif:"I" }, group:"Jules Verne" },
  { id:"strogoff", gid:1842, title:"Michael Strogoff", author:"Jules Verne", year:1876, genre:"Adventure", chapters:32, wsPage:null,
    cover:{ accent:"#3A2A2A", motif:"S" }, group:"Jules Verne" },

  // ─── JOSEPH CONRAD (4) ───────────────────────────────────────
  { id:"heartdarkness", gid:219, title:"Heart of Darkness", author:"Joseph Conrad", year:1899, genre:"Novella", chapters:3, wsPage:null,
    cover:{ accent:"#1A1A1A", motif:"H" }, group:"Joseph Conrad", featured:true },
  { id:"lordjim", gid:5658, title:"Lord Jim", author:"Joseph Conrad", year:1900, genre:"Psychological Fiction", chapters:45, wsPage:null,
    cover:{ accent:"#2A1A2A", motif:"L" }, group:"Joseph Conrad" },
  { id:"nostromo", gid:2021, title:"Nostromo", author:"Joseph Conrad", year:1904, genre:"Political Fiction", chapters:39, wsPage:null,
    cover:{ accent:"#2A2A1A", motif:"N" }, group:"Joseph Conrad" },
  { id:"secretagent", gid:974, title:"The Secret Agent", author:"Joseph Conrad", year:1907, genre:"Political Fiction", chapters:13, wsPage:null,
    cover:{ accent:"#1A2A1A", motif:"S" }, group:"Joseph Conrad" },

  // ─── LEGACY CATALOG (kept from original — popular classics not on Cole's list) ─
  { id:"pp", gid:1342, title:"Pride and Prejudice", author:"Jane Austen", year:1813, genre:"Romance", chapters:61,
    wsPage:(n)=>`Pride_and_Prejudice/Chapter_${n}`,
    cover:{ accent:"#3A5A3A", motif:"P" }, group:"Other Classics", featured:true },
  { id:"je", gid:1260, title:"Jane Eyre", author:"Charlotte Brontë", year:1847, genre:"Gothic Romance", chapters:38,
    wsPage:(n)=>{const rom=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIII","XXIX","XXX","XXXI","XXXII","XXXIII","XXXIV","XXXV","XXXVI","XXXVII","XXXVIII"];return`Jane_Eyre_(1st_edition)/Chapter_${rom[n]}`;},
    cover:{ accent:"#2A3A4A", motif:"J" }, group:"Other Classics", featured:true },
  { id:"mobydick", gid:2701, title:"Moby-Dick", author:"Herman Melville", year:1851, genre:"Adventure", chapters:135, wsPage:null,
    cover:{ accent:"#0F2A38", motif:"W" }, group:"Other Classics", featured:true },
  { id:"frank", gid:84, title:"Frankenstein", author:"Mary Shelley", year:1818, genre:"Gothic Horror", chapters:24, wsPage:null,
    cover:{ accent:"#1A2A3A", motif:"F" }, group:"Other Classics" },
  { id:"drac", gid:345, title:"Dracula", author:"Bram Stoker", year:1897, genre:"Gothic Horror", chapters:27,
    wsPage:(n)=>`Dracula/Chapter_${n}`,
    cover:{ accent:"#0D0D1A", motif:"D" }, group:"Other Classics" },
  { id:"alice", gid:11, title:"Alice in Wonderland", author:"Lewis Carroll", year:1865, genre:"Fantasy", chapters:12,
    wsPage:(n)=>`Alice's_Adventures_in_Wonderland_(1866)/Chapter_${n}`,
    cover:{ accent:"#4A5A6A", motif:"A" }, group:"Other Classics" },
  { id:"ti", gid:120, title:"Treasure Island", author:"R. L. Stevenson", year:1883, genre:"Adventure", chapters:34,
    wsPage:(n)=>`Treasure_Island/Chapter_${n}`,
    cover:{ accent:"#1E3A4A", motif:"T" }, group:"Other Classics" },
  { id:"odyss", gid:1727, title:"The Odyssey", author:"Homer (Butler transl.)", year:-800, genre:"Epic Poetry", chapters:24,
    wsPage:(n)=>`The_Odyssey_(Butler)/Book_${["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV"][n]}`,
    cover:{ accent:"#1A4A5A", motif:"O" }, group:"Other Classics" },
  { id:"war", gid:132, title:"The Art of War", author:"Sun Tzu (Giles transl.)", year:-500, genre:"Philosophy", chapters:13,
    wsPage:(n)=>{const NAMES=["","Laying_Plans","Waging_War","Attack_by_Stratagem","Tactical_Dispositions","Energy","Weak_Points_and_Strong","Maneuvering","Variation_in_Tactics","The_Army_on_the_March","Terrain","The_Nine_Situations","The_Attack_by_Fire","The_Use_of_Spies"]; return NAMES[n]?`The_Art_of_War_(Giles)/${NAMES[n]}`:null;},
    cover:{ accent:"#4A1A1A", motif:"A" }, group:"Other Classics" },
  { id:"med", gid:2680, title:"Meditations", author:"Marcus Aurelius", year:180, genre:"Philosophy", chapters:12, wsPage:null,
    cover:{ accent:"#3A3A5A", motif:"M" }, group:"Other Classics" },
  { id:"prince", gid:1232, title:"The Prince", author:"Niccolò Machiavelli", year:1532, genre:"Political Philosophy", chapters:26,
    wsPage:(n)=>{const ROM=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI"]; return ROM[n]?`The_Prince_(Hill_Thomson)/Chapter_${ROM[n]}`:null;},
    cover:{ accent:"#2A1A1A", motif:"P" }, group:"Other Classics" },
];

// ─── WIKISOURCE FETCHER ────────────────────────────────────────
async function fetchChapterWS(page) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000); // 6s timeout
    // redirects=1 is critical: Wikisource has moved most works to year-stamped
    // titles (e.g. Pride_and_Prejudice → Pride_and_Prejudice_(1817)). Without
    // this flag the API returns the redirect stub and we extract zero text.
    const url = `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=text&format=json&origin=*&redirects=1`;
    const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(timer); if (!r.ok) return null;
    const d = await r.json(); if (!d?.parse?.text?.["*"]) return null;
    const html = d.parse.text["*"];
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Strip chrome — but NOT .prp-pages-output, which is the ProofreadPage
    // wrapper that actually contains the chapter body on modern Wikisource
    // transcluded pages. Also strip the pagenum spans inside it.
    doc.querySelectorAll(".mw-editsection, .noprint, .reference, sup.reference, table, .licensetpl, style, script, .ws-noexport, .pagenum, .ws-pagenum").forEach(el => el.remove());
    // Scope to the ProofreadPage body when present — the section outside it
    // is nav / header templates and should never end up in the chapter text.
    const root = doc.querySelector(".prp-pages-output") || doc.querySelector(".mw-parser-output") || doc.body;
    let text = "";
    root.querySelectorAll("p, div.poem p").forEach(p => {
      const t = p.textContent?.trim();
      // Accept slightly shorter paragraphs — 20 was throwing away real short
      // lines (dialogue, one-line scene breaks). 12 is still enough to filter
      // heading noise like "CHAPTER I." (10 chars).
      if (t && t.length > 12) text += t + "\n\n";
    });
    return text.trim().length > 100 ? text.trim() : null;
  } catch { return null; }
}

// ─── PROJECT GUTENBERG FETCHER (server-side, /api/gutenberg) ───
// Primary text source for books without a per-chapter Wikisource page.
// The serverless function resolves title+author → Gutenberg ID via Gutendex,
// downloads the real ebook text, splits it into chapters, and returns the one
// we asked for. We cache the resolved ID per book so subsequent chapters skip
// the resolution step entirely.
const gidCache = {}; // bookId → gutenberg id (also persisted to storage)

async function fetchChapterGutenberg(b, num) {
  try {
    // Reuse a previously-resolved Gutenberg ID if we have one.
    let gid = gidCache[b.id] || b.gid; // baked catalog id; skips Gutendex (blocked from Vercel egress)
    if (!gid) {
      try { const r = await window.storage.get(`ch7-gid-${b.id}`); if (r?.value) gid = gidCache[b.id] = r.value; } catch {}
    }
    const q = b.gq || `${b.title} ${b.author}`;
    const params = new URLSearchParams({ q, ch: String(num) });
    if (gid) params.set("gid", String(gid));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000); // cold fetch of a big book can take a while
    const r = await fetch(`/api/gutenberg?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.gid && !gidCache[b.id]) {
      gidCache[b.id] = d.gid;
      try { await window.storage.set(`ch7-gid-${b.id}`, String(d.gid)); } catch {}
    }
    return d?.ok && typeof d.text === "string" && d.text.length > 200 ? d.text : null;
  } catch { return null; }
}

// ─── SERVER SUBSCRIPTION SYNC (/api/subscriptions) ──────────────
// When a database is configured on the server, every subscription is
// mirrored there so the daily cron (/api/cron) can deliver chapters without
// a browser tab being open. The server returns a `token` which becomes the
// subscription's cross-device identity (used in unsubscribe links and for
// progress sync). When the server has no DB, calls return {reason:"no-db"}
// and the app keeps working exactly as before — local-only.
const SUBS_API_URL = "/api/subscriptions";

async function serverCreateSub(sub) {
  try {
    const r = await fetch(SUBS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: sub.email, bookId: sub.bookId, plan: sub.plan,
        scheduleDays: sub.scheduleDays, chaptersPerDelivery: sub.chaptersPerDelivery,
        friends: sub.friends || [], currentChapter: sub.currentChapter || 0,
        lastDeliveryDate: sub.lastDeliveryDate || null,
        readingId: sub.readingId || null, wantQuestions: !!sub.wantQuestions,
        deliveryHour: Number.isInteger(sub.deliveryHour) ? sub.deliveryHour : null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    return d?.ok && d.token ? d.token : null;
  } catch { return null; }
}

async function serverPatchSub(token, fields) {
  if (!token) return false;
  try {
    const r = await fetch(SUBS_API_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...fields }),
    });
    return (await r.json().catch(() => ({})))?.ok === true;
  } catch { return false; }
}

async function serverDeleteSub(token) {
  if (!token) return false;
  try {
    const r = await fetch(SUBS_API_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return (await r.json().catch(() => ({})))?.ok === true;
  } catch { return false; }
}

async function serverGetSub(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUBS_API_URL}?token=${encodeURIComponent(token)}`);
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d.sub : null;
  } catch { return null; }
}

// ─── STRIPE CHECKOUT (/api/checkout) ────────────────────────────
// Returns {url} to redirect to when Stripe is configured, or
// {reason:"not-configured"} — in which case the caller falls back to the
// free-beta behavior (plan activates without payment).
async function startCheckout(plan, email, bookId) {
  try {
    const r = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, email, bookId }),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch { return { ok: false }; }
}

async function verifyCheckout(sessionId) {
  try {
    const r = await fetch(`/api/checkout?session_id=${encodeURIComponent(sessionId)}`);
    return await r.json().catch(() => ({ ok: false }));
  } catch { return { ok: false }; }
}

// ─── COMMUNAL READINGS (/api/readings, /api/comments, /api/questions) ───
// The primary product is "join our reading of Moby-Dick", not "subscribe to
// a book". A reading is a cohort: shared book, shared rhythm, shared
// discussion. Public readings are free end-to-end (they're the front door);
// private group readings are invite-code cohorts for families, classes, and
// clubs. All of it no-ops gracefully when the server has no database.
async function fetchReadingInfo({ id, code }) {
  try {
    const qs = id ? `id=${encodeURIComponent(id)}` : `code=${encodeURIComponent(code)}`;
    const r = await fetch(`/api/readings?${qs}`);
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d.reading : null;
  } catch { return null; }
}

async function createGroupReading({ bookId, title, deliveryDays, createdBy }) {
  try {
    const r = await fetch("/api/readings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, title, deliveryDays, createdBy }),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch { return { ok: false }; }
}

async function fetchQuestions(bookId, ch) {
  try {
    const r = await fetch(`/api/questions?book=${encodeURIComponent(bookId)}&ch=${ch}`);
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d.questions : null;
  } catch { return null; }
}

async function fetchComments(readingId, ch) {
  try {
    const r = await fetch(`/api/comments?reading=${encodeURIComponent(readingId)}&ch=${ch}`);
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d.comments : null;
  } catch { return null; }
}

async function postComment(readingId, ch, name, body) {
  try {
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reading: readingId, ch, name, body }),
    });
    const d = await r.json().catch(() => ({}));
    return d?.ok ? d.comment : null;
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
async function sendEmail(to, subject, html, text, token) {
  if (!EMAIL_API_URL) return { ok: false, error: "Email not configured" };
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const origin = (typeof window !== "undefined" && window.location?.origin) || "https://the-chapter-one.vercel.app";
    // Token-based link works from any device (server-side pause). Falls back
    // to the in-app hash route when the sub isn't server-registered.
    const unsubscribeUrl = token
      ? `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}`
      : `${origin}/app#unsubscribe`;
    const r = await fetch(EMAIL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipients, subject, html, text,
        // Surfaced as List-Unsubscribe / List-Unsubscribe-Post headers by the
        // serverless function. Required by Gmail/Yahoo bulk-sender rules.
        unsubscribeUrl,
      }),
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

// Reminder-style email: the email carries the book, chapter number, reading
// time, and a prelude that sets the scene — then one button deep-linking into
// the app reader (/app?read=bookId.ch&token=...). The full text lives in the
// app, not the inbox: chapters don't get buried under work email, and the
// small consistent format is kinder to spam filters. The token lets a new
// device adopt the subscription for progress sync on first open.
function emailLinks(book, chapters, token) {
  const origin = (typeof window !== "undefined" && window.location?.origin) || "https://the-chapter-one.vercel.app";
  const t = token ? `&token=${encodeURIComponent(token)}` : "";
  return {
    readUrl: `${origin}/app?read=${encodeURIComponent(book.id)}.${chapters[0].chNum}${t}`,
    manageUrl: `${origin}/app`,
    unsubUrl: token ? `${origin}/api/unsubscribe?token=${encodeURIComponent(token)}` : `${origin}/app#unsubscribe`,
  };
}
function readMinutes(chapters) {
  const words = chapters.reduce((n, ch) => n + (ch.text ? ch.text.split(/\s+/).length : 0), 0);
  return Math.max(1, Math.round(words / 220));
}
function chLabelOf(chapters) {
  return chapters.length === 1 ? `Chapter ${chapters[0].chNum}` : `Chapters ${chapters[0].chNum}–${chapters[chapters.length-1].chNum}`;
}

function buildEmailHTML(book, chapters, token) {
  const { readUrl, manageUrl, unsubUrl } = emailLinks(book, chapters, token);
  const label = chLabelOf(chapters);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;
  const preludeBlock = prelude ? `
  <div style="background:#FBF5EC;border-left:3px solid #B8964E;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0;text-align:left">
    <p style="font-size:10px;color:#B8964E;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-family:Helvetica,sans-serif">A prelude to set the scene</p>
    <p style="font-family:Georgia,serif;font-size:15.5px;line-height:1.7;color:#2C2419;margin:0;font-style:italic">${esc(prelude)}</p>
  </div>` : "";
  const chapterBody = chapters.map(ch => {
    const heading = chapters.length > 1
      ? `<h2 style="font-family:Georgia,serif;font-size:20px;color:#6B1D2A;margin:34px 0 14px;text-align:left">Chapter ${esc(ch.chNum)}</h2>` : "";
    const paras = String(ch.text || "").split(/\n\n+/).filter(p => p.trim()).map((p, i) =>
      `<p style="font-family:Georgia,serif;font-size:17px;line-height:1.85;color:#2C2419;margin:0 0 1.1em;text-align:left;${i > 0 ? "text-indent:1.4em" : ""}">${esc(p.trim())}</p>`
    ).join("");
    return heading + paras;
  }).join('<hr style="border:none;border-top:1px solid #E8E2DA;margin:34px 0">');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF6F0;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8E2DA">
<div style="padding:22px;border-bottom:1px solid #E8E2DA;text-align:center">
  <p style="font-size:11px;letter-spacing:4px;color:#8A7E73;margin:0;text-transform:uppercase">T H E &ensp; C H A P T E R</p>
</div>
<div style="padding:34px 28px;text-align:center">
  <p style="font-size:12px;color:#B8964E;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px">Your chapter is ready</p>
  <h1 style="font-family:Georgia,serif;font-size:26px;color:#1A1612;margin:0 0 6px">${esc(book.title)}</h1>
  <p style="font-size:14px;color:#8A7E73;margin:0 0 4px;font-style:italic">by ${esc(book.author)}</p>
  <p style="font-size:13px;color:#8A7E73;margin:14px 0 0">${esc(label)} of ${esc(book.chapters)} &nbsp;·&nbsp; about ${mins} min</p>
  ${preludeBlock}
  <div style="text-align:left;margin:26px 0 0">${chapterBody}</div>
  <div style="margin:34px 0 0;padding-top:24px;border-top:1px solid #E8E2DA">
    <a href="${readUrl}" style="display:inline-block;background:#6B1D2A;color:#FAF6F0;text-decoration:none;padding:12px 30px;border-radius:6px;font-size:14px">Open in the app →</a>
    <p style="font-size:12px;color:#B0A79A;margin:14px 0 0">Track your progress, adjust your schedule, or join the discussion.</p>
  </div>
</div>
<div style="padding:18px 24px;border-top:1px solid #E8E2DA;text-align:center;background:#FAF6F0">
  <p style="font-size:11px;color:#8A7E73;margin:0 0 6px">Sent by The Chapter · Classic literature, chapter by chapter</p>
  <p style="font-size:11px;color:#8A7E73;margin:0">
    <a href="${manageUrl}" style="color:#8A7E73;text-decoration:underline">Manage subscriptions</a>
    &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#8A7E73;text-decoration:underline">Unsubscribe</a>
  </p>
</div>
</div></body></html>`;
}

function buildEmailText(book, chapters, token) {
  const { readUrl, unsubUrl } = emailLinks(book, chapters, token);
  const label = chLabelOf(chapters);
  const mins = readMinutes(chapters);
  const prelude = chapters[0]?.prelude;
  let out = `Your chapter is ready\n\n${book.title} by ${book.author}\n${label} of ${book.chapters} · about ${mins} min\n`;
  if (prelude) out += `\nA prelude to set the scene:\n${prelude}\n`;
  out += `\n${"─".repeat(40)}\n\n`;
  out += chapters.map(ch => (chapters.length > 1 ? `Chapter ${ch.chNum}\n\n` : "") + String(ch.text || "").trim()).join(`\n\n${"─".repeat(40)}\n\n`);
  out += `\n\n${"─".repeat(40)}\nContinue in the app: ${readUrl}\nUnsubscribe: ${unsubUrl}`;
  return out;
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
// Generates a clean, typographic cover using only an accent color + a single
// motif letter. No external images = nothing to break, nothing to wait on.
//
// `bare` mode: omits the title and author text inside the SVG. Use this when
// the cover is shown alongside a separately-rendered title label (e.g. card
// thumbnails, inbox items, modal previews) — otherwise the title appears
// twice. `bare` defaults to true on small thumbnails, false on standalone.
function GenCover({ title, author, accent, motif, w, h, bare }) {
  const bg = accent || "#3A3A3A";
  const motifChar = motif || (title?.[0] || "B").toUpperCase();
  // Auto-bare for thumbnails — at small sizes title text is illegible anyway.
  const isBare = bare ?? (w < 140);
  // Motif scales with available space. In bare mode it can grow larger
  // since there's no title text taking up the bottom half.
  const motifSize = isBare
    ? Math.min(w, h) * 0.55
    : (w < 120 ? 36 : (w < 200 ? 56 : 84));
  const motifY = isBare ? h * 0.55 : h * 0.42;
  // Bare mode: just the motif + a thin gold rule beneath, no text.
  const titleClipped = title.length > 38 ? title.slice(0, 36).trim() + "…" : title;
  const titleSize = w < 120 ? 9 : (w < 200 ? 11 : 14);
  const authorSize = w < 120 ? 7 : (w < 200 ? 8 : 10);
  const ruleY = isBare ? h * 0.78 : h * 0.62;
  const titleY = h * 0.78;
  const authorY = h * 0.88;
  const textBlock = isBare ? '' : `
    <text x="${w/2}" y="${titleY}" text-anchor="middle" fill="rgba(255,255,255,0.95)"
      font-family="Playfair Display, Georgia, serif" font-size="${titleSize}" font-weight="600">${escXml(titleClipped)}</text>
    <text x="${w/2}" y="${authorY}" text-anchor="middle" fill="rgba(255,255,255,0.62)"
      font-family="DM Sans, sans-serif" font-size="${authorSize}" font-style="italic">${escXml(author)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${bg}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${bg}" stop-opacity="0.7"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="${w*0.06}" y="${h*0.05}" width="${w*0.88}" height="${h*0.9}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
    <text x="${w/2}" y="${motifY}" text-anchor="middle" fill="rgba(255,255,255,0.92)"
      font-family="Playfair Display, Georgia, serif" font-size="${motifSize}" font-weight="700"
      dominant-baseline="middle">${motifChar}</text>
    <line x1="${w*0.30}" y1="${ruleY}" x2="${w*0.70}" y2="${ruleY}" stroke="rgba(184,150,78,0.85)" stroke-width="0.8"/>${textBlock}
  </svg>`;
  return <img src={`data:image/svg+xml,${encodeURIComponent(svg)}`} alt={title} style={{width:w,height:h,display:"block"}} />;
}

function escXml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function CoverImg({ book, style, w, h, bare }) {
  const cover = book.cover || { accent: book.color || "#3A3A3A", motif: book.title?.[0] };
  return (
    <div style={{...style, width: w, height: h}}>
      <GenCover title={book.title} author={book.author} accent={cover.accent} motif={cover.motif} w={w||80} h={h||110} bare={bare} />
    </div>
  );
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
  // Draft copy of the subscription being edited in the settings modal. We keep
  // this separate from `subs` so Cancel discards changes — the previous
  // implementation wrote on every keystroke and Cancel was a no-op.
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [userPlan, setUserPlan] = useState("free"); // "free" | "monthly" | "annual"
  const [unsubMode, setUnsubMode] = useState(false); // arrived via email #unsubscribe link
  const [installEvt, setInstallEvt] = useState(null); // PWA install prompt, when the browser offers one
  const [grpModal, setGrpModal] = useState(null); // private group reading creation

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
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
    try { const r = await window.storage.get("ch7-plan"); if (r?.value) { setUserPlan(r.value); planRef.current = r.value; } } catch {}

    // ─── Cross-device progress sync ───
    // The cron advances current_chapter server-side while no tab is open.
    // Pull the authoritative counters for server-managed subs so the local
    // progress bars and "next chapter" pointers match what was emailed.
    try {
      const r = await window.storage.get("ch7-subs");
      const local = r?.value ? JSON.parse(r.value) : [];
      const managed = local.filter(s => s.token);
      if (managed.length) {
        const fresh = await Promise.all(managed.map(s => serverGetSub(s.token)));
        let changed = false;
        const merged = local.map(s => {
          const f = s.token ? fresh[managed.findIndex(m => m.token === s.token)] : null;
          if (!f) return s;
          if (f.currentChapter > (s.currentChapter || 0) || f.paused !== s.paused) {
            changed = true;
            return { ...s, currentChapter: Math.max(s.currentChapter || 0, f.currentChapter), paused: f.paused };
          }
          return s;
        });
        if (changed) {
          setSubs(merged); subsRef.current = merged;
          try { await window.storage.set("ch7-subs", JSON.stringify(merged)); } catch {}
        }
      }
    } catch {}
  })(); }, []);

  // ─── URL params (from landing page CTA) ───
  useEffect(() => {
    // #unsubscribe arrives from the List-Unsubscribe link in every email.
    // Subscriptions live in this browser's storage, so the best we can do
    // client-side is route to My Books and offer a one-click pause-all.
    if (window.location.hash === "#unsubscribe") {
      setView("mybooks");
      setUnsubMode(true);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    const params = new URLSearchParams(window.location.search);

    // ─── Stripe checkout return ───
    // The plan is applied only after server-side verification of the session
    // (the client never asserts "I paid" — Stripe does, via /api/checkout).
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout === "success" && sessionId) {
      (async () => {
        const d = await verifyCheckout(sessionId);
        if (d?.ok && (d.plan === "monthly" || d.plan === "annual")) {
          svPlan(d.plan);
          showToast("★ Premium activated. All books, all chapters. Thank you!", "success");
        } else if (d?.ok && d.plan === "alacarte" && d.bookId) {
          try {
            // Read subs straight from storage — state may not be hydrated yet.
            const r = await window.storage.get("ch7-subs");
            const cur = r?.value ? JSON.parse(r.value) : [];
            const upd = cur.map(s => s.bookId === d.bookId ? { ...s, plan: "alacarte" } : s);
            await saveSubs(upd);
            const s = upd.find(x => x.bookId === d.bookId);
            if (s?.token) serverPatchSub(s.token, { plan: "alacarte" });
          } catch {}
          showToast("★ Book unlocked. Every chapter is yours. Thank you!", "success");
        } else {
          showToast("We couldn't verify the payment. If you were charged, please contact support.", "error");
        }
      })();
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (checkout === "cancel") {
      showToast("Checkout canceled. You're still on the free plan.", "info");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    // ─── Deep link from reminder emails: /app?read=bookId.ch&token=… ───
    // Opens the reader directly at the delivered chapter. If the token isn't
    // known locally (new device), adopt the subscription from the server so
    // progress, schedule, and future manage actions work here too.
    const readParam = params.get("read");
    const deepToken = params.get("token");
    if (readParam) {
      (async () => {
        if (deepToken) {
          try {
            const r = await window.storage.get("ch7-subs");
            const cur = r?.value ? JSON.parse(r.value) : [];
            if (!cur.some(s => s.token === deepToken)) {
              const remote = await serverGetSub(deepToken);
              if (remote) {
                const adopted = {
                  bookId: remote.bookId, email: remote.email, plan: remote.plan,
                  scheduleDays: remote.scheduleDays, chaptersPerDelivery: remote.chaptersPerDelivery,
                  currentChapter: remote.currentChapter, paused: remote.paused,
                  friends: remote.friends || [], lastDeliveryDate: remote.lastDeliveryDate,
                  token: deepToken, serverManaged: true, startedAt: new Date().toISOString(),
                };
                const merged = [...cur.filter(s => s.bookId !== remote.bookId), adopted];
                setSubs(merged); subsRef.current = merged;
                try { await window.storage.set("ch7-subs", JSON.stringify(merged)); } catch {}
                if (remote.email) svEmail(remote.email);
              }
            }
          } catch {}
        }
        const [bid, chStr] = readParam.split(".");
        const b = BOOKS.find(x => x.id === bid);
        const ch = parseInt(chStr, 10);
        if (b && ch >= 1 && ch <= b.chapters) readCh(b, ch);
      })();
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    // ─── Join a communal reading: ?reading=<id> or ?join=<inviteCode> ───
    const readingParam = params.get("reading");
    const joinCode = params.get("join");
    if (readingParam || joinCode) {
      (async () => {
        const rd = await fetchReadingInfo(readingParam ? { id: readingParam } : { code: joinCode });
        if (rd) {
          const b = BOOKS.find(x => x.id === rd.bookId);
          if (b) {
            setBook(b); nav("book");
            setSubModal({
              bookId: b.id, email: userEmail || "", days: rd.deliveryDays || [1,2,3,4,5],
              cpd: 1, friends: "", plan: "free",
              reading: rd, sendNow: true, wantQ: true, deliveryHour: null,
            });
          }
        } else {
          showToast(joinCode ? "That invite link isn't valid." : "That reading couldn't be found.", "error");
        }
      })();
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const email = params.get("email");
    const bookId = params.get("book");
    if (bookId) {
      const b = BOOKS.find(x => x.id === bookId);
      if (b) {
        setBook(b);
        setView("book");
        setTimeout(() => {
          setSubModal({ bookId: b.id, email: email || userEmail || "", days: [1, 3, 5], cpd: 1, friends: "", plan: "free" });
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
  // planRef is updated synchronously here (not just via the useEffect sync)
  // because deliverChapters reads planRef.current — a user who picks a paid
  // plan and subscribes in the same click would otherwise be gated at the
  // free-trial cap for their very first delivery.
  const svPlan = async (p) => { setUserPlan(p); planRef.current = p; try { await window.storage.set("ch7-plan", p); } catch {} };
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

  // ─── Subscription mutations (local + server mirror) ───
  const togglePause = (bookId) => {
    const s = subs.find(x=>x.bookId===bookId); if(!s) return;
    const paused = !s.paused;
    saveSubs(subs.map(x=>x.bookId===bookId?{...x,paused}:x));
    if(s.token) serverPatchSub(s.token,{paused}); // fire-and-forget
  };
  const removeSub = (bookId) => {
    const s = subs.find(x=>x.bookId===bookId);
    saveSubs(subs.filter(x=>x.bookId!==bookId));
    saveInbox(inbox.filter(x=>x.bookId!==bookId));
    if(s?.token) serverDeleteSub(s.token);
    showToast("Unsubscribed.","info");
  };
  const pauseAll = () => {
    saveSubs(subs.map(s=>({...s,paused:true})));
    subs.forEach(s=>{ if(s.token) serverPatchSub(s.token,{paused:true}); });
  };

  // ─── Chapter discussion (communal readings) ───
  // When the open book belongs to a reading, the reader shows the cohort's
  // shared discussion questions and a per-chapter comment thread.
  const [disc, setDisc] = useState(null); // {questions, comments, draft, busy}
  const [discName, setDiscName] = useState("");
  useEffect(() => { (async () => {
    try { const r = await window.storage.get("ch7-name"); if (r?.value) setDiscName(r.value); } catch {}
  })(); }, []);
  useEffect(() => {
    setDisc(null);
    if (view !== "reader" || !book || !chIdx) return;
    const sub = subs.find(s => s.bookId === book.id);
    if (!sub?.readingId) return;
    let alive = true;
    (async () => {
      const [questions, comments] = await Promise.all([
        sub.wantQuestions !== false ? fetchQuestions(book.id, chIdx) : Promise.resolve(null),
        fetchComments(sub.readingId, chIdx),
      ]);
      if (alive) setDisc({ readingId: sub.readingId, readingTitle: sub.readingTitle, questions, comments: comments || [], draft: "", busy: false });
    })();
    return () => { alive = false; };
  }, [view, book?.id, chIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const genres = useMemo(()=>["All",...new Set(BOOKS.map(b=>b.genre))].sort(),[]);
  const filtered = useMemo(()=>BOOKS.filter(b=>{
    const s=!search||(b.title+b.author).toLowerCase().includes(search.toLowerCase());
    return s&&(genre==="All"||b.genre===genre);
  }),[search,genre]);
  const featured = useMemo(()=>BOOKS.filter(b=>b.featured),[]);
  const getSub = (id) => subs.find(s=>s.bookId===id);
  const unreadCount = inbox.filter(x=>!x.read).length;

  // ─── Fetch helpers ───
  // Source order matters: Wikisource (curated, per-chapter) → Project
  // Gutenberg (real text, whole catalog) → Claude reconstruction (last
  // resort, and flagged as such — a model cannot faithfully reproduce a
  // novel's text, so anything from this path is labeled for the reader).
  const fetchText = async (b,num) => {
    const k=`${b.id}-${num}`; let t = await getT(k);
    if(t) return { text:t, src:"cached" };
    let src = null;
    if(b.wsPage){ const ws=b.wsPage(num); if(ws){ t = await fetchChapterWS(ws); if(t) src="Wikisource"; } }
    if(!t){ t = await fetchChapterGutenberg(b,num); if(t) src="Project Gutenberg"; }
    if(!t){ t = await fetchChapterViaAPI(b.title,b.author,num,`Chapter ${num}`); if(t) src="AI reconstruction"; }
    if(t) await cacheText(k,t);
    return t ? { text:t, src } : null;
  };
  const fetchPre = async (b,num,text) => {
    const k=`${b.id}-${num}`; let p = await getP(k);
    if(p) return p;
    p = await getAIPrelude(text,b.title,num);
    if(p) await cachePre(k,p);
    return p;
  };

  // ═══ DELIVER CHAPTERS (parallel fetch, non-blocking email) ═══
  const deliverChapters = async (sub, startCh, count, opts={}) => {
    const b = BOOKS.find(x=>x.id===sub.bookId);
    if(!b) return { items: [], emailStatus: "no-book" };
    // Read the plan from planRef, not from `isPremium` directly: this
    // function is captured in the checkDeliveries useCallback (empty deps),
    // so a direct read would be frozen at first render — premium users'
    // scheduled deliveries were silently capped at the free-trial limit.
    const curPlan = planRef.current;
    const unlocked = curPlan==="monthly" || curPlan==="annual" || sub.plan==="alacarte" || sub.plan==="paid";
    const maxCh = unlocked ? b.chapters : FREE_CHAPTERS;

    const chNums = [];
    for(let c=0; c<count; c++){
      const ch = startCh+c;
      if(ch>b.chapters || ch>maxCh) break;
      chNums.push(ch);
    }
    if(chNums.length===0) return { items: [], emailStatus: "no-chapters" };

    const results = await Promise.all(chNums.map(ch => fetchText(b, ch)));
    const chapters = chNums.map((ch,i) => ({ chNum:ch, text:results[i]?.text, src:results[i]?.src, prelude:null })).filter(c => c.text);
    if(chapters.length===0) return { items: [], emailStatus: "fetch-failed" };

    // Inbox items immediately so the user can read in-app even if email fails
    const items = chapters.map(ch => ({
      id: `${sub.bookId}-${ch.chNum}-${Date.now()}`,
      bookId: sub.bookId, ch: ch.chNum, text: ch.text, src: ch.src, prelude: null,
      at: new Date().toISOString(), read: false,
    }));

    // ALWAYS await email when the caller is the immediate-subscribe path so
    // we can surface real status to the user. The previous fire-and-forget
    // background block was hiding all email failures behind a success toast.
    let emailStatus = "skipped";
    let emailError = null;

    // Fetch preludes (best-effort; never blocks email if it fails)
    const preludes = await Promise.all(
      chapters.map(ch => fetchPre(b, ch.chNum, ch.text).catch(() => null))
    );
    chapters.forEach((ch,i) => { ch.prelude = preludes[i]; });
    items.forEach((it, i) => { it.prelude = preludes[i] || null; });

    const recipients = [sub.email,...(sub.friends||[])].filter(Boolean);
    if(EMAIL_API_URL && recipients.length > 0){
      const chLabel = chLabelOf(chapters);
      const subject = `📖 Your chapter is ready: ${b.title}, ${chLabel}`;
      const html = buildEmailHTML(b, chapters, sub.token);
      const txt = buildEmailText(b, chapters, sub.token);
      const result = await sendEmail(recipients, subject, html, txt, sub.token);
      if(result.ok){
        emailStatus = "sent";
      } else {
        emailStatus = "failed";
        emailError = result.error || "unknown";
        console.error("Email send failed:", emailError);
      }
    } else if (recipients.length === 0) {
      emailStatus = "no-email";
    }

    return { items, emailStatus, emailError };
  };

  // ═══ SUBSCRIBE ═══
  const subscribe = async (bookId, email, scheduleDays, cpd, friendsStr, plan, opts={}) => {
    const b = BOOKS.find(x=>x.id===bookId); if(!b) return;
    if(email && email !== userEmail) svEmail(email);
    const friends = friendsStr.split(",").map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    const newSub = {
      bookId, email, friends, plan, scheduleDays, chaptersPerDelivery:cpd,
      currentChapter:0, lastDeliveryDate:null,
      startDate: new Date().toISOString(), paused:false,
      // Communal reading membership (public cohort or private group)
      readingId: opts.readingId || null, readingTitle: opts.readingTitle || null,
      inviteUrl: opts.inviteUrl || null, wantQuestions: !!opts.wantQuestions,
      deliveryHour: Number.isInteger(opts.deliveryHour) ? opts.deliveryHour : null,
    };

    // "Send me my first chapter immediately" — checked by default; readers
    // who prefer to wait for the ritual start on their first scheduled day.
    const sendNow = opts.sendNow !== false;
    if (!sendNow) {
      const token = await serverCreateSub(newSub);
      if (token) { newSub.token = token; newSub.serverManaged = true; }
      const updSubsQ = [...subs.filter(s=>s.bookId!==bookId), newSub];
      saveSubs(updSubsQ);
      setSubModal(null);
      showToast(`You're in! ${b.title} begins on your next delivery day.`, "success");
      return;
    }

    // Instant delivery of first batch
    setDelivering(true);
    showToast("Preparing your first chapter…","info");
    const { items, emailStatus, emailError } = await deliverChapters(newSub, 1, cpd);
    newSub.currentChapter = items.length;
    newSub.lastDeliveryDate = new Date().toISOString();

    // Register with the server so the daily cron takes over scheduled
    // deliveries (works even when no tab is open). If the server has no DB
    // this quietly returns null and the in-browser engine keeps handling it.
    const token = await serverCreateSub(newSub);
    if (token) { newSub.token = token; newSub.serverManaged = true; }

    const updSubs = [...subs.filter(s=>s.bookId!==bookId), newSub];
    await saveSubs(updSubs);
    await saveInbox([...items, ...inbox]);
    setDelivering(false);
    setSubModal(null);

    // Honest status messaging — no more silent email failures
    if(items.length === 0){
      showToast(`We couldn't fetch ${b.title}. Try another book or check back later.`, "error");
      return;
    }
    const lbl = items.length===1 ? "Chapter 1" : `Chapters 1–${items.length}`;
    if(emailStatus === "sent"){
      showToast(`📧 ${lbl} of ${b.title} sent to ${email}! Also available in your inbox below.`, "success");
    } else if (emailStatus === "failed") {
      showToast(`📖 ${lbl} of ${b.title} is in your inbox below. Email delivery had an issue (${emailError?.slice(0,80) || "unknown"}). Please contact support if it doesn't arrive in 5 min.`, "warning");
    } else {
      showToast(`📖 ${lbl} of ${b.title} delivered to your inbox!`, "success");
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
      // Server-managed subscriptions are delivered by the daily cron
      // (/api/cron) — skipping them here prevents double-sends.
      if(sub.serverManaged) continue;
      const b = BOOKS.find(x=>x.id===sub.bookId);
      if(!b || sub.currentChapter>=b.chapters) continue;
      const prem = planRef.current==="monthly" || planRef.current==="annual" || sub.plan==="alacarte" || sub.plan==="paid";
      const maxCh = prem ? b.chapters : FREE_CHAPTERS;
      if(sub.currentChapter>=maxCh) continue;
      if(!sub.scheduleDays?.includes(today)) continue;
      if(sub.lastDeliveryDate && new Date(sub.lastDeliveryDate).toDateString()===now.toDateString()) continue;

      const cpd = sub.chaptersPerDelivery||1;
      const result = await deliverChapters(sub, sub.currentChapter+1, cpd);
      const items = result.items;
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
    // Try Project Gutenberg — the real text, covers essentially the whole catalog
    const g = await fetchChapterGutenberg(b,num);
    if(g){ setChText(g); setLoading(false); setTextSrc("Project Gutenberg"); cacheText(k,g); loadPrelude(g); return; }
    // Last resort: Claude reconstruction — labeled honestly, since a model
    // cannot faithfully reproduce the original text.
    const t = await fetchChapterViaAPI(b.title,b.author,num,`Chapter ${num}`);
    if(t){ setChText(t); setTextSrc("Unverified text · may differ from the original"); cacheText(k,t); loadPrelude(t); } else setChText("Could not load chapter.");
    setLoading(false);
  };

  const openInboxItem = (item) => {
    const upd = inbox.map(x=>x.id===item.id?{...x,read:true}:x);
    saveInbox(upd); setInboxItem(item); recordRead(); nav("email");
  };

  // Helpers
  const readTime = (t) => t ? Math.max(1,Math.ceil(t.split(/\s+/).length/250)) : 0;
  const curSub = book ? getSub(book.id) : null;
  const timeAgo = (d) => {
    const dt = new Date(d);
    const s = Math.floor((Date.now() - dt.getTime()) / 1000);
    if (s < 60) return "Just now";
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    const days = Math.floor(s / 86400);
    if (days < 30) return `${days}d ago`;
    // After 30 days, show the actual date — "47d ago" is harder to parse than "Mar 12".
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
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
        .toast-success{background:#2D5A27;color:#fff} .toast-info{background:#1A1612;color:#FAF6F0} .toast-error{background:#7A2424;color:#fff} .toast-warning{background:#8A5C24;color:#fff}
        .home-link:hover{color:#1A1612 !important;background:#F5EFE4;border-color:#DDD5CA !important}
        .dayB{width:38px;height:38px;border-radius:50%;border:1.5px solid #DDD5CA;background:transparent;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:#8A7E73;transition:all .15s;display:flex;align-items:center;justify-content:center}
        .dayB.on{background:#6B1D2A;color:#FAF6F0;border-color:#6B1D2A}
        .dayB:hover{border-color:#6B1D2A}
        .ixC{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid #E8E2DA;cursor:pointer;transition:background .15s;align-items:flex-start}
        .ixC:hover{background:#F5EFE4}
        .ixC.ur{background:#FDFBF7;border-left:3px solid #6B1D2A}
      `}</style>

      {toast && <div className={`toast toast-${toast.type||"info"}`}>{toast.msg}</div>}

      {/* ─── HEADER ───
          Logo and explicit "← Home" link both navigate back to the landing
          page (`/`). This gives users a visible escape from the SPA — the
          previous design had no way back unless you edited the URL. The
          three tabs (Library/Inbox/My Books) remain because each is a
          distinct in-app view; the landing page's "Library" is a marketing
          section, the SPA's "Library" is the full browseable catalog. */}
      <header style={{background:"rgba(250,246,240,.96)",backdropFilter:"blur(8px)",position:"sticky",top:0,zIndex:100,borderBottom:"1px solid #DDD5CA"}}>
        <div style={{maxWidth:1060,margin:"0 auto",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
            <a href="/" style={{textDecoration:"none",cursor:"pointer",display:"flex",alignItems:"baseline",gap:8}} title="Back to home">
              <span style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:800,color:"#1A1612"}}>The Chapter</span>
            </a>
            <a href="/" className="home-link" style={{textDecoration:"none",fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",padding:"4px 10px",borderRadius:12,border:"1px solid transparent",transition:"all .15s",whiteSpace:"nowrap"}}>← Home</a>
          </div>
          <nav style={{display:"flex",gap:4,alignItems:"center"}}>
            {[["library","Library"],["inbox","Inbox"],["mybooks","My Books"]].map(([v,l])=>(
              <button key={v} className="b bg" style={{fontWeight:view===v?600:400,color:view===v?"#1A1612":"#8A7E73",position:"relative"}} onClick={()=>{nav(v);tts.stop();}}>
                {l}
                {v==="inbox"&&unreadCount>0&&<span style={{background:"#6B1D2A",color:"#FAF6F0",borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:700}}>{unreadCount}</span>}
                {v==="mybooks"&&subs.length>0&&<span style={{background:"#DDD5CA",color:"#1A1612",borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:600}}>{subs.length}</span>}
              </button>
            ))}
            {delivering && <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E"}}>📧</span>}
            {installEvt&&<button className="b bg" style={{fontSize:11,color:"#6B1D2A",border:"1px solid #E0C89A",borderRadius:14}} title="Install The Chapter as an app" onClick={async ()=>{
              installEvt.prompt();
              const { outcome } = await installEvt.userChoice.catch(()=>({outcome:"dismissed"}));
              if(outcome==="accepted") showToast("Installed! Find The Chapter on your home screen.","success");
              setInstallEvt(null);
            }}>📲 Install app</button>}
          </nav>
        </div>
      </header>

      {/* ═══ LIBRARY ═══ */}
      {view==="library" && (
        <main style={{maxWidth:1060,margin:"0 auto",padding:"0 20px 60px"}} className="fi">
          <section style={{textAlign:"center",padding:"44px 0 36px",maxWidth:560,margin:"0 auto"}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"#B8964E",marginBottom:12}}>Classic literature, chapter by chapter</p>
            <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:"clamp(24px,3.6vw,36px)",fontWeight:700,lineHeight:1.18,marginBottom:14}}>The greatest stories were never meant to be binged.</h1>
            <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:17,lineHeight:1.6,color:"#8A7E73",fontStyle:"italic"}}>Pick a book. Enter your email. Chapters arrive on your schedule: a reminder in your email, the reading right here, each with a prelude to set the scene. First {FREE_CHAPTERS} chapters free, then ${PRICE_MONTHLY}/mo for unlimited.</p>
          </section>

          <section style={{marginBottom:36}}>
            <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",color:"#8A7E73",marginBottom:10}}>Featured</h2>
            <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:6}}>
              {featured.map((b,i)=>{const sub=getSub(b.id); return (
                <div key={b.id} className="card fu" style={{minWidth:210,maxWidth:230,flex:"0 0 auto",cursor:"pointer",animationDelay:`${i*.06}s`}} onClick={()=>{setBook(b);nav("book");}}>
                  <div style={{height:130,overflow:"hidden",position:"relative"}}>
                    <CoverImg book={b} style={{width:"100%",height:"100%"}} w={240} h={130} bare />
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
            <CoverImg book={book} style={{width:"100%",height:"100%"}} w={800} h={220} bare />
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
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73"}}>{book.chapters} chapters · First {FREE_CHAPTERS} free, then ${PRICE_MONTHLY}/mo · Preludes set the scene · Read with friends</p>
                </div>
              </div>
              <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"13px 20px",fontSize:14}} onClick={()=>setSubModal({bookId:book.id,email:userEmail,days:[1,3,5],cpd:1,friends:"",plan:"free"})}>
                Start Reading · Free
              </button>
              <button className="b bo" style={{width:"100%",justifyContent:"center",padding:"11px 20px",fontSize:13,marginTop:8}} onClick={()=>setGrpModal({bookId:book.id,name:`Reading ${book.title} together`,days:[1,3,5],busy:false,result:null})}>
                👥 Start a group reading · invite friends, family, or your club
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
                  <button className="b bg" onClick={()=>{
                    const s = getSub(book.id);
                    if (s) { setSettingsDraft({email:s.email, scheduleDays:[...(s.scheduleDays||[])], chaptersPerDelivery:s.chaptersPerDelivery||1, friends:[...(s.friends||[])]}); setSettingsFor(book.id); }
                  }}>⚙</button>
                  <button className="b bg" onClick={()=>togglePause(book.id)}>{curSub.paused?"▶":"⏸"}</button>
                </div>
              </div>
              <div className="prg" style={{marginBottom:4}}><div className="prg-f" style={{width:`${Math.round((curSub.currentChapter/book.chapters)*100)}%`}} /></div>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73"}}>Ch. {curSub.currentChapter}/{book.chapters} · {Math.round((curSub.currentChapter/book.chapters)*100)}%</p>
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                {curSub.plan==="free"&&curSub.currentChapter>=FREE_CHAPTERS&&<button className="b bp" onClick={()=>setSubModal({bookId:book.id,email:curSub.email,days:curSub.scheduleDays||[1,3,5],cpd:curSub.chaptersPerDelivery||1,friends:(curSub.friends||[]).join(", "),plan:"monthly",isUpgrade:true})}>Upgrade · ${PRICE_MONTHLY}/mo for unlimited</button>}
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
                        <h3 style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:item.read?400:600}}>{b.title} · Ch. {item.ch}</h3>
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
              {inboxItem.src==="AI reconstruction"&&(
                <div style={{margin:"16px 20px 0",background:"#FBF3E4",borderRadius:6,padding:"10px 14px"}}>
                  <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A5C24"}}>⚠ We couldn't source the verified text for this chapter, so it may differ from the original.</p>
                </div>
              )}
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
            {/* ═══ Communal discussion (readings only) ═══ */}
            {!loading&&chText&&disc&&(
              <div style={{borderTop:`1px solid ${th.bd}`,marginTop:24,paddingTop:24}}>
                {disc.readingTitle&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>{disc.readingTitle} · Chapter {chIdx} discussion</p>}
                {disc.questions&&disc.questions.length>0&&(
                  <div style={{background:th.card||"#FBF5EC",borderRadius:8,padding:"14px 18px",marginBottom:18}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>To discuss</p>
                    {disc.questions.map((q,i)=>(<p key={i} style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15.5,lineHeight:1.6,color:th.fg,marginBottom:6}}>· {q}</p>))}
                  </div>
                )}
                {disc.comments.map(c=>(
                  <div key={c.id} style={{marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${th.bd}`}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,color:th.fg,marginBottom:3}}>{c.name} <span style={{fontWeight:400,color:th.mt}}>· {timeAgo(c.created_at)}</span></p>
                    <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,lineHeight:1.55,color:th.fg}}>{c.body}</p>
                  </div>
                ))}
                {disc.comments.length===0&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:th.mt,marginBottom:12}}>No one has commented on this chapter yet. Be the first.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <input className="inp" placeholder="Your name" value={discName} onChange={e=>setDiscName(e.target.value)} style={{maxWidth:220}} maxLength={40}/>
                  <textarea className="inp" placeholder="Share a thought with your fellow readers…" rows={3} value={disc.draft} onChange={e=>setDisc(d=>({...d,draft:e.target.value}))} maxLength={1000} style={{resize:"vertical",fontFamily:"'DM Sans',sans-serif"}}/>
                  <button className="b bp" disabled={!discName.trim()||!disc.draft.trim()||disc.busy} style={{alignSelf:"flex-start"}} onClick={async ()=>{
                    setDisc(d=>({...d,busy:true}));
                    try { await window.storage.set("ch7-name", discName.trim()); } catch {}
                    const c = await postComment(disc.readingId, chIdx, discName.trim(), disc.draft.trim());
                    if(c) setDisc(d=>({...d,comments:[...d.comments,c],draft:"",busy:false}));
                    else { setDisc(d=>({...d,busy:false})); showToast("Couldn't post, try again.","error"); }
                  }}>Post</button>
                </div>
              </div>
            )}
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
          {unsubMode&&(
            <div style={{background:"#FBF3E4",border:"1px solid #E0C89A",borderRadius:8,padding:"14px 18px",marginBottom:16}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,marginBottom:4}}>Manage your email deliveries</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73",marginBottom:10}}>
                {subs.length>0
                  ? "Pause or remove individual books below, or stop all email deliveries at once."
                  : "No subscriptions found in this browser. Subscriptions are stored on the device where you signed up. Open this link there to manage them, or reply to any chapter email and we'll remove you manually."}
              </p>
              {subs.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="b bp" style={{fontSize:12}} onClick={()=>{pauseAll();setUnsubMode(false);showToast("All deliveries paused. Resume any book below whenever you like.","success");}}>⏸ Pause all deliveries</button>
                <button className="b bg" style={{fontSize:12}} onClick={()=>setUnsubMode(false)}>Dismiss</button>
              </div>}
            </div>
          )}
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
                      <button className="b bg" style={{fontSize:11}} onClick={()=>togglePause(sub.bookId)}>{sub.paused?"▶":"⏸"}</button>
                      <button className="b bg" style={{fontSize:11,color:"#B55"}} onClick={()=>removeSub(sub.bookId)}>✕</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </main>
      )}

      {/* ═══ SUBSCRIBE MODAL ═══ */}
      {/* ═══ CREATE GROUP READING ═══ */}
      {grpModal&&(()=>{
        const gb=BOOKS.find(x=>x.id===grpModal.bookId); if(!gb) return null;
        const DAYS=["Su","Mo","Tu","We","Th","Fr","Sa"];
        return <div className="mod-bg" onClick={e=>e.target===e.currentTarget&&setGrpModal(null)}><div className="mod" style={{maxWidth:440}}>
          {!grpModal.result?(<>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:600,marginBottom:4}}>Start a group reading</h2>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73",marginBottom:16}}>Everyone in your group gets <em>{gb.title}</em> on the same rhythm, with a shared discussion for every chapter. You'll get a private invite link to share.</p>
            <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",display:"block",marginBottom:4}}>Group name</label>
            <input className="inp" value={grpModal.name} onChange={e=>setGrpModal(m=>({...m,name:e.target.value}))} maxLength={80} style={{width:"100%",marginBottom:14}}/>
            <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8A7E73",display:"block",marginBottom:6}}>Chapters arrive on</label>
            <div style={{display:"flex",gap:6,marginBottom:18}}>
              {DAYS.map((d,i)=>(
                <button key={i} onClick={()=>setGrpModal(m=>({...m,days:m.days.includes(i)?m.days.filter(x=>x!==i):[...m.days,i].sort()}))} style={{width:36,height:36,borderRadius:"50%",border:`1.5px solid ${grpModal.days.includes(i)?"#6B1D2A":"#DDD5CA"}`,background:grpModal.days.includes(i)?"#6B1D2A":"#fff",color:grpModal.days.includes(i)?"#FAF6F0":"#1A1612",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{d}</button>
              ))}
            </div>
            <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"12px"}} disabled={!grpModal.name.trim()||!grpModal.days.length||grpModal.busy} onClick={async ()=>{
              setGrpModal(m=>({...m,busy:true}));
              const r = await createGroupReading({ bookId:gb.id, title:grpModal.name.trim(), deliveryDays:grpModal.days, createdBy:userEmail||null });
              if(r?.ok) setGrpModal(m=>({...m,busy:false,result:r}));
              else { setGrpModal(m=>({...m,busy:false})); showToast(r?.reason==="no-db"?"Group readings need the server database, coming soon on this deployment.":"Couldn't create the group, try again.","error"); }
            }}>{grpModal.busy?"Creating…":"Create group & get invite link"}</button>
            <button className="b bg" style={{textAlign:"center",display:"block",marginTop:6}} onClick={()=>setGrpModal(null)}>Cancel</button>
          </>):(<>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:600,marginBottom:4}}>Your group is ready 🎉</h2>
            <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#8A7E73",marginBottom:14}}>Share this link, anyone who opens it joins <em>{grpModal.result.reading.title}</em>:</p>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <input className="inp" readOnly value={grpModal.result.inviteUrl} style={{flex:1,fontSize:11}} onFocus={e=>e.target.select()}/>
              <button className="b bo" onClick={()=>{navigator.clipboard?.writeText(grpModal.result.inviteUrl).then(()=>showToast("Invite link copied!","success")).catch(()=>{});}}>Copy</button>
            </div>
            <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"12px"}} onClick={()=>{
              const rd = { ...grpModal.result.reading, inviteCode: grpModal.result.inviteCode };
              setGrpModal(null);
              setSubModal({ bookId:gb.id, email:userEmail||"", days:rd.deliveryDays||[1,3,5], cpd:1, friends:"", plan:"free", reading:rd, sendNow:true, wantQ:true, deliveryHour:null });
            }}>Join your group now</button>
            <button className="b bg" style={{textAlign:"center",display:"block",marginTop:6}} onClick={()=>setGrpModal(null)}>Done</button>
          </>)}
        </div></div>;
      })()}

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

          {/* Communal reading banner */}
          {subModal.reading&&(
            <div style={{background:"#FBF5EC",border:"1px solid #E0C89A",borderRadius:8,padding:"12px 16px",marginBottom:16}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#B8964E",letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>{subModal.reading.isPublic?"You're joining a reading":"You're joining a group"}</p>
              <p style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:600,marginBottom:2}}>{subModal.reading.title}</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:11.5,color:"#8A7E73"}}>
                {subModal.reading.participants>0?`${subModal.reading.participants.toLocaleString()} reader${subModal.reading.participants===1?"":"s"} so far · `:""}
                {subModal.reading.weeks?`${subModal.reading.weeks} weeks · `:""}
                one chapter per delivery day{subModal.reading.isPublic?" · free, start to finish":""}
              </p>
            </div>
          )}

          {/* Plan toggle (not shown on upgrade, premium, or communal readings) */}
          {!isUp && !isPremium && !subModal.reading && (
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
              {[["free",`Free Trial · ${FREE_CHAPTERS} chapters`,""],["monthly",`$${PRICE_MONTHLY}/month · Unlimited`,"All books, all chapters"],["annual",`$${PRICE_ANNUAL}/year · Save 33%`,"All books · 2 months free"],["alacarte",`$${PRICE_ALACARTE} · This book only`,"One-time, all chapters"]].map(([p,l,sub])=>(
                <button key={p} onClick={()=>setSubModal(m=>({...m,plan:p}))} style={{padding:"10px 14px",border:`1.5px solid ${subModal.plan===p?"#6B1D2A":"#DDD5CA"}`,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,background:subModal.plan===p?"#6B1D2A":"#fff",color:subModal.plan===p?"#FAF6F0":"#1A1612",transition:"all .2s",borderRadius:6,textAlign:"left"}}>
                  <span style={{fontWeight:600}}>{l}</span>
                  {sub&&<span style={{display:"block",fontSize:10,opacity:.7,marginTop:1}}>{sub}</span>}
                </button>
              ))}
            </div>
          )}
          {isPremium && !isUp && (
            <div style={{background:"#EDE7DD",borderRadius:6,padding:10,marginBottom:12,fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B1D2A",fontWeight:600,textAlign:"center"}}>★ Premium · all chapters unlocked</div>
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
                ? <>{subModal.cpd} chapter{subModal.cpd>1?"s":""} on {subModal.days.map(i=>DAYS[i]).join(", ")} · <strong>~{weeksNeeded} week{weeksNeeded!==1&&weeksNeeded!=="∞"?"s":""}</strong>{subModal.plan==="free"?` (first ${FREE_CHAPTERS} free)`:""}</>
                : <span style={{color:"#B55"}}>Select at least one day</span>
              }
            </div>

            {/* Submit */}
            {subModal.reading&&(
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
                <label style={{display:"flex",alignItems:"center",gap:8,fontFamily:"'DM Sans',sans-serif",fontSize:12,cursor:"pointer"}}>
                  <input type="checkbox" checked={subModal.sendNow!==false} onChange={e=>setSubModal(m=>({...m,sendNow:e.target.checked}))} />
                  Send me my first chapter immediately
                </label>
                <label style={{display:"flex",alignItems:"center",gap:8,fontFamily:"'DM Sans',sans-serif",fontSize:12,cursor:"pointer"}}>
                  <input type="checkbox" checked={subModal.wantQ!==false} onChange={e=>setSubModal(m=>({...m,wantQ:e.target.checked}))} />
                  Include discussion questions with each chapter
                </label>
                <div style={{display:"flex",alignItems:"center",gap:8,fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
                  <span style={{color:"#8A7E73"}}>Chapter arrives:</span>
                  {[["Morning",12],["Midday",17],["Evening",23]].map(([l,h])=>(
                    <button key={h} onClick={()=>setSubModal(m=>({...m,deliveryHour:m.deliveryHour===h?null:h}))} style={{padding:"4px 10px",borderRadius:12,border:`1.5px solid ${subModal.deliveryHour===h?"#6B1D2A":"#DDD5CA"}`,background:subModal.deliveryHour===h?"#6B1D2A":"#fff",color:subModal.deliveryHour===h?"#FAF6F0":"#1A1612",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            <button className="b bp" style={{width:"100%",justifyContent:"center",padding:"13px",fontSize:14}} disabled={!subModal.email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subModal.email)||!subModal.days?.length||delivering} onClick={async ()=>{
              const friends = subModal.friends.split(",").map(e=>e.trim()).filter(e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

              // Communal reading joins are free — straight through, no plans.
              if(subModal.reading){
                await subscribe(subModal.bookId, subModal.email, subModal.days, 1, subModal.friends||"", "free", {
                  readingId: subModal.reading.id, readingTitle: subModal.reading.title,
                  inviteUrl: subModal.reading.inviteCode ? `${window.location.origin}/app?join=${subModal.reading.inviteCode}` : null,
                  wantQuestions: subModal.wantQ!==false, sendNow: subModal.sendNow!==false,
                  deliveryHour: subModal.deliveryHour,
                });
                return;
              }

              const paidPlan = ["monthly","annual","alacarte"].includes(subModal.plan);

              // Real payment path — only when Stripe is configured on the
              // server. The subscription (schedule + Chapter 1) is created
              // BEFORE redirecting so nothing is lost if checkout is
              // abandoned; the plan itself is applied on verified return.
              if(paidPlan){
                setDelivering(true);
                const co = await startCheckout(subModal.plan, subModal.email, wb.id);
                if(co?.ok && co.url){
                  if(isUp){
                    const cur = getSub(wb.id);
                    saveSubs(subs.map(s=>s.bookId===wb.id?{...s,email:subModal.email,friends,scheduleDays:subModal.days,chaptersPerDelivery:subModal.cpd}:s));
                    if(cur?.token) serverPatchSub(cur.token,{email:subModal.email,friends,scheduleDays:subModal.days,chaptersPerDelivery:subModal.cpd});
                    if(subModal.email!==userEmail) svEmail(subModal.email);
                  } else {
                    await subscribe(subModal.bookId, subModal.email, subModal.days, subModal.cpd, subModal.friends||"", "free");
                  }
                  showToast("Redirecting to secure checkout…","info");
                  window.location.href = co.url;
                  return;
                }
                setDelivering(false);
                // Stripe not configured → fall through to free-beta behavior.
              }

              if(isUp){
                if(subModal.plan==="monthly"||subModal.plan==="annual") svPlan(subModal.plan);
                const cur = getSub(wb.id);
                saveSubs(subs.map(s=>s.bookId===wb.id?{...s,plan:subModal.plan,email:subModal.email,friends,scheduleDays:subModal.days,chaptersPerDelivery:subModal.cpd}:s));
                if(cur?.token) serverPatchSub(cur.token,{plan:subModal.plan,email:subModal.email,friends,scheduleDays:subModal.days,chaptersPerDelivery:subModal.cpd});
                if(subModal.email!==userEmail) svEmail(subModal.email);
                setSubModal(null);
                showToast(subModal.plan==="monthly"||subModal.plan==="annual"?"★ Premium activated! All books unlocked.":`★ ${wb.title} fully unlocked!`,"success");
              } else {
                if(subModal.plan==="monthly"||subModal.plan==="annual") svPlan(subModal.plan);
                await subscribe(subModal.bookId, subModal.email, subModal.days, subModal.cpd, subModal.friends||"", subModal.plan);
              }
            }}>
              {delivering ? "Preparing…" : subModal.reading
                ? `Join the Reading · Free`
                : isUp
                ? (subModal.plan==="monthly"?`★ Subscribe · $${PRICE_MONTHLY}/mo`:subModal.plan==="annual"?`★ Subscribe · $${PRICE_ANNUAL}/yr`:`★ Unlock · $${PRICE_ALACARTE}`)
                : subModal.plan==="monthly"?`Subscribe · $${PRICE_MONTHLY}/month`
                : subModal.plan==="annual"?`Subscribe · $${PRICE_ANNUAL}/year`
                : subModal.plan==="alacarte"?`Unlock This Book · $${PRICE_ALACARTE}`
                : "Start Reading · Free"}
            </button>
            {(subModal.plan==="monthly"||subModal.plan==="annual"||subModal.plan==="alacarte")&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#8A7E73",textAlign:"center"}}>Payment integration coming soon. Free during beta.</p>}
            <button className="b bg" style={{textAlign:"center",display:"block"}} onClick={()=>setSubModal(null)}>Cancel</button>
          </div>
        </div></div>;
      })()}

      {/* ═══ SETTINGS MODAL ═══ */}
      {settingsFor && settingsDraft && (()=>{
        const b=BOOKS.find(x=>x.id===settingsFor);
        if(!b) return null;
        const sd = settingsDraft;
        const close = () => { setSettingsFor(null); setSettingsDraft(null); };
        const valid = sd.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sd.email) && (sd.scheduleDays||[]).length > 0;
        return <div className="mod-bg" onClick={e=>e.target===e.currentTarget&&close()}><div className="mod">
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:17,fontWeight:600,marginBottom:12}}>Settings · {b.title}</h2>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Email</label>
              <input value={sd.email} onChange={e=>setSettingsDraft(s=>({...s,email:e.target.value}))} />
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:6}}>Delivery days</label>
              <div style={{display:"flex",gap:6,justifyContent:"center"}}>
                {DAYS.map((d,i)=>(
                  <button key={i} className={`dayB ${sd.scheduleDays?.includes(i)?"on":""}`} onClick={()=>setSettingsDraft(s=>{
                    const cur=s.scheduleDays||[];
                    return {...s, scheduleDays: cur.includes(i)?cur.filter(x=>x!==i):[...cur,i].sort((a,b)=>a-b)};
                  })}>{d}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Chapters per delivery</label>
              <div style={{display:"flex",gap:6}}>
                {[1,2,3,4,5].map(n=><button key={n} onClick={()=>setSettingsDraft(s=>({...s,chaptersPerDelivery:n}))} style={{flex:1,padding:"8px 0",borderRadius:6,border:`1.5px solid ${sd.chaptersPerDelivery===n?"#6B1D2A":"#DDD5CA"}`,background:sd.chaptersPerDelivery===n?"#6B1D2A":"#fff",color:sd.chaptersPerDelivery===n?"#FAF6F0":"#8A7E73",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:sd.chaptersPerDelivery===n?600:400,cursor:"pointer"}}>{n}</button>)}
              </div>
            </div>
            <div>
              <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,display:"block",marginBottom:4}}>Friends</label>
              <input value={(sd.friends||[]).join(", ")} onChange={e=>setSettingsDraft(s=>({...s,friends:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)}))} placeholder="friend@email.com" />
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="b bp" style={{flex:1}} disabled={!valid} onClick={()=>{
                const cur = subs.find(s=>s.bookId===settingsFor);
                saveSubs(subs.map(s=>s.bookId===settingsFor?{...s,email:sd.email,scheduleDays:sd.scheduleDays,chaptersPerDelivery:sd.chaptersPerDelivery,friends:sd.friends}:s));
                if(cur?.token) serverPatchSub(cur.token,{email:sd.email,scheduleDays:sd.scheduleDays,chaptersPerDelivery:sd.chaptersPerDelivery,friends:sd.friends});
                close();
                showToast("Settings saved.","success");
              }}>Save</button>
              <button className="b bo" onClick={close}>Cancel</button>
            </div>
          </div>
        </div></div>;
      })()}

      {/* Footer */}
      {view!=="reader"&&<footer style={{borderTop:"1px solid #DDD5CA",padding:"20px",textAlign:"center"}}>
        <p style={{fontFamily:"'Playfair Display',serif",fontSize:14,marginBottom:3}}>The Chapter</p>
        <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:10.5,color:"#8A7E73"}}>Classic literature delivered to your inbox · Text from Wikisource & Project Gutenberg</p>
        {!EMAIL_API_URL&&<p style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,color:"#B8964E",marginTop:4}}>Demo mode · chapters delivered to in-app inbox. Deploy api/send.js for real email delivery.</p>}
      </footer>}
    </div>
  );
}

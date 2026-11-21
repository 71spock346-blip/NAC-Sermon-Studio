/*
 * The verses the sermon names, written out in full.
 *
 * A sermon leans on other verses besides the text word: "He came to us
 * Himself in Jesus Christ (John 1:14)". For the minister who reads from the
 * phone or the paper, the reference alone is not enough: the words should be
 * there to read (Jerome, 2026-11-21: "When the text word is in the sermon
 * put the whole verse in for me to read as reference, not just the book,
 * chapter and verse number"). So every verse a part of the preparation names
 * is written out under that part: under each box of the Prepare form and
 * under Claude's suggestions (prepare.js), in "The sermon" and the sermon
 * notes (pdf.js), on the screen and in Altar mode (read.js, altar.js), and
 * the voice reads them too (speech.js).
 *
 * This module finds the references in a text, puts the Bibles to read them
 * from in order, and keeps their words with the preparation. It is pure (the
 * Bible is handed in), so tools/test_verses.mjs checks it in Node. The words
 * are kept as
 *   s.quotes = { key: {book, chapter, verse, verseEnd, text, short, lang, source, at} }
 * so that they are there offline at the altar and travel with sync. The text
 * word itself is not kept again: where a part names it, its words come from
 * step 1 (s.text), as the minister fetched or typed them.
 */
import { findBook, nearBook } from './books.js';

/** A passage longer than this stays a reference: it is read from the Bible, not written out under a part. */
export const MAX_VERSES = 6;

/*
 * A reference in running text: a book name (with 1, 2 or 3 before it where
 * the book has one, and "of …" after it for the Song of Solomon), then
 * chapter:verse, or "chapter verse 16", with an end verse for a passage.
 * "John 3" alone is a chapter, not a verse, and is left alone.
 */
const REF = /(?<![\p{L}\d])(?:([1-3]|I{1,3})\s*)?(\p{L}[\p{L}.]*(?:\s+(?:of|van)\s+\p{L}+)?)\s*(\d{1,3})\s*(?::|(?<=\s)(?:v|vs|vers|verse|verses)\.?\s*)\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?![\d:])/gu;
/** Verses listed after a reference: "John 3:16, 18, 20-21". A lone number followed by a word is not one ("John 3:16, 2 Corinthians …"). */
const MORE = /\s*,\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3})(?![\d:])|(?![\d:]|\s*\p{L}))/uy;
const ROMAN = { I: '1', II: '2', III: '3' };

/** The book a name in running text means: as typed, a slip of a letter forgiven; else the last word alone ("the Gospel of John"). */
function bookOf(ord, name) {
  const full = (ord ? ord + ' ' : '') + name;
  const last = name.split(/\s+/).pop();
  // a short word in small letters is a word of the sentence ("is 3:16", "he 11:1"), not Isaiah or Hebrews
  if (!ord && last.length < 3 && last === last.toLowerCase()) return null;
  return findBook(full) || nearBook(full) || (last !== name ? findBook(last) : null);
}

/**
 * Every reference with a verse in a text, in order: [{book, chapter, verse,
 * verseEnd, at, match}]. "John 1:14", "(2 Corinthians 5:17)", "Joh 3:16-18",
 * "1 Kor 13:4–7", "Ps. 23:1", "Johannes 3 vers 16", "Openb 21:5".
 */
export function findRefs(text) {
  const out = [];
  const s = String(text || '');
  REF.lastIndex = 0;
  let m;
  while ((m = REF.exec(s))) {
    const book = bookOf(m[1] ? ROMAN[m[1]] || m[1] : '', m[2]);
    if (!book) continue;
    const chapter = parseInt(m[3], 10);
    const push = (from, to) => {
      const verse = parseInt(from, 10), end = to ? parseInt(to, 10) : verse;
      if (!verse || !chapter) return;
      out.push({ book: book.id, chapter, verse, verseEnd: Math.max(verse, end), at: m.index, match: m[0] });
    };
    push(m[4], m[5]);
    MORE.lastIndex = REF.lastIndex;
    let x;
    while ((x = MORE.exec(s))) { push(x[1], x[2]); REF.lastIndex = MORE.lastIndex; }
  }
  return out;
}

/** The key a verse is kept under: "JHN.3.16", or "JHN.3.16-18" for a passage. */
export function quoteKey(ref) {
  return `${ref.book}.${ref.chapter}.${ref.verse}` + (ref.verseEnd && ref.verseEnd !== ref.verse ? `-${ref.verseEnd}` : '');
}

/** Whether a reference is the text word itself, the same verses, with its words in step 1 (s.text). */
export function isWord(ref, s) {
  const w = s && s.ref;
  return !!(w && w.verse && String(s.text || '').trim() && w.book === ref.book && w.chapter === ref.chapter
    && w.verse === ref.verse && (w.verseEnd || w.verse) === (ref.verseEnd || ref.verse));
}

/** The words of the text word as step 1 holds them; one verse without the number the fetched text puts in front of it. */
export function wordText(s) {
  const v = String((s && s.text) || '').trim();
  const r = s && s.ref;
  return r && r.verse && (r.verseEnd || r.verse) === r.verse ? v.replace(new RegExp(`^${r.verse}\\s+(?=\\S)`), '') : v;
}

/**
 * The references a text names that are to be written out under it: with a
 * verse, no longer than MAX_VERSES, each once; with `seen` (a Set of keys)
 * none already in it, and the keys found are added to it. Each carries its `key`.
 */
export function refsToQuote(text, { seen = null } = {}) {
  const out = [];
  for (const r of findRefs(text)) {
    if (r.verseEnd - r.verse + 1 > MAX_VERSES) continue;
    const key = quoteKey(r);
    if ((seen && seen.has(key)) || out.some(x => x.key === key)) continue;
    out.push({ ...r, key });
    if (seen) seen.add(key);
  }
  return out;
}

/**
 * The verses a text names, with their words, in the order the text names
 * them: [{key, book, chapter, verse, verseEnd, text, short, lang, source}].
 * The text word comes from step 1 (s.text, in the translation named there);
 * every other verse from s.quotes. A verse whose words are not there yet is
 * left out.
 */
export function quotesFor(text, s, { seen = null } = {}) {
  const have = (s && s.quotes) || {};
  return refsToQuote(text, { seen }).map(r => {
    if (isWord(r, s)) return { key: r.key, book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd, text: wordText(s), short: String(s.translation || '').trim(), lang: '', source: 'word' };
    const q = have[r.key];
    return q && q.text ? { key: r.key, ...q } : null;
  }).filter(Boolean);
}

/**
 * Every text of a preparation that may name a verse: the boxes of the form
 * (the message's core thought, the notes from the Guide, the introduction,
 * the context, the key words, the cross references, the application, the
 * summary, the conclusion, the illustrations), each main point with the
 * point Claude wove a thought into, and what Claude suggested (the outline,
 * the suggestions), so that the words are at hand wherever a reference shows.
 */
export function textsOf(s) {
  const out = [];
  const add = v => { if (typeof v === 'string' && v.trim()) out.push(v); };
  for (const k of ['core', 'guide', 'intro', 'context', 'keywords', 'crossRefs', 'application', 'summary', 'conclusion', 'illustrations']) add(s[k]);
  for (const p of s.points || []) if (p) { add(p.body); if (p.weave) add(p.weave.body); }
  const a = s.build;
  if (a) {
    add(a.intro && a.intro.text);
    for (const p of a.points || []) if (p) add(p.body);
    add(a.application); add(a.conclusion);
    for (const x of a.illustrations || []) if (x) add(x.body);
    add(a.lighter && a.lighter.text);
  }
  const b = s.ai;
  if (b) {
    for (const p of b.points || []) if (p) add(p.body);
    add(b.application);
    for (const x of b.crossRefs || []) if (x) { add(x.reference); add(x.why); }
    for (const c of b.context || []) if (c) add(c.answer);
    for (const k of b.keywords || []) if (k) add(k.meaning);
  }
  return out;
}

/** Every verse to fetch for a preparation, each once: all it names except the text word, whose words are in step 1. */
export function wanted(s) {
  const seen = new Set(), out = [];
  for (const text of textsOf(s)) for (const r of refsToQuote(text, { seen })) if (!isWord(r, s)) out.push(r);
  return out;
}

/** 'en' or 'af' from how a source names its language: a code ("af", "en-ZA") or a name ("Afrikaans", "English"); '' for anything else. */
export function langCode(v) {
  const x = String(v || '').toLowerCase();
  if (/^af\b|^afr|afrikaans/.test(x)) return 'af';
  if (/^en\b|^eng|english|engels/.test(x)) return 'en';
  return '';
}

/**
 * The Bibles to read the verses from, best first, as ids of bible.js
 * sources(): the translation of the text word (by its id, else by its name,
 * as a Guide's text word names only "NKJV" or "AFR53"); then the other
 * Bibles in the sermon's language (the reader's own choice first, then the
 * ones pasted in, then those of API.Bible and YouVersion); for an Afrikaans
 * sermon then the same in English; and the bundled WEB and KJV last, which
 * are always there, offline too.
 */
export function sourceOrder(all, { translationId = '', translation = '', reader = '', lang = 'en' } = {}) {
  const ids = [];
  const push = x => { if (x && !ids.includes(x.id)) ids.push(x.id); };
  const name = String(translation || '').trim().toLowerCase();
  push(all.find(x => translationId && x.id === translationId) || all.find(x => name && String(x.short || '').toLowerCase() === name));
  const kind = x => (x.provider === 'mine' ? 0 : x.builtin ? 3 : x.provider === 'api' ? 1 : 2);
  for (const l of lang === 'af' ? ['af', 'en'] : ['en']) {
    push(all.find(x => x.id === reader && langCode(x.lang) === l));
    for (const x of all.filter(y => !y.builtin && langCode(y.lang) === l).sort((a, b) => kind(a) - kind(b))) push(x);
  }
  for (const id of ['web', 'kjv']) push(all.find(x => x.id === id));
  return ids;
}

/**
 * Brings s.quotes in line with what the preparation names: the words of
 * every verse it names and does not hold yet are fetched with `fetch(ids,
 * ref)` (bible.js versesFrom) from the Bibles `ids`, best first; the words of
 * a verse no text names any more go. With `upgrade` (the first time on a
 * visit, and when the Bibles to read from have changed), a verse that came
 * from a Bible further down the list is asked for in the better ones again:
 * the key may be there now, the chapter pasted in, the connection back. A
 * verse from a Bible this device does not have is kept when it is in the
 * sermon's language (`lang`), so that two devices with different Bibles do
 * not take turns. `notFound` (a Set) collects the keys that no Bible here
 * has, which are not asked for again. Resolves to true when s.quotes changed.
 */
export async function gather(s, { ids, fetch, lang = 'en', upgrade = false, notFound = null, now = () => new Date().toISOString() }) {
  const want = wanted(s);
  const had = s.quotes || {};
  const quotes = {};
  let changed = false;
  for (const k of Object.keys(had)) if (want.some(r => r.key === k)) quotes[k] = had[k]; else changed = true;
  for (const r of want) {
    const old = quotes[r.key];
    let from = ids;
    if (old) {
      if (!upgrade) continue;
      const rank = ids.indexOf(old.source);
      if (rank === 0 || (rank < 0 && langCode(old.lang) === lang)) continue;
      if (rank > 0) from = ids.slice(0, rank);
    } else if (notFound && notFound.has(r.key)) continue;
    const got = await fetch(from, r);
    if (got && got.text) {
      if (!old || old.source !== got.source || old.text !== got.text) {
        quotes[r.key] = { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd, text: got.text, short: got.short || '', lang: got.lang || '', source: got.source || '', at: now() };
        changed = true;
      }
    } else if (!old && notFound) notFound.add(r.key);
  }
  if (changed) s.quotes = quotes;
  return changed;
}

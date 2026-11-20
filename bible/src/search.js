/*
 * Searching the Bible for a verse (Jerome, 2026-11-20: "to be able to search
 * the bible for a verse").
 *
 * The reader's box takes a reference or words (reader.js). A reference opens
 * the chapter. Words open this page at #read/search/<words>/<where>: the
 * verses that carry them, in the translation the reader is set to, each one
 * a link to its place in the reader, where it can be noted, prepared or
 * copied like any verse.
 *
 * What is searched depends on where the translation's text is:
 *  - the two Bibles that travel with the app (KJV, WEB) are read whole, once,
 *    and searched on the device (search-lib.js), with or without a connection;
 *  - a version the person pasted in is searched in the chapters they pasted;
 *  - an API.Bible translation (the NKJV, with the person's own key) is
 *    searched by API.Bible itself, so it needs a connection; nothing of it is
 *    kept;
 *  - a YouVersion translation cannot be searched, and API.Bible may not
 *    answer: the KJV is then searched instead.
 * The page always says which text was searched, and why when it is not the
 * one the reader is set to.
 */
import { el, clear } from './ui.js';
import { t, tn, lang as appLang } from './i18n.js';
import { BOOKS, BY_ID, GROUPS, GROUPS_AF, bookName, formatRef, parseRef } from './books.js';
import { state, allTexts } from './store.js';
import * as Bible from './bible.js';
import { makeCorpus, find, parseQuery, testFor, marks, fold } from './search-lib.js';

const STEP = 50;       // verses shown at a time
const PARTS = { ot: 'GEN.1.1-MAL.4.6', nt: 'MAT.1.1-REV.22.21' };   // the two Testaments as API.Bible names a stretch of the Bible

let kept = null;       // the built-in translation read last: {id, corpus}; one at a time, a whole Bible is some megabytes
let reading = null;    // a translation being read: {id, promise}, so that a second search waits for the same reading
let place = null;      // where the person was in the last list: {key, shown, y}, for the way back from a verse
let from = null;       // the list a verse was opened from: {q, where, named, book, chapter}, for the reader's link back to it

/** A new search was typed: the list starts at its top again. */
export function forget() { place = null; from = null; }

/**
 * The list that a verse of this chapter was opened from, for the reader's
 * link back to it: {href, q}. Null when the chapter was opened another way,
 * and from then on: the link belongs to the verse that was tapped.
 */
export function wayBack(book, chapter) {
  if (from && (from.book !== book || from.chapter !== chapter)) from = null;
  return from ? { href: hrefOf(from.q, from.where), q: from.named } : null;
}

/** The address of a search: #read/search/<words>, with the part of the Bible or the book after it when it is narrowed. */
export function hrefOf(q, where) {
  return `#read/search/${encodeURIComponent(q)}${where && where !== 'all' ? '/' + where : ''}`;
}

/* ---------------------------------------------------------------- reading the text */

/** A whole built-in translation as one row for each verse, in the order of the Bible: {corpus, missed}; missed counts the books that could not be read. */
async function builtin(src, onProgress) {
  if (kept && kept.id === src.id) return kept;
  if (reading && reading.id === src.id) return reading.promise;
  const promise = (async () => {
    const index = await Bible.bookIndex(src.id);
    const books = BOOKS.filter(b => index[b.id]);
    const files = new Array(books.length);
    let next = 0, done = 0, missed = 0;
    const worker = async () => {
      while (next < books.length) {
        const k = next++;
        try { files[k] = await Bible.bookFile(src.id, books[k].id); } catch (e) { files[k] = null; missed++; }
        if (onProgress) onProgress(++done, books.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const rows = [];
    books.forEach((b, k) => {
      for (const [c, verses] of ((files[k] && files[k].chapters) || []).entries()) {
        verses.forEach((text, v) => { if (text) rows.push({ book: b.id, chapter: c + 1, verse: v + 1, text }); });
      }
    });
    const made = { id: src.id, corpus: makeCorpus(rows, src.lang), missed };
    if (!missed) kept = made;   // a Bible with books missing is read again the next time
    return made;
  })();
  reading = { id: src.id, promise };
  try { return await promise; } finally { if (reading && reading.promise === promise) reading = null; }
}

/** The chapters of a version the person pasted in, as one row for each verse, in the order of the Bible. */
async function pastedRows(version) {
  const order = Object.fromEntries(BOOKS.map((b, i) => [b.id, i]));
  const chapters = (await allTexts(version)).filter(c => c.book in order).sort((a, b) => order[a.book] - order[b.book] || a.chapter - b.chapter);
  const rows = [];
  for (const c of chapters) for (const v of c.verses || []) if (v && v.text) rows.push({ book: c.book, chapter: c.chapter, verse: v.n, text: v.text });
  return { rows, chapters: chapters.length };
}

/* ---------------------------------------------------------------- searching */

/** The row of a verse API.Bible found: its id is "JHN.3.16" (a verse that carries two numbers is "JHN.3.16-JHN.3.17"). */
function apiRow(v) {
  const [book, c, n] = v.id.split('-')[0].split('.');
  const row = { book, chapter: parseInt(c, 10), verse: parseInt(n, 10), text: v.text };
  return BY_ID[book] && row.chapter && row.verse && row.text ? row : null;
}

/** Lets API.Bible search one of its translations. Throws when it does not answer. */
async function viaApi(src, q, where) {
  const words = q.replace(/["“”„«»*?]/g, ' ').replace(/\s+/g, ' ').trim();   // the words as typed; quotes and wildcards mean other things to API.Bible
  let range = PARTS[where] || '';
  let first;
  try {
    first = await Bible.apiSearch(src.apiId, words, { range, limit: STEP });
  } catch (e) {
    if (!range) throw e;
    range = ''; where = 'all';   // the narrowing was refused: the whole Bible rather than nothing
    first = await Bible.apiSearch(src.apiId, words, { limit: STEP });
  }
  let asked = first.verses.length;
  const hits = first.verses.map(apiRow).filter(Boolean);
  return {
    src, api: true, where: range ? where : 'all', fums: first.fums, words, unquoted: /["“”„«»]/.test(q),
    said: t('Searched in the {short} ({name}) by API.Bible.', { short: src.short, name: src.name }),
    out: { kind: hits.length ? 'all' : 'none', hits, close: 0, fixed: [], dropped: [], test: testFor(q, langOf(src)) },
    total: Math.max(first.total, hits.length),
    more: async () => {
      const next = await Bible.apiSearch(src.apiId, words, { range, limit: STEP, offset: asked });
      asked += next.verses.length;
      return { rows: next.verses.map(apiRow).filter(Boolean), end: !next.verses.length };
    },
  };
}

/** The language whose word endings fit a translation: Afrikaans or English. */
function langOf(src) {
  return /^af/i.test(String(src.lang || '')) ? 'af' : 'en';
}

/**
 * Searches the translation the reader is set to, or the KJV when that one
 * cannot be searched. Gives what the page needs: the source searched, the
 * sentence that says so, the verses (search-lib.js find), and for API.Bible
 * the way to fetch more.
 */
async function run(srcId, q, where, onProgress) {
  let src = Bible.source(srcId) || Bible.source('kjv');
  let instead = '';
  if (!parseQuery(q).length) return { src, said: '', out: { kind: 'none', hits: [], close: 0, fixed: [], dropped: [], test: null }, nothing: true };
  if (src.provider === 'api') {
    try {
      return await viaApi(src, q, where);
    } catch (e) {
      instead = t('The {short} could not be searched, so this is the KJV. ({error})', { short: src.short, error: e.message || e });
      src = Bible.source('kjv');
    }
  } else if (src.provider === 'yv') {
    instead = t('The {short} cannot be searched from this app, so this is the KJV.', { short: src.short });
    src = Bible.source('kjv');
  }
  if (src.provider === 'mine') {
    const { rows, chapters } = await pastedRows(src.ext.id);
    const said = chapters
      ? tn(chapters, 'Searched in the {n} chapter of the {short} that you pasted in.', 'Searched in the {n} chapters of the {short} that you pasted in.', { short: src.short })
      : t('No chapter of the {short} has been pasted in yet, so there is nothing to search.', { short: src.short });
    return { src, said, out: find(makeCorpus(rows, langOf(src)), q), pasted: true, chapters };
  }
  const read = await builtin(src, onProgress);
  if (!read.corpus.rows.length) {
    // not one book could be read: the Bible is not on this device yet and there is no connection
    const e = new Error(t('The {short} is not on this device yet, and there is no connection to fetch it. Search again with a connection. Settings → Offline saves the whole Bible on this device.', { short: src.short }));
    e.plain = true;
    throw e;
  }
  return { src, instead, said: t('Searched in the {short} ({name}).', { short: src.short, name: src.name }), out: find(read.corpus, q), missed: read.missed };
}

/* ---------------------------------------------------------------- the page */

/**
 * The page of a search, for the reader to put under its bar: it says
 * "Searching…" at once and fills itself in when the verses are found.
 * `back` is the chapter the person came from: {href, label}.
 */
export function page({ q, where = 'all', srcId, back }) {
  const box = el('div', { class: 'page reader found' });
  const src = Bible.source(srcId) || Bible.source('kjv');
  if (!place) window.scrollTo(0, 0);   // a new search starts at the top; on the way back from a verse the list returns to where it was left
  const status = el('p', { class: 'muted found-wait', role: 'status', text: t('Searching the {short}…', { short: src.short }) });
  box.append(status);
  const onProgress = (done, total) => { status.textContent = t('Reading the {short} for the search: {done} of {total} books…', { short: src.short, done, total }); };
  run(srcId, q, where, onProgress)
    .then(res => { if (box.isConnected) show(box, res, { q, where, back }); })
    .catch(e => {
      console.error(e);
      clear(box).append(el('p', { class: 'error', role: 'status', text: e.plain ? e.message : t('The search did not work: {error}', { error: e.message || e }) }));
    });
  return box;
}

/** “a”, “b” and “c” as one string. */
function quoted(words) {
  return words.map(w => `“${w}”`).join(', ');
}

function show(box, res, { q, where, back }) {
  clear(box);
  const lang = state.settings.bookLang;
  const { out, src } = res;
  const asked = q.trim().replace(/\s+/g, ' ');

  // ---- narrowed to a part of the Bible or to one book (the built-in and pasted texts: every verse is here, so they are sorted on the spot)
  const inPlace = (h, w) => w === 'all' || h.book === w || (BY_ID[h.book] && BY_ID[h.book].group === w);
  let hits = out.hits;
  if (res.api) where = res.where;
  else if (out.kind !== 'all' || !hits.some(h => inPlace(h, where))) where = 'all';
  if (!res.api && where !== 'all') hits = hits.filter(h => inPlace(h, where));
  const total = res.api ? res.total : hits.length;
  const firstClose = new Set(out.close ? out.hits.slice(0, out.close) : []);
  const close = hits.filter(h => firstClose.has(h)).length;
  const grouped = close > 0 && close < hits.length;

  // ---- the heading, the way back, and what was searched
  // the heading names the words the verses have: a word put right as the word that was searched, without a word that was left out
  const changed = out.fixed.some(f => !f.also) || out.dropped.length > 0;
  const searched = !changed ? asked : parseQuery(q).filter(term => !out.dropped.includes(term.typed)).map(term => {
    const f = out.fixed.find(x => x.typed === term.typed && !x.also && x.used.length === 1);
    return term.exact ? `"${term.typed}"` : f ? f.used[0] : term.typed;
  }).join(' ') || asked;
  const named = res.api ? res.words : out.kind === 'all' ? searched : asked;   // the words as the heading names them, and the reader's link back to this list
  const heading = out.kind === 'all' ? tn(total, '{n} verse with “{q}”', '{n} verses with “{q}”', { q: named })
    : out.kind === 'closest' ? t('No verse has all the words of “{q}”', { q: named })
    : t('No verse found for “{q}”', { q: named });
  box.append(el('div', { class: 'docbar found-head' }, [
    el('h2', { text: heading, 'aria-live': 'polite' }),
    back ? el('a', { class: 'btn small ghost', href: back.href, text: t('Back to {ref}', { ref: back.label }) }) : null,
  ]));
  const notes = el('div', { class: 'found-notes' });
  const note = (text, cls) => notes.append(el('p', { class: cls || 'muted small', text }));
  if (res.instead) note(res.instead, 'found-note');
  if (res.said) note(res.said);
  if (res.unquoted) note(t('API.Bible finds the words anywhere in a verse, so the quotes were left out.'), 'found-note');
  for (const f of out.fixed) {
    note(f.also
      ? t('“{typed}” is in very few verses, so {used} was searched as well.', { typed: f.typed, used: quoted(f.used) })
      : t('No verse has “{typed}”, so {used} was searched instead.', { typed: f.typed, used: quoted(f.used) }), 'found-note');
  }
  if (out.kind !== 'none') for (const w of out.dropped) note(t('No verse has “{typed}”, so it was left out.', { typed: w }), 'found-note');
  if (res.missed) {
    note(tn(res.missed, '{n} book could not be read without a connection, so it was not searched.', '{n} books could not be read without a connection, so they were not searched.') + ' ' +
      t('Settings → Offline saves the whole Bible on this device.'), 'found-note');
  }
  if (out.kind === 'closest') note(t('These verses have most of the words. The closest come first.'), 'found-note');
  const empty = res.pasted && !res.chapters;   // a version with no chapter pasted in yet: the line above says so, and no other words would help
  if ((out.kind !== 'all' || changed) && !res.nothing && !empty && langOf(src) !== appLang()) {
    // words that this Bible does not have, and the app speaks one language and this Bible another: the words must be the Bible's
    note(langOf(src) === 'af' ? t('The {short} is an Afrikaans Bible, so the words must be Afrikaans.', { short: src.short }) : t('The {short} is an English Bible, so the words must be English.', { short: src.short }), 'found-note');
  }
  if (out.kind !== 'all' && !empty) {
    note(res.nothing ? t('Type a word or two of the verse, or a place such as “{place}”.', { place: lang === 'af' ? 'Johannes 3:16' : 'John 3:16' })
      : t('Try fewer words, or other words you remember. You can also choose another translation at the top.'));
  }
  box.append(notes);

  // ---- a word that is also the name of a book ("wisdom", "mark", "Job"): the book is one tap away.
  // A short word counts only when it is the book's whole name, or "man" would offer the Prayer of Manasseh.
  const bare = /\d/.test(asked) ? null : parseRef(asked);
  const book = bare && (asked.length >= 4 || [bookName(bare.book, 'en'), bookName(bare.book, 'af')].some(n => fold(n) === fold(asked))) ? bare : null;
  if (book) {
    box.append(el('div', { class: 'list found-book' }, el('a', { class: 'item', href: `#read/${book.book}/1` }, [
      el('span', { class: 'grow' }, [el('b', { text: bookName(book.book, lang) }), el('span', { class: 'snippet muted small', text: t('Open this book of the Bible') })]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    ])));
  }

  // ---- where to search: the parts of the Bible and the books that have the words, with the number of verses in each
  const go = w => location.replace(hrefOf(q, w));
  if (out.kind === 'all' && !res.api && new Set(out.hits.map(h => h.book)).size > 1) {
    const per = {};
    for (const h of out.hits) { per[h.book] = (per[h.book] || 0) + 1; const g = BY_ID[h.book].group; per[g] = (per[g] || 0) + 1; }
    const sel = el('select', { 'aria-label': t('Where to search') });
    const opt = (value, label) => el('option', { value, text: label, selected: value === where });
    sel.append(opt('all', `${res.pasted ? t('All the pasted chapters') : t('Whole Bible')} (${out.hits.length})`));
    for (const g of ['ot', 'ap', 'nt']) if (per[g]) sel.append(opt(g, `${(lang === 'af' ? GROUPS_AF : GROUPS)[g]} (${per[g]})`));
    const books = el('optgroup', { label: t('One book') });
    for (const b of BOOKS) if (per[b.id]) books.append(opt(b.id, `${bookName(b.id, lang)} (${per[b.id]})`));
    sel.append(books);
    sel.addEventListener('change', () => go(sel.value));
    box.append(el('div', { class: 'row found-where' }, sel));
  } else if (res.api && (total > 0 || where !== 'all')) {
    const sel = el('select', { 'aria-label': t('Where to search') });
    for (const w of ['all', 'ot', 'nt']) sel.append(el('option', { value: w, text: w === 'all' ? t('Whole Bible') : (lang === 'af' ? GROUPS_AF : GROUPS)[w], selected: w === where }));
    sel.addEventListener('change', () => go(sel.value));
    box.append(el('div', { class: 'row found-where' }, sel));
  }

  // ---- the verses, fifty at a time
  const body = el('div', { class: 'found-body size-' + (state.settings.fontSize || 'm') });
  const moreBtn = el('button', { class: 'btn ghost block found-more', type: 'button', hidden: true });
  box.append(body, moreBtn);
  const key = `${src.id}|${asked}|${where}`;
  const textLang = langOf(src);
  hits = hits.slice();   // API.Bible's next verses are added to it
  let at = 0, list = null, ended = false;
  const remember = h => { place = { key, shown: at, y: window.scrollY }; from = { q: asked, where, named, book: h.book, chapter: h.chapter }; };
  const row = h => {
    const text = el('span', { class: 'snippet', lang: textLang });
    let last = 0;
    for (const [a, b] of marks(h.text, out.test)) {
      if (a > last) text.append(h.text.slice(last, a));
      text.append(el('mark', { text: h.text.slice(a, b) }));
      last = b;
    }
    if (last < h.text.length) text.append(h.text.slice(last));
    return el('a', { class: 'item found-verse', href: `#read/${h.book}/${h.chapter}/${h.verse}`, onclick: () => remember(h) }, [
      el('span', { class: 'grow' }, [el('b', { text: formatRef({ book: h.book, chapter: h.chapter, verse: h.verse }, lang) }), text]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    ]);
  };
  const left = () => (res.api && !ended ? Math.max(total, hits.length) : hits.length) - at;
  const add = n => {
    for (const to = Math.min(hits.length, at + n); at < to; at++) {
      if (grouped && (at === 0 || at === close)) {
        body.append(el('h3', { class: 'sub', text: at === 0 ? t('The words close together') : t('More verses with these words') }));
        list = null;
      }
      if (!list) { list = el('div', { class: 'list found-list' }); body.append(list); }
      list.append(row(hits[at]));
    }
    moreBtn.hidden = left() <= 0;
    moreBtn.textContent = t('Show {n} more', { n: Math.min(STEP, left()) });
    moreBtn.disabled = false;
  };
  /** Shows up to `upTo` verses, asking API.Bible for the next ones when the list on the device runs out. */
  const showUpTo = async upTo => {
    while (res.more && !ended && hits.length < upTo && hits.length < total) {
      moreBtn.disabled = true;
      try {
        const next = await res.more();
        hits.push(...next.rows);
        if (next.end) ended = true;
      } catch (e) {
        ended = true;
        notes.append(el('p', { class: 'error small', text: e.message || String(e) }));
      }
    }
    add(upTo - at);
  };
  moreBtn.addEventListener('click', () => showUpTo(at + STEP));

  // ---- the foot: whose text it is
  const foot = el('footer', { class: 'copyright small muted' });
  box.append(foot);
  Bible.copyrightOf(src.id).then(c => { if (c) foot.prepend(el('p', { text: `${src.short}: ${c}` })); }).catch(() => {});
  if (res.api) {
    foot.append(el('p', {}, [t('Scripture text provided by '), el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }), '.']));
    if (res.fums) foot.append(el('span', { class: 'fums', html: res.fums }));
  }

  // ---- back from a verse: the list as it was left
  const was = place && place.key === key ? place : null;
  place = { key, shown: STEP, y: 0 };
  if (was && was.shown > 0) showUpTo(Math.max(STEP, was.shown)).then(() => requestAnimationFrame(() => window.scrollTo(0, was.y)));
  else { add(STEP); window.scrollTo(0, 0); }
}

/*
 * Theology: background to the Bible, for study and for preaching.
 *
 * Three levels, the way a minister asks: the verses he has chosen in the
 * reader, the chapter he is reading, and a book with its writer.
 *
 * Built in, free and offline: a short introduction to every book of the
 * Bible, the later writings of the Old Testament (the Apocrypha) included
 * (data/theology/en.json and af.json, written for this app in plain words):
 * who wrote it, when, for whom and why, its big themes, how it is built, its
 * key verses and how it points to Christ. Beside it, the sections of the
 * Catechism that quote the book, the chapter or the verses, counted from the
 * Catechism's index (catechism.js quoting) and, when the Catechism text is
 * on the device, with the Catechism's own "in short".
 *
 * On request, with the minister's own Anthropic key: Claude's theological
 * background on the verses, the chapter or the book (ai.js insight), tied to
 * the Catechism: what the Church teaches on it, from the Catechism text on
 * the device, and how other Christians read it, each reading marked as in
 * line with New Apostolic teaching, different from it, or left open by the
 * Catechism. What Claude wrote is kept (store.js saveInsight, one row per
 * place and language) and travels with the sync and the backup. Under it,
 * "Save all of this" keeps everything the page shows outside Theology: as a
 * PDF to keep, print or share (pdf.js theologyPdf), or as one of the
 * minister's notes (savedPage).
 *
 * The addresses: #theology lists the books as the Catechism groups them,
 * #theology/ROM opens a book, #theology/ROM/8 a chapter and
 * #theology/ROM/8/28-30 a passage. In the reader, "Theology" in the verse bar
 * opens a sheet on the chosen verses, and the button beside the chapter's
 * title opens the chapter here. On a phone the tab bar keeps its six tabs (a
 * seventh does not fit at 360px), so there Theology is reached from the
 * reader; on a PC it also has its own place in the side menu.
 */
import { el, clear, toast, sheet, busy, seg, fmtDate } from './ui.js';
import { t, tn, lang } from './i18n.js';
import { BY_ID, bookName, parseRef, formatRef } from './books.js';
import { state, saveInsight, deleteInsight } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as AI from './ai.js';
import * as Notes from './notes.js';
import * as Pdf from './pdf.js';
import { noKey } from './guides.js';

/* The books as the Catechism groups them (CNAC 1.2.2.2, 1.2.3, 1.2.4.2). */
const SHELVES = [
  { id: 'ot1', part: 'ot', books: 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST' },
  { id: 'ot2', part: 'ot', books: 'JOB PSA PRO ECC SNG' },
  { id: 'ot3', part: 'ot', books: 'ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL' },
  { id: 'ap', part: 'ap', books: '1ES 2ES TOB JDT ESG WIS SIR BAR S3Y SUS BEL MAN 1MA 2MA' },
  { id: 'nt1', part: 'nt', books: 'MAT MRK LUK JHN ACT' },
  { id: 'nt2', part: 'nt', books: 'ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD' },
  { id: 'nt3', part: 'nt', books: 'REV' },
].map(s => ({ ...s, books: s.books.split(' ') }));

/** The name of a group of books, as the Catechism has it, and a few plain words on what is in it. */
function shelfLabel(id) {
  return {
    ot1: [t('The historical books'), ''],
    ot2: [t('The doctrinal books'), t('poetry, prayer and wisdom')],
    ot3: [t('The prophetical books'), ''],
    ap: [t('The later writings of the Old Testament'), t('the Apocrypha')],
    nt1: [t('The historical books'), t('the gospels and Acts')],
    nt2: [t('The doctrinal books'), t('the letters')],
    nt3: [t('The prophetical book'), ''],
  }[id] || ['', ''];
}

function partLabel(part) {
  return { ot: t('Old Testament'), ap: t('Between the Testaments'), nt: t('New Testament') }[part];
}

/* ---------------------------------------------------------------- data */

const intros = {};   // 'en' | 'af' -> Promise of {books: {GEN: {...}}}
let counts = null;   // chapters per book (the KJV, which has every book)

/** The built-in introductions in one language, fetched once; the parts as {from, to, title}. */
function loadIntros(l) {
  const k = l === 'af' ? 'af' : 'en';
  if (!intros[k]) {
    intros[k] = fetch(`data/theology/${k}.json`).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(d => {
      for (const b of Object.values(d.books || {})) b.parts = (b.parts || []).map(([from, to, title]) => ({ from, to, title }));
      return d;
    }).catch(e => { delete intros[k]; throw e; });
  }
  return intros[k];
}

async function chapterCounts() {
  if (!counts) counts = await Bible.bookIndex('kjv');
  return counts;
}

/** The book's own introduction as a few lines for Claude, so the answer goes deeper rather than repeating it. */
function introLines(b) {
  if (!b) return '';
  return [
    b.writer && `Writer: ${b.writer}`, b.when && `When: ${b.when}`, b.to && `Written for: ${b.to}`, b.why && `Why: ${b.why}`,
    b.summary && `In short: ${b.summary}`,
    (b.themes || []).length && `Themes: ${b.themes.join(' | ')}`,
    (b.parts || []).length && `Parts: ${b.parts.map(p => `${p.from}-${p.to} ${p.title}`).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

/* ---------------------------------------------------------------- places */

const bl = () => state.settings.bookLang;
const aiLang = () => (state.settings.aiLang === 'af' ? 'af' : 'en');
const langName = l => (l === 'af' ? t('Afrikaans') : t('English'));

/** 'ROM', 'ROM.8' or 'ROM.8.28-30': the place a row is kept under, before the language. */
function placeKey(level, ref) {
  if (level === 'book') return ref.book;
  if (level === 'chapter') return `${ref.book}.${ref.chapter}`;
  const end = ref.verseEnd || ref.verse;
  return `${ref.book}.${ref.chapter}.${ref.verse}${end !== ref.verse ? '-' + end : ''}`;
}

function refOfRow(row) {
  return { book: row.book, chapter: row.chapter || null, verse: row.verse || null, verseEnd: row.verseEnd || row.verse || null };
}

/** "Romans", "Romans 8" or "Romans 8:28–30" */
function placeLabel(level, ref) {
  if (level === 'book') return bookName(ref.book, bl());
  if (level === 'chapter') return formatRef({ book: ref.book, chapter: ref.chapter }, bl());
  return formatRef(ref, bl());
}

function hrefOf(level, ref) {
  if (level === 'book') return `#theology/${ref.book}`;
  if (level === 'chapter') return `#theology/${ref.book}/${ref.chapter}`;
  const end = ref.verseEnd || ref.verse;
  return `#theology/${ref.book}/${ref.chapter}/${ref.verse}${end !== ref.verse ? '-' + end : ''}`;
}

const readHref = ref => `#read/${ref.book}/${ref.chapter || 1}${ref.verse ? '/' + ref.verse : ''}`;

/** What Claude wrote on this place: in the language of Claude's answers when there is one, else in the other language. */
function keptFor(level, ref) {
  const key = placeKey(level, ref);
  const mine = state.theology.find(x => x.id === `${aiLang()}:${key}`) || null;
  const other = mine ? null : state.theology.find(x => x.id.slice(x.id.indexOf(':') + 1) === key) || null;
  return { mine, other };
}

/** Rows kept on passages of one chapter, by their first verse. */
function passagesIn(book, chapter) {
  const seen = new Set();
  return state.theology
    .filter(x => x.level === 'text' && x.book === book && x.chapter === chapter)
    .sort((a, b) => (a.verse - b.verse) || ((a.verseEnd || 0) - (b.verseEnd || 0)))
    .filter(x => { const k = placeKey('text', refOfRow(x)); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The verses as the minister reads them, for Claude: {text, translation}, or null. */
async function passageText(ref) {
  const srcId = Bible.source(state.settings.translation) ? state.settings.translation : 'kjv';
  for (const id of srcId === 'kjv' ? ['kjv'] : [srcId, 'kjv']) {
    try {
      const ch = await Bible.getChapter(id, ref.book, ref.chapter);
      if (ch && ch.verses && ch.verses.length && !ch.missing && !ch.unpasted) {
        const text = Bible.joinVerses(ch.verses, ref.verse, ref.verseEnd || ref.verse);
        if (text) return { text, translation: Bible.source(id).short };
      }
    } catch (e) { /* try the next */ }
  }
  return null;
}

/* ---------------------------------------------------------------- small parts */

/** The small mark on a button that asks Claude, as in Prepare. */
function sparkle() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

/** The lamp of the Theology button: "Your word is a lamp to my feet" (Psalm 119:105). */
export function lampIcon() {
  const span = el('span', { class: 'th-ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
  return span;
}

function crumbs(links) {
  const parts = [];
  links.forEach(([label, href], i) => { if (i) parts.push(' › '); parts.push(el('a', { href, text: label })); });
  return el('div', { class: 'crumbs' }, parts);
}

/** A heading in spaced capitals and what goes under it; nothing when there is nothing to show. */
function sec(title, body, cls) {
  const items = [].concat(body).filter(Boolean);
  if (!items.length) return null;
  return el('section', { class: 'th-block' + (cls ? ' ' + cls : '') }, [el('h3', { class: 'sub', text: title }), ...items]);
}

/** Text with blank lines between its paragraphs, as paragraphs. */
function paras(text) {
  return String(text || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => el('p', { text: x }));
}

const rangeText = p => (p.from === p.to ? String(p.from) : `${p.from}–${p.to}`);

/** "chapters 1–11, The beginning …": the part of its book a chapter stands in. */
const inBookText = p => (p.from === p.to
  ? t('chapter {n}, {title}', { n: p.from, title: p.title })
  : t('chapters {range}, {title}', { range: rangeText(p), title: p.title }));

/** "1–8 The gospel …", each range a link (to a chapter in Theology, or to the verses in the reader). */
function partsList(parts, href, unit) {
  if (!parts || !parts.length) return null;
  return el('ol', { class: 'th-parts' }, parts.map(p => el('li', {}, [
    el('a', { class: 'th-range', href: href(p), 'aria-label': unit === 'verse' ? t('Verses {range}', { range: rangeText(p) }) : t('Chapters {range}', { range: rangeText(p) }), text: rangeText(p) }),
    el('span', { class: 'th-part-title', text: p.title }),
  ])));
}

/** A book's key verses as places: "ROM.8.28" or "ROM.1.16-17". */
function keyRefs(keys) {
  return (keys || []).map(k => {
    const m = /^([0-9A-Z]{3})\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/.exec(k);
    if (!m || !BY_ID[m[1]]) return null;
    const verse = m[3] ? parseInt(m[3], 10) : null;
    return { book: m[1], chapter: parseInt(m[2], 10), verse, verseEnd: m[4] ? parseInt(m[4], 10) : verse };
  }).filter(Boolean);
}

/** Key verses as links to the reader. */
function keyVerses(keys) {
  const refs = keyRefs(keys);
  if (!refs.length) return null;
  return el('div', { class: 'pills big' }, refs.map(r => el('a', { class: 'pill link', href: readHref(r), text: formatRef(r, bl()) })));
}

/** The Catechism's own "in short" for a section, when its text is on this device: its first sentence or two (… when there is more), or ''. */
function shortSummary(n) {
  const sum = Cat.textReady() ? Cat.summaryOf(n) : [];
  if (!sum.length) return '';
  const all = sum.join(' ');
  let short = '';
  for (const s of all.split(/(?<=[.!?])\s+/)) {
    if (short && short.length + s.length > 220) break;
    short = short ? `${short} ${s}` : s;
  }
  return short.length < all.length ? `${short} …` : short;
}

/** That "in short" under a section in a list, the rest a tap away. */
function catSummary(n) {
  const short = shortSummary(n);
  return short ? el('p', { class: 'th-cat-sum small' }, [el('b', { text: t('In short:') }), ' ', short]) : null;
}

/**
 * Catechism sections as a list: number and title (a link to the section),
 * an extra line (how often it quotes the book, or which verses), and the
 * Catechism's own "in short" when the text is loaded. Long lists show the
 * first `limit` and a button for the rest.
 */
function catList(items, { limit = 0, empty = '' } = {}) {
  if (!items.length) return empty ? el('p', { class: 'muted small', text: empty }) : null;
  const list = el('div', { class: 'list th-cats' });
  const row = x => el('a', { class: 'item cat', href: `#catechism/${encodeURIComponent(x.section.n)}` }, [
    el('span', { class: 'num', text: x.section.n }),
    el('span', { class: 'grow' }, [x.section.title, x.extra ? el('span', { class: 'snippet muted small', text: x.extra }) : null, catSummary(x.section.n)]),
  ]);
  const first = limit ? items.slice(0, limit) : items;
  for (const x of first) list.append(row(x));
  const out = [list];
  if (limit && items.length > limit) {
    const more = el('button', { class: 'btn small ghost', type: 'button', text: t('Show all {n}', { n: items.length }), onclick: () => {
      for (const x of items.slice(limit)) list.append(row(x));
      more.remove();
    } });
    out.push(el('div', { class: 'row' }, more));
  }
  if (!Cat.textReady()) out.push(el('p', { class: 'muted small', text: t('Load the Catechism text under Settings to see each section\'s own summary here.') }));
  return out;
}

/** Sections that quote the chosen verses, each with the verses it quotes. */
function versesCatechism(ref, from, to) {
  const by = new Map();
  for (let v = from; v <= to; v++) {
    for (const s of Cat.refsFor(ref.book, ref.chapter, v)) {
      if (!by.has(s.n)) by.set(s.n, { section: s, verses: [] });
      by.get(s.n).verses.push(v);
    }
  }
  return [...by.values()].map(x => ({ section: x.section, extra: tn(x.verses.length, 'Verse {list}', 'Verses {list}', { list: x.verses.join(', ') }) }));
}

/** Sections that quote anything in a chapter, the most quoting first, with the verses. */
function chapterCatechism(ref) {
  const verses = new Map();
  for (const [v, secs] of Cat.chapterMap(ref.book, ref.chapter)) for (const s of secs) {
    if (!verses.has(s.n)) verses.set(s.n, []);
    verses.get(s.n).push(v);
  }
  return Cat.quoting(ref.book, ref.chapter).map(x => {
    const vs = (verses.get(x.section.n) || []).sort((a, b) => a - b);
    return { section: x.section, extra: vs.length ? tn(vs.length, 'Verse {list}', 'Verses {list}', { list: vs.join(', ') }) : t('The whole chapter') };
  });
}

function bookCatechism(book) {
  return Cat.quoting(book).map(x => ({ section: x.section, extra: tn(x.count, 'Quotes the book once', 'Quotes the book {n} times') }));
}

/** Writer, when, for whom and why, as a small table. */
function facts(b) {
  const rows = [[t('Writer'), b.writer], [t('When'), b.when], [t('Written for'), b.to], [t('Why'), b.why]].filter(r => r[1]);
  if (!rows.length) return null;
  return el('dl', { class: 'th-facts' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
}

/** The note under everything Claude writes: what it is, and what it is not. */
function measureLine() {
  return t('A help for study, not Church doctrine: the Church\'s teaching is in the Catechism, and the Apostles interpret Holy Scripture (CNAC 1.2.5.1).');
}

/* ---------------------------------------------------------------- Claude */

/**
 * Claude's part of a page or of the sheet: what Claude wrote on this place,
 * or a card that offers to ask. `opts.passage` is the text of the verses as
 * the reader shows them. Redraws itself after asking or removing.
 */
function claudeBlock(level, ref, opts = {}) {
  const box = el('section', { class: 'th-claude' });
  const title = level === 'book' ? t('Claude on this book and its writer') : level === 'chapter' ? t('Claude on this chapter') : t('Claude on these verses');
  const draw = () => {
    clear(box);
    box.append(el('h3', { class: 'sub', text: title }));
    const { mine, other } = keptFor(level, ref);
    const row = mine || other;
    box.append(row ? insightView(row, level, ref, opts, draw, !mine) : askCard(level, ref, opts, draw));
  };
  draw();
  return box;
}

function askCard(level, ref, opts, redraw) {
  const what = level === 'book'
    ? t('Claude writes the background of the book and its writer: when and why it was written, how it is built, its key words and themes, what the Church teaches on it, how other Christians read it, and how it points to Christ.')
    : level === 'chapter'
      ? t('Claude writes the background of this chapter: what happens or is said in it, its setting, how it is built, its key words and themes, what the Church teaches on it, how other Christians read it, and how it points to Christ.')
      : t('Claude writes the background of these verses: what they say, their setting and writer, the key words, what the Church teaches on them, how other Christians read them, and how they point to Christ.');
  return el('div', { class: 'th-ask' }, [
    el('p', { text: what }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ai-btn', type: 'button', onclick: () => ask(level, ref, opts, redraw) }, [sparkle(), t('Ask Claude')]),
      el('span', { class: 'muted small grow', text: t('About a minute, with your own Anthropic key. The cost shows with the answer, usually under 20 US cents.') }),
    ]),
    el('p', { class: 'muted small th-measure', text: measureLine() }),
  ]);
}

async function ask(level, ref, opts, redraw, l = aiLang()) {
  if (!AI.ready()) { noKey(); return; }
  const ctrl = new AbortController();
  const b = busy(t('Asking Claude'), () => ctrl.abort());
  const place = placeLabel(level, ref);
  b.say(level === 'book'
    ? t('Claude is writing on {place} and its writer, with the Catechism sections that quote it most. This takes about a minute.', { place })
    : t('Claude is reading {place}, its chapter and the Catechism sections that quote it. This takes about a minute.', { place }));
  try {
    const passage = level === 'text' ? (opts.passage || await passageText(ref)) : null;
    const data = await loadIntros(l).catch(() => null);
    const r = await AI.insight(level, ref, { passage, intro: introLines(data && data.books[ref.book]), lang: l, signal: ctrl.signal });
    const end = ref.verseEnd || ref.verse;
    await saveInsight({
      id: `${l}:${placeKey(level, ref)}`, level, book: ref.book,
      chapter: level === 'book' ? null : ref.chapter,
      verse: level === 'text' ? ref.verse : null, verseEnd: level === 'text' ? end : null,
      lang: l, data: r,
    });
    b.done();
    redraw();
    toast(t('Kept with your study. Sync takes it to your other devices.'));
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    b.fail(e.message || String(e));
  }
}

/** What Claude wrote, field by field, with the Catechism sections it names and the buttons under it. */
function insightView(row, level, ref, opts, redraw, otherLang) {
  const d = row.data || {};
  const list = v => (Array.isArray(v) ? v : []);
  const box = el('div', { class: 'th-insight' });
  if (otherLang) {
    box.append(el('div', { class: 'row line th-lang' }, [
      el('span', { class: 'small grow', text: t('Written in {language}.', { language: langName(row.lang) }) }),
      el('button', { class: 'btn small ghost', type: 'button', onclick: () => ask(level, ref, opts, redraw) }, [sparkle(), t('Ask in {language}', { language: langName(aiLang()) })]),
    ]));
  }
  const part = (title, body, cls) => {
    const items = [].concat(body).filter(Boolean);
    return items.length ? el('section', { class: 'th-sec' + (cls ? ' ' + cls : '') }, [el('h4', { text: title }), ...items]) : null;
  };
  const partHref = level === 'book' ? p => `#theology/${ref.book}/${p.from}` : p => `#read/${ref.book}/${ref.chapter}/${p.from}`;
  box.append(...[
    part(t('In plain words'), paras(d.plain), 'lead'),
    part(t('Background'), paras(d.background)),
    part(t('The writer'), paras(d.writer)),
    part(t('Where it stands'), paras(d.place)),
    part(t('How it is built'), partsList(list(d.parts), partHref, level === 'book' ? 'chapter' : 'verse')),
    part(t('Key words'), list(d.words).length ? el('dl', { class: 'th-words' }, list(d.words).flatMap(w => [el('dt', { text: w.word }), el('dd', { text: w.meaning })])) : null),
    part(t('What it teaches'), list(d.themes).map(x => el('div', { class: 'th-theme' }, [x.theme ? el('b', { text: x.theme }) : null, x.text ? el('p', { text: x.text }) : null]))),
    part(t('What the Church teaches'), [...paras(d.church), catRefs(list(d.catechism))], 'church'),
    part(t('How other Christians read it'), list(d.views).map(viewItem)),
    part(t('Pointing to Christ'), paras(d.christ)),
    part(t('Other passages'), list(d.bible).length ? el('ul', { class: 'th-refs' }, list(d.bible).map(x => el('li', {}, [
      x.ref ? el('a', { href: readHref(x.ref), text: formatRef(x.ref, bl()) }) : el('b', { text: x.reference }),
      x.why ? el('span', { text: ' ' + x.why }) : null,
    ]))) : null),
    part(t('For today'), paras(d.today)),
    part(t('Good to know'), paras(d.note), 'aside'),
  ].filter(Boolean));

  const remove = el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: async () => {
    const copy = JSON.parse(JSON.stringify(row));
    await deleteInsight(row.id);
    redraw();
    toast(t('Removed.'), false, async () => { await saveInsight(copy); redraw(); });
  } });
  box.append(saveBox(row, level, ref, opts), el('div', { class: 'th-foot' }, [
    el('p', { class: 'muted small', text: t('Written {date} by {model}{cost}.', { date: fmtDate(d.at || row.updated), model: AI.modelLabel(d.model), cost: d.cost ? ', ' + AI.fmtCost(d.cost) : '' }) + ' ' + measureLine() }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost', type: 'button', onclick: () => ask(level, ref, opts, redraw) }, [sparkle(), t('Ask again')]),
      remove,
    ]),
  ]));
  return box;
}

/**
 * Keeping all of it outside Theology (Jerome: "I want to be able to save all
 * that information that is on the screen"): as a PDF to keep, print or share,
 * or as one of his notes. What Claude wrote stays in Theology by itself.
 */
function saveBox(row, level, ref, opts) {
  const what = level === 'book'
    ? t('The book\'s introduction, all that Claude wrote and the Catechism sections: as a PDF, or as one of your notes.')
    : level === 'chapter'
      ? t('Where the chapter stands in the book, all that Claude wrote and the Catechism sections: as a PDF, or as one of your notes.')
      : t('The verses, all that Claude wrote and the Catechism sections: as a PDF, or as one of your notes.');
  const go = how => saveAll(how, row, level, ref, opts);
  return el('section', { class: 'th-save' }, [
    el('h4', { text: t('Save all of this') }),
    el('p', { class: 'small', text: what }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: t('Save as PDF'), onclick: () => go('download') }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Print'), onclick: () => go('print') }),
      Pdf.canShare() ? el('button', { class: 'btn small ghost', type: 'button', text: t('Share'), onclick: () => go('share') }) : null,
      el('button', { class: 'btn small ghost', type: 'button', text: t('Save as a note'), onclick: () => go('note') }),
    ]),
  ]);
}

async function saveAll(how, row, level, ref, opts) {
  try {
    const page = await savedPage(level, ref, row, opts);
    if (how === 'note') { noteOf(page, level, ref); return; }
    const r = Pdf.theologyPdf(page);
    if (how === 'print') { Pdf.print(r); toast(t('Sending to the printer…')); }
    else if (how === 'share') { if (await Pdf.share(r) === 'downloaded') toast(t('Sharing is not available here, so the PDF was downloaded.')); }
    else { Pdf.download(r); toast(t('Saved ') + r.name); }
  } catch (e) {
    toast(e.message || t('The PDF could not be built.'), true);
  }
}

/** A reading of the text by other Christians, marked against New Apostolic teaching. */
function viewItem(v) {
  const badge = badgeOf(v.nac);
  return el('div', { class: 'th-view ' + (v.nac || 'open') }, [
    el('div', { class: 'th-view-head' }, [el('b', { text: v.view }), el('span', { class: 'th-badge ' + (v.nac || 'open'), text: badge })]),
    v.text ? el('p', { text: v.text }) : null,
    v.nac === 'differs' && v.differs ? el('p', { class: 'th-differs' }, [el('b', { text: t('New Apostolic teaching:') }), ' ', v.differs]) : null,
  ]);
}

/** How a reading of other Christians stands to New Apostolic teaching, in a few words. */
function badgeOf(nac) {
  return nac === 'agrees' ? t('Agrees with NAC teaching') : nac === 'differs' ? t('NAC teaching differs') : t('Left open by the Catechism');
}

/** The Catechism sections Claude names, each a link with the reason, and the Catechism's own "in short". */
function catRefs(items) {
  if (!items.length) return null;
  return el('div', { class: 'th-catrefs' }, items.map(c => el('div', { class: 'th-catref' }, [
    el('div', {}, [el('a', { class: 'num', href: `#catechism/${encodeURIComponent(c.n)}`, text: c.n }), ' ', el('b', { text: c.title })]),
    c.why ? el('div', { class: 'small', text: c.why }) : null,
    catSummary(c.n),
  ])));
}

/* ---------------------------------------------------------------- keeping it all */

/**
 * Everything the page shows on a place, in the order of the screen, to keep
 * outside Theology: for a book its own introduction, for a chapter where it
 * stands in the book, for verses the verses themselves; then all that Claude
 * wrote, and the Catechism sections that quote the place. One page for the
 * note and for the PDF (pdf.js theologyPdf), so that the two keep the same.
 *
 *   {title, top, lines[], quote: {text, cite} | null, blocks[], file}
 *
 * A block is {head, big, items[]}; big starts what Claude wrote. An item is
 * {p} a paragraph ({p, small} small print), {li} a line of a list, or
 * {lead, lines[], small[]}: a name with what belongs to it, like a key word
 * and its meaning, a Catechism section, or a reading of other Christians.
 */
async function savedPage(level, ref, row, opts = {}) {
  const d = row.data || {};
  const list = v => (Array.isArray(v) ? v : []);
  const ps = text => String(text || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(p => ({ p }));
  const [intros] = await Promise.all([loadIntros(lang()).catch(() => null), Cat.load().catch(() => null)]);
  if (Cat.hasText()) await Cat.loadText().catch(() => false);
  const b = (intros && intros.books[ref.book]) || null;
  const shelf = SHELVES.find(x => x.books.includes(ref.book));
  const title = placeLabel(level, ref);
  const page = {
    title,
    top: [t('Theology'), shelf && shelfLabel(shelf.id)[0], shelf && partLabel(shelf.part)].filter(Boolean).join('  \u00b7  '),
    lines: [], quote: null, blocks: [],
    // "Theology - Romans 8.28-30.pdf": no colon, which a file name cannot have
    file: `${t('Theology')} - ${title}`.replace(/:/g, '.').replace(/[\u2013\u2014]/g, '-').replace(/[\\/*?"<>|\u2060]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf',
  };
  const add = (head, items, big = false) => {
    items = items.filter(Boolean);
    if (items.length || big) page.blocks.push({ head, big, items });
  };
  /** "Chapters 1–8: The gospel …" or "Verse 5: …" */
  const partLine = (p, unit) => `${unit === 'chapter'
    ? (p.from === p.to ? t('Chapter {n}', { n: p.from }) : t('Chapters {range}', { range: rangeText(p) }))
    : (p.from === p.to ? tn(1, 'Verse {list}', 'Verses {list}', { list: p.from }) : t('Verses {range}', { range: rangeText(p) }))}: ${p.title}`;
  const section = (n, name, why, extra) => {
    const short = shortSummary(n);
    return { lead: `${t('Catechism')} ${n}: ${name}`, lines: why ? [why] : [], small: [extra, short && `${t('In short:')} ${short}`].filter(Boolean) };
  };
  /** The sections that quote the place, as many as the screen shows first. */
  const quoting = (items, limit = 0) => {
    const more = limit ? items.length - limit : 0;
    return [
      ...(more > 0 ? items.slice(0, limit) : items).map(x => section(x.section.n, x.section.title, '', x.extra)),
      more > 0 ? { p: tn(more, 'And one more section in the Catechism tab.', 'And {n} more sections in the Catechism tab.'), small: true } : null,
    ];
  };

  if (level === 'book') {
    if (b) {
      if (b.title) page.lines.push(b.title);
      add('', [[t('Writer'), b.writer], [t('When'), b.when], [t('Written for'), b.to], [t('Why'), b.why]].filter(x => x[1]).map(([lead, text]) => ({ lead, lines: [text] })));
      add(t('In short'), ps(b.summary));
      add(t('Big themes'), (b.themes || []).map(li => ({ li })));
      add(t('How the book is built'), (b.parts || []).map(p => ({ li: partLine(p, 'chapter') })));
      const keys = keyRefs(b.key);
      add(t('Key verses'), keys.length ? [{ p: keys.map(r => formatRef(r, bl())).join(', ') }] : []);
      add(t('Pointing to Christ'), ps(b.christ));
    }
    add(t('In the Catechism'), quoting(bookCatechism(ref.book), 6));
    if (b) add('', [{ p: t('This introduction is written for the app in plain words, from what is generally known about the book, and in line with the Catechism (CNAC 1.2). It is a help for study.'), small: true }]);
  } else if (level === 'chapter') {
    if (b && b.line) page.lines.push(`${bookName(ref.book, bl())}: ${b.line}`);
    const inPart = b && (b.parts || []).find(p => ref.chapter >= p.from && ref.chapter <= p.to);
    if (inPart) page.lines.push(`${t('In the book:')} ${inBookText(inPart)}`);
  } else {
    const p = opts.passage || await passageText(ref);
    if (p && p.text) page.quote = { text: p.text, cite: p.translation };
  }

  // all that Claude wrote, as the screen shows it
  add(level === 'book' ? t('Claude on this book and its writer') : level === 'chapter' ? t('Claude on this chapter') : t('Claude on these verses'), [], true);
  add(t('In plain words'), ps(d.plain));
  add(t('Background'), ps(d.background));
  add(t('The writer'), ps(d.writer));
  add(t('Where it stands'), ps(d.place));
  add(t('How it is built'), list(d.parts).map(p => ({ li: partLine(p, level === 'book' ? 'chapter' : 'verse') })));
  add(t('Key words'), list(d.words).map(w => ({ lead: w.word, lines: [w.meaning] })));
  add(t('What it teaches'), list(d.themes).map(x => (x.theme ? { lead: x.theme, lines: x.text ? [x.text] : [] } : { p: x.text })));
  add(t('What the Church teaches'), [...ps(d.church), ...list(d.catechism).map(c => section(c.n, c.title, c.why, ''))]);
  add(t('How other Christians read it'), list(d.views).map(v => ({
    lead: [v.view, badgeOf(v.nac)].filter(Boolean).join('  \u00b7  '),
    lines: [v.text, v.nac === 'differs' && v.differs ? `${t('New Apostolic teaching:')} ${v.differs}` : ''].filter(Boolean),
  })));
  add(t('Pointing to Christ'), ps(d.christ));
  add(t('Other passages'), list(d.bible).map(x => ({ li: [x.ref ? formatRef(x.ref, bl()) : x.reference, x.why].filter(Boolean).join(' \u2013 ') })));
  add(t('For today'), ps(d.today));
  add(t('Good to know'), ps(d.note));
  add('', [{ p: t('Written {date} by {model}{cost}.', { date: fmtDate(d.at || row.updated), model: AI.modelLabel(d.model), cost: '' }) + ' ' + measureLine(), small: true }]);

  if (level === 'chapter') add(t('In the Catechism'), quoting(chapterCatechism(ref), 8));
  if (level === 'text') add(t('In the Catechism'), quoting(versesCatechism(ref, ref.verse, ref.verseEnd || ref.verse)));
  return page;
}

/** The page as the text of a note: each heading on its own line over what belongs to it, a blank line between the parts. */
function pageText(page) {
  const chunks = [];
  if (page.lines.length) chunks.push(page.lines.join('\n'));
  if (page.quote) chunks.push(`\u201c${page.quote.text}\u201d${page.quote.cite ? ` (${page.quote.cite})` : ''}`);
  for (const b of page.blocks) {
    let head = b.head;
    let rows = [];
    const put = text => { chunks.push(head ? `${head}\n${text}` : text); head = ''; };
    const flush = () => { if (rows.length) put(rows.join('\n')); rows = []; };
    for (const x of b.items) {
      if (x.li) { rows.push(`\u2022 ${x.li}`); continue; }
      flush();
      put(x.lead ? [x.lead, ...(x.lines || []), ...(x.small || [])].join('\n') : x.p);
    }
    flush();
    if (head) chunks.push(head);   // a heading with nothing under it: the start of what Claude wrote
  }
  return chunks.join('\n\n');
}

/** All of it in a note of the kind "Doctrine", which can still be changed before it is saved. */
function noteOf(page, level, ref) {
  const at = level === 'book' ? { book: ref.book, chapter: 1 } : level === 'chapter' ? { book: ref.book, chapter: ref.chapter } : ref;
  const note = Notes.draft(at);
  note.kind = 'doctrine';
  note.title = t('Theology: {place}', { place: page.title });
  note.body = pageText(page);
  note.tags = [t('theology|tag')];
  Notes.editNote(note);
}

/* ---------------------------------------------------------------- the pages */

let drawing = 0;

export async function render(container, route) {
  const mine = ++drawing;
  clear(container);
  const wait = el('p', { class: 'muted', text: t('Loading…') });
  container.append(wait);
  let data;
  try {
    [data] = await Promise.all([loadIntros(lang()), chapterCounts(), Cat.load().catch(() => null)]);
    if (Cat.hasText()) await Cat.loadText().catch(() => false);
  } catch (e) {
    if (mine !== drawing) return;
    wait.className = 'error';
    wait.textContent = t('The introductions could not be loaded: {error}', { error: e.message || e });
    return;
  }
  if (mine !== drawing) return;
  clear(container);
  const [, book, chapter, verses] = route;
  if (book && BY_ID[book]) {
    const n = counts[book] || 1;
    const ch = Math.min(n, parseInt(chapter, 10) || 0);
    const m = /^(\d+)(?:-(\d+))?$/.exec(verses || '');
    if (ch && m) {
      const verse = parseInt(m[1], 10);
      return passagePage(container, data, { book, chapter: ch, verse, verseEnd: Math.max(verse, parseInt(m[2] || m[1], 10)) });
    }
    if (ch) return chapterPage(container, data, { book, chapter: ch });
    return bookPage(container, data, book);
  }
  indexPage(container, data);
}

/** Type a place to open it: "Romans" opens the book, "Romans 8" the chapter, "Romans 8:28-30" the verses. */
function gotoForm() {
  const input = el('input', { type: 'search', placeholder: t('Go to: Romans, Psalm 23, John 3:16…'), 'aria-label': t('Go to a book, chapter or verses'), enterkeyhint: 'go', autocomplete: 'off', spellcheck: 'false' });
  return el('form', { class: 'th-goto', onsubmit: e => {
    e.preventDefault();
    const text = input.value.trim();
    const ref = parseRef(text);
    if (!ref) { toast(t('That was not understood. Try "Romans 8" or "Psalm 23:1-3".'), true); return; }
    const hasChapter = /[a-zà-ɏ]\.?\s*\d/i.test(text);
    input.value = '';
    input.blur();
    location.hash = ref.verse ? hrefOf('text', ref) : hasChapter ? hrefOf('chapter', ref) : hrefOf('book', ref);
  } }, [input, el('button', { class: 'btn small ghost', type: 'submit', text: t('Go') })]);
}

function indexPage(box, data) {
  box.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Theology') })]),
    el('p', { class: 'th-lead', text: t('Background to every book of the Bible: who wrote it, when and why, what it teaches and how it points to Christ. Open a book, then a chapter. In the reader, tap verses and then "Theology". Claude can go deeper on any passage, chapter or book, in line with the Catechism.') }),
    gotoForm(),
  );

  // what Claude wrote, the newest first
  if (state.theology.length) {
    const rows = state.theology.slice();
    const list = el('div', { class: 'list th-kept' });
    const item = row => {
      const ref = refOfRow(row);
      const d = row.data || {};
      const first = String(d.plain || '').split(/(?<=[.!?])\s/)[0];
      return el('a', { class: 'item', href: hrefOf(row.level, ref) }, [
        el('span', { class: 'grow' }, [el('b', { text: placeLabel(row.level, ref) }), first ? el('span', { class: 'snippet muted small', text: first }) : null]),
        el('span', { class: 'pill', text: row.level === 'book' ? t('Book') : row.level === 'chapter' ? t('Chapter') : t('Verses') }),
        row.lang !== aiLang() ? el('span', { class: 'pill', text: row.lang.toUpperCase() }) : null,
      ]);
    };
    rows.slice(0, 5).forEach(r => list.append(item(r)));
    box.append(el('h3', { class: 'sub', text: t('What Claude wrote for you ({n})', { n: rows.length }) }), list);
    if (rows.length > 5) {
      const more = el('button', { class: 'btn small ghost', type: 'button', text: t('Show all {n}', { n: rows.length }), onclick: () => { rows.slice(5).forEach(r => list.append(item(r))); more.remove(); } });
      box.append(el('div', { class: 'row' }, more));
    }
  }

  const keptBooks = new Set(state.theology.map(x => x.book));
  for (const part of ['ot', 'ap', 'nt']) {
    const block = el('section', { class: 'th-part' }, [el('h3', { class: 'sub', text: partLabel(part) })]);
    if (part === 'ap') block.append(el('p', { class: 'small muted th-ap', text: t('Written between the Old and the New Testament. In the New Apostolic Church they are as binding for faith and doctrine as the other books of the Old Testament (CNAC 1.2.3).') }));
    for (const shelf of SHELVES.filter(s => s.part === part)) {
      const [label, hint] = shelfLabel(shelf.id);
      block.append(el('div', { class: 'th-shelf' }, [
        el('h4', {}, [label, ' ', el('span', { class: 'muted', text: `(${shelf.books.length})` }), hint ? el('span', { class: 'muted th-hint', text: ' · ' + hint }) : null]),
        el('div', { class: 'th-books' }, shelf.books.map(id => {
          const b = data.books[id] || {};
          return el('a', { class: 'th-book', href: `#theology/${id}` }, [
            el('b', { text: bookName(id, bl()) }),
            el('span', { class: 'small muted', text: b.line || '' }),
            keptBooks.has(id) ? el('span', { class: 'dot', title: t('Claude wrote on this book'), 'aria-label': t('Claude wrote on this book') }) : null,
          ]);
        })),
      ]));
    }
    box.append(block);
  }
  box.append(el('p', { class: 'muted small th-source', text: t('The introductions are written for this app in plain words, from what is generally known about each book, and in line with the Catechism (CNAC 1.2). They are a help for study.') }));
}

function bookPage(box, data, book) {
  const b = data.books[book] || { parts: [] };
  const shelf = SHELVES.find(s => s.books.includes(book));
  const [label] = shelfLabel(shelf ? shelf.id : '');
  const name = bookName(book, bl());
  const n = counts[book] || 1;
  const kept = new Set(state.theology.filter(x => x.book === book && x.chapter).map(x => x.chapter));
  box.append(
    crumbs([[t('Theology'), '#theology']]),
    el('div', { class: 'page th-page' }, [
      el('p', { class: 'eyebrow', text: [label, shelf ? partLabel(shelf.part) : ''].filter(Boolean).join(' · ') }),
      el('div', { class: 'docbar' }, [el('h2', { text: name }), el('a', { class: 'btn small ghost', href: `#read/${book}/1`, text: t('Read the book') })]),
      b.title ? el('p', { class: 'th-title', text: b.title }) : null,
      facts(b),
      sec(t('In short'), paras(b.summary)),
      sec(t('Big themes'), (b.themes || []).length ? el('ul', { class: 'th-themes' }, b.themes.map(x => el('li', { text: x }))) : null),
      sec(t('How the book is built'), partsList(b.parts, p => `#theology/${book}/${p.from}`, 'chapter')),
      sec(t('Key verses'), keyVerses(b.key)),
      sec(t('Pointing to Christ'), paras(b.christ)),
      sec(t('In the Catechism'), catList(bookCatechism(book), { limit: 6, empty: t('No section of the Catechism quotes this book directly.') })),
      el('p', { class: 'muted small th-source', text: t('This introduction is written for the app in plain words, from what is generally known about the book, and in line with the Catechism (CNAC 1.2). It is a help for study.') }),
      claudeBlock('book', { book }),
      el('section', { class: 'th-block th-chapters-box' }, [
        el('h3', { class: 'sub', text: tn(n, '{n} chapter', '{n} chapters') }),
        el('div', { class: 'th-chapters' }, Array.from({ length: n }, (_, i) => el('a', {
          class: kept.has(i + 1) ? 'kept' : null, href: `#theology/${book}/${i + 1}`, text: String(i + 1),
          'aria-label': kept.has(i + 1) ? t('Chapter {n}, with what Claude wrote', { n: i + 1 }) : t('Chapter {n}', { n: i + 1 }),
        }))),
      ]),
    ]),
  );
}

function chapterPage(box, data, ref) {
  const b = data.books[ref.book] || { parts: [] };
  const name = bookName(ref.book, bl());
  const n = counts[ref.book] || 1;
  const inPart = (b.parts || []).find(p => ref.chapter >= p.from && ref.chapter <= p.to);
  const passages = passagesIn(ref.book, ref.chapter);
  box.append(
    crumbs([[t('Theology'), '#theology'], [name, `#theology/${ref.book}`]]),
    el('div', { class: 'page th-page' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: placeLabel('chapter', ref) }), el('a', { class: 'btn small ghost', href: readHref(ref), text: t('Read the chapter') })]),
      b.line ? el('p', { class: 'th-where muted small', text: `${name}: ${b.line}` }) : null,
      inPart ? el('p', { class: 'th-where' }, [el('span', { class: 'muted', text: t('In the book:') }), ' ', el('a', { href: `#theology/${ref.book}`, text: inBookText(inPart) })]) : null,
      claudeBlock('chapter', ref),
      passages.length ? sec(t('Verses Claude wrote on'), el('div', { class: 'list' }, passages.map(x => el('a', { class: 'item', href: hrefOf('text', refOfRow(x)) }, [
        el('span', { class: 'grow' }, [el('b', { text: placeLabel('text', refOfRow(x)) }), el('span', { class: 'snippet muted small', text: String((x.data || {}).plain || '').split(/(?<=[.!?])\s/)[0] })]),
      ])))) : null,
      sec(t('In the Catechism'), catList(chapterCatechism(ref), { limit: 8, empty: t('No section of the Catechism quotes this chapter directly.') })),
      el('nav', { class: 'row chapnav', 'aria-label': t('Chapters') }, [
        ref.chapter > 1 ? el('a', { class: 'btn ghost', href: `#theology/${ref.book}/${ref.chapter - 1}`, text: '‹ ' + placeLabel('chapter', { book: ref.book, chapter: ref.chapter - 1 }) }) : el('span'),
        ref.chapter < n ? el('a', { class: 'btn ghost', href: `#theology/${ref.book}/${ref.chapter + 1}`, text: placeLabel('chapter', { book: ref.book, chapter: ref.chapter + 1 }) + ' ›' }) : el('span'),
      ]),
    ]),
  );
}

function passagePage(box, data, ref) {
  const name = bookName(ref.book, bl());
  const quote = el('blockquote', { class: 'th-quote' }, el('span', { class: 'muted', text: t('Loading…') }));
  box.append(
    crumbs([[t('Theology'), '#theology'], [name, `#theology/${ref.book}`], [placeLabel('chapter', ref), `#theology/${ref.book}/${ref.chapter}`]]),
    el('div', { class: 'page th-page' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: placeLabel('text', ref) }), el('a', { class: 'btn small ghost', href: readHref(ref), text: t('Read in the chapter') })]),
      quote,
      claudeBlock('text', ref),
      sec(t('In the Catechism'), catList(versesCatechism(ref, ref.verse, ref.verseEnd), { empty: t('No section of the Catechism quotes these verses directly. Claude can still name the sections that belong with them.') })),
    ]),
  );
  passageText(ref).then(p => {
    clear(quote);
    if (!p) { quote.remove(); return; }
    quote.append(el('p', { text: p.text }), el('cite', { class: 'muted small', text: p.translation }));
  });
}

/* ---------------------------------------------------------------- the sheet in the reader */

/**
 * The sheet the reader's verse bar opens: Theology on the chosen verses, with
 * the chapter and the book a tap away. `passage` is {text, translation} as
 * the reader shows the verses.
 */
export async function openSheet(ref, passage) {
  const s = sheet(t('Theology'), { wide: true });
  const body = el('div', { class: 'th-sheet' });
  const chapter = { book: ref.book, chapter: ref.chapter };
  const keep = x => x.replace(/–/g, '\u2060–\u2060');   // "Romeine 8:28–30" may wrap after the book's name, never at the dash
  const levels = [['text', keep(placeLabel('text', ref))], ['chapter', placeLabel('chapter', chapter)], ['book', bookName(ref.book, bl())]];
  const chooser = seg(levels, 'text', v => show(v), { block: true, label: t('Theology on') });
  chooser.classList.add('th-levels');
  s.body.append(chooser, body);
  // a link to another screen takes the sheet with it
  s.body.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (a) s.close(); });

  let data = { books: {} };
  try { [data] = await Promise.all([loadIntros(lang()), Cat.load().catch(() => null)]); } catch (e) { /* the introductions are a bonus here */ }
  if (Cat.hasText()) await Cat.loadText().catch(() => false);

  function bookLine(b) {
    if (!b || !b.writer) return null;
    return el('div', { class: 'th-booknote' }, [
      facts({ writer: b.writer, when: b.when }),
      el('div', { class: 'row' }, [el('a', { class: 'btn small ghost', href: `#theology/${ref.book}`, text: t('The book\'s introduction') })]),
    ]);
  }

  function show(level) {
    clear(body);
    const b = data.books[ref.book];
    if (level === 'text') {
      body.append(...[
        claudeBlock('text', ref, { passage }),
        sec(t('In the Catechism'), catList(versesCatechism(ref, ref.verse, ref.verseEnd || ref.verse), { empty: t('No section of the Catechism quotes these verses directly. Claude can still name the sections that belong with them.') })),
        sec(t('About the book'), bookLine(b)),
      ].filter(Boolean));
    } else if (level === 'chapter') {
      const inPart = b && (b.parts || []).find(p => ref.chapter >= p.from && ref.chapter <= p.to);
      body.append(...[
        inPart ? el('p', { class: 'th-where' }, [el('span', { class: 'muted', text: t('In the book:') }), ' ', inBookText(inPart)]) : null,
        claudeBlock('chapter', chapter),
        sec(t('In the Catechism'), catList(chapterCatechism(chapter), { limit: 6, empty: t('No section of the Catechism quotes this chapter directly.') })),
        el('div', { class: 'row' }, [el('a', { class: 'btn small ghost', href: `#theology/${ref.book}/${ref.chapter}`, text: t('Open the chapter in Theology') })]),
      ].filter(Boolean));
    } else {
      body.append(...[
        b && b.title ? el('p', { class: 'th-title', text: b.title }) : null,
        b ? facts(b) : null,
        b && b.summary ? sec(t('In short'), paras(b.summary)) : null,
        el('div', { class: 'row' }, [el('a', { class: 'btn small', href: `#theology/${ref.book}`, text: t('The whole introduction') })]),
        claudeBlock('book', { book: ref.book }),
      ].filter(Boolean));
    }
  }
  show('text');
}

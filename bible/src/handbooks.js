/*
 * Handbooks: the Church's handbooks for ministers in the app. The "Guide for
 * Ministers" is the rule book (ministry, the divine service, the sacraments,
 * pastoral care, administration, the competency profiles); "Serving and
 * Leading" is the guiding principle for everyone who leads; the "Liturgy of
 * the New Apostolic Church" (2024) is the full liturgy book, of which the
 * altar cards under Liturgy are the short form. Any other handbook in the
 * same shape (numbered chapters) can be loaded as well.
 *
 * The handbooks are the Church's own text, so they are not in the app: the
 * minister loads each one once under Church files (files.js), as the PDF or
 * as a text file saved from it.
 * handbook.js reads it on the device itself (no AI, no key) into chapters,
 * which are kept in the `handbooks` store, one row per handbook and
 * language (id '<key>:<language>', e.g. 'guide-for-ministers:en'), from
 * where they travel with the sync to the other devices. They are not in the
 * backup file, like the Catechism text, the Guides and the altar booklet.
 *
 * The Creed, the ten Articles of Faith, is the one handbook that is part of
 * the app (creed.js): short, the Church's public confession, and given by
 * the minister himself. It is listed first, read whole on one page (each
 * article with the Catechism's section on it), and searched and asked like
 * the others; there is nothing to load or remove.
 *
 * #handbooks lists the Church's books with a word search across the
 * handbooks; #handbooks/search/<words> is that search; #handbooks/<key> is a
 * handbook's table of contents; #handbooks/<key>/<n> is one chapter (n is
 * its number, or 'i<k>' for a chapter without one). Handbooks is the door to
 * the Church's books: on a PC it has its own place in the side menu after
 * Prepare, and on a phone the fourth place in the bar. The Catechism
 * (catechism.js, #catechism) and the Liturgy, the altar cards (liturgy.js,
 * #liturgy), keep their own screens but are listed here, first in the list,
 * and Handbooks stays lit while one of them is open (app.js, holds()). Once
 * the Catechism's text is on the device (loaded under Church files) its sections
 * are searched and asked together with the handbooks (catechism.js
 * asHandbook). Where the AI helper is unlocked (lock.js), the list page also
 * has "Ask the handbooks" (ask.js): Claude answers a question from the
 * chapters that fit it, naming them; a locked device shows nothing of that.
 *
 * The Catechism in questions and answers (2015; the Afrikaans "Kategismus in
 * vrae en antwoorde") is loaded the same way and kept as a handbook
 * ('catechism-qa', catq.js reads it): its 13 chapters are the Catechism's,
 * each with its questions under it (#handbooks/catechism-qa/q108 is
 * question 108). It is listed right after the Catechism; a question shows
 * its answer, the verses it quotes (to the reader) and the questions it
 * points to, and Prepare lists the questions that quote the text word.
 *
 * Print on a chapter, on a handbook's contents page and on the Creed opens
 * "Print or save" (handbook-pdf.js): the chapter, the chapter with those
 * under it, the whole handbook, the whole Creed or one article as a PDF in
 * large clear type, with Save as PDF, Print and Share as in Prepare.
 */
import { el, clear, toast, confirmBox, busy, seg, sheet, fmtDate, SIZES } from './ui.js';
import { state, saveHandbook, deleteHandbook, saveSetting } from './store.js';
import { t, lang } from './i18n.js';
import { KNOWN, fromPages, fromText, parse, search, chaptersUnder } from './handbook.js';
import { isQA, parseQA, rangeOf } from './catq.js';   // the Catechism in questions and answers: read from its PDF, its chapters' questions
import { formatRef } from './books.js';
import { CREED } from './creed.js';   // the Creed, part of the app
import { askBox, hrefOf, indexAt, label } from './ask.js';   // "Ask the handbooks", and the link and label of a chapter
import * as Cat from './catechism.js';   // the Catechism: searched and asked here too, once its text is on the device
import { icon as chalice } from './liturgy.js';   // the chalice of the Liturgy, for its row
import * as Sync from './sync.js';
import { printButton, printSheet, chapterPdf } from './handbook-pdf.js';   // Print or save: a chapter, the chapters under it, the whole book or the Creed as a PDF

/** The sections listed under Handbooks that have screens of their own: Handbooks stays lit in the menu and the bar while one of them is open (app.js). */
export const UNDER = ['catechism', 'liturgy'];
export const holds = tab => UNDER.includes(tab);

/* ---------------------------------------------------------------- which handbook, which chapter */

/** The handbooks on this device: the Creed, which is part of the app, and those loaded from their files (a loaded copy with the Creed's own id would stand in for the built-in one). */
const all = () => [...CREED.filter(c => !state.handbooks.some(h => h.id === c.id)), ...state.handbooks];

/** The copies of a handbook, the app's language first (Church files, files.js, lists them). */
export const copies = key => all().filter(h => h.key === key).sort((a, b) => (a.language === lang() ? -1 : b.language === lang() ? 1 : a.language.localeCompare(b.language)));

/** The handbook to show under a key: the copy in the app's language, else the other one; null when none is loaded. */
const bookOf = key => copies(key)[0] || null;

/** The handbooks on this device, one per key: the Creed first, then the known ones in their order and the rest by title. */
function loaded() {
  const keys = [...new Set(all().map(h => h.key))];
  const rank = k => { if (k === 'creed') return -1; const i = KNOWN.findIndex(([key]) => key === k); return i < 0 ? KNOWN.length : i; };
  return keys.map(bookOf).sort((a, b) => rank(a.key) - rank(b.key) || a.title.localeCompare(b.title));
}

const partsOf = n => String(n).split('.');

/** The chapter a numbered chapter sits under: 4.5 for 4.5.4; a question's chapter in the Catechism in questions and answers. */
function parentOf(hb, c) {
  if (c.parent) return hb.chapters.find(x => x.n === c.parent && x !== c) || null;
  if (!c.n || !/\./.test(c.n)) return null;
  const n = partsOf(c.n).slice(0, -1).join('.');
  return hb.chapters.find(x => x.n === n) || null;
}

/** The chapters one level under this one: 4.5.1 … 4.5.4 under 4.5; a chapter's questions in the Catechism in questions and answers. */
function childrenOf(hb, c) {
  if (hb.qa) return c.n ? hb.chapters.filter(x => x.parent === c.n) : [];
  if (!c.n || /^A/.test(c.n)) return [];
  const depth = partsOf(c.n).length + 1;
  return hb.chapters.filter(x => x.n.startsWith(c.n + '.') && partsOf(x.n).length === depth);
}

/** The book icon of the Handbooks tab (index.html), for the rows of the list. */
function icon() {
  const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5h-6.5z"/><path d="M21.5 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5h6.5z"/></svg>';
  return span;
}

/** The Catechism's own icon, from its button in the menu (index.html), so its row is told apart from the handbooks. */
function catIcon() {
  const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M12 6v8M8.5 9.5h7"/></svg>';
  return span;
}

/* ---------------------------------------------------------------- the screens */

let catFailed = '';   // the Catechism text (by when it was loaded) that could not be read into memory, so the list does not try it again and again

export function render(container, route) {
  clear(container);
  const a = route[1] ? decodeURIComponent(route[1]) : '';
  const b = route[2] ? decodeURIComponent(route[2]) : '';
  if (!a || a === 'search') {
    const meta = Cat.hasText() ? state.catechism : null;   // the Catechism's text is read into memory once, for the search and the asking
    if (meta && !Cat.textReady() && catFailed !== meta.loadedAt) {
      container.append(el('p', { class: 'muted', text: t('Loading the Catechism…') }));
      Promise.all([Cat.load().catch(() => {}), Cat.loadText()]).then(([, ok]) => { if (!ok) catFailed = meta.loadedAt || 'x'; render(container, route); });
      return;
    }
    return listPage(container, a ? b : '');
  }
  if (a) {
    let hb = bookOf(a);
    if (!hb) {
      toast(t('That handbook is not loaded on this device.'), true);
      location.hash = '#handbooks';
      return;
    }
    const chosen = picked.get(hb.key);   // the language picked on the EN | AF switch, while the app stays in its own
    if (chosen && chosen !== hb.language) hb = copies(hb.key).find(x => x.language === chosen) || hb;
    if (b) return chapterPage(container, hb, b);
    return hb.builtIn ? wholePage(container, hb) : contentsPage(container, hb);
  }
}

function crumbs(links) {
  const parts = [];
  links.filter(Boolean).forEach(([text, href], i) => { if (i) parts.push(' › '); parts.push(el('a', { href, text })); });
  return el('div', { class: 'crumbs' }, parts);
}

/** The copyright line: the handbooks are loaded by the minister himself; the Creed is part of the app. On the screen, and at the foot of a PDF. */
function creditText(hb) {
  if (hb && hb.builtIn) return t('The Creed of the New Apostolic Church © New Apostolic Church International, Zurich. The ten Articles of Faith, as the Church confesses them; part of the app.');
  return t('The handbooks are © New Apostolic Church International, Zurich. Loaded by you onto your own device for your own work as a minister; they are not part of the public app.');
}

function credit(hb) {
  return el('p', { class: 'muted small hb-credit', text: creditText(hb) });
}

/** "Current as of 15.01.2025 (Version 4) · 104 pages · 271 chapters"; "… · 750 questions" for the Catechism in questions and answers; for the Creed, what it is. */
export function aboutLine(hb) {
  if (hb.builtIn) return t('The ten Articles of Faith. Part of the app, nothing to load.');
  const count = hb.qa ? t('{n} questions', { n: hb.questions || hb.chapters.filter(c => c.qn != null).length }) : t('{n} chapters', { n: hb.chapters.length });
  return [hb.edition, hb.pages ? t('{n} pages', { n: hb.pages }) : '', count].filter(Boolean).join(' · ');
}

/** The number a chapter's row shows: a question's own number (108), a chapter's (4.5), none for an appendix. */
const numOf = c => (c.qn != null ? String(c.qn) : c.n && !/^A/.test(c.n) ? c.n : '');

function listPage(container, q) {
  const books = loaded();                          // the Creed first, then the handbooks loaded from their files
  const files = books.filter(h => !h.builtIn);
  const cat = Cat.asHandbook();                    // the Catechism, once its text is on the device: searched and asked with the handbooks, read on its own tab
  const asked = cat ? [...books, cat] : books;
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Handbooks') })]),
    el('p', { class: 'hb-lead', text: t('The Church\'s books for your work as a minister, to read and to search: the Catechism, the Creed, the words at the altar, the Guide for Ministers, the "Serving and Leading" principle and the full Liturgy book.') }),
    searchBox(asked, q),
  );
  const list = el('div', { class: 'list lit-list hb-list' });
  const row = hb => el('a', { class: 'item', href: `#handbooks/${encodeURIComponent(hb.key)}`, lang: hb.language }, [
    hb.qa ? catIcon() : icon(),
    el('span', { class: 'grow' }, [el('b', { text: hb.title }), el('span', { class: 'muted small snippet', text: aboutLine(hb) })]),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
  ]);
  // the Catechism first, the Church's teaching, with its questions and answers once loaded; the Creed and after it the altar cards; then the handbooks loaded from their files
  const qa = books.filter(hb => hb.qa), creed = books.filter(hb => hb.key === 'creed'), rest = books.filter(hb => !hb.qa && hb.key !== 'creed');
  list.append(catRow(cat), ...qa.map(row), ...creed.map(row), liturgyRow(), ...rest.map(row));
  container.append(el('h3', { class: 'sub', text: t('Read') }), list);
  const ask = askBox(asked, cat ? { lead: t('Claude reads the chapters of the handbooks, and the sections of the Catechism, that fit your question and answers from them in plain words, naming them, so you can check what the books say. The answer is not kept.') } : {});
  if (ask) container.append(ask);
  // the handbooks are loaded and removed under Church files (files.js), a row each; while none is loaded, what loading means
  if (!files.length) {
    container.append(el('div', { class: 'lit-empty' }, [
      el('p', { text: t('The handbooks are the Church\'s own, so they are not part of the app. Load each one once under Church files, as its PDF or as a text file saved from it: the app reads the chapters from the file on this device itself, and they reach your other devices through the sync.') }),
      el('div', { class: 'row' }, [el('a', { class: 'btn small', href: '#files', text: t('Open Church files') })]),
    ]));
  } else {
    container.append(el('p', { class: 'small lit-fullbook' }, [t('The handbooks are loaded and removed under '), el('a', { href: '#files', text: t('Church files') }), '.']));
  }
  container.append(credit());
}

/** The Catechism's row in the list: it opens its own screen (#catechism); searched and asked here too once its text is on the device (loaded under Church files). */
function catRow(cat) {
  return el('a', { class: 'item', href: '#catechism' }, [
    catIcon(),
    el('span', { class: 'grow' }, [
      el('b', { text: t('Catechism of the New Apostolic Church') }),
      el('span', { class: 'muted small snippet', text: cat ? t('The Church\'s teaching, chapter by chapter. Searched and asked here too.') : t('The Church\'s teaching, chapter by chapter. Load it under Church files to search and ask it here too.') }),
    ]),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
  ]);
}

/** The Liturgy's row: the altar cards, on their own screen (#liturgy, liturgy.js); the full Liturgy book of 2024 is a handbook in the list below it. */
function liturgyRow() {
  return el('a', { class: 'item', href: '#liturgy' }, [
    chalice(),
    el('span', { class: 'grow' }, [
      el('b', { text: t('Liturgy') }),
      el('span', { class: 'muted small snippet', text: t('The words at the altar, card by card') }),
    ]),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
  ]);
}

/** A word search across the loaded handbooks (or within one): the chapters whose title or text carry every word. */
function searchBox(books, q, one = null) {
  const input = el('input', { type: 'search', 'aria-label': one ? t('Search this handbook') : t('Search the handbooks'), autocomplete: 'off', value: q,
    placeholder: one && one.qa ? t('Search by a word or a question\'s number: "doop", 108…') : one ? t('Search this handbook by a word or a number: "sermon", 4.5…') : t('Search the handbooks by word: "sermon", "funeral", "confession"…') });
  const results = el('div', { class: 'list hb-hits', hidden: true });
  const show = () => {
    clear(results);
    const q = input.value.trim();
    if (!one) history.replaceState(null, '', q ? `#handbooks/search/${encodeURIComponent(q)}` : '#handbooks');
    results.hidden = !q;
    if (!q) return;
    const hits = search(books, q);
    if (!hits.length) results.append(el('p', { class: 'muted', text: t('Nothing found. Try one word, such as "blessing".') }));
    for (const h of hits.slice(0, 120)) {
      results.append(el('a', { class: 'item hb-hit', href: hrefOf(h.handbook, h.chapter), lang: h.handbook.language }, [
        el('span', { class: 'grow' }, [
          one ? null : el('span', { class: 'hb-from', text: h.handbook.title }),
          el('b', { text: label(h.chapter) }),
          h.snippet ? el('span', { class: 'snippet muted small', text: h.snippet }) : null,
        ]),
        el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
      ]));
    }
    if (hits.length > 120) results.append(el('p', { class: 'muted small', text: t('Showing 120 of {total}. Add a word to narrow it.', { total: hits.length }) }));
  };
  input.addEventListener('input', show);
  if (q) show();
  return el('div', { class: 'hb-search' }, [input, results]);
}

function contentsPage(container, hb) {
  const others = copies(hb.key).filter(x => x !== hb);
  const top = hb.qa ? hb.chapters.filter(c => c.level === 1) : hb.chapters.filter(c => c.level <= 2 || !c.n);
  const list = el('div', { class: 'list hb-contents' });
  for (const c of top) {
    const depth = c.n && !/^A/.test(c.n) && !hb.qa ? partsOf(c.n).length : 1;
    const range = hb.qa ? rangeOf(hb, c) : null;
    list.append(el('a', { class: 'item cat depth' + Math.min(depth, 4), href: hrefOf(hb, c), lang: hb.language }, [
      el('span', { class: 'num', text: c.n && !/^A/.test(c.n) ? c.n : '' }),
      range ? el('span', { class: 'grow' }, [c.title, el('span', { class: 'snippet muted small', text: t('Questions {from}–{to}', { from: range[0], to: range[1] }) })]) : el('span', { class: 'grow', text: c.title }),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    ]));
  }
  container.append(
    crumbs([[t('Handbooks'), '#handbooks']]),
    el('div', { class: 'page hb-page' }, [
      el('p', { class: 'eyebrow', text: hb.org || t('New Apostolic Church') }),
      el('div', { class: 'docbar' }, [
        el('h2', { text: hb.title, lang: hb.language }),
        others.length ? seg([hb, ...others].map(x => [x.language, x.language.toUpperCase()]), hb.language, v => { picked.set(hb.key, v); render(container, ['handbooks', hb.key]); }, { label: t('Language') }) : null,
        el('span', { class: 'btns' }, [printButton(() => printSheet([[t('The whole handbook'), () => chapterPdf(hb, hb.chapters, { whole: true, credit: creditText(hb) })]]))]),
      ]),
      el('p', { class: 'muted small', text: [hb.ownTitle && hb.ownTitle !== hb.title ? hb.ownTitle : '', aboutLine(hb), t('Loaded {date} from {file}.', { date: fmtDate(hb.loadedAt), file: hb.fileName || t('a file') })].filter(Boolean).join(' · ') }),
      searchBox([hb], '', hb),
      el('h3', { class: 'sub', text: t('Contents') }),
      list,
      credit(hb),
    ]),
  );
}

/** The language the person picked for a handbook that is loaded in two, while the app stays in the language it was picked under. */
const picked = new Map();   // key -> language

function chapterPage(container, hb, addr) {
  const chosen = picked.get(hb.key);
  if (chosen && chosen !== hb.language) hb = copies(hb.key).find(x => x.language === chosen) || hb;
  const i = indexAt(hb, addr);
  if (i < 0) {
    toast(t('That chapter was not found.'), true);
    location.hash = `#handbooks/${encodeURIComponent(hb.key)}`;
    return;
  }
  const c = hb.chapters[i];
  const parent = parentOf(hb, c);
  const kids = childrenOf(hb, c);
  const prev = hb.chapters[i - 1], next = hb.chapters[i + 1];
  const body = el('div', { class: 'hb-text size-' + (state.settings.fontSize || 'm'), lang: hb.language }, [...c.blocks.map(block), catLink(c)].filter(Boolean));
  const others = copies(hb.key).filter(x => x !== hb);
  container.append(
    crumbs([[t('Handbooks'), '#handbooks'], [hb.title, `#handbooks/${encodeURIComponent(hb.key)}`], parent ? [label(parent), hrefOf(hb, parent)] : null]),
    el('div', { class: 'page hb-page' }, [
      el('p', { class: 'eyebrow', text: hb.title }),
      el('div', { class: 'docbar' }, [
        el('h2', { text: label(c), lang: hb.language }),
        others.length ? seg([hb, ...others].map(x => [x.language, x.language.toUpperCase()]), hb.language, v => { picked.set(hb.key, v); render(container, ['handbooks', hb.key, addr]); }, { label: t('Language') }) : null,
        el('span', { class: 'btns' }, [
          el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), onclick: () => sizeSheet(body) }),
          printRows(hb, c).length ? printButton(() => printSheet(printRows(hb, c))) : null,
        ]),
      ]),
      c.blocks.length ? body : null,
      hb.qa ? questionLinks(hb, c) : null,
      kids.length ? el('div', {}, [
        el('h3', { class: 'sub', text: hb.qa ? t('The questions of this chapter') : t('In this chapter') }),
        el('div', { class: 'list hb-kids' }, kids.map(k => el('a', { class: 'item cat', href: hrefOf(hb, k), lang: hb.language }, [
          el('span', { class: 'num', text: numOf(k) }),
          el('span', { class: 'grow', text: k.title }),
          el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
        ]))),
      ]) : null,
      el('nav', { class: 'hb-nav', 'aria-label': t('Previous and next chapter') }, [
        prev ? el('a', { href: hrefOf(hb, prev), lang: hb.language }, ['‹ ', label(prev)]) : el('span'),
        next ? el('a', { href: hrefOf(hb, next), lang: hb.language, class: 'hb-next' }, [label(next), ' ›']) : el('span'),
      ]),
      hb.builtIn ? null : el('p', { class: 'muted small', text: t('{title}, page {page}.', { title: hb.ownTitle || hb.title, page: c.page }) + (hb.edition ? ' ' + hb.edition + '.' : '') }),
      credit(hb),
    ]),
  );
}

/**
 * The Creed, read whole: ten short articles read best on one page, each
 * under its heading and with the section of the Catechism that explains it.
 * A search hit, or one of Claude's citations, still opens one article on
 * its own page (chapterPage), with the way on to the next.
 */
function wholePage(container, hb) {
  const others = copies(hb.key).filter(x => x !== hb);
  const body = el('div', { class: 'hb-text hb-whole size-' + (state.settings.fontSize || 'm'), lang: hb.language });
  for (const c of hb.chapters) body.append(...[el('h4', { class: 'hb-h' }, [c.title]), ...c.blocks.map(block), catLink(c)].filter(Boolean));
  container.append(
    crumbs([[t('Handbooks'), '#handbooks']]),
    el('div', { class: 'page hb-page' }, [
      el('p', { class: 'eyebrow', text: t('New Apostolic Church') }),
      el('div', { class: 'docbar' }, [
        el('h2', { text: hb.title, lang: hb.language }),
        others.length ? seg([hb, ...others].map(x => [x.language, x.language.toUpperCase()]), hb.language, v => { picked.set(hb.key, v); render(container, ['handbooks', hb.key]); }, { label: t('Language') }) : null,
        el('span', { class: 'btns' }, [
          el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), onclick: () => sizeSheet(body) }),
          printButton(() => printSheet([[t('The whole Creed'), () => chapterPdf(hb, hb.chapters, { whole: true, credit: creditText(hb) })]])),
        ]),
      ]),
      el('p', { class: 'muted small', text: t('The ten Articles of Faith, as the Church confesses them. Each article is explained in the Catechism, chapter 2.4; part of the app, nothing to load.') }),
      body,
      credit(hb),
    ]),
  );
}

/**
 * What a chapter's Print gives (handbook-pdf.js printSheet): the chapter on
 * its own, when it has words of its own, and with every chapter under it,
 * when there are any (by their numbers, also where the book prints the
 * number in the title: the Liturgy book's "2.1 Word service" under 2); an
 * article of the Creed on its own. Nothing for a heading with neither.
 */
function printRows(hb, c) {
  const under = hb.builtIn ? [] : chaptersUnder(hb.chapters, c);
  const rows = [];
  if (c.blocks.length) rows.push([hb.builtIn ? t('This article') : t('This chapter'), () => chapterPdf(hb, [c], { credit: creditText(hb) })]);
  if (under.length) rows.push([t('This chapter and the chapters under it'), () => chapterPdf(hb, [c, ...under], { credit: creditText(hb) })]);
  return rows;
}

/**
 * Under a question of the Catechism in questions and answers: the Bible
 * verses it quotes or the book's index gives it, each opening the reader,
 * and the questions its boxes point to ("sien Vrae 66, 108-109").
 */
function questionLinks(hb, c) {
  const verses = (c.refs || []).map(r => ({ book: r.b, chapter: r.c, verse: r.v || null, verseEnd: r.e && r.e !== r.v ? r.e : null }));
  const see = (c.see || []).filter(n => hb.chapters.some(x => x.qn === n));
  if (!verses.length && !see.length) return null;
  return el('div', { class: 'hb-qlinks' }, [
    verses.length ? el('h3', { class: 'sub', text: t('Bible references ({n})', { n: verses.length }) }) : null,
    verses.length ? el('div', { class: 'pills' }, verses.map(v => el('a', { class: 'pill link', href: `#read/${v.book}/${v.chapter}/${v.verse || ''}`, text: formatRef(v, hb.language) }))) : null,
    see.length ? el('h3', { class: 'sub', text: t('See also') }) : null,
    see.length ? el('div', { class: 'pills' }, see.map(n => el('a', { class: 'pill link', href: `#handbooks/${encodeURIComponent(hb.key)}/q${n}`, text: t('Question {n}', { n }) }))) : null,
  ]);
}

/** "In the Catechism: 2.4.4 ›": the section of the Catechism that explains an article of the Creed. */
function catLink(c) {
  if (!c.cat) return null;
  return el('p', { class: 'hb-cat' }, [el('a', { href: `#catechism/${encodeURIComponent(c.cat)}`, text: t('In the Catechism: {n}', { n: c.cat }) + ' ›' })]);
}

/** The runs of one block as text, italics, bold, small letters and raised figures; a verse's reference (style 'r', catq.js) on a line of its own, and a line break where the book starts a new line within a verse. */
function inline(runs) {
  return runs.flatMap(([text, style]) => {
    if (style === 'r') return [el('cite', { text: text.trim() })];
    if (text.includes('\n')) return text.split('\n').flatMap((part, i) => (i ? [el('br'), ...inline([[part, style]])] : inline([[part, style]])));
    let node = document.createTextNode(text);
    if (style.includes('sup')) node = el('sup', {}, node);
    if (style.includes('i')) node = el('i', {}, node);
    if (style.includes('b')) node = el('b', {}, node);
    if (style.includes('s') && !style.includes('sup')) node = el('small', {}, node);
    return node;
  });
}

const BULLET = { 1: '•', 2: '◦', 3: '–' };

/** A chapter's or a question's text as the reader shows it, for a place outside Handbooks (Prepare reads a question of the Catechism in questions and answers in place). */
export function textOf(c, language) {
  return el('div', { class: 'hb-text size-' + (state.settings.fontSize || 'm'), lang: language }, c.blocks.map(block));
}

function block(b) {
  const d = Math.min(3, Math.max(0, b.d || 0));
  if (b.k === 'h') return el('h4', { class: 'hb-h' }, inline(b.t));
  if (b.k === 'li') return el('div', { class: `hb-li d${d}` }, [el('span', { class: 'hb-bullet', 'aria-hidden': 'true', text: BULLET[d] || '•' }), el('span', { class: 'grow' }, inline(b.t))]);
  if (b.k === 'quote') return el('p', { class: `hb-quote d${d}` }, inline(b.t));
  if (b.k === 'note') return el('p', { class: `hb-note d${d}` }, inline(b.t));
  return el('p', { class: `hb-p d${d}` }, inline(b.t));
}

/** The reader's text sizes, so a chapter can be read at the pulpit size too. */
function sizeSheet(body) {
  const s = sheet(t('Text size'));
  s.body.append(seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    body.className = body.className.replace(/size-\w+/, 'size-' + v);
  }, { block: true, label: t('Text size') }));
}

/* ---------------------------------------------------------------- loading a handbook (from Church files, files.js) */

/** Reads a handbook's file (PDF or text) on the device and keeps it under its key and language: the row saved, or null when the file could not be read (the sheet says why). */
export async function read(file) {
  const b = busy(t('Reading the handbook'));
  try {
    b.say(t('Opening {file}…', { file: file.name }));
    let input, pages = null;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      const { readPages } = await import('./booklet.js');
      pages = await readPages(pdfjs, data, (n, total) => b.say(t('Page {n} of {total}', { n, total })));
    } else {
      input = fromText(await file.text());
    }
    let hb;
    if (pages && isQA(pages)) {   // the Catechism in questions and answers: its own reader (catq.js)
      b.say(t('Finding the questions…'));
      try {
        hb = parseQA(pages);
      } catch (e) {
        throw new Error(t('That file looks like the Catechism in questions and answers, but its questions could not be read. It needs the Church\'s own PDF of the book.'));
      }
    } else {
      b.say(t('Finding the chapters…'));
      try {
        hb = parse(input || fromPages(pages));
      } catch (e) {
        throw new Error(t('That file does not look like a handbook: no chapters were found in it. It needs the Church\'s own file, with numbered chapters, as a PDF or as the text saved from the PDF.'));
      }
    }
    const row = { id: `${hb.key}:${hb.language}`, key: hb.key, language: hb.language, title: hb.title, ownTitle: hb.ownTitle, org: hb.org, edition: hb.edition, pages: hb.pages, words: hb.words, fileName: file.name, loadedAt: new Date().toISOString(), chapters: hb.chapters };
    if (hb.qa) Object.assign(row, { qa: true, questions: hb.questions });
    await saveHandbook(row);
    picked.delete(row.key);
    b.done();
    toast(hb.qa ? t('{title} loaded: {n} questions.', { title: row.title, n: row.questions }) : t('{title} loaded: {n} chapters.', { title: row.title, n: row.chapters.length }));
    return row;
  } catch (e) {
    console.error(e);
    b.fail(e.message || t('The file could not be read.'));
    return null;
  }
}

/** Removes a loaded handbook (with Undo); `after` draws the screen it was removed from again. */
export async function remove(hb, after) {
  const q = Sync.isOn()
    ? t('Remove {title} from this device and, through sync, from your other devices? You can load the file again later.', { title: hb.title })
    : t('Remove {title} from this device? You can load the file again later.', { title: hb.title });
  if (!(await confirmBox(q, t('Remove'), true))) return;
  await deleteHandbook(hb.id);
  picked.delete(hb.key);
  after();
  toast(t('{title} removed.', { title: hb.title }), false, async () => {
    await saveHandbook(hb);
    after();
  });
}

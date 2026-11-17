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
 * minister loads each one once, as the PDF or as a text file saved from it.
 * handbook.js reads it on the device itself (no AI, no key) into chapters,
 * which are kept in the `handbooks` store, one row per handbook and
 * language (id '<key>:<language>', e.g. 'guide-for-ministers:en'), from
 * where they travel with the sync to the other devices. They are not in the
 * backup file, like the Catechism text, the Guides and the altar booklet.
 *
 * #handbooks lists the loaded handbooks with a word search across them;
 * #handbooks/search/<words> is that search; #handbooks/<key> is a
 * handbook's table of contents; #handbooks/<key>/<n> is one chapter (n is
 * its number, or 'i<k>' for a chapter without one). On a PC Handbooks has
 * its own place in the side menu after Catechism; the phone's bar keeps five
 * tabs, so there it is listed under More (more.js), and More stays lit while
 * it is open (app.js). Where the AI helper is unlocked (lock.js), the list
 * page also has "Ask the handbooks": Claude answers a question from the
 * chapters that fit it, naming them; a locked device shows nothing of that.
 */
import { el, clear, toast, confirmBox, busy, seg, sheet, fmtDate, SIZES } from './ui.js';
import { state, saveHandbook, deleteHandbook, saveSetting } from './store.js';
import { t, lang } from './i18n.js';
import { KNOWN, fromPages, fromText, parse, search, relevant } from './handbook.js';
import { noKey } from './guides.js';
import * as AI from './ai.js';
import * as Sync from './sync.js';

/** One line on each handbook the app knows by name, for the list while it is not loaded yet. */
const ABOUT = {
  'guide-for-ministers': () => t('The rule book for ministers: ministry, the divine service, the sacraments and acts of blessing, pastoral care, administration, and the competency profiles.'),
  'serving-and-leading': () => t('The guiding principle for everyone who leads in the Church: serving, authority, delegation, communication, conflict resolution.'),
  'liturgy': () => t('The full liturgy book of 2024: the divine service in its short and long form, the special services, the sacraments and every act of blessing.'),
};

/* ---------------------------------------------------------------- which handbook, which chapter */

/** The loaded copies of a handbook, the app's language first. */
const copies = key => state.handbooks.filter(h => h.key === key).sort((a, b) => (a.language === lang() ? -1 : b.language === lang() ? 1 : a.language.localeCompare(b.language)));

/** The handbook to show under a key: the copy in the app's language, else the other one; null when none is loaded. */
const bookOf = key => copies(key)[0] || null;

/** The handbooks on this device, one per key, the known ones in their order and the rest by title. */
function loaded() {
  const keys = [...new Set(state.handbooks.map(h => h.key))];
  const rank = k => { const i = KNOWN.findIndex(([key]) => key === k); return i < 0 ? KNOWN.length : i; };
  return keys.map(bookOf).sort((a, b) => rank(a.key) - rank(b.key) || a.title.localeCompare(b.title));
}

const partsOf = n => String(n).split('.');

/** A chapter's address in the hash: its number, or its place when it has none. */
const addrOf = (hb, c) => (c.n ? c.n : 'i' + hb.chapters.indexOf(c));
const hrefOf = (hb, c) => `#handbooks/${encodeURIComponent(hb.key)}/${encodeURIComponent(addrOf(hb, c))}`;

/** The chapter at an address, or -1. */
function indexAt(hb, addr) {
  const m = String(addr).match(/^i(\d+)$/);
  if (m) return hb.chapters[+m[1]] ? +m[1] : -1;
  return hb.chapters.findIndex(c => c.n === addr);
}

/** "4.5.4  Requirements of the sermon"; an appendix or an unnumbered chapter by its title alone. */
const label = c => (c.n && !/^A/.test(c.n) ? c.n + '  ' : '') + c.title;

/** The chapter a numbered chapter sits under: 4.5 for 4.5.4. */
function parentOf(hb, c) {
  if (!c.n || !/\./.test(c.n)) return null;
  const n = partsOf(c.n).slice(0, -1).join('.');
  return hb.chapters.find(x => x.n === n) || null;
}

/** The chapters one level under this one: 4.5.1 … 4.5.4 under 4.5. */
function childrenOf(hb, c) {
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

/* ---------------------------------------------------------------- the screens */

export function render(container, route) {
  clear(container);
  const a = route[1] ? decodeURIComponent(route[1]) : '';
  const b = route[2] ? decodeURIComponent(route[2]) : '';
  if (a === 'search') return listPage(container, b);
  if (a) {
    const hb = bookOf(a);
    if (!hb) {
      toast(t('That handbook is not loaded on this device.'), true);
      location.hash = '#handbooks';
      return;
    }
    if (b) return chapterPage(container, hb, b);
    return contentsPage(container, hb);
  }
  listPage(container, '');
}

function crumbs(links) {
  const parts = [];
  links.filter(Boolean).forEach(([text, href], i) => { if (i) parts.push(' › '); parts.push(el('a', { href, text })); });
  return el('div', { class: 'crumbs' }, parts);
}

function credit() {
  return el('p', { class: 'muted small hb-credit', text: t('The handbooks are © New Apostolic Church International, Zurich. Loaded by you onto your own device for your own work as a minister; they are not part of the public app.') });
}

/** "Current as of 15.01.2025 (Version 4) · 104 pages · 271 chapters" */
function aboutLine(hb) {
  return [hb.edition, hb.pages ? t('{n} pages', { n: hb.pages }) : '', t('{n} chapters', { n: hb.chapters.length })].filter(Boolean).join(' · ');
}

function listPage(container, q) {
  const books = loaded();
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Handbooks') })]),
    el('p', { class: 'hb-lead', text: t('The Church\'s handbooks for ministers, to read and to search: the Guide for Ministers, the "Serving and Leading" principle and the full Liturgy book.') }),
  );
  if (!books.length) {
    container.append(el('div', { class: 'lit-empty' }, [
      el('p', { text: t('The handbooks are the Church\'s own, so they are not part of the app. Load each one here once, as its PDF or as a text file saved from it: the app reads the chapters from the file on this device itself, and they reach your other devices through the sync.') }),
      el('div', { class: 'row' }, [el('button', { class: 'btn small', type: 'button', text: t('Load a handbook (PDF or text file)'), onclick: () => load(container) })]),
    ]));
  } else {
    container.append(searchBox(books, q));
    const list = el('div', { class: 'list lit-list hb-list' });
    for (const hb of books) {
      list.append(el('a', { class: 'item', href: `#handbooks/${encodeURIComponent(hb.key)}`, lang: hb.language }, [
        icon(),
        el('span', { class: 'grow' }, [el('b', { text: hb.title }), el('span', { class: 'muted small snippet', text: aboutLine(hb) })]),
        el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
      ]));
    }
    container.append(el('h3', { class: 'sub', text: t('Read') }), list);
    const ask = askBox(books);
    if (ask) container.append(ask);
  }
  // the handbooks on this device, one line each, with the buttons to load or remove them; the known ones are listed even before they are loaded
  const section = el('div', { class: 'lit-books' }, [el('h3', { class: 'sub', text: t('The files') })]);
  const keys = [...KNOWN.map(([key]) => key), ...books.map(h => h.key).filter(k => !KNOWN.some(([key]) => key === k))];
  for (const key of keys) {
    const all = copies(key);
    const known = KNOWN.find(([k]) => k === key);
    const title = all[0] ? all[0].title : known[2];
    section.append(el('div', { class: 'lit-book' }, [
      el('div', {}, [el('b', { text: title + ': ' }), all.length
        ? all.map(hb => t('{language}, {about}, loaded {date} from {file}.', { language: hb.language === 'af' ? t('Afrikaans') : hb.language === 'de' ? t('German') : t('English'), about: aboutLine(hb), date: fmtDate(hb.loadedAt), file: hb.fileName || t('a file') })).join(' ')
        : t('not loaded yet.')]),
      !all.length && ABOUT[key] ? el('div', { class: 'muted small', text: ABOUT[key]() }) : null,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small' + (all.length ? ' ghost' : ''), type: 'button', text: all.length ? t('Load a newer file') : t('Load it (PDF or text file)'), onclick: () => load(container) }),
        ...all.map(hb => el('button', { class: 'btn small ghost danger', type: 'button', text: all.length > 1 ? t('Remove ({language})', { language: hb.language.toUpperCase() }) : t('Remove'), onclick: () => remove(container, hb) })),
      ]),
    ]));
  }
  section.append(el('div', { class: 'row' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Load another handbook'), onclick: () => load(container) })]));
  container.append(section, credit());
}

/** A word search across the loaded handbooks (or within one): the chapters whose title or text carry every word. */
function searchBox(books, q, one = null) {
  const input = el('input', { type: 'search', 'aria-label': one ? t('Search this handbook') : t('Search the handbooks'), autocomplete: 'off', value: q,
    placeholder: one ? t('Search this handbook by a word or a number: "sermon", 4.5…') : t('Search the handbooks by word: "sermon", "funeral", "confession"…') });
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
  const top = hb.chapters.filter(c => c.level <= 2 || !c.n);
  const list = el('div', { class: 'list hb-contents' });
  for (const c of top) {
    const depth = c.n && !/^A/.test(c.n) ? partsOf(c.n).length : 1;
    list.append(el('a', { class: 'item cat depth' + Math.min(depth, 4), href: hrefOf(hb, c), lang: hb.language }, [
      el('span', { class: 'num', text: c.n && !/^A/.test(c.n) ? c.n : '' }),
      el('span', { class: 'grow', text: c.title }),
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
      ]),
      el('p', { class: 'muted small', text: [hb.ownTitle && hb.ownTitle !== hb.title ? hb.ownTitle : '', aboutLine(hb), t('Loaded {date} from {file}.', { date: fmtDate(hb.loadedAt), file: hb.fileName || t('a file') })].filter(Boolean).join(' · ') }),
      searchBox([hb], '', hb),
      el('h3', { class: 'sub', text: t('Contents') }),
      list,
      credit(),
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
  const body = el('div', { class: 'hb-text size-' + (state.settings.fontSize || 'm'), lang: hb.language }, c.blocks.map(block));
  const others = copies(hb.key).filter(x => x !== hb);
  container.append(
    crumbs([[t('Handbooks'), '#handbooks'], [hb.title, `#handbooks/${encodeURIComponent(hb.key)}`], parent ? [label(parent), hrefOf(hb, parent)] : null]),
    el('div', { class: 'page hb-page' }, [
      el('p', { class: 'eyebrow', text: hb.title }),
      el('div', { class: 'docbar' }, [
        el('h2', { text: label(c), lang: hb.language }),
        others.length ? seg([hb, ...others].map(x => [x.language, x.language.toUpperCase()]), hb.language, v => { picked.set(hb.key, v); render(container, ['handbooks', hb.key, addr]); }, { label: t('Language') }) : null,
        el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), onclick: () => sizeSheet(body) }),
      ]),
      c.blocks.length ? body : null,
      kids.length ? el('div', {}, [
        el('h3', { class: 'sub', text: t('In this chapter') }),
        el('div', { class: 'list hb-kids' }, kids.map(k => el('a', { class: 'item cat', href: hrefOf(hb, k), lang: hb.language }, [
          el('span', { class: 'num', text: k.n }),
          el('span', { class: 'grow', text: k.title }),
          el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
        ]))),
      ]) : null,
      el('nav', { class: 'hb-nav', 'aria-label': t('Previous and next chapter') }, [
        prev ? el('a', { href: hrefOf(hb, prev), lang: hb.language }, ['‹ ', label(prev)]) : el('span'),
        next ? el('a', { href: hrefOf(hb, next), lang: hb.language, class: 'hb-next' }, [label(next), ' ›']) : el('span'),
      ]),
      el('p', { class: 'muted small', text: t('{title}, page {page}.', { title: hb.ownTitle || hb.title, page: c.page }) + (hb.edition ? ' ' + hb.edition + '.' : '') }),
      credit(),
    ]),
  );
}

/** The runs of one block as text, italics, bold, small letters and raised figures. */
function inline(runs) {
  return runs.map(([text, style]) => {
    let node = document.createTextNode(text);
    if (style.includes('sup')) node = el('sup', {}, node);
    if (style.includes('i')) node = el('i', {}, node);
    if (style.includes('b')) node = el('b', {}, node);
    if (style.includes('s') && !style.includes('sup')) node = el('small', {}, node);
    return node;
  });
}

const BULLET = { 1: '•', 2: '◦', 3: '–' };

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

/* ---------------------------------------------------------------- loading a handbook */

/** The file picker, then the wait while the file is read on the device; the handbook is saved under its own key and language. */
function load(container) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf,text/plain,.txt', hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (file) await read(file, container);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

async function read(file, container) {
  const b = busy(t('Reading the handbook'));
  try {
    b.say(t('Opening {file}…', { file: file.name }));
    let input;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      const { readPages } = await import('./booklet.js');
      input = fromPages(await readPages(pdfjs, data, (n, total) => b.say(t('Page {n} of {total}', { n, total }))));
    } else {
      input = fromText(await file.text());
    }
    b.say(t('Finding the chapters…'));
    let hb;
    try {
      hb = parse(input);
    } catch (e) {
      throw new Error(t('That file does not look like a handbook: no chapters were found in it. It needs the Church\'s own file, with numbered chapters, as a PDF or as the text saved from the PDF.'));
    }
    const row = { id: `${hb.key}:${hb.language}`, key: hb.key, language: hb.language, title: hb.title, ownTitle: hb.ownTitle, org: hb.org, edition: hb.edition, pages: hb.pages, words: hb.words, fileName: file.name, loadedAt: new Date().toISOString(), chapters: hb.chapters };
    await saveHandbook(row);
    picked.delete(row.key);
    b.done();
    toast(t('{title} loaded: {n} chapters.', { title: row.title, n: row.chapters.length }));
    location.hash = `#handbooks/${encodeURIComponent(row.key)}`;
    if (location.hash === `#handbooks/${encodeURIComponent(row.key)}`) render(container, ['handbooks', row.key]);
  } catch (e) {
    console.error(e);
    b.fail(e.message || t('The file could not be read.'));
  }
}

async function remove(container, hb) {
  const q = Sync.isOn()
    ? t('Remove {title} from this device and, through sync, from your other devices? You can load the file again later.', { title: hb.title })
    : t('Remove {title} from this device? You can load the file again later.', { title: hb.title });
  if (!(await confirmBox(q, t('Remove'), true))) return;
  await deleteHandbook(hb.id);
  picked.delete(hb.key);
  render(container, ['handbooks']);
  toast(t('{title} removed.', { title: hb.title }), false, async () => {
    await saveHandbook(hb);
    render(container, ['handbooks']);
  });
}

/* ---------------------------------------------------------------- asking Claude */

/*
 * "Ask the handbooks": the person asks in their own words; the chapters
 * that carry the words of the question (handbook.js relevant) go to Claude,
 * who answers from them alone, in plain words, naming the chapters so the
 * answer can be checked against the book. The answer is shown, not kept.
 * Only where the AI helper is unlocked on this device (lock.js): a locked
 * device shows nothing of it.
 */
function sparkle() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

function askBox(books) {
  if (!AI.unlocked()) return null;
  const ta = el('textarea', { class: 'hb-q', rows: 2, 'aria-label': t('Ask the handbooks'), placeholder: t('A question for the handbooks: "How long may the sermon be?", "Who may hold a prayer service?"…') });
  const out = el('div', { class: 'hb-answer' });
  return el('div', { class: 'th-ask hb-ask' }, [
    el('h3', { class: 'sub', text: t('Ask the handbooks') }),
    el('p', { text: t('Claude reads the chapters that fit your question and answers from them in plain words, naming the chapters, so you can check what the book says. The answer is not kept.') }),
    ta,
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ai-btn', type: 'button', onclick: () => ask(ta.value.trim(), books, out) }, [sparkle(), t('Ask Claude')]),
      el('span', { class: 'muted small grow', text: t('With your own Anthropic key; usually under 10 US cents an answer.') }),
    ]),
    out,
  ]);
}

const paras = text => String(text || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => el('p', { text: x }));

async function ask(q, books, out) {
  if (!q) { toast(t('Type a question first.'), true); return; }
  if (!AI.ready()) { noKey(); return; }
  const picks = relevant(books, q, 12);
  if (!picks.length) { toast(t('No chapter carries the words of that question. Try other words.'), true); return; }
  const ctrl = new AbortController();
  const b = busy(t('Asking Claude'), () => ctrl.abort());
  b.say(t('Claude is reading {n} chapters of the handbooks. This takes about half a minute.', { n: picks.length }));
  try {
    const r = await AI.askHandbooks(q, picks.map(p => ({ handbook: p.handbook, chapter: p.chapter, addr: addrOf(p.handbook, p.chapter) })), { signal: ctrl.signal });
    b.done();
    clear(out);
    const d = r.data;
    const cites = (Array.isArray(d.cites) ? d.cites : []).map(x => {
      const hb = bookOf(x.key) || books.find(h => h.key === x.key);
      const i = hb ? indexAt(hb, x.n) : -1;
      return i >= 0 ? el('li', {}, [el('a', { href: hrefOf(hb, hb.chapters[i]), lang: hb.language, text: `${hb.title}: ${label(hb.chapters[i])}` })]) : el('li', { text: [x.title, x.n].filter(Boolean).join(' ') });
    });
    out.append(...[
      el('div', { class: 'hb-answer-text' }, paras(d.answer)),
      d.found === false ? el('p', { class: 'muted small', text: t('The chapters read do not answer this; what stands above is as near as they come.') }) : null,
      cites.length ? el('div', {}, [el('b', { class: 'small', text: t('From') }), el('ul', { class: 'hb-cites small' }, cites)]) : null,
      el('p', { class: 'muted small', text: t('Written {date} by {model}{cost}.', { date: fmtDate(new Date().toISOString()), model: AI.modelLabel(r.model), cost: r.cost ? ', ' + AI.fmtCost(r.cost) : '' }) + ' ' + t('A help for study, not Church doctrine: the Church\'s teaching is in the Catechism, and the Apostles interpret Holy Scripture (CNAC 1.2.5.1).') }),
    ].filter(Boolean));
    out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    b.fail(e.message || String(e));
  }
}

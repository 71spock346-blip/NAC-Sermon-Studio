/*
 * The Read tab: one chapter at a time, in the chosen translation, with an
 * optional second translation interleaved verse by verse. Each verse carries
 * two marks: a "C" when the Catechism quotes it and a pen when the person has
 * written a note on it. Tapping verses selects them; the bar that appears
 * offers a note, the Catechism sections, a service preparation, a copy, and
 * the licensed translations on YouVersion or BibleGateway.
 */
import { el, $, clear, toast, sheet, copyText } from './ui.js';
import { BOOKS, BY_ID, GROUPS, GROUPS_AF, bookName, parseRef, formatRef } from './books.js';
import { state, saveSetting } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as Notes from './notes.js';
import * as Prepare from './prepare.js';
import { unpastedCard, pasteSheet } from './paste.js';

let current = { book: 'PSA', chapter: 23, verse: null };

// "Beside" opens BibleSA in its own window next to the app. BibleSA refuses to be
// shown inside another site, so the window is the only way to keep it in view;
// this page opened it, so it may move it to each new chapter without a tap.
let besideWin = null;      // the BibleSA window, while it is open
let besideUrl = '';        // the address it was last sent to
// The text moves to the left while Beside is on, leaving room for that window; other tabs keep the normal layout.
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#read')) document.body.classList.remove('beside'); });
let selected = new Set();
let scrollToVerse = null;  // the verse named in the address, scrolled to once
let verses = [];           // the primary text of the open chapter
let container = null;

export function render(root, route) {
  container = root;
  selected = new Set();
  const [, book, chapter, verse] = route;
  if (book && BY_ID[book]) {
    current = { book, chapter: Math.max(1, parseInt(chapter, 10) || 1), verse: parseInt(verse, 10) || null };
  } else {
    const [b, c] = (state.settings.lastRef || 'PSA.23').split('.');
    current = { book: BY_ID[b] ? b : 'PSA', chapter: parseInt(c, 10) || 1, verse: null };
    const target = `#read/${current.book}/${current.chapter}`;
    if (location.hash !== target) { history.replaceState(null, '', target); }
  }
  selected = new Set(current.verse ? [current.verse] : []);
  scrollToVerse = current.verse;
  saveSetting('lastRef', `${current.book}.${current.chapter}`);
  draw();
}

export function currentRef() { return { ...current }; }

async function draw() {
  clear(container);
  const lang = state.settings.bookLang;
  const srcId = Bible.source(state.settings.translation) ? state.settings.translation : 'kjv';
  const cmpId = state.settings.compare && Bible.source(state.settings.compare) && state.settings.compare !== srcId ? state.settings.compare : '';
  const besideExt = Bible.EXTERNAL.find(x => x.sa && x.sa === state.settings.beside) || null;
  document.body.classList.toggle('beside', !!besideExt);

  // ---- navigation bar
  const bookSel = el('select', { id: 'r-book', 'aria-label': 'Book' });
  for (const g of ['ot', 'ap', 'nt']) {
    const grp = el('optgroup', { label: (lang === 'af' ? GROUPS_AF : GROUPS)[g] });
    for (const b of BOOKS.filter(x => x.group === g)) grp.append(el('option', { value: b.id, text: bookName(b.id, lang), selected: b.id === current.book }));
    bookSel.append(grp);
  }
  const chapSel = el('select', { id: 'r-chapter', 'aria-label': 'Chapter' });
  const counts = await Bible.bookIndex(srcId);
  const nChapters = counts[current.book] || 1;
  if (current.chapter > nChapters) current.chapter = nChapters;
  for (let i = 1; i <= nChapters; i++) chapSel.append(el('option', { value: i, text: i, selected: i === current.chapter }));
  bookSel.addEventListener('change', () => go(bookSel.value, 1));
  chapSel.addEventListener('change', () => go(current.book, parseInt(chapSel.value, 10)));

  const gotoInput = el('input', { type: 'search', placeholder: lang === 'af' ? 'Gaan na: Ps 130:7, Lukas 8:16' : 'Go to: Ps 130:7, John 3:16, 1 Kor 13', 'aria-label': 'Go to a reference', enterkeyhint: 'go' });
  const gotoForm = el('form', { class: 'goto', onsubmit: e => {
    e.preventDefault();
    const ref = parseRef(gotoInput.value);
    if (!ref) { toast('That reference was not understood. Try "Psalm 130:7".', true); return; }
    gotoInput.value = '';
    location.hash = `#read/${ref.book}/${ref.chapter}${ref.verse ? '/' + ref.verse : ''}`;
  } }, [gotoInput, el('button', { class: 'btn small', type: 'submit', text: 'Go' })]);

  const srcSel = el('select', { id: 'r-src', 'aria-label': 'Translation' });
  const cmpSel = el('select', { id: 'r-cmp', 'aria-label': 'Compare with' }, el('option', { value: '', text: 'Compare: none' }));
  for (const s of Bible.sources()) {
    srcSel.append(el('option', { value: s.id, text: s.short, selected: s.id === srcId }));
    if (s.id !== srcId) cmpSel.append(el('option', { value: s.id, text: '+ ' + s.short, selected: s.id === cmpId }));
  }
  srcSel.addEventListener('change', async () => { await saveSetting('translation', srcSel.value); if (state.settings.compare === srcSel.value) await saveSetting('compare', ''); draw(); });
  cmpSel.addEventListener('change', async () => { await saveSetting('compare', cmpSel.value); draw(); });
  const besideSel = el('select', { id: 'r-beside', 'aria-label': 'Show beside the text' }, el('option', { value: '', text: 'Beside: none' }));
  for (const x of Bible.EXTERNAL.filter(x => x.sa)) besideSel.append(el('option', { value: x.sa, text: `${x.label} (BibleSA)`, selected: !!besideExt && besideExt.sa === x.sa }));
  besideSel.addEventListener('change', async () => { await saveSetting('beside', besideSel.value); draw(); });

  const sizeDown = el('button', { class: 'btn small ghost', type: 'button', text: 'A−', 'aria-label': 'Smaller text', onclick: () => resize(-1) });
  const sizeUp = el('button', { class: 'btn small ghost', type: 'button', text: 'A+', 'aria-label': 'Larger text', onclick: () => resize(1) });

  container.append(
    el('div', { class: 'readbar' }, [
      el('div', { class: 'row nav' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: '‹', 'aria-label': 'Previous chapter', onclick: () => step(-1, counts) }),
        bookSel, chapSel,
        el('button', { class: 'btn small ghost', type: 'button', text: '›', 'aria-label': 'Next chapter', onclick: () => step(1, counts) }),
        gotoForm,
      ]),
      el('div', { class: 'row src' }, [srcSel, cmpSel, besideSel, el('div', { class: 'spacer' }), sizeDown, sizeUp]),
    ]));

  // ---- the text
  const article = el('article', { class: 'scripture size-' + (state.settings.fontSize || 'm') });
  if (besideExt) { container.append(besideBar(besideExt)); followBeside(besideExt); }
  container.append(article);
  const heading = formatRef({ book: current.book, chapter: current.chapter }, lang);
  article.append(el('h2', { text: heading }));
  const status = el('p', { class: 'muted small', text: 'Loading…' });
  article.append(status);

  let primary, compare = null;
  try {
    [primary, compare] = await Promise.all([
      Bible.getChapter(srcId, current.book, current.chapter),
      cmpId ? Bible.getChapter(cmpId, current.book, current.chapter).catch(e => ({ verses: [], error: e.message })) : null,
    ]);
  } catch (e) {
    status.textContent = e.message || 'The chapter could not be loaded.';
    status.className = 'error';
    if (!Bible.source(srcId).builtin) {
      status.append(' ', el('button', { class: 'btn small ghost', type: 'button', text: 'Read the KJV instead', onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }));
    }
    return;
  }
  status.remove();
  if (primary.missing) {
    article.append(el('p', { class: 'muted' }, [
      `${bookName(current.book, lang)} is not part of this translation. `,
      el('button', { class: 'btn small ghost', type: 'button', text: 'Read it in the KJV', onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }),
    ]));
    return;
  }
  if (primary.unpasted) {
    article.append(unpastedCard(Bible.source(srcId), current.book, current.chapter, () => draw(), [
      el('button', { class: 'btn small ghost', type: 'button', text: 'Read the KJV instead', onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }),
    ]));
    return;
  }
  verses = primary.verses;
  if (primary.title) article.append(el('p', { class: 'ptitle', text: primary.title }));
  if (compare && compare.error) article.append(el('p', { class: 'error small', text: `${Bible.source(cmpId).short}: ${compare.error}` }));
  if (compare && compare.missing) article.append(el('p', { class: 'muted small', text: `${Bible.source(cmpId).short} does not contain this book.` }));
  if (compare && compare.unpasted) article.append(unpastedCard(Bible.source(cmpId), current.book, current.chapter, () => draw()));

  await Cat.load().catch(() => {});
  Cat.loadText().catch(() => {});
  const catMap = Cat.chapterMap(current.book, current.chapter);
  const noteList = Notes.notesFor(current.book, current.chapter);
  const cmpBy = new Map((compare && compare.verses || []).map(v => [v.n, v.text]));

  for (const v of verses) {
    const marks = el('span', { class: 'marks' });
    const cats = catMap.get(v.n);
    if (cats && cats.length) {
      marks.append(el('button', { class: 'mark c', type: 'button', title: `${cats.length} Catechism section${cats.length === 1 ? '' : 's'}`, text: 'C' + (cats.length > 1 ? cats.length : ''), onclick: e => { e.stopPropagation(); showCatechism(v.n, cats); } }));
    }
    const vnotes = noteList.filter(n => !n.verse || (v.n >= n.verse && v.n <= (n.verseEnd || n.verse)));
    if (vnotes.length) {
      marks.append(el('button', { class: 'mark n', type: 'button', title: `${vnotes.length} note${vnotes.length === 1 ? '' : 's'}`, text: '✎', onclick: e => { e.stopPropagation(); showNotes(v.n, vnotes); } }));
    }
    const row = el('div', { class: 'verse' + (selected.has(v.n) ? ' sel' : ''), dataset: { v: v.n }, onclick: () => toggle(v.n) }, [
      el('sup', { class: 'vn', text: v.n }),
      el('span', { class: 'txt', text: v.text }),
      marks,
    ]);
    if (compare && cmpBy.has(v.n)) {
      row.append(el('span', { class: 'txt cmp', text: cmpBy.get(v.n) }));
    }
    article.append(row);
  }
  article.append(el('div', { class: 'row chapnav' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: '‹ Previous chapter', onclick: () => step(-1, counts) }),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn small ghost', type: 'button', text: 'Next chapter ›', onclick: () => step(1, counts) }),
  ]));

  // ---- copyright, FUMS and read-elsewhere links
  const foot = el('footer', { class: 'copyright small muted' });
  foot.append(el('p', { text: `${Bible.source(srcId).short}: ${primary.copyright || await Bible.copyrightOf(srcId)}` }));
  if (compare && !compare.error) foot.append(el('p', { text: `${Bible.source(cmpId).short}: ${compare.copyright || await Bible.copyrightOf(cmpId)}` }));
  if (Bible.source(srcId).provider === 'api' || (cmpId && Bible.source(cmpId).provider === 'api')) {
    foot.append(el('p', {}, ['Scripture text provided by ', el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }), '.']));
    for (const f of [primary.fums, compare && compare.fums]) if (f) foot.append(el('span', { class: 'fums', html: f }));
  }
  for (const [id, ch] of [[srcId, primary], [cmpId, compare]]) {
    const s = id && Bible.source(id);
    if (s && s.provider === 'mine' && ch && !ch.unpasted) {
      foot.append(el('p', {}, [el('button', { class: 'btn small ghost', type: 'button', text: `Edit the pasted ${s.ext.label} text`, onclick: () => pasteSheet(s, current.book, current.chapter, () => draw()) })]));
    }
  }
  const links = el('p', { class: 'elsewhere' }, 'Read this chapter in: ');
  for (const x of Bible.EXTERNAL) {
    links.append(el('a', { href: Bible.youVersionUrl(x, current.book, current.chapter), target: '_blank', rel: 'noopener', text: x.label }), ' ');
  }
  links.append('on YouVersion · ');
  for (const x of Bible.EXTERNAL.filter(x => x.sa)) {
    links.append(el('a', { href: Bible.bibleSaUrl(x, current.book, current.chapter), target: '_blank', rel: 'noopener', text: x.label }), ' ');
  }
  links.append('on BibleSA · ');
  links.append(el('a', { href: Bible.bibleGatewayUrl(heading, 'NKJV'), target: '_blank', rel: 'noopener', text: 'NKJV on BibleGateway' }));
  foot.append(links);
  container.append(foot);

  // ---- notes on this chapter
  const notesBox = el('section', { class: 'chapter-notes' });
  notesBox.append(el('h3', { class: 'sub', text: noteList.length ? `Your notes on this chapter (${noteList.length})` : 'Your notes on this chapter' }));
  if (!noteList.length) notesBox.append(el('p', { class: 'muted small', text: 'Tap a verse, then "Note", to write a thought, an experience or a sermon idea on it.' }));
  for (const n of noteList) notesBox.append(Notes.card(n, () => draw()));
  container.append(notesBox);

  container.append(el('div', { class: 'vactions', id: 'vactions', hidden: true }));
  updateActions();
  if (scrollToVerse) {
    const target = article.querySelector(`.verse[data-v="${scrollToVerse}"]`);
    scrollToVerse = null;
    if (target) setTimeout(() => target.scrollIntoView({ block: 'center' }), 30);
  }
}

/** Whether the BibleSA window this page opened is still open. */
function besideOpen() { return !!(besideWin && !besideWin.closed); }

/** The strip under the reader bar that opens the BibleSA window and says what it does. */
function besideBar(ext) {
  const button = el('button', { class: 'btn small primary', type: 'button' });
  const note = el('span', { class: 'muted small' });
  const refresh = (blocked) => {
    const open = besideOpen();
    button.textContent = open ? 'Show the window ↗' : 'Open beside ↗';
    const wide = matchMedia('(min-width: 900px)').matches;
    note.textContent = blocked ? 'The browser blocked the window. Allow pop-ups for this site (the icon at the right end of the address bar), then tap again.'
      : open ? 'open in its own window and following this chapter.' + (wide ? ' If it slips behind this window, tap "Show the window", or drag it to the right edge of the screen so Windows keeps both in view.' : '')
      : 'opens in its own window and follows this chapter';
  };
  button.addEventListener('click', () => { const shown = openBeside(ext); refresh(!shown); });
  refresh();
  return el('div', { class: 'beside-bar row' }, [
    el('b', { text: `${ext.label} on BibleSA` }),
    note,
    el('div', { class: 'spacer' }),
    button,
    el('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Close Beside', text: '✕', onclick: async () => { closeBeside(); await saveSetting('beside', ''); draw(); } }),
  ]);
}

/** Opens BibleSA at this chapter in a window beside the app (needs a tap), or brings the open one to the front.
 *  Returns false when the browser blocked the window. */
function openBeside(ext) {
  const url = Bible.bibleSaUrl(ext, current.book, current.chapter);
  if (besideOpen()) {
    try { if (besideUrl !== url) besideWin.location.href = url; besideUrl = url; besideWin.focus(); return true; } catch (e) { /* lost it: open afresh */ }
  }
  const sw = screen.availWidth || 1280, sh = screen.availHeight || 800;
  const w = Math.min(640, Math.max(360, Math.round(sw * 0.4)));
  const h = Math.max(480, sh - 90);
  besideWin = window.open(url, 'biblesa', `popup=yes,width=${w},height=${h},left=${Math.max(0, sw - w - 8)},top=40`);
  besideUrl = besideWin ? url : '';
  return !!besideWin;
}

/** Keeps the open BibleSA window on the chapter being read, without a tap. */
function followBeside(ext) {
  if (!besideOpen()) return;
  const url = Bible.bibleSaUrl(ext, current.book, current.chapter);
  if (url === besideUrl) return;
  try { besideWin.location.href = url; besideUrl = url; } catch (e) { /* the window moved on; leave it */ }
}

/** Closes the BibleSA window this page opened, if it is still open. */
function closeBeside() {
  if (besideOpen()) { try { besideWin.close(); } catch (e) { /* already gone */ } }
  besideWin = null; besideUrl = '';
}

function go(book, chapter) {
  location.hash = `#read/${book}/${chapter}`;
}

function step(dir, counts) {
  let { book, chapter } = current;
  const n = counts[book] || 1;
  chapter += dir;
  if (chapter < 1 || chapter > n) {
    const i = BOOKS.findIndex(b => b.id === book) + dir;
    if (i < 0 || i >= BOOKS.length) return;
    book = BOOKS[i].id;
    chapter = dir > 0 ? 1 : (counts[book] || 1);
  }
  go(book, chapter);
}

async function resize(dir) {
  const sizes = ['s', 'm', 'l', 'xl'];
  const i = Math.min(sizes.length - 1, Math.max(0, sizes.indexOf(state.settings.fontSize || 'm') + dir));
  await saveSetting('fontSize', sizes[i]);
  const art = $('.scripture', container);
  if (art) art.className = 'scripture size-' + sizes[i];
}

function toggle(n) {
  if (selected.has(n)) selected.delete(n); else selected.add(n);
  const row = container.querySelector(`.verse[data-v="${n}"]`);
  if (row) row.classList.toggle('sel', selected.has(n));
  updateActions();
}

function range() {
  const a = [...selected].sort((x, y) => x - y);
  return a.length ? { book: current.book, chapter: current.chapter, verse: a[0], verseEnd: a[a.length - 1] } : null;
}

function updateActions() {
  const bar = $('#vactions', container);
  if (!bar) return;
  clear(bar);
  const ref = range();
  if (!ref) { bar.hidden = true; return; }
  bar.hidden = false;
  const lang = state.settings.bookLang;
  const label = formatRef(ref, lang);
  const text = Bible.joinVerses(verses, ref.verse, ref.verseEnd);
  const cats = Cat.refsFor(ref.book, ref.chapter, ref.verse);
  for (let v = ref.verse + 1; v <= ref.verseEnd; v++) for (const s of Cat.refsFor(ref.book, ref.chapter, v)) if (!cats.includes(s)) cats.push(s);
  bar.append(
    el('div', { class: 'vlabel' }, [el('b', { text: label }), el('button', { class: 'icon', type: 'button', 'aria-label': 'Clear selection', text: '✕', onclick: clearSelection })]),
    el('div', { class: 'vbtns' }, [
      el('button', { class: 'btn small', type: 'button', text: 'Note', onclick: () => Notes.editNote(Notes.draft(ref), () => draw()) }),
      el('button', { class: 'btn small ghost', type: 'button', text: cats.length ? `Catechism (${cats.length})` : 'Catechism', disabled: !cats.length, onclick: () => showCatechism(ref.verse, cats, label) }),
      el('button', { class: 'btn small ghost', type: 'button', text: 'Prepare a service', onclick: () => Prepare.newFromText(ref, text, Bible.source(state.settings.translation)?.short || 'KJV') }),
      el('button', { class: 'btn small ghost', type: 'button', text: 'Copy', onclick: async () => { toast((await copyText(`${label} (${Bible.source(state.settings.translation)?.short}) ${text}`)) ? 'Copied.' : 'Could not copy.', false); } }),
      ...Bible.EXTERNAL.slice(0, 2).map(x => el('a', { class: 'btn small ghost', href: Bible.youVersionUrl(x, ref.book, ref.chapter, ref.verse), target: '_blank', rel: 'noopener', text: x.label + ' ↗' })),
    ]));
}

function clearSelection() {
  selected.clear();
  for (const r of container.querySelectorAll('.verse.sel')) r.classList.remove('sel');
  updateActions();
}

function showCatechism(verseN, sections, label) {
  const lang = state.settings.bookLang;
  const s = sheet(`Catechism on ${label || formatRef({ book: current.book, chapter: current.chapter, verse: verseN }, lang)}`);
  const hasText = Cat.textReady();
  s.body.append(el('p', { class: 'muted small', text: hasText
    ? 'These sections of the Catechism refer to this verse. Open one to read it and see its other references.'
    : 'These sections of the Catechism refer to this verse. Open one to see its other references, or read it at nak.org.' }));
  const list = el('div', { class: 'list' });
  for (const sec of sections) {
    const summary = hasText ? Cat.summaryOf(sec.n) : [];
    list.append(el('div', { class: 'item cat' }, [
      el('a', { class: 'grow', href: `#catechism/${encodeURIComponent(sec.n)}`, onclick: () => s.close() }, [
        el('span', { class: 'num', text: sec.n }), ' ', sec.title,
        summary.length ? el('span', { class: 'snippet muted small', text: summary[0] }) : null,
      ]),
      hasText ? null : el('a', { class: 'btn small ghost', href: Cat.url(sec), target: '_blank', rel: 'noopener', text: 'nak.org ↗' }),
    ]));
  }
  s.body.append(list);
}

function showNotes(verseN, notes) {
  const s = sheet(`Notes on ${formatRef({ book: current.book, chapter: current.chapter, verse: verseN }, state.settings.bookLang)}`);
  for (const n of notes) s.body.append(Notes.card(n, () => { s.close(); draw(); }));
}

/*
 * The Read tab: one chapter at a time, in the chosen translation, with an
 * optional second translation interleaved verse by verse. Each verse carries
 * two marks: a "C" when the Catechism quotes it and a pen when the person has
 * written a note on it. Tapping verses selects them; the bar that appears
 * offers a note, the Catechism sections, a service preparation, a copy, and
 * the licensed translations on YouVersion or BibleGateway.
 *
 * The bar above the text keeps to the essentials: book, chapter, Go to, the
 * translation and "Aa", which opens the reading choices (text size, theme,
 * language, Compare, Beside) in a sheet so the text starts high on a phone.
 */
import { el, $, clear, toast, sheet, copyText, seg, THEMES, SIZES, READS, applyTheme, applyRead } from './ui.js';
import { t, tn, lang, LANGS } from './i18n.js';
import { switchLang } from './app.js';
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
let counts = {};           // chapters per book of the open translation, for ‹ › and the arrow keys
let container = null;

// On a PC the left and right arrow keys turn the chapter, as in a book.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (!location.hash.startsWith('#read') || !container || $('.overlay')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault();
  step(e.key === 'ArrowRight' ? 1 : -1);
});

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
  const src = Bible.source(srcId);
  const cmpId = state.settings.compare && Bible.source(state.settings.compare) && state.settings.compare !== srcId ? state.settings.compare : '';
  const besideExt = Bible.EXTERNAL.find(x => x.sa && x.sa === state.settings.beside) || null;
  document.body.classList.toggle('beside', !!besideExt);

  // ---- the bar: book and chapter, then Go to, the translation and Aa
  const bookSel = el('select', { id: 'r-book', 'aria-label': t('Book') });
  for (const g of ['ot', 'ap', 'nt']) {
    const grp = el('optgroup', { label: (lang === 'af' ? GROUPS_AF : GROUPS)[g] });
    for (const b of BOOKS.filter(x => x.group === g)) grp.append(el('option', { value: b.id, text: bookName(b.id, lang), selected: b.id === current.book }));
    bookSel.append(grp);
  }
  const chapSel = el('select', { id: 'r-chapter', 'aria-label': t('Chapter') });
  counts = await Bible.bookIndex(srcId);
  const nChapters = counts[current.book] || 1;
  if (current.chapter > nChapters) current.chapter = nChapters;
  for (let i = 1; i <= nChapters; i++) chapSel.append(el('option', { value: i, text: i, selected: i === current.chapter }));
  bookSel.addEventListener('change', () => go(bookSel.value, 1));
  chapSel.addEventListener('change', () => go(current.book, parseInt(chapSel.value, 10)));

  const narrow = matchMedia('(max-width: 759.98px)').matches;
  const gotoInput = el('input', { type: 'search', placeholder: narrow ? t('Go to Ps 130:7…') : t('Go to: Ps 130:7, John 3:16…'), 'aria-label': t('Go to a reference'), enterkeyhint: 'go', autocomplete: 'off', spellcheck: 'false' });
  const gotoForm = el('form', { class: 'goto', onsubmit: e => {
    e.preventDefault();
    const ref = parseRef(gotoInput.value);
    if (!ref) { toast(t('That reference was not understood. Try "Psalm 130:7".'), true); return; }
    gotoInput.value = '';
    gotoInput.blur();
    location.hash = `#read/${ref.book}/${ref.chapter}${ref.verse ? '/' + ref.verse : ''}`;
  } }, [gotoInput, el('button', { class: 'btn small ghost', type: 'submit', text: t('Go') })]);

  const srcSel = el('select', { id: 'r-src', 'aria-label': t('Translation') });
  const cmpSel = el('select', { id: 'r-cmp', 'aria-label': t('Compare with') }, el('option', { value: '', text: t('Compare: none') }));
  for (const s of Bible.sources()) {
    srcSel.append(el('option', { value: s.id, text: s.short, selected: s.id === srcId }));
    if (s.id !== srcId) cmpSel.append(el('option', { value: s.id, text: '+ ' + s.short, selected: s.id === cmpId }));
  }
  srcSel.addEventListener('change', async () => { await saveSetting('translation', srcSel.value); if (state.settings.compare === srcSel.value) await saveSetting('compare', ''); draw(); });
  cmpSel.addEventListener('change', async () => { await saveSetting('compare', cmpSel.value); draw(); });
  const viewBtn = el('button', { id: 'r-view', class: 'btn small ghost', type: 'button', 'aria-label': t('Reading choices: text size, theme, compare and beside'), title: t('Text size, theme, Compare, Beside'), onclick: () => viewSheet(srcId) }, [
    'Aa', el('span', { html: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
  ]);

  container.append(
    el('div', { class: 'readbar' }, [
      el('div', { class: 'row nav' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: '‹', 'aria-label': t('Previous chapter'), onclick: () => step(-1) }),
        bookSel, chapSel,
        el('button', { class: 'btn small ghost', type: 'button', text: '›', 'aria-label': t('Next chapter'), onclick: () => step(1) }),
      ]),
      el('div', { class: 'row tools' }, [gotoForm, srcSel, cmpSel, viewBtn]),
    ]));

  // ---- the text
  const page = el('div', { class: 'page reader' });
  const article = el('article', { class: 'scripture size-' + (state.settings.fontSize || 'm'), lang: src && src.lang ? String(src.lang).slice(0, 2) : 'en' });
  if (besideExt) { container.append(besideBar(besideExt)); followBeside(besideExt); }
  container.append(page);
  page.append(article);
  const heading = formatRef({ book: current.book, chapter: current.chapter }, lang);
  article.append(el('header', { class: 'chap-head' }, [
    el('h2', { text: heading }),
    el('p', { class: 'caption', text: src ? (src.name || src.short) + (cmpId ? t(' · compared with {short}', { short: Bible.source(cmpId).short }) : '') : '' }),
  ]));
  const status = el('p', { class: 'muted small', text: t('Loading…') });
  article.append(status);

  let primary, compare = null;
  try {
    [primary, compare] = await Promise.all([
      Bible.getChapter(srcId, current.book, current.chapter),
      cmpId ? Bible.getChapter(cmpId, current.book, current.chapter).catch(e => ({ verses: [], error: e.message })) : null,
    ]);
  } catch (e) {
    status.textContent = e.message || t('The chapter could not be loaded.');
    status.className = 'error';
    if (!Bible.source(srcId).builtin) {
      status.append(' ', el('button', { class: 'btn small ghost', type: 'button', text: t('Read the KJV instead'), onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }));
    }
    return;
  }
  status.remove();
  if (primary.missing) {
    article.append(el('p', { class: 'muted' }, [
      t('{book} is not part of this translation.', { book: bookName(current.book, lang) }) + ' ',
      el('button', { class: 'btn small ghost', type: 'button', text: t('Read it in the KJV'), onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }),
    ]));
    return;
  }
  if (primary.unpasted) {
    article.append(unpastedCard(Bible.source(srcId), current.book, current.chapter, () => draw(), [
      el('button', { class: 'btn small ghost', type: 'button', text: t('Read the KJV instead'), onclick: async () => { await saveSetting('translation', 'kjv'); draw(); } }),
    ]));
    return;
  }
  verses = primary.verses;
  if (primary.title) article.append(el('p', { class: 'ptitle', text: primary.title }));
  if (compare && compare.error) article.append(el('p', { class: 'error small', text: `${Bible.source(cmpId).short}: ${compare.error}` }));
  if (compare && compare.missing) article.append(el('p', { class: 'muted small', text: t('{short} does not contain this book.', { short: Bible.source(cmpId).short }) }));
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
      marks.append(el('button', { class: 'mark c', type: 'button', 'aria-label': tn(cats.length, '{n} Catechism section on verse {v}', '{n} Catechism sections on verse {v}', { v: v.n }), title: tn(cats.length, '{n} Catechism section', '{n} Catechism sections'), text: 'C' + (cats.length > 1 ? cats.length : ''), onclick: e => { e.stopPropagation(); showCatechism(v.n, cats); } }));
    }
    const vnotes = noteList.filter(n => !n.verse || (v.n >= n.verse && v.n <= (n.verseEnd || n.verse)));
    if (vnotes.length) {
      marks.append(el('button', { class: 'mark n', type: 'button', 'aria-label': tn(vnotes.length, '{n} note on verse {v}', '{n} notes on verse {v}', { v: v.n }), title: tn(vnotes.length, '{n} note', '{n} notes'), text: '✎', onclick: e => { e.stopPropagation(); showNotes(v.n, vnotes); } }));
    }
    const on = selected.has(v.n);
    const row = el('div', {
      class: 'verse' + (on ? ' sel' : ''), dataset: { v: v.n }, role: 'button', tabindex: '0', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => toggle(v.n),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(v.n); } },
    }, [
      el('sup', { class: 'vn', text: v.n }),
      el('span', { class: 'txt', text: v.text }),
      marks,
    ]);
    if (compare && cmpBy.has(v.n)) {
      row.append(el('span', { class: 'txt cmp', lang: String(Bible.source(cmpId).lang || 'en').slice(0, 2), text: cmpBy.get(v.n) }));
    }
    article.append(row);
  }
  const prev = neighbour(-1), next = neighbour(1);
  article.append(el('nav', { class: 'row chapnav', 'aria-label': t('Chapters') }, [
    el('button', { class: 'btn ghost' + (prev ? '' : ' hollow'), type: 'button', text: prev ? '‹ ' + formatRef(prev, lang) : '', disabled: !prev, onclick: () => step(-1) }),
    el('button', { class: 'btn ghost' + (next ? '' : ' hollow'), type: 'button', text: next ? formatRef(next, lang) + ' ›' : '', disabled: !next, onclick: () => step(1) }),
  ]));

  // ---- copyright, FUMS and read-elsewhere links
  const foot = el('footer', { class: 'copyright small muted' });
  foot.append(el('p', { text: `${Bible.source(srcId).short}: ${primary.copyright || await Bible.copyrightOf(srcId)}` }));
  if (compare && !compare.error) foot.append(el('p', { text: `${Bible.source(cmpId).short}: ${compare.copyright || await Bible.copyrightOf(cmpId)}` }));
  if (Bible.source(srcId).provider === 'api' || (cmpId && Bible.source(cmpId).provider === 'api')) {
    foot.append(el('p', {}, [t('Scripture text provided by '), el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }), '.']));
    for (const f of [primary.fums, compare && compare.fums]) if (f) foot.append(el('span', { class: 'fums', html: f }));
  }
  for (const [id, ch] of [[srcId, primary], [cmpId, compare]]) {
    const s = id && Bible.source(id);
    if (s && s.provider === 'mine' && ch && !ch.unpasted) {
      foot.append(el('p', {}, [el('button', { class: 'btn small ghost', type: 'button', text: t('Edit the pasted {label} text', { label: s.ext.label }), onclick: () => pasteSheet(s, current.book, current.chapter, () => draw()) })]));
    }
  }
  const links = el('p', { class: 'elsewhere' }, el('span', { class: 'site', text: t('Read this chapter on YouVersion:') }));
  for (const x of Bible.EXTERNAL) {
    links.append(el('a', { href: Bible.youVersionUrl(x, current.book, current.chapter), target: '_blank', rel: 'noopener', text: x.label }));
  }
  links.append(el('span', { class: 'site', text: t('· on BibleSA:') }));
  for (const x of Bible.EXTERNAL.filter(x => x.sa)) {
    links.append(el('a', { href: Bible.bibleSaUrl(x, current.book, current.chapter), target: '_blank', rel: 'noopener', text: x.label }));
  }
  links.append(el('span', { class: 'site', text: t('· on BibleGateway:') }));
  links.append(el('a', { href: Bible.bibleGatewayUrl(heading, 'NKJV'), target: '_blank', rel: 'noopener', text: 'NKJV' }));
  foot.append(links);
  page.append(foot);

  // ---- notes on this chapter
  const notesBox = el('section', { class: 'chapter-notes' });
  notesBox.append(el('h3', { class: 'sub', text: noteList.length ? t('Your notes on this chapter ({n})', { n: noteList.length }) : t('Your notes on this chapter') }));
  if (!noteList.length) notesBox.append(el('p', { class: 'muted small', text: t('Tap a verse, then "Note", to write a thought, an experience or a sermon idea on it.') }));
  for (const n of noteList) notesBox.append(Notes.card(n, () => draw()));
  page.append(notesBox);

  container.append(el('div', { class: 'vactions', id: 'vactions', hidden: true }));
  updateActions();
  if (scrollToVerse) {
    const target = article.querySelector(`.verse[data-v="${scrollToVerse}"]`);
    scrollToVerse = null;
    if (target) setTimeout(() => target.scrollIntoView({ block: 'center' }), 30);
  }
}

/** The reading choices behind "Aa": text size, theme, Compare and Beside. */
function viewSheet(srcId) {
  const s = sheet(t('Reading choices'));
  const sizeSeg = seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    const art = $('.scripture', container);
    if (art) art.className = 'scripture size-' + v;
  }, { block: true, label: t('Text size') });
  const themeSeg = seg(THEMES, state.settings.theme || 'system', async v => { await saveSetting('theme', v); applyTheme(v); }, { block: true, label: t('Theme') });
  const readSeg = seg(READS, state.settings.readMode || 'book', async v => { await saveSetting('readMode', v); applyRead(v); }, { block: true, label: t('Letters and spacing') });
  const langSeg = seg(LANGS, lang(), v => { s.close(); switchLang(v); }, { block: true, label: t('Language of the app') });

  const cmpId = state.settings.compare && Bible.source(state.settings.compare) && state.settings.compare !== srcId ? state.settings.compare : '';
  const cmpSel = el('select', { 'aria-label': t('Compare with') }, el('option', { value: '', text: t('None') }));
  for (const x of Bible.sources()) if (x.id !== srcId) cmpSel.append(el('option', { value: x.id, text: x.short + ' – ' + x.name, selected: x.id === cmpId }));
  cmpSel.addEventListener('change', async () => { await saveSetting('compare', cmpSel.value); draw(); });

  const besideSel = el('select', { 'aria-label': t('Show beside the text') }, el('option', { value: '', text: t('None') }));
  for (const x of Bible.EXTERNAL.filter(x => x.sa)) besideSel.append(el('option', { value: x.sa, text: `${x.label} – ${x.name} (BibleSA)`, selected: state.settings.beside === x.sa }));
  besideSel.addEventListener('change', async () => { await saveSetting('beside', besideSel.value); draw(); });

  s.body.append(
    el('label', { class: 'f' }, [t('Text size'), sizeSeg, el('span', { class: 'hint muted small', text: t('"Pulpit" is meant for reading while standing.') })]),
    el('label', { class: 'f' }, [t('Look'), themeSeg, el('span', { class: 'hint muted small', text: t('"System" follows the setting of this phone or PC.') })]),
    el('label', { class: 'f' }, [t('Letters and spacing'), readSeg, el('span', { class: 'hint muted small', text: t('"Easy-read" uses plain letters with more room between them and between the lines, which many people with dyslexia find easier. It applies everywhere in the app.') })]),
    el('label', { class: 'f' }, [t('Language of the app'), langSeg, el('span', { class: 'hint muted small', text: t('Also sets the book names and the language of Claude\'s suggestions.') })]),
    el('label', { class: 'f' }, [t('Compare with a second translation'), cmpSel, el('span', { class: 'hint muted small', text: t('Shown under each verse.') })]),
    el('label', { class: 'f' }, [t('Beside: the Afrikaans Bible on BibleSA'), besideSel, el('span', { class: 'hint muted small', text: t('Opens in its own window next to the app and follows the chapter.') })]),
    el('div', { class: 'row end' }, [el('button', { class: 'btn', type: 'button', text: t('Done'), onclick: () => s.close() })]),
  );
}

/** Whether the BibleSA window this page opened is still open. */
function besideOpen() { return !!(besideWin && !besideWin.closed); }

/** The strip under the reader bar that opens the BibleSA window and says what it does. */
function besideBar(ext) {
  const button = el('button', { class: 'btn small', type: 'button' });
  const note = el('span', { class: 'muted small' });
  const refresh = (blocked) => {
    const open = besideOpen();
    button.textContent = open ? t('Show the window ↗') : t('Open beside ↗');
    const wide = matchMedia('(min-width: 900px)').matches;
    note.textContent = blocked ? t('The browser blocked the window. Allow pop-ups for this site (the icon at the right end of the address bar), then tap again.')
      : open ? t('open in its own window and following this chapter.') + (wide ? ' ' + t('If it slips behind this window, tap "Show the window", or drag it to the right edge of the screen so Windows keeps both in view.') : '')
      : t('opens in its own window and follows this chapter');
  };
  button.addEventListener('click', () => { const shown = openBeside(ext); refresh(!shown); });
  refresh();
  return el('div', { class: 'beside-bar row' }, [
    el('b', { text: t('{label} on BibleSA', { label: ext.label }) }),
    note,
    el('div', { class: 'spacer' }),
    button,
    el('button', { class: 'btn small ghost', type: 'button', 'aria-label': t('Close Beside'), text: '✕', onclick: async () => { closeBeside(); await saveSetting('beside', ''); draw(); } }),
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

/** The chapter before or after the open one, across book boundaries, or null at the ends of the Bible. */
function neighbour(dir) {
  let { book, chapter } = current;
  const n = counts[book] || 1;
  chapter += dir;
  if (chapter < 1 || chapter > n) {
    const i = BOOKS.findIndex(b => b.id === book) + dir;
    if (i < 0 || i >= BOOKS.length) return null;
    book = BOOKS[i].id;
    chapter = dir > 0 ? 1 : (counts[book] || 1);
  }
  return { book, chapter };
}

function step(dir) {
  const to = neighbour(dir);
  if (to) go(to.book, to.chapter);
}

function toggle(n) {
  if (selected.has(n)) selected.delete(n); else selected.add(n);
  const row = container.querySelector(`.verse[data-v="${n}"]`);
  if (row) { row.classList.toggle('sel', selected.has(n)); row.setAttribute('aria-pressed', selected.has(n) ? 'true' : 'false'); }
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
    el('div', { class: 'vlabel' }, [el('b', { text: label }), el('button', { class: 'icon', type: 'button', 'aria-label': t('Clear selection'), text: '✕', onclick: clearSelection })]),
    el('div', { class: 'vbtns' }, [
      el('button', { class: 'btn small', type: 'button', text: t('Note'), onclick: () => Notes.editNote(Notes.draft(ref), () => draw()) }),
      el('button', { class: 'btn small ghost', type: 'button', text: cats.length ? t('Catechism ({n})', { n: cats.length }) : t('Catechism'), disabled: !cats.length, onclick: () => showCatechism(ref.verse, cats, label) }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Prepare a service'), onclick: () => Prepare.newFromText(ref, text, Bible.source(state.settings.translation)?.short || 'KJV') }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Copy'), onclick: async () => { toast((await copyText(`${label} (${Bible.source(state.settings.translation)?.short}) ${text}`)) ? t('Copied.') : t('Could not copy.'), false); } }),
      ...Bible.EXTERNAL.slice(0, 2).map(x => el('a', { class: 'btn small ghost', href: Bible.youVersionUrl(x, ref.book, ref.chapter, ref.verse), target: '_blank', rel: 'noopener', text: x.label + ' ↗' })),
    ]));
}

function clearSelection() {
  selected.clear();
  for (const r of container.querySelectorAll('.verse.sel')) { r.classList.remove('sel'); r.setAttribute('aria-pressed', 'false'); }
  updateActions();
}

function showCatechism(verseN, sections, label) {
  const lang = state.settings.bookLang;
  const s = sheet(t('Catechism on {ref}', { ref: label || formatRef({ book: current.book, chapter: current.chapter, verse: verseN }, lang) }));
  const hasText = Cat.textReady();
  s.body.append(el('p', { class: 'muted small', text: hasText
    ? t('These sections of the Catechism refer to this verse. Open one to read it and see its other references.')
    : t('These sections of the Catechism refer to this verse. Open one to see its other references, or read it at nak.org.') }));
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
  const s = sheet(t('Notes on {ref}', { ref: formatRef({ book: current.book, chapter: current.chapter, verse: verseN }, state.settings.bookLang) }));
  for (const n of notes) s.body.append(Notes.card(n, () => { s.close(); draw(); }));
}

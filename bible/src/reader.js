/*
 * The Read tab: one chapter at a time, in the chosen translation, with an
 * optional second translation interleaved verse by verse. Each verse carries
 * two marks: a "C" when the Catechism quotes it and a pen when the person has
 * written a note on it. Tapping verses selects them; the bar that appears
 * offers a note, the Catechism sections, the theological background
 * (theology.js), a service preparation, a copy, and the licensed translations
 * on YouVersion or BibleGateway. The Theology button beside the chapter's
 * title opens the background to the chapter and its book.
 *
 * The bar above the text keeps to the essentials: book, chapter, the box
 * that finds a verse, the translation and "Aa", which opens the reading
 * choices (text size, theme, language, Compare, Beside) in a sheet so the
 * text starts high on a phone. On a phone the bar is one row: the chapter's
 * name, which opens the book and chapter chooser (chooseSheet), a magnifier
 * that opens the box in place of the row, the translation and Aa; and it
 * slides away as you read down and comes back when you scroll up
 * (styles.css .readbar.away).
 *
 * The box takes a place or words. A place ("Joh 3:16", "Ps 23") opens there.
 * Words ("shepherd want") are searched in the open translation, and the
 * verses that carry them are listed in place of the chapter, at
 * #read/search/<words> (search.js); a tap on one opens it here.
 */
import { el, $, clear, toast, sheet, copyText, seg, THEMES, SIZES, READS, applyTheme, applyRead } from './ui.js';
import { t, tn, lang, LANGS, requestLang } from './i18n.js';
import { unlocked as helperUnlocked } from './lock.js';   // is the AI helper open on this device? (what a locked device may not mention)
import { BOOKS, BY_ID, GROUPS, GROUPS_AF, bookName, parseRef, formatRef } from './books.js';
import { state, saveSetting } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as Notes from './notes.js';
import * as Prepare from './prepare.js';
import * as Theology from './theology.js';
import { unpastedCard, pasteSheet } from './paste.js';
import * as Search from './search.js';   // the verses that carry the words typed in the box

let current = { book: 'PSA', chapter: 23, verse: null };
let found = null;          // a search shown in place of the chapter: {q, where}; null while a chapter is open

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

// On a phone the bar slides away once you have read 24px down and comes back once you have scrolled 24px up
// (styles.css .readbar.away). A jump the app makes itself, to the verse named in the address, is not reading:
// the bar keeps still for a moment after each draw. While the box that finds a verse is open the bar stays.
let lastY = 0, turnY = 0, lastDir = 0, quietUntil = 0;
window.addEventListener('scroll', () => {
  const bar = container && location.hash.startsWith('#read') ? $('.readbar', container) : null;
  if (!bar) return;
  const y = Math.max(0, window.scrollY);
  const dir = y > lastY ? 1 : y < lastY ? -1 : 0;
  if (dir && dir !== lastDir) { lastDir = dir; turnY = lastY; }   // the finger turned: measure from here
  lastY = y;
  if (Date.now() < quietUntil) return;
  if (y < 12) bar.classList.remove('away');
  else if (dir > 0 && y - turnY > 24 && !bar.classList.contains('finding')) bar.classList.add('away');
  else if (dir < 0 && turnY - y > 24) bar.classList.remove('away');
}, { passive: true });
const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// On a PC the left and right arrow keys turn the chapter, as in a book.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (!location.hash.startsWith('#read') || !container || found || $('.overlay')) return;   // a list of found verses is not a chapter to turn
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault();
  step(e.key === 'ArrowRight' ? 1 : -1);
});

/** What a search's address carries, read back: the words as typed, or '' when the address is broken. */
function typed(part) {
  try { return decodeURIComponent(part || '').trim(); } catch (e) { return ''; }
}

export function render(root, route) {
  container = root;
  selected = new Set();
  const [, book, chapter, verse] = route;
  found = book === 'search' && typed(chapter) ? { q: typed(chapter), where: verse || 'all' } : null;
  if (found) {
    // #read/search/<words>/<where>: the bar stays on the chapter last read, which is the way back
    const [b, c] = (state.settings.lastRef || 'PSA.23').split('.');
    current = { book: BY_ID[b] ? b : 'PSA', chapter: parseInt(c, 10) || 1, verse: null };
    scrollToVerse = null;
    draw();
    return;
  }
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

/**
 * Gives a box the longest of these hints that fits in it whole, so that a
 * hint is never cut off. The hints go from the longest to the shortest, and
 * the last one is kept when none fits.
 */
function fitHint(input, hints) {
  const cs = getComputedStyle(input);
  const pen = document.createElement('canvas').getContext('2d');
  pen.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // the room for letters: the box without its border and padding (a browser's clientWidth of a text box may or may not hold the padding), less a little
  const room = input.getBoundingClientRect().width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8;
  input.placeholder = hints.find(h => pen.measureText(h).width <= room) || hints[hints.length - 1];
}

async function draw() {
  clear(container);
  quietUntil = Date.now() + 700;
  lastY = turnY = Math.max(0, window.scrollY);
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

  // ---- the box that finds a verse: a place opens there, words are searched (search.js)
  // the examples: a place in the language of the book names, words in the language of the open Bible, since those are the words it is searched for
  const place = lang === 'af' ? 'Joh 3:16' : 'John 3:16';
  const words = /^af/i.test(String((src && src.lang) || '')) ? 'my herder' : 'my shepherd';
  const what = t('Find a verse: type a place such as “{place}”, or words of the verse', { place });
  // on a phone ✕ closes the box again; on a page of found verses it brings the chapter back (the box is open there, with the words)
  const closeFind = el('button', { id: 'r-find-close', class: 'icon', type: 'button', 'aria-label': t('Close the search box'), title: t('Close the search box'), text: '✕', onclick: () => {
    if (found) { location.hash = `#read/${current.book}/${current.chapter}`; return; }
    gotoInput.value = '';
    finding(false);
  } });
  const gotoInput = el('input', { type: 'search', placeholder: t('Find a verse…'), 'aria-label': what, title: what, enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: found ? found.q : '' });
  const gotoForm = el('form', { class: 'goto', role: 'search', onsubmit: e => {
    e.preventDefault();
    const text = gotoInput.value.trim();
    if (!text) return;
    gotoInput.blur();
    // a place carries a number ("John 3", "Ps 23:1", "1 John"); a word alone is searched, for "wisdom" and "mark" are words as well as books
    const ref = /\d/.test(text) ? parseRef(text, { loose: true }) : null;
    if (ref) {
      if (!ref.verse && ref.chapter > 1 && counts[ref.book] === 1) { ref.verse = ref.verseEnd = ref.chapter; ref.chapter = 1; }   // "Jude 5": a book of one chapter is named by its verse
      gotoInput.value = '';
      location.hash = `#read/${ref.book}/${ref.chapter}${ref.verse ? '/' + ref.verse : ''}`;
      return;
    }
    Search.forget();
    const to = Search.hrefOf(text);
    if (location.hash === to) draw(); else location.hash = to;
  } }, [gotoInput, el('button', { class: 'btn small ghost', type: 'submit', text: t('Search') }), closeFind]);

  const srcSel = el('select', { id: 'r-src', 'aria-label': t('Translation') });
  const cmpSel = el('select', { id: 'r-cmp', 'aria-label': t('Compare with') }, el('option', { value: '', text: t('Compare: none') }));
  for (const s of Bible.sources()) {
    srcSel.append(el('option', { value: s.id, text: s.short, selected: s.id === srcId }));
    if (s.id !== srcId) cmpSel.append(el('option', { value: s.id, text: '+ ' + s.short, selected: s.id === cmpId }));
  }
  srcSel.addEventListener('change', async () => { await saveSetting('translation', srcSel.value); if (state.settings.compare === srcSel.value) await saveSetting('compare', ''); draw(); });
  cmpSel.addEventListener('change', async () => { await saveSetting('compare', cmpSel.value); draw(); });
  const viewBtn = el('button', { id: 'r-view', class: 'btn small ghost', type: 'button', 'aria-label': t('Reading choices: text size, theme, compare and beside'), title: t('Text size, theme, Compare, Beside'), onclick: () => viewSheet(srcId) }, [
    'Aa', el('span', { html: CHEVRON }),
  ]);

  // ---- on a phone the bar is one row (styles.css): the chapter's name, which opens the book and chapter chooser,
  // the magnifier, which opens the box in place of the row, the translation and Aa; a PC shows the two rows above
  const here = formatRef({ book: current.book, chapter: current.chapter }, lang);
  const placeBtn = el('button', { id: 'r-place', class: 'btn small ghost', type: 'button', 'aria-label': t('Choose a book and chapter'), title: t('Choose a book and chapter'), onclick: () => chooseSheet(lang) }, [
    el('span', { class: 'bk', text: here.replace(/\s*\d+$/, '') }), ' ', el('b', { text: String(current.chapter) }), el('span', { class: 'chev', html: CHEVRON }),
  ]);
  const findBtn = el('button', { id: 'r-find', class: 'icon', type: 'button', 'aria-label': t('Find a verse'), title: t('Find a verse'), onclick: () => finding(true),
    html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>' });
  const bar = el('div', { class: 'readbar' + (found ? ' finding' : '') }, [
    el('div', { class: 'row nav' }, [
      el('button', { class: 'btn small ghost', type: 'button', text: '‹', 'aria-label': t('Previous chapter'), onclick: () => step(-1) }),
      bookSel, chapSel,
      el('button', { class: 'btn small ghost', type: 'button', text: '›', 'aria-label': t('Next chapter'), onclick: () => step(1) }),
    ]),
    el('div', { class: 'row tools' }, [gotoForm, srcSel, cmpSel, viewBtn]),
    placeBtn, findBtn,
  ]);
  container.append(bar);
  /** Opens or closes the box on a phone. Open, it takes the row's place and the keyboard comes up. */
  function finding(on) {
    bar.classList.toggle('finding', on);
    bar.classList.remove('away');
    if (on) { fitHint(gotoInput, hints); gotoInput.focus(); } else findBtn.focus();
  }
  // the examples show where the box has room for the whole of them (a PC); a phone's box keeps the three words.
  // Measured again once the app's own letters have arrived: they are wider than the letters a device shows meanwhile.
  const hints = [t('Find a verse: “{place}” or “{words}”', { place, words }), t('“{place}” or “{words}”', { place, words }), t('Find a verse…')];
  fitHint(gotoInput, hints);
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (gotoInput.isConnected) fitHint(gotoInput, hints); }).catch(() => {});

  // ---- a search: the verses that carry the words, in place of the chapter
  if (found) {
    container.append(Search.page({ q: found.q, where: found.where, srcId, back: { href: `#read/${current.book}/${current.chapter}`, label: formatRef({ book: current.book, chapter: current.chapter }, lang) } }));
    return;
  }

  // ---- the text
  const page = el('div', { class: 'page reader' });
  const article = el('article', { class: 'scripture size-' + (state.settings.fontSize || 'm'), lang: src && src.lang ? String(src.lang).slice(0, 2) : 'en' });
  if (besideExt) { container.append(besideBar(besideExt)); followBeside(besideExt); }
  container.append(page);
  // a verse opened from a search: the list it came from is one tap back
  const list = Search.wayBack(current.book, current.chapter);
  if (list) page.append(el('p', { class: 'crumbs found-back' }, el('a', { href: list.href, text: '‹ ' + t('Back to the verses with “{q}”', { q: list.q }) })));
  page.append(article);
  const heading = formatRef({ book: current.book, chapter: current.chapter }, lang);
  article.append(el('header', { class: 'chap-head' }, [
    el('div', { class: 'chap-title' }, [
      el('h2', { text: heading }),
      // the background to this chapter and its book (theology.js)
      el('a', { class: 'btn small ghost th-btn', href: `#theology/${current.book}/${current.chapter}`, title: t('Background to this chapter and its book') }, [Theology.lampIcon(), t('Theology')]),
    ]),
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
  quietUntil = Date.now() + 700;   // the jump to the verse is not reading: the bar stays
}

/**
 * On a phone, what the chapter's name in the bar opens: the chapters before
 * and after, the book, and a grid of the book's chapters. A tap on a chapter
 * opens it; choosing a book only shows its chapters.
 */
function chooseSheet(lang) {
  const s = sheet(t('Book and chapter'));
  const prev = neighbour(-1), next = neighbour(1);
  const turn = el('nav', { class: 'pick-turn', 'aria-label': t('Chapters') }, [
    el('button', { class: 'btn ghost', type: 'button', text: prev ? '‹ ' + formatRef(prev, lang) : '', disabled: !prev, onclick: () => { s.close(); step(-1); } }),
    el('button', { class: 'btn ghost', type: 'button', text: next ? formatRef(next, lang) + ' ›' : '', disabled: !next, onclick: () => { s.close(); step(1); } }),
  ]);
  const bookSel = el('select', { id: 'pick-book', 'aria-label': t('Book') });
  for (const g of ['ot', 'ap', 'nt']) {
    const grp = el('optgroup', { label: (lang === 'af' ? GROUPS_AF : GROUPS)[g] });
    for (const b of BOOKS.filter(x => x.group === g)) grp.append(el('option', { value: b.id, text: bookName(b.id, lang), selected: b.id === current.book }));
    bookSel.append(grp);
  }
  const grid = el('div', { class: 'chap-grid', role: 'group', 'aria-label': t('Chapters') });
  function fill(book) {
    clear(grid);
    const n = counts[book] || 1;
    for (let i = 1; i <= n; i++) {
      const on = book === current.book && i === current.chapter;
      grid.append(el('button', { class: 'chap-no' + (on ? ' on' : ''), type: 'button', text: String(i), 'aria-label': formatRef({ book, chapter: i }, lang), 'aria-current': on ? 'true' : null, onclick: () => { s.close(); go(book, i); } }));
    }
  }
  bookSel.addEventListener('change', () => fill(bookSel.value));
  fill(current.book);
  s.body.append(turn, el('label', { class: 'f' }, [t('Book'), bookSel]), grid);
  // Psalm 119 is a long way down the grid: the open chapter is brought into view, but only when it is out of it,
  // so that the chapters before and after at the top stay in sight for the chapters that are near the top
  const on = $('.chap-no.on', grid);
  if (on) setTimeout(() => { if (on.getBoundingClientRect().bottom > s.body.getBoundingClientRect().bottom) on.scrollIntoView({ block: 'center' }); }, 50);
}

/** The reading choices behind "Aa": text size, theme, Compare and Beside. */
function viewSheet(srcId) {
  const s = sheet(t('Reading choices'));
  const sizeSeg = seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    const art = $('.scripture', container);
    if (art) art.className = 'scripture size-' + v;
    const list = $('.found-body', container);   // the verses of a search are read in the same size
    if (list) list.className = 'found-body size-' + v;
  }, { block: true, label: t('Text size') });
  const themeSeg = seg(THEMES, state.settings.theme || 'system', async v => { await saveSetting('theme', v); applyTheme(v); }, { block: true, label: t('Theme') });
  const readSeg = seg(READS, state.settings.readMode || 'book', async v => { await saveSetting('readMode', v); applyRead(v); }, { block: true, label: t('Letters and spacing') });
  const langSeg = seg(LANGS, lang(), v => { s.close(); requestLang(v); }, { block: true, label: t('Language of the app') });

  const cmpId = state.settings.compare && Bible.source(state.settings.compare) && state.settings.compare !== srcId ? state.settings.compare : '';
  const cmpSel = el('select', { 'aria-label': t('Compare with') }, el('option', { value: '', text: t('None') }));
  for (const x of Bible.sources()) if (x.id !== srcId) cmpSel.append(el('option', { value: x.id, text: x.short + ' – ' + x.name, selected: x.id === cmpId }));
  cmpSel.addEventListener('change', async () => { await saveSetting('compare', cmpSel.value); draw(); });

  const besideSel = el('select', { 'aria-label': t('Show beside the text') }, el('option', { value: '', text: t('None') }));
  for (const x of Bible.EXTERNAL.filter(x => x.sa)) besideSel.append(el('option', { value: x.sa, text: `${x.label} – ${x.name} (BibleSA)`, selected: state.settings.beside === x.sa }));
  besideSel.addEventListener('change', async () => { await saveSetting('beside', besideSel.value); draw(); });

  s.body.append(
    el('label', { class: 'f' }, [t('Text size'), sizeSeg, el('span', { class: 'hint muted small', text: t('"Pulpit" is meant for reading while standing.') })]),
    el('label', { class: 'f' }, [t('Look'), themeSeg, el('span', { class: 'hint muted small', text: t('"White" is the Church\'s blue and white, as on the slides. "Paper" keeps the blue with warm cream pages. "System" is White by day and Dark at night, as this phone or PC is set.') })]),
    el('label', { class: 'f' }, [t('Letters and spacing'), readSeg, el('span', { class: 'hint muted small', text: t('"Easy-read" uses plain letters with more room between them and between the lines, which many people with dyslexia find easier. It applies everywhere in the app.') })]),
    el('label', { class: 'f' }, [t('Language of the app'), langSeg, el('span', { class: 'hint muted small', text: helperUnlocked() ? t('Also sets the book names and the language of Claude\'s suggestions.') : t('Also sets the book names.') })]),
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
      el('button', { class: 'btn small ghost', type: 'button', text: t('Theology'), onclick: () => Theology.openSheet(ref, { text, translation: Bible.source(state.settings.translation)?.short || 'KJV' }) }),
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

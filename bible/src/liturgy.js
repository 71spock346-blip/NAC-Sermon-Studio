/*
 * Liturgy: the Church's altar booklet in the app. "Liturgy for Altar Use"
 * ("Liturgie vir Altaar Gebruik") is the set of cards of the New Apostolic
 * Church Cape with the words said at the altar: the divine service and each
 * act of blessing (adoption, confirmation, a wedding, a funeral …). Here the
 * minister has them on the phone or the PC at the altar, in large letters.
 *
 * The booklet is the Church's own text, so it is not in the app: the
 * minister loads its PDF once, in English, in Afrikaans or both. booklet.js
 * reads the PDF on the device itself (no AI, no key) into cards, which are
 * kept in the `liturgy` store, one row per language (id 'en' or 'af'), from
 * where they travel with the sync to the other devices. They are not in the
 * backup file, like the Catechism text and the Guides.
 *
 * #liturgy lists the cards in the app's language, or in the other language
 * when only that booklet is loaded; #liturgy/<key> opens one card, with an
 * EN | AF switch when both booklets are loaded. While a card is open the
 * screen is asked to stay awake. On a PC Liturgy has its own place in the
 * side menu; the phone's bar keeps five tabs, so there it is listed under
 * More (more.js) and reached from the top of Prepare as well, and More stays
 * lit while it is open (app.js).
 */
import { el, clear, toast, confirmBox, busy, seg, sheet, fmtDate, SIZES } from './ui.js';
import { state, saveLiturgy, deleteLiturgy, saveSetting } from './store.js';
import { t, lang } from './i18n.js';
import * as Sync from './sync.js';

const LANGS = ['en', 'af'];

/** The loaded booklet in a language, or null. */
const booklet = l => state.liturgy.find(b => b.id === l) || null;

/** The language of the list: the app's, or the other one when only that booklet is loaded. */
function listLang() {
  if (booklet(lang())) return lang();
  return LANGS.find(l => booklet(l)) || lang();
}

/** The language of a card: the one the person picked on a card with the EN | AF switch (while the app stays in the language it was picked under), else the list's. */
let picked = null;   // {under: the app's language then, l: the booklet picked}
function cardLang() {
  if (picked && picked.under === lang() && booklet(picked.l)) return picked.l;
  return listLang();
}

const bookletName = l => (l === 'af' ? t('Afrikaans booklet') : t('English booklet'));
const loadLabel = l => (l === 'af' ? t('Load the Afrikaans booklet (PDF)') : t('Load the English booklet (PDF)'));

/** The chalice on the Liturgy tab (index.html), for the shortcut at the top of Prepare on a phone. */
export function icon() {
  const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h11l-.9 6.2A4.6 4.6 0 0 1 12 13a4.6 4.6 0 0 1-4.6-3.8z"/><path d="M12 13v5.5"/><path d="M8 21h8"/><path d="M8.5 18.5h7"/></svg>';
  return span;
}

/** The link to Liturgy at the top of the Prepare list: the phone's bar has no Liturgy tab, only More (styles.css hides this on a PC). */
export function shortcut() {
  return el('a', { class: 'lit-shortcut', href: '#liturgy' }, [
    icon(),
    el('span', { class: 'grow' }, [el('b', { text: t('Liturgy') }), el('span', { class: 'muted small', text: t('The words at the altar, card by card') })]),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
  ]);
}

/* ---------------------------------------------------------------- the screens */

export function render(container, route) {
  clear(container);
  if (route[1]) cardPage(container, route[1]);
  else { letSleep(); listPage(container); }
}

function crumbs(links) {
  const parts = [];
  links.forEach(([label, href], i) => { if (i) parts.push(' › '); parts.push(el('a', { href, text: label })); });
  return el('div', { class: 'crumbs' }, parts);
}

function credit() {
  return el('p', { class: 'muted small lit-credit', text: t('Liturgy for Altar Use © New Apostolic Church Cape. Loaded by you onto your own device for your use at the altar; it is not part of the public app.') });
}

function listPage(container) {
  const l = listLang();
  const bk = booklet(l);
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Liturgy') })]),
    el('p', { class: 'lit-lead', text: t('The words said at the altar, from the Church\'s booklet "Liturgy for altar use": the divine service and each act of blessing, card by card, as the booklet prints them.') }),
  );
  if (!bk) {
    container.append(el('div', { class: 'lit-empty' }, [
      el('p', { text: t('The booklet is the Church\'s own, so it is not part of the app. Load its PDF here once, in English or in Afrikaans or both: the app reads the cards from it on this device itself, and they reach your other devices through the sync.') }),
      el('div', { class: 'row' }, LANGS.map(x => el('button', { class: 'btn small', type: 'button', text: loadLabel(x), onclick: () => load(container) }))),
    ]));
  } else {
    if (l !== lang()) {
      container.append(el('p', { class: 'small muted', text: lang() === 'af' ? t('The Afrikaans booklet is not loaded yet, so the cards show in English.') : t('The English booklet is not loaded yet, so the cards show in Afrikaans.') }));
    }
    const list = el('div', { class: 'list lit-list' });
    for (const c of bk.cards) {
      list.append(el('a', { class: 'item', href: `#liturgy/${c.key}`, lang: l }, [
        icon(),
        el('span', { class: 'grow' }, [el('b', { text: c.title })]),
        el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
      ]));
    }
    container.append(list);
  }
  // the booklets on this device, one line each, with the buttons to load or remove them
  const books = el('div', { class: 'lit-books' }, [el('h3', { class: 'sub', text: t('The booklets') })]);
  for (const x of LANGS) {
    const b = booklet(x);
    books.append(el('div', { class: 'lit-book' }, [
      el('div', {}, [el('b', { text: bookletName(x) + ': ' }), b
        ? t('{cover}, {n} cards, loaded {date} from {file}.', { cover: b.cover || t('Liturgy for altar use'), n: b.cards.length, date: fmtDate(b.loadedAt), file: b.fileName || 'PDF' })
        : t('not loaded yet.')]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small' + (b ? ' ghost' : ''), type: 'button', text: b ? t('Load a newer file') : loadLabel(x), onclick: () => load(container) }),
        b ? el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove'), onclick: () => remove(container, x) }) : null,
      ]),
    ]));
  }
  container.append(books, credit());
}

/** The runs of one block as text, italics and small letters. */
function inline(runs) {
  return runs.map(([text, style]) => {
    let node = document.createTextNode(text);
    if (style.includes('i')) node = el('i', {}, node);
    if (style.includes('s')) node = el('small', {}, node);
    return node;
  });
}

const BULLET = { 1: '•', 2: '◦', 3: '–' };

function block(b) {
  const d = Math.min(3, Math.max(0, b.d || 0));
  if (b.k === 'li') return el('div', { class: `lit-li d${d}` }, [el('span', { class: 'lit-bullet', 'aria-hidden': 'true', text: BULLET[d] || '•' }), el('span', { class: 'grow' }, inline(b.t))]);
  return el('p', { class: (b.k === 'note' ? 'lit-note' : 'lit-p') + ` d${d}` }, inline(b.t));
}

function row(r) {
  return el('div', { class: 'lit-row' }, [
    el('div', { class: 'lit-left' }, [
      r.label ? el('p', { class: 'lit-label', text: r.label }) : null,
      ...r.sub.map(s => el('p', { class: 'lit-sub', text: s })),
    ]),
    el('div', { class: 'lit-right' }, r.blocks.map(block)),
  ]);
}

function cardPage(container, key) {
  let l = cardLang();
  let bk = booklet(l);
  let card = bk && bk.cards.find(c => c.key === key);
  if (!card) {
    // not in this booklet: the other language's card, if that booklet has it
    const other = LANGS.find(x => x !== l && booklet(x) && booklet(x).cards.some(c => c.key === key));
    if (other) { l = other; bk = booklet(l); card = bk.cards.find(c => c.key === key); }
  }
  if (!card) {
    toast(t('That card was not found.'), true);
    location.hash = '#liturgy';
    return;
  }
  const both = LANGS.every(x => booklet(x) && booklet(x).cards.some(c => c.key === key));
  const body = el('div', { class: 'lit-card size-' + (state.settings.fontSize || 'm'), lang: l }, card.rows.map(row));
  container.append(
    crumbs([[t('Liturgy'), '#liturgy']]),
    el('div', { class: 'page lit-page' }, [
      el('p', { class: 'eyebrow', text: bk.org || t('New Apostolic Church') }),
      el('div', { class: 'docbar' }, [
        el('h2', { text: card.title, lang: l }),
        both ? seg([['en', 'EN'], ['af', 'AF']], l, v => { picked = { under: lang(), l: v }; render(container, ['liturgy', key]); }, { label: t('Language') }) : null,
        el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), onclick: () => sizeSheet(body) }),
      ]),
      body,
      el('p', { class: 'muted small', text: t('Loaded {date} from {file}.', { date: fmtDate(bk.loadedAt), file: bk.fileName || 'PDF' }) }),
      credit(),
    ]),
  );
  keepAwake();
}

/** The reader's text sizes, so the words at the altar can be as large as the Scripture is. */
function sizeSheet(body) {
  const s = sheet(t('Text size'));
  s.body.append(seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    body.className = body.className.replace(/size-\w+/, 'size-' + v);
  }, { block: true, label: t('Text size') }));
}

/* ---------------------------------------------------------------- loading a booklet */

/** The file picker, then the wait while the PDF is read on the device; the booklet is saved under the language it is in. */
function load(container) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
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
  const b = busy(t('Reading the booklet'));
  try {
    b.say(t('Opening {file}…', { file: file.name }));
    const data = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    const { readPages, parse } = await import('./booklet.js');
    const pages = await readPages(pdfjs, data, (n, total) => b.say(t('Page {n} of {total}', { n, total })));
    let booklet;
    try {
      booklet = parse(pages);
    } catch (e) {
      throw new Error(t('That PDF does not look like the altar booklet: no cards were found in it. It needs the Church\'s own file, with a heading on each page (Divine Service, Holy Baptism …).'));
    }
    const row = { id: booklet.language, language: booklet.language, cover: booklet.cover, org: booklet.org, fileName: file.name, loadedAt: new Date().toISOString(), pages: booklet.pages, cards: booklet.cards };
    await saveLiturgy(row);
    picked = null;
    b.done();
    toast(row.language === 'af' ? t('Afrikaans booklet loaded: {n} cards.', { n: row.cards.length }) : t('English booklet loaded: {n} cards.', { n: row.cards.length }));
    render(container, ['liturgy']);
  } catch (e) {
    console.error(e);
    b.fail(e.message || t('The file could not be read.'));
  }
}

async function remove(container, l) {
  const kept = booklet(l);
  if (!kept) return;
  const q = l === 'af'
    ? (Sync.isOn() ? t('Remove the Afrikaans booklet from this device and, through sync, from your other devices? You can load the PDF again later.') : t('Remove the Afrikaans booklet from this device? You can load the PDF again later.'))
    : (Sync.isOn() ? t('Remove the English booklet from this device and, through sync, from your other devices? You can load the PDF again later.') : t('Remove the English booklet from this device? You can load the PDF again later.'));
  if (!(await confirmBox(q, t('Remove'), true))) return;
  await deleteLiturgy(l);
  picked = null;
  render(container, ['liturgy']);
  toast(l === 'af' ? t('Afrikaans booklet removed.') : t('English booklet removed.'), false, async () => {
    await saveLiturgy(kept);
    render(container, ['liturgy']);
  });
}

/* ---------------------------------------------------------------- the screen at the altar */

/*
 * A phone turns its screen off after a minute or two; at the altar the card
 * must stay. While a card is open the screen is asked to stay awake (where
 * the browser allows it), and let go when the person leaves the card. The
 * browser lets go by itself when the app goes to the background; it is
 * asked again when the app comes back to a card.
 */
let lock = null;
const onCard = () => /^#\/?liturgy\/./.test(location.hash);

async function keepAwake() {
  if (lock || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { lock = null; }
}

function letSleep() {
  if (!lock) return;
  lock.release().catch(() => {});
  lock = null;
}

window.addEventListener('hashchange', () => { if (!onCard()) letSleep(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && onCard()) keepAwake(); });

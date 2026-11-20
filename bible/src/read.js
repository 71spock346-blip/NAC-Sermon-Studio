/*
 * Reading on the screen: the sermon itself and the cue cards, as the PDFs
 * have them (pdf.js sermonParts, cues.js cueParts), in a sheet in large clear
 * type, with the reader's text size behind Aa and the screen kept awake, so
 * that the phone or the PC can stand in for the paper (Jerome, 2026-11-18:
 * "I want to be able to also just read the sermon onscreen"). The Read
 * buttons under "Print or save" in prepare.js open them, and the rows under
 * "At the altar" on the Sunday screen (sunday.js), which also opens the text
 * word alone (word). Altar mode (altar.js) draws the same readings into its
 * own panes with article() and the fill… functions, so the sermon and the
 * cards look the same wherever they are read.
 */
import { el, sheet, seg, toast, SIZES } from './ui.js';
import { t, tl } from './i18n.js';
import { state, saveSetting } from './store.js';
import { sermonParts, serviceLine, cueHeading } from './pdf.js';
import { formatRef } from './books.js';
import { cueParts, cuesOf, CUE_COLORS, MARK } from './cues.js';
import { langOf } from './ai.js';

/**
 * The sermon in reading order, from the boxes of the preparation or, with
 * `outline`, as Claude built it: the text word, the introduction, the main
 * points, the application, the summary and the conclusion, with each
 * illustration under the part it serves, as "The sermon" prints it.
 */
export function sermon(s, { outline = null } = {}) {
  const parts = sermonParts(s, { outline });
  if (parts.empty) { toast(t('There is nothing to read yet: write the introduction, the main points, the application or the conclusion first.'), true); return false; }
  fillSermon(open(t('The sermon'), s), s, parts);
  return true;
}

/** The sermon into an article (article()): its head, then a section per part. `parts` is pdf.js sermonParts of the preparation. */
export function fillSermon(art, s, parts = sermonParts(s)) {
  const { c, ref, title } = parts;
  const L = langOf(s);   // the headings in the sermon's language, as the prints have them
  head(art, s, { ref, title: s.title || s.theme || !ref ? title : '' });
  const section = (heading, body, extras = []) => {
    if (heading) art.append(el('h2', { text: heading }));
    art.append(...paras(body));
    for (const x of extras) {
      if (x.kind === 'illustration') art.append(el('p', { class: 'read-extra' }, [el('b', { text: tl(L, 'Illustration: ') + (x.title || '') })]));
      else if (x.kind === 'lighter') art.append(el('p', { class: 'read-extra' }, [el('b', { text: tl(L, 'A lighter moment') })]));
      art.append(...paras(x.body, x.kind === 'text' ? '' : 'read-in'));
    }
  };
  if (c.intro) section(tl(L, 'Introduction'), c.intro, c.after.intro);
  for (const p of c.points) section(`${p.n}. ${p.heading}`.trim(), p.body, p.extras);
  if (c.after.loose.length) section(tl(L, 'Illustrations'), '', c.after.loose);
  if (c.application) section(tl(L, 'Application for the congregation'), c.application, c.after.application);
  if (c.summary) section(tl(L, 'Summary'), c.summary);
  if (c.conclusion) section(tl(L, 'Conclusion'), c.conclusion, c.after.conclusion);
}

/**
 * The cue cards: the text word and the message, then under each heading its
 * line of cues, "# cue # cue # cue", each in its own colour, as the printed
 * card has them (`service`: the Guide's article the preparation is linked
 * to, whose introduction gives the cues while the minister's own is empty).
 */
export function cues(s, { service = null } = {}) {
  const parts = cueList(s, service);
  if (!parts.length && !(s.text || s.theme || s.core)) { toast(t('There is nothing on the cards yet: write the main points first, or type the cues under Print or save.'), true); return false; }
  fillCues(open(t('Cue cards'), s, 'cue-view'), s, parts);
  return true;
}

/** The parts of the cue cards that have cues on them (a main point always, so that its heading shows), as the cards print them. */
export function cueList(s, service = null) {
  return cueParts(s, { service, lang: langOf(s) }).filter(p => cuesOf(p).length || p.key === 'point');
}

/** The cue cards into an article: the text word and the message, then a heading and its line of cues for each part (cueList). */
export function fillCues(art, s, parts) {
  const { ref } = sermonParts(s);
  head(art, s, { ref: ref || s.title || '', theme: s.theme, core: s.core });
  for (const part of parts) {
    const heading = cueHeading(part, langOf(s));
    art.append(el('h2', { class: 'cue-head', text: /[:!?.]$/.test(heading) ? heading : heading + ':' }));
    const list = cuesOf(part);
    if (!list.length) continue;
    const line = el('p', { class: 'cue-line' });
    list.forEach((cue, i) => line.append(el('span', { class: 'cue-mark', text: MARK }), ' ', el('span', { class: `cue c${i % CUE_COLORS.length}`, text: cue }), ' '));
    art.append(line);
  }
}

/**
 * The text word alone, in large letters: the service line, the reference and
 * the verses, to read out at the altar from the phone or the PC. `s` is a
 * preparation, or a Guide's service in that shape (sunday.js).
 */
export function word(s) {
  if (!String(s.text || '').trim()) { toast(t('There is no text word yet: choose the verses under step 1 of the preparation.'), true); return false; }
  fillWord(open(t('The text word'), s), s);
  return true;
}

/** The text word into an article: the service line, the reference and the verses. */
export function fillWord(art, s) {
  head(art, s, { ref: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || '') });
}

/* ------------------------------------------------------------- the sheet */

/** The article a reading is drawn in: the reader's text size (Settings, or Aa), in the language of the preparation; `cls` marks the cue cards (cue-view). */
export function article(s, cls = '') {
  return el('article', { class: ['read-view', cls, 'size-' + (state.settings.fontSize || 'm')].filter(Boolean).join(' '), lang: langOf(s) });
}

/**
 * The sheet that holds a reading, with the article in it: the reader's text
 * size (Settings, or the reader's Aa) and, behind the Aa button in the
 * sheet's head, the row to change it. The screen stays awake while the sheet
 * is open (where the browser allows it).
 */
function open(name, s, cls = '') {
  const sh = sheet(name, { wide: true, onclose: letSleep });
  sh.root.classList.add('read-sheet');
  const art = article(s, cls);
  const sizes = el('div', { class: 'read-size', hidden: true }, seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    art.className = art.className.replace(/size-\w+/, 'size-' + v);
  }, { block: true, label: t('Text size') }));
  const aa = el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), 'aria-expanded': 'false', onclick: () => {
    sizes.hidden = !sizes.hidden;
    aa.setAttribute('aria-expanded', sizes.hidden ? 'false' : 'true');
  } });
  sh.head.insertBefore(aa, sh.head.lastChild);
  sh.body.append(sizes, art);
  keepAwake();
  return art;
}

/** The head of a reading, as the PDFs have it: the service line, the Bible reference, the text word, then the title or the message. */
function head(art, s, { ref = '', title = '', theme = '', core = '' }) {
  if (serviceLine(s)) art.append(el('p', { class: 'read-svc', text: serviceLine(s) }));
  if (ref) art.append(el('p', { class: 'read-ref', text: ref + (s.translation ? `  (${s.translation})` : '') }));
  if (String(s.text || '').trim()) art.append(el('blockquote', { class: 'read-word' }, paras(s.text)));
  if (title) art.append(el('h1', { text: title }));
  if (String(theme || '').trim()) art.append(el('p', { class: 'read-theme', text: theme.trim() }));
  if (String(core || '').trim()) art.append(...paras(core));
}

/** A text as paragraphs: a blank line between them starts a new one, a single line break stays a line break. */
function paras(text, cls = '') {
  return String(text || '').trim().split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => {
    const p = el('p', cls ? { class: cls } : {});
    x.split('\n').forEach((line, i) => { if (i) p.append(el('br')); p.append(line.trim()); });
    return p;
  });
}

/*
 * The screen stays awake while a reading is open, as it does on a liturgy
 * card (liturgy.js): the browser lets go by itself when the app goes to the
 * background, and is asked again when the app comes back with the sheet
 * still open.
 */
let lock = null;
const reading = () => !!document.querySelector('.read-sheet');

async function keepAwake() {
  if (lock || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { lock = null; }
}

function letSleep() {
  if (reading() || !lock) return;
  lock.release().catch(() => {});
  lock = null;
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && reading()) keepAwake(); });

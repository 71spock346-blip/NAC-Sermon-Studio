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
import { el, clear, sheet, seg, toast, SIZES } from './ui.js';
import { t, tl } from './i18n.js';
import { state, saveSetting, saveSermon } from './store.js';
import { sermonParts, serviceLine, cueHeading, feelingLine } from './pdf.js';
import { formatRef } from './books.js';
import { cueParts, cuesOf, setOwn, CUE_COLORS, MARK } from './cues.js';
import { langOf } from './ai.js';
import { line as hymnLine } from './hymns.js';   // the hymns of the service under the service line, as the cue card has them
import { findRefs, quoteOf, langCode, sourceOrder, gather } from './verses.js';   // the verses the sermon names: a tap on the reference shows its words
import { sources, versesFrom } from './bible.js';

/**
 * The sermon in reading order, from the boxes of the preparation or, with
 * `outline`, as Claude built it: the text word, the introduction, the main
 * points, the application, the summary and the conclusion, with each
 * illustration under the part it serves, as "The sermon" prints it.
 */
export function sermon(s, { outline = null } = {}) {
  const parts = sermonParts(s, { outline });
  if (parts.empty) { toast(t('There is nothing to read yet: write the introduction, the main points, the application or the conclusion first.'), true); return false; }
  const art = open(t('The sermon'), s);
  fillSermon(art, s, parts);
  fetchMissing(s, () => fillSermon(clear(art), s, sermonParts(s, { outline })));
  return true;
}

/** The sermon into an article (article()): its head, then a section per part. `parts` is pdf.js sermonParts of the preparation. */
export function fillSermon(art, s, parts = sermonParts(s)) {
  const { c, ref, title } = parts;
  const L = langOf(s);   // the headings in the sermon's language, as the prints have them
  head(art, s, { ref, title: s.title || s.theme || !ref ? title : '', thread: c.thread });
  const tipAt = art.childNodes.length;   // where the line on the references goes, once there is one
  const put = (...nodes) => art.append(...nodes.filter(Boolean));
  // `feel` names the part in the outline whose feeling stands under the heading: ['intro'] or ['point', n]
  const section = (heading, body, extras = [], feel = null) => {
    if (heading) art.append(el('h2', { text: heading }));
    const feeling = feel ? feelingLine(c.outline, feel[0], feel[1]) : '';
    if (feeling) art.append(el('p', { class: 'read-feel', text: feeling }));
    put(...paras(body, '', s));   // a reference in the text opens its verse with a tap (withRefs)
    for (const x of extras) {
      if (x.kind === 'illustration') art.append(el('p', { class: 'read-extra' }, [el('b', { text: tl(L, 'Illustration: ') + (x.title || '') })]));
      else if (x.kind === 'lighter') art.append(el('p', { class: 'read-extra' }, [el('b', { text: tl(L, 'A lighter moment') })]));
      put(...paras(x.body, x.kind === 'text' ? '' : 'read-in', s));
    }
  };
  if (c.intro) section(tl(L, 'Introduction'), c.intro, c.after.intro, ['intro']);
  for (const p of c.points) section(`${p.n}. ${p.heading}`.trim(), p.body, p.extras, ['point', p.n]);
  if (c.application) section(tl(L, 'Application for the congregation'), c.application, c.after.application, ['application']);
  if (c.summary) section(tl(L, 'Summary'), c.summary);
  if (c.conclusion) section(tl(L, 'Conclusion'), c.conclusion, c.after.conclusion, ['conclusion']);
  // one line under the head says what a reference does, when the sermon names a verse whose words are here
  if (art.querySelector('.vref')) art.insertBefore(el('p', { class: 'read-tip', text: t('Tap a Bible reference to read the verse.') }), art.childNodes[tipAt] || null);
}

/**
 * The cue cards: the text word and the message, then under each heading its
 * line of cues, "# cue # cue # cue", each in its own colour, as the printed
 * card has them (`service`: the Guide's article the preparation is linked
 * to, whose introduction gives the cues while the minister's own is empty).
 */
export function cues(s, { service = null, onChange = null } = {}) {
  const parts = cueList(s, service);
  if (!parts.length && !(s.text || s.theme || s.core)) { toast(t('There is nothing on the cards yet: write the main points first, or type the cues under Print or save.'), true); return false; }
  fillCues(open(t('Cue cards'), s, 'cue-view'), s, parts, { service, onChange });
  return true;
}

/** The parts of the cue cards that have cues on them (a main point always, so that its heading shows), as the cards print them. */
export function cueList(s, service = null) {
  return cueParts(s, { service, lang: langOf(s) }).filter(p => cuesOf(p).length || p.key === 'point');
}

/**
 * The cue cards into an article: the text word and the message, then a
 * heading and its line of cues for each part (cueList). Where cues the
 * minister typed are not in the sermon now (cues.js: a part is stale), a line
 * at the head says so, with a tap that takes the cues of those parts from the
 * sermon again and keeps the preparation (Jerome, 2026-11-25: "Cue cards and
 * service do not correlate"); `onChange` hears it (the Prepare form draws its
 * lines again), and `service` is the Guide's article for the cards drawn again.
 */
export function fillCues(art, s, parts, { service = null, onChange = null } = {}) {
  const { ref } = sermonParts(s);
  const L = langOf(s);
  head(art, s, { ref: ref || s.title || '', theme: s.theme, core: s.core, thread: s.thread });
  const stale = parts.filter(part => part.stale);
  if (stale.length) {
    art.append(el('div', { class: 'cue-stale cue-stale-read' }, [
      el('p', { text: t('Some cues are not in your sermon now: {parts}.', { parts: stale.map(part => cueHeading(part, L)).join(', ') }) }),
      el('button', { class: 'btn small', type: 'button', text: t('Take them from the sermon'), onclick: async () => {
        for (const part of stale) setOwn(s, part, '');
        await saveSermon(s);
        fillCues(clear(art), s, cueList(s, service), { service, onChange });
        if (onChange) onChange();
      } }),
    ]));
  }
  for (const part of parts) {
    const heading = cueHeading(part, L);
    art.append(el('h2', { class: 'cue-head', text: /[:!?.]$/.test(heading) ? heading : heading + ':' }));
    const list = cuesOf(part);
    if (!list.length) continue;
    const line = el('p', { class: 'cue-line' });
    list.forEach((cue, i) => line.append(el('span', { class: 'cue-mark', text: MARK }), ' ', el('span', { class: `cue c${i % CUE_COLORS.length}`, text: cue }), ' '));
    art.append(line);
    if (part.stale) art.append(el('p', { class: 'cue-stale-tag', text: t('Not in your sermon now') }));
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

/*
 * A Bible reference in the sermon's text, "(John 1:14)", is a button on the
 * screen: a tap shows the verse's words in a box at the end of the sentence
 * that names it, so it is read in the context of its paragraph, and a second
 * tap puts it away (Jerome, 2026-11-25: "I just want to understand the context
 * when we refer to a Bible verse. I don't want to find it at the bottom
 * there"). The words are the ones kept with the preparation (verses.js
 * quoteOf); a reference whose words are not here stays plain text. The prints
 * and the voice leave the verses out.
 */
let boxes = 0;

/** The box with a verse's words: the reference in bold, the words, and the Bible's name where it is not the sermon's own. Hidden until its button opens it. */
export function verseBox(quotes, s, { open = false } = {}) {
  const own = String((s && s.translation) || '').trim();
  return el('span', { class: 'vref-box', id: 'vq' + (++boxes), hidden: !open, onclick: e => e.stopPropagation() }, quotes.map(q => el('span', { class: 'vref-q', lang: langCode(q.lang) || null }, [
    el('b', { class: 'verse-ref', text: formatRef(q, state.settings.bookLang) }), ' ',
    q.text,
    q.short && q.short !== own ? el('span', { class: 'verse-src', text: ` (${q.short})` }) : null,
  ])));
}

/**
 * The reference that opens and closes a verse's box; `onToggle(open)` hears
 * each tap. A span in the role of a button, so that it runs on in the line
 * with the words around it, "(John 1:14)", as text does; Enter and the space
 * bar work it too.
 */
export function refButton(label, box, onToggle = null) {
  const toggle = e => {
    e.preventDefault();
    e.stopPropagation();   // in a suggestion of Claude's, a tap on the text opens it for editing: not this one
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('open', open);
    if (onToggle) onToggle(open);
  };
  const btn = el('span', { class: 'vref', role: 'button', tabindex: '0', text: label, 'aria-expanded': box.hidden ? 'false' : 'true', 'aria-controls': box.id,
    onclick: toggle, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') toggle(e); } });
  btn.classList.toggle('open', !box.hidden);
  return btn;
}

/** Where the sentence that goes on from `from` ends: after its full stop (and a closing bracket or quote), or at the end of the text. "Rev. 21:5" or "e.g. the" is no end. */
function sentenceEnd(text, from) {
  const end = /[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s+[^\p{Ll}\d\s]|\s*$)/gu;
  end.lastIndex = from;
  const m = end.exec(text);
  return m ? m.index + m[0].length : text.length;
}

/**
 * A text with its Bible references made into buttons (refButton), each with
 * the box of its verse at the end of its sentence (verseBox): an array of
 * strings and nodes to append. Verses listed after one reference, "John 3:16,
 * 18", open together with it.
 */
export function withRefs(text, s) {
  const v = String(text || '');
  const found = [];
  for (const r of findRefs(v)) {
    const q = quoteOf(r, s);
    if (!q) continue;
    const last = found[found.length - 1];
    if (last && last.at === r.at) last.quotes.push(q);
    else found.push({ at: r.at, end: r.at + r.match.length, quotes: [q] });
  }
  if (!found.length) return [v];
  const marks = [];
  for (const f of found) {
    const box = verseBox(f.quotes, s);
    marks.push({ pos: f.at, end: f.end, node: refButton(v.slice(f.at, f.end), box) }, { pos: sentenceEnd(v, f.end), end: -1, node: box });
  }
  marks.sort((a, b) => a.pos - b.pos);   // a box after the buttons of its sentence, in their order
  const out = [];
  let pos = 0;
  // a line break right after a box (in a suggestion, whose text keeps its lines) becomes a <br>, which the open box makes
  // unneeded (styles.css hides it then): the box ends the line itself
  const add = to => {
    let x = v.slice(pos, to);
    const prev = out[out.length - 1];
    const nl = prev && prev.classList && prev.classList.contains('vref-box') ? x.match(/^[ \t]*\n/) : null;
    if (nl) { out.push(el('br')); x = x.slice(nl[0].length); }
    if (x) out.push(x);
  };
  for (const m of marks) {
    if (m.pos > pos) { add(m.pos); pos = m.pos; }
    out.push(m.node);
    if (m.end > pos) pos = m.end;
  }
  if (pos < v.length) add(v.length);
  return out;
}

/**
 * The words of the verses the sermon names that are not with the
 * preparation yet (one written before they were written out, or changed on a
 * device that could not reach a Bible): fetched in the background from the
 * Bibles of this device (verses.js gather), kept with the preparation, and
 * `redraw` runs when they have come. The Prepare form does more (prepare.js
 * fetchQuotes); this is for a sermon read without opening it there.
 */
export function fetchMissing(s, redraw) {
  const lang = langOf(s);
  const ids = sourceOrder(sources(), { translationId: s.translationId, translation: s.translation, reader: state.settings.translation, lang });
  gather(s, { ids, fetch: versesFrom, lang })
    .then(changed => { if (!changed) return; saveSermon(s).catch(() => {}); redraw(); })
    .catch(() => { /* the verses stay as they are: the references are still there */ });
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

/** The head of a reading, as the PDFs have it: the service line, the Bible reference, the text word, then the title or the message, and the golden thread of the sermon. */
function head(art, s, { ref = '', title = '', theme = '', core = '', thread = '' }) {
  if (serviceLine(s)) art.append(el('p', { class: 'read-svc', text: serviceLine(s) }));
  const hymns = hymnLine(s, langOf(s), { titles: false });
  if (hymns) art.append(el('p', { class: 'read-hymns', text: hymns }));
  if (ref) art.append(el('p', { class: 'read-ref', text: ref + (s.translation ? `  (${s.translation})` : '') }));
  if (String(s.text || '').trim()) art.append(el('blockquote', { class: 'read-word' }, paras(s.text)));
  if (title) art.append(el('h1', { text: title }));
  if (String(theme || '').trim()) art.append(el('p', { class: 'read-theme', text: theme.trim() }));
  if (String(core || '').trim()) art.append(...paras(core));
  if (String(thread || '').trim()) art.append(el('p', { class: 'read-thread', text: tl(langOf(s), 'The golden thread: ') + thread.trim() }));
}

/** A text as paragraphs: a blank line between them starts a new one, a single line break stays a line break. With the preparation `s`, a Bible reference in it opens its verse (withRefs). */
function paras(text, cls = '', s = null) {
  return String(text || '').trim().split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => {
    const p = el('p', cls ? { class: cls } : {});
    x.split('\n').forEach((line, i) => { if (i) p.append(el('br')); p.append(...(s ? withRefs(line.trim(), s) : [line.trim()])); });
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

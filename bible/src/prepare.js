/*
 * Prepare: a guided path from a Bible text to a divine service.
 *
 * One preparation is one service. The form walks the usual order of work:
 * the text word and the message from the Divine Service Guide, understanding
 * the text, building the sermon, illustrations from the person's own notes,
 * and a reflection afterwards. Everything saves as it is typed. Two printed
 * outputs come from it: the full sermon notes and a one-page cue card.
 *
 * Helpers sit alongside the form. A loaded Divine Service Guide (guides.js)
 * fills the text word, message and notes of a service in one tap and keeps
 * the article at hand under step 2, where "Break down the article" asks
 * Claude (ai.js) to take it apart sentence by sentence: what each one says
 * in plain words, what it gives the sermon, and the Bible passages and
 * Catechism sections that bring depth to it. "Suggest answers" under step 3
 * asks for the context of the text, key words, Catechism sections, cross
 * references and what the text gives each main point; "Suggest the sermon"
 * under step 4 asks for the build itself: introduction, main points,
 * application, conclusion and illustrations. Each suggestion comes with a
 * "Use" button, so nothing lands in the notes that the person did not choose.
 *
 * The main points always come from the Guide (guides.js mainPoints): a
 * preparation taken from a service starts with them, "Take the main points
 * from the Guide" under step 4 fetches them again, and Claude's points are
 * the Guide's in plain words, each going into its own box. A point from the
 * Guide carries a small "Guide" mark.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, debounce, nextSunday, fit, lineBox, busy } from './ui.js';
import { t, tn } from './i18n.js';
import { parseRef, formatRef } from './books.js';
import { state, saveSermon, deleteSermon } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as Notes from './notes.js';
import * as Pdf from './pdf.js';
import * as Guides from './guides.js';
import * as AI from './ai.js';

export const OCCASIONS = [
  'Sunday divine service', 'Midweek divine service', 'Divine service for the departed',
  'Youth service', 'Children\'s service', 'Funeral service', 'Wedding', 'Other',
];
let headCount = 0;   // ids for the titles of the boxes (aria-labelledby)

/** A suggested cross reference as one line of the Cross references box. */
const xrLine = x => `${x.reference}${x.why ? ' – ' + x.why : ''}`;
/** A piece of the Guide's breakdown as it goes into "Notes from the Guide": the Guide's words, then the plain words and the insight. */
const pieceLine = p => `“${p.quote}”\n${[p.said, p.insight].filter(Boolean).join(' ')}`;
/** Text as a key for matching headings: letters and digits only, lower case. */
const norm = v => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A main point with nothing in it yet. */
const emptyPoint = x => !(x.heading || '').trim() && !(x.body || '').trim();

const STATUS = [['draft', 'Draft'], ['ready', 'Ready'], ['held', 'Held']];
const STATUS_LABEL = Object.fromEntries(STATUS);

function blank() {
  const congregation = state.settings.congregation || '';
  const prev = lastPeople(congregation);   // the same people as last time in this congregation
  return {
    date: nextSunday(), congregation, occasion: OCCASIONS[0], title: '',
    // who is listening: the age group ('' = all ages), a line about the people, and this preparation's own humour level and language ('' = as in Settings)
    audience: prev ? prev.audience || '' : '', people: prev ? prev.people || '' : '', humour: '', lang: '',
    ref: null, refText: '', translation: Bible.source(state.settings.translation)?.short || 'KJV', translationId: state.settings.translation, text: '',
    theme: '', core: '', guide: '', context: '', keywords: '', catechism: [], catechismText: 'full', crossRefs: '', intro: '',
    points: [{ heading: '', body: '' }, { heading: '', body: '' }, { heading: '', body: '' }],
    application: '', illustrations: '', conclusion: '', reflection: '', status: 'draft',
  };
}

/** The latest other preparation for this congregation that says who is listening, or null. */
function lastPeople(congregation, exceptId) {
  const c = (congregation || '').trim().toLowerCase();
  if (!c) return null;
  return state.sermons.find(x => x.id !== exceptId && (x.congregation || '').trim().toLowerCase() === c && ((x.people || '').trim() || x.audience)) || null;
}

export async function newFromText(ref, text, translationShort) {
  await Cat.load().catch(() => {});
  const s = {
    ...blank(),
    ref, refText: formatRef(ref, state.settings.bookLang),
    translation: translationShort || '', translationId: state.settings.translation,
    text: text || '',
    catechism: sectionsForRef(ref).slice(0, 12).map(c => ({ n: c.n, title: c.title })),
  };
  // the Guide has an article on this text: its message and notes come along
  const m = Guides.matchService(ref);
  if (m) Guides.prefill(s, m.guide, m.i, { fresh: true });
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

/** A preparation started from a service in a loaded Guide. */
export async function newFromService(guide, i) {
  await Cat.load().catch(() => {});
  const s = blank();
  Guides.prefill(s, guide, i, { force: true, fresh: true });
  for (const c of sectionsForRef(s.ref).slice(0, 12)) if (!s.catechism.find(x => x.n === c.n)) s.catechism.push({ n: c.n, title: c.title });
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

function sectionsForRef(ref) {
  if (!ref) return [];
  const out = [];
  if (!ref.verse) return Cat.refsFor(ref.book, ref.chapter, null);
  for (let v = ref.verse; v <= (ref.verseEnd || ref.verse); v++) {
    for (const sec of Cat.refsFor(ref.book, ref.chapter, v)) if (!out.includes(sec)) out.push(sec);
  }
  return out;
}

export function render(container, route) {
  clear(container);
  if (route[1]) {
    const s = state.sermons.find(x => x.id === route[1]);
    if (s) return renderEditor(container, s);
    toast(t('That preparation was not found.'), true);
    location.hash = '#prepare';
    return;
  }
  renderList(container);
}

/* ---------------------------------------------------------------- the list */
function renderList(container) {
  const search = el('input', { type: 'search', placeholder: t('Search by text, congregation or theme…'), 'aria-label': t('Search preparations'), autocomplete: 'off' });
  const list = el('div', { class: 'list' });
  function show() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const items = state.sermons.filter(s => !q || [s.refText, s.congregation, s.theme, s.title, s.occasion, s.date].join(' ').toLowerCase().includes(q));
    if (!items.length) list.append(el('p', { class: 'muted', text: state.sermons.length ? t('Nothing matches.') : t('No preparations yet. Tap "New preparation", or select verses in the reader and choose "Prepare a service".') }));
    for (const s of items) {
      list.append(el('a', { class: 'item sermon', href: `#prepare/${s.id}` }, [
        el('div', { class: 'when' }, [el('b', { text: fmtDate(s.date, true) || t('No date') }), el('span', { class: 'muted small', text: [s.congregation, t(s.occasion)].filter(Boolean).join(' · ') })]),
        el('div', { class: 'grow' }, [
          el('div', { class: 'ref', text: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || t('No text word yet')) }),
          el('div', { class: 'muted small', text: s.title || s.theme || '' }),
        ]),
        el('span', { class: 'pill status ' + (s.status || 'draft'), text: t(STATUS_LABEL[s.status] || 'Draft') }),
      ]));
    }
  }
  search.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [
      el('h2', { text: t('Service preparations ({n})', { n: state.sermons.length }) }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small', type: 'button', text: t('New preparation'), onclick: () => newBlank() }),
    ]),
    el('p', { class: 'muted small', text: t('Each card is one divine service: the text word, the message from the Divine Service Guide, your own thoughts, and the printed sermon notes and cue card.') }),
    Guides.card({ onPrepare: newFromService, onChange: () => renderList(clear(container)) }),
    search, list);
  show();
}

async function newBlank() {
  const s = blank();
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

/* ---------------------------------------------------------------- editor */
function renderEditor(root, s) {
  const lang = state.settings.bookLang;
  const savedBadge = el('span', { class: 'badge', text: t('Saved'), hidden: true });
  const save = debounce(async () => {
    await saveSermon(s);
    savedBadge.hidden = false;
    setTimeout(() => { savedBadge.hidden = true; }, 1500);
  }, 500);
  const touch = () => { save(); };
  const inputs = {};   // key -> its box, so a suggestion can be put into it

  // the title of a section of the sermon, above its box: styled as a heading (see #tab-prepare .f-title in styles.css)
  const title = text => el('span', { class: 'f-title', text });
  /** Puts text into a box from code (a suggestion, a clear, an undo) the same way typing would. */
  function setBox(key, value) {
    s[key] = value || '';
    const input = inputs[key];
    if (!input) return;
    input.value = s[key];
    if (input.tagName === 'TEXTAREA') fit(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));   // the Clear button follows the content
  }
  /** Empties one box, with Undo in the toast. */
  function clearBox(key, label) {
    const old = s[key] || '';
    if (!old.trim()) return;
    setBox(key, '');
    toast(t('{label} cleared.', { label }), false, () => { setBox(key, old); });
  }
  /**
   * The title row of a box: the heading and, while the box has text, a Clear
   * button. The box is named by the heading alone (aria-labelledby), so a
   * screen reader does not read "Clear" as part of the box's name.
   */
  function head(label, key, input) {
    const heading = title(label);
    heading.id = `box-title-${key}-${++headCount}`;
    input.setAttribute('aria-labelledby', heading.id);
    const btn = el('button', { class: 'clear-btn', type: 'button', text: t('Clear'), 'aria-label': t('Clear {label}', { label }), onclick: ev => { ev.preventDefault(); clearBox(key, label); } });
    const show = () => { btn.hidden = !(input.value || '').trim(); };
    input.addEventListener('input', show);
    show();
    return el('span', { class: 'f-head' }, [heading, btn]);
  }
  // every box grows with its text (see autosize in ui.js); `line` is a one-line box that wraps rather than scrolls sideways
  function field(label, key, opts = {}) {
    const input = opts.rows
      ? el('textarea', { rows: opts.rows, placeholder: opts.placeholder || '' })
      : opts.line
        ? lineBox({ placeholder: opts.placeholder || '' })
        : el('input', { type: opts.type || 'text', placeholder: opts.placeholder || '' });
    input.value = s[key] || '';
    input.addEventListener('input', () => { s[key] = input.value; touch(); });
    inputs[key] = input;
    return el('label', { class: 'f' + (opts.cls ? ' ' + opts.cls : '') }, [opts.noClear ? title(label) : head(label, key, input), input, opts.hint ? el('span', { class: 'hint muted small', text: opts.hint }) : null]);
  }
  /** A step's heading; with `onClear` it carries "Clear this step" at the right. */
  function step(n, title, hint, onClear) {
    return el('div', { class: 'step-head' }, [
      el('span', { class: 'step-n', text: n }),
      el('div', { class: 'step-text' }, [el('h3', { text: title }), hint ? el('p', { class: 'muted small', text: hint }) : null]),
      onClear ? el('button', { class: 'btn small ghost step-clear', type: 'button', text: t('Clear this step'), onclick: onClear }) : null,
    ]);
  }
  /**
   * Empties every box of a step after a confirmation, with Undo in the
   * toast. `extra` clears and restores what is not a plain box (ticks, points).
   */
  async function clearStep(n, label, keys, extra) {
    if (!await confirmBox(t('Clear everything under step {n}, {label}? The other steps stay as they are. You can undo it straight after.', { n, label }), t('Clear'), true)) return;
    const old = {};
    for (const k of keys) { old[k] = s[k] || ''; setBox(k, ''); }
    const kept = extra ? extra.clear() : null;
    touch();
    toast(t('Step {n} cleared.', { n }), false, () => {
      for (const k of keys) setBox(k, old[k]);
      if (extra) extra.restore(kept);
      touch();
    });
  }
  /** Adds text to a box: a suggestion the person chose to keep. */
  function add(key, text, sep = '\n\n') {
    setBox(key, (s[key] && s[key].trim() ? s[key].trim() + sep : '') + text);
    touch();
  }

  // ---- header
  const statusSel = el('select', { class: 'status-sel', 'aria-label': t('Status of this preparation') }, STATUS.map(([v, l]) => el('option', { value: v, text: t(l), selected: (s.status || 'draft') === v })));
  statusSel.addEventListener('change', () => { s.status = statusSel.value; touch(); });
  root.append(
    el('div', { class: 'crumbs' }, [el('a', { href: '#prepare', text: t('‹ All preparations') })]),
    el('div', { class: 'prep-head' }, [el('div', { class: 'docbar' }, [
      el('h2', { text: s.ref ? formatRef(s.ref, lang) : t('Service preparation') }),
      savedBadge,
      el('div', { class: 'spacer' }),
      statusSel,
    ])]));
  // the form itself sits on a page under the pinned heading
  const container = el('div', { class: 'page' });
  root.append(container);

  // ---- service details
  const occSel = el('select', {}, [...OCCASIONS, ...(OCCASIONS.includes(s.occasion) || !s.occasion ? [] : [s.occasion])].map(o => el('option', { value: o, text: t(o), selected: o === s.occasion })));
  occSel.addEventListener('change', () => { s.occasion = occSel.value; touch(); syncHumour(); });
  container.append(el('div', { class: 'fields three' }, [
    field(t('Date'), 'date', { type: 'date', noClear: true }),
    field(t('Congregation'), 'congregation', { placeholder: t('e.g. Phumolong') }),
    el('label', { class: 'f wide' }, [title(t('Occasion')), occSel]),
    field(t('Sermon title (optional)'), 'title', { cls: 'full', line: true, placeholder: t('A heading for your notes') }),
  ]));

  // ---- who is listening: Claude shapes its suggestions for these people (see ai.js); the line about them also heads the sermon notes
  function pick(label, key, options) {
    const sel = el('select', {}, options.map(([v, l]) => el('option', { value: v, text: t(l), selected: (s[key] || '') === v })));
    sel.addEventListener('change', () => { s[key] = sel.value; touch(); });
    inputs[key] = sel;
    return el('label', { class: 'f' }, [title(label), sel]);
  }
  const humourSel = pick(t('Humour'), 'humour', [['', t('As usual: {usual}', { usual: t(AI.humourLabel(state.settings.aiHumour)).toLowerCase() })], ['none', 'None in this service'], ['some', 'A little, where it fits'], ['more', 'A bit more']]);
  const humourHint = el('span', { class: 'hint muted small' });
  humourSel.append(humourHint);
  /** No humour at a funeral or a service for the departed, whatever is chosen. */
  function syncHumour() {
    const off = AI.humourOf({ ...s, humour: 'some' }) === 'none';
    inputs.humour.disabled = off;
    humourHint.textContent = off ? t('None in a funeral or a service for the departed.') : '';
    humourHint.hidden = !off;   // an empty hint would still take a line
  }
  syncHumour();
  container.append(
    el('div', { class: 'fields who' }, [
      pick(t('Who is listening'), 'audience', AI.AUDIENCES),
      humourSel,
      pick(t('Language of the sermon'), 'lang', [['', t('As usual: {usual}', { usual: state.settings.aiLang === 'af' ? 'Afrikaans' : 'English' })], ...AI.LANGS]),
      field(t('About the people'), 'people', { cls: 'full people', line: true, placeholder: t('A few words: who they are, their work and language, what they are going through, how many') }),
    ]),
    el('p', { class: 'muted small who-hint', text: t('Claude shapes its suggestions for these people, in the language chosen. For an ordinary Sunday, leave it as it is. The age group and the people are remembered for your next preparation in this congregation.') }),
  );
  // the same congregation as an earlier preparation: its people come along, unless this one already says who is listening
  inputs.congregation.addEventListener('change', () => {
    if ((s.people || '').trim() || s.audience) return;
    const prev = lastPeople(s.congregation, s.id);
    if (!prev) return;
    s.audience = prev.audience || '';
    inputs.audience.value = s.audience;
    setBox('people', prev.people || '');
    touch();
    toast(t('Who is listening: taken from your last preparation for {congregation}.', { congregation: s.congregation.trim() }));
  });

  // ---- 1. text word
  container.append(step(1, t('The text word'), t('Read it slowly, more than once, and pray before writing anything. Fetch the text from a translation, or type it in yourself.')));
  const refInput = el('input', { type: 'text', value: s.ref ? formatRef(s.ref, lang) : (s.refText || ''), placeholder: t('e.g. Psalm 130:7 or Lukas 8:16-18') });
  const refHint = el('span', { class: 'hint muted small' });
  const transSel = el('select', {});
  for (const src of Bible.sources()) transSel.append(el('option', { value: src.id, text: src.short, selected: src.id === s.translationId }));
  transSel.append(el('option', { value: '', text: t('Typed / pasted'), selected: !s.translationId }));
  const textArea = el('textarea', { rows: 5, placeholder: t('The Bible text as it will be read. Tap "Fetch text" to fill it from the chosen translation.') });
  textArea.value = s.text || '';
  textArea.addEventListener('input', () => { s.text = textArea.value; touch(); });
  inputs.text = textArea;
  const catBox = el('div', { class: 'catbox' });

  function applyRef() {
    const r = parseRef(refInput.value);
    refHint.textContent = r ? '→ ' + formatRef(r, lang) : (refInput.value.trim() ? t('Not understood yet. Book, chapter, verse: "Johannes 3:16".') : '');
    refHint.classList.toggle('error', !r && !!refInput.value.trim());
    s.refText = refInput.value.trim();
    if (r) { s.ref = r; } else if (!refInput.value.trim()) { s.ref = null; }
    touch();
    renderCatechism();
    return r;
  }
  refInput.addEventListener('input', applyRef);
  const typedTrans = el('input', { type: 'text', value: s.translation || '', placeholder: t('e.g. NKJV'), hidden: !!s.translationId });
  transSel.addEventListener('change', () => {
    s.translationId = transSel.value;
    s.translation = transSel.value ? Bible.source(transSel.value)?.short || '' : (s.translation || '');
    typedTrans.hidden = !!transSel.value;
    touch();
  });
  typedTrans.addEventListener('input', () => { s.translation = typedTrans.value.trim(); touch(); });

  const fetchBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Fetch text'), onclick: async () => {
    const r = parseRef(refInput.value);
    if (!r) { toast(t('Give a reference first, such as "Psalm 130:7".'), true); return; }
    if (!transSel.value) { toast(t('Choose a translation to fetch from, or type the text yourself.'), true); return; }
    try {
      const ch = await Bible.getChapter(transSel.value, r.book, r.chapter);
      if (ch.missing) { toast(t('That translation does not contain this book.'), true); return; }
      const from = r.verse || 1, to = r.verse ? (r.verseEnd || r.verse) : ch.verses.length;
      s.text = Bible.joinVerses(ch.verses, from, to);
      s.translation = Bible.source(transSel.value).short;
      textArea.value = s.text;
      fit(textArea);
      touch();
      toast(t('Text fetched.'));
    } catch (e) { toast(e.message, true); }
  } });

  container.append(
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, [title(t('Reference')), refInput, refHint]),
      el('label', { class: 'f' }, [title(t('Translation')), el('div', { class: 'row line' }, [transSel, typedTrans, fetchBtn])]),
    ]),
    el('label', { class: 'f' }, [head(t('Text'), 'text', textArea), textArea]),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn small ghost', href: '#read', text: t('Open in the reader'), onclick: e => { if (s.ref) { e.preventDefault(); location.hash = `#read/${s.ref.book}/${s.ref.chapter}${s.ref.verse ? '/' + s.ref.verse : ''}`; } } }),
    ]));

  // ---- 2. the Guide
  container.append(step(2, t('The message from the Divine Service Guide'), t('Write the message and core thought of the Guide in your own words first. The Guide gives the direction; the sermon is how it reaches this congregation.'),
    () => clearStep(2, t('the message'), ['theme', 'core', 'guide'])));
  const guideBox = el('div', { class: 'guide-row' });
  container.append(guideBox);
  function renderGuide() {
    clear(guideBox);
    const link = Guides.findService(s);
    const pick = () => Guides.picker(s, async (guide, i) => {
      const filled = !!((s.theme || '').trim() || (s.guide || '').trim() || (s.text || '').trim() || (s.title || '').trim());
      const replace = !filled || await confirmBox(t('Replace the text word, title, message and notes with this service\'s? Your own notes under steps 3 to 6 stay as they are.'), t('Replace'), true);
      Guides.prefill(s, guide, i, { force: replace });
      await saveSermon(s);
      toast(replace ? t('Taken from the Guide.') : t('Linked to the Guide; what you had written was kept.'));
      render(clear(root), ['prepare', s.id]);
    });
    if (link) {
      const art = el('div', { class: 'guide-art', hidden: true });
      const readBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Read the article'), 'aria-expanded': 'false', onclick: () => {
        if (art.hidden) { if (!art.firstChild) art.append(Guides.article(link.service, link.guide)); art.hidden = false; readBtn.textContent = t('Hide the article'); readBtn.setAttribute('aria-expanded', 'true'); }
        else { art.hidden = true; readBtn.textContent = t('Read the article'); readBtn.setAttribute('aria-expanded', 'false'); }
      } });
      guideBox.append(
        el('div', { class: 'row line guide-link' }, [
          el('span', { class: 'small grow' }, [el('b', { text: t('From the Guide: ') }), `${link.service.dateText || fmtDate(link.service.date)} · ${link.service.title || link.service.label}`]),
          readBtn,
          el('button', { class: 'btn small ghost', type: 'button', text: t('Change'), onclick: pick }),
        ]),
        art);
    } else if (Guides.all().length) {
      guideBox.append(el('div', { class: 'row' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: t('Take the message from the Guide'), onclick: pick }),
        el('span', { class: 'muted small', text: t('Fills the title, message and notes from the loaded Guide\'s article.') }),
      ]));
    }
  }
  renderGuide();

  // ---- the Guide, piece by piece: Claude takes the article apart sentence by sentence (see ai.js)
  const breakBox = el('div', { class: 'ai-box break-box' });
  container.append(breakBox);
  async function askBreak() {
    if (!AI.ready()) { Guides.noKey(); return; }
    const link = Guides.findService(s);
    if (!link) { toast(t('Take the message from the Guide first (step 2), so Claude has the article.'), true); return; }
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(t('Claude is going through the Guide\'s article sentence by sentence, with the text, the chapter and the Catechism at hand. This takes a minute or two.'));
    try {
      const out = await AI.breakdown(s, {
        service: link.service, guideTitle: link.guide.title,
        signal: ctrl.signal, onProgress: n => b.say(t('Writing the breakdown… {k}k letters so far.', { k: Math.round(n / 100) / 10 })),
      });
      s.breakdown = out;
      await saveSermon(s);
      b.done();
      renderBreak();
      toast(t('The breakdown is ready. Tap "Use" on what to keep.'));
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return; }
      b.fail(e.message || t('Claude could not answer.'));
    }
  }
  /** One piece of the article: the Guide's words, the plain words, the insight, and the passages and sections that bring depth. */
  function piece(p) {
    const refs = [];
    for (const x of p.bible || []) {
      refs.push(el('div', { class: 'bd-ref' }, [
        el('span', { class: 'grow' }, [el('b', { text: x.reference }), x.why ? ' – ' + x.why : null]),
        el('span', { class: 'bd-ref-actions' }, [
          x.ref ? el('a', { class: 'btn small ghost', href: `#read/${x.ref.book}/${x.ref.chapter}${x.ref.verse ? '/' + x.ref.verse : ''}`, text: t('Read') }) : null,
          el('button', { class: 'btn small ghost', type: 'button', text: t('Use'), onclick: () => { add('crossRefs', xrLine(x), '\n'); toast(t('Added to Cross references.')); } }),
        ]),
      ]));
    }
    for (const c of p.catechism || []) {
      refs.push(el('div', { class: 'bd-ref' }, [
        el('span', { class: 'grow' }, [el('a', { href: `#catechism/${encodeURIComponent(c.n)}`, class: 'num', text: c.n }), ' ', el('b', { text: c.title }), c.why ? ' – ' + c.why : null]),
        el('span', { class: 'bd-ref-actions' }, [catTick(c)]),
      ]));
    }
    return el('div', { class: 'ai-item bd-item' }, [
      el('div', { class: 'ai-text' }, [
        el('div', { class: 'bd-quote', text: p.quote }),
        p.said ? el('div', { class: 'bd-line' }, [el('b', { text: t('In plain words: ') }), p.said]) : null,
        p.insight ? el('div', { class: 'bd-line' }, [el('b', { text: t('For the sermon: ') }), p.insight]) : null,
        refs.length ? el('div', { class: 'bd-refs' }, refs) : null,
      ]),
      el('div', { class: 'ai-actions' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Use'), onclick: () => { add('guide', pieceLine(p)); toast(t('Added to Notes from the Guide.')); } })]),
    ]);
  }
  function renderBreak() {
    clear(breakBox);
    const a = s.breakdown;
    breakBox.hidden = !a && !Guides.findService(s);   // no article to break down, and nothing kept
    if (breakBox.hidden) return;
    const btn = el('button', { class: 'btn small ai-btn', type: 'button', onclick: askBreak }, [sparkle(), a ? t('Break it down again') : t('Break down the article')]);
    const drop = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: () => {
      s.breakdown = null; touch(); renderBreak();
      toast(t('Breakdown removed.'), false, () => { s.breakdown = a; touch(); renderBreak(); });
    } }) : null;
    const pdf = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Save as PDF'), onclick: () => run(Pdf.breakdownPdf, 'download') }) : null;
    const printBtn = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Print'), onclick: () => run(Pdf.breakdownPdf, 'print') }) : null;
    breakBox.append(el('div', { class: 'row ai-head' }, [btn, drop, pdf, printBtn, el('span', { class: 'muted small grow', text: a
      ? t('Broken down {date} by {model}{cost}. The Guide\'s words stay as they are; the rest is a starting point.', { date: fmtDate(a.at), model: AI.modelLabel(a.model), cost: a.cost ? ', ' + AI.fmtCost(a.cost) : '' })
      : t('Claude takes the Guide\'s article apart sentence by sentence: what each one says in plain words, what it gives the sermon, and the Bible passages and Catechism sections that bring depth to it. You choose what to keep.') })]));
    if (!a) return;
    const panel = el('details', { class: 'ai-panel', open: true });
    panel.append(el('summary', { text: t('The article, piece by piece') }));
    if (a.note) panel.append(el('p', { class: 'small ai-note', text: a.note }));
    panel.append(el('p', { class: 'muted small bd-how', text: t('"Use" puts a piece into Notes from the Guide; the passages go to Cross references; ticked sections print.') }));
    if (a.thread) panel.append(group(t('The thread'), [item('', a.thread, () => { add('core', a.thread); toast(t('Added to Core thought.')); })], null, t('What the whole article drives at.')));
    // the pieces, under the Guide's own headings
    const groups = [];
    for (const p of a.parts || []) {
      const last = groups[groups.length - 1];
      if (last && last.heading === p.heading) last.parts.push(p); else groups.push({ heading: p.heading, parts: [p] });
    }
    for (const g of groups) panel.append(group(g.heading || t('The article'), g.parts.map(piece)));
    panel.append(el('p', { class: 'muted small', text: t('Divine Service Guide © New Apostolic Church International. Loaded on this device for your own preparation.') }));
    breakBox.append(panel);
  }
  renderBreak();

  container.append(
    field(t('Message of the service'), 'theme', { line: true, placeholder: t('The theme in one sentence') }),
    field(t('Core thought'), 'core', { rows: 2, placeholder: t('The one thing the congregation should take home') }),
    field(t('Notes from the Guide'), 'guide', { rows: 5, placeholder: t('Key thoughts from the Guide, in your own words. Which sentences struck you? What should be kept?') }),
  );

  // ---- 3. understand
  container.append(step(3, t('Understand the text'), t('Who is speaking, to whom, and why? What came before and after? Which words carry the weight? The Catechism sections below quote this very text: tick the ones to keep, and open one to read it here.'),
    () => clearStep(3, t('understanding the text'), ['context', 'keywords', 'crossRefs'], {
      clear: () => { const kept = s.catechism || []; s.catechism = []; renderCatechism(); renderTicks(); return kept; },
      restore: kept => { s.catechism = kept; renderCatechism(); renderTicks(); },
    })));
  const aiBox = el('div', { class: 'ai-box' });
  container.append(aiBox);
  const catChoice = el('select', { class: 'small' }, [
    el('option', { value: 'full', text: t('Full text of each section') }),
    el('option', { value: 'summary', text: t('The Catechism\'s own summary') }),
    el('option', { value: 'ref', text: t('Number and title only') }),
  ]);
  catChoice.value = s.catechismText || 'full';
  catChoice.addEventListener('change', () => { s.catechismText = catChoice.value; touch(); });
  const catNote = el('p', { class: 'muted small cat-note' });
  container.append(
    field(t('Context'), 'context', { rows: 4, placeholder: t('The setting of the text: the people, the situation, the surrounding chapters') }),
    field(t('Key words and their meaning'), 'keywords', { rows: 3, placeholder: t('One word per line, with what it means here') }),
    el('label', { class: 'f' }, [title(t('Catechism references')), catBox]),
    el('div', { class: 'row line cat-row' }, [el('span', { class: 'small', text: t('In the sermon notes:') }), catChoice]),
    catNote,
    field(t('Cross references'), 'crossRefs', { rows: 3, placeholder: t('Other passages that shed light, one per line: "Romans 8:28 – all things work together"') }),
  );

  function catRow(sec, checked, onChange, extraRef) {
    const cb = el('input', { type: 'checkbox', checked });
    cb.addEventListener('change', () => onChange(cb.checked));
    const row = el('label', { class: 'check' }, [cb, el('span', { class: 'num', text: sec.n }), el('span', { class: 'grow', text: sec.title })]);
    const wrap = el('div', { class: 'cat-item' }, row);
    if (Cat.textReady() && Cat.textOf(sec.n)) {
      const body = el('div', { class: 'cat-read', hidden: true });
      const btn = el('button', { class: 'btn small ghost', type: 'button', text: t('Read'), 'aria-expanded': 'false', onclick: e => {
        e.preventDefault();
        if (body.hidden) { if (!body.firstChild) body.append(Cat.renderText(sec.n, { noCredit: true })); body.hidden = false; btn.textContent = t('Hide'); btn.setAttribute('aria-expanded', 'true'); }
        else { body.hidden = true; btn.textContent = t('Read'); btn.setAttribute('aria-expanded', 'false'); }
      } });
      row.append(btn);
      wrap.append(body);
    } else {
      row.append(el('a', { class: 'small', href: Cat.url(extraRef || sec), target: '_blank', rel: 'noopener', text: 'nak.org ↗' }));
    }
    return wrap;
  }

  function renderCatechism() {
    clear(catBox);
    if (!Cat.ready()) { Cat.load().then(renderCatechism); catBox.append(el('span', { class: 'muted small', text: t('Loading…') })); return; }
    if (Cat.hasText() && !Cat.textReady()) { Cat.loadText().then(renderCatechism); }
    const secs = sectionsForRef(s.ref);
    if (!s.ref) { catBox.append(el('span', { class: 'muted small', text: t('Give a reference above to see the Catechism sections that refer to it.') })); }
    else if (!secs.length) { catBox.append(el('span', { class: 'muted small', text: t('The Catechism does not quote these verses directly. Search the Catechism tab by subject instead.') })); }
    const chosen = new Set((s.catechism || []).map(c => c.n));
    for (const sec of secs) {
      catBox.append(catRow(sec, chosen.has(sec.n), on => {
        s.catechism = (s.catechism || []).filter(c => c.n !== sec.n);
        if (on) s.catechism.push({ n: sec.n, title: sec.title });
        touch();
        renderTicks();
      }));
    }
    // keep any section chosen earlier that is no longer in the list (the reference changed)
    for (const c of (s.catechism || [])) if (!secs.find(x => x.n === c.n)) {
      catBox.append(catRow(c, true, () => { s.catechism = s.catechism.filter(x => x.n !== c.n); touch(); renderCatechism(); renderTicks(); }, Cat.section(c.n)));
    }
    catNote.textContent = Cat.hasText()
      ? t('Ticked sections go into the sermon notes as chosen above.')
      : t('The text of the Catechism is not loaded on this device, so the notes list the ticked sections by number and title. Load it under Settings → Catechism to read the sections here and print them.');
  }
  renderCatechism();

  // ---- the suggestions from Claude
  async function askAi() {
    if (!AI.ready()) { Guides.noKey(); return; }
    if (!s.ref && !(s.text || '').trim()) { toast(t('Give the text word first: a reference or the text itself.'), true); return; }
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(t('Claude is reading the text, the chapter, the Guide\'s article and the Catechism sections, with {who} in mind. This takes about a minute.', { who: t(AI.audienceLabel(AI.audienceOf(s))).toLowerCase() }));
    try {
      const link = Guides.findService(s);
      const out = await AI.suggest(s, {
        service: link ? link.service : null, guideTitle: link ? link.guide.title : '',
        signal: ctrl.signal, onProgress: n => b.say(t('Writing the suggestions… {k}k letters so far.', { k: Math.round(n / 100) / 10 })),
      });
      s.ai = out;
      await saveSermon(s);
      b.done();
      renderAi();
      toast(t('Suggestions ready. Tap "Use" on the ones to keep.'));
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return; }
      b.fail(e.message || t('Claude could not answer.'));
    }
  }
  /** The Tick/Ticked button of a suggested Catechism section: it joins or leaves the ticked sections under step 3. */
  function catTick(c) {
    const on = () => (s.catechism || []).some(x => x.n === c.n);
    const tick = el('button', { class: 'btn small ghost', type: 'button', text: on() ? t('Ticked') : t('Tick'), onclick: () => {
      if (on()) { s.catechism = s.catechism.filter(x => x.n !== c.n); }
      else { (s.catechism = s.catechism || []).push({ n: c.n, title: c.title }); }
      touch();
      renderCatechism();
      renderTicks();
    } });
    tick.dataset.cat = c.n;
    return tick;
  }
  /** Every Tick button on the page shows whether its section is ticked now, whichever panel it sits in. */
  function renderTicks() {
    for (const b of root.querySelectorAll('button[data-cat]')) b.textContent = (s.catechism || []).some(x => x.n === b.dataset.cat) ? t('Ticked') : t('Tick');
  }
  function item(title, body, onUse, extra, why) {
    const whys = [].concat(why || []).filter(Boolean);   // one or more muted lines under the text
    return el('div', { class: 'ai-item' }, [
      el('div', { class: 'ai-text' }, [title ? el('b', { text: title }) : null, title && body ? ' ' : null, body || null, ...whys.map(w => el('div', { class: 'ai-why muted small', text: w }))]),
      el('div', { class: 'ai-actions' }, [extra || null, onUse ? el('button', { class: 'btn small ghost', type: 'button', text: t('Use'), onclick: onUse }) : null]),
    ]);
  }
  /**
   * A main point from Claude goes into its own box: the box that holds that
   * point of the Guide or the same heading (its body is replaced, undoable),
   * else the box with its number when that one is empty, else the next empty
   * box, else a new one. The heading stays as the person wrote it unless it is
   * still the Guide's own words.
   */
  function usePoint(p) {
    s.points = s.points && s.points.length ? s.points : [];
    const pts = s.points;
    const same = x => (p.from === 'guide' && x.guide === p.n) || [p.heading, p.source].filter(Boolean).some(h => norm(h) === norm(x.heading));
    let slot = pts.find(same);
    if (slot) {
      const old = { ...slot };
      if (!(slot.heading || '').trim() || norm(slot.heading) === norm(p.source)) slot.heading = p.heading;
      slot.body = p.body;
      if (p.from === 'guide') slot.guide = p.n;
      touch(); renderPoints();
      toast(t('Main point {n} filled in.', { n: pts.indexOf(slot) + 1 }), false, () => { Object.assign(slot, old); touch(); renderPoints(); });
      return;
    }
    slot = (p.from === 'guide' && pts[p.n - 1] && emptyPoint(pts[p.n - 1])) ? pts[p.n - 1] : pts.find(emptyPoint);
    if (!slot) { slot = { heading: '', body: '' }; pts.push(slot); }
    slot.heading = p.heading; slot.body = p.body;
    if (p.from === 'guide') slot.guide = p.n; else delete slot.guide;
    touch(); renderPoints();
    toast(t('Added as main point {n}.', { n: pts.indexOf(slot) + 1 }));
  }
  /** All the main points at once, in their order: into empty boxes as they are, otherwise, after asking, in place of what is there (undoable). */
  async function usePoints(list, done) {
    const have = (s.points || []).filter(x => !emptyPoint(x));
    if (have.length && !await confirmBox(tn(have.length, 'Replace the main point you have with these {k}? You can undo it straight after.', 'Replace the {n} main points you have with these {k}? You can undo it straight after.', { k: list.length }), t('Replace'), true)) return;
    const old = s.points;
    s.points = list.map(p => ({ heading: p.heading, body: p.body, ...(p.from === 'guide' ? { guide: p.n } : {}) }));
    touch(); renderPoints();
    toast(done || t('All main points added.'), false, have.length ? () => { s.points = old; touch(); renderPoints(); } : null);
  }
  /** The main points Claude gave, each with its why-line and, where the heading was put into the sermon's language, the Guide's words. */
  function pointItems(a) {
    return (a.points || []).map(p => item(`${p.n}. ${p.heading}`, p.body, () => usePoint(p), null,
      [p.why, p.source && norm(p.source) !== norm(p.heading) ? t('From the Guide: ') + p.source : '']));
  }
  /** What to know about the main points Claude gave: that there are none without the Guide, and how many of its own were left out. */
  function pointNotes(a) {
    const out = [];
    if (!(a.points || []).length && ['none', 'guide', 'own', 'article'].includes(a.pointsFrom)) out.push(el('p', { class: 'small ai-note', text: t('No main points yet: they come from the Guide. Take the message from the Guide under step 2, or write the Guide\'s main points under step 4, then ask again.') }));
    if (a.dropped) out.push(el('p', { class: 'small ai-note', text: tn(a.dropped, '{n} point Claude added was left out: it is not in the Guide.', '{n} points Claude added were left out: they are not in the Guide.') }));
    return out;
  }
  /** The line under the heading of the main points: where they come from and where "Use" puts them. */
  function pointsHint(a, below) {
    if (!(a.points || []).length) return '';   // nothing to put anywhere: the note says why
    const box = below ? t('Each goes into its own box below.') : t('Each goes into its own box under step 4.');
    if (a.pointsFrom === 'guide' || a.pointsFrom === 'article') return t('The Guide\'s main points, in its order.') + ' ' + box;
    if (a.pointsFrom === 'own') return t('Your main points, filled in.') + ' ' + box;
    return below ? t('Each goes into the next empty main point.') : t('Each goes into the next empty main point under step 4.');
  }
  function group(title, items, onUseAll, hint) {
    if (!items.length) return null;
    return el('div', { class: 'ai-sec' }, [
      el('div', { class: 'row line ai-sec-head' }, [el('h4', { text: title }), hint ? el('span', { class: 'muted small grow', text: hint }) : el('span', { class: 'grow' }), onUseAll ? el('button', { class: 'btn small ghost', type: 'button', text: t('Use all'), onclick: onUseAll }) : null]),
      ...items,
    ]);
  }
  function renderAi() {
    clear(aiBox);
    const a = s.ai;
    const btn = el('button', { class: 'btn small ai-btn', type: 'button', onclick: askAi }, [sparkle(), a ? t('Ask again') : t('Suggest answers')]);
    const drop = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: () => {
      s.ai = null; touch(); renderAi();
      toast(t('Suggestions removed.'), false, () => { s.ai = a; touch(); renderAi(); });
    } }) : null;
    aiBox.append(el('div', { class: 'row ai-head' }, [btn, drop, el('span', { class: 'muted small grow', text: a
      ? t('Suggested {date} by {model}{who}{cost}. A starting point: the sermon is yours.', { date: fmtDate(a.at), model: AI.modelLabel(a.model), who: a.audience ? t(', for {who}', { who: t(AI.audienceLabel(a.audience)).toLowerCase() }) : '', cost: a.cost ? ', ' + AI.fmtCost(a.cost) : '' })
      : t('Claude answers the questions above from the text, the Guide\'s article and the Catechism, suggests cross references, and shows what the text gives each main point of the Guide, in short plain sentences and with the people above in mind. You choose what to keep.') })]));
    if (!a) return;
    const panel = el('details', { class: 'ai-panel', open: true });
    panel.append(el('summary', { text: t('The suggestions') }));
    if (a.note) panel.append(el('p', { class: 'small ai-note', text: a.note }));
    const ctxLine = c => `${c.question}\n${c.answer}`;
    panel.append(group(t('Understanding the text'), (a.context || []).map(c => item(c.question, c.answer, () => { add('context', ctxLine(c)); toast(t('Added to Context.')); })),
      () => { add('context', a.context.map(ctxLine).join('\n\n')); toast(t('All answers added to Context.')); }));
    const kwLine = k => `${k.word} – ${k.meaning}`;
    panel.append(group(t('Key words'), (a.keywords || []).map(k => item(k.word, k.meaning, () => { add('keywords', kwLine(k), '\n'); toast(t('Added to Key words.')); })),
      () => { add('keywords', a.keywords.map(kwLine).join('\n'), '\n'); toast(t('All key words added.')); }));
    panel.append(group(t('Catechism'), (a.catechism || []).map(c => el('div', { class: 'ai-item' }, [
      el('div', { class: 'ai-text' }, [el('a', { href: `#catechism/${encodeURIComponent(c.n)}`, class: 'num', text: c.n }), ' ', el('b', { text: c.title }), c.why ? ' ' + c.why : null]),
      el('div', { class: 'ai-actions' }, [catTick(c)]),
    ])), null, t('Ticked sections print in the sermon notes.')));
    panel.append(group(t('Cross references'), (a.crossRefs || []).map(x => item(x.reference, x.why, () => { add('crossRefs', xrLine(x), '\n'); toast(t('Added to Cross references.')); },
      x.ref ? el('a', { class: 'btn small ghost', href: `#read/${x.ref.book}/${x.ref.chapter}${x.ref.verse ? '/' + x.ref.verse : ''}`, text: t('Read') }) : null)),
      () => { add('crossRefs', a.crossRefs.map(xrLine).join('\n'), '\n'); toast(t('All cross references added.')); }));
    const fixed = ['guide', 'own', 'article'].includes(a.pointsFrom);   // the Guide's points, not thoughts of Claude's own
    panel.append(group(fixed ? t('Main points') : t('Sermon thoughts'), [
      ...pointNotes(a),
      ...pointItems(a),
      a.application ? item(t('Application'), a.application, () => { add('application', a.application); toast(t('Added to Application.')); }) : null,
    ].filter(Boolean), (a.points || []).length > 1 ? () => usePoints(a.points) : null, pointsHint(a, false)));
    aiBox.append(panel);
  }
  renderAi();

  // ---- 4. build
  container.append(step(4, t('Build the sermon'), t('An introduction that opens the door, the main points as the Guide gives them, each standing on the text, and a conclusion that leads to the altar. Plain words, short sentences.'),
    () => clearStep(4, t('building the sermon'), ['intro', 'application', 'conclusion'], {
      clear: () => { const kept = s.points || []; s.points = [{ heading: '', body: '' }]; renderPoints(); return kept; },
      restore: kept => { s.points = kept; renderPoints(); },
    })));
  const buildBox = el('div', { class: 'ai-box build-box' });
  container.append(buildBox);
  async function askBuild() {
    if (!AI.ready()) { Guides.noKey(); return; }
    if (!s.ref && !(s.text || '').trim()) { toast(t('Give the text word first: a reference or the text itself.'), true); return; }
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(t('Claude is building the sermon from the text, the message, the Guide\'s main points, your notes and the Catechism sections, for {who}. This takes about a minute.', { who: t(AI.audienceLabel(AI.audienceOf(s))).toLowerCase() }));
    try {
      const link = Guides.findService(s);
      const out = await AI.outline(s, {
        service: link ? link.service : null, guideTitle: link ? link.guide.title : '',
        signal: ctrl.signal, onProgress: n => b.say(t('Writing the outline… {k}k letters so far.', { k: Math.round(n / 100) / 10 })),
      });
      s.build = out;
      await saveSermon(s);
      b.done();
      renderBuild();
      toast(t('The outline is ready. Tap "Use" on the parts to keep.'));
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return; }
      b.fail(e.message || t('Claude could not answer.'));
    }
  }
  function renderBuild() {
    clear(buildBox);
    const a = s.build;
    const btn = el('button', { class: 'btn small ai-btn', type: 'button', onclick: askBuild }, [sparkle(), a ? t('Suggest again') : t('Suggest the sermon')]);
    const drop = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: () => {
      s.build = null; touch(); renderBuild();
      toast(t('Outline removed.'), false, () => { s.build = a; touch(); renderBuild(); });
    } }) : null;
    buildBox.append(el('div', { class: 'row ai-head' }, [btn, drop, el('span', { class: 'muted small grow', text: a
      ? t('Suggested {date} by {model}{who}{cost}. A starting point: the sermon is yours.', { date: fmtDate(a.at), model: AI.modelLabel(a.model), who: a.audience ? t(', for {who}', { who: t(AI.audienceLabel(a.audience)).toLowerCase() }) : '', cost: a.cost ? ', ' + AI.fmtCost(a.cost) : '' })
      : t('Claude proposes how to build this sermon from the text, the message and your notes, for the people above and in your way: an introduction, the main points as the Guide gives them, the application, the conclusion, illustrations and, where it fits, a lighter moment, each with a line on why it works. You choose what to keep.') })]));
    if (!a) return;
    const panel = el('details', { class: 'ai-panel', open: true });
    panel.append(el('summary', { text: t('The outline') }));
    if (a.note) panel.append(el('p', { class: 'small ai-note', text: a.note }));
    if (a.intro && a.intro.text) {
      panel.append(group(t('Introduction'), [item('', a.intro.text, () => { add('intro', a.intro.text); toast(t('Added to Introduction.')); }, null, a.intro.why)]));
    }
    panel.append(group(t('Main points'), [...pointNotes(a), ...pointItems(a)], (a.points || []).length > 1 ? () => usePoints(a.points) : null, pointsHint(a, true)));
    panel.append(group(t('Application and conclusion'), [
      a.application ? item(t('Application'), a.application, () => { add('application', a.application); toast(t('Added to Application.')); }) : null,
      a.conclusion ? item(t('Conclusion'), a.conclusion, () => { add('conclusion', a.conclusion); toast(t('Added to Conclusion.')); }) : null,
    ].filter(Boolean)));
    const illLine = x => `${x.title ? x.title + ': ' : ''}${x.body}`;
    panel.append(group(t('Illustrations'), (a.illustrations || []).map(x => item(x.title, x.body, () => { add('illustrations', illLine(x)); toast(t('Added to Illustrations under step 5.')); }, null, x.serves ? t('For {part}.', { part: x.serves }) : '')),
      (a.illustrations || []).length > 1 ? () => { add('illustrations', a.illustrations.map(illLine).join('\n\n')); toast(t('All illustrations added under step 5.')); } : null, t('They go into the Illustrations box under step 5.')));
    if (a.lighter && a.lighter.text) {
      // the light moment goes where Claude placed it: the introduction, the conclusion, or else among the illustrations
      const where = a.lighter.where || '';
      const key = /intro|inleiding|open/i.test(where) ? 'intro' : /conclu|slot|close|end/i.test(where) ? 'conclusion' : 'illustrations';
      const box = { intro: t('Introduction'), conclusion: t('Conclusion'), illustrations: t('Illustrations under step 5') }[key];
      panel.append(group(t('A lighter moment'), [item('', a.lighter.text, () => { add(key, a.lighter.text); toast(t('Added to {box}.', { box })); }, null, where ? t('For {part}.', { part: where }) : '')],
        null, t('A smile where it fits. Yours to use or to leave.')));
    }
    buildBox.append(panel);
  }
  renderBuild();
  container.append(field(t('Introduction'), 'intro', { rows: 4, placeholder: t('How you will begin: a question, a picture from daily life, the setting of the text') }));
  const pointsBox = el('div', { class: 'points' });
  function renderPoints() {
    clear(pointsBox);
    s.points = s.points && s.points.length ? s.points : [{ heading: '', body: '' }];
    s.points.forEach((p, i) => {
      const head = lineBox({ value: p.heading || '', placeholder: t('Main point {n}', { n: i + 1 }) });
      const body = el('textarea', { rows: 4, placeholder: t('What the text says, what it means, what it asks of us') });
      body.value = p.body || '';
      // a point from the Guide carries a mark; it goes when the point is emptied
      const mark = p.guide ? el('span', { class: 'pill guide', text: t('Guide'), title: t('From the Divine Service Guide') }) : null;
      const emptied = () => { if (mark && emptyPoint(p)) { delete p.guide; mark.remove(); } };
      head.addEventListener('input', () => { p.heading = head.value; emptied(); touch(); });
      body.addEventListener('input', () => { p.body = body.value; emptied(); touch(); });
      pointsBox.append(el('div', { class: 'point' }, [
        el('div', { class: 'row line' }, [el('span', { class: 'step-n small', text: i + 1 }), head, mark,
          el('button', { class: 'icon del', type: 'button', 'aria-label': t('Remove this point'), text: '✕', onclick: () => { s.points.splice(i, 1); touch(); renderPoints(); } })]),
        body,
      ]));
    });
    // the Guide's main points, straight from its article, no Claude needed
    const link = Guides.findService(s);
    const fromGuide = link ? Guides.mainPoints(link.service) : [];
    pointsBox.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost', type: 'button', text: t('Add a point'), onclick: () => { s.points.push({ heading: '', body: '' }); touch(); renderPoints(); } }),
      fromGuide.length ? el('button', { class: 'btn small ghost', type: 'button', text: t('Take the main points from the Guide'), onclick: () => usePoints(fromGuide.map(p => ({ ...p, from: 'guide' })), t('Main points taken from the Guide.')) }) : null,
      fromGuide.length ? el('span', { class: 'muted small', text: tn(fromGuide.length, 'The Guide\'s article has {n} main point.', 'The Guide\'s article has {n} main points.') }) : null,
    ]));
  }
  renderPoints();
  container.append(
    pointsBox,
    field(t('Application for the congregation'), 'application', { rows: 4, placeholder: t('What does this ask of us this week? Name it for the people in front of you.') }),
    field(t('Conclusion'), 'conclusion', { rows: 3, placeholder: t('Gather the thoughts and lead to the altar: forgiveness, Holy Communion, the hope we share') }),
  );

  // ---- 5. illustrations
  container.append(step(5, t('Illustrations and experiences'), t('A true experience says more than an explanation. Bring one in from your notes, or write it here.'),
    () => clearStep(5, t('illustrations'), ['illustrations'])));
  const illus = field(t('Illustrations'), 'illustrations', { rows: 5, placeholder: t('A story, an experience, a picture that makes the point visible') });
  const illusArea = illus.querySelector('textarea');
  container.append(illus, el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: t('Insert from my notes'), onclick: () => pickNote(note => {
      const line = `${Notes.refLabel(note)}${note.title ? ' – ' + note.title : ''}: ${note.body}`;
      s.illustrations = (s.illustrations ? s.illustrations.trim() + '\n\n' : '') + line;
      illusArea.value = s.illustrations;
      fit(illusArea);
      touch();
    }) }),
  ]));

  // ---- output
  container.append(step('✓', t('Print or save'), t('The sermon notes carry everything above. The cue card is one page in large type for the pulpit.')));
  async function run(make, how) {
    try {
      await Cat.loadText().catch(() => false);
      const r = make(s);
      if (how === 'print') { Pdf.print(r); toast(t('Sending to the printer…')); }
      else if (how === 'share') Pdf.share(r).then(res => { if (res === 'downloaded') toast(t('Sharing is not available here, so the PDF was downloaded.')); });
      else { Pdf.download(r); toast(t('Saved ') + r.name); }
    } catch (e) { toast(e.message || t('The PDF could not be built.'), true); }
  }
  const out = el('div', { class: 'outputs' }, [
    el('button', { class: 'btn small', type: 'button', text: t('Sermon notes PDF'), onclick: () => run(Pdf.sermonPdf, 'download') }),
    el('button', { class: 'btn small', type: 'button', text: t('Cue card PDF'), onclick: () => run(Pdf.cueCardPdf, 'download') }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Print notes'), onclick: () => run(Pdf.sermonPdf, 'print') }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Print cue card'), onclick: () => run(Pdf.cueCardPdf, 'print') }),
    Pdf.canShare() ? el('button', { class: 'btn small ghost', type: 'button', text: t('Share notes'), onclick: () => run(Pdf.sermonPdf, 'share') }) : null,
  ]);
  container.append(out);

  // ---- 6. reflection
  container.append(step(6, t('After the service'), t('A few honest lines while it is fresh. They make the next preparation better.'),
    () => clearStep(6, t('after the service'), ['reflection'])));
  container.append(field(t('Reflection'), 'reflection', { rows: 4, placeholder: t('What spoke? What would you do differently? What did the congregation give back?') }));

  container.append(el('div', { class: 'row end' }, [
    el('button', { class: 'btn ghost danger', type: 'button', text: t('Delete this preparation'), onclick: async () => {
      if (await confirmBox(t('Delete this preparation and its notes? This cannot be undone.'), t('Delete'), true)) {
        await deleteSermon(s.id);
        toast(t('Preparation deleted.'));
        location.hash = '#prepare';
      }
    } }),
  ]));
}

/** The small mark on the button that asks Claude. */
function sparkle() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

function pickNote(onPick) {
  const sh = sheet(t('Insert a note'));
  const kinds = new Set(['experience', 'illustration']);
  const first = state.notes.filter(n => kinds.has(n.kind));
  const rest = state.notes.filter(n => !kinds.has(n.kind));
  if (!state.notes.length) sh.body.append(el('p', { class: 'muted', text: t('You have no notes yet. Write them in the reader: tap a verse, then "Note".') }));
  for (const n of [...first, ...rest]) {
    sh.body.append(el('button', { class: 'item pick', type: 'button', onclick: () => { sh.close(); onPick(n); } }, [
      el('div', { class: 'note-head' }, [el('b', { text: Notes.refLabel(n) }), el('span', { class: 'pill kind ' + n.kind, text: Notes.kindLabel(n.kind) })]),
      el('div', { class: 'small', text: (n.title ? n.title + ' – ' : '') + n.body.slice(0, 160) + (n.body.length > 160 ? '…' : '') }),
    ]));
  }
}

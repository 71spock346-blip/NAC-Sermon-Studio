/*
 * Prepare: a guided path from a Bible text to a divine service.
 *
 * One preparation is one service. Its steps follow the order of the Divine
 * Service Guide's article, so the person can go through the booklet and the
 * form side by side: 1 the text word (the Guide's Bible text), 2 the title
 * and message, 3 the introduction, 4 the main points, 5 the context (the
 * Guide's Context box, with the key words, the Catechism and the cross
 * references), 6 the summary and conclusion (the Guide's Summary, the
 * application, the conclusion); then the person's own 7 illustrations and
 * experiences, and 8 a reflection after the service. Everything saves as it
 * is typed. Two printed outputs come from it, in the same order: the full
 * sermon notes and cue cards for the pulpit.
 *
 * Helpers sit alongside the form. A loaded Divine Service Guide (guides.js)
 * fills each step from its part of the article in one tap and keeps the
 * article at hand under step 2. When the Guide is loaded in English and in
 * Afrikaans, step 2 also says which of the two the preparation follows and
 * moves it to the other (guides.js switchEdition), and the article can be
 * read in the other language to compare. Under step 2, "Break down the
 * article" asks Claude (ai.js) to take the article apart sentence by
 * sentence: what each one says in plain words, what it gives the sermon,
 * and the Bible passages and Catechism sections that bring depth to it.
 * The Guide's introduction can be read
 * under step 3, beside the person's own. "Suggest the sermon" under step 4
 * asks for the build itself: introduction, main points, application,
 * conclusion and illustrations; "Suggest answers" under step 5 asks for the
 * context of the text, key words, Catechism sections, cross references and
 * what the text gives each main point. Each suggestion comes with a
 * "Use" button, so nothing lands in the notes that the person did not choose,
 * and any suggestion can first be put into the person's own words in place:
 * a tap on its text (or its pencil) opens its words in growing boxes, what is
 * typed goes into the saved suggestion itself, so Use, "Use all" and the
 * study-sheet PDF carry the changed words, and it is kept with the
 * preparation (item() and piece() below).
 *
 * The main points always come from the Guide (guides.js mainPoints): a
 * preparation taken from a service starts with them, "Take the main points
 * from the Guide" under step 4 fetches them again, and Claude's points are
 * the Guide's in plain words, each going into its own box. A point from the
 * Guide carries a small "Guide" mark. Under each point the person can write
 * their own thought on it. Before "Suggest the sermon" builds anything,
 * Claude reads those thoughts (ai.js readThoughts) and, where one is unclear,
 * asks about it in a sheet; the questions and answers stay under the point
 * (p.talk), the sermon is then built with every thought woven in, and the
 * outline says where each one went. "Weave my thought into this point"
 * under a point does the same for that point alone (ai.js weaveThought): the
 * point's text comes back with the thought in it, under the point, and "Use"
 * puts it in place of what is there (undoable); the rest of the sermon stays.
 *
 * After the service, step 9 opens the reflection evening (reflect.js): slides
 * for the evening when the congregation looks back on the service and talks
 * about it, one question at a time, with notes for the one who leads it.
 * "Reflection evening" in the side menu (#reflect, renderReflect below) lists
 * the evenings and starts one from the Church's reflection guide (PDF).
 *
 * Three printed outputs come from a preparation (pdf.js): the sermon notes
 * (everything, in the order of the steps), the cue cards, and the sermon
 * itself in reading order, either as it stands in the boxes or, from the
 * outline's panel, as Claude built it. "Hear the sermon" under them has an
 * ElevenLabs voice read that same sermon aloud (speech.js), from the boxes
 * or, with the outline's own "Read aloud", as Claude built it; the recording
 * stays with the preparation on this device.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, debounce, nextSunday, today, fit, lineBox, busy, isTouch, seg } from './ui.js';
import { t, tn } from './i18n.js';
import { parseRef, formatRef } from './books.js';
import { state, saveSermon, deleteSermon } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as Notes from './notes.js';
import * as Pdf from './pdf.js';
import * as Guides from './guides.js';
import * as AI from './ai.js';
import * as Reflect from './reflect.js';
import * as Liturgy from './liturgy.js';
import * as Speech from './speech.js';
import { listenCard } from './listen.js';

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
/**
 * Every suggested main point carries its number (1, 2, 3 …). Suggestions kept
 * before the numbers came (October 2026) have none and read "undefined.", so
 * a missing number is taken from the point's place, once, and saved along.
 */
const numberPoints = a => { ((a && a.points) || []).forEach((p, i) => { if (p && !p.n) p.n = i + 1; }); return a; };
/** The "Read" button to a reference in the reader; null when the app did not understand the reference. */
const readLink = ref => (ref ? el('a', { class: 'btn small ghost', href: `#read/${ref.book}/${ref.chapter}${ref.verse ? '/' + ref.verse : ''}`, text: t('Read') }) : null);
/** The line under a panel's heading that says a suggestion can be changed before it is used. */
const howEdit = () => t('Tap a suggestion, or its pencil, to change its words first. "Use" then puts in your words.');
/** A thought on a main point as Claude last read it: the thought with the questions and answers about it, as one key (p.read). */
const thoughtKey = p => [norm(p.thought), ...(p.talk || []).map(e => `${norm(e && e.q)}>${norm(e && e.a)}`)].join('|');
/** True while some thought on a main point is new, or changed since Claude last read it. */
const unreadThoughts = s => (s.points || []).some(p => p && (p.thought || '').trim() && p.read !== thoughtKey(p));
/** The first words of a thought, to name it. */
const short = (text, n = 90) => { const v = String(text || '').trim().replace(/\s+/g, ' '); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };

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
    summary: '', application: '', illustrations: '', conclusion: '', reflection: '', status: 'draft',
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
  // the Guide has an article on this text: its message and notes come along (from the Guide in the usual language, when both are loaded)
  const m = Guides.matchService(ref, AI.langOf(null));
  if (m) Guides.prefill(s, m.guide, m.i, { fresh: true });
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

/** A preparation started from a service in a loaded Guide; the sermon is in the Guide's language. */
export async function newFromService(guide, i) {
  await Cat.load().catch(() => {});
  const s = blank();
  Guides.prefill(s, guide, i, { force: true, fresh: true, lang: true });
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
    if (s) {
      if (Guides.upgrade(s)) saveSermon(s).catch(() => {});   // made before the Guide's Context and Summary had steps of their own
      return renderEditor(container, s);
    }
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
        Reflect.hasSlides(s) ? el('span', { class: 'pill kind slides', text: t('Slides') }) : null,
        el('span', { class: 'pill status ' + (s.status || 'draft'), text: t(STATUS_LABEL[s.status] || 'Draft') }),
      ]));
    }
  }
  search.addEventListener('input', show);
  container.append(
    Liturgy.shortcut(),   // on a phone only: the words at the altar, which the bar has no tab for
    el('div', { class: 'docbar' }, [
      el('h2', { text: t('Service preparations ({n})', { n: state.sermons.length }) }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small', type: 'button', text: t('New preparation'), onclick: () => newBlank() }),
    ]),
    el('p', { class: 'muted small', text: t('Each card is one divine service: the text word, the message from the Divine Service Guide, your own thoughts, and the printed sermon notes and cue card.') }),
    ...[Guides.card({ onPrepare: newFromService, onChange: () => renderList(clear(container)) })].filter(Boolean),   // null on a locked device without a Guide (lock.js)
    search, list);
  show();
}

async function newBlank() {
  const s = blank();
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

/* ---------------------------------------------------------------- reflection evenings */

/**
 * "Reflection evening" in the side menu (#reflect): load the Church's
 * reflection guide (the service it looks back on is found among the
 * preparations, or added), or open the slides of a service. #reflect/<id> is
 * the evening of one preparation (reflect.js).
 */
export function renderReflect(container, route) {
  clear(container);
  if (route[1]) {
    const s = state.sermons.find(x => x.id === route[1]);
    if (s) {
      if (Guides.upgrade(s)) saveSermon(s).catch(() => {});
      return Reflect.render(container, s);
    }
    toast(t('That preparation was not found.'), true);
    location.hash = '#reflect';
    return;
  }
  const picker = Reflect.pdfPicker(async file => {
    const g = await Reflect.readPdf(file);
    if (g) await newFromReflection(g);
  });
  const item = s => el('a', { class: 'item sermon', href: `#reflect/${s.id}` }, [
    el('div', { class: 'when' }, [el('b', { text: fmtDate(s.date, true) || t('No date') }), el('span', { class: 'muted small', text: [s.congregation, t(s.occasion)].filter(Boolean).join(' · ') })]),
    el('div', { class: 'grow' }, [
      el('div', { class: 'ref', text: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || t('No text word yet')) }),
      el('div', { class: 'muted small', text: s.title || s.theme || '' }),
    ]),
    Reflect.hasSlides(s) ? el('span', { class: 'pill kind slides', text: t('Slides') }) : null,
  ]);
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Reflection evenings') })]),
    el('p', { class: 'muted small', text: t('Slides for an evening when the congregation looks back on a divine service: the sermon and its text word, the main points from the Guide, and the questions one by one, with notes for the one who leads the evening.') }),
    ...[AI.unlocked() ? el('div', { class: 'page reflect-hub' }, [
      el('div', { class: 'row' }, [el('button', { class: 'btn ai-btn', type: 'button', onclick: picker.pick }, [sparkle(), t('Load the reflection guide (PDF)')]), picker.input]),
      el('p', { class: 'muted small', text: t('Claude reads the Church\'s guide for the evening: the title, the text word and the questions. The service it looks back on is found among your preparations, or added to them.') }),
    ]) : null].filter(Boolean));   // reading the Church's guide is Claude's work, the minister's own (lock.js); a locked device makes the slides from the preparation
  // the evenings with slides first, then the latest services held; the search finds any preparation
  const made = state.sermons.filter(Reflect.hasSlides);
  if (made.length) container.append(el('h3', { class: 'sub', text: t('Your slides') }), el('div', { class: 'list' }, made.map(item)));
  const search = el('input', { type: 'search', placeholder: t('Search by text, congregation or theme…'), 'aria-label': t('Search preparations'), autocomplete: 'off' });
  const list = el('div', { class: 'list' });
  const now = today();
  function show() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const items = q
      ? state.sermons.filter(s => [s.refText, s.congregation, s.theme, s.title, s.occasion, s.date].join(' ').toLowerCase().includes(q)).slice(0, 50)
      : state.sermons.filter(s => s.date && s.date <= now && !Reflect.hasSlides(s)).slice(0, 10);   // the latest services held, newest first
    if (!items.length) list.append(el('p', { class: 'muted', text: q ? t('Nothing matches.') : state.sermons.length ? t('No other services held yet.') : t('No services yet. Load the reflection guide above, or start a preparation under Prepare.') }));
    for (const s of items) list.append(item(s));
  }
  search.addEventListener('input', show);
  container.append(el('h3', { class: 'sub', text: made.length ? t('Or choose another service') : t('Or choose the service') }), search, list);
  show();
}

/** The occasion of a preparation from the service a reflection guide names. */
function occasionFrom(name) {
  const v = String(name || '').toLowerCase();
  if (/departed|ontslape/.test(v)) return 'Divine service for the departed';
  if (/midweek|weekdiens/.test(v)) return 'Midweek divine service';
  if (/youth|jeug|jongmense/.test(v)) return 'Youth service';
  if (/child|kinder/.test(v)) return 'Children\'s service';
  if (/funeral|begrafnis/.test(v)) return 'Funeral service';
  if (/wedding|huwelik|troue/.test(v)) return 'Wedding';
  return OCCASIONS[0];
}

/**
 * The preparation a reflection guide looks back on: the one of that day
 * (with the same text, when there are several), else a new one, filled from
 * the month's Guide when it is loaded, so the main points are the Guide's.
 * The guide's title, text and questions go onto its evening; then the
 * evening opens.
 */
export async function newFromReflection(g) {
  const ref = Guides.refOf({ reference: g.reference });
  const sameText = x => ref && x.ref && x.ref.book === ref.book && x.ref.chapter === ref.chapter;
  const day = g.date ? state.sermons.filter(x => x.date === g.date) : state.sermons.filter(x => sameText(x) && norm(x.title) === norm(g.title));
  let s = day.find(sameText) || day.find(x => norm(x.title) && norm(x.title) === norm(g.title)) || day[0] || null;
  if (s) toast(t('Your preparation for {date} is used for the slides.', { date: fmtDate(s.date, true) }));
  else {
    await Cat.load().catch(() => {});
    s = blank();
    s.status = 'held';
    if (g.date) s.date = g.date;
    // the same service in a loaded Guide: on that day (with that text), the Guide in the language of the reflection guide first
    let m = null;
    for (const guide of Guides.all().sort((a, b) => (a.language === g.language ? 0 : 1) - (b.language === g.language ? 0 : 1))) {
      const i = guide.services.findIndex(x => g.date && x.date === g.date && (!ref || !Guides.refOf(x) || Guides.refOf(x).book === ref.book));
      if (i >= 0) { m = { guide, i }; break; }
    }
    if (m) {
      Guides.prefill(s, m.guide, m.i, { force: true, fresh: true, lang: true });
      for (const c of sectionsForRef(s.ref).slice(0, 12)) if (!s.catechism.find(x => x.n === c.n)) s.catechism.push({ n: c.n, title: c.title });
    } else {
      s.title = g.title || '';
      s.occasion = occasionFrom(g.service);
      s.ref = ref;
      s.refText = ref ? formatRef(ref, state.settings.bookLang) : (g.reference || '');
      s.text = g.bibleText || '';
      s.translationId = '';
      s.translation = '';
      if (g.language === 'en' || g.language === 'af') s.lang = g.language;
    }
    toast(t('The service of {date} is added to your preparations, marked as held.', { date: fmtDate(s.date, true) }));
  }
  Reflect.fromGuide(s, g);
  await saveSermon(s);
  location.hash = `#reflect/${s.id}`;
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
  let sermonCard = null;   // the player under Print or save (listen.js): it says when the sermon has changed since it was read
  const touch = () => { save(); if (sermonCard) sermonCard.check(); };
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
  humourSel.hidden = !AI.unlocked();   // humour steers Claude's suggestions only: nothing to choose where the helper is locked (lock.js)
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
    el('p', { class: 'muted small who-hint', text: AI.unlocked()
      ? t('Claude shapes its suggestions for these people, in the language chosen. For an ordinary Sunday, leave it as it is. The age group and the people are remembered for your next preparation in this congregation.')
      : t('The line about the people heads the sermon notes, and the language sets the Guide and the slides. The age group and the people are remembered for your next preparation in this congregation.') }),
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

  // ---- 2. the title and message, as the Guide prints them under its Bible text; the Guide's article is at hand here
  container.append(step(2, t('Title and message'), t('As the Guide gives them: first the title, then the message. Then write the core thought in your own words. The Guide gives the direction; the sermon is how it reaches this congregation.'),
    () => clearStep(2, t('the title and message'), ['title', 'theme', 'core', 'guide'])));
  const guideBox = el('div', { class: 'guide-row' });
  container.append(guideBox);
  function renderGuide() {
    clear(guideBox);
    const link = Guides.findService(s);
    const pick = () => Guides.picker(s, async (guide, i) => {
      const filled = !!((s.theme || '').trim() || (s.guide || '').trim() || (s.text || '').trim() || (s.title || '').trim());
      const replace = !filled || await confirmBox(t('Replace the text word, title and message with this service\'s? Its context and summary come in too, where you have not changed them. Your other notes stay as they are.'), t('Replace'), true);
      Guides.prefill(s, guide, i, { force: replace, lang: replace });
      await saveSermon(s);
      toast(replace ? t('Taken from the Guide.') : t('Linked to the Guide; what you had written was kept.'));
      render(clear(root), ['prepare', s.id]);
    });
    if (link) {
      // the same service in the Guide's other language (English or Afrikaans), when that Guide is loaded too
      const twin = Guides.partnerOf(link.guide, link.i);
      const art = el('div', { class: 'guide-art', hidden: true });
      let reading = link;   // the Guide the article is read in: this preparation's, or the other language's to compare
      const drawArt = () => {
        clear(art);
        art.append(Guides.article(reading.service, reading.guide));
        if (!twin) return;
        const other = reading === link ? twin : link;
        art.append(el('div', { class: 'row guide-other' }, [el('button', { class: 'btn small ghost', type: 'button', text: other.guide.language === 'af' ? t('Read it in Afrikaans') : t('Read it in English'), onclick: () => { reading = other; drawArt(); } })]));
      };
      const readBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Read the article'), 'aria-expanded': 'false', onclick: () => {
        if (art.hidden) { if (!art.firstChild) drawArt(); art.hidden = false; readBtn.textContent = t('Hide the article'); readBtn.setAttribute('aria-expanded', 'true'); }
        else { art.hidden = true; readBtn.textContent = t('Read the article'); readBtn.setAttribute('aria-expanded', 'false'); }
      } });
      /** This preparation follows the other language's Guide from now on (Guides.switchEdition), after asking. */
      async function follow() {
        const af = twin.guide.language === 'af';
        const ok = await confirmBox(af
          ? t('Use the Afrikaans Guide for this preparation? Where a box still holds the Guide\'s own words, the Afrikaans words come in: the text, title, message, main points, context and summary. What you wrote yourself stays. The sermon becomes Afrikaans, so Claude\'s suggestions come in Afrikaans.')
          : t('Use the English Guide for this preparation? Where a box still holds the Guide\'s own words, the English words come in: the text, title, message, main points, context and summary. What you wrote yourself stays. The sermon becomes English, so Claude\'s suggestions come in English.'),
        af ? t('Use the Afrikaans Guide') : t('Use the English Guide'));
        if (!ok) { renderGuide(); return; }   // the switch goes back to the Guide followed now
        const r = Guides.switchEdition(s);
        if (!r) { toast(t('This service was not found in the other Guide.'), true); renderGuide(); return; }
        await saveSermon(s);
        toast((af ? t('This preparation now follows the Afrikaans Guide.') : t('This preparation now follows the English Guide.'))
          + (r.points ? '' : ' ' + t('The main points stay as they were: the two Guides do not have the same parts.')));
        render(clear(root), ['prepare', s.id]);
      }
      const both = twin ? [link, twin].sort((a, b) => (a.guide.language === 'en' ? 0 : 1) - (b.guide.language === 'en' ? 0 : 1)) : [];
      // the article read by an ElevenLabs voice (speech.js, listen.js), in the Guide's language; the recording stays with this Guide on this device
      const hear = listenCard({
        title: t('Hear the Guide'), id: Speech.guideKey(link.guide, link.i), quiet: true,
        noKey: t('An ElevenLabs voice can read the Guide\'s article to you. Add your ElevenLabs key under Settings → Read aloud first.'),
        empty: t('There is nothing to read in this article.'),
        script: () => Speech.guideScript(link.service, link.guide),
        read: (opts, o) => Speech.makeGuide(link.service, link.guide, o),
        fileName: rec => Speech.fileName(link.service.date, `${t('Guide')}-${rec.title}`),
        from: () => t('from the Guide'),
        stale: t('The article has changed since this was read.'),
        reading: t('Reading the Guide aloud'), ready: t('The Guide is ready to hear.'), failed: t('The Guide could not be read.'),
      });
      guideBox.append(...[
        el('div', { class: 'row line guide-link guide-from' }, [
          el('span', { class: 'small grow' }, [el('b', { text: t('From the Guide: ') }), `${link.service.dateText || fmtDate(link.service.date)} · ${link.service.title || link.service.label}`]),
          readBtn,
          el('button', { class: 'btn small ghost', type: 'button', text: t('Change'), onclick: pick }),
        ]),
        twin ? el('div', { class: 'row line guide-lang' }, [
          el('span', { class: 'small', text: t('The Guide in:') }),
          seg(both.map(x => [x.guide.id, Guides.editionLabel(x.guide)]), link.guide.id, id => { if (id !== link.guide.id) follow(); }, { label: t('Language of the Guide') }),
        ]) : null,
        art,
        hear.box,
      ].filter(Boolean));
    } else if (Guides.all().length) {
      guideBox.append(el('div', { class: 'row' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: t('Take the message from the Guide'), onclick: pick }),
        el('span', { class: 'muted small', text: t('Fills the text word, title, message, main points, context and summary from the loaded Guide\'s article.') }),
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
          readLink(x.ref),
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
    // the Guide's words stay as they are; the plain words and the insight can be put into the person's own
    const node = el('div', { class: 'ai-item bd-item editable' });
    const use = after => el('button', { class: 'btn small ghost', type: 'button', text: t('Use'), onclick: () => { add('guide', pieceLine(p)); toast(t('Added to Notes from the Guide.')); if (after) after(); } });
    const refBox = () => (refs.length ? el('div', { class: 'bd-refs' }, refs) : null);
    function show() {
      clear(node);
      node.classList.remove('editing');
      const text = el('div', { class: 'ai-text' }, [
        el('div', { class: 'bd-quote', text: p.quote }),
        p.said ? el('div', { class: 'bd-line' }, [el('b', { text: t('In plain words: ') }), p.said]) : null,
        p.insight ? el('div', { class: 'bd-line' }, [el('b', { text: t('For the sermon: ') }), p.insight]) : null,
        refBox(),
      ]);
      // a tap on the text opens the boxes, unless it is on a button or text is being selected; on a phone the keyboard waits for a tap in a box
      text.addEventListener('click', e => { if (e.target.closest('a, button') || String(getSelection()).length) return; open(!isTouch()); });
      node.append(text, el('div', { class: 'ai-actions' }, [pencil(() => open(true)), use()]));
    }
    function open(focus) {
      clear(node);
      node.classList.add('editing');
      const said = editBox(p, 'said');
      const wrap = el('div', { class: 'ai-edit' }, [
        el('div', { class: 'bd-quote', text: p.quote }),
        el('label', { class: 'ai-field' }, [el('span', { class: 'ai-label', text: t('In plain words: ').trim() }), said]),
        el('label', { class: 'ai-field' }, [el('span', { class: 'ai-label', text: t('For the sermon: ').trim() }), editBox(p, 'insight')]),
        refBox(),
      ]);
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); show(); } });
      node.append(wrap, el('div', { class: 'ai-actions' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Done'), onclick: show }), use(show)]));
      if (focus) toEnd(said);
    }
    show();
    return node;
  }
  function renderBreak() {
    clear(breakBox);
    const a = s.breakdown;
    breakBox.hidden = !AI.unlocked() || (!a && !Guides.findService(s));   // the helper is locked here (lock.js), or no article to break down and nothing kept
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
    panel.append(el('p', { class: 'muted small ai-how', text: t('"Use" puts a piece into Notes from the Guide; the passages go to Cross references; ticked sections print.') + ' ' + howEdit() }));
    if (a.thread) panel.append(group(t('The thread'), [item('', () => a.thread, () => { add('core', a.thread); toast(t('Added to Core thought.')); }, null, null, { on: a, body: 'thread' })], null, t('What the whole article drives at.')));
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
    field(t('Sermon title (optional)'), 'title', { line: true, placeholder: t('A heading for your notes') }),
    field(t('Message of the service'), 'theme', { line: true, placeholder: t('The theme in one sentence') }),
    field(t('Core thought'), 'core', { rows: 2, placeholder: t('The one thing the congregation should take home') }),
    field(t('Notes from the Guide'), 'guide', { rows: 5, placeholder: t('Key thoughts from the Guide, in your own words. Which sentences struck you? What should be kept?') }),
  );

  // ---- 3. the introduction: the sermon opens as the Guide's article does; the Guide's own introduction can be read beside it
  container.append(step(3, t('Introduction'), t('As in the Guide, the sermon opens with an introduction. Make the people feel welcome and open the door to the text.'),
    () => clearStep(3, t('the introduction'), ['intro'])));
  const introLink = Guides.findService(s);
  const guideIntro = introLink ? (introLink.service.introduction || '').trim() : '';
  if (guideIntro) {
    const art = el('div', { class: 'guide-art', hidden: true });
    const readBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Read'), 'aria-expanded': 'false', onclick: () => {
      if (art.hidden) { if (!art.firstChild) art.append(Guides.articlePart(guideIntro)); art.hidden = false; readBtn.textContent = t('Hide'); readBtn.setAttribute('aria-expanded', 'true'); }
      else { art.hidden = true; readBtn.textContent = t('Read'); readBtn.setAttribute('aria-expanded', 'false'); }
    } });
    container.append(el('div', { class: 'guide-row' }, [
      el('div', { class: 'row line guide-link' }, [el('span', { class: 'small grow' }, [el('b', { text: t('The Guide\'s introduction') })]), readBtn]),
      art,
    ]));
  }
  container.append(field(t('Your introduction'), 'intro', { rows: 4, placeholder: t('How you will begin: a question, a picture from daily life, the setting of the text') }));

  // ---- 4. the main points: the parts of the Guide's article, in its order (they always come from the Guide)
  container.append(step(4, t('Main points'), AI.unlocked()
    ? t('The parts of the Guide\'s article, each under its own heading, are main point 1, 2, 3, in the Guide\'s order. Each point stands on the text. Plain words, short sentences. Under each point you can write your own thought on it. "Weave my thought into this point" puts it into that point only and leaves the rest as it is; "Suggest the sermon" weaves all your thoughts into the whole sermon. Claude asks you first when something is unclear.')
    : t('The parts of the Guide\'s article, each under its own heading, are main point 1, 2, 3, in the Guide\'s order. Each point stands on the text. Plain words, short sentences.'),
    () => clearStep(4, t('the main points'), [], {
      clear: () => { const kept = s.points || []; s.points = [{ heading: '', body: '' }]; renderPoints(); return kept; },
      restore: kept => { s.points = kept; renderPoints(); },
    })));
  const buildBox = el('div', { class: 'ai-box build-box' });
  container.append(buildBox);
  async function askBuild() {
    if (!AI.ready()) { Guides.noKey(); return; }
    if (!s.ref && !(s.text || '').trim()) { toast(t('Give the text word first: a reference or the text itself.'), true); return; }
    const link = Guides.findService(s);
    const from = { service: link ? link.service : null, guideTitle: link ? link.guide.title : '' };
    // a thought on a main point that Claude has not read yet: it is read first, and asked about where it is unclear
    if (unreadThoughts(s) && !await readThoughts(from)) return;
    const thoughts = (s.points || []).some(p => p && (p.thought || '').trim());
    const who = t(AI.audienceLabel(AI.audienceOf(s))).toLowerCase();
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(thoughts
      ? t('Claude is building the sermon from the text, the message, the Guide\'s main points, your notes and the Catechism sections, for {who}, with your thoughts on the main points woven in. This takes about a minute.', { who })
      : t('Claude is building the sermon from the text, the message, the Guide\'s main points, your notes and the Catechism sections, for {who}. This takes about a minute.', { who }));
    try {
      const out = await AI.outline(s, {
        ...from,
        signal: ctrl.signal, onProgress: n => b.say(t('Writing the outline… {k}k letters so far.', { k: Math.round(n / 100) / 10 })),
      });
      s.build = out;
      keepQuestions(out.thoughts);
      await saveSermon(s);
      b.done();
      renderBuild();
      renderPoints();
      toast(thoughts ? t('The outline is ready, with your thoughts woven in. Tap "Use" on the parts to keep.') : t('The outline is ready. Tap "Use" on the parts to keep.'));
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return; }
      b.fail(e.message || t('Claude could not answer.'));
    }
  }
  /**
   * Claude reads the thoughts on the main points (ai.js readThoughts) and,
   * where one is unclear, asks about it in a sheet. The questions go under
   * their points, with the answers typed in the sheet, and each thought is
   * marked as read with them (p.read), so the next "Suggest the sermon"
   * reads only what has changed. Resolves false when the sermon should not
   * be built now: the request failed or was cancelled, or the person chose
   * to answer later.
   */
  async function readThoughts(from) {
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(t('Claude is reading your thoughts on the main points first, to see where each one fits. About half a minute.'));
    let read;
    try {
      read = await AI.readThoughts(s, { ...from, signal: ctrl.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return false; }
      b.fail(e.message || t('Claude could not answer.'));
      return false;
    }
    b.done();
    const asks = [];
    for (const r of read.thoughts) {
      const p = s.points[r.i];
      if (!p) continue;
      p.talk = (p.talk || []).filter(e => e && (e.a || '').trim());   // an open question is Claude's to ask again, or to let go
      if (r.question) { const e = { q: r.question, a: '' }; p.talk.push(e); asks.push({ p, i: r.i, e }); }
    }
    const markRead = () => { for (const p of s.points) if (p && (p.thought || '').trim()) p.read = thoughtKey(p); };
    markRead();
    await saveSermon(s);
    renderPoints();
    if (!asks.length) return true;
    const go = await askThoughts(asks);
    markRead();   // the answers go along with the build; what Claude still asks comes back with the outline
    await saveSermon(s);
    renderPoints();
    if (!go) toast(t('The questions are kept under the main points. Answer them when you like, then tap "Suggest the sermon" again.'));
    return go;
  }
  /**
   * The sheet with Claude's questions about the thoughts, each with a box for
   * the answer. Resolves true to go on now: to build the sermon, or with
   * `one`, to weave the one thought into its point.
   */
  function askThoughts(asks, { one = false } = {}) {
    return new Promise(resolve => {
      const sh = sheet(one ? t('Claude asks about your thought') : t('Claude asks about your thoughts'), { sticky: true, onclose: () => resolve(false) });
      sh.body.append(el('p', { class: 'small', text: one
        ? t('Answer in a few words, as you would say it to a friend. Claude then weaves your thought into this point. A question you leave open stays under the point.')
        : t('Answer in a few words, as you would say it to a friend. Claude then builds the sermon with your thoughts in it. A question you leave open stays under its main point.') }));
      for (const { p, i, e } of asks) {
        const box = el('textarea', { rows: 2, placeholder: t('Your answer'), 'aria-label': t('Your answer') });
        box.value = e.a || '';
        box.addEventListener('input', () => { e.a = box.value; touch(); });
        sh.body.append(el('div', { class: 'talk-ask' }, [
          el('p', { class: 'muted small talk-where', text: t('Your thought on main point {n}{heading}:', { n: i + 1, heading: (p.heading || '').trim() ? ', ' + p.heading.trim() : '' }) }),
          el('p', { class: 'talk-thought', text: p.thought.trim() }),
          el('p', { class: 'talk-q' }, [el('b', { text: t('Claude asks: ') }), e.q]),
          box,
        ]));
      }
      sh.body.append(el('div', { class: 'row end' }, [
        el('button', { class: 'btn ghost', type: 'button', text: t('Not now'), onclick: () => sh.close() }),
        el('button', { class: 'btn', type: 'button', text: one ? t('Weave it in') : t('Build the sermon'), onclick: () => { resolve(true); sh.close(true); } }),
      ]));
      const first = sh.body.querySelector('textarea');
      if (first && !isTouch()) setTimeout(() => first.focus(), 30);
    });
  }
  /** A thought the outline still found unclear: Claude's question goes under that main point, for the next time. */
  function keepQuestions(list) {
    for (const r of list || []) {
      const p = s.points[r.i];
      if (!p || !r.question) continue;
      p.talk = (p.talk || []).filter(e => e && (e.a || '').trim());
      p.talk.push({ q: r.question, a: '' });
    }
  }
  function renderBuild() {
    clear(buildBox);
    buildBox.hidden = !AI.unlocked();   // the helper is locked here (lock.js): the outline waits, unseen, for the password
    if (buildBox.hidden) return;
    const a = s.build;
    const btn = el('button', { class: 'btn small ai-btn', type: 'button', onclick: askBuild }, [sparkle(), a ? t('Suggest again') : t('Suggest the sermon')]);
    const drop = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: () => {
      s.build = null; touch(); renderBuild();
      toast(t('Outline removed.'), false, () => { s.build = a; touch(); renderBuild(); });
    } }) : null;
    // the outline as one sermon to read, with the illustrations under the points they serve (pdf.js sermonTextPdf)
    const pdf = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Save as PDF'), onclick: () => run(x => Pdf.sermonTextPdf(x, { outline: a }), 'download') }) : null;
    const printBtn = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Print'), onclick: () => run(x => Pdf.sermonTextPdf(x, { outline: a }), 'print') }) : null;
    const hear = a ? el('button', { class: 'btn small ghost', type: 'button', text: t('Read aloud'), onclick: () => { if (sermonCard) sermonCard.read({ outline: a }); } }) : null;   // the voice reads the outline as one sermon (speech.js)
    buildBox.append(el('div', { class: 'row ai-head' }, [btn, drop, pdf, printBtn, hear, el('span', { class: 'muted small grow', text: a
      ? t('Suggested {date} by {model}{who}{cost}. A starting point: the sermon is yours.', { date: fmtDate(a.at), model: AI.modelLabel(a.model), who: a.audience ? t(', for {who}', { who: t(AI.audienceLabel(a.audience)).toLowerCase() }) : '', cost: a.cost ? ', ' + AI.fmtCost(a.cost) : '' })
      : t('Claude proposes how to build this sermon from the text, the message, your notes and your thoughts on the main points, for the people above and in your way: an introduction, the main points as the Guide gives them, the application, the conclusion, illustrations and, where it fits, a lighter moment, each with a line on why it works. You choose what to keep.') })]));
    if (!a) return;
    const panel = el('details', { class: 'ai-panel', open: true });
    panel.append(el('summary', { text: t('The outline') }));
    if (a.note) panel.append(el('p', { class: 'small ai-note', text: a.note }));
    panel.append(el('p', { class: 'muted small ai-how', text: howEdit() + ' ' + t('"Save as PDF" and "Print" give the whole outline as one sermon to read.') + ' ' + t('"Read aloud" has a voice read it to you.') }));
    if ((a.thoughts || []).length) {
      // where each of the person's thoughts went; a question still open is answered under the point itself
      panel.append(group(t('Your thoughts'), a.thoughts.map(x => el('div', { class: 'ai-item' }, [el('div', { class: 'ai-text' }, [
        el('b', { text: t('Your thought on main point {n}', { n: x.n }) + ': ' }), `“${short(x.thought)}”`,
        el('div', { class: 'ai-went' }, [el('b', { text: t('Where it went: ') }), x.how || x.where]),
        x.question ? el('div', { class: 'ai-went' }, [el('b', { text: t('Claude asks: ') }), x.question, ' ', el('span', { class: 'muted', text: t('Answer it under main point {n}, then tap "Suggest again".', { n: x.n }) })]) : null,
      ])])), null, t('Where each of your thoughts went, and how.')));
    }
    if (a.intro && a.intro.text) {
      panel.append(group(t('Introduction'), [item('', () => a.intro.text, () => { add('intro', a.intro.text); toast(t('Added to Introduction.')); }, null, a.intro.why, { on: a.intro, body: 'text' })]));
    }
    panel.append(group(t('Main points'), [...pointNotes(a), ...pointItems(a)], (a.points || []).length > 1 ? () => usePoints(a.points) : null, pointsHint(a, true)));
    panel.append(group(t('Application and conclusion'), [
      a.application ? item(t('Application'), () => a.application, () => { add('application', a.application); toast(t('Added to Application.')); }, null, null, { on: a, body: 'application' }) : null,
      a.conclusion ? item(t('Conclusion'), () => a.conclusion, () => { add('conclusion', a.conclusion); toast(t('Added to Conclusion.')); }, null, null, { on: a, body: 'conclusion' }) : null,
    ].filter(Boolean)));
    const illLine = x => `${x.title ? x.title + ': ' : ''}${x.body}`;
    panel.append(group(t('Illustrations'), (a.illustrations || []).map(x => item(() => x.title, () => x.body, () => { add('illustrations', illLine(x)); toast(t('Added to Illustrations under step 7.')); }, null, x.serves ? t('For {part}.', { part: x.serves }) : '', { on: x, title: 'title', body: 'body' })),
      (a.illustrations || []).length > 1 ? () => { add('illustrations', a.illustrations.map(illLine).join('\n\n')); toast(t('All illustrations added under step 7.')); } : null, t('They go into the Illustrations box under step 7.')));
    if (a.lighter && a.lighter.text) {
      // the light moment goes where Claude placed it: the introduction, the conclusion, or else among the illustrations
      const where = a.lighter.where || '';
      const key = /intro|inleiding|open/i.test(where) ? 'intro' : /conclu|slot|close|end/i.test(where) ? 'conclusion' : 'illustrations';
      const box = { intro: t('Introduction'), conclusion: t('Conclusion'), illustrations: t('Illustrations under step 7') }[key];
      panel.append(group(t('A lighter moment'), [item('', () => a.lighter.text, () => { add(key, a.lighter.text); toast(t('Added to {box}.', { box })); }, null, where ? t('For {part}.', { part: where }) : '', { on: a.lighter, body: 'text' })],
        null, t('A smile where it fits. Yours to use or to leave.')));
    }
    buildBox.append(panel);
  }
  renderBuild();
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
      // the person's own thought on this point: Claude weaves it into the sermon, and asks here when it is unclear
      const thought = el('textarea', { rows: 1, placeholder: t('A story, a picture, a question, something that struck you. Claude weaves it into the sermon, and asks if something is unclear.') });
      thought.value = p.thought || '';
      thought.addEventListener('input', () => { p.thought = thought.value; touch(); });
      const talk = el('div', { class: 'talk' });
      const drawTalk = () => { clear(talk); for (const e of p.talk || []) if (e && e.q) talk.append(talkRow(p, e, drawTalk)); };
      drawTalk();
      // this thought into this point only, by Claude; what comes back waits under the point for "Use"
      const weaveBtn = el('button', { class: 'btn small ghost ai-btn weave-btn', type: 'button', onclick: () => weave(p, thought) }, [sparkle(), p.weave ? t('Weave again') : t('Weave my thought into this point')]);
      const woven = p.weave ? weavePanel(p, i) : null;
      if (woven) thought.addEventListener('input', woven.stale);
      const open = AI.unlocked();   // the thought, Claude's questions and the weave belong to the helper (lock.js); locked, the point is just its text
      pointsBox.append(el('div', { class: 'point' }, [
        el('div', { class: 'row line' }, [el('span', { class: 'step-n small', text: i + 1 }), head, mark,
          el('button', { class: 'icon del', type: 'button', 'aria-label': t('Remove this point'), text: '✕', onclick: () => { s.points.splice(i, 1); touch(); renderPoints(); } })]),
        body,
        open ? el('label', { class: 'f thought' }, [title(t('My thought on this point')), thought]) : null,
        open ? talk : null,
        open ? el('div', { class: 'row weave-row' }, [weaveBtn]) : null,
        open && woven ? woven.node : null,
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
  container.append(pointsBox);
  /**
   * Claude weaves the person's thought on one main point into that point
   * only (ai.js weaveThought). Where the thought is unclear, Claude asks
   * first, in the same sheet as for the whole sermon; the answer is kept
   * under the point and the weave runs again with it. What comes back waits
   * under the point (p.weave) until "Use" or "Remove". `box` is the
   * thought's box, focused when it is still empty.
   */
  async function weave(p, box) {
    const i = s.points.indexOf(p);
    if (i < 0) return;
    if (!(p.thought || '').trim()) { toast(t('Write your thought on this point first.'), true); if (box) toEnd(box); return; }
    if (!AI.ready()) { Guides.noKey(); return; }
    const link = Guides.findService(s);
    const from = { service: link ? link.service : null, guideTitle: link ? link.guide.title : '' };
    const ctrl = new AbortController();
    const b = busy(t('Asking Claude'), () => ctrl.abort());
    b.say(t('Claude is weaving your thought into main point {n}. Only this point is written again. About half a minute.', { n: i + 1 }));
    let r;
    try {
      r = await AI.weaveThought(s, i, { ...from, signal: ctrl.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') { b.done(); return; }
      b.fail(e.message || t('Claude could not answer.'));
      return;
    }
    if (!r.clear && !r.question) { b.fail(t('Claude could not answer.')); return; }
    b.done();
    p.talk = (p.talk || []).filter(e => e && (e.a || '').trim());   // an open question is Claude's to ask again, or to let go
    if (!r.clear) {
      const e = { q: r.question, a: '' };
      p.talk.push(e);
      p.read = thoughtKey(p);
      await saveSermon(s);
      renderPoints();
      const go = await askThoughts([{ p, i, e }], { one: true });
      p.read = thoughtKey(p);
      await saveSermon(s);
      renderPoints();
      if (go) { weave(p); return; }
      toast(t('The question is kept under the point. Answer it when you like, then tap "Weave my thought into this point" again.'));
      return;
    }
    p.weave = { at: r.at, model: r.model, cost: r.cost, body: r.body, how: r.how, note: r.note, thought: norm(p.thought) };
    p.read = thoughtKey(p);   // Claude has seen this thought, so "Suggest the sermon" does not read it again
    await saveSermon(s);
    renderPoints();
    toast(t('Your thought is woven into main point {n}. Read it under the point, and tap "Use" to put it in.', { n: i + 1 }));
  }
  /**
   * What Claude made of the thought on point i: the point's text with the
   * thought in it (editable in place, like every suggestion), where the
   * thought went, Use and Remove. `stale` shows a line when the thought has
   * changed since; it runs as the thought is typed.
   */
  function weavePanel(p, i) {
    const w = p.weave;
    const remove = el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: () => {
      delete p.weave; touch(); renderPoints();
      toast(t('Suggestion removed.'), false, () => { p.weave = w; touch(); renderPoints(); });
    } });
    const changed = el('p', { class: 'small ai-note weave-stale', text: t('Your thought has changed since. Tap "Weave again" to weave in the new words.') });
    const stale = () => { changed.hidden = norm(p.thought) === w.thought; };
    stale();
    const node = el('div', { class: 'ai-panel weave' }, [el('div', { class: 'ai-sec' }, [
      el('div', { class: 'row line ai-sec-head' }, [el('h4', { text: t('Main point {n} with your thought', { n: i + 1 }) }), el('span', { class: 'grow' }), remove]),
      changed,
      w.note ? el('p', { class: 'small ai-note', text: w.note }) : null,
      item('', () => w.body, () => useWeave(p), null, () => (w.how ? t('Where it went: ') + w.how : ''), { on: w, body: 'body' }),
      el('p', { class: 'muted small weave-meta', text: t('Suggested {date} by {model}{who}{cost}. A starting point: the sermon is yours.', { date: fmtDate(w.at), model: AI.modelLabel(w.model), who: '', cost: w.cost ? ', ' + AI.fmtCost(w.cost) : '' }) }),
    ])]);
    return { node, stale };
  }
  /** The woven point in place of the point's text; Undo brings both back. */
  function useWeave(p) {
    const w = p.weave, old = p.body;
    if (!w) return;
    p.body = w.body;
    delete p.weave;
    touch(); renderPoints();
    toast(t('Main point {n} now carries your thought.', { n: s.points.indexOf(p) + 1 }), false, () => { p.body = old; p.weave = w; touch(); renderPoints(); });
  }
  /** One question Claude asked about a thought, with the box for the answer; the answer is kept with the thought and goes along to the next request. */
  function talkRow(p, e, redraw) {
    const ans = el('textarea', { rows: 1, placeholder: t('Your answer'), 'aria-label': t('Your answer') });
    ans.value = e.a || '';
    ans.addEventListener('input', () => { e.a = ans.value; touch(); });
    return el('div', { class: 'talk-item' }, [
      el('div', { class: 'row line talk-q' }, [
        el('span', { class: 'grow' }, [el('b', { text: t('Claude asked: ') }), e.q]),
        el('button', { class: 'icon del', type: 'button', 'aria-label': t('Remove this question'), text: '✕', onclick: () => { p.talk = (p.talk || []).filter(x => x !== e); touch(); redraw(); } }),
      ]),
      ans,
    ]);
  }

  // ---- 5. the context: the setting of the text, as the Guide's Context box gives it, with the key words, the Catechism and cross references
  container.append(step(5, t('Context: understand the text'), t('Like the Guide\'s Context box: the setting of the text. Who is speaking, to whom, and why? What came before and after? Which words carry the weight? The Catechism sections below quote this very text: tick the ones to keep, and open one to read it here.'),
    () => clearStep(5, t('the context'), ['context', 'keywords', 'crossRefs'], {
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
  /** The Tick/Ticked button of a suggested Catechism section: it joins or leaves the ticked sections under step 5. */
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
  /** The pencil that opens a suggestion for changing its words. */
  function pencil(onclick) {
    return el('button', { class: 'icon pen', type: 'button', 'aria-label': t('Edit'), title: t('Edit'), onclick }, pen());
  }
  /**
   * A box in which a suggestion's words are changed: a one-line box for a
   * heading (`line`), else a growing box. What is typed goes straight into
   * the suggestion (`on[key]`), so Use inserts it, and is saved with the
   * preparation; `after` runs after each change.
   */
  function editBox(on, key, { line = false, aria = '', after = null } = {}) {
    const ta = line ? lineBox({ 'aria-label': aria || null, placeholder: t('Heading') }) : el('textarea', { rows: 2, 'aria-label': aria || null });
    ta.value = on[key] || '';
    ta.addEventListener('input', () => { on[key] = ta.value; if (after) after(); touch(); });
    return ta;
  }
  /** Focus at the end of a box's text. */
  function toEnd(ta) {
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* not every box has a caret */ }
  }
  /**
   * One suggestion with its Use button. `title`, `body`, `why` (one or more
   * muted lines under the text) and `extra` (a button beside Use) may be
   * functions, read again each time the item is drawn. With `edit` the item
   * can be put into the person's own words in place: {on, title, body} name
   * the object the words live in and its fields (`prefix` stands before the
   * heading box, `after` runs after a change); a tap on the text or the
   * pencil opens the boxes, what is typed goes into that object, so Use and
   * "Use all" insert the changed words, and Done or Use closes them.
   */
  function item(title, body, onUse, extra, why, edit) {
    const val = v => (typeof v === 'function' ? v() : v);
    const node = el('div', { class: 'ai-item' + (edit ? ' editable' : '') });
    const whys = () => [].concat(val(why) || []).filter(Boolean).map(w => el('div', { class: 'ai-why muted small', text: w }));
    const use = after => (onUse ? el('button', { class: 'btn small ghost', type: 'button', text: t('Use'), onclick: () => { onUse(); if (after) after(); } }) : null);
    function show() {
      clear(node);
      node.classList.remove('editing');
      const ti = val(title), bo = val(body);
      const text = el('div', { class: 'ai-text' }, [ti ? el('b', { text: ti }) : null, ti && bo ? ' ' : null, bo || null, ...whys()]);
      // a tap on the text opens the boxes, unless text is being selected; on a phone the keyboard waits for a tap in a box
      if (edit) text.addEventListener('click', () => { if (String(getSelection()).length) return; open(!isTouch()); });
      node.append(text, el('div', { class: 'ai-actions' }, [edit ? pencil(() => open(true)) : null, val(extra) || null, use()]));
    }
    function open(focus) {
      clear(node);
      node.classList.add('editing');
      const boxes = [];
      if (edit.title) boxes.push(el('div', { class: 'ai-edit-title' }, [edit.prefix ? el('span', { class: 'ai-n', text: edit.prefix }) : null, editBox(edit.on, edit.title, { line: true, aria: t('Heading'), after: edit.after })]));
      if (edit.body) boxes.push(editBox(edit.on, edit.body, { aria: t('Text'), after: edit.after }));
      const wrap = el('div', { class: 'ai-edit' }, [...boxes, ...whys()]);
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); show(); } });
      node.append(wrap, el('div', { class: 'ai-actions' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Done'), onclick: show }), val(extra) || null, use(show)]));
      if (focus) { const ta = wrap.querySelector(edit.body ? 'textarea:not(.oneline)' : 'textarea'); if (ta) toEnd(ta); }
    }
    show();
    return node;
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
    // the thoughts stay with their points: by the Guide's number, the heading, or the place
    const mine = (p, i) => (old || []).find(x => x && p.from === 'guide' && x.guide === p.n) || (old || []).find(x => x && norm(x.heading) && norm(x.heading) === norm(p.heading)) || (old || [])[i] || {};
    s.points = list.map((p, i) => {
      const was = mine(p, i);
      return { heading: p.heading, body: p.body, ...(p.from === 'guide' ? { guide: p.n } : {}), ...(was.thought ? { thought: was.thought } : {}), ...(was.talk ? { talk: was.talk } : {}), ...(was.read ? { read: was.read } : {}) };
    });
    touch(); renderPoints();
    toast(done || t('All main points added.'), false, have.length ? () => { s.points = old; touch(); renderPoints(); } : null);
  }
  /** The main points Claude gave, each with its why-line and, where the heading was put into the sermon's language, the Guide's words. */
  function pointItems(a) {
    return (numberPoints(a).points || []).map(p => item(() => `${p.n}. ${p.heading}`, () => p.body, () => usePoint(p), null,
      () => [p.why, p.source && norm(p.source) !== norm(p.heading) ? t('From the Guide: ') + p.source : ''],
      { on: p, title: 'heading', body: 'body', prefix: `${p.n}.` }));
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
    if (!items.length) return document.createDocumentFragment();   // nothing to show, and nothing appended (null would print as "null")
    return el('div', { class: 'ai-sec' }, [
      el('div', { class: 'row line ai-sec-head' }, [el('h4', { text: title }), hint ? el('span', { class: 'muted small grow', text: hint }) : el('span', { class: 'grow' }), onUseAll ? el('button', { class: 'btn small ghost', type: 'button', text: t('Use all'), onclick: onUseAll }) : null]),
      ...items,
    ]);
  }
  function renderAi() {
    clear(aiBox);
    aiBox.hidden = !AI.unlocked();   // the helper is locked here (lock.js)
    if (aiBox.hidden) return;
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
    panel.append(el('p', { class: 'muted small ai-how', text: howEdit() }));
    const ctxLine = c => `${c.question}\n${c.answer}`;
    panel.append(group(t('Understanding the text'), (a.context || []).map(c => item(() => c.question, () => c.answer, () => { add('context', ctxLine(c)); toast(t('Added to Context.')); }, null, null, { on: c, title: 'question', body: 'answer' })),
      () => { add('context', a.context.map(ctxLine).join('\n\n')); toast(t('All answers added to Context.')); }));
    const kwLine = k => `${k.word} – ${k.meaning}`;
    panel.append(group(t('Key words'), (a.keywords || []).map(k => item(() => k.word, () => k.meaning, () => { add('keywords', kwLine(k), '\n'); toast(t('Added to Key words.')); }, null, null, { on: k, title: 'word', body: 'meaning' })),
      () => { add('keywords', a.keywords.map(kwLine).join('\n'), '\n'); toast(t('All key words added.')); }));
    panel.append(group(t('Catechism'), (a.catechism || []).map(c => el('div', { class: 'ai-item' }, [
      el('div', { class: 'ai-text' }, [el('a', { href: `#catechism/${encodeURIComponent(c.n)}`, class: 'num', text: c.n }), ' ', el('b', { text: c.title }), c.why ? ' ' + c.why : null]),
      el('div', { class: 'ai-actions' }, [catTick(c)]),
    ])), null, t('Ticked sections print in the sermon notes.')));
    panel.append(group(t('Cross references'), (a.crossRefs || []).map(x => item(() => x.reference, () => x.why, () => { add('crossRefs', xrLine(x), '\n'); toast(t('Added to Cross references.')); },
      () => readLink(x.ref), null, { on: x, title: 'reference', body: 'why', after: () => { x.ref = parseRef(String(x.reference || '').replace(/[–—]/g, '-')); } })),
      () => { add('crossRefs', a.crossRefs.map(xrLine).join('\n'), '\n'); toast(t('All cross references added.')); }));
    const fixed = ['guide', 'own', 'article'].includes(a.pointsFrom);   // the Guide's points, not thoughts of Claude's own
    panel.append(group(fixed ? t('Main points') : t('Sermon thoughts'), [
      ...pointNotes(a),
      ...pointItems(a),
      a.application ? item(t('Application'), () => a.application, () => { add('application', a.application); toast(t('Added to Application.')); }, null, null, { on: a, body: 'application' }) : null,
    ].filter(Boolean), (a.points || []).length > 1 ? () => usePoints(a.points) : null, pointsHint(a, false)));
    aiBox.append(panel);
  }
  renderAi();

  // ---- 6. the summary and conclusion: the Guide ends with its Summary; the sermon gathers its points up and leads to the altar
  container.append(step(6, t('Summary and conclusion'), t('The Guide ends with a summary. Gather the main points up in a few short lines, say what they ask of us this week, and lead to the altar.'),
    () => clearStep(6, t('the summary and conclusion'), ['summary', 'application', 'conclusion'])));
  container.append(
    field(t('Summary'), 'summary', { rows: 3, placeholder: t('The main points in a few short lines, to gather them up at the end') }),
    field(t('Application for the congregation'), 'application', { rows: 4, placeholder: t('What does this ask of us this week? Name it for the people in front of you.') }),
    field(t('Conclusion'), 'conclusion', { rows: 3, placeholder: t('Gather the thoughts and lead to the altar: forgiveness, Holy Communion, the hope we share') }),
  );

  // ---- 7. illustrations: the person's own experiences, which the Guide leaves to the minister
  container.append(step(7, t('Illustrations and experiences'), t('A true experience says more than an explanation. Bring one in from your notes, or write it here.'),
    () => clearStep(7, t('illustrations'), ['illustrations'])));
  const illus = field(t('Illustrations'), 'illustrations', { rows: 5, placeholder: t('A story, an experience, a picture that makes the point visible') });
  const illusArea = illus.querySelector('textarea');
  container.append(illus, el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: t('Insert from my notes'), onclick: () => pickNote(note => {
      // in the language of this preparation, when the note has it (notes.js: a note can carry its translation)
      const x = Notes.textIn(note, AI.langOf(s));
      const line = `${Notes.refLabel(note)}${x.title ? ' – ' + x.title : ''}: ${x.body}`;
      s.illustrations = (s.illustrations ? s.illustrations.trim() + '\n\n' : '') + line;
      illusArea.value = s.illustrations;
      fit(illusArea);
      touch();
    }, AI.langOf(s)) }),
  ]));

  // ---- output
  container.append(step('✓', t('Print or save'), t('The sermon notes carry everything above, in the order of the steps. The sermon is the text alone, in reading order and in large clear type: the text word, the introduction, the main points, the summary, the application and the conclusion, with the illustrations. The cue cards are for the pulpit, in large type: each main point with its main thoughts under it, and your own thought on the point in blue.')));
  async function run(make, how) {
    try {
      await Cat.loadText().catch(() => false);
      const r = make(s);
      if (how === 'print') { Pdf.print(r); toast(t('Sending to the printer…')); }
      else if (how === 'share') Pdf.share(r).then(res => { if (res === 'downloaded') toast(t('Sharing is not available here, so the PDF was downloaded.')); });
      else { Pdf.download(r); toast(t('Saved ') + r.name); }
    } catch (e) { toast(e.message || t('The PDF could not be built.'), true); }
  }
  /** One printed output: its name, then Save as PDF, Print and, on a phone that can, Share. */
  const outRow = (label, make, share) => el('div', { class: 'row out-row' }, [
    el('span', { class: 'out-label', text: label }),
    el('button', { class: 'btn small', type: 'button', text: t('Save as PDF'), onclick: () => run(make, 'download') }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Print'), onclick: () => run(make, 'print') }),
    share && Pdf.canShare() ? el('button', { class: 'btn small ghost', type: 'button', text: t('Share'), onclick: () => run(make, 'share') }) : null,
  ]);
  container.append(el('div', { class: 'outputs' }, [
    outRow(t('Sermon notes'), Pdf.sermonPdf, true),
    outRow(t('The sermon'), Pdf.sermonTextPdf, true),
    outRow(t('Cue cards'), Pdf.cueCardPdf, false),
  ]));

  // ---- hear the sermon (speech.js, listen.js): the same text as "The sermon", read by an ElevenLabs voice; the recording stays with this preparation on this device
  sermonCard = listenCard({
    title: t('Hear the sermon'), id: s.id,
    noKey: t('An ElevenLabs voice can read the sermon to you: the text word, the introduction, the main points, the summary, the application and the conclusion, as "The sermon" prints them. Add your ElevenLabs key under Settings → Read aloud first.'),
    empty: t('Write the introduction, the main points, the application or the conclusion first.'),
    script: rec => (rec && rec.source === 'outline' && s.build ? Speech.script(s, { outline: s.build }) : Speech.script(s)),
    read: ({ outline = null } = {}, o) => Speech.make(s, { outline, ...o }),
    againWith: rec => (rec.source === 'outline' && s.build ? { outline: s.build } : {}),
    fileName: rec => Speech.fileName(s.date, rec.title),
    from: rec => (rec.source === 'outline' ? t('from the outline') : t('from the boxes')),
    stale: t('The sermon has changed since this was read.'),
    reading: t('Reading the sermon aloud'), ready: t('The sermon is ready to hear.'), failed: t('The sermon could not be read.'),
  });
  container.append(sermonCard.box);

  // ---- 8. reflection
  container.append(step(8, t('After the service'), t('A few honest lines while it is fresh. They make the next preparation better.'),
    () => clearStep(8, t('after the service'), ['reflection'])));
  container.append(field(t('Reflection'), 'reflection', { rows: 4, placeholder: t('What spoke? What would you do differently? What did the congregation give back?') }));

  // ---- 9. the reflection evening: the congregation looks back on this service, with slides (reflect.js)
  container.append(step(9, t('Reflection evening'), t('An evening when the congregation looks back on this service and talks about it. The slides show the sermon, its text word, the main points from the Guide and the questions, one at a time.')));
  const made = Reflect.hasSlides(s);
  container.append(el('div', { class: 'row' }, [
    el('a', { class: 'btn small', href: `#reflect/${s.id}`, text: made ? t('Open the slides') : t('Make the slides') }),
    s.reflect && s.reflect.from ? el('span', { class: 'muted small', text: t('With the questions from the reflection guide.') }) : null,
  ]));

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

/** The pencil on the button that opens a suggestion for changing its words (the Notes tab's pen). */
function pen() {
  const span = el('span', { class: 'pen-ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  return span;
}

/** The small mark on the button that asks Claude. */
function sparkle() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

/** Pick one of the notes; each shows in language `l` when it has it. */
function pickNote(onPick, l) {
  const sh = sheet(t('Insert a note'));
  const kinds = new Set(['experience', 'illustration']);
  const first = state.notes.filter(n => kinds.has(n.kind));
  const rest = state.notes.filter(n => !kinds.has(n.kind));
  if (!state.notes.length) sh.body.append(el('p', { class: 'muted', text: t('You have no notes yet. Write them in the reader: tap a verse, then "Note".') }));
  for (const n of [...first, ...rest]) {
    const x = Notes.textIn(n, l);
    sh.body.append(el('button', { class: 'item pick', type: 'button', onclick: () => { sh.close(); onPick(n); } }, [
      el('div', { class: 'note-head' }, [el('b', { text: Notes.refLabel(n) }), el('span', { class: 'pill kind ' + n.kind, text: Notes.kindLabel(n.kind) })]),
      el('div', { class: 'small', lang: x.lang, text: (x.title ? x.title + ' – ' : '') + x.body.slice(0, 160) + (x.body.length > 160 ? '…' : '') }),
    ]));
  }
}

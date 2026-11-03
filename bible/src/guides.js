/*
 * The monthly Divine Service Guide inside the app.
 *
 * The person loads the Guide's PDF once a month; ai.js has Claude read it into
 * one entry per service (date, Bible text, title, message, the article, the
 * Context box, the Summary, the Catechism sections it cites). The entries live
 * in IndexedDB on this device only: the Guide is the Church's text, like the
 * Catechism, so it is not in the backup file and never on the public site.
 *
 * From here the Prepare tab lists the services of the loaded Guides, starts a
 * preparation from one, attaches a service to a preparation made in the
 * reader, and shows the article under step 2 so the Guide is at hand while the
 * sermon takes shape. The steps of a preparation follow the article's own
 * order, and each part of the article fills its own step: the Bible text
 * step 1, the title and message step 2, the main points step 4, the Context
 * box step 5 and the Summary step 6 (the introduction is shown under step 3
 * to read beside the person's own).
 *
 * The main points of a sermon always come from the Guide: the parts of the
 * article, each under its own heading, are main point 1, 2, 3 and so on, in
 * the Guide's order. mainPoints() reads them off an article; prefill() puts
 * them into a new preparation, and ai.js holds Claude to them.
 *
 * The Guide comes in English and in Afrikaans ("Handleiding vir
 * Godsdienste"), the same booklet with the same services. Both can be loaded
 * for a month: the card in the Prepare list then switches between the two,
 * and each service is linked to the same service in the other language
 * (partnerOf), so a preparation shows from either list. A preparation follows
 * one of the two, the one it was started from, and its sermon is preached in
 * that language; switchEdition() moves it to the other, putting the other
 * language's words wherever the Guide's own words still stand.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, busy, seg } from './ui.js';
import { t, tn, locale } from './i18n.js';
import { parseRef, formatRef } from './books.js';
import { state, saveGuide, deleteGuide, uid } from './store.js';
import * as AI from './ai.js';
import * as Cat from './catechism.js';

/* The languages the Guide comes in, as a switch names them (seg() puts them into the app's language). */
const EDITIONS = { en: 'English', af: 'Afrikaans' };
const RANK = { en: 0, af: 1 };

/*
 * One booklet: the month's Guide in one language. A Guide loaded on two
 * devices before the sync joined them is there twice, as two copies of the
 * same booklet with their own ids; preparations may be linked to either.
 */
const bookletOf = g => [g.year, g.month, g.language, EDITIONS[g.language] ? '' : g.title].join('|');

/** Loaded Guides, newest month first, each booklet once: of a booklet loaded more than once, the copy loaded last. */
export function all() {
  const seen = new Set();
  return state.guides.slice()
    .sort((a, b) => (b.year - a.year) || (b.month - a.month) || (b.loadedAt || '').localeCompare(a.loadedAt || ''))
    .filter(g => {
      const k = bookletOf(g);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Every copy of a Guide's booklet on this device: the Guide itself, and the same month and language loaded on another device. */
function copiesOf(guide) {
  return state.guides.filter(g => bookletOf(g) === bookletOf(guide));
}

/* ---------------------------------------------------------------- one Guide, two languages */

/** The name of a Guide's language for a switch: "English" or "Afrikaans" (else the booklet's own title). */
export function editionLabel(guide) {
  return EDITIONS[guide && guide.language] || (guide && guide.title) || '';
}

/** The loaded Guides by month, newest first: [{year, month, editions}], the English Guide before the Afrikaans. */
export function months() {
  const out = [];
  for (const g of all()) {
    let m = out.find(x => x.year === g.year && x.month === g.month);
    if (!m) out.push(m = { year: g.year, month: g.month, editions: [] });
    m.editions.push(g);
  }
  for (const m of out) m.editions.sort((a, b) => (RANK[a.language] ?? 2) - (RANK[b.language] ?? 2));
  return out;
}

/** The same month's Guide in the other language (the Afrikaans one for an English one, and the other way round), or null. */
export function otherEdition(guide) {
  const want = guide && { en: 'af', af: 'en' }[guide.language];
  if (!want) return null;
  return all().find(g => g.year === guide.year && g.month === guide.month && g.language === want) || null;
}

/** Two references to the same verses. */
const sameRef = (a, b) => !!(a && b) && a.book === b.book && a.chapter === b.chapter
  && (a.verse || 0) === (b.verse || 0) && (a.verseEnd || a.verse || 0) === (b.verseEnd || b.verse || 0);

/**
 * Where service i of a Guide stands in another Guide of the same month (a
 * copy, or the other language's): the same Bible text on the same day;
 * failing that, the same day and kind of service; failing that, the same
 * place in a booklet with as many services. -1 when it is not there.
 */
function placeIn(other, guide, i) {
  if (other === guide) return i;
  const svc = guide.services[i];
  const list = other.services;
  const ref = refOf(svc);
  let j = ref ? list.findIndex(x => sameRef(refOf(x), ref) && (!svc.date || !x.date || x.date === svc.date)) : -1;
  if (j < 0 && svc.date) j = list.findIndex(x => x.date === svc.date && x.kind === svc.kind);
  if (j < 0 && list.length === guide.services.length && list[i] && list[i].kind === svc.kind) j = i;
  return j;
}

/** The same service in the other language's Guide: {guide, service, i}, or null when that Guide is not loaded or has no such service (see placeIn). */
export function partnerOf(guide, i) {
  const other = otherEdition(guide);
  if (!other || !guide.services[i]) return null;
  const j = placeIn(other, guide, i);
  return j >= 0 ? { guide: other, service: other.services[j], i: j } : null;
}

/** The Guides in the order to search them: newest month first, and in each month the Guide in `lang` first. */
function byPreference(lang) {
  return all().sort((a, b) => (b.year - a.year) || (b.month - a.month) || ((a.language === lang ? 0 : 1) - (b.language === lang ? 0 : 1)));
}

/** Two texts alike but for spaces, punctuation and capitals: the Guide's words where they were filled in, still as they were. */
function same(x, y) {
  const k = v => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return !!k(x) && k(x) === k(y);
}

/** "Psalm 130:7 (excerpt)" → the parsed reference, or null. */
export function refOf(service) {
  const text = (service.reference || '').replace(/\((excerpt|uittreksel|gedeelte)\)/i, '').replace(/[–—]/g, '-').trim();
  return parseRef(text);
}

/** The occasion a service in the Guide stands for, in the words the Prepare form uses. */
export function occasionFor(service) {
  const label = (service.label || '').toLowerCase();
  if (/departed|ontslapene/.test(label)) return 'Divine service for the departed';
  if (service.kind === 'midweek') return 'Midweek divine service';
  if (service.kind === 'youth') return 'Youth service';
  if (service.kind === 'children') return 'Children\'s service';
  return 'Sunday divine service';
}

/** The Guide and article a preparation is linked to: {guide, service, i} or null. */
export function findService(s) {
  const link = s.guideLink;
  if (!link) return null;
  const guide = state.guides.find(g => g.id === link.guideId);
  const service = guide && guide.services[link.i];
  return service ? { guide, service, i: link.i } : null;
}

/** The first service in any loaded Guide whose text word covers this reference; with `lang`, the Guide in that language first. */
export function matchService(ref, lang) {
  if (!ref) return null;
  for (const guide of byPreference(lang)) {
    for (let i = 0; i < guide.services.length; i++) {
      const r = refOf(guide.services[i]);
      if (!r || r.book !== ref.book || r.chapter !== ref.chapter) continue;
      if (!r.verse || !ref.verse || (ref.verse <= (r.verseEnd || r.verse) && (ref.verseEnd || ref.verse) >= r.verse)) return { guide, service: guide.services[i], i };
    }
  }
  return null;
}

/**
 * The preparations already started from a service: linked to it in this
 * Guide, in another copy of the same booklet, or to the same service in the
 * other language's Guide or one of its copies: [{sermon}]
 */
export function preparationsFor(guide, i) {
  const at = [];   // [guide id, service index]: this service in every copy, in both languages
  const twin = partnerOf(guide, i);
  for (const [g, k] of [[guide, i], twin && [twin.guide, twin.i]].filter(Boolean)) {
    for (const c of copiesOf(g)) {
      const j = placeIn(c, g, k);
      if (j >= 0) at.push([c.id, j]);
    }
  }
  return state.sermons.filter(s => s.guideLink && at.some(([id, j]) => s.guideLink.guideId === id && s.guideLink.i === j));
}

/** The Guide's Summary as it goes into the Summary box under step 6: one point per line. */
export function summaryText(service) {
  return ((service && service.summary) || []).map(x => `• ${x}`).join('\n');
}

/**
 * What "Notes from the Guide" held before the Context box and the Summary had
 * steps of their own (November 2026): the Summary points, then the Context box.
 */
function oldNotes(service) {
  const out = [];
  if (summaryText(service)) out.push(summaryText(service));
  if (service.context) out.push(service.context);
  return out.join('\n\n');
}

/**
 * A preparation taken from the Guide before November 2026 kept the Guide's
 * Summary and Context box in "Notes from the Guide" under step 2. While those
 * notes are still exactly the Guide's words, they move to their own steps,
 * the Context box to step 5 and the Summary to step 6, so the preparation
 * reads in the Guide's order like a new one. Once the person has written in
 * those notes, they stay where they are. Returns true when something moved.
 */
export function upgrade(s) {
  const link = findService(s);
  if (!link || (s.summary || '').trim()) return false;
  const old = oldNotes(link.service);
  if (!old || (s.guide || '').trim() !== old.trim()) return false;
  const ctx = (link.service.context || '').trim();
  const mine = (s.context || '').trim();
  if (ctx && !mine.includes(ctx)) s.context = mine ? `${ctx}\n\n${mine}` : ctx;
  s.summary = summaryText(link.service);
  s.guide = '';
  return true;
}

/* Headings of an article that are not a main point: the parts around the article's own parts. */
const NOT_A_POINT = /^(introduction|inleiding|context|agtergrond|konteks|summary|samevatting|opsomming|thoughts from the chief apostle|gedagtes van(af)? die stamapostel|reading|voorlesing)\b/i;

/**
 * The main points of the sermon, as the Guide gives them: the parts of the
 * article under their own headings, in the Guide's order, each with the
 * Guide's words under it. An article without headed parts gives its Summary
 * points instead. [{n, heading, body}], empty when the article has neither.
 */
export function mainPoints(service) {
  if (!service) return [];
  const parts = (service.sections || []).filter(x => x && (x.heading || '').trim() && !NOT_A_POINT.test(x.heading.trim()));
  const list = parts.length
    ? parts.map(x => ({ heading: x.heading.trim(), body: (x.body || '').trim() }))
    : (service.summary || []).map(x => ({ heading: String(x || '').trim(), body: '' })).filter(x => x.heading);
  return list.map((x, i) => ({ n: i + 1, ...x }));
}

/** The main points of a preparation as they stand, when none of them is written yet. */
const pointsEmpty = s => !(s.points || []).some(p => p && ((p.heading || '').trim() || (p.body || '').trim()));

/**
 * Fills a preparation from a service, each part of the article into its own
 * step. Empty fields are filled; with `force` the text word, title and
 * message are set even where something is typed already, and the Context and
 * Summary boxes take this service's words where they are empty or still hold
 * the words of the service linked before (what the person wrote stays);
 * `fresh` says the preparation is new, so the service's date and occasion are
 * taken too. The Catechism sections the article cites are ticked, and while
 * no main point is written yet, the main points are the Guide's (see
 * mainPoints): the person's own points under step 4 are never replaced here.
 * With `lang`, a preparation that has no language of its own yet is preached
 * in the language of this Guide, so Claude answers in it.
 */
export function prefill(s, guide, i, { force = false, fresh = false, lang = false } = {}) {
  const svc = guide.services[i];
  const ref = refOf(svc);
  const before = findService(s);   // the service linked until now, if any
  const set = (key, value) => { if (value && (force || !s[key])) s[key] = value; };
  // the Guide's own boxes: swapped only while they hold the Guide's words, never the person's
  const box = (key, value, was) => {
    const now = (s[key] || '').trim();
    if (!now) { if (value) s[key] = value; return; }
    if (force && was && now === was.trim()) s[key] = value || '';
  };
  if (ref && (force || !s.ref)) { s.ref = ref; s.refText = formatRef(ref, state.settings.bookLang); }
  else if (!s.ref && !s.refText) s.refText = svc.reference;
  if (svc.bibleText && (force || !s.text)) {
    s.text = svc.bibleText;
    s.translationId = '';
    s.translation = guide.language === 'af' ? 'AFR53' : 'NKJV';
  }
  if (svc.date && (force || fresh || !s.date)) s.date = svc.date;
  if (force || fresh || !s.occasion || s.occasion === 'Sunday divine service') s.occasion = occasionFor(svc);
  set('title', svc.title);
  set('theme', svc.message);
  box('context', svc.context, before && before.service.context);
  box('summary', summaryText(svc), before && summaryText(before.service));
  if (svc.reading && !(s.crossRefs || '').includes(svc.reading)) s.crossRefs = (s.crossRefs ? s.crossRefs.trim() + '\n' : '') + t('{reading} – reading suggested in the Guide', { reading: svc.reading });
  s.catechism = s.catechism || [];
  for (const n of svc.catechismRefs || []) {
    const sec = Cat.section(n);
    if (sec && !s.catechism.find(c => c.n === n)) s.catechism.push({ n, title: sec.title });
  }
  const points = mainPoints(svc);
  if (points.length && pointsEmpty(s)) s.points = points.map(p => ({ heading: p.heading, body: p.body, guide: p.n }));
  if (lang && !s.lang && EDITIONS[guide.language]) s.lang = guide.language;
  s.guideLink = { guideId: guide.id, i };
  return s;
}

/**
 * Moves a preparation to the same service in the other language's Guide
 * (partnerOf). Whatever still holds the words of the Guide it followed until
 * now takes the other Guide's words: the Bible text, the title, the message,
 * the Context and Summary boxes, the reading among the cross references, and
 * the heading and the words of each main point taken from the Guide, one by
 * one. What the person wrote stays as it is, and so do their thoughts on the
 * points. The sermon is then preached in the other language.
 * Gives {to, points}, `points` false when the main points were left alone
 * because the two Guides do not have the same parts; null when the other
 * Guide has no such service.
 */
export function switchEdition(s) {
  const from = findService(s);
  const to = from && partnerOf(from.guide, from.i);
  if (!to) return null;
  const a = from.service, b = to.service;
  const swap = (key, was, now) => { if (same(s[key], was)) s[key] = now || ''; };
  if (same(s.text, a.bibleText) && b.bibleText) {
    s.text = b.bibleText;
    s.translationId = '';
    s.translation = to.guide.language === 'af' ? 'AFR53' : 'NKJV';
  }
  swap('title', a.title, b.title);
  swap('theme', a.message, b.message);
  swap('context', a.context, b.context);
  swap('summary', summaryText(a), summaryText(b));
  if (a.reading && b.reading && (s.crossRefs || '').includes(a.reading)) s.crossRefs = s.crossRefs.replace(a.reading, b.reading);
  const was = mainPoints(a), now = mainPoints(b);
  const fits = was.length === now.length;
  if (fits) {
    for (const p of s.points || []) {
      const x = p && p.guide ? was[p.guide - 1] : null;
      const y = x ? now[p.guide - 1] : null;
      if (!y) continue;
      if (same(p.heading, x.heading)) p.heading = y.heading;
      if (same(p.body, x.body)) p.body = y.body;
    }
  }
  s.catechism = s.catechism || [];
  for (const n of b.catechismRefs || []) {
    const sec = Cat.section(n);
    if (sec && !s.catechism.find(c => c.n === n)) s.catechism.push({ n, title: sec.title });
  }
  s.guideLink = { guideId: to.guide.id, i: to.i };
  if (EDITIONS[to.guide.language]) s.lang = to.guide.language;
  return { to, points: fits || !was.length };
}

/* ---------------------------------------------------------------- the article */

function paras(text, cls) {
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    const items = p.split('\n').filter(Boolean);
    if (items.length > 1 && items.every(l => /^[-•■]\s/.test(l))) return el('ul', {}, items.map(l => el('li', { text: l.replace(/^[-•■]\s*/, '') })));
    return el('p', { class: cls || null, text: p.replace(/\s*\n\s*/g, ' ') });
  });
}

/** The Guide's article as it reads in the booklet. */
export function article(service, guide) {
  const box = el('div', { class: 'guide-article' });
  box.append(el('p', { class: 'muted small guide-meta', text: [guide && guide.title, service.dateText, service.label].filter(Boolean).join(' · ') }));
  if (service.bibleText) box.append(el('p', { class: 'guide-verse' }, [service.bibleText, ' ', el('b', { text: service.reference })]));
  if (service.title) box.append(el('h4', { text: service.title }));
  if (service.message) box.append(el('p', { class: 'guide-message' }, [el('b', { text: t('Message ') }), service.message]));
  if (service.introduction) { box.append(el('h5', { text: t('Introduction') }), ...paras(service.introduction)); }
  for (const sec of service.sections || []) {
    if (sec.heading) box.append(el('h5', { text: sec.heading }));
    box.append(...paras(sec.body));
  }
  if (service.context) box.append(el('div', { class: 'guide-box' }, [el('b', { text: t('Context|box') }), ...paras(service.context)]));
  if ((service.summary || []).length) box.append(el('div', { class: 'guide-box' }, [el('b', { text: t('Summary') }), el('ul', {}, service.summary.map(x => el('li', { text: x })))]));
  const refs = (service.catechismRefs || []).filter(n => Cat.section(n));
  if (refs.length || service.reading) {
    box.append(el('p', { class: 'small guide-refs' }, [
      refs.length ? [t('Catechism: '), ...refs.flatMap((n, i) => [i ? ', ' : '', el('a', { href: `#catechism/${encodeURIComponent(n)}`, text: n })]), '. '] : null,
      service.reading ? t('Reading: {reading}.', { reading: service.reading }) : null,
    ].flat().filter(Boolean)));
  }
  box.append(el('p', { class: 'muted small', text: t('Divine Service Guide © New Apostolic Church International. Loaded on this device for your own preparation.') }));
  return box;
}

/** One part of the article on its own, as it reads in the booklet: the Guide's introduction under step 3. */
export function articlePart(text) {
  return el('div', { class: 'guide-article' }, [
    ...paras(text),
    el('p', { class: 'muted small', text: t('Divine Service Guide © New Apostolic Church International. Loaded on this device for your own preparation.') }),
  ]);
}

/* ---------------------------------------------------------------- loading a Guide */

/** The file picker and the wait while Claude reads the Guide. Resolves to the saved Guide, or null. */
export function load() {
  return new Promise(resolve => {
    if (!AI.ready()) { noKey(); resolve(null); return; }
    const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) { resolve(null); return; }
      resolve(await read(file));
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.click();
  });
}

async function read(file) {
  const ctrl = new AbortController();
  const b = busy(t('Reading the Guide'), () => ctrl.abort());
  b.say(t('Claude is reading "{file}". A whole month takes a minute or two; you can keep the app open.', { file: file.name }));
  try {
    const g = await AI.readGuide(file, { signal: ctrl.signal, onProgress: n => b.say(t('Reading "{file}"… {k}k letters of it are in so far.', { file: file.name, k: Math.round(n / 1000) })) });
    const older = all().find(x => bookletOf(x) === bookletOf(g));   // the copy shown now, when this booklet is loaded already
    const guide = { ...g, id: older ? older.id : uid(), loadedAt: new Date().toISOString() };
    await saveGuide(guide);
    shown = { year: guide.year, month: guide.month, language: guide.language, usual: AI.langOf(null) };   // the card opens on the Guide just read
    b.done();
    const twin = otherEdition(guide);
    const linked = !twin ? '' : twin.language === 'en' ? t('Linked to the English Guide of the same month.') : t('Linked to the Afrikaans Guide of the same month.');
    toast(`${guide.title}: ` + tn(guide.services.length, '{n} service read', '{n} services read') + (older ? ' ' + t('(the earlier copy was replaced)') : '') + '. ' + (linked ? linked + ' ' : '') + (AI.fmtCost(guide.cost) ? t('This cost {cost}.', { cost: AI.fmtCost(guide.cost) }) : ''));
    return guide;
  } catch (e) {
    if (e && e.name === 'AbortError') { b.done(); return null; }
    b.fail(e.message || t('The Guide could not be read.'));
    return null;
  }
}

/** Where to go when there is no key yet. */
export function noKey() {
  if (!AI.unlocked()) {
    // the helper is locked here (lock.js): what is open is Theology, with a key of the visitor's own
    const s = sheet(t('A key of your own is needed'));
    s.body.append(
      el('p', { text: t('In Theology, Claude answers with a key of your own from Anthropic: you pay only for what you use, usually under 20 US cents an answer, and the key stays on this device.') }),
      el('p', { class: 'small' }, [t('Get the key at console.anthropic.com and paste it under Settings → AI helper. The settings page has the steps.')]),
      el('div', { class: 'row end' }, [el('a', { class: 'btn', href: '#settings', text: t('Open Settings'), onclick: () => s.close() })]),
    );
    return;
  }
  const s = sheet(t('Your Anthropic key is needed'));
  s.body.append(
    el('p', { text: t('Claude reads the Guide, makes the suggestions and writes the theology with a key of your own, so that you pay only for what you use and the key stays on this device.') }),
    el('p', { class: 'small' }, [t('Get the key at console.anthropic.com and paste it under Settings → AI helper. The settings page has the steps.')]),
    el('div', { class: 'row end' }, [el('a', { class: 'btn', href: '#settings', text: t('Open Settings'), onclick: () => s.close() })]),
  );
}

/* ---------------------------------------------------------------- the card in the Prepare list */

function serviceRow(guide, i, onPrepare) {
  const svc = guide.services[i];
  const ref = refOf(svc);
  const done = preparationsFor(guide, i);
  const row = el('button', { class: 'item svc', type: 'button', onclick: () => {
    if (done.length) { location.hash = `#prepare/${done[0].id}`; return; }
    onPrepare(guide, i);
  } }, [
    el('div', { class: 'when' }, [el('b', { text: svc.date ? fmtDate(svc.date, true) : (svc.dateText || '') }), el('span', { class: 'muted small', text: svc.label || t(occasionFor(svc)) })]),
    el('div', { class: 'grow' }, [
      el('div', { class: 'ref', text: ref ? formatRef(ref, state.settings.bookLang) : svc.reference }),
      el('div', { class: 'muted small', text: svc.title }),
    ]),
    done.length ? el('span', { class: 'pill status ' + (done[0].status || 'draft'), text: t(done[0].status === 'ready' ? 'Ready' : done[0].status === 'held' ? 'Held' : 'Draft') }) : el('span', { class: 'pill link', text: t('Prepare') }),
  ]);
  return row;
}

/* The month and language the card shows while the app is open: the last chosen on the card, or the Guide just
   read. A language chosen there holds until the app's own language changes, so the EN/AF switch is followed. */
let shown = null;

/** "November 2026", in the language of the app. */
function monthName(m) {
  return new Date(m.year, m.month - 1, 15).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
}

/**
 * The Guides in the Prepare list: the services of the chosen month, one tap
 * to start its preparation, and the buttons to load or remove a Guide. When
 * the month's Guide is loaded in English and in Afrikaans, a switch shows
 * either; when only one is, a button loads the other.
 * onPrepare(guide, i) starts a preparation; onChange() redraws the tab.
 */
export function card({ onPrepare, onChange }) {
  const groups = months();
  const wrap = el('details', { class: 'guide-card', open: true });
  // loading a Guide is Claude's work, so it is the minister's own (lock.js): a locked device only shows the Guides it has
  const canLoad = AI.unlocked();
  if (!groups.length && !canLoad) return null;
  if (!groups.length) {
    wrap.append(
      el('summary', { text: t('Divine Service Guide') }),
      el('p', { class: 'small muted', text: t('Load this month\'s Guide (the PDF), in English or in Afrikaans, and Claude reads every service out of it: date, text word, message, the article and its Catechism references. A preparation then starts with all of that filled in. You can load the Guide in both languages.') }),
      el('div', { class: 'row' }, [el('button', { class: 'btn small', type: 'button', text: t('Load a Guide (PDF)'), onclick: async () => { if (await load()) onChange(); } })]),
    );
    return wrap;
  }
  // the month and the language shown: as chosen last, else the newest month in the language the person usually preaches in
  const usual = AI.langOf(null);
  let keep = shown && shown.usual === usual ? shown.language : null;
  const editionOf = m => (keep && m.editions.find(g => g.language === keep)) || m.editions.find(g => g.language === usual) || m.editions[0];
  let month = (shown && groups.find(m => m.year === shown.year && m.month === shown.month)) || groups[0];
  let current = editionOf(month);
  const remember = () => { shown = { year: month.year, month: month.month, language: keep, usual }; };
  const heading = el('span');
  const count = el('span', { class: 'muted small' });
  const body = el('div');
  const choose = groups.length > 1 ? el('select', { class: 'small', 'aria-label': t('Which month') }, groups.map((m, k) => el('option', { value: String(k), text: monthName(m), selected: m === month }))) : null;
  if (choose) choose.addEventListener('change', () => { month = groups[Number(choose.value)] || groups[0]; current = editionOf(month); remember(); draw(); });
  const loadOne = async () => { if (await load()) onChange(); };
  function draw() {
    heading.textContent = /guide|gids|handleiding/i.test(current.title) ? current.title : t('Divine Service Guide: {title}', { title: current.title });
    const both = month.editions.some(g => g.language === 'en') && month.editions.some(g => g.language === 'af');
    count.textContent = ' · ' + tn(current.services.length, '{n} service', '{n} services') + (both ? ' · ' + t('English and Afrikaans') : '');
    // the same Guide in the other language, not loaded yet: the button to load it
    const missing = !otherEdition(current) && { en: 'af', af: 'en' }[current.language];
    clear(body);
    body.append(...[
      month.editions.length > 1 ? el('div', { class: 'row line guide-langs' }, [
        el('span', { class: 'small', text: t('The Guide in:') }),
        seg(month.editions.map(g => [g.id, editionLabel(g)]), current.id, id => { current = month.editions.find(g => g.id === id) || current; keep = current.language; remember(); draw(); }, { label: t('Language of the Guide') }),
      ]) : null,
      el('p', { class: 'small muted', text: t('Tap a service to start its preparation, or to open the one already started. Loaded {date} from "{file}".', { date: fmtDate(current.loadedAt), file: current.fileName || t('a PDF') }) }),
      el('div', { class: 'list' }, current.services.map((_, i) => serviceRow(current, i, onPrepare))),
      missing && canLoad ? el('p', { class: 'small guide-twin', text: missing === 'af'
        ? t('Do you have this Guide in Afrikaans too? Load it as well. Each service is then linked to the same one in English, and each preparation can follow either language.')
        : t('Do you have this Guide in English too? Load it as well. Each service is then linked to the same one in Afrikaans, and each preparation can follow either language.') }) : null,
      el('div', { class: 'row' }, [
        missing && canLoad ? el('button', { class: 'btn small', type: 'button', text: missing === 'af' ? t('Load the Afrikaans Guide (PDF)') : t('Load the English Guide (PDF)'), onclick: loadOne }) : null,
        canLoad ? el('button', { class: 'btn small ghost', type: 'button', text: t('Load another Guide'), onclick: loadOne }) : null,
        el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove this Guide'), onclick: async () => {
          if (await confirmBox(t('Remove "{title}" from this device? Preparations made from it keep their text; you can load the PDF again later.', { title: current.title }), t('Remove'), true)) {
            for (const g of copiesOf(current)) await deleteGuide(g.id);   // every copy of it, so no older copy takes its place
            toast(t('Guide removed.'));
            onChange();
          }
        } }),
      ]),
    ].filter(Boolean));
  }
  draw();
  wrap.append(el('summary', {}, [heading, count]));
  if (choose) wrap.append(el('div', { class: 'row line guide-choose' }, [el('span', { class: 'small', text: t('Month:') }), choose]));
  wrap.append(body);
  return wrap;
}

/* ---------------------------------------------------------------- attaching a service */

/** A sheet to pick the Guide's article for a preparation; onPick(guide, i). */
export function picker(s, onPick) {
  const guides = all();
  const sh = sheet(t('The service in the Guide'));
  if (!guides.length) {
    sh.body.append(el('p', { class: 'muted', text: t('No Guide is loaded on this device yet. Load the month\'s PDF in the Prepare list first.') }));
    return;
  }
  const prefer = AI.langOf(s);   // the Guide in the language of this sermon comes first
  const match = s.ref ? matchService(s.ref, prefer) : null;
  if (match) sh.body.append(el('p', { class: 'small', text: t('The {title} has a service on {reference}: it is listed first.', { title: match.guide.title, reference: match.service.reference }) }));
  const list = el('div', { class: 'list' });
  const rows = [];
  for (const guide of byPreference(prefer)) guide.services.forEach((svc, i) => rows.push({ guide, i, svc }));
  if (match) rows.sort((a, b) => ((b.guide === match.guide && b.i === match.i) - (a.guide === match.guide && a.i === match.i)));
  for (const { guide, i, svc } of rows) {
    const ref = refOf(svc);
    list.append(el('button', { class: 'item svc', type: 'button', onclick: () => { sh.close(); onPick(guide, i); } }, [
      el('div', { class: 'when' }, [el('b', { text: svc.date ? fmtDate(svc.date, true) : (svc.dateText || '') }), el('span', { class: 'muted small', text: guides.length > 1 ? guide.title : (svc.label || t(occasionFor(svc))) })]),
      el('div', { class: 'grow' }, [el('div', { class: 'ref', text: ref ? formatRef(ref, state.settings.bookLang) : svc.reference }), el('div', { class: 'muted small', text: svc.title })]),
    ]));
  }
  sh.body.append(list);
}

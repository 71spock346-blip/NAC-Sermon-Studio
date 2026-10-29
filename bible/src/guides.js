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
 * preparation from one (text word, message and notes filled in), attaches a
 * service to a preparation made in the reader, and shows the article under
 * step 2 so the Guide is at hand while the sermon takes shape.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, busy } from './ui.js';
import { t, tn } from './i18n.js';
import { parseRef, formatRef } from './books.js';
import { state, saveGuide, deleteGuide, uid } from './store.js';
import * as AI from './ai.js';
import * as Cat from './catechism.js';

/** Loaded Guides, newest month first. */
export function all() {
  return state.guides.slice().sort((a, b) => (b.year - a.year) || (b.month - a.month) || (b.loadedAt || '').localeCompare(a.loadedAt || ''));
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

/** The first service in any loaded Guide whose text word covers this reference. */
export function matchService(ref) {
  if (!ref) return null;
  for (const guide of all()) {
    for (let i = 0; i < guide.services.length; i++) {
      const r = refOf(guide.services[i]);
      if (!r || r.book !== ref.book || r.chapter !== ref.chapter) continue;
      if (!r.verse || !ref.verse || (ref.verse <= (r.verseEnd || r.verse) && (ref.verseEnd || ref.verse) >= r.verse)) return { guide, service: guide.services[i], i };
    }
  }
  return null;
}

/** The preparations already started from a service: [{sermon}] */
export function preparationsFor(guide, i) {
  return state.sermons.filter(s => s.guideLink && s.guideLink.guideId === guide.id && s.guideLink.i === i);
}

/** What goes into "Notes from the Guide": the Summary points and the Context box. */
function notesFrom(service) {
  const out = [];
  if ((service.summary || []).length) out.push(service.summary.map(x => `• ${x}`).join('\n'));
  if (service.context) out.push(service.context);
  return out.join('\n\n');
}

/**
 * Fills a preparation from a service. Empty fields are filled; with `force`
 * the text word, title, message and notes are set even where something is
 * typed already; `fresh` says the preparation is new, so the service's date
 * and occasion are taken too. The Catechism sections the article cites are ticked.
 */
export function prefill(s, guide, i, { force = false, fresh = false } = {}) {
  const svc = guide.services[i];
  const ref = refOf(svc);
  const set = (key, value) => { if (value && (force || !s[key])) s[key] = value; };
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
  set('guide', notesFrom(svc));
  if (svc.reading && !(s.crossRefs || '').includes(svc.reading)) s.crossRefs = (s.crossRefs ? s.crossRefs.trim() + '\n' : '') + t('{reading} – reading suggested in the Guide', { reading: svc.reading });
  s.catechism = s.catechism || [];
  for (const n of svc.catechismRefs || []) {
    const sec = Cat.section(n);
    if (sec && !s.catechism.find(c => c.n === n)) s.catechism.push({ n, title: sec.title });
  }
  s.guideLink = { guideId: guide.id, i };
  return s;
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
    const older = state.guides.find(x => x.year === g.year && x.month === g.month && x.language === g.language);
    const guide = { ...g, id: older ? older.id : uid(), loadedAt: new Date().toISOString() };
    await saveGuide(guide);
    b.done();
    toast(`${guide.title}: ` + tn(guide.services.length, '{n} service read', '{n} services read') + (older ? ' ' + t('(the earlier copy was replaced)') : '') + '. ' + (AI.fmtCost(guide.cost) ? t('This cost {cost}.', { cost: AI.fmtCost(guide.cost) }) : ''));
    return guide;
  } catch (e) {
    if (e && e.name === 'AbortError') { b.done(); return null; }
    b.fail(e.message || t('The Guide could not be read.'));
    return null;
  }
}

/** Where to go when there is no key yet. */
export function noKey() {
  const s = sheet(t('Your Anthropic key is needed'));
  s.body.append(
    el('p', { text: t('Claude reads the Guide and makes the suggestions with a key of your own, so that you pay only for what you use and the key stays on this device.') }),
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

/**
 * The Guides in the Prepare list: the services of the chosen month, one tap
 * to start its preparation, and the buttons to load or remove a Guide.
 * onPrepare(guide, i) starts a preparation; onChange() redraws the tab.
 */
export function card({ onPrepare, onChange }) {
  const guides = all();
  const wrap = el('details', { class: 'guide-card', open: true });
  if (!guides.length) {
    wrap.append(
      el('summary', { text: t('Divine Service Guide') }),
      el('p', { class: 'small muted', text: t('Load this month\'s Guide (the PDF) and Claude reads every service out of it: date, text word, message, the article and its Catechism references. A preparation then starts with all of that filled in.') }),
      el('div', { class: 'row' }, [el('button', { class: 'btn small', type: 'button', text: t('Load a Guide (PDF)'), onclick: async () => { if (await load()) onChange(); } })]),
    );
    return wrap;
  }
  let current = guides[0];
  const body = el('div');
  const choose = guides.length > 1 ? el('select', { class: 'small', 'aria-label': t('Which Guide') }, guides.map(g => el('option', { value: g.id, text: `${g.title}${g.language === 'af' ? ' (Afrikaans)' : g.language === 'en' ? ' (English)' : ''}` }))) : null;
  if (choose) choose.addEventListener('change', () => { current = guides.find(g => g.id === choose.value) || guides[0]; draw(); });
  function draw() {
    clear(body);
    const list = el('div', { class: 'list' }, current.services.map((_, i) => serviceRow(current, i, onPrepare)));
    body.append(
      el('p', { class: 'small muted', text: t('Tap a service to start its preparation, or to open the one already started. Loaded {date} from "{file}".', { date: fmtDate(current.loadedAt), file: current.fileName || t('a PDF') }) }),
      list,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: t('Load another Guide'), onclick: async () => { if (await load()) onChange(); } }),
        el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove this Guide'), onclick: async () => {
          if (await confirmBox(t('Remove "{title}" from this device? Preparations made from it keep their text; you can load the PDF again later.', { title: current.title }), t('Remove'), true)) {
            await deleteGuide(current.id);
            toast(t('Guide removed.'));
            onChange();
          }
        } }),
      ]),
    );
  }
  draw();
  const title = /guide|gids|handleiding/i.test(current.title) ? current.title : t('Divine Service Guide: {title}', { title: current.title });
  wrap.append(el('summary', {}, [title, el('span', { class: 'muted small', text: ' · ' + tn(current.services.length, '{n} service', '{n} services') })]));
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
  const match = s.ref ? matchService(s.ref) : null;
  if (match) sh.body.append(el('p', { class: 'small', text: t('The {title} has a service on {reference}: it is listed first.', { title: match.guide.title, reference: match.service.reference }) }));
  const list = el('div', { class: 'list' });
  const rows = [];
  for (const guide of guides) guide.services.forEach((svc, i) => rows.push({ guide, i, svc }));
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

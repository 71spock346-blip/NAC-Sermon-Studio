/*
 * Sunday: the front door of the app, the next divine service as a minister
 * needs it on the day. The card says when and where, the text word and the
 * title, and how far the preparation is; under it, one tap to each thing
 * used at the altar: the cue cards and the sermon on the screen (read.js),
 * the altar card of the Liturgy for that kind of service (liturgy.js) and
 * the text word alone in large letters; and Altar mode (altar.js), which
 * puts the cue cards and the altar card on one full screen, a swipe apart,
 * for the service itself. After the service, "Mark as held"
 * puts the next service in its place (the toast has Undo), and "Service
 * record" opens the form for the district's WhatsApp group (record.js). The
 * two services after it are listed under the card.
 *
 * The next service is the first still to come: a preparation with a date
 * that is not marked as held, or a service of a loaded Divine Service Guide
 * with no preparation yet, which one tap starts, filled from the Guide as
 * under Prepare (prepare.js newFromService). When nothing is to come, the
 * last preparation not marked as held is shown, so that it can be marked. A
 * past service not marked as held is named under the card while a next one
 * shows, with the same button, so the list of preparations clears itself.
 *
 * The app opens here (app.js), and Sunday is the first tab of the phone's
 * bar and of the PC's menu (index.html). Nothing on this screen is Claude's
 * work: a locked device (lock.js) shows the same, only without the line that
 * says a Guide can be loaded.
 */
import { el, clear, fmtDate, today } from './ui.js';
import { t, tn, locale } from './i18n.js';
import { state, saveSermon } from './store.js';
import { formatRef } from './books.js';
import * as Guides from './guides.js';
import * as Read from './read.js';
import { cardFor } from './liturgy.js';   // the altar card for a kind of service
import { newFromService, FILLED, markHeld } from './prepare.js';   // markHeld: the same routine as under a past service in the Prepare list
import { sermonParts } from './pdf.js';
import { cueParts, cuesOf } from './cues.js';
import * as AI from './ai.js';
import { numbers as hymnNumbers } from './hymns.js';   // the hymns of the service, by number, on the card
import { packSheet, packLine } from './pack.js';   // the Sunday pack: the cue cards and the altar card as one PDF, printed in one go

const DAY = 86400000;
const noon = date => new Date(date + 'T12:00:00');
/** Days from today to a date: 0 today, 1 tomorrow, -1 yesterday. */
const daysTo = date => Math.round((noon(date) - noon(today())) / DAY);
/** "Sunday 22 November 2026", in the app's language. */
const longDate = date => noon(date).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** The text word's reference, with the book names as set. */
const refText = s => (s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || ''));

const STATUS = { draft: 'Draft', ready: 'Ready', held: 'Held' };

/* The icons of the rows, drawn like the tabs' (index.html). */
const CARDS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg>';
const SERMON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v5h5"/><path d="M8.5 12h7M8.5 16h7"/></svg>';
const CHALICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h11l-.9 6.2A4.6 4.6 0 0 1 12 13a4.6 4.6 0 0 1-4.6-3.8z"/><path d="M12 13v5.5"/><path d="M8 21h8"/><path d="M8.5 18.5h7"/></svg>';
const WORD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5c3-1 6-1 9 .5v14c-3-1.5-6-1.5-9-.5z"/><path d="M21 5.5c-3-1-6-1-9 .5v14c3-1.5 6-1.5 9-.5z"/></svg>';
const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>';

/** "Today", "Tomorrow", "In 3 days", "Yesterday" or "4 days ago". */
function daysWord(date) {
  const n = daysTo(date);
  if (n === 0) return t('Today');
  if (n === 1) return t('Tomorrow');
  if (n === -1) return t('Yesterday');
  return n > 0 ? t('In {n} days', { n }) : t('{n} days ago', { n: -n });
}

/*
 * What stands for a service here: {date, s} for a preparation, or
 * {date, guide, i, svc} for a service of a loaded Guide with no preparation
 * yet. `as` has the shape of a preparation for either, for the reference and
 * the text word in large letters (read.js word).
 */
function ofGuide(guide, i) {
  const svc = guide.services[i];
  const as = { date: svc.date, occasion: Guides.occasionFor(svc), ref: Guides.refOf(svc), refText: svc.reference || '', text: svc.bibleText || '', translation: '', title: svc.title || '' };
  return { date: svc.date, guide, i, svc, as };
}

/**
 * The services, nearest first: `ahead`, those still to come (today counts),
 * and `behind`, the preparations with a past date not marked as held, newest
 * first. A Guide's service counts once, in the Guide of the language the
 * person preaches in when both are loaded, and not once a preparation was
 * started from it (that preparation is in the list, or is held).
 */
function services() {
  const now = today();
  const items = state.sermons.filter(s => s.date && s.status !== 'held').map(s => ({ date: s.date, s, as: s }));
  const usual = AI.langOf(null);
  const seen = new Set();
  for (const guide of Guides.all().sort((a, b) => (a.language === usual ? 0 : 1) - (b.language === usual ? 0 : 1))) {
    guide.services.forEach((svc, i) => {
      if (!svc.date || svc.date < now) return;
      const ref = Guides.refOf(svc);
      const key = svc.date + '|' + (ref ? `${ref.book}.${ref.chapter}` : (svc.reference || '').toLowerCase());
      if (seen.has(key)) return;   // the same service in the Guide of the other language
      seen.add(key);
      if (Guides.preparationsFor(guide, i).length) return;
      items.push(ofGuide(guide, i));
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { ahead: items.filter(x => x.date >= now), behind: items.filter(x => x.s && x.date < now).reverse() };
}

/** The heading: "This Sunday" while the next service is this week's Sunday, else "The next service"; "The last service" for one gone by. */
function heading(next, past) {
  if (!next) return t('This Sunday');
  if (past) return t('The last service');
  return noon(next.date).getDay() === 0 && daysTo(next.date) <= 6 ? t('This Sunday') : t('The next service');
}

/** The status pill and "5 of 7 steps filled": the steps of the sermon itself, as the editor's step bar marks them (prepare.js FILLED). */
function stateLine(s) {
  const keys = Object.keys(FILLED);
  const n = keys.filter(k => FILLED[k](s)).length;
  const v = STATUS[s.status] ? s.status : 'draft';
  return el('div', { class: 'sunday-state' }, [
    el('span', { class: 'pill status ' + v, text: t(STATUS[v]) }),
    el('span', { class: 'muted', text: t('{n} of {m} steps filled', { n, m: keys.length }) }),
  ]);
}

/** The card of the next service: when and where, the text word, the title, how far the preparation is, and the buttons. */
function card(x, past, redraw) {
  const s = x.s;
  const where = (s ? [s.congregation, s.occasion ? t(s.occasion) : ''] : [x.svc.label || t(Guides.occasionFor(x.svc))]).filter(Boolean);
  const title = s ? (s.title || s.theme || '') : (x.svc.title || '');
  const over = daysTo(x.date) <= 0;   // the day has come: the service can be marked as held
  return el('div', { class: 'sunday-card' }, [
    el('div', { class: 'sunday-when' }, [el('b', { text: longDate(x.date) }), el('span', { class: 'pill day' + (past ? ' past' : ''), text: daysWord(x.date) })]),
    where.length ? el('div', { class: 'muted small sunday-where', text: where.join(' · ') }) : null,
    el('div', { class: 'sunday-ref', text: refText(x.as) || t('No text word yet') }),
    title ? el('p', { class: 'sunday-title', text: title }) : null,
    s && hymnNumbers(s) ? el('div', { class: 'muted small sunday-hymns', text: t('Hymns {list}', { list: hymnNumbers(s) }) }) : null,
    s ? stateLine(s) : el('div', { class: 'sunday-state' }, [el('span', { class: 'pill status', text: t('Not started yet') })]),
    el('div', { class: 'row' }, s ? [
      // the service itself: the cue cards and the altar card on one full screen (altar.js)
      el('a', { class: 'btn altar-btn', href: `#altar/${s.id}` }, [el('span', { class: 'ico', 'aria-hidden': 'true', html: CHALICE }), t('Altar mode')]),
      el('a', { class: 'btn ghost', href: `#prepare/${s.id}`, text: t('Open the preparation') }),
      over ? el('button', { class: 'btn ghost', type: 'button', text: t('Mark as held'), onclick: () => markHeld(s, redraw) }) : null,
      over ? el('a', { class: 'btn ghost', href: `#record/${s.id}`, text: t('Service record') }) : null,   // the form for the district's WhatsApp group, filled in after the service (record.js)
    ] : [
      el('button', { class: 'btn', type: 'button', text: t('Prepare this service'), onclick: () => newFromService(x.guide, x.i) }),
    ]),
  ]);
}

/** A service gone by that is not marked as held yet, named under the card with the button to mark it. */
function heldLine(x, redraw) {
  return el('div', { class: 'sunday-held' }, [
    el('span', { class: 'grow', text: t('{service} is not marked as held yet.', { service: [fmtDate(x.date, true), refText(x.s)].filter(Boolean).join(' · ') }) }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Mark as held'), onclick: () => markHeld(x.s, redraw) }),
  ]);
}

/** A row like those of More: the icon, the name, one line under it and a chevron; a link with `href`, else a button that runs `onclick`. */
function row(icon, name, line, { href = null, onclick = null, lang: l = null } = {}) {
  return el(href ? 'a' : 'button', { class: 'more-row', href, type: href ? null : 'button', onclick }, [
    el('span', { class: 'ico', 'aria-hidden': 'true', html: icon }),
    el('span', { class: 'grow' }, [el('b', { text: name, lang: l }), el('span', { class: 'muted small', text: line })]),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
  ]);
}

/** "Introduction · 3 main points · Application · Conclusion": what the cue cards hold, or that they hold nothing yet. */
function cuesLine(s, service) {
  const parts = cueParts(s, { service, lang: AI.langOf(s) }).filter(p => cuesOf(p).length);
  if (!parts.length) return t('Nothing on the cards yet');
  const points = parts.filter(p => p.key === 'point').length;
  return [
    parts.some(p => p.key === 'intro') ? t('Introduction') : '',
    points ? tn(points, '{n} main point', '{n} main points') : '',
    parts.some(p => p.key === 'application') ? t('Application') : '',
    parts.some(p => p.key === 'conclusion') ? t('Conclusion') : '',
  ].filter(Boolean).join(' · ');
}

/** The rows under "At the altar": the cue cards and the sermon (a preparation only), the altar card and the text word in large letters, and, for a preparation, the Sunday pack to print. */
function altarRows(x, service) {
  const s = x.s;
  const { key, card, l, bk } = cardFor(s ? s.occasion : Guides.occasionFor(x.svc));   // liturgy.js: the card for this kind of service
  const rows = [];
  if (s) {
    rows.push(row(CARDS, t('Cue cards'), cuesLine(s, service), { onclick: () => Read.cues(s, { service }) }));
    rows.push(row(SERMON, t('The sermon'), sermonParts(s).empty ? t('Nothing written yet') : t('Read it on the screen in large letters'), { onclick: () => Read.sermon(s) }));
  }
  rows.push(card
    ? row(CHALICE, t('Altar card: {card}', { card: card.title }), t('The words at the altar, in large letters'), { href: `#liturgy/${key}`, lang: l })
    : row(CHALICE, t('Altar card'), t('Load the altar booklet under Handbooks first'), { href: '#liturgy' }));
  rows.push(row(WORD, t('The text word, large'), [refText(x.as), x.as.translation].filter(Boolean).join(' · ') || t('No text word yet'), { onclick: () => Read.word(x.as) }));
  // on paper: the cue cards and the altar card as one PDF, printed in one go (pack.js)
  if (s) rows.push(row(PRINT, t('Sunday pack'), packLine(card), { onclick: () => packSheet(s, { service, card, bk }) }));
  return rows;
}

/** A service after the next one: a row to its preparation, or one that starts the preparation of a Guide's service. */
function laterRow(x) {
  const name = `${fmtDate(x.date, true)} · ${refText(x.as) || t('No text word yet')}`;
  if (x.s) return row(CAL, name, [x.s.title || x.s.theme || '', t(STATUS[x.s.status] || 'Draft')].filter(Boolean).join(' · '), { href: `#prepare/${x.s.id}` });
  return row(CAL, name, [x.svc.title || '', t('Not started yet')].filter(Boolean).join(' · '), { onclick: () => newFromService(x.guide, x.i) });
}

/** While there is no service at all: where to start. Reading a Guide's PDF is Claude's work, the minister's own (lock.js); a locked device is told of the Guide file another minister sends (guides.js). */
function empty() {
  const guide = !Guides.all().length;
  return el('div', { class: 'sunday-card sunday-empty' }, [
    el('p', { text: t('No service is planned yet.') }),
    el('p', { class: 'muted small', text: !guide
      ? t('Start a preparation under Prepare: it shows here with its date, its text word and its cue cards.')
      : AI.unlocked()
        ? t('Start a preparation under Prepare, or load this month\'s Guide there: its services then show here, with one tap to prepare each.')
        : t('Start a preparation under Prepare, or load the month\'s Guide there, the file another minister sent you: its services then show here, with one tap to prepare each.') }),
    el('div', { class: 'row' }, [el('a', { class: 'btn', href: '#prepare', text: t('Go to Prepare') })]),
  ]);
}

export function render(container) {
  clear(container);
  const redraw = () => render(container);
  const { ahead, behind } = services();
  const past = !ahead.length && behind.length > 0;
  const next = ahead[0] || behind[0] || null;
  const page = el('div', { class: 'sunday' }, [el('div', { class: 'docbar' }, [el('h2', { text: heading(next, past) })])]);
  if (!next) {
    page.append(empty());
    container.append(page);
    return;
  }
  page.append(card(next, past, redraw));
  if (!past && behind.length) page.append(heldLine(behind[0], redraw));
  const service = next.s ? (Guides.findService(next.s) || {}).service : next.svc;   // the Guide's article: its introduction gives the cues while the minister's own is empty
  page.append(
    el('h3', { class: 'sub', text: t('At the altar') }),
    el('nav', { class: 'more-list sunday-rows', 'aria-label': t('At the altar') }, [el('div', { class: 'more-group' }, altarRows(next, service))]),
  );
  const later = ahead.slice(1, 3);
  if (later.length) {
    page.append(
      el('h3', { class: 'sub', text: t('After that') }),
      el('div', { class: 'more-list sunday-rows' }, [el('div', { class: 'more-group' }, later.map(laterRow))]),
    );
  }
  container.append(page);
}

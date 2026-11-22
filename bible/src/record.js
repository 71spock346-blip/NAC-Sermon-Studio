/*
 * Service record: NACSA's "Pastoral – Service Record" form, filled in on the
 * phone after a service and sent to the district's WhatsApp group, with a PDF
 * for the file. The form's lines are here as the office knows them: the
 * service (ref no, the times, who conducted and who assisted), the hymns
 * (opening, call up, after the text word, repentance, Holy Communion,
 * closing), the attendance, the offerings by note with the totals worked out,
 * the Apostle's acts (sealings and ordinations), the remarks, who completed
 * the record and who captured it on MIS.
 *
 * The record belongs to the preparation of the service (s.record): it is
 * saved with it as it is typed, goes with the sync and sits in the backup.
 * What the preparation knows is filled in: the congregation, the date, the
 * text word and the kind of service head the screen; the hymns, the
 * minister's name and the service's usual time (the month plan's settings)
 * start the form. #record/<id> opens it: the Sunday card offers it once the
 * day has come, and the preparation's Print step always. Service record has
 * a tab of its own on the phone's bar and in the PC's menu (Jerome's order,
 * November 2026: Read, Prepare, Sunday, Notes, Service record, More): #record
 * alone opens the service just held (serviceFor: today's, else the last one,
 * else the next), and "Which service" above the record goes to another.
 *
 * "The form" shows the record on NACSA's paper form, as record-form.js draws
 * it (paper() gives what goes on its lines): "Send as a picture" hands a PNG
 * of it to the phone's share sheet, where WhatsApp and the group are chosen;
 * "Send as PDF" does the same with an A5 PDF of it; "Two on one A4" makes the
 * A4 sheet with two forms side by side, as the paper is printed. The form is
 * in English, as the paper is. "The message" is the record as typed lines:
 * "Send to WhatsApp" opens WhatsApp with it typed in (wa.me, as the greetings
 * of Reminders do), "Copy" puts it on the clipboard; it is in the language of
 * the app.
 */
import { el, clear, toast, copyText, fmtDate, today } from './ui.js';
import { state, saveSermon } from './store.js';
import { t, locale } from './i18n.js';
import { formatRef, parseRef } from './books.js';
import * as Pdf from './pdf.js';
import { serviceTimes } from './plan.js';   // the usual time of a Sunday and a midweek service
import { formPdf, formPicture, preview as drawPaper } from './record-form.js';
import * as Apostle from './apostle.js';   // a Sunday an Apostle holds with his own word: its record, who conducted it
import * as Fill from './fill.js';   // the deacons' link: the record filled in on their phones
import { norm as hymnNorm, withBook } from './hymns.js';   // "hc12" → "HC 12", "e 104" → "E 104", as the Prepare boxes write them; "104" from Prepare → "HC 104"

const DENOMS = [10, 20, 50, 100, 200];
const HYMNS = ['opening', 'callUp', 'afterText', 'repentance', 'communion', 'closing'];
/** Between two hymns in one box (the call-up hymns): "A 12, E 7", "12 and 7", "12 en 7". */
const HYMN_SEP = /(\s*[,;/&]\s*|\s+(?:and|en)\s+)/i;
/** Each number in a hymn box written the usual way, what is between them kept: "hc12, e 104" → "HC 12, E 104". */
export const tidyHymns = text => String(text == null ? '' : text).split(HYMN_SEP).map((part, i) => (i % 2 ? part : hymnNorm(part))).join('').trim();
const MINISTRIES = [['DC', 'Deacon'], ['PR', 'Priest'], ['CEV', 'Community Evangelist'], ['SH', 'Shepherd'], ['CEL', 'Community Elder'], ['DEV', 'District Evangelist'], ['DEL', 'District Elder']];
const SAVE_AFTER = 400;   // ms after the last keystroke
/* ------------------------------------------------------------- the record */

/** A preparation's record with every field present, empty where nothing was typed. */
export function recordOf(s) {
  const r = s.record || {};
  return {
    refNo: r.refNo || '', start: r.start || '', end: r.end || '',
    conductedBy: r.conductedBy || '', assistedBy: r.assistedBy || '',
    hymns: { opening: '', callUp: '', afterText: '', repentance: '', communion: '', closing: '', ...(r.hymns || {}) },
    attendance: { adults: '', children: '', visitors: '', ...(r.attendance || {}) },
    offerings: { n10: '', n20: '', n50: '', n100: '', n200: '', coins: '', ...(r.offerings || {}) },
    sealing: { adults: '', children: '', babies: '', ...(r.sealing || {}) },
    ordination: { DC: '', PR: '', CEV: '', SH: '', CEL: '', DEV: '', DEL: '', ...(r.ordination || {}) },
    remarks: r.remarks || '', completedBy: r.completedBy || '', capturedBy: r.capturedBy || '',
  };
}

/** The record as it starts, before anything is typed: the hymns of the preparation (each with its book: Prepare's "104" is "HC 104" here), the minister's name, the service's usual time. */
export function started(s) {
  const r = recordOf(s);
  const h = s.hymns || {};
  r.hymns.opening = withBook(h.opening); r.hymns.afterText = withBook(h.sermon); r.hymns.communion = withBook(h.communion); r.hymns.closing = withBook(h.closing);
  r.conductedBy = s.apostle ? Apostle.conductor(s) : (state.settings.name || '');   // "AP Page" on the Apostle's Sunday
  r.completedBy = state.settings.name || '';
  const day = s.date ? new Date(s.date + 'T12:00:00').getDay() : -1;
  const times = serviceTimes();
  r.start = day === 0 ? times.sunday : day === 3 ? times.midweek : '';
  return r;
}

const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const any = obj => Object.values(obj).some(v => String(v).trim() !== '');
const count = n => String(Math.round(n));
export const attendanceTotal = r => num(r.attendance.adults) + num(r.attendance.children) + num(r.attendance.visitors);
export const offeringsTotal = r => DENOMS.reduce((sum, d) => sum + num(r.offerings['n' + d]) * d, 0) + num(r.offerings.coins);
const sealingTotal = r => num(r.sealing.adults) + num(r.sealing.children) + num(r.sealing.babies);
const ordinationTotal = r => MINISTRIES.reduce((sum, [c]) => sum + num(r.ordination[c]), 0);
/** "R 1 257,50", in the app's language. */
export const rand = n => 'R ' + n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the preparation says of the service: the congregation, the day, the text word, the kind of service. */
function header(s) {
  return {
    congregation: s.congregation || state.settings.congregation || '',
    date: s.date ? new Date(s.date + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '',
    ref: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || ''),
    kind: t(s.occasion || 'Sunday divine service'),
  };
}
const timeSpan = r => [r.start, r.end].filter(Boolean).join('–');
const hymnWord = { opening: () => t('opening'), callUp: () => t('call up'), afterText: () => t('after the text word'), repentance: () => t('repentance'), communion: () => t('Holy Communion'), closing: () => t('closing') };
const hymnLabel = { opening: () => t('Opening hymn'), callUp: () => t('Call-up hymn'), afterText: () => t('After the text word'), repentance: () => t('Repentance hymn'), communion: () => t('Holy Communion'), closing: () => t('Closing hymn') };
const offeringLines = r => [
  ...DENOMS.filter(d => r.offerings['n' + d]).map(d => `R${d} × ${count(num(r.offerings['n' + d]))} = ${rand(num(r.offerings['n' + d]) * d)}`),
  r.offerings.coins ? `${t('coins')} ${rand(num(r.offerings.coins))}` : '',
].filter(Boolean);

/** The lines of the record as the WhatsApp group reads them; a line with nothing in it is left out. */
export function lines(s) {
  const r = recordOf(s), h = header(s), L = [];
  L.push([`*${t('Service record')}*`, h.congregation].filter(Boolean).join(' · '));
  L.push([h.date, timeSpan(r)].filter(Boolean).join(' · '));
  L.push([h.kind, h.ref].filter(Boolean).join(' · '));
  if (r.refNo) L.push(`${t('Ref no')}: ${r.refNo}`);
  const hy = HYMNS.filter(k => r.hymns[k]).map(k => `${hymnWord[k]()} ${r.hymns[k]}`);
  if (hy.length) L.push(`${t('Hymns')}: ${hy.join(' · ')}`);
  const a = r.attendance;
  if (any(a)) L.push(`${t('Attendance')}: ${t('adults')} ${count(num(a.adults))}, ${t('children')} ${count(num(a.children))}, ${t('visitors')} ${count(num(a.visitors))} — ${t('total')} ${count(attendanceTotal(r))}`);
  if (any(r.offerings)) L.push(`${t('Offerings')}: ${offeringLines(r).join(' · ')} — ${t('total')} ${rand(offeringsTotal(r))}`);
  if (any(r.sealing)) L.push(`${t('Sealing')}: ${t('adults')} ${count(num(r.sealing.adults))}, ${t('children')} ${count(num(r.sealing.children))}, ${t('NAC babies')} ${count(num(r.sealing.babies))} — ${t('total')} ${count(sealingTotal(r))}`);
  if (any(r.ordination)) L.push(`${t('Ordination')}: ${MINISTRIES.filter(([c]) => r.ordination[c]).map(([c]) => `${c} ${count(num(r.ordination[c]))}`).join(', ')} — ${t('total')} ${count(ordinationTotal(r))}`);
  if (r.conductedBy) L.push(`${t('Conducted by')}: ${r.conductedBy}`);
  if (r.assistedBy) L.push(`${t('Assisted by')}: ${r.assistedBy}`);
  if (r.remarks) L.push(`${t('Remarks')}: ${r.remarks}`);
  if (r.completedBy) L.push(`${t('Completed by')}: ${r.completedBy}`);
  if (r.capturedBy) L.push(`${t('Captured on MIS by')}: ${r.capturedBy}`);
  return L.filter(Boolean);
}
export const recordText = s => lines(s).join('\n');

/* ---------------------------------------------------------- the paper form */

/** "R 1 257,50" as the English form writes it. */
const randEn = n => 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What goes on the paper form's lines (record-form.js), keyed by its blanks,
 * in English as the paper is: the service from the preparation, the hymns
 * (the call-up hymns one to a blank: "12, 33"), the counts, the offerings in
 * rand by note with the total, the Apostle's acts with their totals. A part
 * with nothing typed stays blank; in a part that has something, an empty
 * count is 0 (attendance, sealing), and an empty note or ministry is blank.
 */
export function paper(s) {
  const r = recordOf(s);
  const v = {
    refNo: r.refNo,
    congregation: s.congregation || state.settings.congregation || '',
    date: s.date ? new Date(s.date + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
    ref: s.ref ? formatRef(s.ref, 'en') : (s.refText || ''),
    start: r.start, end: r.end,
    kind: s.occasion || 'Sunday divine service',
    opening: r.hymns.opening, afterText: r.hymns.afterText, repentance: r.hymns.repentance, communion: r.hymns.communion, closing: r.hymns.closing,
    conductedBy: r.conductedBy, assistedBy: r.assistedBy, remarks: r.remarks, completedBy: r.completedBy, capturedBy: r.capturedBy,
  };
  const calls = String(r.hymns.callUp || '').split(HYMN_SEP).filter((x, i) => i % 2 === 0).map(x => x.trim()).filter(Boolean);
  v.callUp1 = calls[0] || ''; v.callUp2 = calls[1] || ''; v.callUp3 = calls.slice(2).join(', ');
  const a = r.attendance;
  if (any(a)) Object.assign(v, { 'att.adults': count(num(a.adults)), 'att.children': count(num(a.children)), 'att.visitors': count(num(a.visitors)), 'att.total': count(attendanceTotal(r)) });
  if (any(r.offerings)) {
    for (const d of DENOMS) if (String(r.offerings['n' + d]).trim()) v['off.' + d] = randEn(num(r.offerings['n' + d]) * d);
    if (String(r.offerings.coins).trim()) v['off.coins'] = randEn(num(r.offerings.coins));
    v['off.total'] = randEn(offeringsTotal(r));
  }
  const sl = r.sealing;
  if (any(sl)) Object.assign(v, { 'seal.adults': count(num(sl.adults)), 'seal.children': count(num(sl.children)), 'seal.babies': count(num(sl.babies)), 'seal.total': count(sealingTotal(r)) });
  if (any(r.ordination)) {
    for (const [c] of MINISTRIES) if (String(r.ordination[c]).trim()) v['ord.' + c] = count(num(r.ordination[c]));
    v['ord.total'] = count(ordinationTotal(r));
  }
  return v;
}

const named = (s, suffix, ext) => Pdf.fileName(s, suffix).replace(/\.pdf$/, ext);

/** The paper form as a PDF: one A5 page, or with two: true the A4 sheet with two forms side by side; {blob, name, title}. */
export function recordPdf(s, { two = false } = {}) {
  return {
    blob: formPdf(paper(s), { two }),
    name: named(s, two ? '-service-record-A4' : '-service-record', '.pdf'),
    title: `${t('Service record')}: ${header(s).ref || header(s).date}`,
  };
}

/** The paper form as a picture (PNG) for the WhatsApp group; a Promise of {blob, name, title}. */
export async function recordPicture(s) {
  return { blob: await formPicture(paper(s)), name: named(s, '-service-record', '.png'), title: `${t('Service record')}: ${header(s).ref || header(s).date}` };
}

/** Hands a file to the share sheet (WhatsApp and the group are chosen there), or saves it where there is none. */
async function send(r, type) {
  const file = new File([r.blob], r.name, { type });
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: r.title });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  Pdf.download(r);
  return 'saved';
}

/* -------------------------------------------------------------- the screen */

let timer = null;

function section(title, children) {
  return el('section', { class: 'sec' }, [el('div', { class: 'docbar' }, [el('h2', { text: title })]), ...children]);
}

/** The preparations that have a date, the latest first: the services a record can be kept for. */
function dated(list = state.sermons) {
  return list.filter(s => s.date).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The service the bar's Service record opens when none is named (#record):
 * today's, else the last one before today (the service just held, whose
 * record is due), else the next one; null while no preparation has a date.
 */
export function serviceFor(list = state.sermons, now = today()) {
  const all = dated(list);
  return all.find(s => s.date === now) || all.find(s => s.date < now) || all.filter(s => s.date > now).pop() || null;
}

/** "Sun 22 Nov 2026 · John 1:1-3", and the congregation when it is not the usual one: a service in the list to choose from. */
function serviceName(s) {
  const usual = state.settings.congregation || '';
  return [s.date ? fmtDate(s.date, true) : t('No date'), s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || ''), s.apostle ? Apostle.whoServes(s) : '', s.congregation && s.congregation !== usual ? s.congregation : ''].filter(Boolean).join(' · ');
}

/** "Which service": the services up to today, the latest first, and the one open (a later one, or one with no date, opened from its preparation). Nothing while there is no other to choose. */
function picker(s) {
  const now = today();
  const list = dated().filter(x => x.date <= now).slice(0, 40);
  if (!list.includes(s)) {
    if (s.date && s.date <= now) list.push(s);
    else list.unshift(s);
  }
  if (list.length < 2) return null;
  const choose = el('select', {}, list.map(x => el('option', { value: x.id, text: serviceName(x), selected: x === s })));
  choose.addEventListener('change', () => { location.hash = '#record/' + choose.value; });
  return el('label', { class: 'f record-pick' }, [el('span', { text: t('Which service') }), choose]);
}

export function render(container, route) {
  clear(container);
  const id = route && route[1];
  if (!id) {
    // the bar's Service record: the service just held, with its address, so a reload or the back button keeps it
    const s = serviceFor();
    if (s) {
      history.replaceState(null, '', '#record/' + s.id);
      render(container, ['record', s.id]);
      return;
    }
    container.append(el('div', { class: 'record' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: t('Service record') })]),
      el('p', { text: t('No service with a date yet.') }),
      el('p', { class: 'muted small', text: t('A service record is kept with the preparation of that service. Start one under Prepare, with the date of the service, and its record opens here.') }),
      el('div', { class: 'row' }, [el('a', { class: 'btn', href: '#prepare', text: t('Go to Prepare') })]),
    ]));
    return;
  }
  const s = state.sermons.find(x => x.id === id);
  if (!s) {
    container.append(el('div', { class: 'record' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: t('Service record') })]),
      el('p', { class: 'muted', text: t('No preparation has this address.') }),
      el('div', { class: 'row' }, [el('a', { class: 'btn ghost', href: '#sunday', text: t('Sunday') })]),
    ]));
    return;
  }
  recordView(container, s);
}

/**
 * One service's record on the screen: the minister's, from his preparation
 * `s`; or with opts.fill, the page a deacon opens with the link (fill.js),
 * where `s` stands for the service the link shows and opts.fill is
 * {status: an element for "Sent", save(record)}. A deacon's page has no way
 * to the preparation, no choice of service, no Apostle's word to mark, no
 * deacons' link and no sending: only the form. Gives {el, sid, current(),
 * apply(record)}, so the other side's lines can come into the boxes.
 */
export function recordView(container, s, opts = {}) {
  const fill = opts.fill || null;
  const r = s.record ? recordOf(s) : started(s);
  const h = header(s);
  const page = el('div', { class: 'record' + (fill ? ' fill' : '') });
  // the Apostle's Sunday has no preparation of the minister's own to open
  page.append(el('div', { class: 'docbar' }, [el('h2', { text: t('Service record') }), el('span', { class: 'spacer' }), fill ? fill.status : s.apostle ? null : el('a', { class: 'btn small ghost', href: `#prepare/${s.id}`, text: t('Open the preparation') })]));
  const pick = fill ? null : picker(s);
  if (pick) page.append(pick);
  const headLine = el('div', { class: 'muted small', text: [h.kind, h.ref].filter(Boolean).join(' · ') });
  page.append(el('div', { class: 'record-head' }, [
    el('b', { text: [h.congregation, h.date].filter(Boolean).join(' · ') }),
    headLine,
  ]));
  if (fill) {
    // nothing of the minister's but the record itself
  } else if (s.apostle) {
    // "Apostle Page serves with his own word. The Guide's word for this Sunday, Galatians 6:9, is on Wed, 25 Nov 2026.", and the way back
    page.append(el('div', { class: 'record-apostle' }, [
      el('p', { text: Apostle.apostleLine(s) }),
      Apostle.backButton(s, () => { clearTimeout(timer); location.hash = '#record'; }),
    ]));
  } else if (Apostle.canMark(s)) {
    // a Sunday of the minister's own: an Apostle or a District Apostle may hold it with a word of his own
    page.append(el('div', { class: 'record-apostle' }, [
      el('p', { class: 'muted', text: t('Did an Apostle or District Apostle bring his own word?') }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Apostle\'s own word'), onclick: async () => {
        if (timer) { clearTimeout(timer); timer = null; await save(); }   // what was just typed stays with this Sunday's record, which goes with the Sunday
        Apostle.markSheet(s.date, e => { location.hash = '#record/' + (e ? e.id : s.id); });
      } }),
    ]));
  }
  page.append(el('p', { class: 'small muted', text: fill
    ? t('NACSA’s service record, for the minister who sent you the link. What you type goes to him as you type it; he checks it and sends it to the district.')
    : t('NACSA’s service record, filled in from the preparation where it can be; what you type is kept as you go. When the service is over, send it to the WhatsApp group: the office captures it on MIS within 24 hours.') }));
  // the deacons' link (fill.js): made here, and whether it shows this service
  let fillBox = null, boxKey = '';
  const drawFillBox = () => {
    const key = Fill.boxKey(s);
    if (fillBox && key === boxKey) return;
    boxKey = key;
    const b = Fill.ownerBox(s, () => { drawFillBox(); if (Fill.linkOn()) Fill.watch(api); });
    if (fillBox) fillBox.replaceWith(b);
    fillBox = b;
  };
  if (!fill) { drawFillBox(); page.append(fillBox); }

  const inputs = {};   // 'attendance.adults' -> its input
  const valueAt = path => { const [a, b] = path.split('.'); return b ? r[a][b] : r[a]; };
  const field = (path, label, attrs = {}, extra = null) => {
    const input = el(attrs.tag || 'input', { type: attrs.tag ? null : attrs.type || 'text', value: attrs.tag ? null : valueAt(path), inputmode: attrs.inputmode || null, min: attrs.min, step: attrs.step, placeholder: attrs.placeholder || null, rows: attrs.rows, 'aria-label': label, ...(attrs.input || {}) });
    if (attrs.tag) input.value = valueAt(path);
    inputs[path] = input;
    input.addEventListener('input', changed);
    return el('label', { class: [attrs.plain ? '' : 'f', attrs.full ? 'full' : ''].join(' ').trim() || null }, [el('span', { text: label }), input, extra]);
  };
  const n = (path, label) => field(path, label, { type: 'number', inputmode: 'numeric', min: '0', step: '1' });
  /**
   * A hymn box: the whole keyboard, starting in capitals, since the book's
   * letters go before the number: A 104 (Afrikaans), E 104 (English), HC 12
   * (the Hymn Collection). On leaving the box each number is written the
   * usual way ("hc12, e 104" becomes "HC 12, E 104").
   */
  const hymnBox = k => {
    const box = field('hymns.' + k, hymnLabel[k](), { placeholder: t('e.g. E 104'), input: { autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' } });
    const input = inputs['hymns.' + k];
    input.addEventListener('change', () => {
      const v = tidyHymns(input.value);
      if (v !== input.value) { input.value = v; changed(); }
    });
    return box;
  };
  const total = () => el('p', { class: 'record-total' });
  const totals = { attendance: total(), offerings: total(), sealing: total(), ordination: total() };

  // his text word, on the Apostle's Sunday: it is known once he has read it, and goes on the form and in the message
  let word = null;
  if (s.apostle && !fill) {
    word = el('input', { type: 'text', value: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || ''), placeholder: t('e.g. Matthew 5:9'), autocomplete: 'off', 'aria-label': t('His text word') });
    word.addEventListener('input', () => {
      const v = word.value.trim();
      s.refText = v;
      s.ref = v ? parseRef(v) || null : null;
      const hd = header(s);
      headLine.textContent = [hd.kind, hd.ref].filter(Boolean).join(' · ');
      changed();
    });
    word.addEventListener('change', () => { if (s.ref) word.value = formatRef(s.ref, state.settings.bookLang); });   // "mat 5:9" is written "Matthew 5:9"
  }
  page.append(section(t('The service'), [
    el('div', { class: 'fields two' }, [
      word ? el('label', { class: 'f full' }, [el('span', { text: t('His text word') }), word]) : null,
      field('refNo', t('Ref no')),
      el('div', { class: 'fields record-times' }, [field('start', t('Start time'), { type: 'time' }), field('end', t('End time'), { type: 'time' })]),
      field('conductedBy', t('Conducted by')),
      field('assistedBy', t('Assisted by')),
    ]),
  ]));
  page.append(section(t('Hymns'), [
    el('div', { class: 'fields cols', style: '--cols: 3; --phone-cols: 2' }, HYMNS.map(hymnBox)),
  ]));
  page.append(section(t('Attendance'), [
    el('div', { class: 'fields cols' }, [n('attendance.adults', t('Adults')), n('attendance.children', t('Children')), n('attendance.visitors', t('Visitors'))]),
    totals.attendance,
  ]));
  page.append(section(t('Offerings'), [
    el('p', { class: 'small muted', text: t('The number of notes of each; the rand are worked out.') }),
    el('div', { class: 'fields cols' }, [...DENOMS.map(d => n('offerings.n' + d, t('R{n} notes', { n: d }))), field('offerings.coins', t('Coins (R)'), { type: 'number', inputmode: 'decimal', min: '0', step: '0.01' })]),
    totals.offerings,
  ]));
  page.append(section(t('Apostle service'), [
    el('p', { class: 'small muted', text: t('Only when the Apostle served: the sealings and the ordinations.') }),
    el('h3', { class: 'sub', text: t('Sealing') }),
    el('div', { class: 'fields cols' }, [n('sealing.adults', t('Adults')), n('sealing.children', t('Children')), n('sealing.babies', t('NAC babies'))]),
    totals.sealing,
    el('h3', { class: 'sub', text: t('Ordination') }),
    el('div', { class: 'record-grid' }, MINISTRIES.map(([c, name]) => field('ordination.' + c, c, { type: 'number', inputmode: 'numeric', min: '0', step: '1', plain: true }, el('small', { text: t(name) })))),
    totals.ordination,
  ]));
  page.append(section(t('Remarks'), [
    el('div', { class: 'fields' }, [field('remarks', t('Details of acts and blessings'), { tag: 'textarea', rows: 3, full: true, placeholder: t('e.g. a blessing for a wedding anniversary, a child dedicated') })]),
  ]));
  page.append(section(t('Completed'), [
    el('div', { class: 'fields two' }, [field('completedBy', t('Completed by')), field('capturedBy', t('Captured on MIS by'))]),
    el('p', { class: 'small muted', text: t('Please ensure these details are captured on MIS under Activity Record Capture within 24 hours of the service.') }),
  ]));

  // the record on the paper form, then as typed lines, and the ways out
  const withRecord = () => ({ ...s, record: current() });
  const saved = r => toast(t('Saved as "{file}". Send it to the group from your downloads.', { file: r.name }));
  /** A button that is off while its job runs (the picture takes a moment on a phone). */
  const action = (text, cls, job) => {
    const b = el('button', { class: cls, type: 'button', text });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await job(); } catch (e) { toast(t('Could not make the form: {error}', { error: e && e.message ? e.message : String(e) })); } finally { b.disabled = false; }
    });
    return b;
  };
  const paperView = fill ? null : el('canvas', { class: 'record-paper', role: 'img', 'aria-label': t('The service record on the paper form') });
  const textView = fill ? null : el('pre', { class: 'record-text' });
  const waLink = fill ? null : el('a', { class: 'btn ghost', target: '_blank', rel: 'noreferrer', text: t('Send to WhatsApp') });
  // the paper form and the message are the minister's to send: a deacon's page has neither
  if (!fill) page.append(section(t('The form'), [
    el('p', { class: 'small muted', text: t('Your record on NACSA’s paper form, in English as the office knows it. With Send as a picture it goes like a photo of the form: choose WhatsApp, then the group.') }),
    paperView,
    el('div', { class: 'row' }, [
      action(t('Send as a picture'), 'btn rem-wa', async () => { const r = await recordPicture(withRecord()); if ((await send(r, 'image/png')) === 'saved') saved(r); }),
      action(t('Send as PDF'), 'btn ghost', async () => { const r = recordPdf(withRecord()); if ((await send(r, 'application/pdf')) === 'saved') saved(r); }),
      action(t('Two on one A4 (PDF)'), 'btn ghost', async () => { Pdf.download(recordPdf(withRecord(), { two: true })); }),
    ]),
  ]));
  if (!fill) page.append(section(t('The message'), [
    el('p', { class: 'small muted', text: t('The same record as a typed message.') }),
    textView,
    el('div', { class: 'row' }, [
      waLink,
      el('button', { class: 'btn ghost', type: 'button', text: t('Copy'), onclick: async () => { toast((await copyText(recordText(withRecord()))) ? t('Copied.') : t('Could not copy.')); } }),
    ]),
  ]));
  container.append(page);

  function current() {
    const out = recordOf({ record: r });
    for (const [path, input] of Object.entries(inputs)) { const [a, b] = path.split('.'); const v = input.value.trim(); if (b) out[a][b] = v; else out[a] = v; }
    return out;
  }
  function refresh() {
    const cur = current();
    totals.attendance.textContent = `${t('Total')}: ${count(attendanceTotal(cur))}`;
    totals.offerings.textContent = `${t('Total')}: ${rand(offeringsTotal(cur))}`;
    totals.sealing.textContent = `${t('Total')}: ${count(sealingTotal(cur))}`;
    totals.ordination.textContent = `${t('Total')}: ${count(ordinationTotal(cur))}`;
    if (fill) return;
    const text = recordText({ ...s, record: cur });
    textView.textContent = text;
    waLink.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    drawPaper(paperView, paper({ ...s, record: cur }));
  }
  function changed() {
    refresh();
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_AFTER);
  }
  async function save() {
    if (fill) { fill.save(current()); return; }
    s.record = current();
    await saveSermon(s);
    Fill.changed(s);   // on to the deacons, when the link shows this service
  }
  /** The other side's lines into the boxes; the box being typed in keeps what is typed. */
  function apply(rec) {
    const R = recordOf({ record: rec });
    for (const [path, input] of Object.entries(inputs)) {
      if (input === document.activeElement) continue;
      const [a, b] = path.split('.');
      const v = String((b ? R[a][b] : R[a]) ?? '');
      if (input.value !== v) input.value = v;
    }
    refresh();
  }
  refresh();
  const api = { el: page, sid: s.id, current, apply, box: fill ? null : drawFillBox };
  if (!fill && Fill.linkOn()) Fill.watch(api);
  return api;
}

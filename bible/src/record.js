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
 * day has come, and the preparation's Print step always.
 *
 * "Send to WhatsApp" opens WhatsApp with the message typed in, where the
 * group is chosen (wa.me, as the greetings of Reminders do); "Copy" puts it
 * on the clipboard; "Save as PDF" makes an A5 page of the form. The message
 * and the page are in the language of the app.
 */
import { el, clear, toast, copyText } from './ui.js';
import { state, saveSermon } from './store.js';
import { t, locale } from './i18n.js';
import { formatRef } from './books.js';
import * as Pdf from './pdf.js';
import { serviceTimes } from './plan.js';   // the usual time of a Sunday and a midweek service

const DENOMS = [10, 20, 50, 100, 200];
const HYMNS = ['opening', 'callUp', 'afterText', 'repentance', 'communion', 'closing'];
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

/** The record as it starts, before anything is typed: the hymns of the preparation, the minister's name, the service's usual time. */
export function started(s) {
  const r = recordOf(s);
  const h = s.hymns || {};
  r.hymns.opening = h.opening || ''; r.hymns.afterText = h.sermon || ''; r.hymns.communion = h.communion || ''; r.hymns.closing = h.closing || '';
  r.conductedBy = state.settings.name || '';
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

/* ----------------------------------------------------------------- the PDF */

/** The record as one A5 page (more when the remarks run long), the form's lines in order; {blob, name, title}. */
export function recordPdf(s) {
  const r = recordOf(s), h = header(s);
  const doc = new (Pdf.jsPDF())({ unit: 'mm', format: 'a5', orientation: 'portrait' });
  const w = new Pdf.Writer(doc, 12);
  const X = v => Pdf.winAnsi(String(v));
  const half = w.width / 2 - 2;   // two columns, 4 mm apart: the record stays on one A5 page
  w.font(15, 'bold');
  doc.text(X(t('Service record')), w.m, w.y + 5);
  w.font(8.5, 'normal', Pdf.MUTED);
  doc.text('NACSA · Pastoral', w.w - w.m, w.y + 5, { align: 'right' });
  w.y += 10;
  /** A section's heading, set closer than the handbooks' headings. */
  const head = text => {
    w.font(10.5, 'bold', Pdf.BLUE);
    w.ensure(w.lead * 2 + 3);
    w.y += 2;
    doc.text(X(text), w.m, w.y + w.lead * 0.75);
    w.y += w.lead + 1;
  };
  /** "Label: value" from x, the value wrapped under itself within the width; drawn when the row knows its height. */
  const cell = (label, value, x, width) => {
    w.font(10, 'bold');
    const lw = doc.getTextWidth(X(label + ': '));
    w.font(10, 'normal');
    const lines = doc.splitTextToSize(X(value), width - lw);
    return {
      n: lines.length,
      draw() {
        w.font(10, 'bold');
        doc.text(X(label + ':'), x, w.y + w.lead * 0.75);
        w.font(10, 'normal');
        lines.forEach((line, i) => doc.text(line, x + lw, w.y + w.lead * (i + 0.75)));
      },
    };
  };
  /** A row of one or two fields. An empty field is left out, and a field on its own spans the row. */
  const row = (...fields) => {
    const F = fields.filter(([, v]) => v !== '' && v != null);
    if (!F.length) return;
    const cells = F.length === 1 ? [cell(F[0][0], F[0][1], w.m, w.width)] : [cell(F[0][0], F[0][1], w.m, half), cell(F[1][0], F[1][1], w.m + half + 4, half)];
    const n = Math.max(...cells.map(c => c.n));
    w.font(10, 'normal');
    w.ensure(n * w.lead);
    cells.forEach(c => c.draw());
    w.y += n * w.lead + 0.8;
  };
  head(t('The service'));
  row([t('Congregation'), h.congregation], [t('Date'), h.date]);
  row([t('Time'), timeSpan(r)], [t('Service type'), h.kind]);
  row([t('Bible word'), h.ref], [t('Ref no'), r.refNo]);
  row([t('Conducted by'), r.conductedBy], [t('Assisted by'), r.assistedBy]);
  const hy = HYMNS.filter(k => r.hymns[k]);
  if (hy.length) {
    head(t('Hymns'));
    for (let i = 0; i < hy.length; i += 2) row(...hy.slice(i, i + 2).map(k => [hymnLabel[k](), r.hymns[k]]));
  }
  if (any(r.attendance)) {
    head(t('Attendance'));
    row([t('Adults'), count(num(r.attendance.adults))], [t('Children'), count(num(r.attendance.children))]);
    row([t('Visitors'), count(num(r.attendance.visitors))], [t('Total'), count(attendanceTotal(r))]);
  }
  if (any(r.offerings)) {
    head(t('Offerings'));
    const O = offeringLines(r);
    for (let i = 0; i < O.length; i += 2) {
      w.font(10, 'normal');
      w.ensure(w.lead);
      doc.text(X(O[i]), w.m, w.y + w.lead * 0.75);
      if (O[i + 1]) doc.text(X(O[i + 1]), w.m + half + 4, w.y + w.lead * 0.75);
      w.y += w.lead + 0.8;
    }
    row([t('Total'), rand(offeringsTotal(r))]);
  }
  if (any(r.sealing) || any(r.ordination)) {
    head(t('Apostle service'));
    if (any(r.sealing)) row([t('Sealing'), `${t('adults')} ${count(num(r.sealing.adults))}, ${t('children')} ${count(num(r.sealing.children))}, ${t('NAC babies')} ${count(num(r.sealing.babies))} — ${t('total')} ${count(sealingTotal(r))}`]);
    if (any(r.ordination)) row([t('Ordination'), MINISTRIES.filter(([c]) => r.ordination[c]).map(([c, name]) => `${t(name)} (${c}) ${count(num(r.ordination[c]))}`).join(', ') + ` — ${t('total')} ${count(ordinationTotal(r))}`]);
  }
  if (r.remarks) { head(t('Remarks')); w.para(X(r.remarks), { size: 10 }); }
  w.space(1.5);
  row([t('Completed by'), r.completedBy], [t('Captured on MIS by'), r.capturedBy]);
  w.space(2);
  w.para(X(t('Please ensure these details are captured on MIS under Activity Record Capture within 24 hours of the service.')), { size: 8.5, color: Pdf.MUTED });
  return { blob: doc.output('blob'), name: Pdf.fileName(s, '-service-record'), title: `${t('Service record')}: ${h.ref || h.date}` };
}

/* -------------------------------------------------------------- the screen */

let timer = null;

function section(title, children) {
  return el('section', { class: 'sec' }, [el('div', { class: 'docbar' }, [el('h2', { text: title })]), ...children]);
}

export function render(container, route) {
  clear(container);
  const id = route && route[1];
  const s = state.sermons.find(x => x.id === id);
  if (!s) {
    container.append(el('div', { class: 'record' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: t('Service record') })]),
      el('p', { class: 'muted', text: t('No preparation has this address.') }),
      el('div', { class: 'row' }, [el('a', { class: 'btn ghost', href: '#sunday', text: t('Sunday') })]),
    ]));
    return;
  }
  const r = s.record ? recordOf(s) : started(s);
  const h = header(s);
  const page = el('div', { class: 'record' });
  page.append(el('div', { class: 'docbar' }, [el('h2', { text: t('Service record') }), el('span', { class: 'spacer' }), el('a', { class: 'btn small ghost', href: `#prepare/${s.id}`, text: t('Open the preparation') })]));
  page.append(el('div', { class: 'record-head' }, [
    el('b', { text: [h.congregation, h.date].filter(Boolean).join(' · ') }),
    el('div', { class: 'muted small', text: [h.kind, h.ref].filter(Boolean).join(' · ') }),
  ]));
  page.append(el('p', { class: 'small muted', text: t('NACSA’s service record, filled in from the preparation where it can be; what you type is kept as you go. When the service is over, send it to the WhatsApp group: the office captures it on MIS within 24 hours.') }));

  const inputs = {};   // 'attendance.adults' -> its input
  const valueAt = path => { const [a, b] = path.split('.'); return b ? r[a][b] : r[a]; };
  const field = (path, label, attrs = {}, extra = null) => {
    const input = el(attrs.tag || 'input', { type: attrs.tag ? null : attrs.type || 'text', value: attrs.tag ? null : valueAt(path), inputmode: attrs.inputmode || null, min: attrs.min, step: attrs.step, placeholder: attrs.placeholder || null, rows: attrs.rows, 'aria-label': label });
    if (attrs.tag) input.value = valueAt(path);
    inputs[path] = input;
    input.addEventListener('input', changed);
    return el('label', { class: [attrs.plain ? '' : 'f', attrs.full ? 'full' : ''].join(' ').trim() || null }, [el('span', { text: label }), input, extra]);
  };
  const n = (path, label) => field(path, label, { type: 'number', inputmode: 'numeric', min: '0', step: '1' });
  const total = () => el('p', { class: 'record-total' });
  const totals = { attendance: total(), offerings: total(), sealing: total(), ordination: total() };

  page.append(section(t('The service'), [
    el('div', { class: 'fields two' }, [
      field('refNo', t('Ref no')),
      el('div', { class: 'fields record-times' }, [field('start', t('Start time'), { type: 'time' }), field('end', t('End time'), { type: 'time' })]),
      field('conductedBy', t('Conducted by')),
      field('assistedBy', t('Assisted by')),
    ]),
  ]));
  page.append(section(t('Hymns'), [
    el('div', { class: 'fields cols', style: '--cols: 3; --phone-cols: 2' }, HYMNS.map(k => field('hymns.' + k, hymnLabel[k](), { inputmode: 'numeric' }))),
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

  // the message as the group reads it, and the ways out
  const preview = el('pre', { class: 'record-text' });
  const waLink = el('a', { class: 'btn rem-wa', target: '_blank', rel: 'noreferrer', text: t('Send to WhatsApp') });
  const withRecord = () => ({ ...s, record: current() });
  page.append(section(t('The message'), [
    preview,
    el('div', { class: 'row' }, [
      waLink,
      el('button', { class: 'btn ghost', type: 'button', text: t('Copy'), onclick: async () => { toast((await copyText(recordText(withRecord()))) ? t('Copied.') : t('Could not copy.')); } }),
      el('button', { class: 'btn ghost', type: 'button', text: t('Save as PDF'), onclick: () => Pdf.download(recordPdf(withRecord())) }),
      Pdf.canShare() ? el('button', { class: 'btn ghost', type: 'button', text: t('Share'), onclick: () => Pdf.share(recordPdf(withRecord())) }) : null,
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
    const text = recordText({ ...s, record: cur });
    preview.textContent = text;
    waLink.href = 'https://wa.me/?text=' + encodeURIComponent(text);
  }
  function changed() {
    refresh();
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_AFTER);
  }
  async function save() {
    s.record = current();
    await saveSermon(s);
  }
  refresh();
}

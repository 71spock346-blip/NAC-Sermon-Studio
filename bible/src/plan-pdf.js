/*
 * The month plan as the page the priests get: one A4 landscape sheet, the
 * month as a grid of weeks (Sunday to Saturday, as the congregation's own
 * programme was always laid out), each service in its day with its time and
 * who holds it, the district's events in their days, and the district's notes
 * under the grid. A second page lists the district's events in full where
 * the cells had to cut them short, and who is who in the column.
 */
import { t, locale, lang } from './i18n.js';
import { winAnsi } from './pdf.js';
import * as L from './plan-lib.js';
import { monthName } from './reminders-lib.js';

const BLUE = [1, 104, 181];
const INK = [29, 43, 56];
const MUTED = [91, 107, 123];
const LINE = [209, 213, 219];
const PALE = [237, 244, 251];
const OUTSIDE = [245, 246, 247];
const AMBER = [180, 83, 9];

function jsPDF() {
  const lib = window.jspdf && window.jspdf.jsPDF;
  if (!lib) throw new Error(t('The PDF library did not load. Reload the page while online.'));
  return lib;
}

async function emblem() {
  try {
    const r = await fetch('icons/emblem-blue.png');
    if (!r.ok) return '';
    const bytes = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return 'data:image/png;base64,' + btoa(s);
  } catch (e) { return ''; }
}

const font = (doc, size, style, color) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); const c = color || INK; doc.setTextColor(c[0], c[1], c[2]); };
const lead = size => size * 0.3528 * 1.3;

/** The weekday names, Sunday first, in the language of the app. */
function dayNames() {
  const base = new Date(2026, 10, 1);   // a Sunday
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d.toLocaleDateString(locale(), { weekday: 'long' }); });
}

/**
 * programmePdf(plan, settings, services, events) → {blob, name, title}.
 * `services` and `events` come from plan-lib for this plan.
 */
export async function programmePdf(plan, settings, services, events) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 9;
  const cong = settings.congregation || t('Congregation');
  const month = L.monthLabel(plan.month, plan.year, lang());
  const title = `${cong} – ${t('Monthly programme')} – ${month}`;
  const byDate = Object.fromEntries(services.map(s => [s.date, s]));
  const extras = {};   // date -> the district's events of that day (not the service)
  for (const e of events) if (!e.service) (extras[e.date] = extras[e.date] || []).push(e);

  // ---- the head
  const art = await emblem();
  let y = M;
  if (art) doc.addImage(art, 'PNG', M, y, 14, 14);
  font(doc, 20, 'bold', BLUE);
  doc.text(winAnsi(`${cong} – ${t('Monthly programme')}`), art ? M + 18 : M, y + 7);
  font(doc, 13, 'normal', MUTED);
  doc.text(winAnsi(month), art ? M + 18 : M, y + 13.5);
  y += 18;

  // ---- the grid: whole weeks from the first Sunday to the last Saturday
  const first = plan.first, last = plan.last;
  const start = L.addDays(first, -L.dow(first));
  const weeks = Math.ceil((L.dateOf(last) - L.dateOf(start)) / 86400000 / 7 + 1e-9);
  const names = dayNames();
  const colW = (W - 2 * M) / 7;
  const headH = 7;
  const notes = plan.notes || [];
  const notesH = notes.length ? Math.min(26, 6 + notes.length * 3.6) : 0;
  const rowH = (H - y - M - headH - notesH - (notesH ? 3 : 0) - 6) / weeks;
  doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.rect(M, y, W - 2 * M, headH, 'F');
  font(doc, 9, 'bold', [255, 255, 255]);
  names.forEach((n, i) => doc.text(winAnsi(n), M + colW * i + colW / 2, y + 4.8, { align: 'center' }));
  y += headH;
  doc.setLineWidth(0.25);
  let cut = false;   // did a cell have to leave something out? then the second page lists it all
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) {
      const date = L.addDays(start, w * 7 + i);
      const x = M + colW * i, top = y + rowH * w;
      const inside = date >= first && date <= last;
      const s = byDate[date];
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      if (!inside) { doc.setFillColor(OUTSIDE[0], OUTSIDE[1], OUTSIDE[2]); doc.rect(x, top, colW, rowH, 'FD'); continue; }
      if (s && !s.off && L.isService(s)) { doc.setFillColor(PALE[0], PALE[1], PALE[2]); doc.rect(x, top, colW, rowH, 'FD'); }   // a service day is shaded; a meeting's is not
      else doc.rect(x, top, colW, rowH, 'S');
      font(doc, 9, 'bold', inside ? INK : MUTED);
      doc.text(String(L.dateOf(date).getDate()), x + colW - 1.8, top + 4, { align: 'right' });
      let cy = top + 4;
      const lines = [];   // [text, size, style, color]
      if (s) {
        const who = s.off ? '' : L.whoLabel(s.who, plan, settings);
        if (s.off) { if (L.isService(s)) lines.push([t('No service'), 7.5, 'italic', MUTED]); }
        else if (L.isService(s)) {
          lines.push([`${L.serviceTitle(s)} ${s.time}`.trim(), 8, 'bold', BLUE]);
          lines.push(who ? [who, 8, 'bold', INK] : [t('still open'), 7.5, 'italic', AMBER]);
        } else {
          // a meeting, a training: its name and time in ink, not the blue of a service, and who leads it when the rector said
          lines.push([`${L.serviceTitle(s)} ${s.time}`.trim(), 8, 'bold', INK]);
          if (who) lines.push([who, 8, 'bold', INK]);
        }
        for (const n of s.notes) if (!s.off || !/no .*service/i.test(n)) lines.push([n, 6.8, 'normal', INK]);
        if (s.note) lines.push([s.note, 6.8, 'normal', INK]);
      }
      for (const e of extras[date] || []) lines.push([(e.start ? e.start + ' ' : '') + e.title, 6.8, 'normal', INK]);
      // the lines that fit; a long note is wrapped, and what does not fit ends in … (the second page has it in full)
      const room = top + rowH - 1.5;
      for (const [text, size, style, color] of lines) {
        font(doc, size, style, color);
        const l = lead(size);
        let wrapped = doc.splitTextToSize(winAnsi(text), colW - 3.2);
        const fit = Math.max(0, Math.floor((room - cy) / l));
        if (fit === 0) { cut = true; break; }
        if (wrapped.length > fit) { cut = true; wrapped = wrapped.slice(0, fit); wrapped[fit - 1] = wrapped[fit - 1].replace(/.{2}$/, '…'); }
        for (const line of wrapped) { doc.text(line, x + 1.6, cy + l * 0.75); cy += l; }
        cy += 0.4;
      }
    }
  }
  y += rowH * weeks;
  if (notesH) {
    y += 3;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.rect(M, y, W - 2 * M, notesH, 'S');
    font(doc, 7.5, 'bold', BLUE);
    doc.text(winAnsi(t('District notes')), M + 2, y + 3.8);
    font(doc, 7, 'normal', INK);
    let ny = y + 7.6;
    for (const n of notes) {
      const wrapped = doc.splitTextToSize('• ' + winAnsi(n), W - 2 * M - 4);
      if (ny + lead(7) > y + notesH - 0.5) { cut = true; break; }
      doc.text(wrapped[0], M + 2, ny);
      ny += lead(7);
    }
  }
  font(doc, 7, 'normal', MUTED);
  doc.text(winAnsi(t('{congregation} · made {date} with the Study Bible', { congregation: cong, date: new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })), M, H - 4);

  // ---- the second page: everything in full
  const rest = events.filter(e => !e.service);
  if (cut || rest.length) {
    doc.addPage('a4', 'portrait');
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
    let py = 14;
    const line = (text, size, style, color, indent = 0, gap = 1.5) => {
      font(doc, size, style, color);
      const wrapped = doc.splitTextToSize(winAnsi(text), PW - 2 * 14 - indent);
      for (const l of wrapped) {
        if (py + lead(size) > PH - 14) { doc.addPage('a4', 'portrait'); py = 14; font(doc, size, style, color); }
        doc.text(l, 14 + indent, py + lead(size) * 0.75);
        py += lead(size);
      }
      py += gap;
    };
    line(`${cong} – ${month}`, 15, 'bold', BLUE, 0, 3);
    line(t('The services'), 11, 'bold', BLUE, 0, 1);
    for (const s of services) {
      const when = `${L.shortDate(s.date, locale())}${s.off ? '' : ' ' + s.time}`;
      const who = s.off ? t('No service') : (L.whoLabel(s.who, plan, settings) || t('still open'));
      line(`${when} – ${who}`, 10, 'bold', INK, 0, 0.3);
      for (const n of L.withDayName(s, [...s.notes, s.note])) line(n, 9, 'normal', MUTED, 6, 0.3);
      py += 1.2;
    }
    if (rest.length) {
      py += 2;
      line(t('District events'), 11, 'bold', BLUE, 0, 1);
      for (const e of rest) line(`${L.shortDate(e.date, locale())}${e.start ? ' ' + e.start : ''}${e.end ? '–' + e.end : ''} – ${e.title}`, 9.5, 'normal', INK, 0, 0.8);
    }
    if (notes.length) {
      py += 2;
      line(t('District notes'), 11, 'bold', BLUE, 0, 1);
      for (const n of notes) line('• ' + n, 9.5, 'normal', INK, 0, 0.8);
    }
  }
  const name = `${cong} ${monthName(plan.month, lang())} ${plan.year}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
  return { blob: doc.output('blob'), name, title };
}

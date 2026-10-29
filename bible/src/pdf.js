/*
 * The printed outputs of a service preparation, drawn with jsPDF:
 *
 *   Sermon notes   A4 portrait, the whole preparation in reading order
 *   Cue card       A5 landscape, large type: text word, theme, main points
 *
 * Printing goes through the finished PDF, so the paper matches the file.
 */
import { formatRef } from './books.js';
import { state } from './store.js';
import * as Cat from './catechism.js';
import { audienceOf, audienceLabel } from './ai.js';

const BLUE = [31, 78, 140];      // the Church's blue, the same as --accent on screen
const INK = [31, 41, 55];
const MUTED = [107, 114, 128];

function jsPDF() {
  const lib = window.jspdf && window.jspdf.jsPDF;
  if (!lib) throw new Error('The PDF library did not load. Reload the page while online.');
  return lib;
}

/** A cursor that writes down the page and starts a new one when it runs out. */
class Writer {
  constructor(doc, margin) {
    this.doc = doc;
    this.m = margin;
    this.w = doc.internal.pageSize.getWidth();
    this.h = doc.internal.pageSize.getHeight();
    this.y = margin;
    this.width = this.w - 2 * margin;
  }
  font(size, style, color) {
    this.doc.setFont('helvetica', style || 'normal');
    this.doc.setFontSize(size);
    const c = color || INK;
    this.doc.setTextColor(c[0], c[1], c[2]);
    this.lead = size * 0.3528 * 1.35;
  }
  ensure(space) {
    if (this.y + space > this.h - this.m) { this.doc.addPage(); this.y = this.m; }
  }
  space(mm) { this.y += mm; }
  heading(text, size = 12) {
    this.font(size, 'bold', BLUE);
    this.ensure(this.lead * 2 + 4);
    this.y += 3;
    this.doc.text(text, this.m, this.y + this.lead * 0.75);
    this.y += this.lead + 1.5;
  }
  para(text, opts = {}) {
    if (!text) return;
    this.font(opts.size || 10.5, opts.style || 'normal', opts.color);
    if (opts.serif) this.doc.setFont('times', opts.style || 'normal');
    const x = this.m + (opts.indent || 0);
    const lines = this.doc.splitTextToSize(String(text).replace(/\r/g, ''), this.width - (opts.indent || 0));
    for (const line of lines) {
      this.ensure(this.lead);
      this.doc.text(line, x, this.y + this.lead * 0.75);
      this.y += this.lead;
    }
    this.y += opts.after == null ? 2 : opts.after;
  }
  rule() {
    this.ensure(4);
    this.doc.setDrawColor(209, 213, 219);
    this.doc.setLineWidth(0.3);
    this.doc.line(this.m, this.y + 1, this.w - this.m, this.y + 1);
    this.y += 4;
  }
  footer(text) {
    const n = this.doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.doc.setPage(i);
      this.font(8, 'normal', MUTED);
      this.doc.text(text, this.m, this.h - 8);
      this.doc.text(`${i} / ${n}`, this.w - this.m, this.h - 8, { align: 'right' });
    }
  }
}

function lines(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

function serviceLine(s) {
  const parts = [];
  if (s.date) parts.push(new Date(s.date + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (s.congregation) parts.push(s.congregation);
  if (s.occasion) parts.push(s.occasion);
  const who = audienceOf(s);   // who is listening, when the preparation names an age group
  if (who) parts.push(audienceLabel(who));
  return parts.join('  ·  ');
}

function refLabel(s) {
  return s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || '');
}

function fileName(s, suffix) {
  const d = s.date || 'undated';
  const r = refLabel(s).replace(/[^\w]+/g, '-');
  return `${d}-${r || 'sermon'}${suffix}.pdf`.replace(/-+/g, '-');
}

export function sermonPdf(s) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const ref = refLabel(s);

  w.font(9, 'normal', MUTED);
  if (serviceLine(s)) { doc.text(serviceLine(s), w.m, w.y); w.y += 6; }
  if ((s.people || '').trim()) w.para('Who is listening: ' + s.people.trim(), { size: 9, color: MUTED, after: 1 });
  w.font(18, 'bold', INK);
  const title = s.title || s.theme || ref || 'Sermon notes';
  for (const line of doc.splitTextToSize(title, w.width)) { doc.text(line, w.m, w.y + 5); w.y += 8; }
  w.y += 2;
  if (ref) {
    w.font(12, 'bold', BLUE);
    doc.text(ref + (s.translation ? `  (${s.translation})` : ''), w.m, w.y + 3);
    w.y += 7;
  }
  if (s.text) w.para(s.text, { serif: true, style: 'italic', size: 11.5, after: 3 });
  w.rule();

  if (s.theme || s.core) {
    w.heading('Message of the service');
    if (s.theme) w.para(s.theme, { style: 'bold' });
    if (s.core) w.para(s.core);
  }
  if (s.guide) { w.heading('From the Divine Service Guide'); w.para(s.guide); }
  if (s.context || s.keywords) {
    w.heading('Understanding the text');
    if (s.context) w.para(s.context);
    if (s.keywords) { w.para('Key words', { style: 'bold', size: 10, after: 0.5 }); w.para(s.keywords); }
  }
  if ((s.catechism || []).length) {
    w.heading('Catechism');
    catechismNotes(w, s);
  }
  if (s.crossRefs) { w.heading('Cross references'); for (const l of lines(s.crossRefs)) w.para('• ' + l, { indent: 2, after: 0.5 }); w.space(2); }
  if (s.intro) { w.heading('Introduction'); w.para(s.intro); }
  const points = (s.points || []).filter(p => p.heading || p.body);
  if (points.length) {
    w.heading('Main points');
    points.forEach((p, i) => {
      if (p.heading) w.para(`${i + 1}. ${p.heading}`, { style: 'bold', size: 11, after: 1 });
      if (p.body) w.para(p.body, { indent: 5 });
    });
  }
  if (s.application) { w.heading('Application for the congregation'); w.para(s.application); }
  if (s.illustrations) { w.heading('Illustrations and experiences'); w.para(s.illustrations); }
  if (s.conclusion) { w.heading('Conclusion'); w.para(s.conclusion); }
  if (s.reflection) { w.heading('After the service'); w.para(s.reflection); }

  const who = [state.settings.name, 'NAC Study Bible'].filter(Boolean).join('  ·  ');
  w.footer(who);
  return { blob: doc.output('blob'), name: fileName(s, '-sermon'), title: title };
}

/** Superscript digits are not in the PDF's fonts: write them as [1]. */
function plainSup(text) {
  return String(text).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m => '[' + [...m].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join('') + ']');
}

/**
 * The chosen Catechism sections: number and title, and under each, as the
 * preparation asks, the section's text, its summary, or nothing more. The
 * text is there only when the person has loaded it on this device.
 */
function catechismNotes(w, s) {
  const how = s.catechismText || 'full';
  let quoted = false;
  for (const c of s.catechism) {
    const sec = Cat.section(c.n) || c;
    w.para(`${sec.n}  ${sec.title}`, { style: 'bold', size: 10.5, after: 0.5 });
    if (how === 'ref' || !Cat.textReady() || !Cat.textOf(sec.n)) { w.space(1); continue; }
    const summary = Cat.summaryOf(sec.n);
    if (how === 'summary') {
      const lines = summary.length ? summary : Cat.plainLines(sec.n).filter(l => l.kind === 'p').slice(0, 1).map(l => l.text);
      for (const p of lines) w.para(plainSup(p), { indent: 3, size: 10, after: 1 });
      quoted = quoted || lines.length > 0;
      w.space(1.5);
      continue;
    }
    for (const line of Cat.plainLines(sec.n)) {
      if (line.kind === 'h') w.para(line.text, { indent: 3, style: 'bold', size: 10, after: 0.5 });
      else if (line.kind === 'li' && !line.single) w.para('– ' + plainSup(line.text), { indent: 6, size: 10, after: 0.5 });
      else if (line.kind === 'cell') w.para(`${line.label}: ${plainSup(line.text).replace(/\n/g, ' ')}`, { indent: 6, size: 10, after: 0.5 });
      else if (line.kind === 'v') for (const v of line.text.split('\n')) w.para(v, { indent: 6, size: 10, after: 0 });
      else w.para(plainSup(line.text), { indent: line.kind === 'li' ? 6 : 3, size: 10, after: 1 });
      quoted = true;
    }
    for (const p of summary) w.para('In short: ' + plainSup(p), { indent: 3, size: 10, style: 'italic', after: 1 });
    for (const nt of Cat.notesOf(sec.n)) w.para(`[${nt.n}] ${nt.t}`, { indent: 3, size: 8.5, color: MUTED, after: 0.5 });
    w.space(2);
  }
  if (quoted) w.para(Cat.credit(), { size: 8, color: MUTED, after: 1 });
  w.space(1);
}

export function cueCardPdf(s) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a5', orientation: 'landscape' });
  const w = new Writer(doc, 14);
  const ref = refLabel(s);
  w.font(10, 'normal', MUTED);
  if (serviceLine(s)) { doc.text(serviceLine(s), w.m, w.y); w.y += 7; }
  w.font(20, 'bold', BLUE);
  doc.text(ref || (s.title || 'Cue card'), w.m, w.y + 5);
  w.y += 11;
  if (s.text) w.para(s.text, { serif: true, style: 'italic', size: 12, after: 3 });
  if (s.theme) w.para(s.theme, { style: 'bold', size: 14, after: 2 });
  if (s.core) w.para(s.core, { size: 12, after: 3 });
  const points = (s.points || []).filter(p => p.heading || p.body);
  points.forEach((p, i) => {
    w.para(`${i + 1}. ${p.heading || firstLine(p.body)}`, { style: 'bold', size: 13, after: 1 });
  });
  if (s.application) { w.space(2); w.para('Apply: ' + firstLine(s.application), { size: 12, after: 1 }); }
  if (s.conclusion) { w.para('Close: ' + firstLine(s.conclusion), { size: 12, style: 'italic' }); }
  w.footer(s.title || '');
  return { blob: doc.output('blob'), name: fileName(s, '-cue-card'), title: ref };
}

function firstLine(text) {
  const l = lines(text);
  return l.length ? l[0] : '';
}

/* ---------------------------------------------------------------- output */
export function download(r) {
  const url = URL.createObjectURL(r.blob);
  const a = document.createElement('a');
  a.href = url; a.download = r.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return r.name;
}

export function canShare() {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
  } catch (e) { return false; }
}

export async function share(r) {
  const file = new File([r.blob], r.name, { type: 'application/pdf' });
  if (canShare() && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: r.title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  download(r);
  return 'downloaded';
}

export function print(r) {
  const url = URL.createObjectURL(r.blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.open(url, '_blank', 'noopener'); }
    setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 60000);
  };
  document.body.appendChild(frame);
  return r.name;
}

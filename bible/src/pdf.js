/*
 * The printed outputs of a service preparation, drawn with jsPDF:
 *
 *   Sermon notes   A4 portrait, the whole preparation in the order of its
 *                  steps, which is the order of the Guide's article
 *   The sermon     A4 portrait, large clear type: the sermon itself in
 *                  reading order, from the boxes of the preparation or from
 *                  the outline Claude built, with each illustration under
 *                  the point it serves
 *   Cue cards      A5 landscape, large type: text word, theme, and each main
 *                  point with its main thoughts under it and the minister's
 *                  own thought on it; a point is never split over two cards
 *   Guide breakdown  A4 portrait, the Guide's article piece by piece as
 *                  Claude broke it down: a study sheet to read beside the booklet
 *   Facilitator notes  A4 portrait, large clear type: for a reflection
 *                  evening, what to say and do at each slide, slide by slide
 *   Theology       A4 portrait: everything the Theology page shows on a
 *                  passage, a chapter or a book, with all that Claude wrote
 *
 * Printing goes through the finished PDF, so the paper matches the file.
 */
import { formatRef } from './books.js';
import { t, locale } from './i18n.js';
import { fmtDate } from './ui.js';
import { state } from './store.js';
import * as Cat from './catechism.js';
import { audienceOf, audienceLabel, modelLabel } from './ai.js';
import * as S from './slides.js';

const BLUE = [1, 104, 181];      // the Church's blue (#0168B5), as on the slides and as --accent on screen
const INK = [29, 43, 56];
const MUTED = [91, 107, 123];
const HANG = 4.5;                // mm between a bullet and its text

function jsPDF() {
  const lib = window.jspdf && window.jspdf.jsPDF;
  if (!lib) throw new Error(t('The PDF library did not load. Reload the page while online.'));
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
    this.carry = '';   // while set, a new page has this line at its head, small and grey (see flow)
  }
  font(size, style, color) {
    this.doc.setFont('helvetica', style || 'normal');
    this.doc.setFontSize(size);
    const c = color || INK;
    this.doc.setTextColor(c[0], c[1], c[2]);
    this.lead = size * 0.3528 * 1.35;
  }
  ensure(space) {
    if (this.y + space > this.h - this.m) this.page();
  }
  /**
   * Goes on at the top of a new page. The line carry, if any, goes in the top
   * margin like a running head, so it takes no room from the text; the
   * paragraph being written keeps its letters.
   */
  page() {
    this.doc.addPage();
    this.y = this.m;
    if (!this.carry) return;
    const f = this.doc.getFont(), size = this.doc.getFontSize(), color = this.doc.getTextColor(), lead = this.lead;
    this.font(9, 'normal', MUTED);
    this.doc.text(this.carry, this.m, this.m - 6);
    this.doc.setFont(f.fontName, f.fontStyle);
    this.doc.setFontSize(size);
    this.doc.setTextColor(color);
    this.lead = lead;
  }
  space(mm) { this.y += mm; }
  heading(text, size = 12) {
    this.font(size, 'bold', BLUE);
    this.ensure(this.lead * 2 + 4);
    this.y += 3;
    this.doc.text(text, this.m, this.y + this.lead * 0.75);
    this.y += this.lead + 1.5;
  }
  /** Sets the font of a paragraph and breaks its text into the lines that fit (a bullet hangs in front of them). */
  wrap(text, opts = {}) {
    this.font(opts.size || 10.5, opts.style || 'normal', opts.color);
    if (opts.serif) this.doc.setFont('times', opts.style || 'normal');
    if (opts.leading) this.lead = (opts.size || 10.5) * 0.3528 * opts.leading;   // more room between the lines, for reading aloud
    return this.doc.splitTextToSize(String(text).replace(/\r/g, ''), this.width - (opts.indent || 0) - (opts.bullet ? HANG : 0));
  }
  para(text, opts = {}) {
    if (!text) return;
    const lines = this.wrap(text, opts);
    const x = this.m + (opts.indent || 0);
    const cut = opts.tidy ? this.cut(lines.length) : -1;
    lines.forEach((line, i) => {
      if (i === cut) this.page(); else this.ensure(this.lead);
      if (opts.bullet && i === 0) this.doc.text(opts.bullet, x, this.y + this.lead * 0.75);
      this.doc.text(line, x + (opts.bullet ? HANG : 0), this.y + this.lead * 0.75);
      this.y += this.lead;
    });
    this.y += opts.after == null ? 2 : opts.after;
  }
  /**
   * For print that reads well (para with opts.tidy): the line of a paragraph of
   * n lines at which it goes over to the next page. 0 moves it whole: a paragraph
   * of up to three lines is not split, and a longer one does not start with a
   * single line at the foot of a page. One line early when only its last line
   * would go over, so that two lines go over together. -1: it fits, or it goes
   * over where it falls.
   */
  cut(n) {
    const fit = Math.floor((this.h - this.m - this.y) / this.lead + 1e-6);
    if (fit >= n) return -1;
    if (n <= 3 || fit < 2) return 0;
    return n - fit === 1 ? fit - 1 : -1;
  }
  /** The height of the paragraph [text, opts], with the space after it. */
  height([text, opts = {}]) {
    return this.wrap(text, opts).length * this.lead + (opts.after == null ? 2 : opts.after);
  }
  /** Starts a new page unless the paragraphs [text, opts] fit below, when they fit on one page at all: a block stays together. */
  keep(parts) {
    const height = parts.reduce((sum, part) => sum + this.height(part), 0);
    if (this.y + height > this.h - this.m && height <= this.h - 2 * this.m) this.page();
  }
  /**
   * Writes the paragraphs [text, opts] so that they run on from page to page, as
   * in a book, without leaving the foot of a page empty. Paragraphs are tidy (see
   * cut), and one marked withNext (a heading, a question, a main point) never
   * stands alone at the foot of a page: it goes over together with the first
   * lines of what follows it. When they go over to a new page after the first
   * paragraph, that page has the line carry at its head (to say which slide
   * goes on there).
   */
  flow(parts, carry = '') {
    parts.forEach(([text, opts = {}], i) => {
      const chained = i > 0 && (parts[i - 1][1] || {}).withNext;
      if (opts.withNext && !chained) {
        let need = 0, j = i;
        for (; j < parts.length && (parts[j][1] || {}).withNext; j++) need += this.height(parts[j]);
        if (j < parts.length) { const n = this.wrap(parts[j][0], parts[j][1]).length; need += (n <= 3 ? n : 2) * this.lead; }
        if (this.y + need > this.h - this.m && need <= this.h - 2 * this.m) this.page();
      }
      this.para(text, Object.assign({}, opts, { tidy: true }));
      if (i === 0) this.carry = carry;
    });
    this.carry = '';
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
  if (s.date) parts.push(new Date(s.date + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (s.congregation) parts.push(s.congregation);
  if (s.occasion) parts.push(t(s.occasion));
  const who = audienceOf(s);   // who is listening, when the preparation names an age group
  if (who) parts.push(t(audienceLabel(who)));
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
  if ((s.people || '').trim()) w.para(t('Who is listening: ') + s.people.trim(), { size: 9, color: MUTED, after: 1 });
  // as the Guide prints it: the Bible text, then the title (step 1, then step 2)
  if (ref) {
    w.font(12, 'bold', BLUE);
    doc.text(ref + (s.translation ? `  (${s.translation})` : ''), w.m, w.y + 3);
    w.y += 7;
  }
  if (s.text) w.para(s.text, { serif: true, style: 'italic', size: 11.5, after: 3 });
  const title = s.title || s.theme || ref || t('Sermon notes');
  if (s.title || s.theme || !ref) {
    w.font(18, 'bold', INK);
    for (const line of doc.splitTextToSize(title, w.width)) { w.ensure(8); doc.text(line, w.m, w.y + 5); w.y += 8; }
    w.y += 2;
  }
  w.rule();

  // 2. the message
  if (s.theme || s.core) {
    w.heading(t('Message of the service'));
    if (s.theme) w.para(s.theme, { style: 'bold' });
    if (s.core) w.para(s.core);
  }
  if (s.guide) { w.heading(t('From the Divine Service Guide')); w.para(s.guide); }
  // 3. the introduction
  if (s.intro) { w.heading(t('Introduction')); w.para(s.intro); }
  // 4. the main points
  const points = (s.points || []).filter(p => p.heading || p.body);
  if (points.length) {
    // every point from the Guide: the heading says so, as the person's rule has it
    w.heading(points.every(p => p.guide) ? t('Main points, from the Divine Service Guide') : t('Main points'));
    points.forEach((p, i) => {
      if (p.heading) w.para(`${i + 1}. ${p.heading}`, { style: 'bold', size: 11, after: 1 });
      if (p.body) w.para(p.body, { indent: 5 });
      if ((p.thought || '').trim()) w.para(t('My thought: ') + p.thought.trim(), { indent: 5, style: 'italic', size: 10 });
    });
  }
  // 5. the context: the setting of the text, the key words, the Catechism, the cross references
  if (s.context || s.keywords) {
    w.heading(t('Context'));
    if (s.context) w.para(s.context);
    if (s.keywords) { w.para(t('Key words'), { style: 'bold', size: 10, after: 0.5 }); w.para(s.keywords); }
  }
  if ((s.catechism || []).length) {
    w.heading(t('Catechism'));
    catechismNotes(w, s);
  }
  if (s.crossRefs) { w.heading(t('Cross references')); for (const l of lines(s.crossRefs)) w.para('• ' + l, { indent: 2, after: 0.5 }); w.space(2); }
  // 6. the summary and conclusion
  if (s.summary) { w.heading(t('Summary')); w.para(s.summary); }
  if (s.application) { w.heading(t('Application for the congregation')); w.para(s.application); }
  if (s.conclusion) { w.heading(t('Conclusion')); w.para(s.conclusion); }
  // 7. and 8. the person's own
  if (s.illustrations) { w.heading(t('Illustrations and experiences')); w.para(s.illustrations); }
  if (s.reflection) { w.heading(t('After the service')); w.para(s.reflection); }

  const who = [state.settings.name, t('Study Bible')].filter(Boolean).join('  ·  ');
  w.footer(who);
  return { blob: doc.output('blob'), name: fileName(s, '-sermon'), title: title };
}

/* ---------------------------------------------------------------- the sermon itself */

/** Where an illustration or a lighter moment belongs, from the words the outline gave ("main point 2", "the introduction", "hoofpunt 3"). */
function placeOf(text) {
  const v = String(text || '').toLowerCase();
  const m = v.match(/(\d+)/);
  if (m && /point|punt/.test(v)) return { kind: 'point', n: parseInt(m[1], 10) };
  if (/intro|inleiding|open|begin/.test(v)) return { kind: 'intro' };
  if (/conclu|slot|close|end|einde/.test(v)) return { kind: 'conclusion' };
  if (/applic|toepassing/.test(v)) return { kind: 'application' };
  if (m) return { kind: 'point', n: parseInt(m[1], 10) };
  return { kind: '' };
}

/** The sermon as it stands in the boxes of the preparation; the illustrations box has no place of its own, so it follows the points. */
function fromBoxes(s) {
  const points = (s.points || []).filter(p => p && ((p.heading || '').trim() || (p.body || '').trim())).map((p, i) => ({ n: i + 1, heading: (p.heading || '').trim(), body: (p.body || '').trim(), extras: [] }));
  const after = { intro: [], application: [], conclusion: [], loose: [] };
  if ((s.illustrations || '').trim()) after.loose.push({ kind: 'text', body: s.illustrations.trim() });
  return { intro: (s.intro || '').trim(), points, summary: (s.summary || '').trim(), application: (s.application || '').trim(), conclusion: (s.conclusion || '').trim(), after, thoughts: [], outline: null };
}

/** The sermon as Claude built it (s.build), with the person's changes: each illustration and the lighter moment under the part it serves. */
function fromOutline(s, a) {
  const points = (a.points || []).map((p, i) => ({ n: p.n || i + 1, heading: (p.heading || '').trim(), body: (p.body || '').trim(), extras: [] }));
  const after = { intro: [], application: [], conclusion: [], loose: [] };
  const put = (where, item) => {
    const at = placeOf(where);
    const pt = at.kind === 'point' ? points.find(p => p.n === at.n) : null;
    if (pt) pt.extras.push(item); else if (after[at.kind]) after[at.kind].push(item); else after.loose.push(item);
  };
  for (const x of a.illustrations || []) if ((x.body || '').trim()) put(x.serves, { kind: 'illustration', title: (x.title || '').trim(), body: x.body.trim() });
  if (a.lighter && (a.lighter.text || '').trim()) put(a.lighter.where, { kind: 'lighter', body: a.lighter.text.trim() });
  return { intro: ((a.intro && a.intro.text) || '').trim(), points, summary: '', application: (a.application || '').trim(), conclusion: (a.conclusion || '').trim(), after, thoughts: a.thoughts || [], outline: a };
}

/**
 * The sermon itself, in reading order and in large clear type, to read from:
 * the text word, the introduction, the main points, the summary, the
 * application and the conclusion, with each illustration under the part it
 * serves. From the boxes of the preparation, or, with `outline`, as Claude
 * built it (s.build, with the person's changes), with where the person's
 * thoughts went at the end.
 */
export function sermonTextPdf(s, { outline = null } = {}) {
  const c = outline ? fromOutline(s, outline) : fromBoxes(s);
  if (!c.intro && !c.points.length && !c.application && !c.conclusion) throw new Error(t('There is nothing to print yet: write the introduction, the main points, the application or the conclusion first.'));
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 22);
  const ref = refLabel(s);
  const read = { size: 12, leading: 1.5, after: 3 };   // the running text: large, with room between the lines
  const extras = list => {
    for (const x of list) {
      if (x.kind === 'illustration') { w.para(t('Illustration: ') + (x.title || ''), { style: 'bold', size: 10.5, color: MUTED, after: 0.5 }); w.para(x.body, { ...read, indent: 5 }); }
      else if (x.kind === 'lighter') { w.para(t('A lighter moment'), { style: 'bold', size: 10.5, color: MUTED, after: 0.5 }); w.para(x.body, { ...read, indent: 5 }); }
      else w.para(x.body, read);
    }
  };

  w.font(9, 'normal', MUTED);
  if (serviceLine(s)) { doc.text(serviceLine(s), w.m, w.y); w.y += 6; }
  if (ref) {
    w.font(12, 'bold', BLUE);
    doc.text(ref + (s.translation ? `  (${s.translation})` : ''), w.m, w.y + 3);
    w.y += 7;
  }
  if (s.text) w.para(s.text, { serif: true, style: 'italic', size: 12, leading: 1.4, after: 3 });
  const title = s.title || s.theme || ref || t('The sermon');
  if (s.title || s.theme || !ref) {
    w.font(18, 'bold', INK);
    for (const line of doc.splitTextToSize(title, w.width)) { w.ensure(8); doc.text(line, w.m, w.y + 5); w.y += 8; }
    w.y += 2;
  }
  w.rule();

  if (c.intro) { w.heading(t('Introduction')); w.para(c.intro, read); extras(c.after.intro); }
  for (const p of c.points) {
    w.ensure(24);   // a point's heading and the start of its text stay on one page
    w.heading(`${p.n}. ${p.heading}`.trim());
    if (p.body) w.para(p.body, read);
    extras(p.extras);
  }
  if (c.after.loose.length) { w.heading(t('Illustrations')); extras(c.after.loose); }
  if (c.summary) { w.heading(t('Summary')); w.para(c.summary, read); }
  if (c.application) { w.heading(t('Application for the congregation')); w.para(c.application, read); extras(c.after.application); }
  if (c.conclusion) { w.heading(t('Conclusion')); w.para(c.conclusion, read); extras(c.after.conclusion); }
  if (c.outline) {
    w.space(2);
    if (c.thoughts.length) {
      w.heading(t('Where your thoughts went'), 10.5);
      for (const x of c.thoughts) w.para(`${t('Main point {n}', { n: x.n })}: ${x.how || x.where}${x.question ? ' ' + t('Claude asks: ') + x.question : ''}`, { size: 9.5, color: MUTED, after: 1 });
    }
    w.para(t('Built by {model}, {date}. A starting point: the sermon is yours.', { model: modelLabel(c.outline.model), date: fmtDate(c.outline.at) }), { size: 8, color: MUTED, after: 1 });
  }

  const who = [state.settings.name, t('Study Bible')].filter(Boolean).join('  ·  ');
  w.footer(who);
  return { blob: doc.output('blob'), name: fileName(s, '-full-sermon'), title };
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
    for (const p of summary) w.para(t('In short: ') + plainSup(p), { indent: 3, size: 10, style: 'italic', after: 1 });
    for (const nt of Cat.notesOf(sec.n)) w.para(`[${nt.n}] ${nt.t}`, { indent: 3, size: 8.5, color: MUTED, after: 0.5 });
    w.space(2);
  }
  if (quoted) w.para(Cat.credit(), { size: 8, color: MUTED, after: 1 });
  w.space(1);
}

/**
 * The cue cards for the pulpit: the text word, the message, and each main
 * point with its main thoughts under it (see mainThoughts) and the minister's
 * own thought on it in blue. A point stays on one card; the cards are numbered.
 */
export function cueCardPdf(s) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a5', orientation: 'landscape' });
  const w = new Writer(doc, 14);
  const ref = refLabel(s);
  w.font(10, 'normal', MUTED);
  if (serviceLine(s)) { doc.text(serviceLine(s), w.m, w.y); w.y += 7; }
  w.font(20, 'bold', BLUE);
  doc.text(ref || (s.title || t('Cue card')), w.m, w.y + 5);
  w.y += 11;
  if (s.text) w.para(s.text, { serif: true, style: 'italic', size: 12, after: 3 });
  if (s.theme) w.para(s.theme, { style: 'bold', size: 14, after: 2 });
  if (s.core) w.para(s.core, { size: 12, after: 3 });
  const points = (s.points || []).filter(p => p.heading || p.body);
  points.forEach((p, i) => {
    // a point without a heading is headed by its first line, as before
    let heading = (p.heading || '').trim(), body = p.body || '';
    if (!heading) { const l = lines(body); heading = l[0] || ''; body = l.slice(1).join('\n'); }
    const mine = shorten(lines(p.thought).join(' '), 30);
    const parts = [
      [`${i + 1}. ${heading}`, { style: 'bold', size: 13, after: 1.5 }],
      ...mainThoughts(body).map(x => [x, { size: 12, indent: 6, bullet: '\u2022', after: 1 }]),
      mine ? [t('My thought: ') + mine, { size: 12, indent: 6, color: BLUE, after: 1 }] : null,
    ].filter(Boolean);
    w.keep(parts);
    for (const [text, opts] of parts) w.para(text, opts);
    w.space(2.5);
  });
  // the application and the close stay together on one card
  const end = [
    s.application ? [t('Apply: ') + firstLine(s.application), { size: 12, after: 1 }] : null,
    s.conclusion ? [t('Close: ') + firstLine(s.conclusion), { size: 12, style: 'italic' }] : null,
  ].filter(Boolean);
  if (end.length) { w.space(2); w.keep(end); for (const [text, opts] of end) w.para(text, opts); }
  w.footer(s.title || '');
  return { blob: doc.output('blob'), name: fileName(s, '-cue-card'), title: ref };
}

function firstLine(text) {
  const l = lines(text);
  return l.length ? l[0] : '';
}

/*
 * The main thoughts of a main point, for the cue cards: of a point written in
 * paragraphs or lines, the first sentence of each (so a list the minister
 * typed comes through whole); of a point written as one paragraph, its first,
 * middle and last sentence. Each is kept short enough to take in at a glance.
 */
export function mainThoughts(body) {
  const paras = lines(body).map(l => l.replace(LIST_MARK, '').trim()).filter(Boolean);
  const picked = paras.length > 1 ? paras.map(p => sentences(p)[0]) : spread(sentences(paras[0] || ''), 3);
  return picked.filter(Boolean).map(x => shorten(x, 20));
}

const LIST_MARK = /^(?:[-\u2013\u2014\u2022*\u00b7]|\d{1,2}[.)]|[a-z][.)])\s+/i;
// words before a full stop that do not end a sentence: Bible books and short forms, in English and Afrikaans
const SHORT_FORMS = new Set(('cf e.g i.e etc vs v vv ch st mr mrs dr no nr bv nl ens vgl d.w.s ds ap ' +
  'gen ex exod lev num deut josh judg sam kgs chr neh esth ps prov eccl isa jer lam ezek dan hos obad mic nah hab zeph hag zech mal ' +
  'matt mt mk lk jn rom cor gal eph phil col thess tim tit philem heb jas pet rev ' +
  'eks spr pred jes eseg joh hand kor ef fil kol tess filem jak op').split(' '));

/** A paragraph in its sentences. A full stop after a short form ("Rom.", "e.g.", "bv.") or an initial does not end one. */
export function sentences(text) {
  const out = [];
  const end = /([.!?\u2026])["'\u201d\u2019)\]]*\s+(?=["'\u201c\u2018(]?(?:\p{Lu}|['\u2019]n\s))/gu;
  let from = 0, m;
  while ((m = end.exec(text))) {
    if (m[1] === '.') {
      const word = ((text.slice(from, m.index).match(/(\S+)$/) || [])[1] || '').replace(/^["'\u201c\u2018(]+/, '').toLowerCase();
      if (SHORT_FORMS.has(word) || /^\p{L}$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) continue;
    }
    out.push(text.slice(from, m.index + m[0].length).trim());
    from = m.index + m[0].length;
  }
  const rest = text.slice(from).trim();
  if (rest) out.push(rest);
  return out;
}

/** k items spread evenly over a list, the first and the last always among them, in their order. */
function spread(list, k) {
  if (list.length <= k) return list;
  const at = new Set();
  for (let i = 0; i < k; i++) at.add(Math.round(i * (list.length - 1) / (k - 1)));
  return [...at].sort((a, b) => a - b).map(i => list[i]);
}

/** A line of at most `max` words; a longer one is cut a few words earlier and ends in an ellipsis. */
export function shorten(text, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max - 4).join(' ').replace(/[,;:\u2013\u2014-]+$/, '') + ' \u2026';
}

/**
 * The Guide's article piece by piece, as Claude broke it down (s.breakdown):
 * under the Guide's own headings, each piece's words, what it says in plain
 * words, what it gives the sermon, and the passages and Catechism sections
 * that bring depth to it. The thread of the whole article comes first.
 */
export function breakdownPdf(s) {
  const a = s.breakdown;
  if (!a || !(a.parts || []).length) throw new Error(t('There is no breakdown of the article yet.'));
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const ref = refLabel(s);
  const title = t('The Guide, piece by piece');

  w.font(9, 'normal', MUTED);
  if (serviceLine(s)) { doc.text(serviceLine(s), w.m, w.y); w.y += 6; }
  w.font(18, 'bold', INK);
  doc.text(title, w.m, w.y + 5);
  w.y += 10;
  if (s.title || s.theme) w.para(s.title || s.theme, { style: 'bold', size: 12, after: 1 });
  if (ref) {
    w.font(12, 'bold', BLUE);
    doc.text(ref + (s.translation ? `  (${s.translation})` : ''), w.m, w.y + 3);
    w.y += 7;
  }
  w.rule();

  if (a.thread) { w.heading(t('The thread')); w.para(a.thread); }
  let heading = null;
  for (const p of a.parts) {
    if ((p.heading || '') !== heading) {
      heading = p.heading || '';
      if (heading) w.heading(heading);
    }
    w.ensure(16);   // a piece's words and the start of its plain words stay on one page
    w.para(`\u201c${p.quote}\u201d`, { serif: true, style: 'italic', size: 11, after: 1 });
    if (p.said) w.para(t('In plain words: ') + p.said, { indent: 4, size: 10.5, after: 1 });
    if (p.insight) w.para(t('For the sermon: ') + p.insight, { indent: 4, size: 10.5, after: 1 });
    for (const x of p.bible || []) w.para(`• ${x.reference}${x.why ? ' – ' + x.why : ''}`, { indent: 8, size: 10, after: 0.5 });
    for (const c of p.catechism || []) w.para(`• ${t('Catechism')} ${c.n} ${c.title}${c.why ? ' – ' + c.why : ''}`, { indent: 8, size: 10, after: 0.5 });
    w.space(3);
  }
  w.para(t('Divine Service Guide © New Apostolic Church International. Broken down by {model} for your own preparation; a starting point, not the sermon.', { model: modelLabel(a.model) }), { size: 8, color: MUTED, after: 1 });

  const who = [state.settings.name, t('Study Bible')].filter(Boolean).join('  ·  ');
  w.footer(who);
  return { blob: doc.output('blob'), name: fileName(s, '-guide'), title };
}

/**
 * The notes for the one who leads a reflection evening (reflect.js): slide
 * by slide its number and name, the question it asks, and what to say and
 * do there. In the language of the slides, like the notes themselves. The
 * notes run on from page to page with no gap at the foot of a page (Jerome:
 * a slide that jumped whole to the next page left half a page empty). A
 * slide's heading, its question or a main point is never left alone at the
 * foot of a page, and a page that goes on with a slide says so at its head.
 */
export function facilitatorPdf(inp, slides) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const W = S.words(inp.lang);
  const title = W.notes;

  const top = [W.evening, S.longDate(inp.evening, inp.lang), inp.congregation ? W.congregation(inp.congregation) : ''].filter(Boolean).join('  \u00b7  ');
  w.font(9.5, 'normal', MUTED);
  doc.text(top, w.m, w.y);
  w.y += 7;
  w.font(20, 'bold', INK);
  doc.text(title, w.m, w.y + 5);
  w.y += 11;
  if (inp.title) w.para(inp.title, { style: 'bold', size: 13, after: 1 });
  if (inp.reference) w.para(inp.reference, { style: 'bold', size: 12, color: BLUE, after: 1 });
  w.rule();

  for (const sl of slides) {
    const head = `${W.slide(sl.n)}  \u00b7  ${S.slideName(sl, inp.lang)}`;
    const parts = [[head, { style: 'bold', size: 13, color: BLUE, after: 1.5, withNext: true }]];
    if (sl.kind === 'question' && sl.question) parts.push([sl.question, { style: 'bold', size: 12.5, after: 2.5, withNext: true }]);
    // the notes: a blank line between paragraphs; a main point in bold, its thoughts under it with a dash
    for (const block of String(sl.notes || '').split(/\n\s*\n/)) {
      const rows = block.split('\n').filter(x => x.trim());
      rows.forEach((row, k) => {
        const after = k === rows.length - 1 ? 3 : 1;
        const sub = row.match(/^\s*[\u2013\u2022-]\s+(.*)$/);
        if (sub) parts.push([sub[1], { size: 12, indent: 6, bullet: '\u2013', leading: 1.45, after }]);
        else if (/^\d{1,2}\.\s/.test(row)) parts.push([row.trim(), { size: 12, style: 'bold', leading: 1.45, after, withNext: true }]);
        else parts.push([row.trim(), { size: 12, leading: 1.45, after }]);
      });
    }
    w.flow(parts, `${head} (${W.continued})`);
    w.space(4);
  }

  w.footer([state.settings.name, t('Study Bible')].filter(Boolean).join('  \u00b7  '));
  const name = [W.evening, inp.evening, '-', W.notes].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
  return { blob: doc.output('blob'), name, title };
}

/**
 * Theology on a place, everything the page shows (theology.js savedPage):
 * the verses, for a book its own introduction, all that Claude wrote and the
 * Catechism sections that quote the place, in the order of the screen. A
 * study sheet to keep, print or share. The parts run on from page to page,
 * and a heading or a name (a key word, a Catechism section) never stands
 * alone at the foot of a page.
 */
export function theologyPdf(page) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const s = winAnsi;

  w.font(9, 'normal', MUTED);
  doc.text(s(page.top), w.m, w.y);
  w.y += 6;
  w.para(s(page.title), { style: 'bold', size: 18, after: 1.5 });
  for (const line of page.lines) w.para(s(line), { size: 11.5, after: 1 });
  if (page.quote) {
    w.para(s(`\u201c${page.quote.text}\u201d`), { serif: true, style: 'italic', size: 11.5, after: 1 });
    if (page.quote.cite) w.para(s(page.quote.cite), { size: 9, color: MUTED, after: 1 });
  }
  w.rule();

  let parts = [];
  const run = () => { if (parts.length) w.flow(parts); parts = []; };
  for (const b of page.blocks) {
    if (b.big) { run(); w.space(3); }   // what Claude wrote starts with a little room above it
    if (b.head) parts.push([s(b.head), b.big ? { style: 'bold', size: 14.5, after: 2, withNext: true } : { style: 'bold', size: 11.5, color: BLUE, after: 1.2, withNext: true }]);
    for (const x of b.items) {
      if (x.li) parts.push([s(x.li), { size: 10.5, bullet: '\u2022', after: 1 }]);
      else if (x.lead) {
        parts.push([s(x.lead), { size: 10.5, style: 'bold', after: 0.6, withNext: true }]);
        for (const line of x.lines || []) parts.push([s(line), { size: 10.5, indent: 4, after: 1 }]);
        for (const line of x.small || []) parts.push([s(line), { size: 9, color: MUTED, indent: 4, after: 1 }]);
        parts[parts.length - 1][1].after = 2.5;
      } else parts.push([s(x.p), x.small ? { size: 8.5, color: MUTED, after: 2 } : { size: 10.5, after: 2 }]);
    }
    if (parts.length && b.items.length) parts[parts.length - 1][1].after += 1.5;   // room before the next heading
  }
  run();

  w.footer(s([state.settings.name, t('Study Bible')].filter(Boolean).join('  \u00b7  ')));
  return { blob: doc.output('blob'), name: page.file, title: page.title };
}

/*
 * The letters of these PDFs (Helvetica and Times, which every PDF reader has)
 * know only the Western European letters (WinAnsi). Claude may give a Greek
 * or Hebrew word, or a letter with a mark such as the ē of agapē: the PDF gets
 * the letter without the mark and Greek in Latin letters (ἀγάπη: agape).
 * Hebrew is left out; its plain meaning stands beside it.
 */
const WIN_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
const GREEK = { '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'g', '\u03b4': 'd', '\u03b5': 'e', '\u03b6': 'z', '\u03b7': 'e', '\u03b8': 'th',
  '\u03b9': 'i', '\u03ba': 'k', '\u03bb': 'l', '\u03bc': 'm', '\u03bd': 'n', '\u03be': 'x', '\u03bf': 'o', '\u03c0': 'p', '\u03c1': 'r',
  '\u03c2': 's', '\u03c3': 's', '\u03c4': 't', '\u03c5': 'u', '\u03c6': 'ph', '\u03c7': 'ch', '\u03c8': 'ps', '\u03c9': 'o' };
const inWin = ch => { const c = ch.codePointAt(0); return c === 10 || (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(c); };

export function winAnsi(text) {
  let out = '', dropped = false;
  for (const ch of String(text == null ? '' : text)) {
    if (inWin(ch)) { out += ch; continue; }
    if (/[\u2000-\u200a\u202f\u205f\u3000]/.test(ch)) { out += ' '; continue; }
    if (/[\u200b-\u200d\u2060\ufeff]/.test(ch)) continue;            // joiners: nothing to print
    if (/[\u02bc\u02be\u02bf\u2032]/.test(ch)) { out += '\u2019'; continue; }   // the marks for a breath or a stop in a Hebrew word
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const lower = base.toLowerCase();
    if (GREEK[lower]) { out += base === lower ? GREEK[lower] : GREEK[lower][0].toUpperCase() + GREEK[lower].slice(1); continue; }
    if (base && [...base].every(inWin)) { out += base; continue; }
    dropped = true;
  }
  // what is left where a word was left out: "chesed ()" becomes "chesed"
  return dropped ? out.replace(/[([]\s*[)\]]/g, '').replace(/ {2,}/g, ' ').replace(/ ([,.;:)])/g, '$1').trim() : out;
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

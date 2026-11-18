/*
 * Print or save, under Handbooks: what the Church's books show on the screen
 * as a PDF in large clear type, drawn with jsPDF like the sermon notes
 * (pdf.js), so that Save as PDF, Print and Share work there as they do under
 * "Print or save" in Prepare:
 *
 *   A chapter   A4 portrait: one chapter of a handbook, the chapter with the
 *               chapters under it, or the whole handbook; each chapter under
 *               its number and title in blue, with the book's own headings,
 *               lists, notes and binding words as the screen shows them. The
 *               Creed the same, whole or one article, with the Catechism's
 *               section named under each article.
 *   A section   A4 portrait: a section of the Catechism, or the section with
 *               those under it: the book's "in short", its paragraphs,
 *               lists, tables and footnotes.
 *   A card      A4, or A5 like the minister's cards at the altar: one card of
 *               the altar booklet or all its cards, each on a page of its
 *               own, the label on the left and the words on the right, as
 *               the booklet prints them.
 *
 * Every page has the same Print button (printButton), which opens the same
 * sheet (printSheet): a row for each thing the page can give, with Save as
 * PDF, Print and, on a phone that can, Share. The PDF is built on the device
 * itself and goes only where the person sends it; printing goes through the
 * finished PDF, so the paper matches the file. The letters are the PDF's
 * own (Helvetica, Times), which know the Western European letters (pdf.js
 * winAnsi): Afrikaans and English print whole.
 */
import { el, toast, seg, sheet, fmtDate } from './ui.js';
import { t, tl } from './i18n.js';
import { Writer, winAnsi, download, print as printPdf, share, canShare } from './pdf.js';
import * as Cat from './catechism.js';
import { label, addrOf } from './ask.js';

const BLUE = [1, 104, 181];      // the Church's blue (#0168B5), as in pdf.js
const INK = [29, 43, 56];
const MUTED = [91, 107, 123];
const LINE = [209, 213, 219];
const BULLET = { 1: '•', 2: '–', 3: '·' };   // the PDF's letters have no hollow bullet: a dash and a dot for the deeper lists
const READ = { size: 12, leading: 1.45, after: 2.5 };     // the running text: large, with room between the lines, as in "The sermon"

function jsPDF() {
  const lib = window.jspdf && window.jspdf.jsPDF;
  if (!lib) throw new Error(t('The PDF library did not load. Reload the page while online.'));
  return lib;
}

/* ---------------------------------------------------------------- the button and the sheet */

/** The Print button of a page under Handbooks: a printer, and the word. */
export function printButton(onclick) {
  const ico = el('span', { class: 'ico', 'aria-hidden': 'true' });
  ico.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>';
  return el('button', { class: 'btn small ghost print-btn', type: 'button', title: t('Print or save as PDF'), 'aria-label': t('Print or save as PDF'), onclick }, [ico, t('Print')]);
}

/** The paper the altar cards are printed on, as last chosen on this device: A4, or A5 like the cards at the altar. */
function paperSize() {
  try { return localStorage.getItem('sb-print-paper') === 'a5' ? 'a5' : 'a4'; } catch (e) { return 'a4'; }
}

/**
 * The sheet behind every Print button: a row for each thing the page can
 * give ([label, make], make(paper) building {blob, name, title}), each with
 * Save as PDF, Print and, on a phone that can, Share, as under "Print or
 * save" in Prepare. With `paper`, A4 | A5 stands above the rows (the altar
 * cards); the choice is kept on the device.
 */
export function printSheet(rows, { paper = false } = {}) {
  const s = sheet(t('Print or save'));
  let size = paperSize();
  s.body.append(el('p', { class: 'small muted print-lead', text: t('As a PDF in large clear type, to keep, to print or to send on.') }));
  if (paper) {
    s.body.append(el('div', { class: 'row print-paper' }, [
      el('span', { class: 'small', text: t('Paper') }),
      seg([['a4', 'A4'], ['a5', 'A5']], size, v => { size = v; try { localStorage.setItem('sb-print-paper', v); } catch (e) { /* private mode: this time only */ } }, { label: t('Paper') }),
    ]));
  }
  async function run(make, how) {
    try {
      toast(t('Building the PDF…'));
      await new Promise(r => setTimeout(r, 30));   // the message shows before the work starts; a whole book takes a moment
      const r = make(size);
      s.close();
      if (how === 'print') { printPdf(r); toast(t('Sending to the printer…')); }
      else if (how === 'share') { if (await share(r) === 'downloaded') toast(t('Sharing is not available here, so the PDF was downloaded.')); }
      else { download(r); toast(t('Saved ') + r.name); }
    } catch (e) {
      console.error(e);
      toast(e.message || t('The PDF could not be built.'), true);
    }
  }
  s.body.append(el('div', { class: 'outputs print-rows' }, rows.map(([text, make]) => el('div', { class: 'row out-row' }, [
    el('span', { class: 'out-label', text }),
    el('button', { class: 'btn small', type: 'button', text: t('Save as PDF'), onclick: () => run(make, 'download') }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Print'), onclick: () => run(make, 'print') }),
    canShare() ? el('button', { class: 'btn small ghost', type: 'button', text: t('Share'), onclick: () => run(make, 'share') }) : null,
  ]))));
  return s;
}

/* ---------------------------------------------------------------- the words */

/** The words of a block's runs as one line; a raised figure (a footnote mark) in brackets, since the PDF's letters cannot raise it. */
const runText = runs => runs.map(([text, style]) => (style.includes('sup') ? `[${text}]` : text)).join('');

/** True when every run of a block that has letters in it carries the style: the whole paragraph is italic, bold or small. */
const every = (runs, st) => runs.some(([text]) => text.trim()) && runs.every(([text, style]) => style.includes(st) || !text.trim());

const styleOf = runs => (every(runs, 'b') ? (every(runs, 'i') ? 'bolditalic' : 'bold') : every(runs, 'i') ? 'italic' : 'normal');

/** The raised figures of the Catechism's text as [1]: the PDF's letters have only some of them. */
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const plainSup = text => String(text == null ? '' : text).replace(/[⁰¹²³⁴-⁹]+/g, m => '[' + [...m].map(c => SUPS.indexOf(c)).join('') + ']');

/** Text as the PDF's letters can print it. */
const s = text => winAnsi(plainSup(text));

/** A file name from a key or a chapter number. */
const slug = x => String(x).replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** The head of a page: a small line over the title, the title itself in large letters, and a small line under it. */
function head(w, over, title, under) {
  const doc = w.doc;
  w.font(9, 'normal', MUTED);
  doc.text(s(over), w.m, w.y);
  w.y += 6;
  w.font(18, 'bold', INK);
  for (const line of doc.splitTextToSize(s(title), w.width)) { doc.text(line, w.m, w.y + 5); w.y += 8; }
  w.y += 1;
  if (under) w.para(s(under), { size: 9, color: MUTED, after: 1 });
  w.rule();
}

/** A chapter's or a section's heading inside the text, blue, larger the nearer it is to the top of the book; it goes over to the next page with what follows it. */
function heading(text, n) {
  const depth = n && !/^A/.test(n) && n !== 'Intro' ? String(n).split('.').length : 1;
  return [s(text), { style: 'bold', size: depth <= 1 ? 14 : depth === 2 ? 12.5 : 11.5, color: BLUE, after: 2, withNext: true }];
}

/** More room after the last paragraph of a chapter, before the next heading. */
function closeChapter(parts) {
  if (parts.length) parts[parts.length - 1][1].after = 5;
}

/* ---------------------------------------------------------------- a chapter of a handbook, or the Creed */

/** One block of a chapter (handbook.js) as a paragraph [text, opts] for Writer.flow. */
function blockPart(b) {
  const d = Math.min(3, Math.max(0, b.d || 0));
  const text = s(runText(b.t));
  const style = styleOf(b.t);
  const size = every(b.t, 's') ? 10.5 : READ.size;
  if (b.k === 'h') return [text, { style: 'bold', size: 12, after: 1.5, withNext: true }];
  if (b.k === 'li') return [text, { ...READ, size, style, indent: 2 + 5 * Math.max(0, d - 1), bullet: BULLET[d] || BULLET[1], after: 1.5 }];
  if (b.k === 'quote') return [text, { ...READ, size, serif: true, style: style === 'normal' ? 'italic' : style, indent: 4 + 5 * d }];   // the book's binding words, in italics
  if (b.k === 'note') return [text, { size: 9.5, leading: 1.35, color: MUTED, indent: 2 + 5 * d, after: 1.5 }];
  return [text, { ...READ, size, style, indent: 5 * d }];
}

/**
 * Chapters of a handbook as one PDF: a chapter on its own, a chapter with
 * the chapters under it, or the whole book (`whole`), in the book's order.
 * The first chapter's number and title is the title of the page; the book
 * stands over it, its edition and the page in the printed book under it.
 * The Creed (creed.js) prints the same way, whole or one article, with the
 * Catechism's section named under each article in the Creed's language.
 * `credit` is the copyright line for the foot (handbooks.js).
 */
export function chapterPdf(hb, chapters, { whole = false, credit = '' } = {}) {
  if (!chapters.length) throw new Error(t('There is nothing to print.'));
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const first = chapters[0];
  const title = whole ? hb.title : label(first);
  const own = hb.ownTitle && hb.ownTitle !== hb.title ? hb.ownTitle : '';
  const under = [own, hb.edition, !whole && !hb.builtIn && first.page ? tl(hb.language, 'Page {page} of the printed book', { page: first.page }) : ''].filter(Boolean).join('  ·  ');
  head(w, whole ? (hb.org || tl(hb.language, 'New Apostolic Church')) : hb.title, title, under);   // over the whole book, the Church, in the book's language

  const parts = [];
  chapters.forEach((c, i) => {
    if (i > 0 || whole) parts.push(heading(label(c), c.n));
    for (const b of c.blocks) parts.push(blockPart(b));
    if (c.cat) parts.push([s(tl(hb.language, 'In the Catechism: {n}', { n: c.cat })), { size: 9.5, color: MUTED, after: 3 }]);   // under an article of the Creed
    closeChapter(parts);
  });
  w.flow(parts);
  w.space(2);
  if (credit) w.para(s(credit), { size: 8, color: MUTED, after: 1 });
  w.footer(s(whole ? (own || hb.title) : `${hb.title}  ·  ${label(first)}`));
  const name = whole ? `${slug(hb.key)}-${hb.language}.pdf` : `${slug(hb.key)}-${slug(addrOf(hb, first))}-${hb.language}.pdf`;
  return { blob: doc.output('blob'), name, title };
}

/* ---------------------------------------------------------------- a section of the Catechism */

/**
 * Sections of the Catechism as one PDF, from the text on the device
 * (catechism.js): a section on its own, or with those under it, in the
 * book's order. Under each section's number and title: the book's own "in
 * short", then its paragraphs, headings, lists, tables (a line per cell)
 * and verses, and its footnotes in small letters.
 */
export function catechismPdf(sections) {
  if (!sections.length) throw new Error(t('There is nothing to print.'));
  const doc = new (jsPDF())({ unit: 'mm', format: 'a4' });
  const w = new Writer(doc, 20);
  const name = sec => (sec.n === 'Intro' || sec.n === 'Appendix' ? '' : sec.n + '  ') + sec.title;
  const first = sections[0];
  head(w, t('Catechism of the New Apostolic Church'), name(first), t('Printed edition page {page}.', { page: first.page || '–' }));

  const parts = [];
  sections.forEach((sec, i) => {
    if (i) parts.push(heading(name(sec), sec.n));
    const summary = Cat.summaryOf(sec.n);
    if (summary.length) {
      parts.push([t('In short'), { style: 'bold', size: 9.5, color: MUTED, after: 0.5, withNext: true }]);
      summary.forEach(p => parts.push([s(p), { size: 11.5, style: 'italic', leading: 1.4, after: 2 }]));
      parts[parts.length - 1][1].after = 3.5;
    }
    for (const line of Cat.plainLines(sec.n)) {
      if (line.kind === 'h') parts.push([s(line.text), { style: 'bold', size: 12, after: 1.5, withNext: true }]);
      else if (line.kind === 'li' && !line.single) parts.push([s(line.text), { ...READ, indent: 2, bullet: BULLET[1], after: 1.5 }]);
      else if (line.kind === 'cell') parts.push([s(`${line.label}: ${line.text}`.replace(/\s*\n\s*/g, ' ')), { ...READ, indent: 4, after: 1.5 }]);
      else if (line.kind === 'v') line.text.split('\n').forEach((v, k, all) => parts.push([s(v), { ...READ, serif: true, style: 'italic', indent: 4, after: k === all.length - 1 ? 2.5 : 0 }]));
      else parts.push([s(line.text), { ...READ, indent: line.kind === 'li' ? 4 : 0 }]);
    }
    for (const nt of Cat.notesOf(sec.n)) parts.push([s(`[${nt.n}] ${nt.t}`), { size: 9.5, leading: 1.35, color: MUTED, indent: 2, after: 1 }]);
    closeChapter(parts);
  });
  w.flow(parts);
  w.space(2);
  w.para(s(Cat.credit()), { size: 8, color: MUTED, after: 1 });
  w.footer(s(t('Catechism of the New Apostolic Church')));
  return { blob: doc.output('blob'), name: `catechism-${slug(first.n)}.pdf`, title: name(first) };
}

/* ---------------------------------------------------------------- a card of the altar booklet */

/** Sets the letters of one item of a column and gives the distance between its lines. */
function use(doc, it) {
  doc.setFont(it.serif ? 'times' : 'helvetica', it.style || 'normal');
  doc.setFontSize(it.size);
  const c = it.color || INK;
  doc.setTextColor(c[0], c[1], c[2]);
  return it.size * 0.3528 * (it.leading || 1.4);
}

/** The lines of an item in a column of a width, with a bullet hanging in front of them. */
function linesOf(doc, it, width) {
  const lead = use(doc, it);
  const hang = it.bullet ? 4.5 : 0;
  return { lead, hang, lines: doc.splitTextToSize(it.text, Math.max(10, width - (it.indent || 0) - hang)) };
}

/** The height of a column of items, as column() draws them. */
function measure(doc, items, width) {
  return items.reduce((h, it) => { const { lead, lines } = linesOf(doc, it, width); return h + lines.length * lead + (it.after == null ? 1.5 : it.after); }, 0);
}

/** Draws the items down a column from y0, going on at the top of a new page when the foot is reached: {y, pages} where it ended. */
function column(w, x, width, items, y0) {
  const doc = w.doc;
  let y = y0, pages = 0;
  for (const it of items) {
    const { lead, hang, lines } = linesOf(doc, it, width);
    lines.forEach((line, i) => {
      if (y + lead > w.h - w.m) { doc.addPage(); y = w.m; pages++; use(doc, it); }
      const x0 = x + (it.indent || 0);
      if (it.bullet && i === 0) doc.text(it.bullet, x0, y + lead * 0.75);
      doc.text(line, x0 + hang, y + lead * 0.75);
      y += lead;
    });
    y += it.after == null ? 1.5 : it.after;
  }
  return { y, pages };
}

/**
 * Cards of the altar booklet (booklet.js) as one PDF, each on a page of its
 * own: the label of each row on the left, in blue, with the booklet's lines
 * under it; the words on the right, the booklet's notes in blue italics and
 * its lists with their bullets; a dotted rule between the rows, as on the
 * screen. On A4, or on A5 like the cards at the altar (`paper`), in large
 * letters either way. A row stays on one page when it fits on a page.
 * `credit` is the copyright line for the foot (liturgy.js).
 */
export function cardPdf(bk, cards, { paper = 'a4', credit = '' } = {}) {
  if (!cards.length) throw new Error(t('There is nothing to print.'));
  const a5 = paper === 'a5';
  const doc = new (jsPDF())({ unit: 'mm', format: a5 ? 'a5' : 'a4', orientation: 'portrait' });
  if (a5) doc.viewerPreferences({ PickTrayByPDFSize: true });   // a print window that can, takes paper of the card's own size
  const w = new Writer(doc, a5 ? 12 : 18);
  const left = Math.round(w.width * 0.3), gap = a5 ? 4 : 6, right = w.width - left - gap;
  const F = a5
    ? { label: 11.5, sub: 9.5, words: 12, small: 10, title: 16, step: 7 }
    : { label: 12.5, sub: 10, words: 13, small: 10.5, title: 18, step: 8 };

  /** The dotted rule between two rows; at the foot of a page the next row simply starts the next page. */
  const rule = () => {
    w.y += 2.5;
    if (w.y + 4 > w.h - w.m) { doc.addPage(); w.y = w.m; return; }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([0.6, 1.4], 0);
    doc.line(w.m, w.y, w.w - w.m, w.y);
    doc.setLineDashPattern([], 0);
    w.y += 3.5;
  };

  /** One row: the label and its lines on the left, the words on the right, side by side from the same height. */
  const row = r => {
    const L = [];
    if (r.label) L.push({ text: s(r.label), size: F.label, style: 'bold', color: BLUE, leading: 1.3, after: 1 });
    for (const x of r.sub || []) L.push({ text: s(x), size: F.sub, style: 'italic', color: MUTED, leading: 1.3, after: 0.5 });
    const R = (r.blocks || []).map(b => {
      const d = Math.min(3, Math.max(0, b.d || 0));
      const text = s(runText(b.t));
      const size = every(b.t, 's') ? F.small : F.words;
      const style = styleOf(b.t);
      if (b.k === 'li') return { text, size, style, indent: 5 * Math.max(0, d - 1), bullet: BULLET[d] || BULLET[1], after: 1.5 };
      if (b.k === 'note') return { text, size: size === F.words ? F.words - 1 : size, style: style === 'normal' ? 'italic' : style, color: BLUE, indent: 5 * d, after: 2 };
      return { text, size, style, indent: 5 * d, after: 2 };
    });
    const h = Math.max(measure(doc, L, left), measure(doc, R, right));
    if (w.y + h > w.h - w.m && h <= w.h - 2 * w.m) { doc.addPage(); w.y = w.m; }
    const y0 = w.y;
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    const a = column(w, w.m, left, L, y0);
    if (a.pages) doc.setPage(page);   // a label is short and never fills a page; should it, the words still start beside it
    const b = column(w, w.m + left + gap, right, R, y0);
    w.y = b.pages ? b.y : Math.max(a.y, b.y);
  };

  cards.forEach((card, i) => {
    if (i) { doc.addPage(); w.y = w.m; }
    w.font(9, 'normal', MUTED);
    doc.text(s(bk.org || t('New Apostolic Church')), w.m, w.y);
    w.y += 6;
    w.font(F.title, 'bold', INK);
    for (const line of doc.splitTextToSize(s(card.title), w.width)) { doc.text(line, w.m, w.y + 5); w.y += F.step; }
    w.y += 3;
    (card.rows || []).forEach((r, j) => { if (j) rule(); row(r); });
    if (card.edited) { w.y += 3; w.para(s(t('Changed by you on {date}.', { date: fmtDate(card.edited) })), { size: 8.5, color: MUTED, after: 1 }); }
  });
  w.space(3);
  if (credit) w.para(s(credit), { size: 8, color: MUTED, after: 1 });
  const cover = bk.cover || t('Liturgy for altar use');
  w.footer(s(cards.length === 1 ? `${cover}  ·  ${cards[0].title}` : cover));
  const name = cards.length === 1 ? `liturgy-${slug(cards[0].key)}-${bk.language}.pdf` : `liturgy-cards-${bk.language}.pdf`;
  return { blob: doc.output('blob'), name, title: cards.length === 1 ? cards[0].title : cover };
}

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
 *               the altar booklet or all its cards, the label on the left
 *               and the words on the right, as the booklet prints them. A
 *               card is fitted on one page, in the largest letters that fit
 *               there; only a card too long to be read at that size takes a
 *               second page.
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
import { numberOf } from './handbook.js';   // a chapter's number, also where the book prints it in the title

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
 * cards); the choice is kept on the device. `note(paper)` gives a line for
 * under that choice, which says how the cards go on the paper (cardNote).
 */
export function printSheet(rows, { paper = false, note = null } = {}) {
  const s = sheet(t('Print or save'));
  let size = paperSize();
  s.body.append(el('p', { class: 'small muted print-lead', text: t('As a PDF in large clear type, to keep, to print or to send on.') }));
  if (paper) {
    const says = note ? el('p', { class: 'small print-note', role: 'status' }) : null;
    // worked out once the sheet shows, since fitting every card of a booklet takes a moment on a phone
    const tell = () => { if (says) setTimeout(() => { try { says.textContent = note(size); } catch (e) { says.textContent = ''; } }, 50); };
    s.body.append(el('div', { class: 'row print-paper' }, [
      el('span', { class: 'small', text: t('Paper') }),
      seg([['a4', 'A4'], ['a5', 'A5']], size, v => { size = v; try { localStorage.setItem('sb-print-paper', v); } catch (e) { /* private mode: this time only */ } tell(); }, { label: t('Paper') }),
    ]));
    if (says) s.body.append(says);
    tell();
  }
  let busy = false;   // one PDF at a time: a second tap while a book is being built does nothing
  async function run(make, how) {
    if (busy) return;
    busy = true;
    try {
      toast(t('Building the PDF…'));
      // the message shows before the work starts, since a whole book takes a moment; a share has to follow the tap at once, or the phone refuses it
      if (how !== 'share') await new Promise(r => setTimeout(r, 30));
      const r = make(size);
      s.close();
      if (how === 'print') { printPdf(r); toast(t('Sending to the printer…')); }
      else if (how === 'share') { if (await share(r) === 'downloaded') toast(t('Sharing is not available here, so the PDF was downloaded.')); }
      else { download(r); toast(t('Saved ') + r.name); }
    } catch (e) {
      console.error(e);
      toast(e.message || t('The PDF could not be built.'), true);
    } finally {
      busy = false;
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

/**
 * Sends a PDF to the printer at once, on the paper last chosen, without the
 * sheet: what Ctrl+P does on an altar card (liturgy.js), so that the keys
 * give the same page as the Print button. False when the PDF could not be
 * built.
 */
export function printNow(make) {
  try {
    printPdf(make(paperSize()));
    toast(t('Sending to the printer…'));
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
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

/** A chapter's or a section's heading inside the text, blue, larger the nearer it is to the top of the book (by its number); it goes over to the next page with what follows it. */
function heading(text, c) {
  const n = numberOf(c);
  const depth = n ? n.split('.').length : 1;
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
  head(w, whole ? ((!hb.builtIn && hb.org) || tl(hb.language, 'New Apostolic Church')) : hb.title, title, under);   // over the whole book, the Church as the book names it; over the Creed, in the Creed's language

  const parts = [];
  chapters.forEach((c, i) => {
    if (i > 0 || whole) parts.push(heading(hb.builtIn ? c.title : label(c), hb.builtIn ? {} : c));   // an article of the Creed under its title alone, as its page shows it
    for (const b of c.blocks) parts.push(blockPart(b));
    if (c.cat) parts.push([s(tl(hb.language, 'In the Catechism: {n}', { n: c.cat })), { size: 9.5, color: MUTED, after: 3 }]);   // under an article of the Creed
    closeChapter(parts);
  });
  w.flow(parts);
  w.space(2);
  if (credit) w.para(s(credit), { size: 8, color: MUTED, after: 1 });
  w.footer(s(whole ? (own || hb.title) : `${hb.title}  ·  ${label(first)}`));
  const name = whole ? `${slug(hb.key)}-${hb.language}.pdf` : `${slug(hb.key)}-${slug(numberOf(first) || addrOf(hb, first))}-${hb.language}.pdf`;   // by the chapter's number, also where only its title has it
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
    if (i) parts.push(heading(name(sec), sec));
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

/*
 * A card lies at the altar as one sheet, so it is fitted on its paper: on one
 * page whenever its words can still be read at that size, in the largest
 * letters that fit, up to the large type of a short card. Only a card too
 * long for that takes a second page, and then it has the largest letters
 * that keep it to those pages. Everything on the card keeps its proportion to
 * the words: the labels, the notes, the title and the room between the rows.
 */
const PAPER = {
  a4: { format: 'a4', side: 14, foot: 14, words: 13, gap: 6 },
  a5: { format: 'a5', side: 10, foot: 12, words: 12, gap: 4 },   // like the cards at the altar; the foot stays clear of the page's footer line
};
const SMALLEST = 9;    // points: words smaller than this are not read at an altar, so a card that long goes over the page
const STEP = 0.25;     // the letters are tried a quarter of a point at a time
const TINY = 8;        // the lines under a label and the booklet's small print never go under this

/**
 * A mark that stands alone after a space stays with the word before it, so
 * that it never begins a line: the booklet's closing quote after a quoted
 * word (‘Yes’ ”) and the dots of ". . .".
 */
const glued = text => text.replace(/ (?=[.…”’!?,;:)\]»]+(?: |$))/g, '\u00a0');

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
  const hang = it.bullet ? it.hang || 4.5 : 0;
  return { lead, hang, lines: doc.splitTextToSize(it.text, Math.max(10, width - (it.indent || 0) - hang)) };
}

/** The height of a column of items, as column() draws them. */
function measure(doc, items, width) {
  return items.reduce((h, it) => { const { lead, lines } = linesOf(doc, it, width); return h + lines.length * lead + (it.after == null ? 1.5 : it.after); }, 0);
}

/** Draws the items down a column from y0, going on at the top of a new page when the foot is reached: {y, pages} where it ended. */
function column(doc, g, x, width, items, y0) {
  let y = y0, pages = 0;
  for (const it of items) {
    const { lead, hang, lines } = linesOf(doc, it, width);
    lines.forEach((line, i) => {
      if (y + lead > g.foot) { doc.addPage(); y = g.top; pages++; use(doc, it); }
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
 * Draws one card from the top of the last page of `doc`, its words `pt`
 * points large, and gives the number of pages it took. The label of each
 * row is on the left, in blue, with the booklet's lines under it; the words
 * are on the right, the booklet's notes in blue italics and its lists with
 * their bullets; a dotted rule lies between the rows, as on the screen. The
 * copyright line `credit` closes the card.
 */
function drawCard(doc, P, pt, bk, card, credit) {
  const k = pt / P.words;   // 1 is the large type; the room between the lines and the rows shrinks with the letters
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const g = { top: P.side, foot: H - P.foot };
  const x = P.side, width = W - 2 * P.side;
  const left = Math.round(width * 0.3), right = width - left - P.gap;
  const before = doc.internal.getNumberOfPages();
  let y = g.top;

  use(doc, { size: Math.max(7, 9 * k), color: MUTED });
  doc.text(s(bk.org || t('New Apostolic Church')), x, y);
  y += 6 * k;
  const title = pt * 1.38;
  use(doc, { size: title, style: 'bold' });
  for (const line of doc.splitTextToSize(s(card.title), width)) { doc.text(line, x, y + title * 0.28); y += title * 0.445; }
  y += 3 * k;

  const RULE = 6 * k;   // the room the dotted rule takes between two rows
  /** The dotted rule between two rows. */
  const rule = () => {
    y += 2.5 * k;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([0.6, 1.4], 0);
    doc.line(x, y, W - x, y);
    doc.setLineDashPattern([], 0);
    y += RULE - 2.5 * k;
  };

  /**
   * One row: the label and its lines on the left, the words on the right,
   * side by side from the same height. After another row it comes under a
   * dotted rule, or, when it no longer fits on the page, at the top of the
   * next one without a rule over it. Only a row longer than a page is
   * parted: it starts where it stands and goes on overleaf.
   */
  const row = (r, first) => {
    const L = [];
    if (r.label) L.push({ text: s(r.label), size: pt * 0.96, style: 'bold', color: BLUE, leading: 1.3, after: k });
    for (const sub of r.sub || []) L.push({ text: s(sub), size: Math.max(TINY, pt * 0.78), style: 'italic', color: MUTED, leading: 1.3, after: 0.5 * k });
    const R = (r.blocks || []).map(b => {
      const d = Math.min(3, Math.max(0, b.d || 0));
      const text = glued(s(runText(b.t)));
      const small = every(b.t, 's');
      const size = small ? Math.max(TINY, pt * 0.82) : pt;
      const style = styleOf(b.t);
      if (b.k === 'li') return { text, size, style, indent: 5 * k * Math.max(0, d - 1), bullet: BULLET[d] || BULLET[1], hang: 4.5 * k, after: 1.5 * k };
      if (b.k === 'note') return { text, size: small ? size : pt * 0.92, style: style === 'normal' ? 'italic' : style, color: BLUE, indent: 5 * k * d, after: 2 * k };
      return { text, size, style, indent: 5 * k * d, after: 2 * k };
    });
    const h = Math.max(measure(doc, L, left), measure(doc, R, right));
    if (!first) {
      const long = h > g.foot - g.top;
      if (y + RULE + h <= g.foot || (long && y + RULE + 12 * k <= g.foot)) rule();
      else { doc.addPage(); y = g.top; }
    }
    const page = doc.internal.getCurrentPageInfo().pageNumber;
    const a = column(doc, g, x, left, L, y);
    if (a.pages) doc.setPage(page);   // a label is short and never fills a page; should it, the words still start beside it
    const b = column(doc, g, x + left + P.gap, right, R, y);
    y = b.pages ? b.y : Math.max(a.y, b.y);
  };
  (card.rows || []).forEach((r, j) => row(r, !j));

  const tail = [];
  if (card.edited) tail.push({ text: s(t('Changed by you on {date}.', { date: fmtDate(card.edited) })), size: Math.max(7, 8.5 * k), color: MUTED, leading: 1.35, after: 1 });
  if (credit) tail.push({ text: s(credit), size: Math.max(6.5, 8 * k), color: MUTED, leading: 1.35, after: 1 });
  for (const it of tail) { y += 3 * k; y = column(doc, g, x, width, [it], y).y; }
  return doc.internal.getNumberOfPages() - before + 1;
}

/**
 * How a card goes on its paper: {pt, pages}, the size of its words and the
 * pages it takes. A card that fits on one page in the large type has it;
 * else it gets the fewest pages its words can be read on (never smaller
 * than SMALLEST) and the largest letters that keep it to them. Each try
 * draws the card on a sheet of scratch paper, so the size found is the size
 * that is drawn.
 */
function fitCard(lib, P, bk, card, credit) {
  const pagesAt = pt => drawCard(new lib({ unit: 'mm', format: P.format, orientation: 'portrait' }), P, pt, bk, card, credit);
  const large = pagesAt(P.words);
  if (large === 1) return { pt: P.words, pages: 1 };
  const pages = pagesAt(SMALLEST);
  if (pages === large) return { pt: P.words, pages };   // smaller letters would save no page
  let lo = 0, hi = Math.round((P.words - SMALLEST) / STEP);   // steps up from the smallest: lo keeps to the pages, hi does not
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pagesAt(SMALLEST + mid * STEP) <= pages) lo = mid; else hi = mid;
  }
  return { pt: SMALLEST + lo * STEP, pages };
}

const paperOf = paper => PAPER[paper === 'a5' ? 'a5' : 'a4'];

/** How the cards would go on a paper, without building the PDF: for each, {pt, pages} (fitCard). */
export function cardFit(bk, cards, { paper = 'a4', credit = '' } = {}) {
  const lib = jsPDF(), P = paperOf(paper);
  return cards.map(card => fitCard(lib, P, bk, card, credit));
}

/**
 * What the sheet says about the cards before a page is printed (printSheet's
 * `note`): a function of the paper chosen that tells whether the card fits
 * on one page, or how many of the cards do not, and, on A5, what A4 would
 * give. The fitting is done once for each paper.
 */
export function cardNote(bk, cards, { credit = '' } = {}) {
  const memo = {};
  const long = paper => {   // the pages of each card that takes more than one
    if (!memo[paper]) memo[paper] = cardFit(bk, cards, { paper, credit }).map(f => f.pages).filter(n => n > 1);
    return memo[paper];
  };
  return paper => {
    const here = long(paper), m = cards.length;
    const a4 = paper === 'a5' ? long('a4') : here;   // on A5: what the larger paper would give
    if (m === 1) {
      if (!here.length) return t('This card fits on one page.');
      if (!a4.length) return t('On A5 this card takes {n} pages. On A4 it fits on one page.', { n: here[0] });
      return t('This card is too long for one page: it takes {n} pages.', { n: here[0] });
    }
    if (!here.length) return t('Each card fits on one page.');
    const text = t('Longer than one page: {n} of the {m} cards.', { n: here.length, m });
    if (a4.length >= here.length) return text;
    return text + ' ' + (a4.length ? t('On A4: {n} of the {m}.', { n: a4.length, m }) : t('On A4 each card fits on one page.'));
  };
}

/**
 * Cards of the altar booklet (booklet.js) as one PDF, each fitted on a page
 * of its own (fitCard, drawCard), on A4 or on A5 like the cards at the altar
 * (`paper`). `credit` is the copyright line that closes each card
 * (liturgy.js). The result also says how each card was fitted (`fit`).
 */
export function cardPdf(bk, cards, { paper = 'a4', credit = '' } = {}) {
  if (!cards.length) throw new Error(t('There is nothing to print.'));
  const lib = jsPDF(), P = paperOf(paper);
  const doc = new lib({ unit: 'mm', format: P.format, orientation: 'portrait' });
  if (P.format === 'a5') doc.viewerPreferences({ PickTrayByPDFSize: true });   // a print window that can, takes paper of the card's own size
  const fit = cards.map((card, i) => {
    if (i) doc.addPage();
    const f = fitCard(lib, P, bk, card, credit);
    drawCard(doc, P, f.pt, bk, card, credit);
    return f;
  });
  const cover = bk.cover || t('Liturgy for altar use');
  new Writer(doc, P.side).footer(s(cards.length === 1 ? `${cover}  ·  ${cards[0].title}` : cover));
  const name = cards.length === 1 ? `liturgy-${slug(cards[0].key)}-${bk.language}.pdf` : `liturgy-cards-${bk.language}.pdf`;
  return { blob: doc.output('blob'), name, title: cards.length === 1 ? cards[0].title : cover, fit };
}

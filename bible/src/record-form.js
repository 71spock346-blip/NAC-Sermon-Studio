/*
 * The service record on NACSA's paper form, "Pastoral – Service Record" (the
 * form of 2018-11-27): its boxes, its words and its dashed lines where the
 * paper has them, in its plain bold letters, with the record written on the
 * lines in a pen's blue. One form fills an A5 page; the paper prints two side
 * by side on an A4 sheet, and so does formPdf(v, { two: true }).
 *
 * One drawing makes both the picture for the WhatsApp group (a canvas, then a
 * PNG) and the PDF (jsPDF): drawForm() draws with a "pen", and a pen draws on
 * a canvas or on a PDF page, so the two look alike. The form is in English,
 * as the paper is, whatever the app's language. What goes on its lines comes
 * from record.js (paper()): each blank's words, already written out.
 *
 * Places are millimetres from the top left of the form's first box, measured
 * on the Word form. A few lines are a little shorter than on the paper, where
 * the paper runs them into the next word ("Call up:", "After text hymn:").
 */
import * as Pdf from './pdf.js';

export const FORM_W = 134.9;
export const FORM_H = 193.1;
const PT = 25.4 / 72;                 // a point, in mm
const BLACK = [0, 0, 0];
const INK = [20, 55, 140];            // a blue pen
const FAINT = [150, 150, 150];        // the frame the remarks are written in
const DASH = [3 * PT, 2.25 * PT];     // the paper's dashed lines: 3 pt on, 2.25 pt off
const THIN = 0.75 * PT;
const THICK = 2.25 * PT;

/** The boxes: x, y, width, height. */
const BOXES = [
  [0, 0, 134.9, 14.1],          // Pastoral · NACSA · Service record · Ref no
  [0, 15.8, 134.9, 38],         // the service and its hymns
  [0, 57.3, 53.1, 18.5],        // attendance
  [90.1, 57.3, 44.8, 67.9],     // offerings
  [0, 80.8, 86.3, 44.3],        // Apostle service
  [0, 131.8, 134.9, 42.6],      // conducted by, assisted by, remarks
  [0, 175.7, 134.9, 17.4],      // completed by, captured on MIS by
];
const REMARKS = [2.6, 148.7, 131.1, 24.3];

/** The printed words: text, x, baseline, size in points, 'b' bold or 'bi' bold italic. */
const WORDS = [
  ['PASTORAL', 2.5, 5.24, 9.5, 'b'],
  ['NACSA', 2.5, 10.94, 9.5, 'b'],
  ['SERVICE RECORD', 47.4, 8.53, 9.5, 'b'],
  ['Ref no:', 91.4, 5.24, 9.5, 'b'],
  ['Congregation:', 2.5, 21.14, 9.5, 'b'],
  ['Date:', 91.4, 21.14, 9.5, 'b'],
  ['Bible word:', 2.5, 26.94, 9.5, 'b'],
  ['Time: Start', 2.5, 32.64, 9.5, 'b'],
  ['End', 40.6, 32.64, 9.5, 'b'],
  ['Service type:', 66, 32.64, 9.5, 'b'],
  ['Hymns:', 2.5, 38.44, 9.5, 'b'],
  ['Opening:', 2.5, 44.24, 9.5, 'b'],
  ['Call up:', 27.5, 44.24, 9.5, 'b'],
  ['After text hymn:', 68.6, 44.24, 9.5, 'b'],
  ['Repentance:', 2.5, 49.94, 9.5, 'b'],
  ['Comm Hymn:', 37.5, 49.94, 9.5, 'b'],
  ['Closing:', 91.4, 49.94, 9.5, 'b'],
  ['Attendance:', 15.2, 61.54, 9.5, 'bi'],
  ['Adults', 2.5, 67.42, 8, 'b'], ['Children', 12.1, 67.42, 8, 'b'], ['Visitors', 24.3, 67.42, 8, 'b'], ['Total', 37.8, 67.42, 8, 'b'],
  ['Offerings', 92.6, 61.54, 9.5, 'bi'],
  ['R 10', 92.6, 67.48, 10, 'b'], ['R 20', 92.6, 76.58, 10, 'b'], ['R 50', 92.6, 86.48, 10, 'b'],
  ['R 100', 92.6, 95.58, 10, 'b'], ['R 200', 92.6, 103.98, 10, 'b'], ['Coins', 92.6, 113.98, 10, 'b'],
  ['Total:', 92.6, 122.84, 9.5, 'b'],
  ['Apostle Service:', 2.5, 86.54, 9.5, 'b'],
  ['Sealing', 2.5, 95.54, 9.5, 'bi'],
  ['Adults', 2.5, 99.52, 8, 'b'], ['Children', 12.1, 99.52, 8, 'b'], ['NAC babies', 25.1, 99.52, 8, 'b'], ['Total', 43.3, 99.52, 8, 'b'],
  ['Ordination:', 2.5, 113.94, 9.5, 'bi'],
  ['DC', 2.5, 118.44, 9.5, 'b'], ['PR', 12, 118.44, 9.5, 'b'], ['CEV', 22.2, 118.44, 9.5, 'b'], ['SH', 31.9, 118.44, 9.5, 'b'],
  ['CEL', 41.2, 118.44, 9.5, 'b'], ['DEV', 51.6, 118.44, 9.5, 'b'], ['DEL', 62.2, 118.44, 9.5, 'b'], ['Total', 70.8, 118.44, 9.5, 'b'],
  ['Conducted by:', 2.5, 136.44, 9.5, 'b'],
  ['Assisted by:', 2.5, 142.14, 9.5, 'b'],
  ['Remarks: (e.g. Details of Acts and Blessings)', 2.5, 147.94, 9.5, 'b'],
  ['Completed by:', 2.5, 181.91, 9.5, 'b'],
  ['Captured on MIS by:', 2.5, 187.68, 9.5, 'b'],
];
/** The note to the office, in the paper's narrower italic (Calibri), each line fitted to its column. */
const NOTE = [['Please ensure these details are captured', 180.2], ['on MIS under ACTIVITY RECORD CAPTURE', 184.2], ['within 24 hours of occurring. Thank you.', 188.1]];
const NOTE_X = 81.6, NOTE_W = 52.6;

/**
 * The dashed blanks: the key of what is written on it (see paper() in
 * record.js), from x1 to x2 at y. A blank of 10 mm or less takes a number,
 * written in its middle; the offerings' blanks take rand, written to the right.
 */
const BLANKS = [
  ['refNo', 103.8, 128.3, 6.7],
  ['congregation', 26.9, 87.9, 21.8],
  ['date', 100.9, 130.9, 21.6],
  ['ref', 22.2, 105.2, 27.4],
  ['start', 20.5, 29.5, 33.3],
  ['end', 47.9, 57, 33.4],
  ['kind', 87.5, 117.5, 33.3],
  ['opening', 18.5, 26.8, 44.9],
  ['callUp1', 40.6, 48.6, 44.9], ['callUp2', 49.6, 57.6, 44.9], ['callUp3', 58.6, 66.6, 44.9],
  ['afterText', 99.9, 109, 44.9],
  ['repentance', 24, 33, 50.7],
  ['communion', 60.7, 69.7, 50.7],
  ['closing', 105.2, 114.2, 50.7],
  ['att.adults', 2.8, 9.8, 72.7], ['att.children', 12.8, 19.8, 72.7], ['att.visitors', 25.4, 32.4, 72.7], ['att.total', 37.8, 47.8, 72.7],
  ['off.10', 103.7, 128.2, 68.5], ['off.20', 103.6, 128.1, 77.4], ['off.50', 103.6, 128.1, 87.2],
  ['off.100', 103.6, 128.1, 96], ['off.200', 103.7, 128.2, 104.9], ['off.coins', 103.7, 128.2, 114.9],
  ['seal.adults', 2.8, 9.8, 104.6], ['seal.children', 12.7, 19.7, 104.6], ['seal.babies', 25.4, 32.4, 104.6], ['seal.total', 43.7, 53.7, 104.6],
  ['ord.DC', 2.8, 8.8, 124.1], ['ord.PR', 12.7, 18.7, 124.1], ['ord.CEV', 22.6, 28.6, 124.1], ['ord.SH', 32.8, 38.8, 124.1],
  ['ord.CEL', 42.8, 48.8, 124.1], ['ord.DEV', 52.7, 58.7, 124.1], ['ord.DEL', 62.2, 68.2, 124.1], ['ord.total', 73.1, 79.1, 124.1],
  ['conductedBy', 27.6, 96.6, 137.2],
  ['assistedBy', 23.6, 97.7, 142.8],
  ['completedBy', 27.4, 76.4, 182.5],
  ['capturedBy', 36.9, 76.9, 188.3],
];
/** The offerings' two heavy rules: under the coins, and under the total. */
const RULES = [[103.3, 132.3, 116.5], [103.5, 132.5, 124.2]];

/* ------------------------------------------------------------------ pens */

/** A pen on a jsPDF page (mm), the form's top left at (ox, oy). Bold italic stands in for the note's Calibri. */
function pdfPen(doc, ox, oy) {
  const set = (pt, style) => {
    doc.setFont('helvetica', style === 'b' ? 'bold' : style === 'n' ? 'normal' : 'bolditalic');
    doc.setFontSize(pt);
  };
  return {
    width(s, pt, style) { set(pt, style); return doc.getTextWidth(Pdf.winAnsi(s)); },
    text(s, x, y, pt, style, color, align = 'left') {
      set(pt, style);
      doc.setTextColor(...color);
      doc.text(Pdf.winAnsi(s), ox + x, oy + y, { align });
    },
    line(x1, y, x2, lw, dash, color = BLACK) {
      doc.setDrawColor(...color);
      doc.setLineWidth(lw);
      doc.setLineDashPattern(dash || [], 0);
      doc.line(ox + x1, oy + y, ox + x2, oy + y);
      doc.setLineDashPattern([], 0);
    },
    rect(x, y, w, h, lw, color = BLACK) {
      doc.setDrawColor(...color);
      doc.setLineWidth(lw);
      doc.rect(ox + x, oy + y, w, h, 'S');
    },
  };
}

const SANS = 'Arial, "Liberation Sans", Arimo, Helvetica, Roboto, sans-serif';
const NOTE_FACE = 'Calibri, Carlito, ' + SANS;

/** A pen on a canvas, k pixels to the mm, the form's top left at (ox, oy) mm. */
function canvasPen(ctx, k, ox, oy) {
  const font = (pt, style) => (style === 'n' ? '' : style === 'b' ? '700 ' : 'italic 700 ') + (pt * PT * k).toFixed(2) + 'px ' + (style === 'note' ? NOTE_FACE : SANS);
  const rgb = c => `rgb(${c.join(',')})`;
  return {
    width(s, pt, style) { ctx.font = font(pt, style); return ctx.measureText(s).width / k; },
    text(s, x, y, pt, style, color, align = 'left') {
      ctx.font = font(pt, style);
      ctx.fillStyle = rgb(color);
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s, (ox + x) * k, (oy + y) * k);
    },
    line(x1, y, x2, lw, dash, color = BLACK) {
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = lw * k;
      ctx.setLineDash((dash || []).map(d => d * k));
      ctx.beginPath();
      ctx.moveTo((ox + x1) * k, (oy + y) * k);
      ctx.lineTo((ox + x2) * k, (oy + y) * k);
      ctx.stroke();
      ctx.setLineDash([]);
    },
    rect(x, y, w, h, lw, color = BLACK) {
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = lw * k;
      ctx.strokeRect((ox + x) * k, (oy + y) * k, w * k, h * k);
    },
  };
}

/* --------------------------------------------------------------- drawing */

/** The text at the largest size from pt down to min that fits the width; cut short with "…" when even min does not. */
function fitted(pen, s, pt, style, width, min = 6) {
  let size = pt;
  while (size > min && pen.width(s, size, style) > width) size = Math.max(min, size - 0.25);
  if (pen.width(s, size, style) <= width) return [s, size];
  let cut = s;
  while (cut.length > 1 && pen.width(cut + '…', size, style) > width) cut = cut.slice(0, -1);
  return [cut.trimEnd() + '…', size];
}

/** Lines of the text within the width, its own line breaks kept. */
function wrapped(pen, text, pt, style, width) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && pen.width(next, pt, style) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** The remarks in their frame, as large as they fit (9.5 pt down to 7), the end cut short with "…" past 7 pt. */
function remarks(pen, text) {
  const [x, y, w, h] = REMARKS;
  let pt = 9.5, lines, lead, room;
  for (;;) {
    lead = pt * PT * 1.25;
    room = Math.floor((h - 1.2) / lead);
    lines = wrapped(pen, text, pt, 'n', w - 2.8);
    if (lines.length <= room || pt <= 7) break;
    pt -= 0.5;
  }
  if (lines.length > room) {
    lines = lines.slice(0, room);
    let last = lines[room - 1];
    while (last.length > 1 && pen.width(last + ' …', pt, 'n') > w - 2.8) last = last.slice(0, -1);
    lines[room - 1] = last.trimEnd() + ' …';
  }
  lines.forEach((line, i) => pen.text(line, x + 1.4, y + lead * (i + 0.85), pt, 'n', INK));
}

/** One form with a pen, with v's words on its lines (see paper() in record.js). */
export function drawForm(pen, v = {}) {
  for (const [x, y, w, h] of BOXES) pen.rect(x, y, w, h, THIN);
  pen.rect(...REMARKS, 0.2, FAINT);
  for (const [s, x, y, pt, style] of WORDS) pen.text(s, x, y, pt, style, BLACK);
  pen.line(2.5, 38.8, 2.5 + pen.width('Hymns', 9.5, 'b'), 0.5 * PT, null);   // only "Hymns" is underlined
  for (const [, x1, x2, y] of BLANKS) pen.line(x1, y, x2, THIN, DASH);
  for (const [x1, x2, y] of RULES) pen.line(x1, y, x2, THICK, null);
  for (const [s, y] of NOTE) {
    const [text, pt] = fitted(pen, s, 8, 'note', NOTE_W);
    pen.text(text, NOTE_X, y, pt, 'note', BLACK);
  }
  pen.text('20181127', 132.5, 191.97, 5, 'bi', BLACK, 'right');

  // the record, in ink
  for (const [key, x1, x2, y] of BLANKS) {
    const s = String(v[key] == null ? '' : v[key]).trim();
    if (!s) continue;
    const w = x2 - x1;
    const align = key.startsWith('off.') ? 'right' : w <= 10.5 ? 'center' : 'left';
    const [text, pt] = fitted(pen, s, 9.5, 'n', align === 'center' ? w + 2 : w - 1);
    pen.text(text, align === 'right' ? x2 - 0.5 : align === 'center' ? (x1 + x2) / 2 : x1 + 0.8, y - 0.9, pt, 'n', INK, align);
  }
  if (v['off.total']) {
    const [text, pt] = fitted(pen, String(v['off.total']), 9.5, 'b', 28);
    pen.text(text, 132, 122.9, pt, 'b', INK, 'right');
  }
  if (v.remarks && String(v.remarks).trim()) remarks(pen, String(v.remarks).trim());
}

/* ---------------------------------------------------------------- output */

/** The form as a PDF: one A5 page, or two forms side by side on an A4 sheet as the paper has them. A Blob. */
export function formPdf(v, { two = false } = {}) {
  const doc = new (Pdf.jsPDF())({ unit: 'mm', format: two ? 'a4' : 'a5', orientation: two ? 'landscape' : 'portrait' });
  const oy = (210 - FORM_H) / 2;
  if (two) {
    const ox = (148.5 - FORM_W) / 2;
    drawForm(pdfPen(doc, ox, oy), v);
    drawForm(pdfPen(doc, 148.5 + ox, oy), v);
  } else {
    drawForm(pdfPen(doc, (148 - FORM_W) / 2, oy), v);
  }
  return doc.output('blob');
}

/** Waits (a little, once) for the note's Calibri look-alike, so the first picture has it. */
let fonts = null, fontsDone = false;
function fontsReady() {
  if (!fonts) {
    fonts = (async () => {
      try {
        if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load('italic 700 12px Carlito'), new Promise(r => setTimeout(r, 1500))]);
      } catch (e) { /* the note falls back to the sans */ }
      fontsDone = true;
    })();
  }
  return fonts;
}

/** Draws the form, white A5 page and all, on a canvas k pixels to the mm. */
export function paint(canvas, v, k) {
  canvas.width = Math.round(148 * k);
  canvas.height = Math.round(210 * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawForm(canvasPen(ctx, k, (148 - FORM_W) / 2, (210 - FORM_H) / 2), v);
}

/** The form as a picture (PNG, A5 at 8 pixels to the mm: 1184 × 1680), for the WhatsApp group. A Promise of a Blob. */
export async function formPicture(v, k = 8) {
  await fontsReady();
  const canvas = document.createElement('canvas');
  paint(canvas, v, k);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}

/** Draws the form on a canvas on the screen at its width; again once the note's font has come. */
export function preview(canvas, v) {
  const draw = () => {
    const css = canvas.clientWidth || 360;
    paint(canvas, v, (css * (window.devicePixelRatio || 1)) / 148);
  };
  draw();
  if (!fontsDone) fontsReady().then(() => { if (canvas.isConnected) draw(); });
}

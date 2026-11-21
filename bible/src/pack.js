/*
 * The Sunday pack: what the minister takes to the altar on paper, as one
 * PDF printed in one go from the Sunday card (sunday.js). First the cue
 * cards of the preparation (pdf.js drawCueCards), the hymn numbers at the
 * top of the first, then the altar card of the kind of service, from the
 * altar booklet loaded under Church files (handbook-pdf.js drawFitted),
 * closed by the booklet's copyright line. All on upright A5 pages, as the
 * cards at the altar are: on A4 paper the print window's "2 pages per
 * sheet" gives them their size.
 *
 * The altar card goes on its page as the altar cards print on this device:
 * on A5, or, where "A5, one side" was chosen for them, on one side in
 * smaller letters (handbook-pdf.js PAPER). The sheet says which, and what
 * size the letters are, before anything is printed (packNote).
 */
import { t, tl } from './i18n.js';
import { Writer, drawCueCards, fileName, jsPDF, winAnsi } from './pdf.js';
import { drawFitted, cardFit, points, printSheet } from './handbook-pdf.js';
import { creditText } from './liturgy.js';
import { langOf } from './ai.js';

const MARGIN = 14;   // mm: the cue cards' margin, and the footer's

/** The paper of the pack's altar card: one side of an A5 card where the altar cards print that way on this device, else A5 (the cue cards are A5 whatever the choice). */
export const paperFor = paper => (paper === 'a5s' ? 'a5s' : 'a5');

/**
 * The pack as one PDF: {blob, name, title, fit}, `fit` being how the altar
 * card went on its page ({pt, lines, pages}), or null without a card.
 * `service` is the Guide's article the preparation is linked to (its
 * introduction gives cues while the minister's own is empty); `card` and
 * `bk` the altar card and its booklet (liturgy.js cardFor), left out while
 * no booklet is loaded, when the pack is the cue cards alone.
 */
export function sundayPackPdf(s, { service = null, card = null, bk = null, paper = 'a5' } = {}) {
  const doc = new (jsPDF())({ unit: 'mm', format: 'a5', orientation: 'portrait' });
  doc.viewerPreferences({ PickTrayByPDFSize: true });   // a print window that can, takes paper of the cards' own size
  const ref = drawCueCards(doc, s, { service });
  let fit = null;
  if (card && bk) {
    doc.addPage();
    fit = drawFitted(doc, bk, card, { paper: paperFor(paper), credit: creditText() });
  }
  new Writer(doc, MARGIN).footer(winAnsi([s.title || ref, card ? card.title : ''].filter(Boolean).join('  ·  ')));
  const title = [tl(langOf(s), 'Sunday pack'), ref || s.title || ''].filter(Boolean).join(': ');
  return { blob: doc.output('blob'), name: fileName(s, '-sunday-pack'), title, fit };
}

/** The line under the Sunday pack's row on the Sunday card: what the pack holds, with or without the altar card. */
export function packLine(card) {
  return card ? t('The cue cards and the altar card as one PDF, to print in one go') : t('The cue cards as one PDF; the altar card once the booklet is loaded');
}

/**
 * What the sheet says before the pack is printed (printSheet's `note`): a
 * function of the paper kept on the device that tells how the pages go,
 * and, on one side, the size the altar card's letters take; then how to
 * print A5 pages on A4 paper. The card is fitted once for each paper.
 */
export function packNote(card, bk) {
  const memo = {};
  const fitOf = paper => memo[paper] || (memo[paper] = cardFit(bk, [card], { paper, credit: creditText() })[0]);
  return paper => {
    const how = t('On A4 paper, choose 2 pages per sheet in the print window.');
    if (!card || !bk) return t('Upright A5 pages: the cue cards. The altar card comes once the altar booklet is loaded under Church files.') + ' ' + how;
    const P = paperFor(paper), f = fitOf(P), n = f.pages, pt = points(f.pt);
    let text;
    if (P === 'a5s') text = n > 1 ? t('Upright A5 pages: the cue cards, then the altar card on {n} sides, in {pt} point letters.', { n, pt }) : t('Upright A5 pages: the cue cards, then the altar card on one side, in {pt} point letters.', { pt });
    else text = n > 1 ? t('Upright A5 pages: the cue cards, then the altar card on {n} pages.', { n }) : t('Upright A5 pages: the cue cards, then the altar card on one page.');
    return text + ' ' + how;
  };
}

/** The "Print or save" sheet of the pack: one row, Save as PDF, Print and Share, with the note over it. */
export function packSheet(s, { service = null, card = null, bk = null } = {}) {
  return printSheet([[t('Sunday pack'), paper => sundayPackPdf(s, { service, card, bk, paper })]], { note: packNote(card, bk) });
}

/*
 * The Guide's article in plain words, as one piece.
 *
 * "Break down the article" (ai.js breakdown, prepare.js) takes the Guide's
 * article apart sentence by sentence and says for each piece what it says
 * in plain words. Read one after the other, those plain words are the whole
 * article again, only simpler. This module puts them back together as one
 * text: under the Guide's own headings and with the booklet's own paragraph
 * breaks, so that it reads like the article itself, in plain words
 * (pdf.js plainArticlePdf). The person's own changes to the plain words
 * come along, since they are kept in the breakdown.
 *
 * The booklet's paragraphs are found by looking each piece's quoted words
 * up in the article (the message, the introduction, each section, the
 * Context box): pieces quoted from the same paragraph make one paragraph.
 * A piece whose words are not found (the preparation was moved to the
 * other edition of the Guide, or Claude joined words across a break) goes
 * on with the paragraph before it, up to three pieces, then starts a new
 * one. Without the article, every heading's pieces make paragraphs of three.
 *
 * No imports: tools/test_plain.mjs runs it in Node.
 */

/** Text as a key for finding words again: letters and digits only, lower case, single spaces. */
const key = v => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The paragraphs of the article as keys, in the booklet's order. The Summary box is left out: it repeats the article. */
export function paragraphsOf(service) {
  if (!service) return [];
  const out = [];
  const push = text => { for (const p of String(text || '').split(/\n\s*\n/)) if (key(p)) out.push(key(p)); };
  push(service.message);
  push(service.introduction);
  for (const sec of service.sections || []) push(sec && sec.body);
  push(service.context);
  return out;
}

/**
 * Which paragraph a piece's quoted words stand in, or -1. A long quote is
 * also tried by its first forty letters, in case its end was joined from
 * the next paragraph.
 */
export function paragraphOf(paras, quote) {
  const q = key(quote);
  if (!q) return -1;
  const i = paras.findIndex(p => p.includes(q));
  if (i >= 0 || q.length <= 40) return i;
  return paras.findIndex(p => p.includes(q.slice(0, 40)));
}

const MOST = 3;   // pieces in a paragraph while the booklet's own breaks are not known

/**
 * The article in plain words: [{heading, paragraphs: [text]}] in the order
 * of the breakdown, each paragraph the plain words of its pieces one after
 * the other. Pieces without plain words are left out.
 */
export function plainParts(breakdown, service) {
  const paras = paragraphsOf(service);
  const groups = [];
  let g = null, at = -1, n = 0;   // the group being filled, the booklet paragraph its last piece came from, the pieces in its last paragraph
  for (const p of (breakdown && breakdown.parts) || []) {
    const said = String((p && p.said) || '').trim().replace(/\s+/g, ' ');
    if (!said) continue;
    const heading = String(p.heading || '').trim();
    if (!g || g.heading !== heading) { g = { heading, rows: [] }; groups.push(g); at = -1; n = 0; }
    const i = paragraphOf(paras, p.quote);
    // a new paragraph where the booklet has one; where the words were not found, after three pieces
    const fresh = !g.rows.length || (i >= 0 ? at >= 0 && i !== at : n >= MOST);
    if (fresh) { g.rows.push([]); n = 0; }
    g.rows[g.rows.length - 1].push(said);
    if (i >= 0) at = i;
    n++;
  }
  return groups.map(x => ({ heading: x.heading, paragraphs: x.rows.map(r => r.join(' ')) }));
}

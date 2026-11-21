/*
 * The hymns of the service: the four numbers a minister announces, kept with
 * the preparation (s.hymns: opening, sermon, communion, closing) and typed
 * under "The service" in Prepare. Until November 2026 he wrote them somewhere
 * else. The Choir planner's index (choir-library.js Hymns, 1,317 hymns)
 * gives the titles: "104" is the hymn book, "E 104" the English book and
 * "A 7" the Afrikaans one, as the conductor's workbook writes them. The hymn
 * book is the Hymn Collection, which a minister writes "HC 104" (Jerome,
 * November 2026: "A for Afrikaans, E for English, or HC for Hymn
 * Collection"; asked, he said the index's unlettered numbers are that book),
 * so "HC 104" has the title of "104". A number the index does not know
 * stands as typed.
 *
 * They go at the top of the sermon notes, with their titles (pdf.js
 * sermonPdf), on the first cue card and on the screen's readings without
 * them (cueCardPdf, read.js), and on the Sunday card as the numbers alone.
 */
import { Hymns } from './choir-library.js';
import { t, tl } from './i18n.js';

/** The four places, in the order of the service: the key on the preparation and the heading of its box. */
export const SLOTS = ['opening', 'sermon', 'communion', 'closing'];
const LABELS = {
  opening: () => t('Opening hymn'),
  sermon: () => t('Before the sermon'),
  communion: () => t('Holy Communion'),
  closing: () => t('Closing hymn'),
};
/** The word for a place in the printed line, in language `l`: "opening 104", "Holy Communion 78". */
const WORDS = {
  opening: l => tl(l, 'opening'),
  sermon: l => tl(l, 'before the sermon'),
  communion: l => tl(l, 'Holy Communion'),
  closing: l => tl(l, 'closing'),
};
export const label = key => LABELS[key]();
export const blank = () => ({ opening: '', sermon: '', communion: '', closing: '' });

/** Does the typed text name a hymn by number: "104", "e104", "A 7", "HC 12"? */
export const isNumber = text => /^((?:HC|[EA])\s*)?\d+$/i.test(String(text || '').trim());
/** "e104" → "E 104", "hc12" → "HC 12", " 007 " → "7"; anything else as typed. */
export const norm = text => Hymns.normRef(text);
/** The index's title for a number ("HC 104" is the index's "104"), or ''. */
export const title = text => Hymns.title(text);
/** A number with its book, as the service record writes it: "104" is the Hymn Collection's, "HC 104"; "E 1", "HC 12" and words as they are. */
export const withBook = text => { const n = norm(text); return /^\d+$/.test(n) ? 'HC ' + n : n; };
/** Up to `n` hymns whose number begins with, or whose title has, what was typed: for the picks under a box. */
export const suggest = (text, n = 3) => Hymns.search(text).slice(0, n);

/** The hymns filled in, in the order of the service: [{key, ref, title}]. */
export function hymnsOf(s) {
  const h = (s && s.hymns) || {};
  return SLOTS.filter(k => norm(h[k])).map(k => ({ key: k, ref: norm(h[k]), title: title(h[k]) }));
}

/** "104 · E 1 · 78 · 90": the numbers alone, or ''. */
export const numbers = s => hymnsOf(s).map(x => x.ref).join(' · ');

/** "Hymns: opening 104 (Blessed are the pure in heart) · before the sermon 45 · …" in language `l`, with or without the titles, or ''. */
export function line(s, l, { titles = true } = {}) {
  const list = hymnsOf(s);
  if (!list.length) return '';
  return tl(l, 'Hymns: {list}', { list: list.map(x => `${WORDS[x.key](l)} ${x.ref}${titles && x.title ? ` (${x.title})` : ''}`).join(' · ') });
}

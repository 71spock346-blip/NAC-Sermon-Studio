/*
 * The words on the cue cards (pdf.js cueCardPdf, and the lines under "Print or
 * save" in prepare.js). On the A5 cards the minister reads at the altar, under
 * each heading of the sermon stands one line of short cues, the way he writes
 * his own cards:
 *
 *   Introduction:
 *   # Israelites from Babylon, Jerusalem in ruins # got up, rebuilt city and temple # problem when we stay down
 *
 * each cue in its own colour, the # marks in ink, and no sentences or notes:
 * a cue only says where the next thought fits in (Jerome, 2026-11-18). The app
 * takes one cue from each main thought of a part's text (cuePhrase: the words
 * that carry the thought, at most a few), and the cues change with the text;
 * where the minister changes a line, it is the minister's own, with # between
 * the cues.
 *
 * The cards follow the sermon (Jerome, 2026-11-25: "Cue cards and service do
 * not correlate": lines once filled in from the text still said "Good
 * morning" when the sermon had become the evening's). So a line the minister
 * has not changed is not stored at all: it always says what the text says
 * now. An own line is kept with the signature of the text it was written
 * for (cuesFor, textSig); when that text has changed and a cue of the line is
 * not in it any more (cuesNotIn), the part is stale, and the screens say so,
 * with a tap to take the app's cues again (setOwn with '') or to keep the own
 * line (keepOwn).
 *
 * Pure functions, no screen and no store: tools/test_cues.mjs checks them in
 * Node.
 */

/** The colours of the cues, in turn: purple, red and blue as on his own cards, then green, orange, teal, plum and brown. All strong on white paper. */
export const CUE_COLORS = [[106, 27, 154], [198, 40, 40], [21, 101, 192], [46, 125, 50], [230, 81, 0], [0, 131, 143], [173, 20, 87], [109, 76, 65]];

/** The mark before every cue. */
export const MARK = '#';

const MAX = 7;   // words in a cue the app makes

/** The cues the minister typed for a part: what stands between the # marks (a line break counts as one too). */
export function splitCues(text) {
  return String(text || '').split(/[#\n]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** A line of cues as it is typed and printed: "# cue # cue # cue". */
export function cueLine(cues) {
  return cues.length ? `${MARK} ${cues.join(` ${MARK} `)}` : '';
}

/** The cues the app makes for a text: one from each of its main thoughts. */
export function autoCues(text, lang = 'en') {
  return mainThoughts(text).map(x => cuePhrase(x, lang)).filter(Boolean);
}

/** What a part's line prints: the minister's own cues, or the app's while he has typed none. */
export function cuesOf(part) {
  return part.own.length ? part.own : part.auto;
}

/** Whether two lines of cues say the same, however they are spaced: each a line as typed or a list of cues. */
export function sameCues(a, b) {
  const x = Array.isArray(a) ? a : splitCues(a), y = Array.isArray(b) ? b : splitCues(b);
  return x.length === y.length && x.every((c, i) => c === y[i]);
}

/** A part's own line as the minister typed it; '' while the line is the app's. */
export function ownLine(s, part) {
  return String((part.key === 'point' ? part.p && part.p.cues : (s.cues || {})[part.key]) || '');
}

/**
 * Sets a part's own line (cueParts gives the part). An own line is kept
 * with the signature of the text it was written for; '' gives the line back
 * to the app, so that it follows the text again.
 */
export function setOwn(s, part, line) {
  const v = String(line || '').trim() ? String(line) : '';
  const sig = v ? textSig(part.text) : '';
  if (part.key === 'point') {
    if (!part.p) return;
    if (v) { part.p.cues = v; part.p.cuesFor = sig; } else { delete part.p.cues; delete part.p.cuesFor; }
    return;
  }
  s.cues = s.cues || {};
  s.cuesFor = s.cuesFor || {};
  if (v) { s.cues[part.key] = v; s.cuesFor[part.key] = sig; } else { delete s.cues[part.key]; delete s.cuesFor[part.key]; }
}

/** Keeps the minister's own cues of a part for its text as it is now: the part is not stale again until the text changes. */
export function keepOwn(s, part) {
  if (!ownLine(s, part).trim()) return;
  const sig = textSig(part.text);
  if (part.key === 'point') { if (part.p) part.p.cuesFor = sig; }
  else { s.cuesFor = s.cuesFor || {}; s.cuesFor[part.key] = sig; }
}

/** A short signature of a text, to know whether it has changed since: its words, the spacing left aside; '' for no text. */
export function textSig(text) {
  const v = String(text || '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  let h = 0x811c9dc5;   // FNV-1a
  for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/**
 * The cues of a list that are not in a text now: a cue is in it when every
 * word of it that carries meaning is (the words of STOP are left aside), as
 * it is or with another ending ("says" in "say", "started" in "start").
 * "Good morning, brothers and sisters" is not in "Good evening, brothers and
 * sisters".
 */
export function cuesNotIn(cues, text, lang = 'en') {
  const stop = STOP[lang] || STOP.en;
  const have = new Set(wordsOf(text));
  return (cues || []).filter(c => wordsOf(c).filter(w => !stop.has(w)).some(w => !wordIn(w, have)));
}

/** The words of a text as the stop list has them (fold); a dash or a slash between two words parts them. */
function wordsOf(text) {
  return String(text || '').split(/[\s/\u2013\u2014-]+/).map(fold).filter(Boolean);
}

/** Whether a word is among `have`: as it is, or, from four letters, with the same first letters (up to five); a word of three letters only as it is or with an s. */
function wordIn(w, have) {
  if (have.has(w)) return true;
  if (w.length < 3) return false;
  for (const h of have) {
    if (h.length < 3) continue;
    const n = Math.min(5, w.length, h.length);
    if (n >= 4 ? w.slice(0, n) === h.slice(0, n) : (w === h + 's' || h === w + 's')) return true;
  }
  return false;
}

/**
 * The parts of a preparation's cue cards, in the order of the sermon:
 *   { key: 'intro' | 'point' | 'application' | 'conclusion', own: [cue], auto: [cue],
 *     i and p (a main point's place and the point itself), heading (a point's),
 *     guide (true for an introduction taken from the Guide's),
 *     text (the part's text, a point's with its heading and the minister's thought),
 *     missing (the own cues that are not in the text now), stale }
 * `own` are the cues the minister typed for the part, `auto` the ones the app
 * takes from its text (cuesOf gives the ones to print). A part is `stale` when
 * an own cue is not in its text now and the minister has not kept them for
 * this text (keepOwn): the text changed after they were written. Every part is listed,
 * with or without cues, so that the lines under "Print or save" can be drawn
 * from it; a main point only when it has a heading, text or cues of its own.
 * `service`: the Guide's article the preparation is linked to, whose
 * introduction stands in for the minister's while his is empty.
 */
export function cueParts(s, { service = null, lang = 'en' } = {}) {
  const typed = s.cues || {}, sigs = s.cuesFor || {};
  const parts = [];
  const checked = (part, sig) => {
    part.missing = part.own.length ? cuesNotIn(part.own, part.text, lang) : [];
    part.stale = part.missing.length > 0 && (sig || '') !== textSig(part.text);
    return part;
  };
  const intro = introText(s, service);
  parts.push(checked({ key: 'intro', guide: !!(intro && intro.guide), own: splitCues(typed.intro), auto: intro ? autoCues(intro.text, lang) : [], text: intro ? intro.text : '' }, sigs.intro));
  (s.points || []).forEach((p, i) => {
    if (!p) return;
    // a point without a heading is headed by its first line
    let heading = String(p.heading || '').trim(), body = p.body || '';
    if (!heading) { const l = lines(body); heading = l[0] || ''; body = l.slice(1).join('\n'); }
    const own = splitCues(p.cues);
    if (!heading && !body.trim() && !own.length) return;
    // his own thought on the point gives the last cue, so that he brings it in
    const thought = sentences(lines(p.thought).join(' '))[0] || '';
    const text = [p.heading, p.body, p.thought].map(x => String(x || '').trim()).filter(Boolean).join('\n');
    parts.push(checked({ key: 'point', i, p, heading, own, auto: [...autoCues(body, lang), cuePhrase(thought, lang)].filter(Boolean), text }, p.cuesFor));
  });
  for (const key of ['application', 'conclusion']) parts.push(checked({ key, own: splitCues(typed[key]), auto: autoCues(s[key], lang), text: String(s[key] || '') }, sigs[key]));
  return parts;
}

/**
 * The introduction the cards go by, {text, guide}: the minister's own, or,
 * while that is empty, the Guide's introduction to the service. A line break
 * in the Guide's text is only where the booklet's line ended, so its
 * paragraphs are put together first, as the screen shows them (guides.js
 * paras); a list in it keeps its lines.
 */
export function introText(s, service) {
  const own = String(s.intro || '').trim();
  if (own) return { text: own, guide: false };
  const text = String((service && service.introduction) || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => {
    const items = p.split('\n').filter(x => x.trim());
    const list = items.length > 1 && items.every(l => /^\s*[-•■]\s/.test(l));
    return list ? items.map(l => l.replace(/^\s*[-•■]\s*/, '')).join('\n') : p.replace(/\s*\n\s*/g, ' ');
  }).join('\n');
  return text ? { text, guide: true } : null;
}

/* ------------------------------------------------------------- one cue */

// the words that only carry a sentence along: they do not make a cue, and they go from the front and the end of one.
// A negation (not, never, nie, geen) is not among them: "Never give up" keeps its never. Nor is a name of God.
const STOP = {
  en: words('a an the and or but so yet nor for of to in on at by with from into onto upon about over under after before between ' +
    'through during without within along across behind beyond near off out up down as than then that this these those there here ' +
    'it its it\'s he she they we you i me him her them us my your his our their mine yours ours theirs ' +
    'is am are was were be been being have has had having do does did doing done will would shall should can could may might must ' +
    'if when while whenever where wherever whether because since although though unless until till who whom whose which what why how ' +
    'all any each every few more most much many some such only own same other another both either neither also just even still ' +
    'already again ever very too quite rather really indeed well now today tonight let one ones thing things way ways ' +
    'something anything nothing everything someone anyone everyone however therefore thus hence yes ok okay'),
  af: words('die \'n n en of maar want so tog dus dan ook nog net al reeds te om tot van vir met by in op aan uit oor na onder deur ' +
    'sonder teen tussen langs agter voor binne buite as dat wat wie wanneer waar hoe hoekom waarom indien tensy totdat terwyl omdat ' +
    'sodat alhoewel hoewel ek jy u hy sy dit ons julle hulle my jou haar hul se is was wees word geword het gehad sal sou kan kon ' +
    'moet moes mag mog wil wou ja hier daar hierdie daardie dié elke alle albei ander dieselfde self iets niks alles iemand niemand ' +
    'almal een mens weer eers nou vandag vanaand laat toe selfs sommer mos darem slegs ding dinge manier maniere soos aangesien egter daarom baie'),
};

function words(list) { return new Set(list.split(/\s+/).filter(Boolean)); }

/** A word as the stop list has it: small letters, without the punctuation around it ("Yet," → "yet", "'n" → "n"). */
function fold(w) {
  return String(w).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const CLAUSE_END = /[,;:]["'”’)\]]*$/;
const DASH = /^[–—-]+$/;

/** The clauses of a sentence, each its words: a comma, a semicolon, a colon or a dash ends one. */
function clauses(sentence) {
  const out = [[]];
  for (const w of String(sentence || '').trim().split(/\s+/).filter(Boolean)) {
    if (DASH.test(w)) { if (out[out.length - 1].length) out.push([]); continue; }
    out[out.length - 1].push(w);
    if (CLAUSE_END.test(w)) out.push([]);
  }
  return out.filter(c => c.length);
}

/**
 * One cue for a sentence: the few words that carry its thought, as the
 * minister would jot them on a card.
 *   "We cannot always get up by our own strength."          → "Cannot always get up"
 *   "The moon has no light of its own: it is rock and dust." → "Moon has no light of its own"
 *   "And those of us who have: who was that angel?"          → "Angel?"
 *   "When Jesus died on the cross, it looked like defeat."   → "Jesus died on the cross"
 * A clause that only leads in goes (no word of its own, or one before a
 * colon), then the words that only lead in go from the front (we, and, when,
 * the), and the first clause stands whole when it is three to eight words;
 * else the cue is cut at seven words: at the end of a clause when one ends
 * there, else before a word that only leads on, and the words that only
 * carry go from its end. A full stop at the end goes; ? and ! stay.
 */
export function cuePhrase(sentence, lang = 'en') {
  const stop = STOP[lang] || STOP.en;
  const isStop = w => stop.has(fold(w));
  const content = c => c.filter(w => !isStop(w)).length;
  // a clause only leads in when it has no word of its own ("And those of us who have:", "However,"), or one before a colon ("The question is this:")
  const weak = c => { const n = content(c); return n === 0 || (n < 2 && /:["'\u201d\u2019)\]]*$/.test(c[c.length - 1])); };
  const cs = clauses(sentence);
  while (cs.length > 1 && weak(cs[0])) cs.shift();
  if (!cs.length) return '';
  const first = cs[0].slice();
  if (content(first)) while (first.length > 1 && isStop(first[0])) first.shift();
  const all = [first, ...cs.slice(1)].flat();
  let ws;
  if (first.length >= 3 && first.length <= MAX + 1) ws = first;
  else {
    ws = all.slice(0, MAX);
    if (all.length > MAX) {
      // cut short: at the end of a clause when one ends in the words kept, else before a word that only leads on
      let j = ws.length - 1;
      while (j >= 2 && !CLAUSE_END.test(ws[j])) j--;
      if (j >= 2) ws = ws.slice(0, j + 1);
      else {
        const tail = ws.slice(-3);
        for (let k = tail.length - 1; k >= 0; k--) if (isStop(tail[k])) { ws = ws.slice(0, ws.length - 3 + k); break; }
        while (ws.length > 2 && isStop(ws[ws.length - 1])) ws.pop();
      }
    }
  }
  const text = ws.join(' ').replace(/[\s.,;:–—-]+$/, '').replace(/^["'“‘(]+/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* -------------------------------------------------- the main thoughts */

export function lines(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/*
 * The main thoughts of a part of the sermon: of a text written in paragraphs
 * or lines, the first sentence of each (so a list the minister typed comes
 * through whole); of a text written as one paragraph, its first, middle and
 * last sentence. Each is kept short enough to take in at a glance.
 */
export function mainThoughts(body) {
  const paras = lines(body).map(l => l.replace(LIST_MARK, '').trim()).filter(Boolean);
  const picked = paras.length > 1 ? paras.map(p => sentences(p)[0]) : spread(sentences(paras[0] || ''), 3);
  return picked.filter(Boolean).map(x => shorten(x, 20));
}

const LIST_MARK = /^(?:[-–—•*·]|\d{1,2}[.)]|[a-z][.)])\s+/i;
// words before a full stop that do not end a sentence: Bible books and short forms, in English and Afrikaans
const SHORT_FORMS = new Set(('cf e.g i.e etc vs v vv ch st mr mrs dr no nr bv nl ens vgl d.w.s ds ap ' +
  'gen ex exod lev num deut josh judg sam kgs chr neh esth ps prov eccl isa jer lam ezek dan hos obad mic nah hab zeph hag zech mal ' +
  'matt mt mk lk jn rom cor gal eph phil col thess tim tit philem heb jas pet rev ' +
  'eks spr pred jes eseg joh hand kor ef fil kol tess filem jak op').split(' '));

/** A paragraph in its sentences. A full stop after a short form ("Rom.", "e.g.", "bv.") or an initial does not end one. */
export function sentences(text) {
  const out = [];
  const end = /([.!?…])["'”’)\]]*\s+(?=["'“‘(]?(?:\p{Lu}|['’]n\s))/gu;
  let from = 0, m;
  while ((m = end.exec(text))) {
    if (m[1] === '.') {
      const word = ((text.slice(from, m.index).match(/(\S+)$/) || [])[1] || '').replace(/^["'“‘(]+/, '').toLowerCase();
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
  return words.slice(0, max - 4).join(' ').replace(/[,;:–—-]+$/, '') + ' …';
}

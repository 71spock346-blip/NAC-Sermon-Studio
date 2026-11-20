/*
 * Finding a verse by the words a person remembers: the part of the Bible
 * search that only works with text, so it can be checked without a browser
 * (tools/test_search.mjs). search.js reads the Bible and shows the verses.
 *
 * A verse is found when it has every word that was typed. The search is
 * forgiving, because people remember a verse loosely and spell as they hear:
 *
 *  - capitals, accents and punctuation do not count ("Esegiel" finds "Esegiël");
 *  - a word also finds its endings: "shepherd" finds "shepherds", "love"
 *    finds "loved", "loveth" and "loving", "mercy" finds "mercies", "run"
 *    finds "runneth"; the small words ("the", "for", "her") only find
 *    themselves, or "for" would find "forest";
 *  - today's English finds the King James's: "your" finds "thy" and
 *    "thine", "you" finds "thee", "believes" finds "believeth"; and "Lord"
 *    finds "Yahweh", as the World English Bible writes the name;
 *  - a word that no verse has, or hardly any, is looked up by its spelling,
 *    and the nearest words of the Bible are searched too ("sheperd" finds
 *    "shepherd", "angle" finds "angel", "neighbour" finds "neighbor");
 *  - the small words ("the", "of", "my") are not asked for when other words
 *    were typed with them, they only decide the order: "the Lord is my
 *    shepherd" finds "Yahweh is my shepherd";
 *  - when no verse has all the words, the verses that have most of them are
 *    given, the rarest words counting the most;
 *  - words between quotes must stand side by side, exactly as typed.
 *
 * The verses with the words close together, in the order typed, come first,
 * then the others, each group in the order of the Bible.
 *
 * The endings are those of the language of the text: English for the two
 * Bibles that travel with the app, Afrikaans for an Afrikaans text the
 * person pasted in.
 */

/** A text in small letters without accents, so that spelling with or without them finds the same word. */
export function fold(s) {
  s = String(s || '').toLowerCase();
  if (/[^\x00-\x7f]/.test(s)) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss');
  return s;
}

/** The words of a text, folded, with one space between them: "The Lord’s name" → "the lord s name". */
export function plain(s) {
  return fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * How far two words are apart: the number of letters to add, drop, change or
 * swap with the next one to make one into the other. Stops counting past
 * `max` and then gives max + 1.
 */
export function distance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let before = null, prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let low = i;
    for (let j = 1; j <= lb; j++) {
      const same = a.charCodeAt(i - 1) === b.charCodeAt(j - 1);
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
      if (before && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) d = Math.min(d, before[j - 2] + 1);   // two letters swapped
      cur[j] = d;
      if (d < low) low = d;
    }
    if (low > max) return max + 1;
    const spare = before || new Array(lb + 1);
    before = prev; prev = cur; cur = spare;
  }
  return prev[lb];
}

/* ---------------------------------------------------------------- a word and its endings */

/* The small words of each language. They find only themselves: with endings "for" would find "forest" and "her" would find "here". */
const SMALL = {
  en: new Set(('a an the and or but nor for so yet of to in on at by with from into unto upon over under out up off as is am are was were be been being ' +
    'have has had hath hast do does did doth dost shall shalt will wilt would should may might can could must not no this that these those there here then than ' +
    'when where what which who whom whose why how all any both each few more most other some such only own same too very i me my mine we us our ours ' +
    'you your yours thou thee thy thine ye he him his she her hers it its they them their theirs if because while until though although also even ever never now one').split(' ')),
  af: new Set(('die n en of maar want vir van in op aan by met uit oor onder tot na om te is was het sal wil kan moet mag nie hy sy hom haar hulle ons julle jy jou u ek my ' +
    'dit dat wat wie waar wanneer hoe as so ook al nog toe nou daar hier dan elke alle baie een geen niks sonder deur teen tussen').split(' ')),
};

/*
 * Words that stand for one another in English: the English of today and of
 * the King James Version, and the Lord's name as the World English Bible
 * writes it. A person who knows a verse from a newer Bible types "your"; the
 * King James says "thy". Nearly all are small words, so the verses found
 * stay the same verses: the search only stops missing them.
 */
const ALSO = {
  you: ['thou', 'thee', 'ye'], your: ['thy', 'thine'], yours: ['thine'], yourself: ['thyself'],
  thou: ['you'], thee: ['you'], ye: ['you'], thy: ['your'], thine: ['your', 'yours'], thyself: ['yourself'],
  who: ['that', 'which'], whoever: ['whosoever', 'whoso'], whosoever: ['whoever'], to: ['unto'], unto: ['to'],
  has: ['hath'], hath: ['has'], have: ['hast'], does: ['doth', 'doeth'], do: ['dost', 'doest', 'doeth', 'doing'], are: ['art'], will: ['wilt'], shall: ['shalt'],
  go: ['goest', 'goeth', 'goes', 'going'], says: ['saith'], said: ['saith', 'spake'], spoke: ['spake'],
  show: ['shew'], shows: ['sheweth'], showed: ['shewed'], shown: ['shewn', 'shewed'],
  child: ['children'], brothers: ['brethren'], tomorrow: ['morrow'],
  lord: ['yahweh'], yahweh: ['lord'], jehovah: ['lord', 'yahweh'],
};

const VOWEL = /[aeiou]/;

/** Whether a word doubles its last letter before an ending: one vowel between two consonants at its end ("run", "sin", "begin"). */
function doubles(w) {
  const last = w[w.length - 1];
  return w.length >= 3 && !VOWEL.test(last) && !/[wxy]/.test(last) && VOWEL.test(w[w.length - 2]) && !VOWEL.test(w[w.length - 3]);
}

/** The pattern of an English word with the endings it may carry. */
function english(w) {
  if (SMALL.en.has(w) || w.length < 3) return [w];
  if (w.length >= 6) return [w + '[a-z]*'];   // a long word finds every word that starts with it: "forgiv" finds "forgiveness"
  const long = w.length >= 4;
  const last = w[w.length - 1], before = w[w.length - 2];
  const alts = [];
  if (last === 'e') {
    alts.push(w + '(?:s|th|st' + (long ? '|d|n|ly' : '') + ')?');                    // love: loves, loveth, lovest, loved; give: given
    if (long) alts.push(w.slice(0, -1) + 'ings?');                                   // love: loving
  } else {
    alts.push(w + '(?:s|es|ed|eth|est|ings?' + (long ? '|ly|en' : '') + ')?');       // want: wants, wanted, wanteth; fall: fallen
    if (last === 'y' && !VOWEL.test(before)) alts.push(w.slice(0, -1) + '(?:ies|ied|ieth|iest)');   // mercy: mercies; cry: cried, crieth
    if (doubles(w)) alts.push(w + last + '(?:ed|eth|est|ings?)');                     // run: runneth, running; sin: sinned
  }
  return alts;
}

/** The pattern of an Afrikaans word with the endings it may carry. */
function afrikaans(w) {
  if (SMALL.af.has(w) || w.length < 3) return [w];
  if (w.length >= 6) return [w + '[a-z]*', 'ge' + w];
  const alts = [w + '(?:e|s|es|te|de|ers|ens)?', 'ge' + w];                           // berg: berge; lig: ligte; kind: kinders; kom: gekom
  if (doubles(w)) alts.push(w + w[w.length - 1] + '(?:e|ers)');                       // man: manne; lam: lammers
  const m = w.match(/^(.*?)(aa|ee|oo|uu)([^aeiou])$/);
  if (m) alts.push(m[1] + m[2][0] + m[3] + 'e');                                     // skaap: skape; naam: name
  return alts;
}

/** The parts of a pattern for one typed word in a language: the word, its endings, and in English the -s of today for the King James's -eth. */
function forms(w, lang) {
  if (lang === 'af') return afrikaans(w);
  const alts = english(w);
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss') && !SMALL.en.has(w)) {
    const stem = w.slice(0, -1);
    alts.push(stem + 'e?th');                                                         // believes: believeth; knows: knoweth
    if (doubles(stem)) alts.push(stem + stem[stem.length - 1] + 'eth');               // runs: runneth; sits: sitteth
    if (w.length >= 5 && w.endsWith('es')) alts.push(w.slice(0, -2) + 'e?th');        // teaches: teacheth
  }
  return alts;
}

/**
 * The pattern of one typed word: the word itself with its endings, and in
 * English the words that stand for it (ALSO). `lang` is the language of the
 * text that is searched, 'en' or 'af'.
 */
export function wordPattern(w, lang = 'en') {
  let alts = forms(w, lang);
  if (lang !== 'af' && ALSO[w]) for (const other of ALSO[w]) alts = alts.concat(forms(other, lang));
  return alts.length > 1 ? '(?:' + alts.join('|') + ')' : alts[0];
}

/* ---------------------------------------------------------------- what was typed */

/**
 * What was typed, as the terms to look for: [{typed, words, exact}]. Words
 * between quotes are one term that must stand side by side, exactly as
 * typed. A possessive 's, single letters and loose numbers are left out:
 * they carry nothing to look for.
 */
export function parseQuery(q) {
  const terms = [];
  const seen = new Set();
  const add = term => {
    const key = (term.exact ? '"' : '') + term.words.join(' ');
    if (!seen.has(key)) { seen.add(key); terms.push(term); }
  };
  const s = String(q || '').replace(/[“”„«»]/g, '"');
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) {
      const words = plain(m[1]).split(' ').filter(Boolean);
      if (words.length) add({ typed: m[1].trim().replace(/\s+/g, ' '), words, exact: true });
      continue;
    }
    for (const w of plain(m[2].replace(/['’]s\b/gi, '')).split(' ')) {
      if (w.length < 2 || /^\d+$/.test(w)) continue;
      add({ typed: w, words: [w], exact: false });
    }
  }
  return terms;
}

/* ---------------------------------------------------------------- the verses */

/**
 * The verses to search, made ready once: rows is [{book, chapter, verse,
 * text}] in the order of the Bible; each text is kept a second time in its
 * folded form, with a space at both ends so that a whole word is easy to
 * find. `lang` is the language of the text ('en' or 'af'): it sets the
 * endings a word may carry.
 */
export function makeCorpus(rows, lang = 'en') {
  const texts = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) texts[i] = ' ' + plain(rows[i].text) + ' ';
  return { rows, texts, lang: lang === 'af' ? 'af' : 'en', vocab: null };
}

/** Every word of the corpus with the number of times it stands there; counted the first time a spelling has to be looked up. */
function vocabOf(corpus) {
  if (corpus.vocab) return corpus.vocab;
  const vocab = new Map();
  for (const text of corpus.texts) {
    for (const w of text.split(' ')) if (w) vocab.set(w, (vocab.get(w) || 0) + 1);
  }
  corpus.vocab = vocab;
  return vocab;
}

/**
 * The words of the corpus nearest to a word in its spelling: one letter off
 * for a short word, up to two for a word of seven letters or more. They
 * start with the same letter (people who spell by ear get the first letter
 * right, and without this "worry" would become "sorry"). Only the nearest
 * are kept, the commonest first; three at most. A word under four letters is
 * left alone: too many words are one letter away from it.
 */
export function near(corpus, w) {
  if (w.length < 4) return [];
  const max = w.length >= 7 ? 2 : 1;
  let best = max + 1, found = [];
  for (const [v, n] of vocabOf(corpus)) {
    if (v === w || v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue;
    const d = distance(w, v, Math.min(max, best));
    if (d > max || d > best) continue;
    if (d < best) { best = d; found = []; }
    found.push([v, n]);
  }
  found.sort((a, b) => b[1] - a[1]);
  return found.slice(0, 3).map(x => x[0]);
}

/** The numbers of the verses a pattern is found in, in the order of the Bible. */
function matches(corpus, pattern) {
  const re = new RegExp(' ' + pattern + ' ');
  const list = [];
  const texts = corpus.texts;
  for (let i = 0; i < texts.length; i++) if (re.test(texts[i])) list.push(i);
  return list;
}

const CLOSEST = 30;   // how many verses to give when none has all the words
const GAP = 3;        // how many other words may stand between two typed words that count as close together
const RARE = 5;       // a typed word found in fewer verses than this may be a slip for a common word: its spelling is looked up too
const COMMON = 10;    // ... and the other word is taken along when it stands this many times as often

/**
 * Searches the corpus for what was typed. Gives
 *   kind    'all'     hits have every word that carries the meaning;
 *           'closest' no verse has them all: hits have most of the words, the best first;
 *           'none'    nothing to show;
 *   hits    the verses (rows of the corpus);
 *   close   how many of the first hits have the words close together, in the order typed (kind 'all');
 *           0 when all of them do, or none: there is then one group, in the order of the Bible;
 *   fixed   [{typed, used, also}]: a word whose spelling was looked up and the words searched in its place
 *           (also: the typed word is in a few verses itself, and was searched as well);
 *   dropped words (and quoted groups) that no verse has, left out of the search;
 *   test    a pattern that tells whether one folded word of a verse is one of the words found, for marking them.
 *
 * The small words ("the", "of", "my") are not asked for when other words
 * were typed with them: they only decide the order. So "the Lord is my
 * shepherd" finds the World English Bible's "Yahweh is my shepherd".
 */
export function find(corpus, q) {
  const out = { kind: 'none', hits: [], close: 0, fixed: [], dropped: [], test: null };
  const lang = corpus.lang, n = corpus.texts.length;
  const live = [];
  for (const term of parseQuery(q)) {
    let pattern = term.exact ? term.words.join(' ') : wordPattern(term.words[0], lang);
    let list = matches(corpus, pattern);
    if (!term.exact && list.length < RARE) {
      // no verse has the word, or hardly any: the nearest spellings are searched too ("sheperd": "shepherd"; "angle": "angel")
      const count = vocabOf(corpus);
      const used = near(corpus, term.words[0]).filter(v => !list.length || count.get(v) >= COMMON * list.length);
      if (used.length) {
        const wider = '(?:' + [pattern, ...used.map(v => wordPattern(v, lang))].join('|') + ')';
        const more = matches(corpus, wider);
        if (more.length > list.length) {
          out.fixed.push({ typed: term.typed, used, also: list.length > 0 });
          pattern = wider; list = more;
        }
      }
    }
    if (!list.length) { out.dropped.push(term.typed); continue; }
    live.push({ term, pattern, list, main: term.exact || !SMALL[lang].has(term.words[0]) });
  }
  if (!live.length) return out;
  out.test = new RegExp('^(?:' + live.map(x => x.term.exact ? x.term.words.join('|') : x.pattern).join('|') + ')$');

  /** For each verse, whether it is in a list. */
  const flags = list => { const has = new Uint8Array(n); for (const i of list) has[i] = 1; return has; };

  // the verses with every word that carries the meaning: those of the shortest list that are in all the others too
  const main = live.filter(x => x.main);
  const must = main.length ? main : live;
  const order = [...must].sort((a, b) => a.list.length - b.list.length);
  let found = order[0].list;
  for (const x of order.slice(1)) {
    const has = flags(x.list);
    found = found.filter(i => has[i]);
    if (!found.length) break;
  }
  if (found.length) {
    out.kind = 'all';
    if (live.length > 1) {
      // first the verses with the words close together: in the order typed, with at most three other words between one and the next
      // ("light of the world"); then those that have the small words too; then the rest. Each group in the order of the Bible.
      const gap = '(?: [a-z0-9]+){0,' + GAP + '} ';
      const whole = new RegExp(' ' + live.map(x => x.pattern).join(gap) + ' ');
      const mainly = must.length > 1 && must.length < live.length ? new RegExp(' ' + must.map(x => x.pattern).join(gap) + ' ') : null;
      const small = live.filter(x => !must.includes(x)).map(x => flags(x.list));
      const rank = new Uint8Array(n);
      let close = 0;
      for (const i of found) {
        const text = corpus.texts[i];
        if (whole.test(text) || (mainly && mainly.test(text))) close++;
        else rank[i] = small.every(has => has[i]) ? 1 : 2;
      }
      found = [...found].sort((a, b) => rank[a] - rank[b] || a - b);
      if (close < found.length) out.close = close;
    }
    out.hits = found.map(i => corpus.rows[i]);
    return out;
  }

  // no verse has them all: the verses with most of the words, a rare word counting for more than a common one
  const weight = live.map(x => Math.log(1 + n / x.list.length));
  const total = weight.reduce((a, b) => a + b, 0);
  const score = new Float32Array(n), count = new Uint8Array(n);
  live.forEach((x, k) => { for (const i of x.list) { score[i] += weight[k]; count[i]++; } });
  const need = live.length >= 3 ? 2 : 1;
  const floor = live.length >= 3 ? total * 0.6 : 0;
  const best = [];
  for (let i = 0; i < n; i++) if (count[i] >= need && score[i] >= floor) best.push(i);
  best.sort((a, b) => score[b] - score[a] || a - b);
  out.hits = best.slice(0, CLOSEST).map(i => corpus.rows[i]);
  out.kind = out.hits.length ? 'closest' : 'none';
  return out;
}

/**
 * The pattern that marks the typed words in a verse when someone else did
 * the searching (API.Bible): each word with its endings, a quoted group word
 * by word.
 */
export function testFor(q, lang = 'en') {
  const parts = parseQuery(q).flatMap(term => term.exact ? term.words : [wordPattern(term.words[0], lang)]);
  return parts.length ? new RegExp('^(?:' + parts.join('|') + ')$') : null;
}

/** The stretches of a verse to mark: [[from, to], …], one for each of its words that the search found. */
export function marks(text, test) {
  const out = [];
  if (!test) return out;
  const re = /[\p{L}\p{N}\p{M}]+/gu;
  let m;
  while ((m = re.exec(text))) {
    const w = fold(m[0]).replace(/[^a-z0-9]+/g, '');
    if (w && test.test(w)) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

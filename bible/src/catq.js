/*
 * The Catechism of the New Apostolic Church in Questions and Answers (2015),
 * read from its own PDF on the device: 750 questions in the Catechism's 13
 * chapters, each with its answer, the Bible verses it quotes in full and the
 * terms it explains, and at the back an index of the Bible verses by
 * question. The Afrikaans edition ("Kategismus van die Nuwe Apostoliese Kerk
 * in vrae en antwoorde") is the one the app was written for; the English
 * and German editions are set the same way.
 *
 * Like the handbooks, the book is the Church's copyright: the minister loads
 * the PDF once under Church files (files.js); readPages() (booklet.js) has
 * pdf.js take every piece of text off its pages with its font, place and
 * size; parseQA() shapes them into a handbook (handbook.js) that
 * handbooks.js keeps, shows, searches, asks and prints like the others:
 *   chapters  the 13 chapters at level 1 (n '1' … '13'; cat, the same
 *             chapter of the Catechism itself), each followed by its
 *             questions at level 2 (n 'q108', qn 108, parent '3', title the
 *             question, blocks the answer, page the book's page, refs the
 *             verses, see the questions it points to).
 *   blocks    'p' a paragraph of the answer, 'li' an item of a list (in the
 *             answer, or in small type in a box), 'quote' a Bible verse
 *             quoted in full with its reference after it (style 'r'), 'note'
 *             a term explained in small type, a footnote, or a line such as
 *             "Verlosser: sien Vrae 66, 108-109", 'h' a heading in an answer.
 *   refs      [{b, c, v, e}]: book id, chapter, first and last verse (0 for
 *             a whole chapter), from the references under the quoted verses
 *             and from the book's own index of the Bible verses, so that a
 *             preparation finds the questions on its text word
 *             (questionsFor).
 *
 * The book's shape is in its fonts (Adobe InDesign, 2014):
 *   a question's number   large and extra bold (Open Sans Extrabold 14, 13)
 *   the question          semibold (Open Sans Semibold 9.5)
 *   the answer            a serif (Minion Pro 9.5), a paragraph set in
 *   a quoted verse        light and small (Open Sans Light 8.5), opening “
 *   its reference         semibold and small (Open Sans Semibold 8.5)
 *   a term explained      light and small, the term bold, the items of a
 *                         list behind a dingbat (Wingdings "n")
 *   "Term: sien Vrae …"   italics (Open Sans Semibold Italic and Italic 9)
 *   the running head      the chapter's name at the top of every page
 *   a chapter's opener    its name in capitals (28 points) and a cloud of
 *                         words in large italics, on a page of its own
 *   the appendix          large sans headings (18 points)
 * Two columns a page, the left one read first.
 */
import { parseRef, findBook } from './books.js';

const BODY = 9.2;     // the question and the answer are set 9.5; under this is the small type of a verse or a box
const XREF = 8.75;    // the italic line on a term is set 9; the italics of a box 8.5
const SERIF = /minion|times|serif|georgia|garamond|palatino|cambria|caslon|baskerville|antiqua|charter|utopia|sabon/i;
const DING = /wingdings|symbol|dingbat|zapf|webdings/i;
const BULLET = /^[•●▪■‣◦]$/;
const END = /[.!?:;”’"')\]]$/;
const QUOTE_OPEN = /^[“"„‘]/;

const TITLES = {
  af: ['Kategismus in vrae en antwoorde', 'Kategismus van die Nuwe Apostoliese Kerk in vrae en antwoorde'],
  en: ['Catechism in Questions and Answers', 'Catechism of the New Apostolic Church in Questions and Answers'],
  de: ['Katechismus in Fragen und Antworten', 'Katechismus der Neuapostolischen Kirche in Fragen und Antworten'],
};
const APPENDIX = /^(bylaag|bylae|appendix|anhang)\b/i;
const BIBLE_INDEX = /(bybel|bible|bibel)/i;

/* ---------------------------------------------------------------- the pieces of text */

/** The part one piece of text plays, from its font's name (pdf.js gives it), else from its size and weight. */
function roleOf(it) {
  const f = it.font || '';
  const s = it.size;
  const str = it.str.trim();
  if (DING.test(f) || BULLET.test(str)) return 'bullet';
  if (s >= 12 && /^\d{1,3}$/.test(str) && (/bold|black|heavy/i.test(f) || it.bold)) return 'num';
  const serif = SERIF.test(f);
  if (s >= 20) return serif ? 'art' : 'opener';
  if (s >= 12) return serif ? 'art' : 'title';
  if (!f) return s >= BODY ? (it.bold ? 'q' : 'a') : it.italic && s >= XREF ? 'xref' : it.bold ? 'ref' : 'small';
  if (serif) return s >= BODY ? 'a' : 'foot';
  const italic = /italic|oblique/i.test(f) || it.italic;
  if (italic) return s >= XREF ? 'xref' : 'small';
  if (/semibold|semibd|demi|medium/i.test(f)) return s >= BODY ? 'q' : 'ref';
  if (/bold|black|heavy/i.test(f)) return s >= BODY ? 'q' : 'small';
  if (/light|thin/i.test(f)) return s >= BODY ? 'head' : s < 8.25 ? 'folio' : 'small';
  return s >= BODY ? 'q' : 'small';
}

/** The book's own characters in the app's letters: ligatures apart, a hard space as a space. */
const clean = s => String(s).replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');

/**
 * The lines of one page, the left column before the right, each top to
 * bottom: {page, col, y, x, x0, right, size, role, text, runs, bullet}.
 * Pieces on one baseline make a line, with a space where there is a gap
 * between them; a small raised figure is a footnote's mark. x is where the
 * words start, x0 where the line starts (its bullet, if it has one).
 */
export function linesOfPage(page) {
  const mid = page.width / 2;
  const items = page.items.filter(i => i.str && i.str.trim()).map(i => ({ ...i, role: roleOf(i) }));
  const lines = [];
  for (const col of [0, 1]) {
    const own = items.filter(i => (i.x < mid) === (col === 0)).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let line = null;
    for (const it of own) {
      if (line && Math.abs(it.y - line.y) <= Math.max(2, 0.45 * Math.max(it.size, line.size))) { line.items.push(it); if (it.size > line.size) { line.size = it.size; line.y = it.y; } }
      else { line = { page: page.n, col, y: it.y, size: it.size, items: [it] }; lines.push(line); }
    }
  }
  const out = [];
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    const bullets = l.items.filter(i => i.role === 'bullet');
    const words = l.items.filter(i => i.role !== 'bullet');
    l.bullet = bullets.length > 0;
    if (!words.length) continue;
    const weight = {};
    for (const i of words) weight[i.role] = (weight[i.role] || 0) + i.str.trim().length;
    l.role = words.some(i => i.role === 'num') ? 'num' : Object.keys(weight).sort((a, b) => weight[b] - weight[a])[0];
    l.x = words[0].x;
    l.x0 = Math.min(...l.items.map(i => i.x));
    l.right = Math.max(...words.map(i => i.x + (i.w || 0)));
    const body = Math.max(...words.map(i => i.size));
    const runs = [];
    let prev = null;
    words.forEach((i, k) => {
      let s = clean(i.str);
      const next = words[k + 1];
      // this book's Open Sans Semibold gives its capital B and F as small letters, set apart from the rest of the word: "b" "ybel"
      if (/^\p{Ll}$/u.test(s) && next && Math.abs(next.x - (i.x + (i.w || 0))) < 0.6 && /^\p{L}/u.test(next.str) && !SERIF.test(i.font || '') && i.bold) s = s.toUpperCase();
      if (prev) {
        const gap = i.x - (prev.x + (prev.w || 0));
        const last = runs[runs.length - 1][0];
        if (gap > 0.4 && !/\s$/.test(last) && !/^\s/.test(s)) s = ' ' + s;   // a word space: in a tight justified line under a point; within a word, none
      } else s = s.replace(/^\s+/, '');
      const sup = i.size < 0.8 * body && i.y < l.y - 1 && /^\d{1,2}$/.test(i.str.trim());
      const italic = /italic|oblique/i.test(i.font || '') || i.italic;
      const bold = /bold|black|heavy|semibd|demi/i.test(i.font || '') || i.bold;
      const style = sup ? 'sup' : (italic ? 'i' : '') + (bold && !['q', 'num', 'ref', 'title', 'opener', 'head'].includes(l.role) ? 'b' : '');
      if (runs.length && runs[runs.length - 1][1] === style) runs[runs.length - 1][0] += s;
      else runs.push([s, style]);
      prev = i;
    });
    if (runs.length) runs[runs.length - 1][0] = runs[runs.length - 1][0].replace(/\s+$/, '');
    l.runs = runs.filter(([s]) => s !== '');
    l.text = l.runs.map(([s]) => s).join('').trim();
    if (l.text) out.push(l);
  }
  return out;
}

/* ---------------------------------------------------------------- references */

/** "Romeine 1:19-20", "Psalm 104: 13-14", "1 Johannes 3: 1-2; 4:7" as [{b, c, v, e}]; what is not a reference is left out. */
export function refsOf(text) {
  const out = [];
  let book = null;
  for (const raw of String(text).replace(/\(.*?\)/g, ' ').split(/;/)) {
    const s = raw.replace(/\s*:\s*/g, ':').replace(/\s*[-–]\s*/g, '-').replace(/[,.]\s*$/, '').trim();
    if (!s) continue;
    const r = parseRef(s, { loose: true });   // loose: the book's "Deuteronónium" is Deuteronomium
    if (r && r.book) { book = r.book; out.push({ b: r.book, c: r.chapter, v: r.verse || 0, e: r.verseEnd || r.verse || 0 }); continue; }
    const m = book && s.match(/^(\d+)(?::(\d+)(?:-(\d+))?)?$/);   // "4:7" after "1 Johannes 3:1-2;": the same book
    if (m) out.push({ b: book, c: +m[1], v: m[2] ? +m[2] : 0, e: m[3] ? +m[3] : m[2] ? +m[2] : 0 });
  }
  return out;
}

/** The verses of one line of the book's Bible index, "1: 26-27", "2: 7-8, 19", "1: 26.28", "1", as [{c, v, e}]. */
function indexRefs(text) {
  const m = String(text).replace(/\s+/g, '').match(/^(\d+)(?::(.+))?$/);
  if (!m) return [];
  const c = +m[1];
  if (!m[2]) return [{ c, v: 0, e: 0 }];
  const out = [];
  for (const piece of m[2].split(/[,.;]/)) {
    const r = piece.match(/^(\d+)(?:[-–](\d+))?[a-z]?$/);
    if (r) out.push({ c, v: +r[1], e: r[2] ? +r[2] : +r[1] });
  }
  return out;
}

/** The question numbers of a list such as "224; 531; 686", "301-303, 307": [224, 531, 686]. */
function numbersOf(text) {
  const out = [];
  for (const piece of String(text).split(/[;,]/)) {
    const r = piece.trim().match(/^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\.?$/);
    if (!r) continue;
    const a = +r[1], b = r[2] ? +r[2] : a;
    for (let n = a; n <= Math.min(b, a + 30); n++) out.push(n);
  }
  return out;
}

/** The questions a line such as "Verlosser: sien Vrae 66, 108-109" or "sien ook Vraag 4" points to. */
export function seeOf(text) {
  const out = [];
  const re = /\b(?:vrae|vraag|questions?|fragen?|q\.)\s+((?:\d{1,3}(?:\s*[-–]\s*\d{1,3})?)(?:\s*(?:,|;|\ben\b|\band\b|\bund\b)\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)/gi;
  for (const m of String(text).matchAll(re)) {
    for (const piece of m[1].split(/\s*(?:,|;|\ben\b|\band\b|\bund\b)\s*/)) {
      const r = piece.match(/(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/);
      if (!r) continue;
      const a = +r[1], b = r[2] ? +r[2] : a;
      for (let n = a; n <= Math.min(b, a + 20); n++) if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

/**
 * The book's index of the Bible verses: book names in bold, a verse in
 * italics, the dot leaders, then the numbers of the questions that quote it
 * (on the next line too when they are many). Read in the order pdf.js gives
 * the pieces, which is the order they were set: column by column.
 * Returns Map(question number -> [{b, c, v, e}]).
 */
function bibleIndex(pages) {
  const map = new Map();
  for (const page of pages) {
    let book = null, refs = [];
    for (const it of page.items) {
      const s = it.str.trim();
      if (!s || it.y < 0.1 * page.height || it.y > 0.92 * page.height) continue;
      const f = it.font || '';
      const italic = /italic|oblique|-it\b|it$/i.test(f) || it.italic;
      const bold = /bold|black|heavy|semibd|demi/i.test(f) || it.bold;
      if (bold && !italic && /\p{L}/u.test(s)) {
        const b = findBook(s.replace(/[.:]+$/, '')) || parseRef(s.replace(/[.:]+$/, ''), { loose: true });
        book = b ? b.id || b.book : null;
        refs = [];
        continue;
      }
      if (italic && /^\d/.test(s)) { refs = indexRefs(s); continue; }
      if (/^[.\s…]+$/.test(s)) continue;
      if (book && refs.length && /^[\d\s;,.\-–]+$/.test(s)) {
        for (const n of numbersOf(s.replace(/^[.\s]+/, ''))) {
          if (!map.has(n)) map.set(n, []);
          for (const r of refs) map.get(n).push({ b: book, ...r });
        }
      }
    }
  }
  return map;
}

/* ---------------------------------------------------------------- the book */

/** True when these pages are the Catechism in Questions and Answers: its title page says so, or it numbers a hundred questions in the book's large extra-bold figures. */
export function isQA(pages) {
  const front = pages.slice(0, 6).map(p => p.items.map(i => i.str).join(' ')).join(' ');
  if (/in vrae en antwoorde|in questions and answers|in fragen und antworten/i.test(front.replace(/\s+/g, ' '))) return true;
  let nums = 0;
  for (const p of pages) for (const i of p.items) if (roleOf(i) === 'num') nums++;
  return nums >= 100;
}

/** 'af', 'de' or 'en', from the words of the questions. */
function languageOf(text) {
  const low = ' ' + text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ') + ' ';
  const count = re => (low.match(re) || []).length;
  const af = count(/ (wat|hoe|die|van|word|nie|het|waarom|wie) /g);
  const en = count(/ (what|how|the|of|does|not|why|who|which) /g);
  const de = count(/ (was|wie|der|das|ist|nicht|warum|wird|und) /g);
  return af >= en && af >= de ? 'af' : de > en ? 'de' : 'en';
}

/** The most common value of a list. */
function mode(values) {
  const n = new Map();
  for (const v of values) n.set(v, (n.get(v) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The book as a handbook: {key, language, title, ownTitle, org, edition,
 * pages, words, chapters, qa: true, questions}. Throws when fewer than
 * `min` questions are found (tools/test_catq.mjs reads a few made-up ones).
 */
export function parseQA(pages, { min = 20 } = {}) {
  const all = pages.map(p => ({ page: p, lines: linesOfPage(p) }));

  // the left edge of each column, on the left-hand and right-hand pages: where most lines of the questions and answers start
  const edges = { 0: [[], []], 1: [[], []] };
  for (const { page, lines } of all) for (const l of lines) if (l.role === 'a' || l.role === 'q') edges[page.n % 2][l.col].push(Math.round(l.x0));
  const edge = (n, col) => mode(edges[n % 2][col]) ?? 0;

  // the words the book writes with a hyphen ("drie-enige", "Enig-geborene"): one broken at a line's end after its own hyphen keeps it
  const hyphened = new Set();
  for (const { lines } of all) for (const l of lines) for (const m of l.text.matchAll(/\p{L}+-\p{L}+/gu)) hyphened.add(m[0].toLowerCase());
  const keepsHyphen = (before, after) => hyphened.has(((before.match(/\p{L}+-$/u) || [''])[0] + (after.match(/^\p{L}+/u) || [''])[0]).toLowerCase());
  /** Where a line meets the one before it: a word broken over the two joined, else a space (none after an opening bracket or a slash on a word, "en/"). */
  const meet = (before, after) => {
    if (/\p{L}-$/u.test(before) && /^\p{Ll}/u.test(after)) return keepsHyphen(before, after) ? [before, after] : [before.slice(0, -1), after];
    if (/[\s(]$/.test(before) || /\S[-/]$/.test(before) || /^[\s,.;:)]/.test(after)) return [before, after];
    return [before, ' ' + after];
  };

  const chapters = [];      // {n, title, level, page, blocks, cat, kids, heads}
  const questions = [];
  const toc = new Map();    // 1 -> 'Die openbaringe van God'
  let org = '', edition = '';
  let chapter = null, pending = true, openerPage = 0;
  let q = null, block = null, inTitle = false, last = null, lastNum = 0, ended = false;

  const flushBlock = () => {
    if (block && q) {
      const t = block.t.map(([s, st]) => [s, st]).filter(([s]) => s !== '');
      if (block.k === 'quote' && !t.some(r => r[1] === 'r') && !/[”"’]\W*$/.test(t.map(r => r[0]).join('').trim())) block.k = 'note';   // “Petrus” is die moderne vorm …: a term
      if (t.length) { t[t.length - 1][0] = t[t.length - 1][0].replace(/\s+$/, ''); q.blocks.push({ k: block.k, d: block.d, t }); }
    }
    block = null;
  };
  const flushQuestion = () => {
    flushBlock();
    if (!q) return;
    q.title = clean(q.title).trim().replace(/\s+([?:])/g, '$1');
    for (const b of q.blocks) if (b.k === 'note') for (const n of seeOf(b.t.map(r => r[0]).join(''))) if (n !== q.qn && !q.see.includes(n)) q.see.push(n);
    questions.push(q);
    chapter.kids.push(q);
    q = null;
  };
  /** A line's runs onto the block: a hyphen at the end of a line goes when the word runs on in small letters. */
  const append = (runs, brk = false) => {
    runs.forEach(([s0, st], i) => {
      let s = s0;
      const lastRun = block.t[block.t.length - 1];
      if (lastRun && i === 0 && brk) { lastRun[0] = lastRun[0].replace(/\s+$/, ''); s = '\n' + s; }
      else if (lastRun && i === 0) [lastRun[0], s] = meet(lastRun[0], s);
      if (lastRun && lastRun[1] === st) lastRun[0] += s; else block.t.push([s, st]);
    });
  };
  const start = (k, d, runs, kind, x) => { flushBlock(); block = { k, d, t: [], kind, x }; append(runs); };

  for (const { page, lines } of all) {
    if (ended) break;
    const top = 0.1 * page.height, foot = 0.92 * page.height;
    const head = lines.filter(l => l.y < top && !/^\d+$/.test(l.text)).sort((a, b) => a.col - b.col || a.x - b.x).map(l => l.text).join(' ').trim();
    if (questions.length || q) {
      if (APPENDIX.test(head) || lines.some(l => l.role === 'title')) { ended = true; break; }
    } else {
      // before the first question: who published it, which edition, and the contents
      for (const l of lines) {
        if (!org && /©/.test(l.text) && /apostolic|apostoliese|apostolische/i.test(l.text)) org = l.text.replace(/^©\s*\d{0,4}\s*/, '').replace(/,.*$/, '').trim();
        const ed = l.text.match(/\b(?:first|second|third|fourth|eerste|tweede|derde|erste|zweite|dritte)\s+(?:edition|uitgawe|druk|auflage)\b(?:\s+\d{4})?/i);
        if (!edition && ed) edition = ed[0];
        const t = l.text.match(/^(\d{1,2})\s+(\p{L}.*?)(?:\s*(?:\.\s?){3,}.*)?(?:\s+\d{1,3})?$/u);
        if (t && l.items[0] && /bold/i.test(l.items[0].font || '') && !toc.has(+t[1]) && toc.size + 1 === +t[1]) toc.set(+t[1], t[2].replace(/\s*\.+$/, '').trim());
      }
    }
    for (const col of [0, 1]) {
      const left = edge(page.n, col);
      for (const l of lines.filter(x => x.col === col)) {
        if (l.y < top || l.role === 'head' || l.role === 'folio' || (l.y > foot && /^\d+$/.test(l.text))) continue;
        // a line in the type of a reference that is no reference is a box's term in bold: "Regverdigheid voor God / regverdigmaking: …"
        if (l.role === 'ref' && !/\d/.test(l.text) && !refsOf(l.text).length) { l.role = 'small'; l.runs = l.runs.map(([s]) => [s, 'b']); }
        const role = l.role;
        if (role === 'opener') { openerPage = page.n; pending = true; continue; }   // a chapter's opener, a page of its own (before the first chapter the title page's large type too, which the opener after it overrules): the next question opens the chapter
        if (role === 'art' || role === 'title') continue;
        if (role === 'num') {
          const n = +l.text;
          if (!(n > lastNum && n <= lastNum + 5)) continue;   // a figure that is not the next question
          if (q) flushQuestion();
          if (pending || !chapter) {
            chapter = { n: String(chapters.length + 1), title: '', level: 1, page: openerPage || page.n, blocks: [], cat: String(chapters.length + 1), kids: [], heads: [] };
            chapters.push(chapter);
            pending = false; openerPage = 0;
          }
          q = { n: 'q' + n, qn: n, parent: chapter.n, title: '', level: 2, page: page.n, blocks: [], refs: [], see: [] };
          if (head) chapter.heads.push(head);
          lastNum = n; inTitle = true; last = l;
          continue;
        }
        if (!q) continue;                     // before the first question
        if (head && q.page !== page.n && !chapter.heads.includes(head)) chapter.heads.push(head);
        if (role === 'q') {
          if (inTitle) {
            if (!q.title) q.title = l.text;
            else { const [a, b] = meet(q.title, l.text); q.title = a + b; }
          } else start('h', 0, l.runs, 'h', l.x0);
          last = l;
          continue;
        }
        inTitle = false;
        if (role === 'a') {
          const indent = l.x0 - left;
          const prevEnds = !!last && last.role === 'a' && END.test(last.text);
          if (l.bullet) start('li', 1, l.runs, 'a', l.x0);
          else if (!block || block.kind !== 'a' || last.role !== 'a') start('p', 0, l.runs, 'a', l.x0);
          else if (block.k === 'li') { if (indent > 4) append(l.runs); else start('p', 0, l.runs, 'a', l.x0); }
          else if (indent > 4 && prevEnds) start('p', 0, l.runs, 'a', l.x0);
          else append(l.runs);
        } else if (role === 'small') {
          const small = runs => runs.map(([s, st]) => [s, st.includes('s') ? st : st + 's']);
          const term = (l.runs.find(([s]) => /\p{L}/u.test(s)) || ['', ''])[1].includes('b');   // “Monoteïsme” is …: a term explained
          const fresh = !block || block.kind !== 'small' || last.role !== 'small';
          const quoteOpen = block && block.k === 'quote' && !fresh && !/[”"]\s*$/.test(last.text);   // the verse runs on: a line that opens on ‘ is a quote within it
          // white space above the line (small type is set 8.5 on 10.4), or a new column after a full stop: a new box or verse
          const apart = !fresh && (last.page === l.page && last.col === l.col ? l.y - last.y > 1.2 * 1.22 * l.size : END.test(last.text));
          const afterHead = !fresh && last.runs.every(([s, st]) => st.includes('b') || !s.trim());   // "Die saligsprekinge", then the verses
          if (l.bullet) start('li', 1, small(l.runs), 'small', l.x0);
          else if (quoteOpen && apart) append(l.runs, true);
          else if (QUOTE_OPEN.test(l.text) && !term && !quoteOpen && (fresh || block.k === 'quote' || apart || afterHead)) start('quote', 0, l.runs, 'small', l.x0);
          else if (fresh || (apart && last.page === l.page && last.col === l.col)) start('note', 0, l.runs, 'small', l.x0);
          else if (block.k === 'li' && l.x0 <= block.x + 2) start('note', 0, l.runs, 'small', l.x0);   // back at the box's edge: the box's next paragraph
          else append(block.k === 'li' ? small(l.runs) : l.runs);
        } else if (role === 'ref') {
          for (const r of refsOf(l.text)) if (!q.refs.some(x => x.b === r.b && x.c === r.c && x.v === r.v && x.e === r.e)) q.refs.push(r);
          if (block && (block.k === 'quote' || (block.k === 'note' && block.kind === 'small')) && last.role === 'small') { block.k = 'quote'; block.t.push([' ' + l.text, 'r']); flushBlock(); }
          else if (block && block.kind === 'ref') append(l.runs.map(([s]) => [s, 'r']));
          else start('note', 0, l.runs.map(([s]) => [s, 'b']), 'ref', l.x0);
        } else if (role === 'xref') {
          const before = last && last.runs[last.runs.length - 1];
          const wraps = !!before && last.role === 'xref' && before[1].includes('b') && !/:\s*$/.test(before[0]);   // the line before ended inside a label
          const label = !!l.runs[0] && l.runs[0][1].includes('b') && !wraps;
          const runs = l.runs.map(([s, st]) => [s, st.includes('i') ? st : st + 'i']);
          if (!block || block.kind !== 'xref' || last.role !== 'xref' || label) start('note', 0, runs, 'xref', l.x0);
          else append(runs);
        } else if (role === 'foot') {
          if (!block || block.kind !== 'foot' || last.role !== 'foot') start('note', 0, l.runs, 'foot', l.x0);
          else append(l.runs);
        }
        last = l;
      }
    }
  }
  if (q) flushQuestion();
  if (questions.length < min) throw new Error('not the Catechism in questions and answers');

  // the verses of the book's Bible index, onto their questions
  const byNumber = new Map(questions.map(x => [x.qn, x]));
  const indexPages = all.filter(({ page, lines }) => {
    const head = lines.filter(l => l.y < 0.1 * page.height).map(l => l.text).join(' ');
    return BIBLE_INDEX.test(head) && /index|indeks|register|verwysing|verzeichnis/i.test(head);
  }).map(x => x.page);
  for (const [n, refs] of bibleIndex(indexPages)) {
    const x = byNumber.get(n);
    if (!x) continue;
    for (const r of refs) if (!x.refs.some(y => y.b === r.b && y.c === r.c && y.v === r.v && y.e === r.e)) x.refs.push(r);
  }

  // each chapter's name: the contents page's, else its pages' running head
  for (const c of chapters) {
    const heads = c.heads.map(h => h.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const common = mode(heads) || '';
    const longest = heads.filter(h => h.startsWith(common.split(' ').slice(0, 2).join(' '))).sort((a, b) => b.length - a.length)[0] || common;
    c.title = toc.get(+c.n) || longest || '';
  }
  const language = languageOf(questions.slice(0, 80).map(x => x.title).join(' '));
  const [title, ownTitle] = TITLES[language] || TITLES.en;
  const out = [];
  for (const c of chapters) {
    const { kids, heads, ...own } = c;
    out.push(own);
    out.push(...kids);
  }
  const words = out.reduce((n, c) => n + (c.title + ' ' + c.blocks.map(b => b.t.map(r => r[0]).join('')).join(' ')).split(/\s+/).filter(Boolean).length, 0);
  return { key: 'catechism-qa', language, title, ownTitle, org: org || 'New Apostolic Church International', edition, pages: pages.length, words, chapters: out, qa: true, questions: questions.length };
}

/* ---------------------------------------------------------------- reading */

/** The book among the loaded handbooks: the copy in `language`, else in the app's language `ui`, else any; null when it is not loaded. */
export function qaOf(handbooks, language = null, ui = null) {
  const all = (handbooks || []).filter(h => h.qa);
  return all.find(h => h.language === language) || all.find(h => h.language === ui) || all[0] || null;
}

/** A question of the book by its number, or null. */
export const questionOf = (hb, qn) => (hb && hb.qa ? hb.chapters.find(c => c.qn === Number(qn)) || null : null);

/** The questions of a chapter (1 … 13) of the book. */
export const questionsIn = (hb, n) => (hb && hb.qa ? hb.chapters.filter(c => c.parent === String(n)) : []);

/** "Questions 51–214": the numbers a chapter of the book holds, as [first, last]. */
export function rangeOf(hb, chapter) {
  const qs = questionsIn(hb, chapter.n);
  return qs.length ? [qs[0].qn, qs[qs.length - 1].qn] : null;
}

/**
 * A question's answer for the sermon notes (pdf.js): [{k, text, ref}] with k
 * 'p' a paragraph, 'li' a list item, 'quote' a verse (ref, its reference),
 * 'note' a box; text keeps the book's line breaks within a verse ("\n").
 * 'summary' gives the first paragraph alone.
 */
export function answerOf(q, how = 'full') {
  const out = q.blocks.filter(b => b.k !== 'h').map(b => ({
    k: b.k,
    text: b.t.filter(([, st]) => st !== 'sup' && st !== 'r').map(([s]) => s).join('').trim(),
    ref: b.t.filter(([, st]) => st === 'r').map(([s]) => s.trim()).join(' '),
  })).filter(x => x.text);
  return how === 'summary' ? out.filter(x => x.k === 'p').slice(0, 1) : out;
}

/** The questions of a loaded book that quote a verse of this passage (verse null: the chapter), in the book's order. */
export function questionsFor(hb, book, chapter, verse = null, verseEnd = null) {
  if (!hb || !hb.qa) return [];
  const from = verse || 0, to = verseEnd || verse || 0;
  return hb.chapters.filter(c => c.qn != null && (c.refs || []).some(r => r.b === book && r.c === chapter && (!from || !r.v || (r.v <= to && (r.e || r.v) >= from))));
}

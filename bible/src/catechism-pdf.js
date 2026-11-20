/*
 * The Catechism of the New Apostolic Church, read from its own PDF on the
 * device itself: no AI, no key, no script on a PC. Until November 2026 the
 * text came from a file that tools/build_catechism.py made out of
 * `pdftotext -layout`; this module makes the same file in the browser, so
 * that any minister loads the Catechism in one tap under Church files
 * (files.js). The text is the Church's copyright and stays on the device
 * (store.js saveCatechismText), as before.
 *
 * readPages() (booklet.js) has pdf.js read the PDF into pages, every piece
 * of text with its place and size. The book's shape is in those numbers:
 *   - a section heading is set a point larger than the body and starts with
 *     the section's number; the Introduction and the Appendix in large type;
 *   - a paragraph's first line is set in a little (except the first after a
 *     heading), a list is set in further, a bullet starts with "•";
 *   - the SUMMARY at the end of a group of sections is set a little smaller,
 *     each of its paragraphs ending in the numbers of the sections it sums up;
 *   - footnotes stand in small type under the page's text, their marks raised
 *     in the text; the running head stands in small type at the very top;
 *   - the Ten Commandments (5.3.1.4) are a table in three columns of small
 *     type over three pages;
 *   - the Appendix sets the creeds, the commandments and the Lord's Prayer
 *     with short headings and blank lines instead of indents.
 * The sections are found in the order of the built-in index
 * (data/catechism.json): a heading counts when it is the next unseen entry,
 * so a number in the running text is never taken for a heading.
 *
 * parseCatechism(pages, index) → {sections, edition, language, year, found,
 * missing, odd}; sections in the index's order, each {n, title, page,
 * blocks, summary?, notes?} exactly as the build script writes them:
 *   blocks: "paragraph", {l: ["item", …]}, {h: "sub-heading"}, {v: ["line", …]},
 *           {table: {head: […], rows: [[label, cell, …], …]}}
 *   summary: ["…"]   notes: [{n, t}]
 * catechismFile(parsed, fileName) wraps that as the file the store takes.
 */

const SUP = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
const BULLET = /^[•●▪■‣◦]\s*/;
const HEAD_NUM = /^(\d+(?:\.\d+)*)\s+(\S.*)$/;
const DOTS = /(?:\s\.){3,}|\.{4,}|…{2,}/;              // the dot leaders of a table of contents
const MARK = /\s*\(((?:Intro(?:\.\d+)?|\d+(?:\.\d+)*)(?:;\s*(?:Intro(?:\.\d+)?|\d+(?:\.\d+)*))*)\)\s*$/;   // "(1.1)" or "(3.4; 3.4.1)" after a summary paragraph
const NOTE_START = /^(\d{1,2}) (\S.*)$/;
const LABEL = /^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth) Commandment$/;
const TABLE_HEAD = 'The Ten Commandments';
const END_PUNCT = /[.!?”’:]$/;

/* ---------------------------------------------------------------- the lines of a page */

/** The book's own characters in the app's letters: ligatures apart, a hard space as a space. */
function clean(s) {
  return String(s).replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/[ \t]/g, ' ').replace(/\s+/g, ' ');
}

/**
 * The pieces of text of one page as lines, top to bottom: {page, y, x,
 * right, size, text, sups, items, bullet}. A raised small number is a
 * footnote mark: it goes into the text as a superscript and into `sups`.
 */
function linesOf(page) {
  const items = page.items.filter(i => i.str.trim()).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rows = [];
  let cur = null;
  for (const it of items) {
    const tol = Math.max(2.5, 0.42 * Math.max(it.size, cur ? cur.size : 0));
    if (!cur || Math.abs(it.y - cur.y) > tol) { cur = { y: it.y, size: it.size, items: [] }; rows.push(cur); }
    cur.items.push(it);
    if (it.size > cur.size) { cur.size = it.size; cur.y = it.y; }
  }
  const out = [];
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    let text = '', end = null;
    const sups = [];
    for (const it of its) {
      const s = clean(it.str);
      const raised = it.size <= 0.75 * r.size && it.y < r.y - 0.1 * r.size && /^\d{1,2}$/.test(s.trim());
      if (raised) {
        const n = parseInt(s, 10);
        sups.push(n);
        text = text.replace(/\s+$/, '') + String(n).split('').map(d => SUP[+d]).join('');
        end = it.x + it.w;
        continue;
      }
      // a gap between two pieces is a space, except around a dash, before a closing mark and after an opening one
      if (end !== null && it.x - end > 0.12 * it.size && !s.startsWith(' ') && !text.endsWith(' ') && !/^[–—’'.,;:!?)”\]]/.test(s) && !/[–—‘“(\[]$/.test(text)) text += ' ';
      text += s;
      end = it.x + it.w;
    }
    text = text.trim();
    if (!text) continue;
    const line = { page: page.n, y: r.y, x: its[0].x, right: Math.max(...its.map(i => i.x + i.w)), size: r.size, text, sups, items: its, bullet: '' };
    const m = text.match(BULLET);
    if (m && text.length > m[0].length) { line.bullet = m[0].trim(); line.text = text.slice(m[0].length).trim(); }
    out.push(line);
  }
  return out;
}

/** Pieces of one line, in reading order, as text: a gap between two pieces is a space, except around a dash, before a closing mark and after an opening one. */
function joinItems(items) {
  let text = '', end = null;
  for (const it of items) {
    const s = clean(it.str);
    if (end !== null && it.x - end > 0.12 * it.size && !s.startsWith(' ') && !text.endsWith(' ') && !/^[–—’'.,;:!?)”\]]/.test(s) && !/[–—‘“(\[]$/.test(text)) text += ' ';
    text += s;
    end = it.x + it.w;
  }
  return text.trim();
}

/** The most common value (rounded to `step`) among `values`, weighted by `weight(v)`; null when there are none. */
function commonest(pairs, step = 0.1) {
  const w = new Map();
  for (const [v, weight] of pairs) {
    const k = Math.round(v / step) * step;
    w.set(k, (w.get(k) || 0) + weight);
  }
  let best = null, n = -1;
  for (const [k, v] of w) if (v > n) { n = v; best = k; }
  return best;
}

/* ---------------------------------------------------------------- words, for the hyphens */

/** The words of the book, to tell whether a hyphen at the end of a line is a real one ("self-revelation") or a break ("pro-claimed"). */
class Vocab {
  constructor() { this.words = new Set(); this.hyphenated = new Set(); }
  learn(text) {
    for (const w of text.match(/[A-Za-z][A-Za-z’']*(?:-[A-Za-z’']+)*/g) || []) {
      if (w.includes('-')) this.hyphenated.add(w.toLowerCase()); else this.words.add(w.toLowerCase());
    }
  }
  /** The next line of a paragraph appended to the text gathered so far. */
  join(text, next) {
    next = String(next).trim();
    if (!text) return next;
    if (/[—–]$/.test(text)) return text + next;
    if (text.endsWith('-') && /^[A-Za-z]/.test(next)) {
      const head = text.match(/([A-Za-z’']+)-$/);
      const tail = next.match(/^[A-Za-z’']+/);
      if (head && tail) {
        const a = head[1], b = tail[0];
        if (this.words.has((a + b).toLowerCase())) return text.slice(0, -1) + next;
        if (this.hyphenated.has((a + '-' + b).toLowerCase())) return text + next;
      }
      return text.slice(0, -1) + next;
    }
    return text + ' ' + next;
  }
}

/* ---------------------------------------------------------------- the blocks of a section */

/** Gathers the lines of one section into paragraphs, lists and the rest, as the build script does. */
class Blocks {
  constructor(vocab) {
    this.vocab = vocab;
    this.out = [];
    this.para = null;         // text of the open paragraph
    this.items = null;        // the open list
    this.bulletOpen = false;  // the open list is a "•" list, whose items wrap onto indented lines
    this.lastText = '';
    this.lastInd = 0;
  }
  close() {
    if (this.para) this.out.push(this.para);
    this.para = null;
    if (this.items && this.items.length) this.out.push({ l: this.items });
    this.items = null;
    this.bulletOpen = false;
  }
  /** A line that starts with a bullet. */
  bullet(text) {
    if (this.para || (this.items && !this.bulletOpen)) this.close();
    if (!this.items) this.items = [];
    this.items.push(text.trim());
    this.bulletOpen = true;
    this.lastText = text.trim();
  }
  /** An indented line under a bullet: the rest of that item. */
  more(text) {
    this.items[this.items.length - 1] = this.vocab.join(this.items[this.items.length - 1], text);
    this.lastText = text.trim();
  }
  /** A line of running text; `fresh` when the page's shape says a paragraph starts here. */
  paragraph(text, fresh, ind = 0) {
    if (this.items) this.close();
    if (fresh || this.para === null) { this.close(); this.para = text.trim(); } else this.para = this.vocab.join(this.para, text);
    this.lastText = text.trim();
    this.lastInd = ind;
  }
  /** An indented line: a list item, or more of the one before it. */
  item(text, ind = 0) {
    if (this.para || this.bulletOpen) this.close();
    if (!this.items) this.items = [];
    const prev = this.items.length ? this.items[this.items.length - 1] : null;
    text = text.trim();
    const cont = prev !== null && (this.lastText.length >= 55 || /^[a-z]/.test(text) || /[,\-—;]$/.test(this.lastText) || (prev.split('(').length > prev.split(')').length));
    if (cont) this.items[this.items.length - 1] = this.vocab.join(prev, text); else this.items.push(text);
    this.lastText = text;
    this.lastInd = ind;
  }
  heading(text) { this.close(); this.out.push({ h: text }); }
  verse(lines) { this.close(); this.out.push({ v: lines }); }
  table(table) {
    this.close();
    const last = this.out[this.out.length - 1];
    if (last && last.table && JSON.stringify(last.table.head) === JSON.stringify(table.head)) last.table.rows.push(...table.rows);   // the same table carried on to the next page
    else this.out.push({ table });
  }
  finish() {
    this.close();
    // a short unpunctuated line before a list is a run-in heading ("Healing the sick"), unless the list goes on with its sentence ("… is clearly revealed" / "in the incarnation …")
    for (let k = 0; k < this.out.length - 1; k++) {
      const b = this.out[k], next = this.out[k + 1];
      if (typeof b === 'string' && b.length <= 60 && !/[.!?”:,;)]$/.test(b) && next && typeof next === 'object' && next.l && !/^[a-z]/.test(next.l[0] || '')) this.out[k] = { h: b };
    }
    return this.out;
  }
}

/* ---------------------------------------------------------------- the headings */

const norm = s => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—-]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function titleMatches(shown, title) {
  const a = norm(shown), b = norm(title);
  if (!a || !b) return false;
  return a.startsWith(b) || (a.length >= 6 && b.startsWith(a));
}

/** The number a section prints before its title: "1.2.1", "1" for Intro.1, or the word itself for the Introduction and the Appendix. */
function printedOf(n) {
  if (n === 'Intro') return 'Introduction';
  if (n.startsWith('Intro.')) return n.slice(6);
  return n;
}

/* ---------------------------------------------------------------- the table of the commandments */

/** Reads the three-column table of the Ten Commandments from its lines (all in small type), as they come, page after page. */
class Table {
  constructor(headLine, vocab) {
    this.vocab = vocab;
    this.cols = headLine.items.filter(i => clean(i.str).trim() === TABLE_HEAD).map(i => i.x);
    this.head = this.cols.map(() => TABLE_HEAD);
    this.headRows = 1;        // the line(s) under the header that complete its cells
    this.subHead = new Set(); // the words of those lines, to know the header when it comes again at the top of the next page
    this.skip = 0;            // lines of a repeated header still to pass over
    this.rows = [];           // [label, [[lines of col 1], [lines of col 2], …]]
    this.cur = null;
  }
  /** The column a piece belongs to: the last whose start it is not left of (a left-hand and a right-hand page set the columns a little apart, so the starts are read again from each page's header). */
  colOf(x) {
    let k = 0;
    for (let i = 1; i < this.cols.length; i++) if (x >= this.cols[i] - 6) k = i;
    return k;
  }
  /** The pieces of one line that fall in each column, each column's pieces joined as a line's are. */
  split(line) {
    const cols = this.cols.map(() => []);
    for (const it of line.items) cols[this.colOf(it.x)].push(it);
    return cols.map((items, k) => {
      if (!items.length) return null;
      const last = items[items.length - 1];
      const width = (this.cols[k + 1] || line.right + 6) - this.cols[k];
      return { text: joinItems(items), full: last.x + last.w - this.cols[k] >= 0.72 * width };
    });
  }
  /** Takes a line; false when the line is not part of the table. */
  take(line) {
    const heads = line.items.filter(i => clean(i.str).trim() === TABLE_HEAD);
    if (heads.length >= 2) {
      // the header again, at the top of the next page: the columns start where it says, and its second line is passed over
      this.cols = heads.map(i => i.x);
      this.skip = this.headRows - 1;
      return true;
    }
    if (this.skip > 0) { this.skip--; return true; }
    const label = line.text.match(LABEL);
    if (label && line.items.length === 1) {
      this.cur = [line.text.trim(), this.cols.map(() => [])];
      this.rows.push(this.cur);
      return true;
    }
    const cells = this.split(line);
    if (!this.cur) {
      // the rest of the header, under its first line
      if (this.headRows > 2) return false;
      this.headRows++;
      cells.forEach((c, k) => { if (c) this.head[k] = (this.head[k] + ' ' + c.text).trim(); });
      return true;
    }
    cells.forEach((c, k) => { if (c) this.cur[1][k].push(c); });
    return true;
  }
  result() {
    const rows = this.rows.map(([label, cells]) => [label, ...cells.map(lines => {
      let text = '', prevFull = true;
      for (const l of lines) {
        if (text && !prevFull && /^[A-Z“]/.test(l.text)) text += '\n' + l.text;   // a new sentence after a short line: the cell's own paragraph
        else text = this.vocab.join(text, l.text);
        prevFull = l.full || /-$/.test(l.text);
      }
      return text;
    })]);
    return { head: this.head, rows };
  }
}

/* ---------------------------------------------------------------- the parse */

/**
 * The Catechism's text from its pages (booklet.js readPages), matched to
 * the sections of the built-in index. Throws when the file is not the
 * Catechism (too few of its sections are found).
 */
export function parseCatechism(pages, index) {
  const toc = index.map(e => ({ n: e.n, title: e.title, page: e.page || 0, printed: printedOf(e.n) }));
  const byN = new Map(toc.map(e => [e.n, e]));
  const all = pages.map(p => ({ page: p, lines: linesOf(p) }));
  const every = all.flatMap(p => p.lines);
  if (!every.length) throw new Error('empty');

  // the sizes of type: the body, the headings a point larger, the summaries a little smaller, the small type of footnotes and running heads
  const body = commonest(every.map(l => [l.size, l.text.length]));
  const head = commonest(every.filter(l => l.size > body * 1.05 && l.size <= body * 1.25).map(l => [l.size, l.text.length])) || body * 1.1;
  const sum = commonest(every.filter(l => l.size >= body * 0.9 && l.size < body * 0.97).map(l => [l.size, l.text.length])) || body * 0.93;
  const cls = l => l.size >= body * 1.3 ? 'big' : Math.abs(l.size - head) < 0.25 ? 'head' : Math.abs(l.size - body) < 0.25 ? 'body' : Math.abs(l.size - sum) < 0.2 ? 'sum' : l.size <= body * 0.85 ? 'small' : 'other';
  for (const l of every) l.cls = cls(l);

  // the page's furniture: the running head in small type at the very top, the page number at the foot, the dot leaders of a contents list
  const height = pages[0] ? pages[0].height : 842;
  for (const p of all) {
    const dotted = p.lines.filter(l => DOTS.test(l.text)).length;
    p.lines = p.lines.filter(l => !(l.cls === 'small' && l.y < 0.06 * height) && !(/^\d{1,3}$/.test(l.text) && l.y > 0.84 * height) && !DOTS.test(l.text));
    // a contents page: only a heading in large type on it counts (the Appendix opens with its own contents)
    p.toc = (dotted >= 3 && dotted >= 0.5 * (p.lines.length + dotted)) || (p.lines.length >= 4 && p.lines.filter(l => l.cls === 'other' || /\s\d{1,3}$/.test(l.text)).length >= 0.6 * p.lines.length);
  }

  // the margins: a left page and a right page have their own (the book is set in mirrored margins), the text's width, the indents
  const margins = { 0: [], 1: [] };
  for (const p of all) {
    const xs = p.lines.filter(l => l.cls === 'body').map(l => [l.x, 1]);
    if (xs.length < 4) continue;
    const counts = new Map();
    for (const [x] of xs) { const k = Math.round(x * 2) / 2; counts.set(k, (counts.get(k) || 0) + 1); }
    const frequent = [...counts.entries()].filter(([, n]) => n >= 3).map(([k]) => k);
    if (frequent.length) margins[p.page.n % 2].push([Math.min(...frequent), 1]);
  }
  const marginOf = { 0: commonest(margins[0], 0.5), 1: commonest(margins[1], 0.5) };
  if (marginOf[0] === null) marginOf[0] = marginOf[1];
  if (marginOf[1] === null) marginOf[1] = marginOf[0];
  const margin = n => marginOf[n % 2] || 0;
  const bodyLines = every.filter(l => l.cls === 'body');
  const offsets = bodyLines.map(l => [l.x - margin(l.page), 1]);
  const PARA = commonest(offsets.filter(([o]) => o >= 8 && o <= 20)) || 13;
  const LIST = commonest(offsets.filter(([o]) => o >= 25 && o <= 50)) || 34;
  const rightOf = { 0: commonest(bodyLines.filter(l => l.page % 2 === 0).map(l => [l.right, 1]), 0.5), 1: commonest(bodyLines.filter(l => l.page % 2 === 1).map(l => [l.right, 1]), 0.5) };
  const right = n => rightOf[n % 2] || rightOf[(n + 1) % 2] || 0;
  const textWidth = Math.max(100, (right(2) - margin(2) + right(1) - margin(1)) / 2);
  const step = (what) => {
    const gaps = [];
    for (const p of all) {
      const ls = p.lines.filter(l => l.cls === what);
      for (let i = 1; i < ls.length; i++) gaps.push([ls[i].y - ls[i - 1].y, 1]);
    }
    return commonest(gaps.filter(([g]) => g > 0 && g < 40), 0.5) || body * 1.4;
  };
  const bodyStep = step('body'), sumStep = step('sum');

  const vocab = new Vocab();
  for (const l of every) if (l.cls !== 'big') vocab.learn(l.text);

  // the edition: the year of the copyright line in the front matter, and the language of the words
  let year = '';
  for (const p of all.slice(0, 12)) for (const l of p.lines) { const m = l.text.match(/©\s*(\d{4})/); if (m) { year = m[1]; break; } }
  const words = bodyLines.slice(0, 2000).map(l => l.text.toLowerCase()).join(' ').match(/[a-z]+/g) || [];
  let af = 0, en = 0;
  for (const w of words) { if (w === 'die' || w === 'en' || w === 'van' || w === 'nie' || w === 'wat' || w === 'het' || w === 'vir') af++; else if (w === 'the' || w === 'and' || w === 'of' || w === 'to' || w === 'is' || w === 'in') en++; }
  const language = af > en ? 'af' : 'en';

  // the walk through the pages
  const sections = new Map();     // n -> {blocks, summary, notes}
  const section = n => { if (!sections.has(n)) sections.set(n, { blocks: null, summary: [], notes: [] }); return sections.get(n); };
  const odd = [];
  let pos = -1, current = null, blocks = null, mode = 'body', summaryPara = [], table = null;

  const flushSummary = () => {
    if (!summaryPara.length) return;
    let text = '';
    for (const ln of summaryPara) text = vocab.join(text, ln);
    const m = text.match(MARK);
    let targets = m ? m[1].split(';').map(s => s.trim()) : [];
    if (m && targets.every(t => byN.has(t))) text = text.slice(0, m.index).replace(/\s+$/, '');
    else { targets = [current]; odd.push(`summary without a section mark under ${current}: ${text.slice(0, 60)}`); }
    for (const t of targets) section(t).summary.push(text);
    summaryPara = [];
  };
  const closeTable = () => { if (table) { blocks.table(table.result()); table = null; } };
  const finishSection = () => {
    flushSummary();
    closeTable();
    if (blocks && current) section(current).blocks = blocks.finish();
  };

  let stop = false;
  for (const p of all) {
    if (stop) break;
    const pageNo = p.page.n;
    if (!p.lines.length) continue;   // a blank page
    // footnotes: the small lines under the page's text, the first starting with a number set in a little
    let lines = p.toc ? p.lines.filter(l => l.cls === 'big') : p.lines;   // on a contents page only a heading in large type counts
    const notes = new Map();
    const lastMain = Math.max(0, ...lines.filter(l => l.cls !== 'small').map(l => l.y));
    const k = lines.findIndex(l => l.cls === 'small' && l.y > lastMain && NOTE_START.test(l.text) && l.x > margin(pageNo) + 3 && l.x < margin(pageNo) + 20 && !table);
    if (k >= 0 && lines.slice(k).every(l => l.cls === 'small')) {
      let n = null;
      for (const l of lines.slice(k)) {
        const m = l.text.match(NOTE_START);
        if (m && l.x > margin(pageNo) + 3) { n = parseInt(m[1], 10); notes.set(n, m[2]); } else if (n !== null) notes.set(n, vocab.join(notes.get(n), l.text));
      }
      lines = lines.slice(0, k);
    }
    const takeNotes = (sups) => {
      for (const n of sups) {
        if (notes.has(n) && current) { section(current).notes.push({ n, t: notes.get(n) }); notes.delete(n); } else if (current) odd.push(`${current}: a mark ${n} on page ${pageNo} has no footnote`);
      }
    };

    let prev = null;
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const top = prev === null;                       // the first line of the page: what came before is on the page before, so no gap is read
      const gap = top ? 0 : line.y - prev.y;
      prev = line;
      // the end of the book's text
      if (line.cls === 'big' && norm(line.text) === 'glossary' && pos >= toc.length - 2) { stop = true; break; }
      // a heading: the next unseen entry of the index, by its number and its title
      if (line.cls === 'head' || line.cls === 'big') {
        const m = line.text.match(HEAD_NUM);
        const cand = m ? [m[1], m[2]] : (norm(line.text) === 'introduction' || norm(line.text) === 'appendix') ? [line.text.trim(), line.text.trim()] : null;
        let hit = null;
        if (cand) {
          for (let q = pos + 1; q < Math.min(pos + 4, toc.length); q++) {
            const e = toc[q];
            if (e.printed === cand[0] && (titleMatches(cand[1], e.title) || (e.printed === e.title && norm(cand[1]) === norm(e.title)))) { hit = q; break; }
          }
        }
        if (hit !== null) {
          if (hit > pos + 1) odd.push(`skipped ${toc.slice(pos + 1, hit).map(e => e.n).join(', ')} before ${toc[hit].n}`);
          finishSection();
          pos = hit;
          current = toc[hit].n;
          blocks = new Blocks(vocab);
          mode = current === 'Appendix' ? 'appendix' : 'body';
          section(current);
          takeNotes(line.sups);
          // a title too long for one line goes on in the next line(s) of heading type
          let shown = cand[1];
          while (j + 1 < lines.length && lines[j + 1].cls === 'head' && !HEAD_NUM.test(lines[j + 1].text) && norm(toc[hit].title).startsWith(norm(shown + ' ' + lines[j + 1].text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '')))) {
            j++;
            shown += ' ' + lines[j].text;
            takeNotes(lines[j].sups);
            prev = lines[j];
          }
          continue;
        }
      }
      if (!current) continue;
      if (line.cls === 'other') continue;
      if (line.cls === 'big') { flushSummary(); closeTable(); blocks.close(); continue; }   // a part's title on a page with text: nothing of the section

      // the table of the Ten Commandments, in small type over three pages
      if (table) {
        if (line.cls === 'small' && table.take(line)) { takeNotes(line.sups); continue; }
        closeTable();
      }
      if (line.cls === 'small') {
        if (line.items.filter(i => clean(i.str).trim() === TABLE_HEAD).length >= 2) { blocks.close(); mode = 'body'; table = new Table(line, vocab); continue; }
        odd.push(`${current}: small type on page ${pageNo} left out: ${line.text.slice(0, 50)}`);
        continue;
      }

      // the SUMMARY box: its paragraphs, each ending in the sections it belongs to, until the next heading
      if (line.cls === 'head' && norm(line.text) === 'summary') { blocks.close(); flushSummary(); mode = 'summary'; continue; }
      if (mode === 'summary') {
        if (line.cls === 'sum') {
          if (gap > 1.35 * sumStep) flushSummary();
          summaryPara.push(line.text);
          takeNotes(line.sups);
          if (MARK.test(line.text)) flushSummary();
          continue;
        }
        flushSummary();
        mode = current === 'Appendix' ? 'appendix' : 'body';
      }
      if (line.cls === 'sum') { odd.push(`${current}: summary type outside a summary on page ${pageNo}: ${line.text.slice(0, 50)}`); summaryPara.push(line.text); flushSummary(); continue; }

      takeNotes(line.sups);
      if (mode === 'appendix') { j += appendixLine(blocks, lines, j, top || gap > 1.5 * bodyStep, bodyStep) - 1; prev = lines[j]; continue; }
      if (line.cls === 'head') { blocks.heading(line.text); continue; }   // a heading of the book's that the index does not list

      // a line of the body
      const ind = line.x - margin(pageNo);
      const text = line.text;
      if (gap > 1.6 * bodyStep && !line.bullet) blocks.close();
      if (line.bullet) {
        blocks.bullet(text);
      } else if (blocks.bulletOpen && ind >= 5 && ind < LIST - 6 && (blocks.lastText.length >= 55 || /^[a-z]/.test(text) || /[,\-—;]$/.test(blocks.lastText))) {
        blocks.more(text);
      } else if (ind >= LIST - 6) {
        blocks.item(text, ind);
      } else if (ind >= PARA - 5) {
        // a line set in starts a paragraph, unless it wraps the set-in line before it
        const wraps = Math.abs(ind - blocks.lastInd) <= 2 && blocks.para !== null && (blocks.lastText.length >= 55 || /^[a-z]/.test(text));
        blocks.paragraph(text, !wraps, ind);
      } else {
        // at the margin: more of the open paragraph, or a new one when the line before ended short
        // (the first paragraph after a heading is not set in, nor is one that goes on at the top of a page)
        const fresh = blocks.para === null || (blocks.lastText.length < 50 && END_PUNCT.test(blocks.lastText) && /^[A-Z“‘]/.test(text));
        blocks.paragraph(text, fresh, 0);
      }
    }
    for (const [n, t] of notes) {
      if (current) { section(current).notes.push({ n, t }); odd.push(`${current}: footnote ${n} on page ${pageNo} has no mark in the text`); }
    }
  }
  finishSection();

  const found = toc.filter(e => sections.has(e.n)).length;
  if (found < 0.6 * toc.length) throw new Error(`not the Catechism: ${found} of ${toc.length} sections found`);
  const rows = toc.map(e => {
    const got = sections.get(e.n) || {};
    const row = { n: e.n, title: e.title };
    if (e.page) row.page = e.page;
    row.blocks = got.blocks || [];
    if (got.summary && got.summary.length) row.summary = got.summary;
    if (got.notes && got.notes.length) row.notes = got.notes;
    return row;
  });
  return {
    sections: rows, language, year, found, missing: toc.filter(e => !sections.has(e.n)).map(e => e.n), odd,
    edition: 'Catechism of the New Apostolic Church, ' + (language === 'af' ? 'Afrikaans' : 'English') + ' edition' + (year ? ` (${year})` : ''),
  };
}

/**
 * The appendix (the creeds, the commandments, the Lord's Prayer) uses blank
 * lines and short headings, not indents. Returns how many lines were taken.
 */
function appendixLine(blocks, lines, j, blank, bodyStep) {
  const line = lines[j];
  const text = line.text;
  if (line.cls === 'head') { blocks.heading(text); return 1; }
  if (blank) blocks.close();
  const next = lines[j + 1] && lines[j + 1].y - line.y <= 1.5 * bodyStep ? lines[j + 1].text : '';
  const short = text.length <= 60 && !/[.,;”’]$/.test(text);
  if (blank && short && (!next || text.endsWith(':') || text.startsWith('The '))) { blocks.heading(text.replace(/:$/, '')); return 1; }
  if (blank && blocks.para === null) {
    const run = [];
    let k = j;
    while (k < lines.length && lines[k].cls === 'body' && lines[k].text.length <= 70 && !/-$/.test(lines[k].text) && (k === j || lines[k].y - lines[k - 1].y <= 1.5 * bodyStep)) { run.push(lines[k].text); k++; }
    if (run.length >= 4 && run.reduce((a, s) => a + s.length, 0) / run.length < 45) { blocks.verse(run); return run.length; }
  }
  blocks.paragraph(text, blocks.para === null);
  return 1;
}

/** The file the store takes (saveCatechismText), as the build script writes it, from a parse and the PDF's name. */
export function catechismFile(parsed, fileName = '') {
  return {
    app: 'nac-study-bible-catechism',
    version: 1,
    edition: parsed.edition,
    language: parsed.language,
    copyright: '© New Apostolic Church International, Zurich. For personal study on this device only.',
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'pdf',
    fileName,
    sections: parsed.sections,
  };
}

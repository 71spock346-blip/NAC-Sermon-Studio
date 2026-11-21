/*
 * The Church's handbooks, read from their own files: the "Guide for
 * Ministers", the "Liturgy of the New Apostolic Church" and the "Serving and
 * Leading" guiding principle, and any booklet built the same way (chapters
 * with headings, paragraphs, lists, the binding words in italics, footnotes).
 *
 * Like the Catechism text and the altar booklet, a handbook is the Church's
 * copyright, so none of it is in the repository or on the site: the minister
 * loads the file once (a PDF, or the text taken out of one), this module
 * reads it on the device itself (no AI, no key), and handbooks.js keeps the
 * result in the `handbooks` store, from where it travels with the sync.
 *
 * Two doors, one road:
 *   fromPages(pages) takes the pages booklet.js readPages() gets from pdf.js
 *     (each piece of text with its place, size and letters, and the small
 *     shapes drawn on the page), and
 *   fromText(text) takes a plain text file, as a PDF reader saves one;
 * both turn the file into lines ({text, runs, x, right, size, bold, italic,
 * bullet, …}), and parse(lines) is the pure part: it drops the page furniture
 * (running heads, page numbers, the table of contents), finds the chapters
 * by their numbers or their large letters, and builds each chapter's blocks.
 *
 * A handbook: {key, language, title, org, edition, pages, words, chapters}
 * A chapter:  {n, title, level, page, blocks}   n: '4.5.1', 'A1' or '' (unnumbered)
 * A block:    {k, d, t}  k: 'p' paragraph, 'h' a heading inside the chapter,
 *             'li' a list item, 'quote' a line of binding or quoted words
 *             (the book's italics), 'note' a footnote; d: depth 0 to 3;
 *             t: runs [[text, style]], style a mix of 'i' italic, 'b' bold,
 *             's' small, 'sup' raised (a footnote mark)
 */

/* ---------------------------------------------------------------- what the handbook is */

/** The handbooks the app knows by name, so an English and an Afrikaans edition share an address, and the title reads well. */
export const KNOWN = [
  ['catechism-qa', /in vrae en antwoorde|in questions and answers|in fragen und antworten/i, 'Catechism in Questions and Answers'],   // read by catq.js, not by parse(): its questions in place of chapters
  ['guide-for-ministers', /guide for ministers|handleiding vir ampsdraers|gids vir ampsdraers|leitfaden f.r amtstr.ger/i, 'Guide for Ministers'],
  ['serving-and-leading', /serving and leading|dien en lei\b|dienen und f.hren/i, 'Serving and Leading'],
  ['liturgy', /liturgy of the new apostolic church|liturgie van die nuwe apostoliese kerk|liturgie der neuapostolischen kirche|^liturgy$|^liturgie$/i, 'Liturgy of the New Apostolic Church'],
];

/** The address of a handbook: a known name, else its title as a slug. */
export function keyOf(title) {
  const hit = KNOWN.find(([, re]) => re.test(title));
  if (hit) return hit[0];
  return String(title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'handbook';
}

/** 'af' when the words are Afrikaans, 'de' for German, else 'en'. */
function languageOf(text) {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) || [];
  let af = 0, en = 0, de = 0;
  for (const w of words) {
    if (w === 'die' || w === 'en' || w === 'van' || w === 'nie' || w === 'wat' || w === 'word' || w === 'het' || w === 'vir') af++;
    else if (w === 'the' || w === 'and' || w === 'of' || w === 'to' || w === 'is' || w === 'in' || w === 'for') en++;
    else if (w === 'und' || w === 'der' || w === 'das' || w === 'ist' || w === 'nicht' || w === 'mit' || w === 'für') de++;
  }
  if (af > en && af > de) return 'af';
  if (de > en && de > af) return 'de';
  return 'en';
}

/** "THE DIVINE SERVICE" → "The divine service"; a title already in mixed case stays as it is. */
function sentenceCase(s) {
  const t = String(s).trim().replace(/\s+/g, ' ');
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const low = t.toLowerCase();
  return low.replace(/(^|[:.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(god|jesus|christ|holy|spirit|apostle|apostles|church|new apostolic|nuwe apostoliese|kerk|gees|here|christus)\b/g, w => w.replace(/\b\p{L}/gu, c => c.toUpperCase()));
}

/* ---------------------------------------------------------------- lines */

const BULLETS = /^([•●▪■‣◦○▫❑⁃])\s*/;
const DASHES = /^([–\-]|o)\s+/;

/** The booklet's own characters in the app's letters: ŉ as ’n, a hard space as a space, a tab as a space. */
function clean(s) {
  return String(s).replace(/ŉ/g, '’n').replace(/[ \t]/g, ' ').replace(/­/g, '').replace(/\s+/g, ' ');
}

const textOf = runs => runs.map(r => r[0]).join('');

/** The most common text size over all pages, weighted by the letters set in it: the size of the body text. */
function bodySizeOf(pages) {
  const weight = new Map();
  for (const p of pages) for (const it of p.items) {
    const k = Math.round(it.size * 2) / 2;
    weight.set(k, (weight.get(k) || 0) + it.str.length);
  }
  let best = 10, n = -1;
  for (const [k, v] of weight) if (v > n) { n = v; best = k; }
  return best;
}

/**
 * The pieces of text of one page grouped into lines, top to bottom, each with
 * its runs in reading order. A raised small piece (a footnote mark) belongs
 * to the line it sits over. {page, y, x, right, size, bold, italic, runs,
 * text, bullet, tx}: `bullet` is the glyph or mark that starts the line, and
 * `tx` where its words start.
 */
function linesOfPage(page, body) {
  const items = page.items.filter(i => i.str.trim()).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rows = [];
  let cur = null;
  for (const it of items) {
    const tol = Math.max(2.5, 0.42 * Math.max(it.size, cur ? cur.size : 0));
    if (!cur || Math.abs(it.y - cur.y) > tol) { cur = { y: it.y, size: it.size, items: [] }; rows.push(cur); }
    cur.items.push(it);
    if (it.size > cur.size) { cur.size = it.size; cur.y = it.y; }
  }
  // a page set in two columns: a row with a wide gap near the middle is two lines, one in each column
  const lines = [];
  for (const r of rows) {
    const its = r.items.sort((a, b) => a.x - b.x);
    let from = 0;
    for (let i = 1; i < its.length; i++) {
      const gap = its[i].x - (its[i - 1].x + its[i - 1].w);
      if (gap >= Math.max(10, 1.4 * r.size) && its[i].x > 0.38 * page.width && its[i].x < 0.62 * page.width && its[i - 1].x + its[i - 1].w < 0.6 * page.width) {
        lines.push({ y: r.y, size: r.size, items: its.slice(from, i) });
        from = i;
      }
    }
    lines.push({ y: r.y, size: r.size, items: its.slice(from) });
  }
  const out = [];
  for (const l of lines) {
    const its = l.items.sort((a, b) => a.x - b.x);
    const main = its.filter(i => i.size >= 0.78 * l.size);
    const runs = [];
    let end = null;
    for (const it of its) {
      const sup = it.size <= 0.75 * l.size && it.y < l.y - 0.1 * l.size;
      const style = (it.italic ? 'i' : '') + (it.bold ? 'b' : '') + (!sup && it.size <= 0.78 * body ? 's' : '') + (sup ? 'sup' : '');
      let text = clean(it.str);
      if (end !== null && it.x - end > 0.12 * it.size && !text.startsWith(' ') && !sup) text = ' ' + text;
      const last = runs[runs.length - 1];
      if (last && last[1] === style) last[0] += text; else runs.push([text, style]);
      end = it.x + it.w;
    }
    if (!runs.length) continue;
    runs[0][0] = runs[0][0].replace(/^\s+/, '');
    runs[runs.length - 1][0] = runs[runs.length - 1][0].replace(/\s+$/, '');
    const kept = runs.filter(r => r[0]);
    if (!kept.length) continue;
    const text = textOf(kept);
    const line = {
      page: page.n, y: l.y, x: its[0].x, right: Math.max(...its.map(i => i.x + i.w)), size: l.size,
      bold: main.length > 0 && main.every(i => i.bold), italic: main.length > 0 && main.every(i => i.italic),
      runs: kept, text, bullet: '', tx: its[0].x,
    };
    // a bullet drawn on the page a little to the left of the line, or set as its first glyph
    const mark = (page.marks || []).find(m => Math.abs(m.y - l.y) <= 0.6 * l.size + 1 && line.x - m.x > 1 && line.x - m.x < 45);
    const glyph = line.text.match(BULLETS);
    if (glyph) {
      line.bullet = glyph[1];
      line.runs[0][0] = line.runs[0][0].slice(glyph[0].length);
      line.runs = line.runs.filter(r => r[0]);
      line.text = textOf(line.runs);
      const first = its.find(i => !BULLETS.test(clean(i.str)) || clean(i.str).replace(BULLETS, '').trim());
      line.tx = first ? first.x + (BULLETS.test(clean(first.str)) ? first.w * (glyph[0].length / Math.max(1, clean(first.str).length)) : 0) : line.x;
    } else if (mark) {
      line.bullet = '■';
    }
    if (!line.text) continue;
    out.push(line);
  }
  return out;
}

/** Is this line only a number (a page number, or the chapter's number on a divider page)? */
const numberOnly = l => /^[\divxlc]{1,4}$/i.test(l.text);

/**
 * The pages of a PDF (booklet.js readPages) as the lines parse() reads:
 * without the running heads, the page numbers and the footers; each line
 * with its place, so that columns, indents and the width of a line are known.
 */
export function fromPages(pages) {
  const body = bodySizeOf(pages);
  const all = pages.map(p => ({ page: p, lines: linesOfPage(p, body) }));
  // a line that repeats on many pages in the top or bottom strip is a running head or foot (counted by its first words: a running head often carries the chapter's name too)
  const seen = new Map();
  const norm = s => s.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#\s]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  const inStrip = (l, page) => l.y < 0.12 * page.height || l.y > 0.9 * page.height;
  for (const { page, lines } of all) {
    const keys = new Set(lines.filter(l => inStrip(l, page)).map(l => norm(l.text)));
    for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const repeats = Math.max(3, Math.ceil(pages.length * 0.15));
  const out = [];
  for (const { page, lines } of all) {
    const kept = lines.filter(l => {
      if (!inStrip(l, page)) return true;
      if (numberOnly(l) && l.size < 1.4 * body) return false;
      if ((seen.get(norm(l.text)) || 0) >= repeats && l.size < 1.4 * body) return false;
      return !(l.size < 0.92 * body && !/^\d/.test(l.text) && l.text.length < 80);   // small type in the strip: a running head or foot
    });
    out.push(...orderOnPage(kept, page, body));
  }
  return { lines: out, body, pages: pages.length, source: 'pdf', width: pages[0] ? pages[0].width : 0 };
}

/**
 * A page's lines in reading order: a page set in two columns is read left
 * column first, then right, the large heading first of all.
 */
function orderOnPage(lines, page, body) {
  const mid = page.width / 2;
  const big = l => l.size >= 1.3 * body;
  const right = lines.filter(l => !big(l) && l.x >= mid - 0.06 * page.width);
  const left = lines.filter(l => !big(l) && l.x < mid - 0.06 * page.width);
  const spans = left.some(l => l.right > mid + 0.08 * page.width);
  const two = right.length >= 3 && left.length >= 3 && !spans;
  for (const l of lines) l.col = two && right.includes(l) ? 1 : 0;
  if (!two) return lines.slice().sort((a, b) => a.y - b.y);
  const heads = lines.filter(big).sort((a, b) => a.y - b.y);
  return [...heads, ...left.sort((a, b) => a.y - b.y), ...right.sort((a, b) => a.y - b.y)];
}

/**
 * A plain text file as the lines parse() reads. A line's place is counted
 * in letters: x is its indent, right its length; the page heads that repeat
 * through the file split it into pages and are dropped.
 */
export function fromText(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n').map(s => s.replace(/\s+$/, ''));
  const norm = s => s.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const count = new Map();
  for (const s of raw) if (s.trim() && s.trim().length < 90) count.set(norm(s), (count.get(norm(s)) || 0) + 1);
  // the head that repeats most begins a page
  let pageHead = null, most = 0;
  for (const [k, n] of count) if (n >= 4 && n > most) { most = n; pageHead = k; }
  // the page's furniture: a line that repeats on most pages AND stands next to the head (the rest of the header, a footer); a heading such as "Procedure" or a footnote like "72 CNAC 12.2.3.2" repeats too, but on a few pages only
  const furniture = new Set();
  const heads = [];
  if (pageHead) {
    const filled = raw.map((s, i) => [s, i]).filter(([s]) => s.trim());
    const near = new Set();
    filled.forEach(([s], j) => { if (norm(s) === pageHead) for (let d = -2; d <= 2; d++) if (filled[j + d]) near.add(filled[j + d][1]); });
    const nearCount = new Map();
    for (const [s, i] of filled) if (near.has(i) && count.has(norm(s))) nearCount.set(norm(s), (nearCount.get(norm(s)) || 0) + 1);
    for (const [k, n] of count) if (n >= Math.max(4, 0.5 * most) && (k === pageHead || (nearCount.get(k) || 0) >= 0.75 * n)) furniture.add(k);
    for (const [s] of filled) if (furniture.has(norm(s)) && !heads.some(h => norm(h) === norm(s))) heads.push(s.trim());
  }
  const lines = [];
  let page = 1, y = 0, blank = true;
  for (const s of raw) {
    const t = s.trim();
    if (!t) { y += 2; blank = true; continue; }
    const k = norm(s);
    if (k === pageHead && lines.length) { page++; y += 2; blank = true; continue; }
    if (furniture.has(k)) continue;
    const indent = s.length - s.replace(/^\s+/, '').length;
    const line = { page, y: (y += 1), x: indent, right: indent + t.length, size: 1, bold: false, italic: false, runs: [[clean(t), '']], text: clean(t), bullet: '', tx: indent, col: 0, afterBlank: blank };
    const glyph = line.text.match(BULLETS) || line.text.match(DASHES);
    if (glyph && (glyph[1] !== 'o' || indent > 0)) {   // a lone "o" is a bullet only when it is set in from the margin
      line.bullet = /[–\-]/.test(glyph[1]) ? '–' : glyph[1] === 'o' ? '◦' : glyph[1];
      line.runs[0][0] = line.runs[0][0].slice(glyph[0].length);
      line.text = textOf(line.runs);
      line.tx = indent + glyph[0].length;
    }
    if (!line.text || /^(photo|foto|picture|bild)\s*\d+\s*[:.]/i.test(line.text)) continue;   // a photo's caption: the photo itself is not in a text file
    blank = false;
    lines.push(line);
  }
  return { lines, body: 1, pages: page, source: 'text', width: 0, heads };
}

/* ---------------------------------------------------------------- the parse */

const ENDED = /[.!?:;”’"')\]]$/;
const HEAD_NUM = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.*)$/;
const TOC_LINE = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(.+?)\s*(?:\.{3,}|…+)\s*\d{1,3}\s*$/;
const APPENDIX = /^(appendix|bylae|bylaag|anhang)(?:\s+(\d{1,2}|[A-Z]))?\s*:?\s*(.*)$/i;

const parts = n => String(n).split('.').map(Number);

/** Does number `n` follow `last` in a book's numbering: the next at some level, or the first beneath it? */
function follows(n, last) {
  const a = parts(n);
  if (!last) return a.length <= 2 && a[0] <= 2;
  const b = parts(last);
  if (a.length === b.length + 1 && a[a.length - 1] === 1 && a.slice(0, -1).every((v, i) => v === b[i])) return true;
  for (let k = 1; k <= b.length; k++) {
    if (a.length === k && a[k - 1] === b[k - 1] + 1 && a.slice(0, k - 1).every((v, i) => v === b[i])) return true;
  }
  return false;
}

/** The table of contents a text file carries (lines with dot leaders): number → title, for telling a heading from a number that starts a line. */
function tocOf(lines) {
  const toc = new Map();
  for (const l of lines) {
    const m = l.text.match(TOC_LINE);
    if (m) toc.set(m[1], m[2].trim());
  }
  return toc;
}

const firstWords = (s, n) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, n).join(' ');

/**
 * Is this page a table of contents: most of its lines end in a page number,
 * or are a bare number (a contents set in columns)?
 */
function contentsPages(lines, source) {
  const byPage = new Map();
  for (const l of lines) { if (!byPage.has(l.page)) byPage.set(l.page, []); byPage.get(l.page).push(l); }
  const toc = new Set();
  for (const [p, ls] of byPage) {
    if (ls.length < 4) continue;
    const ending = ls.filter(l => /\s\d{1,3}$/.test(l.text) || numberOnly(l) || /^\d{1,2}(\.\d{1,2}){0,3}$/.test(l.text) || TOC_LINE.test(l.text)).length;
    const named = ls.some(l => /^(table of )?contents?$|^inhoud(sopgawe)?$|^inhalt(sverzeichnis)?$/i.test(l.text));
    if (ending >= 0.6 * ls.length || (named && ending >= 0.4 * ls.length) || (source === 'text' && ls.filter(l => TOC_LINE.test(l.text)).length >= 0.5 * ls.length)) toc.add(p);
  }
  return toc;
}

/**
 * The handbook from its lines (fromPages or fromText): its title and the
 * lines about it from the front pages, then its chapters with their blocks.
 * Throws when no chapter is found.
 */
export function parse(input) {
  const { lines, body, source } = input;
  const pdf = source === 'pdf';
  const toc = tocOf(lines);
  const skipPages = contentsPages(lines, source);
  const content = lines.filter(l => !skipPages.has(l.page) && !TOC_LINE.test(l.text));
  const geometry = measure(content, body, pdf);

  const chapters = [];
  const front = [];      // the lines before the first chapter: the cover, the imprint
  let chapter = null;
  let last = null;       // the last numbered heading
  let pending = null;    // a divider page's heading, waiting for the page after it
  let epigraph = [];     // a divider page's quotation, set at the head of the chapter it opens
  const byPage = new Map();
  for (const l of content) { if (!byPage.has(l.page)) byPage.set(l.page, []); byPage.get(l.page).push(l); }

  const open = (n, title, level, page) => {
    chapter = { n, title: sentenceCase(title), level, page, blocks: [] };
    if (epigraph.length) { chapter.blocks.push(...epigraph); epigraph = []; }
    chapters.push(chapter);
    if (n && /^\d/.test(n)) last = n;
  };

  for (const [page, ls] of byPage) {
    // the cover of a PDF: its words say what the book is, and open no chapter; the back cover (an address, a web address) is nothing to read
    if (pdf && page === 1 && input.pages > 2) { front.push(...ls); continue; }
    // the half-title page: the cover's words again, nothing else
    if (pdf && !chapters.length && page <= 3 && ls.length <= 6 && sameWords(ls.map(l => l.text).join(' '), coverTitle(front))) { front.push(...ls); continue; }
    if (pdf && page === input.pages && input.pages > 2 && ls.length <= 8 && !ls.some(l => l.size >= 1.2 * body) && ls.some(l => /www\.|\.org|\.com|strasse|street|\d{4}\s+\p{Lu}/u.test(l.text))) continue;
    // a divider page: a few lines, one of them very large (the chapter's name), perhaps its number alone
    if (pdf && chapters.length + front.length > 0 && ls.length <= 8 && ls.some(l => l.size >= 1.8 * body)) {
      const numbered = l => l.size >= 1.4 * body && /^x*\s*\d{1,2}\s*x*$/i.test(l.text);
      const quoted = l => l.italic || /^[“"]|[”"]$/.test(l.text);
      const big = ls.filter(l => l.size >= 1.8 * body && !/^x+$/i.test(l.text) && !numberOnly(l) && !numbered(l) && !quoted(l));
      const num = ls.find(numbered);
      const n = num ? num.text.replace(/[^\d]/g, '') : '';
      const rest = ls.filter(l => !big.includes(l) && l !== num && !/^x+$/i.test(l.text) && !numberOnly(l));
      if (big.length || rest.some(quoted)) {
        if (big.length) pending = { n: n && (follows(n, last) || !last) ? n : '', title: big.map(l => l.text).join(' '), page };
        epigraph = rest.map(l => ({ k: quoted(l) ? 'quote' : 'p', d: 0, t: l.runs.map(r => [r[0], r[1]]) }));
        continue;
      }
    }
    const notes = footnotesOf(ls, body, pdf);
    const main = ls.filter(l => !notes.lines.has(l));
    let prev = null;
    for (let i = 0; i < main.length; i++) {
      const l = main[i];
      const head = headingOf(l, main[i + 1], { last, toc, body, pdf, chapters, prev, geometry });
      if (head && pdf && !chapters.length && page <= 3 && !head.n && sameWords(head.title, coverTitle(front))) {
        // the half-title page repeats the cover: still the front of the book
        if (head.skip) i++;
        front.push(l);
        continue;
      }
      if (head) {
        if (head.skip) i++;
        if (pending) { open(pending.n, pending.title, 1, pending.page); pending = null; if (!head.n && head.level === 1 && head.title.toLowerCase() === chapter.title.toLowerCase()) { prev = null; continue; } }
        open(head.n, head.title, head.level, l.page);
        prev = null;
        continue;
      }
      if (pending) { open(pending.n, pending.title, 1, pending.page); pending = null; }
      if (!chapter) { front.push(l); continue; }
      if (!pdf && /^A/.test(chapter.n) && !l.bullet) {
        // a table in an appendix (the competency profiles): a numbered row's label, on its own over a second word, or glued to the row's text
        const next = main[i + 1];
        const label = l.text.match(/^\d{1,2}\s+(\p{Lu}[\p{Ll}-]*(?:\s+[\p{Ll}-]+)?)$/u);
        if (label && next && !next.bullet && next.page === l.page && next.text.length <= 30 && /^\p{Ll}/u.test(next.text)) {
          chapter.blocks.push({ k: 'h', d: 0, t: [[label[1] + ' ' + next.text, '']] });
          i++; prev = next;
          continue;
        }
        const glued = l.text.match(/^\d{1,2}\s+(\p{Lu}[\p{Ll}-]*(?:\s+[\p{Ll}-]+)?)\s+(\p{Lu}.{20,})$/u);
        if (glued) {
          chapter.blocks.push({ k: 'h', d: 0, t: [[glued[1], '']] });
          const at = l.text.length - glued[2].length;
          const rest = { ...l, text: glued[2], runs: sliceRuns(l.runs, at) };   // the row's text starts at the margin, as its next lines do
          addLine(chapter.blocks, rest, null, { geometry, body, pdf, toc });
          prev = rest;
          continue;
        }
      }
      addLine(chapter.blocks, l, prev, { geometry, body, pdf, toc, next: main[i + 1] });
      prev = l;
    }
    if (chapter && notes.blocks.length) chapter.blocks.push(...notes.blocks);
    else if (!chapter) front.push(...notes.lines);
  }
  if (pending) open(pending.n, pending.title, 1, pending.page);
  if (!chapters.length) throw new Error('no chapters');
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i], next = chapters[i + 1];
    if (c.n || c.level !== 1 || !next || !/^\d+\.1$/.test(next.n)) continue;
    const before = chapters.slice(0, i).map(x => x.n).filter(x => /^\d/.test(x)).pop();
    const k = parts(next.n)[0];
    if (!before || parts(before)[0] + 1 === k) c.n = String(k);
  }

  const frontText = front.map(l => l.text).join('\n');
  const meta = frontMatter(front, lines, body, pdf, input.heads || []);
  const everything = [frontText, ...chapters.map(c => c.title + '\n' + c.blocks.map(b => textOf(b.t)).join('\n'))].join('\n');
  const known = KNOWN.find(([, re]) => re.test(meta.title) || re.test(frontText.replace(/\s+/g, ' ')) || (lines[0] && re.test(lines.slice(0, 12).map(l => l.text).join(' '))));
  const title = known ? known[2] : meta.title;
  const words = everything.split(/\s+/).filter(Boolean).length;
  return {
    key: known ? known[0] : keyOf(title),
    language: languageOf(everything),
    title, ownTitle: meta.title, org: meta.org, edition: meta.edition,
    pages: input.pages, words, chapters,
  };
}

/** The width and the indents of the columns, so a full line and a deeper line can be told. */
function measure(lines, body, pdf) {
  const g = { cols: [] };
  for (const col of [0, 1]) {
    const ls = lines.filter(l => l.col === col && (!pdf || (l.size >= 0.9 * body && l.size <= 1.25 * body)));
    if (!ls.length) { g.cols.push(null); continue; }
    const rights = ls.map(l => l.right).sort((a, b) => a - b);
    const right = rights[Math.min(rights.length - 1, Math.floor(rights.length * 0.95))];
    const xs = ls.map(l => l.x).sort((a, b) => a - b);
    const x = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.02))];
    // the indents in use, clustered, so that each is a depth
    const steps = [];
    for (const l of ls) {
      const d = (l.bullet ? l.x : l.x) - x;
      if (d < (pdf ? 3 : 1)) continue;
      const near = steps.find(s => Math.abs(s - d) <= (pdf ? 4 : 1));
      if (!near) steps.push(d);
    }
    steps.sort((a, b) => a - b);
    const justified = pdf && ls.filter(l => l.right >= right - 1.5).length >= 0.4 * ls.filter(l => l.right >= right - 0.12 * (right - x)).length;
    g.cols.push({ x, right, width: right - x, steps, justified });
  }
  return g;
}

/** How deep a line sits: 0 at the column's left, else the index of its indent among the indents in use. */
function depthOf(l, g, pdf) {
  const c = g.cols[l.col] || g.cols[0];
  if (!c) return 0;
  const d = l.x - c.x;
  if (d < (pdf ? 3 : 1)) return 0;
  const i = c.steps.findIndex(s => Math.abs(s - d) <= (pdf ? 4 : 1));
  return Math.min(3, (i < 0 ? c.steps.filter(s => s < d).length : i) + 1);
}

/**
 * Is the line a chapter heading: a numbered one that follows the book's
 * numbering (or that the table of contents lists), a large unnumbered one,
 * or an appendix? Returns {n, title, level, skip} or null; `skip` says the
 * next line is the rest of the title.
 */
function headingOf(l, next, ctx) {
  const { last, toc, body, pdf, chapters, prev, geometry } = ctx;
  if (l.bullet) return null;
  const text = spoken(l.runs).trim();
  const big = pdf && l.size >= 1.2 * body;
  const strong = pdf ? (l.bold || big) : true;
  const m = text.match(HEAD_NUM);
  if (m && strong) {
    const n = m[1], title = m[2].trim();
    const listed = toc.get(n);
    const titleFits = listed ? firstWords(listed, 2) === firstWords(title, 2) : true;
    const inOrder = follows(n, last);
    const letters = /\p{L}/u.test(title) && title.length <= 120 && !/[.!?]$/.test(title);
    const headingLike = letters && title.length <= 70 && !/[.!?:;”’"]$/.test(title);
    // in a text file every line looks alike: with a table of contents the number must be listed there (or follow under a listed one, a level the contents leave out), without one it must follow in order and the line must read like a heading
    const underListed = parts(n).length >= 2 && toc.has(parts(n).slice(0, -1).join('.'));
    const sameParent = last && parts(n).length === parts(last).length && parts(n).slice(0, -1).join('.') === parts(last).slice(0, -1).join('.') && parts(n).pop() > parts(last).pop();
    const ok = pdf
      ? (inOrder || (listed && titleFits)) && (letters || (listed && titleFits))
      : (toc.size ? (listed ? titleFits : (inOrder || sameParent) && headingLike && underListed) : inOrder && headingLike);
    if (ok) {
      let full = title, skip = false;
      if (listed && next && !next.bullet && listed.length > title.length + 3 && firstWords(listed, 20).startsWith(firstWords(title + ' ' + next.text, 20).slice(0, Math.min(40, firstWords(title + ' ' + next.text, 20).length)))) { full = title + ' ' + next.text; skip = true; }
      return { n, title: full, level: Math.min(4, parts(n).length), skip };
    }
  }
  const ap = text.match(APPENDIX);
  if (ap && strong && (pdf ? true : !ENDED.test(text) || /:$/.test(text)) && text.length < 90 && chapters.length) {
    let title = ap[3] ? text : text, skip = false;
    if (!ap[3] && next && !next.bullet && next.text.length < 90 && !ENDED.test(next.text) && !HEAD_NUM.test(next.text)) { title = text + ': ' + next.text; skip = true; }
    return { n: 'A' + (ap[2] || chapters.filter(c => /^A/.test(c.n)).length + 1), title, level: 1, skip };
  }
  if (big && text.length <= 100 && !/[.!?]$/.test(text)) {
    let title = text, skip = false;
    if (next && next.page === l.page && next.size >= 1.2 * body && Math.abs(next.size - l.size) < 0.5 && next.y - l.y <= 1.6 * l.size && next.y > l.y && !HEAD_NUM.test(next.text)) { title = text + ' ' + next.text; skip = true; }
    return { n: '', title, level: 1, skip };
  }
  return null;
}

/** A line that reads like a heading inside the chapter: bold, short, not a sentence; in a text file, a short line over a paragraph. */
function subheading(l, next, prev, pdf) {
  const text = l.text;
  if (l.bullet || text.length > 70) return false;
  if (pdf) {
    if (l.bold) return !l.italic && !/[.!?;,]$/.test(text) && (!prev || !prev.bold || prev.y !== l.y);
    // a plain short line standing alone between two paragraph gaps, over a paragraph (the Liturgy's blue labels: "Sermon")
    const gapBefore = !prev || prev.page !== l.page || l.y - prev.y > 1.65 * Math.max(prev.size, l.size);
    const gapAfter = next && next.page === l.page && next.y - l.y > 1.65 * Math.max(next.size, l.size) && !next.bullet;
    return !l.italic && text.length <= 60 && /^\p{Lu}/u.test(text) && !/[.!?;,:]$/.test(text) && gapBefore && gapAfter && (next.text.length >= 50 || /[.!?]$/.test(next.text));
  }
  if (text.length > 45 || /[.!?;,]$/.test(text) || !/^\p{Lu}/u.test(text)) return false;
  if (!next || next.bullet || next.text.length < 60 || next.page !== l.page) return false;
  return !prev || ENDED.test(prev.text) || prev.text.length < 45 || l.afterBlank;
}

/** A footnote's mark in a text file: a number glued to a word or a sentence end ("ministry89", "us!1"); a number after a number's dot (2.1, CNAC 12.2.3.2) is not one. */
const MARK = /(?<=[\p{L}!?,;:)”’]|(?<![\d.])\.)(\d{1,3})(?=[\s,.;:)]|$)/gu;

/** The footnotes at the foot of a page: {lines: Set, blocks}. In a PDF they are the small lines low on the page; in a text file, the lines at the end that begin with a mark the page's own text carries. */
function footnotesOf(ls, body, pdf) {
  const lines = new Set();
  const blocks = [];
  const pageText = ls.map(l => l.text).join('\n');
  if (pdf) {
    const small = ls.filter(l => l.size <= 0.78 * body && !l.bullet);
    for (const l of small) {
      if (/^\d{1,3}\s*\S/.test(l.text) || (blocks.length && lines.size)) {
        const m = l.text.match(/^(\d{1,3})\s*(.*)$/);
        if (m && !(blocks.length && !/^\d{1,3}\s+\S/.test(l.text))) blocks.push({ k: 'note', d: 0, t: [[m[1], 'sup'], [' ' + m[2], '']] });
        else if (blocks.length) joinInto(blocks[blocks.length - 1], l.runs);
        else continue;
        lines.add(l);
      }
    }
    return { lines, blocks };
  }
  // text: a mark is a number glued to a word ("ministry89", "us!1"); the notes stand last on the page
  const marks = new Set();
  for (const m of pageText.matchAll(MARK)) marks.add(m[1]);
  if (!marks.size) return { lines, blocks };
  let start = -1;
  for (let i = Math.max(0, Math.floor(ls.length * 0.5)); i < ls.length; i++) {
    const m = ls[i].text.match(/^(\d{1,3})\s+\S/);
    if (m && marks.has(m[1]) && !ls[i].bullet) { start = i; break; }
  }
  if (start < 0) return { lines, blocks };
  for (let i = start; i < ls.length; i++) {
    const l = ls[i];
    const m = l.text.match(/^(\d{1,3})\s+(.*)$/);
    if (m && marks.has(m[1])) blocks.push({ k: 'note', d: 0, t: [[m[1], 'sup'], [' ' + m[2], '']] });
    else if (blocks.length) joinInto(blocks[blocks.length - 1], l.runs);
    lines.add(l);
  }
  // the marks in the page's words become raised figures
  const nums = [...marks].filter(n => blocks.some(b => b.t[0][0] === n));
  if (nums.length) {
    const re = new RegExp(MARK.source.replace('\\d{1,3}', nums.join('|')), 'gu');
    for (const l of ls) {
      if (lines.has(l)) continue;
      const out = [];
      for (const [text, style] of l.runs) {
        let at = 0;
        for (const m of text.matchAll(re)) {
          if (m.index > at) out.push([text.slice(at, m.index), style]);
          out.push([m[1], style + 'sup']);
          at = m.index + m[1].length;
        }
        if (at < text.length) out.push([text.slice(at), style]);
      }
      if (out.length) { l.runs = out; l.text = textOf(out.filter(r => !r[1].includes('sup'))); }
    }
  }
  return { lines, blocks };
}

/** The runs from a character position on. */
function sliceRuns(runs, at) {
  const out = [];
  let pos = 0;
  for (const [text, style] of runs) {
    if (pos + text.length > at) out.push([text.slice(Math.max(0, at - pos)), style]);
    pos += text.length;
  }
  return out.length ? out : [['', '']];
}

/** Appends a line's runs to a block: with a space, or across a word broken at the end of the line. */
function joinInto(block, runs, how = ' ') {
  if (!runs.length) return;
  const segs = runs.map(r => [r[0], r[1]]);
  const last = block.t[block.t.length - 1];
  if (last && how === '-') last[0] = last[0].replace(/[-‐]$/, '');
  else if (last && how === ' ') {
    if (last[1] === segs[0][1]) last[0] += ' '; else segs[0][0] = ' ' + segs[0][0];
  }
  for (const s of segs) {
    const l = block.t[block.t.length - 1];
    if (l && l[1] === s[1]) l[0] += s[0]; else block.t.push([s[0], s[1]]);
  }
}

/** The runs with any raised marks taken out: the words as read. */
const spoken = runs => runs.filter(r => !r[1].includes('sup')).map(r => r[0]).join('');

/**
 * Puts one line into the chapter's blocks: on to the block before it when
 * the two belong together, else as a new block of its kind.
 */
function addLine(blocks, l, prev, { geometry, body, pdf, toc, next }) {
  const last = blocks[blocks.length - 1];
  const col = geometry.cols[l.col] || geometry.cols[0] || { x: 0, right: 100, width: 100, steps: [], justified: false };
  const tight = prev && prev.page === l.page && prev.col === l.col && (pdf ? l.y - prev.y <= 1.65 * Math.max(prev.size, l.size) && l.y > prev.y - 1 : l.y - prev.y <= 1);
  const text = l.text;
  const prevText = prev ? spoken(prev.runs) : '';
  const endedPrev = ENDED.test(prevText);
  const fullPrev = prev && (pdf ? prev.right >= col.right - 0.08 * col.width : prev.right >= 0.85 * col.right);
  const kind = l.bullet ? 'li' : (l.italic && pdf) || (!pdf && /^[“"].*[”"]$/.test(text) && !/[”"].+[“"]/.test(text)) ? 'quote' : subheading(l, next, prev, pdf) && !(last && last.k === 'p' && tight && !endedPrev) ? 'h' : 'p';

  // a word broken at the end of the line before: "motiva-" + "tion", or the hyphen the PDF dropped (a justified line that stops a little short)
  const broken = prev && tight && last && last.k !== 'note' && /^[\p{Ll}]/u.test(text) && (
    (/[\p{L}][-‐]$/u.test(prevText) && !/\s[-‐]$/.test(prevText))
    || (pdf && col.justified && /\p{L}$/u.test(prevText) && col.right - prev.right > 1.5 && col.right - prev.right < 0.6 * prev.size)
  );
  if (broken && (last.k === 'p' || last.k === 'li' || last.k === 'quote' || last.k === 'h')) {
    joinInto(last, l.runs, /[-‐]$/.test(prevText) ? '-' : '');
    return;
  }
  if (kind === 'h' && last && last.k === 'h' && tight && !/:$/.test(prevText) && pdf) {
    joinInto(last, l.runs);
    return;
  }
  if (kind === 'li') {
    blocks.push({ k: 'li', d: Math.max(1, listDepth(l, col, pdf)), t: l.runs.map(r => [r[0], r[1]]), tx: l.tx });
    return;
  }
  if (kind === 'quote') {
    blocks.push({ k: 'quote', d: depthOf(l, geometry, pdf), t: l.runs.map(r => [r[0], r[1]]) });
    return;
  }
  if (kind === 'h') {
    blocks.push({ k: 'h', d: 0, t: l.runs.map(r => [r[0], r[1]]) });
    return;
  }
  // a paragraph line: on to a list item whose words it lines up with, or on to the paragraph before it
  if (last && tight && last.k === 'li' && (pdf ? Math.abs(l.x - last.tx) <= 6 : (!endedPrev || fullPrev) && l.x <= last.tx + 2 && prevText.length >= 0.55 * col.right)) {
    joinInto(last, l.runs);
    return;
  }
  if (last && tight && last.k === 'p' && last.d === depthOf(l, geometry, pdf) && !l.bold === !prev.bold) {
    // justified text: a paragraph's last line stops short and ends its sentence; ragged text: only the gap between the lines tells
    const goesOn = pdf
      ? (col.justified ? (!endedPrev || fullPrev) : !/:$/.test(prevText))
      : (prev.right >= 0.85 * col.right || (!endedPrev && prev.right >= 0.55 * col.right)) && !(endedPrev && prev.right < 0.95 * col.right && /^[\p{Lu}“"(]/u.test(text));
    if (goesOn) { joinInto(last, l.runs); return; }
  }
  if (last && tight && last.k === 'quote' && !pdf) { /* text files carry no italics: nothing to go on with */ }
  blocks.push({ k: 'p', d: depthOf(l, geometry, pdf), t: l.runs.map(r => [r[0], r[1]]) });
}

/** How deep a list item sits: by its indent among the column's indents, and a dash under a bullet one deeper. */
function listDepth(l, col, pdf) {
  const d = l.x - col.x;
  let i = col.steps.findIndex(s => Math.abs(s - d) <= (pdf ? 4 : 1));
  if (i < 0) i = col.steps.filter(s => s < d).length - 1;
  let depth = Math.max(0, i) + (d >= (pdf ? 3 : 1) ? 1 : 0) + (l.bullet === '–' || l.bullet === '◦' ? 1 : 0);
  return Math.min(3, Math.max(1, depth));
}

const sameWords = (a, b) => a && b && a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The cover's title so far: the largest lines on the first page that holds any. */
function coverTitle(front) {
  if (!front.length) return '';
  const top = Math.max(...front.map(l => l.size));
  const page = front.find(x => x.size >= top - 0.5).page;
  return front.filter(l => l.size >= 0.8 * top && l.page === page).map(l => l.text).join(' ');
}

/** The title, the Church's name and the edition, from the pages before the first chapter. */
function frontMatter(front, lines, body, pdf, heads = []) {
  const texts = front.map(l => l.text);
  const church = /new apostolic church|nuwe apostoliese kerk|neuapostolische kirche/i;
  const about = s => church.test(s) || /international|internasionaal|©|copyright|www\.|all rights/i.test(s);
  let title = pdf ? coverTitle(front) : '';
  if (!title) {
    // a text file: the short lines at the head of the first page that are not the Church's name, together ("Guide for" + "Ministers")
    const first = front.length ? front[0].page : 0;
    const head = [];
    for (const l of front.filter(l => l.page === first && !about(l.text))) {
      if (!(/\p{L}{3}/u.test(l.text) && l.text.length < 40 && l.text.split(/\s+/).length <= 4 && !/[.!?:]$/.test(l.text))) { if (head.length) break; continue; }
      head.push(l.text);
      if (head.length === 3) break;
    }
    title = head.join(' ') || texts.find(s => /\p{L}{3}/u.test(s) && !about(s)) || texts[0] || (lines[0] ? lines[0].text : '');
  }
  const org = texts.find(s => /^©/.test(s) && church.test(s) && s.length < 80)
    || texts.find(s => church.test(s) && /international|internasionaal/i.test(s) && s.length < 80)
    || texts.find(s => church.test(s) && s.length < 80 && !sameWords(s, title)) || '';
  const pool = [...texts, ...heads.map(s => s.replace(/\s*(page|bladsy|seite)\s+\d+\s+(of|van|von)\s+\d+\s*$/i, '').replace(/^.*?(?=current as of|version|stand)/i, ''))].filter(s => s.length < 80 && !/king james|bible/i.test(s));
  const edition = pool.find(s => /\b(edition|current as of|uitgawe|weergawe|auflage|stand)\b/i.test(s))
    || pool.find(s => /\b(version|weergawe)\b/i.test(s))
    || ((texts.find(s => /©\s*\d{4}/.test(s)) || '').match(/©\s*\d{4}/) || [''])[0];
  return { title: sentenceCase(title.replace(/\s+/g, ' ').trim()).slice(0, 120), org: sentenceCase(org.replace(/^©\s*(\d{4}\s*)?/, '').replace(/[.,;]\s*$/, '')), edition: edition.replace(/^©\s*/, '© ').trim() };
}

/* ---------------------------------------------------------------- reading and searching */

/**
 * The number a chapter goes by: its own (4.5.1), or the one its title opens
 * with where the book gives a chapter no number of its own (the Liturgy
 * book's "2.1 Word service"); '' for a chapter without one, an appendix
 * (A1) or the Catechism's introduction. In a title only a number with a
 * point counts: "1 Corinthians 13" is a title, not chapter 1.
 */
export function numberOf(c) {
  if (c.n) return /^\d/.test(c.n) ? c.n : '';
  const m = String(c.title || '').match(/^(\d+(?:\.\d+)+)\.?\s/);
  return m ? m[1] : '';
}

/**
 * The chapters under a chapter, at every depth, in the book's order: 4.5.1
 * to 4.5.4 under 4.5, and "2.1 Word service" under 2. For printing a chapter
 * with all that belongs to it (handbook-pdf.js).
 */
export function chaptersUnder(chapters, c) {
  const kids = c.n ? chapters.filter(x => x.parent === c.n && x !== c) : [];   // the questions of a chapter of the Catechism in questions and answers (catq.js)
  if (kids.length) return kids;
  const n = numberOf(c);
  return n ? chapters.filter(x => x !== c && numberOf(x).startsWith(n + '.')) : [];
}

/** A chapter's number as the book prints it: a question of the Catechism in questions and answers by its own number (108, not q108). */
const shownNumber = c => (c.qn != null ? String(c.qn) : c.n || '');

/** Every word of a chapter, for a search and for Claude: the title, then each block as one line. */
export function plainText(chapter) {
  const out = [(shownNumber(chapter) ? shownNumber(chapter) + ' ' : '') + chapter.title];
  for (const b of chapter.blocks) out.push((b.k === 'li' ? '- ' : b.k === 'note' ? '[' : '') + spoken(b.t) + (b.k === 'note' ? ']' : ''));
  return out.join('\n');
}

/** The chapters a word search finds in some handbooks: [{handbook, chapter, snippet, inTitle}], the title hits first. */
export function search(handbooks, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const hb of handbooks) {
    for (const c of hb.chapters) {
      const title = ((shownNumber(c) ? shownNumber(c) + ' ' : '') + c.title).toLowerCase();
      if (words.length === 1 && c.qn != null && words[0] === String(c.qn)) { hits.push({ handbook: hb, chapter: c, inTitle: true, exact: true }); continue; }   // "108": question 108
      if (words.every(w => title.includes(w))) { hits.push({ handbook: hb, chapter: c, inTitle: true }); continue; }
      const body = c.blocks.map(b => spoken(b.t)).join(' ');
      const low = body.toLowerCase();
      if (!words.every(w => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      const from = Math.max(0, body.lastIndexOf(' ', Math.max(0, at - 60)) + 1);
      const to = Math.min(body.length, at + words[0].length + 110);
      hits.push({ handbook: hb, chapter: c, snippet: (from > 0 ? '…' : '') + body.slice(from, to).trim() + (to < body.length ? '…' : '') });
    }
  }
  return hits.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0));
}

/** The chapters that answer a question best, by how many of its words each carries: [{handbook, chapter, score}], at most `max`. */
/* The Church's words an Afrikaans question is likely to carry, with their English: the handbooks and the Catechism are in English, so these words find the chapters too. */
const AF_EN = {
  doop: 'baptism', gedoop: 'baptised', verseëling: 'sealing', verseël: 'sealing', nagmaal: 'communion', sakrament: 'sacrament', sakramente: 'sacraments',
  gebed: 'prayer', bid: 'pray', sonde: 'sin', sondes: 'sins', vergifnis: 'forgiveness', vergewing: 'forgiveness', vergewe: 'forgive',
  amp: 'ministry', ampte: 'ministries', ampsdraer: 'minister', ampsdraers: 'ministers', bedienaar: 'minister', apostel: 'apostle', apostels: 'apostles',
  gemeente: 'congregation', kerk: 'church', geloof: 'faith', glo: 'believe', wederkoms: 'return', opstanding: 'resurrection', dood: 'death', sterf: 'die',
  begrafnis: 'funeral', huwelik: 'marriage', troue: 'wedding', seën: 'blessing', seëning: 'blessing', kinders: 'children', kind: 'child', preek: 'sermon',
  erediens: 'divine service', godsdiens: 'divine service', bybel: 'bible', gees: 'spirit', heilige: 'holy', ontslapenes: 'departed', afgestorwenes: 'departed',
  bevestiging: 'confirmation', hemel: 'heaven', engel: 'angel', engele: 'angels', skepping: 'creation', priester: 'priest', priesters: 'priests',
  diaken: 'deacon', evangelis: 'evangelist', herder: 'shepherd', ouderling: 'elder', lyding: 'suffering', genade: 'grace', verlossing: 'redemption', liefde: 'love', hoop: 'hope',
  gebooie: 'commandments', gebod: 'commandment', belydenis: 'confession', bely: 'confess', jeug: 'youth', sieke: 'sick', siekes: 'sick', offer: 'offering', offers: 'offerings',
};

export function relevant(handbooks, question, max = 12) {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'what', 'how', 'do', 'does', 'i', 'my', 'for', 'on', 'with', 'be', 'it', 'this', 'that', 'can', 'should', 'when', 'who', 'die', 'en', 'van', 'wat', 'hoe', 'is', 'moet', 'kan', 'ek', 'my', 'n', 'vir', 'om', 'te', 'nie']);
  const asked = String(question || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
  const words = [...new Set(asked.flatMap(w => (AF_EN[w] ? [w, ...AF_EN[w].split(' ')] : [w])))];   // an Afrikaans word brings its English along
  if (!words.length) return [];
  const stems = words.map(w => w.replace(/(ing|ers|er|es|s|ed|ly)$/i, '')).filter(w => w.length > 2);
  const scored = [];
  for (const hb of handbooks) {
    for (const c of hb.chapters) {
      const text = plainText(c).toLowerCase();
      let score = 0;
      for (const w of stems) {
        const n = text.split(w).length - 1;
        if (n) score += 1 + Math.min(4, n) * 0.25 + (((shownNumber(c) ? shownNumber(c) + ' ' : '') + c.title).toLowerCase().includes(w) ? 2 : 0);
      }
      if (score) scored.push({ handbook: hb, chapter: c, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

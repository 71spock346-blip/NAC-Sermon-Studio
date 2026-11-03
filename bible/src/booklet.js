/*
 * The Church's altar booklet: "Liturgy for Altar Use" ("Liturgie vir Altaar
 * Gebruik"), the cards of the New Apostolic Church Cape with the words said
 * at the altar in the divine service and in each act of blessing.
 *
 * The booklet is the Church's own text, like the Catechism and the Guides,
 * so it is not in the repository or on the site. The minister loads its PDF
 * once; this module reads the PDF on the device itself (no AI, no key) into
 * the rows the Liturgy tab shows (liturgy.js), which keeps them in the
 * `liturgy` store, from where they travel with the sync.
 *
 * readPages(pdfjs, data) has pdf.js read a PDF into pages: every piece of
 * text with its place and its letters, and the dotted rules between the
 * rows. parse(pages) is a pure function: from those pages it builds the
 * booklet, one card per rite (a page heading: DIVINE SERVICE, HOLY BAPTISM),
 * each a list of rows as the booklet prints them, the label in the left
 * column and in the right the words to say, with the booklet's notes in
 * small italics and its lists. tools/test_booklet.mjs runs both on a PDF in
 * Node, without a browser.
 *
 * A booklet:  {language, cover, org, pages, cards: [card]}
 * A card:     {key, title, rows: [row]}         key: 'divine-service', 'baptism', …
 * A row:      {label, sub: [line], blocks: [block]}
 * A block:    {k: 'p' | 'note' | 'li', d: depth, t: [[text, style], …]}
 *             style: '' plain, 'i' italic, 's' small, 'is' small italic
 */

/* ---------------------------------------------------------------- reading the PDF */

/** Multiplies two PDF matrices [a, b, c, d, e, f] (the second applied first). */
const mul = (m, t) => [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];

/**
 * The dotted rules of a page, as distances from its top: every long,
 * horizontal line drawn on the page. When some of them are dashed (the
 * booklet's dots), only those count, so a solid line elsewhere is not taken
 * for one.
 */
function rulesOf(OPS, ops, width, height) {
  const found = [];
  let ctm = [1, 0, 0, 1, 0, 0], dashed = false;
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const a = ops.argsArray[i];
    switch (ops.fnArray[i]) {
      case OPS.save: stack.push(ctm); break;
      case OPS.restore: ctm = stack.pop() || ctm; break;
      case OPS.transform: if (a && a.length === 6) ctm = mul(ctm, a); break;
      case OPS.setDash: dashed = !!(a && a[0] && a[0].length); break;
      case OPS.constructPath: {
        const box = a && a[2];   // [minX, minY, maxX, maxY] of the path, before the transform
        if (!box || box.length < 4) break;
        const x0 = box[0], y0 = box[1], x1 = box[2], y1 = box[3];
        if (Math.abs(y1 - y0) > 0.5 || Math.abs(x1 - x0) < width / 4) break;
        found.push({ y: height - (ctm[1] * x0 + ctm[3] * y0 + ctm[5]), dashed });
        break;
      }
      default: break;
    }
  }
  const keep = found.some(r => r.dashed) ? found.filter(r => r.dashed) : found;
  const rules = [];
  for (const r of keep) if (!rules.some(y => Math.abs(y - r.y) < 2)) rules.push(r.y);
  return rules.sort((p, q) => p - q);
}

/**
 * Reads a PDF (its bytes as a Uint8Array) with pdf.js into pages:
 * [{n, width, height, items, rules}], each item a piece of text with its
 * place from the top left ({str, x, y, w, size, italic}), the rules the
 * distances from the top of the dotted lines. `pdfjs` is the pdf.js module
 * (vendor/pdfjs/pdf.min.mjs), with its worker already set up by the caller;
 * onPage(n, total), when given, is called as each page is begun.
 */
export async function readPages(pdfjs, data, onPage) {
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (onPage) onPage(n, doc.numPages);
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const ops = await page.getOperatorList();   // also brings the fonts over, so their names can be read
      const names = {};
      const nameOf = id => {
        if (!(id in names)) {
          let f = null;
          try { f = page.commonObjs.get(id); } catch (e) { f = null; }
          names[id] = ((f && f.name) || '').replace(/^[A-Z]{6}\+/, '');   // without the subset tag: ABCDEF+HelveticaNeue-Italic
        }
        return names[id];
      };
      const items = [];
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const m = it.transform;
        items.push({ str: it.str, x: m[4], y: vp.height - m[5], w: it.width, size: Math.hypot(m[0], m[1]), italic: /italic|oblique|it(mt)?$/i.test(nameOf(it.fontName)) });
      }
      pages.push({ n, width: vp.width, height: vp.height, items, rules: rulesOf(pdfjs.OPS, ops, vp.width, vp.height) });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/* ---------------------------------------------------------------- the text */

const HEADER = 110;   // the heading and the Church's name sit above this line; the rows start under it

/** The booklet's own characters in the app's letters: ŉ as ’n, a hard space as a space. */
function clean(s) {
  return String(s).replace(/ŉ/g, '’n').replace(/ /g, ' ').replace(/\s+/g, ' ');
}

/** The pieces of one line, in reading order, joined into segments [text, style]; a gap between two pieces is a space. */
function segmentsOf(items) {
  const segs = [];
  let end = null;
  for (const it of items) {
    const style = (it.italic ? 'i' : '') + (it.size <= 7.5 ? 's' : '');
    let text = clean(it.str);
    if (end !== null && it.x - end > 1.2 && !text.startsWith(' ')) text = ' ' + text;
    const last = segs[segs.length - 1];
    if (last && last[1] === style) last[0] += text; else segs.push([text, style]);
    end = it.x + it.w;
  }
  if (segs.length) {
    segs[0][0] = segs[0][0].replace(/^\s+/, '');
    segs[segs.length - 1][0] = segs[segs.length - 1][0].replace(/\s+$/, '');
  }
  return segs.filter(s => s[0]);
}

const textOf = segs => segs.map(s => s[0]).join('');

/** The pieces of text grouped into lines: [{y, x, right, size, italic, segs, text}], top to bottom. */
function linesOf(items) {
  const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur || Math.abs(it.y - cur.y) > 2) { cur = { y: it.y, items: [] }; lines.push(cur); }
    cur.items.push(it);
  }
  return lines.map(l => {
    const its = l.items.sort((a, b) => a.x - b.x);
    const segs = segmentsOf(its);
    return {
      y: l.y,
      x: its[0].x,
      right: Math.max(...its.map(i => i.x + i.w)),
      size: Math.max(...its.map(i => i.size)),
      italic: its.every(i => i.italic),
      segs,
      text: textOf(segs),
    };
  }).filter(l => l.text);
}

/** The text of some pieces as one string, line by line. */
function lineText(items) {
  return linesOf(items).map(l => l.text).join(' ').trim();
}

/** Appends a line's segments to a block: with a space, or across a word broken at the end of the line with a hyphen. */
function joinInto(block, segs) {
  if (!segs.length) return;
  const last = block.t[block.t.length - 1];
  const first = segs[0];
  if (last && /[A-Za-zÀ-ɏ]-$/.test(last[0]) && /^[a-zß-öø-ÿ]/.test(first[0])) {
    last[0] = last[0].slice(0, -1);   // "fundamen-" + "tele": one word
  } else if (last && /\S\/$/.test(last[0])) {
    // "(name of bride/" + "groom)": no space after the stroke
  } else if (last) {
    if (last[1] === first[1]) last[0] += ' '; else segs[0] = [' ' + first[0], first[1]];
  }
  for (const s of segs) {
    const l = block.t[block.t.length - 1];
    if (l && l[1] === s[1]) l[0] += s[0]; else block.t.push([s[0], s[1]]);
  }
}

/* ---------------------------------------------------------------- the pages */

/**
 * What a content page is made of, or null for the cover and the contents
 * page: the heading, the Church's name, where the label column and the
 * content column start, and how far the content reaches to the right.
 */
function geometry(page) {
  const head = page.items.filter(i => i.y < HEADER && i.size >= 18);
  const body = page.items.filter(i => i.y >= HEADER);
  if (!head.length || body.filter(i => i.size >= 11).length < 6) return null;
  const labelX = Math.min(...body.filter(i => i.size >= 11).map(i => i.x));
  const right = body.filter(i => i.x > labelX + 80);
  const wide = right.filter(i => i.w >= 8);   // not a lone hyphen or bullet
  if (!wide.length) return null;
  const contentX = Math.min(...wide.map(i => i.x));
  return {
    page,
    heading: lineText(head),
    org: lineText(page.items.filter(i => i.y < HEADER && i.size >= 13 && i.size < 18)),
    labelX,
    contentX,
    colRight: Math.max(...right.map(i => i.x + i.w)),
  };
}

/** "• text", "o text" (a hollow bullet, when indented) or "- text" (a dash under a bullet): {glyph, segs}, else null. */
function bulletOf(line, indent) {
  const segs = line.segs.map(s => [s[0], s[1]]);
  const m = segs[0][0].match(/^([•●▪■‣])(?:\s*[•●▪■‣])*\s*/) || (indent >= 20 && segs[0][0].match(/^(o|[-–])\s+/));
  if (!m) return null;
  segs[0][0] = segs[0][0].slice(m[0].length);
  return { glyph: m[1] === 'o' ? 'o' : /[-–]/.test(m[1]) ? '-' : '•', segs: segs.filter(s => s[0]) };
}

/** How deep a line that is not a list item sits: 0 at the left of the column, 1 under the first bullets, and so on. */
const depthOf = indent => (indent < 10 ? 0 : Math.max(1, Math.round((indent - 10) / 36)));

/**
 * The content lines of a row as blocks: paragraphs, the booklet's notes (a
 * line in italics or in small letters) and list items. A line goes on from
 * the one before it when the two stand close together and, for a paragraph,
 * the one before fills the width of the column (the booklet's paragraphs are
 * justified, so a wrapped line always does, and a short line ends its
 * paragraph) or, for a list item, the line starts where the item's words
 * start (its lines are ragged). A paragraph that ends in a closing quote is
 * complete: what follows is new.
 */
function blocksOf(lines, contentX, colRight) {
  const blocks = [];
  let prev = null;
  const open = [];   // the list items this one may go under, outermost first: {indent, tx, d}
  for (const ln of lines) {
    const indent = ln.x - contentX;
    const tight = prev && ln.y - prev.y <= 1.65 * Math.max(prev.size, ln.size);
    const full = prev && prev.right >= colRight - 30;
    const last = blocks[blocks.length - 1];
    const bullet = bulletOf(ln, indent);
    const note = ln.italic || ln.size <= 11;
    if (bullet) {
      // a bullet at the indent of an open item is its sibling; one that starts where the words of the
      // innermost open item start is an item under it; any other sits by its distance from the left
      while (open.length && indent < open[open.length - 1].indent - 4) open.pop();
      const top = open[open.length - 1];
      let d;
      if (top && Math.abs(indent - top.indent) <= 4) { d = top.d; open.pop(); }
      else if (top && indent >= top.tx - 4) d = top.d + 1;
      else d = bullet.glyph === '-' ? Math.max(2, Math.round((indent - 16) / 36) + 1) : Math.max(1, Math.round(indent / 36));
      const tx = indent + (bullet.glyph === '-' ? 8 : 16);
      open.push({ indent, tx, d });
      blocks.push({ k: 'li', d, t: bullet.segs, tx });
    } else if (note) {
      const tail = last && last.t[last.t.length - 1];
      if (last && last.k === 'p' && tight && indent < 10 && tail && /i/.test(tail[1])) joinInto(last, ln.segs);   // italics that began on the line before: "(Ter-" + "wyl …)"
      else if (last && last.k === 'note' && tight && last.d === depthOf(indent) && !/[:)]$/.test(textOf(last.t))) joinInto(last, ln.segs);
      else blocks.push({ k: 'note', d: depthOf(indent), t: ln.segs.map(s => [s[0], s[1]]) });
    } else if (last && tight && last.k !== 'note' && (indent < 10
      ? last.k === 'p' && last.d === 0 && full && !/[”’]$/.test(textOf(last.t))
      : indent >= last.tx - 4)) {
      joinInto(last, ln.segs);
    } else {
      blocks.push({ k: 'p', d: depthOf(indent), t: ln.segs.map(s => [s[0], s[1]]), tx: indent });
    }
    prev = ln;
  }
  for (const b of blocks) delete b.tx;
  return blocks;
}

/**
 * The lines of the left column of a row: the label (the larger letters; or
 * the first line, whatever its letters, since the first line names the
 * row) and under it the small or italic lines.
 */
function labelOf(lines) {
  const label = { t: [] };
  const sub = [];
  let prev = null;
  for (const ln of lines) {
    if ((ln.size >= 11.5 && !ln.italic) || !prev) {
      joinInto(label, ln.segs);
    } else {
      const text = ln.text;
      const last = sub[sub.length - 1];
      const fresh = !last || /\)$/.test(last) || /^[•(]/.test(text) || !prev || ln.y - prev.y > 1.65 * Math.max(prev.size, ln.size);
      if (fresh) sub.push(text); else sub[sub.length - 1] = /[A-Za-zÀ-ɏ]-$/.test(last) && /^[a-z]/.test(text) ? last.slice(0, -1) + text : last + ' ' + text;
    }
    prev = ln;
  }
  return { label: textOf(label.t), sub };
}

/** The rows of one content page, top to bottom, cut at the dotted rules (or, on a page without them, at each label). */
function rowsOf(g) {
  const { page, contentX, colRight } = g;
  const body = page.items.filter(i => i.y >= HEADER);
  const labels = linesOf(body.filter(i => i.x < contentX - 10));
  const content = linesOf(body.filter(i => i.x >= contentX - 10));
  let rules = page.rules.filter(r => r > HEADER);
  if (!rules.length) {
    // no dotted rules read: a row starts a little above each label
    let last = -1e9;
    for (const ln of labels) {
      if (ln.size >= 11.5 && !ln.italic && ln.y - last > 1.65 * ln.size) rules.push(ln.y - 15);
      last = ln.y;
    }
    rules = rules.slice(1);
  }
  const index = y => rules.filter(r => r < y).length;
  const rows = [];
  for (let i = 0; i <= rules.length; i++) {
    const mine = labelOf(labels.filter(l => index(l.y) === i));
    const blocks = blocksOf(content.filter(l => index(l.y) === i), contentX, colRight);
    if (mine.label || mine.sub.length || blocks.length) rows.push({ label: mine.label, sub: mine.sub, blocks });
  }
  return rows;
}

/** A row that goes on over the page: the next page's first row is joined to the last one of the page before. */
function joinRows(last, next) {
  if (!last.label) last.label = next.label;
  last.sub.push(...next.sub);
  const a = last.blocks[last.blocks.length - 1], b = next.blocks[0];
  if (a && b && a.k === 'p' && b.k === 'p' && b.d === 0 && !/[.!?”’)]\s*$/.test(textOf(a.t))) {
    joinInto(a, b.t);
    next.blocks.shift();
  }
  last.blocks.push(...next.blocks);
}

/* ---------------------------------------------------------------- the booklet */

/* The rites the booklet has cards for, so the English and the Afrikaans card of the same rite share an address. */
const KEYS = [
  ['divine-service', /divine service|godsdiens/i],
  ['adoption', /adoption|opname/i],
  ['anniversary', /anniversary|herdenking/i],
  ['confirmation', /confirmation|konfirmasie/i],
  ['funeral', /funeral|begrafnis/i],
  ['baptism', /baptism|doop/i],
  ['prenatal', /prenatal|voorgeboortelik/i],
  ['wedding', /wedding|huwelik/i],
];

/** The address of a card: a known rite's name, else the heading as a slug. */
export function keyOf(heading) {
  const hit = KEYS.find(([, re]) => re.test(heading));
  return hit ? hit[0] : heading.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

/** "HOLY BAPTISM" → "Holy Baptism"; "HERDENKINGSEËN" → "Herdenkingseën". */
function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/** "LITURGY FOR ALTAR USE" → "Liturgy for altar use". */
function sentenceCase(s) {
  const t = s.trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * The booklet from its pages (see readPages): the language it is in, its
 * cover title, the Church's name on it, and its cards in the booklet's
 * order. A card that runs over two pages is one card; a row cut by the page
 * break is one row. Throws when the pages hold no cards.
 */
export function parse(pages) {
  const content = pages.map(geometry).filter(Boolean);
  if (!content.length) throw new Error('no cards');
  const cover = pages[0] ? lineText(pages[0].items.filter(i => i.size >= 30)) : '';
  const words = [cover, ...content.map(g => g.heading)].join(' ');
  const language = /\b(liturgie|godsdiens|doop|nagmaal|kerk|seën)\b/i.test(words) ? 'af' : 'en';
  const cards = [];
  let org = '';
  for (const g of content) {
    if (g.org.length > org.length) org = g.org;
    const key = keyOf(g.heading);
    let card = cards[cards.length - 1];
    const goesOn = !!(card && card.key === key);
    if (!goesOn) { card = { key, title: titleCase(g.heading), rows: [] }; cards.push(card); }
    const rows = rowsOf(g);
    if (goesOn && rows.length && card.rows.length) {
      const last = card.rows[card.rows.length - 1], next = rows[0];
      if (!next.label || !last.label) {
        joinRows(last, rows.shift());
      } else {
        // a row that began at the foot of the page before, without its label or its rule: its first words go on in this row
        const a = last.blocks[last.blocks.length - 1], b = next.blocks[0];
        if (a && b && a.k === 'p' && b.k === 'p' && b.d === 0 && !/[.!?”’)]\s*$/.test(textOf(a.t)) && /^[a-zß-ÿ]/.test(textOf(b.t))) {
          last.blocks.pop();
          joinInto(a, b.t);
          next.blocks[0] = a;
        }
      }
    }
    card.rows.push(...rows);
  }
  return { language, cover: sentenceCase(cover), org, pages: pages.length, cards };
}

/** Every word of a booklet, for a search: the card's title, labels and words, in reading order. */
export function plainText(card) {
  const out = [card.title];
  for (const r of card.rows) {
    if (r.label) out.push(r.label);
    out.push(...r.sub);
    for (const b of r.blocks) out.push(textOf(b.t));
  }
  return out.join('\n');
}

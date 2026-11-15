/*
 * The district's programme as an Excel file, read and written here without
 * a spreadsheet library.
 *
 * An .xlsx is a zip of XML files. Reading the programme needs only the cells
 * of its sheet (and the table of shared strings they point to); and the file
 * that goes back to the priests must stay the district's own file, with its
 * colours, merged headings, the Sundays marked and the logo in place, with
 * one column written in. A library that rebuilds the workbook from a grid
 * would lose all of that; so the sheet's XML is patched where the column
 * sits, and every other part of the zip is copied through untouched (its
 * bytes still compressed as they came).
 *
 * The zip is read and written by hand: the browser inflates and deflates
 * the entries (DecompressionStream and CompressionStream, 'deflate-raw'),
 * and the rest is a table of headers. Nothing here touches the page or the
 * database, so it runs in Node too (tools/test_plan.mjs).
 */

const te = new TextEncoder(), td = new TextDecoder();

/* ------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const inflateRaw = bytes => pipe(bytes, new DecompressionStream('deflate-raw'));
export const deflateRaw = bytes => pipe(bytes, new CompressionStream('deflate-raw'));

/** Can this browser open a zip at all? Chrome 103, Safari 16.4 and Firefox 113 can. */
export function supported() {
  return typeof DecompressionStream === 'function' && typeof CompressionStream === 'function';
}

/**
 * The entries of a zip, by name: {method, crc, size, raw}. raw is the
 * entry's bytes as stored (deflated when method is 8), so an entry that is
 * written back unchanged costs nothing. data(name) inflates one.
 */
export function unzip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // the end-of-central-directory record is at the very end, before a comment of up to 64 KB
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    // the local header repeats the name and may carry its own extra field, of another length
    if (dv.getUint32(offset, true) !== 0x04034b50) throw new Error('bad zip entry');
    const localName = dv.getUint16(offset + 26, true), localExtra = dv.getUint16(offset + 28, true);
    const start = offset + 30 + localName + localExtra;
    entries.set(name, { method, crc, size, raw: u8.subarray(start, start + csize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry, inflated. */
export async function entryData(entry) {
  if (entry.method === 0) return entry.raw;
  if (entry.method === 8) return inflateRaw(entry.raw);
  throw new Error('zip method ' + entry.method);
}

/**
 * A zip from entries {name -> {method, crc, size, raw}} (as unzip gives them)
 * or {name -> Uint8Array} (new bytes, deflated here). Written with the
 * sizes in the local headers, no data descriptors, no zip64: an Excel file
 * is far below those limits.
 */
export async function zip(entries) {
  const parts = [], dir = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const [name, value] of entries) {
    let e = value;
    if (value instanceof Uint8Array) {
      const raw = await deflateRaw(value);
      e = { method: 8, crc: crc32(value), size: value.length, raw };
    }
    const nameBytes = te.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            // version needed
    lv.setUint16(6, 0x0800, true);        // names are UTF-8
    lv.setUint16(8, e.method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, e.crc, true);
    lv.setUint32(18, e.raw.length, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, e.raw);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.raw.length, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    dir.push(central);
    offset += local.length + e.raw.length;
  }
  const dirSize = dir.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, dir.length, true);
  ev.setUint16(10, dir.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + dirSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...parts, ...dir, end]) { out.set(part, p); p += part.length; }
  return out;
}

/* ------------------------------------------------------------------ cells */

export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function colLetters(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function splitRef(ref) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) } : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return e.toLowerCase() in ENTITIES ? ENTITIES[e.toLowerCase()] : m;
  });
}
export function escapeXml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** The text of every <t> inside a piece of XML, joined: a cell's rich text comes in runs. */
function textOf(xml) {
  let out = '';
  const rx = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = rx.exec(xml))) out += unescapeXml(m[1]);
  return out;
}

/** The shared strings of the workbook, in order. */
export function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const rx = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = rx.exec(xml))) out.push(textOf(m[1]));
  return out;
}

/**
 * The cells of a sheet: {cells: Map 'A1' -> {col, row, value, type}, maxRow,
 * maxCol, merges: ['A1:K2', …]}. A value is a string, a number or a boolean.
 */
export function parseSheet(xml, shared) {
  const cells = new Map();
  let maxRow = 0, maxCol = 0;
  const rx = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = rx.exec(xml))) {
    const col = colIndex(m[1]), row = Number(m[2]), attrs = m[3], inner = m[4] || '';
    const type = (/\bt="([^"]*)"/.exec(attrs) || [])[1] || 'n';
    let value = null;
    if (type === 's') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      value = v ? shared[Number(v[1])] ?? '' : '';
    } else if (type === 'inlineStr') value = textOf(inner);
    else if (type === 'str' || type === 'e') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); value = v ? unescapeXml(v[1]) : ''; }
    else if (type === 'b') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); value = v ? v[1] === '1' : null; }
    else { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); value = v ? Number(v[1]) : null; }
    if (value === null || value === '') continue;
    cells.set(`${m[1]}${m[2]}`, { col, row, value, type });
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  const merges = [];
  const mx = /<mergeCell ref="([^"]+)"/g;
  while ((m = mx.exec(xml))) merges.push(m[1]);
  return { cells, maxRow, maxCol, merges };
}

/** The sheet as rows of values: grid[row][col], 1-based both ways, null where empty. */
export function toGrid(sheet) {
  const grid = [];
  for (const c of sheet.cells.values()) {
    if (!grid[c.row]) grid[c.row] = [];
    grid[c.row][c.col] = c.value;
  }
  return grid;
}

/* --------------------------------------------------------------- workbook */

/**
 * Opens an .xlsx: {entries, sheets: [{name, path}], shared}. The sheets come
 * in the workbook's order, with the path of each one's XML in the zip.
 */
export async function openWorkbook(bytes) {
  const entries = unzip(bytes);
  const text = async name => { const e = entries.get(name); return e ? td.decode(await entryData(e)) : ''; };
  const wb = await text('xl/workbook.xml');
  if (!wb) throw new Error('not a workbook');
  const rels = await text('xl/_rels/workbook.xml.rels');
  const targets = {};
  const rr = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = rr.exec(rels))) {
    const id = (/\bId="([^"]+)"/.exec(m[1]) || [])[1], target = (/\bTarget="([^"]+)"/.exec(m[1]) || [])[1];
    if (id && target) targets[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheets = [];
  const sr = /<sheet\b([^>]*)\/?>/g;
  while ((m = sr.exec(wb))) {
    const name = unescapeXml((/\bname="([^"]*)"/.exec(m[1]) || [])[1] || '');
    const rid = (/\br:id="([^"]+)"/.exec(m[1]) || [])[1];
    const state = (/\bstate="([^"]+)"/.exec(m[1]) || [])[1] || 'visible';
    if (rid && targets[rid]) sheets.push({ name, path: targets[rid], state });
  }
  const shared = parseSharedStrings(await text('xl/sharedStrings.xml'));
  return { entries, sheets, shared, text };
}

/** The parsed cells of one sheet of an opened workbook. */
export async function readSheet(wb, sheet) {
  return parseSheet(await wb.text(sheet.path), wb.shared);
}

/* --------------------------------------------------------- writing back */

const shiftRef = (ref, from) => ref.replace(/(\$?)([A-Z]{1,3})(\$?\d+)/g, (m, d, letters, rest) => {
  const n = colIndex(letters);
  return n >= from ? d + colLetters(n + 1) + rest : m;
});
const shiftRange = (range, from) => range.split(':').map(r => shiftRef(r, from)).join(':');

/** Every cell reference in the sheet's XML from column `from` on moves one to the right, so a column can go in. */
function shiftSheet(xml, from) {
  // cells and rows: the spans hint on a row is dropped rather than recounted (it is optional)
  xml = xml.replace(/<c r="([A-Z]+)(\d+)"/g, (m, letters, row) => { const n = colIndex(letters); return n >= from ? `<c r="${colLetters(n + 1)}${row}"` : m; });
  xml = xml.replace(/<row\b([^>]*?)\s+spans="[^"]*"/g, '<row$1');
  // merged ranges, the sheet's extent, conditional formats, validations, selections, the frozen pane
  xml = xml.replace(/(<mergeCell ref=")([^"]+)(")/g, (m, a, r, b) => a + shiftRange(r, from) + b);
  xml = xml.replace(/(<dimension ref=")([^"]+)(")/g, (m, a, r, b) => a + shiftRange(r, from) + b);
  xml = xml.replace(/\bsqref="([^"]+)"/g, (m, r) => `sqref="${r.split(/\s+/).map(x => shiftRange(x, from)).join(' ')}"`);
  xml = xml.replace(/\b(topLeftCell|activeCell)="([^"]+)"/g, (m, k, r) => `${k}="${shiftRef(r, from)}"`);
  xml = xml.replace(/(<(?:autoFilter|hyperlink|dataValidation)\b[^>]*\bref=")([^"]+)(")/g, (m, a, r, b) => a + r.split(/\s+/).map(x => shiftRange(x, from)).join(' ') + b);
  // column widths: a run that reaches the new column is split around it
  xml = xml.replace(/<col\b([^>]*?)\/>/g, (m, attrs) => {
    const min = Number((/\bmin="(\d+)"/.exec(attrs) || [])[1]), max = Number((/\bmax="(\d+)"/.exec(attrs) || [])[1]);
    if (!min || !max || max < from) return m;
    const withRange = (a, b) => '<col' + attrs.replace(/\bmin="\d+"/, `min="${a}"`).replace(/\bmax="\d+"/, `max="${b}"`) + '/>';
    if (min >= from) return withRange(min + 1, max + 1);
    return withRange(min, from - 1) + withRange(from + 1, max + 1);
  });
  return xml;
}

/** The anchors of a drawing (the logo) from column `from` on (0-based there) move right too. */
function shiftDrawing(xml, from) {
  // Excel writes <xdr:col>, other writers <col> in the default namespace: both are anchors here
  return xml.replace(/<(\w+:)?col>(\d+)<\/\1col>/g, (m, p, n) => Number(n) >= from - 1 ? `<${p || ''}col>${Number(n) + 1}</${p || ''}col>` : m);
}

/** The `s` (style) attribute of the cell at col/row in the row's XML, or ''. */
function styleOf(rowXml, col, row) {
  const m = new RegExp(`<c r="${colLetters(col)}${row}"([^>]*?)(?:/>|>)`).exec(rowXml);
  const s = m && /\bs="(\d+)"/.exec(m[1]);
  return s ? ` s="${s[1]}"` : '';
}

/**
 * Sets one cell of the sheet to a text (or clears it when the text is
 * empty), keeping the cell's own style; a cell that is not there yet is
 * made in its place in the row with the style of its left-hand neighbour.
 */
function setCell(xml, col, row, text) {
  const ref = `${colLetters(col)}${row}`;
  const value = text === '' || text == null ? '' : `<is><t xml:space="preserve">${escapeXml(text)}</t></is>`;
  const cell = style => `<c r="${ref}"${style}${value ? ' t="inlineStr">' + value + '</c>' : '/>'}`;
  const rowRx = new RegExp(`<row r="${row}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const rm = rowRx.exec(xml);
  if (!rm) {
    // a row with nothing in it is not written at all: it goes in before the next row
    const next = [...xml.matchAll(/<row r="(\d+)"/g)].find(x => Number(x[1]) > row);
    const at = next ? next.index : xml.indexOf('</sheetData>');
    return xml.slice(0, at) + `<row r="${row}">${cell('')}</row>` + xml.slice(at);
  }
  let rowXml = rm[0];
  if (rowXml.endsWith('/>')) rowXml = rowXml.slice(0, -2) + '></row>';
  const cellRx = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const cm = cellRx.exec(rowXml);
  if (cm) {
    const s = /\bs="(\d+)"/.exec(cm[1]);
    rowXml = rowXml.replace(cellRx, cell(s ? ` s="${s[1]}"` : ''));
  } else {
    const style = styleOf(rowXml, col - 1, row);
    const after = [...rowXml.matchAll(/<c r="([A-Z]+)\d+"/g)].find(x => colIndex(x[1]) > col);
    const at = after ? after.index : rowXml.lastIndexOf('</row>');
    rowXml = rowXml.slice(0, at) + cell(style) + rowXml.slice(at);
  }
  return xml.slice(0, rm.index) + rowXml + xml.slice(rm.index + rm[0].length);
}

function addMerge(xml, range) {
  if (/<mergeCells\b/.test(xml)) {
    return xml.replace(/<mergeCells count="(\d+)">/, (m, n) => `<mergeCells count="${Number(n) + 1}">`).replace('</mergeCells>', `<mergeCell ref="${range}"/></mergeCells>`);
  }
  const at = xml.indexOf('</sheetData>') + '</sheetData>'.length;
  return xml.slice(0, at) + `<mergeCells count="1"><mergeCell ref="${range}"/></mergeCells>` + xml.slice(at);
}

/**
 * Writes a column of texts into a sheet and gives back the whole file.
 *   bytes      the original .xlsx
 *   sheetPath  the sheet's XML in the zip (from openWorkbook)
 *   col        the column (1-based) to write into; or
 *   insertAt   the column (1-based) a new one is put in front of, with
 *              `header` written in `headerRows` [first, last] (merged when
 *              more than one) and `width` in characters
 *   values     {row -> text}: the texts, by row number; '' clears a cell
 * The other sheets, the styles, the strings and the logo are copied through
 * as they are.
 */
export async function writeColumn(bytes, { sheetPath, col, insertAt, header = '', headerRows = null, width = 14, values = {} }) {
  const entries = unzip(bytes);
  const get = async name => { const e = entries.get(name); return e ? td.decode(await entryData(e)) : null; };
  let xml = await get(sheetPath);
  if (xml == null) throw new Error('sheet missing');
  const out = new Map(entries);
  let target = col;
  if (insertAt) {
    target = insertAt;
    xml = shiftSheet(xml, insertAt);
    // the new column's width: a <col> of its own, in order among the others
    const colTag = `<col min="${insertAt}" max="${insertAt}" width="${width}" customWidth="1"/>`;
    if (/<cols>/.test(xml)) {
      const cols = [...xml.matchAll(/<col\b[^>]*?\/>/g)];
      const after = cols.find(c => Number((/\bmin="(\d+)"/.exec(c[0]) || [])[1]) > insertAt);
      const at = after ? after.index : xml.indexOf('</cols>');
      xml = xml.slice(0, at) + colTag + xml.slice(at);
    } else {
      const at = xml.indexOf('<sheetData');
      xml = xml.slice(0, at) + `<cols>${colTag}</cols>` + xml.slice(at);
    }
    if (headerRows) {
      for (let r = headerRows[0]; r <= headerRows[1]; r++) xml = setCell(xml, insertAt, r, r === headerRows[0] ? header : '');
      if (headerRows[1] > headerRows[0]) xml = addMerge(xml, `${colLetters(insertAt)}${headerRows[0]}:${colLetters(insertAt)}${headerRows[1]}`);
    }
    // the logo and any other picture anchored at or past the new column
    const rels = await get(sheetPath.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'));
    for (const m of (rels || '').matchAll(/Target="([^"]*drawings\/[^"]+\.xml)"/g)) {
      const path = m[1].startsWith('/') ? m[1].slice(1) : 'xl/' + m[1].replace(/^(\.\.\/)+/, '');
      const d = await get(path);
      if (d) out.set(path, te.encode(shiftDrawing(d, insertAt)));
    }
  }
  for (const [row, text] of Object.entries(values)) xml = setCell(xml, target, Number(row), text);
  out.set(sheetPath, te.encode(xml));
  return zip(out);
}

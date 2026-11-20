#!/usr/bin/env node
/*
 * Reads the Catechism the way Church files does (src/catechism-pdf.js) and
 * prints what it found, so a change to the parser can be checked:
 *
 *   node tools/test_catechism_pdf.mjs                      a made-up fixture, with its checks
 *   node tools/test_catechism_pdf.mjs pages.json [out.json]   the pages booklet.js readPages gave, saved as JSON
 *   node tools/test_catechism_pdf.mjs Catechism.pdf [out.json]
 *
 * A PDF needs pdf.js for Node, which is not in the repository: run
 * `npm install --no-save pdfjs-dist@5.4.624` in bible/ first. The Catechism
 * is the Church's text: neither the PDF, nor its pages, nor what this prints
 * belong in the repository; the fixture below is made up.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatechism, catechismFile } from '../src/catechism-pdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [file, out] = process.argv.slice(2);

/* ---------------------------------------------------------------- the fixture */

// a page of the book's shape: 419.5 × 595.3 pt, the body in 9.7 pt, the headings in 10.7, the summaries in 9.0, footnotes and running heads in 7.7
const W = 419.5, H = 595.3, BODY = 9.7, HEAD = 10.7, SUM = 9.0, SMALL = 7.7, BIG = 14.9;
function page(n, lines) {
  const items = [];
  for (const l of lines) {
    const size = l.size || BODY;
    items.push({ str: l.text, x: l.x, y: l.y, w: l.text.length * size * 0.48, size, italic: false, bold: false });
    if (l.sup) items.push({ str: String(l.sup), x: l.x + l.text.length * size * 0.48 + 0.5, y: l.y - 0.3 * size, w: 3, size: 5.8, italic: false, bold: false });
  }
  return { n, width: W, height: H, items, rules: [], marks: [] };
}
const R = 104.9, L = 96.4;   // the left margin of a right-hand page and of a left-hand page (mirrored margins)
const INDEX = [
  { n: '1', title: 'God reveals Himself', page: 1 },
  { n: '1.1', title: 'The revelation', page: 1 },
  { n: '1.2', title: 'Faith and knowledge', page: 2 },
];
const PAGES = [
  page(1, [
    { y: 5.8, x: R, size: SMALL, text: 'God reveals Himself' },                       // the running head
    { y: 60, x: R, size: HEAD, text: '1 God reveals Himself' },
    { y: 80, x: R, text: 'God makes Himself known to human beings. He does so in creation, in' },
    { y: 92.2, x: R, text: 'history and above all in His Son.', sup: 1 },
    { y: 104.4, x: R + 13, text: 'Human beings cannot find God by their own strength; He must re-' },
    { y: 116.6, x: R, text: 'veal Himself.' },
    { y: 140, x: R, size: HEAD, text: '1.1 The revelation' },
    { y: 160, x: R, text: 'God chose to reveal Himself in words and deeds. The Bible is the record of' },
    { y: 172.2, x: R, text: 'this revelation. It has two parts:' },
    { y: 184.4, x: R, text: '• the Old Testament, which tells of God\'s dealings with Israel, from the' },
    { y: 196.6, x: R + 13, text: 'creation to the return from exile' },
    { y: 208.8, x: R, text: '• the New Testament, which tells of Jesus Christ and the first Church.' },
    { y: 232, x: R, size: HEAD, text: 'SUMMARY' },
    { y: 250, x: R, size: SUM, text: 'God reveals Himself in creation, in history and in His Son; the Bible records' },
    { y: 262.2, x: R, size: SUM, text: 'this revelation in two Testaments. (1; 1.1)' },
    { y: 480, x: R + 7.7, size: SMALL, text: '1 See also 1.2 on faith.' },               // the footnote
    { y: 513.8, x: W / 2, text: '1' },                                                   // the page number
  ]),
  page(2, [
    { y: 5.8, x: L, size: SMALL, text: 'Faith and knowledge' },
    { y: 60, x: L, size: HEAD, text: '1.2 Faith and knowledge' },
    { y: 80, x: L, text: 'Faith is trust in God and in His promises. Knowledge about God comes' },
    { y: 92.2, x: L, text: 'from His revelation.' },
    { y: 104.4, x: L + 13, text: 'Faith and knowledge belong together: the one needs the other.' },
    { y: 116.6, x: L + 34, text: 'Faith without knowledge is blind.' },
    { y: 128.8, x: L + 34, text: 'Knowledge without faith is empty.' },
    { y: 141, x: L, text: 'So the Church teaches both.' },
    { y: 200, x: L, size: BIG, text: 'Glossary' },                                      // the end of the book's text
    { y: 513.8, x: W / 2, text: '2' },
  ]),
];

function checkFixture() {
  const parsed = parseCatechism(PAGES, INDEX);
  assert.equal(parsed.found, 3, 'every section of the index found');
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.language, 'en');
  const [s1, s11, s12] = parsed.sections;
  assert.equal(s1.n, '1');
  assert.deepEqual(s1.blocks, [
    'God makes Himself known to human beings. He does so in creation, in history and above all in His Son.¹',
    'Human beings cannot find God by their own strength; He must reveal Himself.',
  ], 'the paragraphs of 1: the set-in line starts one, the broken word is joined, the footnote mark is a raised figure');
  assert.deepEqual(s1.notes, [{ n: 1, t: 'See also 1.2 on faith.' }], 'the footnote belongs to the section with its mark');
  assert.deepEqual(s1.summary, ['God reveals Himself in creation, in history and in His Son; the Bible records this revelation in two Testaments.'], 'the summary, without its section mark');
  assert.deepEqual(s11.summary, s1.summary, 'a summary marked (1; 1.1) belongs to both');
  assert.deepEqual(s11.blocks, [
    'God chose to reveal Himself in words and deeds. The Bible is the record of this revelation. It has two parts:',
    { l: ['the Old Testament, which tells of God\'s dealings with Israel, from the creation to the return from exile', 'the New Testament, which tells of Jesus Christ and the first Church.'] },
  ], 'a bullet list, each item wrapped onto its indented line');
  assert.deepEqual(s12.blocks, [
    'Faith is trust in God and in His promises. Knowledge about God comes from His revelation.',
    'Faith and knowledge belong together: the one needs the other.',
    { l: ['Faith without knowledge is blind.', 'Knowledge without faith is empty.'] },
    'So the Church teaches both.',
  ], 'the lines set in at the list indent are items; the margin line after them starts a paragraph');
  assert.equal(s12.notes, undefined);
  assert.equal(s1.page, 1);
  const data = catechismFile(parsed, 'catechism.pdf');
  assert.equal(data.app, 'nac-study-bible-catechism');
  assert.equal(data.fileName, 'catechism.pdf');
  assert.equal(data.language, 'en');
  assert.equal(data.sections.length, 3);
  assert.match(data.edition, /^Catechism of the New Apostolic Church, English edition/);
  // not the Catechism: a PDF whose headings match nothing of the index
  assert.throws(() => parseCatechism(PAGES, [{ n: '7', title: 'Something else', page: 1 }, { n: '7.1', title: 'Nothing here', page: 1 }, { n: '7.2', title: 'Nor here', page: 1 }]), /not the Catechism/);
  console.log('fixture ok:', parsed.sections.length, 'sections,', parsed.odd.length, 'odd notes');
}

/* ---------------------------------------------------------------- a real file */

async function readPdf(file) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (e) {
    console.error('pdf.js for Node is not installed: run `npm install --no-save pdfjs-dist@5.4.624` in bible/ first.');
    process.exit(2);
  }
  const { readPages } = await import('../src/booklet.js');
  return readPages(pdfjs, new Uint8Array(fs.readFileSync(file)), (n, total) => { if (n % 50 === 0) console.error(`page ${n} of ${total}`); });
}

async function main() {
  if (!file) { checkFixture(); return; }
  const pages = /\.pdf$/i.test(file) ? await readPdf(file) : JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'catechism.json'), 'utf8')).sections;
  const t0 = Date.now();
  const parsed = parseCatechism(pages, index);
  console.log(`${parsed.found} of ${index.length} sections found in ${Date.now() - t0} ms; ${parsed.edition}; language ${parsed.language}`);
  if (parsed.missing.length) console.log('missing:', parsed.missing.join(', '));
  const kinds = { p: 0, l: 0, h: 0, v: 0, table: 0, summary: 0, notes: 0 };
  for (const s of parsed.sections) {
    for (const b of s.blocks) kinds[typeof b === 'string' ? 'p' : Object.keys(b)[0]]++;
    if (s.summary) kinds.summary += s.summary.length;
    if (s.notes) kinds.notes += s.notes.length;
  }
  console.log('blocks:', JSON.stringify(kinds));
  for (const o of parsed.odd) console.log('odd:', o);
  if (out) { fs.writeFileSync(out, JSON.stringify(catechismFile(parsed, path.basename(file)), null, 1)); console.log('written', out); }
}

main().catch(e => { console.error(e); process.exit(1); });

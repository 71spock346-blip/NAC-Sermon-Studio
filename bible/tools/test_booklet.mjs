#!/usr/bin/env node
/*
 * Reads an altar booklet PDF the way the app does (src/booklet.js) and prints
 * its cards, so a change to the parser can be checked against the real file:
 *
 *   node tools/test_booklet.mjs "Liturgy Altar Que Cards - English.pdf" [cards.json]
 *
 * pdf.js in Node needs its legacy build, which is not in the repository:
 * run `npm install --no-save pdfjs-dist@5.4.624` in bible/ first. The booklet
 * is the Church's text: neither the PDF nor the cards it prints belong in
 * the repository.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readPages, parse, plainText } from '../src/booklet.js';

const [file, out] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/test_booklet.mjs booklet.pdf [cards.json]'); process.exit(2); }
let pdfjs;
try {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
} catch (e) {
  console.error('pdf.js for Node is not installed: run `npm install --no-save pdfjs-dist@5.4.624` in bible/ first.');
  process.exit(2);
}

const pages = await readPages(pdfjs, new Uint8Array(fs.readFileSync(file)));
const booklet = parse(pages);

// what every booklet must have: cards with a title and rows, rows with something in them, blocks with words
assert.ok(booklet.cards.length >= 1, 'no cards');
for (const c of booklet.cards) {
  assert.ok(c.key && c.title, 'a card without a key or a title');
  assert.ok(c.rows.length >= 1, `${c.title}: no rows`);
  for (const r of c.rows) {
    assert.ok(r.label || r.sub.length || r.blocks.length, `${c.title}: an empty row`);
    for (const b of r.blocks) assert.ok(b.t.length && b.t.every(s => s[0]), `${c.title}: an empty block`);
  }
}

console.log(`${booklet.language}: "${booklet.cover}" (${booklet.org}), ${booklet.pages} pages, ${booklet.cards.length} cards`);
for (const c of booklet.cards) {
  console.log(`\n#### ${c.key} — ${c.title} (${c.rows.length} rows)`);
  for (const r of c.rows) {
    console.log(`  [${r.label}]${r.sub.length ? ' {' + r.sub.join(' | ') + '}' : ''}`);
    for (const b of r.blocks) console.log(`      ${b.k}${b.d || ''}: ${b.t.map(([s, st]) => (st ? `⟨${st}:${s}⟩` : s)).join('')}`);
  }
}
if (out) { fs.writeFileSync(out, JSON.stringify(booklet, null, 1)); console.log(`\nwritten to ${out}`); }
const rows = booklet.cards.reduce((n, c) => n + c.rows.length, 0);
console.log(`\nok  ${booklet.cards.length} cards, ${rows} rows, ${plainText(booklet.cards[0]).split(/\s+/).length} words in the first card`);

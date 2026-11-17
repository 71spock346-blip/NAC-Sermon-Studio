#!/usr/bin/env node
/*
 * Reads a handbook the way the app does (src/handbook.js) and prints its
 * chapters, so a change to the parser can be checked against a real file:
 *
 *   node tools/test_handbook.mjs                          the made-up fixture, with its checks
 *   node tools/test_handbook.mjs "Guide for Ministers.txt" [out.json]
 *   node tools/test_handbook.mjs "Liturgy.pdf" [out.json]
 *
 * A PDF needs pdf.js for Node, which is not in the repository: run
 * `npm install --no-save pdfjs-dist@5.4.624` in bible/ first. The handbooks
 * are the Church's text: neither the files nor what this prints belong in
 * the repository; only tools/fixtures/handbook-sample.txt, which is made up.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromText, fromPages, parse, plainText, search, relevant } from '../src/handbook.js';
import { CREED } from '../src/creed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [file, out] = process.argv.slice(2);

async function read(file) {
  if (/\.pdf$/i.test(file)) {
    let pdfjs;
    try {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } catch (e) {
      console.error('pdf.js for Node is not installed: run `npm install --no-save pdfjs-dist@5.4.624` in bible/ first.');
      process.exit(2);
    }
    const { readPages } = await import('../src/booklet.js');
    const pages = await readPages(pdfjs, new Uint8Array(fs.readFileSync(file)));
    return fromPages(pages);
  }
  return fromText(fs.readFileSync(file, 'utf8'));
}

function check(hb) {
  assert.ok(hb.chapters.length >= 1, 'no chapters');
  assert.ok(hb.title, 'no title');
  for (const c of hb.chapters) {
    assert.ok(c.title, 'a chapter without a title');
    for (const b of c.blocks) {
      assert.ok(['p', 'h', 'li', 'quote', 'note'].includes(b.k), `${c.title}: a block of kind ${b.k}`);
      assert.ok(b.t.length && b.t.every(r => r[0]), `${c.title}: an empty block`);
    }
  }
}

function print(hb, full) {
  console.log(`${hb.key} (${hb.language}): "${hb.title}" — ${hb.ownTitle}; ${hb.org}; ${hb.edition}; ${hb.pages} pages, ${hb.words} words, ${hb.chapters.length} chapters`);
  for (const c of hb.chapters) {
    const kinds = {};
    for (const b of c.blocks) kinds[b.k] = (kinds[b.k] || 0) + 1;
    console.log(`${'  '.repeat(Math.max(0, c.level - 1))}${c.n ? c.n + ' ' : ''}${c.title}  [p${c.page}] ${Object.entries(kinds).map(([k, v]) => k + v).join(' ')}`);
    if (full) for (const b of c.blocks) console.log(`      ${b.k}${b.d || ''}: ${b.t.map(([s, st]) => (st ? `⟨${st}:${s}⟩` : s)).join('')}`);
  }
}

if (!file) {
  // the fixture: a made-up handbook in the shape of a text file saved from a PDF
  const hb = parse(fromText(fs.readFileSync(path.join(here, 'fixtures', 'handbook-sample.txt'), 'utf8')));
  check(hb);
  print(hb, true);
  const ns = hb.chapters.map(c => c.n);
  assert.deepEqual(ns, ['1', '2', '2.1', '2.2', '3', '3.1', '3.1.1', '3.2', '4', 'A1'], 'the chapters found');
  assert.equal(hb.title, 'Handbook for Helpers');
  assert.equal(hb.key, 'handbook-for-helpers');
  assert.equal(hb.language, 'en');
  const c21 = hb.chapters.find(c => c.n === '2.1');
  assert.equal(c21.blocks.filter(b => b.k === 'li').length, 4, 'four list items in 2.1');
  assert.ok(c21.blocks.some(b => b.k === 'li' && /^Keeping promises, and saying so when one cannot be kept$/.test(plainText({ n: '', title: '', blocks: [b] }).split('\n')[1].replace(/^- /, ''))), 'a list item that runs over two lines is one item');
  const c22 = hb.chapters.find(c => c.n === '2.2');
  assert.ok(c22.blocks.some(b => b.k === 'note' && b.t[0][0] === '1'), 'the footnote is kept with its page');
  assert.ok(c22.blocks.some(b => b.k === 'p' && b.t.some(r => r[1] === 'sup' && r[0] === '1')), 'the footnote mark is raised');
  assert.ok(c22.blocks.some(b => b.k === 'h' && b.t[0][0] === 'The visit'), 'a short line over a paragraph is a heading');
  const c1 = hb.chapters.find(c => c.n === '1');
  assert.equal(c1.blocks.filter(b => b.k === 'p').length, 2, 'two paragraphs in the foreword');
  assert.ok(!JSON.stringify(hb).includes('Page 3 of'), 'the page heads are dropped');
  assert.ok(!JSON.stringify(hb).includes('.....'), 'the table of contents is dropped');
  const found = search([hb], 'visit');
  assert.ok(found.length >= 1 && found[0].chapter.n === '2.2', 'search finds the chapter');
  assert.ok(relevant([hb], 'how do I visit a member?').length >= 1, 'relevant chapters for a question');
  console.log('\nok  fixture');

  // the Creed, which is part of the app (src/creed.js): ten articles in the shape of a loaded handbook, searched and asked like one
  const creed = CREED[0];
  check(creed);
  assert.equal(creed.key, 'creed');
  assert.equal(creed.language, 'en');
  assert.ok(creed.builtIn, 'the Creed is built in');
  assert.deepEqual(creed.chapters.map(c => c.n), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'ten articles');
  assert.ok(creed.chapters.every((c, i) => c.cat === '2.4.' + (i + 1) && c.blocks.length === 1 && c.blocks[0].k === 'p'), 'each article one paragraph, with its section of the Catechism');
  assert.ok(creed.chapters.every(c => /^I believe/.test(c.blocks[0].t[0][0])), 'every article starts "I believe"');
  assert.equal(search([creed], 'unleavened')[0].chapter.n, '7', 'search finds the Seventh Article');
  assert.equal(search([creed], 'tenth article')[0].chapter.n, '10', 'search by title');
  assert.deepEqual(search([creed, hb], 'baptise').map(h => h.chapter.n).sort(), ['4', '6', '8'], 'a search across the Creed and a handbook: the articles on baptism');
  assert.equal(relevant([creed], 'Who ordains those designated for a ministry?')[0].chapter.n, '5', 'the Fifth Article answers the question');
  // the Afrikaans copy, as the minister sent it: the same ten articles, found under the same key and addresses
  const af = CREED.find(c => c.language === 'af');
  check(af);
  assert.equal(af.id, 'creed:af');
  assert.equal(af.key, creed.key, 'the two copies share the key, so #handbooks/creed/4 is the Fourth Article in either');
  assert.deepEqual(af.chapters.map(c => c.n), creed.chapters.map(c => c.n), 'ten articles in Afrikaans too');
  assert.ok(af.chapters.every(c => /^Die \S+ Geloofsartikel$/.test(c.title) && /^Ek glo/.test(c.blocks[0].t[0][0])), 'every Afrikaans article is headed "Die … Geloofsartikel" and starts "Ek glo"');
  assert.equal(search([af], 'ongesuurde')[0].chapter.n, '7', 'search in Afrikaans finds the Seventh Article');
  assert.equal(relevant([af], 'Wie orden diegene wat vir \'n amp bestem is?')[0].chapter.n, '5', 'the Fifth Article answers the question in Afrikaans');
  console.log('ok  the Creed: 10 articles in English and in Afrikaans, searched and asked');
  process.exit(0);
}

const hb = parse(await read(file));
check(hb);
print(hb, !!process.env.FULL);
if (out) { fs.writeFileSync(out, JSON.stringify(hb, null, 1)); console.log(`\nwritten to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`); }
const blocks = hb.chapters.reduce((n, c) => n + c.blocks.length, 0);
console.log(`\nok  ${hb.chapters.length} chapters, ${blocks} blocks, ${hb.words} words`);

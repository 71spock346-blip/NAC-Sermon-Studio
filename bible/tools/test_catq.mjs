#!/usr/bin/env node
/*
 * Reads the Catechism in questions and answers the way the app does
 * (src/catq.js), so a change to its reader can be checked:
 *
 *   node tools/test_catq.mjs                     made-up pages in the book's shape, with their checks
 *   node tools/test_catq.mjs book.pdf [out.json] the Church's own PDF: what was read, and a few questions
 *
 * The made-up pages copy the book's fonts, sizes and places (Open Sans for
 * the questions, the verses and the boxes, Minion Pro for the answers),
 * not its words. A PDF needs pdf.js for Node, which is not in the
 * repository: run `npm install --no-save pdfjs-dist@5.4.624` in bible/
 * first. The book is the Church's text: neither the file nor what this
 * prints belongs in the repository.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isQA, parseQA, refsOf, seeOf, questionsFor, qaOf, questionOf, answerOf, rangeOf } from '../src/catq.js';
import { search } from '../src/handbook.js';

const [file, out] = process.argv.slice(2);

/* ---------------------------------------------------------------- made-up pages in the book's shape */

const W = 425, H = 651;
const item = (str, x, y, size, font) => ({ str, x, y, w: str.length * size * 0.48, size, font, italic: /italic|-it$/i.test(font), bold: /bold|semibold/i.test(font) });
/** Items for words set one after the other on a line, from x. */
function line(words, x, y, size, font) {
  const out = [];
  let at = x;
  for (const w of words.split(' ')) {
    const it = item(w, at, y, size, font);
    out.push(it);
    at += it.w + size * 0.25;   // a word space
  }
  return out;
}
const Q = 'OpenSans-Semibold', NUM = 'OpenSans-Extrabold', A = 'MinionPro-Regular', LIGHT = 'OpenSans-Light', BOLD = 'OpenSans-Bold', XI = 'OpenSans-SemiboldItalic', XR = 'OpenSans-Italic';
const head = (text, n) => [...line(text, 220, 55, 9.5, Q), item(String(n), 360, 611, 8, LIGHT)];

const pages = [
  { n: 1, width: W, height: H, items: [...line('Kategismus in vrae en antwoorde', 60, 200, 22, LIGHT), ...line('© 2014 New Apostolic Church International, Zürich', 60, 560, 8, LIGHT), ...line('First edition 2015', 60, 572, 8, LIGHT)] },
  { n: 2, width: W, height: H, items: [...line('HOOFSTUK VAN TOETSE', 60, 300, 28, Q), ...line('woorde wolk', 60, 360, 30, 'MinionPro-It')] },
  { n: 3, width: W, height: H, items: [
    ...head('Die eerste toets', 3),
    item('1', 120, 95, 14, NUM),
    ...line('Wat is die eerste toets van hierdie', 55, 113, 9.5, Q),
    ...line('boek?', 55, 125, 9.5, Q),
    ...line('Die eerste toets is ’n kort antwoord wat', 55, 143, 9.5, A),
    ...line('oor twee reëls loop en die drie-', 55, 155, 9.5, A),
    ...line('enige vraag stel. Dit is goeie on-', 55, 167, 9.5, A),
    ...line('derwys vir die drie-enige leser.', 55, 179, 9.5, A),
    ...line('’n Nuwe paragraaf begin hier.', 63.5, 191, 9.5, A),
    ...line('“Toetsvers een twee drie, so sê', 59, 214, 8.5, LIGHT),
    ...line('die toets.”', 59, 224.4, 8.5, LIGHT),
    ...line('Johannes 3: 16', 59, 234.8, 8.5, Q),
    item('2', 280, 95, 14, NUM),
    item('b', 220.8, 113, 9.5, Q), item('estaan daar toetse?', 220.8 + 9.5 * 0.48, 113, 9.5, Q),
    ...line('Ja, daar is baie toetse.', 220.8, 131, 9.5, A),
    item('“', 224.8, 154, 8.5, LIGHT), item('Toetsterm', 224.8 + 4.1, 154, 8.5, BOLD), ...line('” is die naam vir ’n', 224.8 + 4.1 + 9 * 8.5 * 0.48, 154, 8.5, LIGHT),
    ...line('woord wat verduidelik word.', 224.8, 164.4, 8.5, LIGHT),
    ...line('Toets nommer een:', 229, 186, 9, XI), ...line('sien Vraag 1', 229 + 17 * 9 * 0.48 + 2, 186, 9, XR),
    ...line('Lang toets', 229, 198, 9, XI),
    ...line('(met meer):', 229, 210, 9, XI), ...line('sien Vrae 1-2', 229 + 11 * 9 * 0.48 + 2, 210, 9, XR),
  ] },
  { n: 4, width: W, height: H, items: [
    ...head('Die eerste toets', 4),
    item('3', 120, 95, 14, NUM),
    ...line('Hoe eindig die toets?', 55, 113, 9.5, Q),
    ...line('Die toets eindig met ’n derde vraag.', 55, 131, 9.5, A),
  ] },
  { n: 5, width: W, height: H, items: [...line('Bylaag', 220, 55, 9.5, LIGHT), ...line('Die Geloofsbelydenis', 60, 120, 18, Q)] },
  { n: 6, width: W, height: H, items: [
    ...line('Bybelverwysings', 220, 55, 9.5, LIGHT),
    item('Romeine', 55, 100, 9, 'MinionPro-Bold'), item('8: 28', 55, 112, 9, 'MinionPro-It'), item('. . . . . . . .', 80, 112, 9, A), item('3', 150, 112, 9, A),
    item('Johannes', 55, 130, 9, 'MinionPro-Bold'), item('3: 16', 55, 142, 9, 'MinionPro-It'), item('. . . . . . . .', 80, 142, 9, A), item('1; 3', 150, 142, 9, A),
  ] },
];

function checks() {
  assert.equal(isQA(pages), true, 'the title page says what the book is');
  assert.equal(isQA([{ n: 1, width: W, height: H, items: line('Guide for Ministers', 60, 200, 22, LIGHT) }]), false, 'another book is not this one');
  const hb = parseQA(pages, { min: 3 });
  assert.equal(hb.key, 'catechism-qa');
  assert.equal(hb.language, 'af');
  assert.equal(hb.title, 'Kategismus in vrae en antwoorde');
  assert.equal(hb.edition, 'First edition 2015');
  assert.equal(hb.org, 'New Apostolic Church International');
  assert.equal(hb.questions, 3);
  const [ch, q1, q2, q3] = hb.chapters;
  assert.deepEqual([ch.n, ch.level, ch.page, ch.title, ch.cat], ['1', 1, 2, 'Die eerste toets', '1'], 'the chapter: its opener\'s page, its name from the running head, the Catechism\'s chapter');
  assert.deepEqual([q1.n, q1.qn, q1.parent, q1.level, q1.page], ['q1', 1, '1', 2, 3]);
  assert.equal(q1.title, 'Wat is die eerste toets van hierdie boek?', 'a question over two lines');
  assert.equal(q1.blocks[0].k, 'p');
  const p1 = q1.blocks[0].t.map(r => r[0]).join('');
  assert.ok(p1.includes('die drie-enige vraag') && p1.includes('drie-enige leser'), 'a word the book writes with a hyphen keeps it when broken after it: ' + p1);
  assert.ok(p1.includes('goeie onderwys'), 'a word broken at the line\'s end is joined: ' + p1);
  assert.equal(q1.blocks[1].k, 'p', 'an indented line after a full stop is a new paragraph');
  assert.equal(q1.blocks[2].k, 'quote', 'a verse in small type is a quote');
  assert.deepEqual(q1.blocks[2].t[q1.blocks[2].t.length - 1], [' Johannes 3: 16', 'r'], 'with its reference after it');
  assert.equal(q2.title, 'Bestaan daar toetse?', 'the book\'s capital B, which its font gives as a small b, is a capital again');
  assert.equal(q2.blocks[1].k, 'note', 'a box that opens on its term in quotation marks is a note, not a verse');
  assert.ok(q2.blocks[1].t.some(([s, st]) => s.includes('Toetsterm') && st.includes('b')), 'its term in bold');
  const xref = q2.blocks.filter(b => b.k === 'note' && b.t.some(([, st]) => st.includes('i'))).map(b => b.t.map(r => r[0]).join(''));
  assert.deepEqual(xref, ['Toets nommer een: sien Vraag 1', 'Lang toets (met meer): sien Vrae 1-2'], 'the lines that point to other questions, a label over two lines kept whole');
  assert.deepEqual(q2.see, [1], 'the questions it points to (not itself)');
  assert.deepEqual(q1.refs, [{ b: 'JHN', c: 3, v: 16, e: 16 }], 'the verse under the quote, once though the index names it too');
  assert.deepEqual(q3.refs, [{ b: 'ROM', c: 8, v: 28, e: 28 }, { b: 'JHN', c: 3, v: 16, e: 16 }], 'the verses from the book\'s Bible index, in its order');
  assert.equal(hb.chapters.length, 4, 'nothing after the appendix begins');

  // reading it
  assert.deepEqual(questionsFor(hb, 'JHN', 3, 16).map(q => q.qn), [1, 3], 'the questions on a verse');
  assert.deepEqual(questionsFor(hb, 'JHN', 3).map(q => q.qn), [1, 3], 'and on its chapter');
  assert.deepEqual(questionsFor(hb, 'JHN', 3, 17).map(q => q.qn), [], 'not on another verse');
  assert.deepEqual(rangeOf(hb, ch), [1, 3]);
  assert.equal(questionOf(hb, 2), q2);
  assert.equal(qaOf([{ key: 'guide' }, { ...hb, language: 'en' }, hb], 'af'), hb, 'the copy in the language asked for');
  assert.deepEqual(answerOf(q1, 'summary').map(x => x.k), ['p'], 'a summary is the first paragraph');
  assert.deepEqual(answerOf(q1).find(x => x.k === 'quote'), { k: 'quote', text: '“Toetsvers een twee drie, so sê die toets.”', ref: 'Johannes 3: 16' }, 'a verse and its reference apart');
  assert.equal(search([hb], '2')[0].chapter, q2, 'a question\'s number finds it first');
  assert.equal(search([hb], 'toetsterm')[0].chapter, q2, 'and a word in its box');

  // the references and the lines that point to questions
  assert.deepEqual(refsOf('1 Johannes 3: 1-2; 4:7'), [{ b: '1JN', c: 3, v: 1, e: 2 }, { b: '1JN', c: 4, v: 7, e: 7 }]);
  assert.deepEqual(refsOf('Deuteronónium 18: 10-12'), [{ b: 'DEU', c: 18, v: 10, e: 12 }], 'the book\'s own slip in a name is forgiven');
  assert.deepEqual(refsOf('Psalm 104: 13-14'), [{ b: 'PSA', c: 104, v: 13, e: 14 }]);
  assert.deepEqual(seeOf('Verlosser: sien Vrae 66, 108-109'), [66, 108, 109]);
  assert.deepEqual(seeOf('sien Vraag 566 e.v.'), [566]);
  console.log('catq.js: all checks passed (' + hb.questions + ' made-up questions)');
}

/* ---------------------------------------------------------------- the Church's own PDF */

async function real(file) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (e) {
    console.error('pdf.js for Node is not installed: run `npm install --no-save pdfjs-dist@5.4.624` in bible/ first.');
    process.exit(2);
  }
  const { readPages } = await import('../src/booklet.js');
  const pages = await readPages(pdfjs, new Uint8Array(fs.readFileSync(file)));
  if (!isQA(pages)) { console.error('That is not the Catechism in questions and answers.'); process.exit(1); }
  const hb = parseQA(pages);
  const qs = hb.chapters.filter(c => c.qn != null);
  console.log(`${hb.title} (${hb.language}), ${hb.edition}, ${hb.pages} pages, ${hb.questions} questions, ${hb.words} words`);
  for (const c of hb.chapters.filter(x => x.level === 1)) console.log(`  ${c.n}  ${c.title}, page ${c.page}: questions ${rangeOf(hb, c).join('–')}`);
  const kinds = {};
  for (const q of qs) for (const b of q.blocks) kinds[b.k] = (kinds[b.k] || 0) + 1;
  console.log('blocks:', JSON.stringify(kinds), '· questions with verses:', qs.filter(q => q.refs.length).length, '· pointing to others:', qs.filter(q => q.see.length).length);
  for (const n of [1, Math.round(qs.length / 2), qs.length]) {
    const q = questionOf(hb, n);
    if (!q) continue;
    console.log(`\n${q.qn}  ${q.title}`);
    for (const b of answerOf(q)) console.log(`  [${b.k}] ${b.text.slice(0, 160)}${b.ref ? '  — ' + b.ref : ''}`);
  }
  if (out) fs.writeFileSync(out, JSON.stringify(hb));
}

if (file) await real(file); else checks();

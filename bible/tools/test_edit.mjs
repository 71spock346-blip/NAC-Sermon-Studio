#!/usr/bin/env node
/*
 * Checks the rules for a card of the altar booklet changed by hand
 * (src/booklet.js restyle and editedRows, used by src/liturgy.js):
 *
 *   node tools/test_edit.mjs
 */
import assert from 'node:assert/strict';
import { restyle, editedRows } from '../src/booklet.js';

const prayer = [['“Our Father in heaven. Amen.”', ''], [' Matthew 6:9–13', 'is']];
const joined = prayer.map(r => r[0]).join('');

// text left alone keeps every run
assert.deepEqual(restyle(prayer, joined), prayer);
// a word changed in the plain part leaves the small italic reference as it was
assert.deepEqual(restyle(prayer, '“Our Father in the heavens. Amen.” Matthew 6:9–13'), [['“Our Father in the heavens. Amen.”', ''], [' Matthew 6:9–13', 'is']]);
// the reference changed stays small italic
assert.deepEqual(restyle(prayer, joined + ' NKJV'), [['“Our Father in heaven. Amen.”', ''], [' Matthew 6:9–13 NKJV', 'is']]);
// the reference taken away
assert.deepEqual(restyle(prayer, '“Our Father in heaven. Amen.”'), [['“Our Father in heaven. Amen.”', '']]);
// words added at the end of a note take its italics
assert.deepEqual(restyle([['Recommended words:', 'i']], 'Recommended words, said slowly:'), [['Recommended words, said slowly:', 'i']]);
// words put in at the start take the look of the first letters
assert.deepEqual(restyle([['Amen.', '']], 'And so: Amen.'), [['And so: Amen.', '']]);
// all new, or nothing before
assert.deepEqual(restyle([['a', 'i']], 'xyz'), [['xyz', 'i']]);
assert.deepEqual(restyle([], 'new'), [['new', '']]);
assert.deepEqual(restyle(prayer, ''), []);

const p = { k: 'p', d: 0, t: [['One.', '']] };
const note = { k: 'note', d: 0, t: [['Recommended:', 'i']] };
const li = { k: 'li', d: 2, t: [['Point', '']] };

// boxes back into rows: trimmed, a new line makes a new block of the same kind, an empty box is gone, a new box is a plain paragraph
assert.deepEqual(
  editedRows([{ label: ' Absolution ', sub: ['', ' (standing) '], boxes: [{ block: note, text: 'Recommended:' }, { block: p, text: 'One.\nTwo.' }, { block: li, text: '' }, { block: null, text: 'Added' }] }]),
  [{ label: 'Absolution', sub: ['(standing)'], blocks: [note, { k: 'p', d: 0, t: [['One.', '']] }, { k: 'p', d: 0, t: [['Two.', '']] }, { k: 'p', d: 0, t: [['Added', '']] }] }],
);
// a note split in two stays two notes; a list item keeps its depth
assert.deepEqual(
  editedRows([{ label: 'A', sub: [], boxes: [{ block: note, text: 'Recommended:\n\nAlso this' }, { block: li, text: 'Point one\nPoint two' }] }]),
  [{ label: 'A', sub: [], blocks: [note, { k: 'note', d: 0, t: [['Also this', 'i']] }, { k: 'li', d: 2, t: [['Point one', '']] }, { k: 'li', d: 2, t: [['Point two', '']] }] }],
);
// a row with nothing left is dropped; a label alone stays
assert.deepEqual(editedRows([{ label: '', sub: [], boxes: [{ block: p, text: '  \n ' }] }, { label: 'Benediction', sub: [], boxes: [] }]), [{ label: 'Benediction', sub: [], blocks: [] }]);
// what the parser made comes back unchanged through the boxes
const row = { label: 'The Lord’s Prayer', sub: [], blocks: [note, { k: 'p', d: 0, t: prayer }] };
assert.deepEqual(editedRows([{ label: row.label, sub: row.sub, boxes: row.blocks.map(b => ({ block: b, text: b.t.map(r => r[0]).join('') })) }]), [row]);

console.log('ok  restyle and editedRows');

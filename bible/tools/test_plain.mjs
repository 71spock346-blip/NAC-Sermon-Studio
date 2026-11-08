#!/usr/bin/env node
/*
 * Checks plain.js: the Guide's article in plain words, put back together
 * from the breakdown's pieces with the booklet's own paragraph breaks.
 *
 *   node tools/test_plain.mjs
 *
 * The article here is made up for the test; it is not the Church's text.
 */
import assert from 'node:assert/strict';
import { plainParts, paragraphsOf, paragraphOf } from '../src/plain.js';

const service = {
  message: 'God keeps His promise to those who wait for Him.',
  introduction: 'Waiting is hard. We want answers today.\n\nThe psalmist waited too, and he tells us how.',
  sections: [
    { heading: 'Waiting on the Lord', body: 'To wait on the Lord is to trust Him. It is not doing nothing.\n\nThe watchman waits for the morning. He knows it will come – it always has.' },
    { heading: 'Hope in His word', body: 'Hope rests on what God has said. His word does not fail.' },
  ],
  context: 'Psalm 130 is one of the songs of ascents. Pilgrims sang them on the way to Jerusalem.',
  summary: ['Wait on the Lord.', 'Hope in His word.'],
};
const piece = (heading, quote, said) => ({ heading, quote, said, insight: '', bible: [], catechism: [] });
const breakdown = { parts: [
  piece('Message', 'God keeps His promise to those who wait for Him.', 'God does what He said He would do, for the people who wait for Him.'),
  piece('Introduction', 'Waiting is hard.', 'It is hard to wait.'),
  piece('Introduction', 'We want answers today.', 'We want our answers now.'),
  piece('Introduction', 'The psalmist waited too, and he tells us how.', 'The man who wrote the psalm also had to wait. He tells us how he did it.'),
  piece('Waiting on the Lord', 'To wait on the Lord is to trust Him.', 'Waiting on the Lord means trusting Him.'),
  piece('Waiting on the Lord', 'It is not doing nothing.', 'It is not sitting still.'),
  piece('Waiting on the Lord', 'The watchman waits for the morning.', 'The guard waits for the morning.'),
  piece('Waiting on the Lord', 'He knows it will come — it always has.', 'He knows the morning will come. It always has.'),   // a dash of another kind: still found
  piece('Hope in His word', 'Hope rests on what God has said.', 'Hope stands on what God has said.'),
  piece('Hope in His word', 'His word does not fail.', ''),   // no plain words: left out
  piece('Context', 'Psalm 130 is one of the songs of ascents. Pilgrims sang them on the way to Jerusalem.', 'Psalm 130 is a pilgrim song. People sang it on the road to Jerusalem.'),
], thread: 'Wait on the Lord, and hope in His word.' };

// the paragraphs of the article, without the Summary box
const paras = paragraphsOf(service);
assert.equal(paras.length, 7);
assert.equal(paragraphOf(paras, 'We want answers today.'), 1);
assert.equal(paragraphOf(paras, '"He knows it will come" – it always has.'), 4);
assert.equal(paragraphOf(paras, 'Words that are not in the article.'), -1);
assert.equal(paragraphOf(paras, ''), -1);

// the article in plain words, with the booklet's breaks
const got = plainParts(breakdown, service);
assert.deepEqual(got.map(g => g.heading), ['Message', 'Introduction', 'Waiting on the Lord', 'Hope in His word', 'Context']);
assert.deepEqual(got[1].paragraphs, [
  'It is hard to wait. We want our answers now.',
  'The man who wrote the psalm also had to wait. He tells us how he did it.',
]);
assert.deepEqual(got[2].paragraphs, [
  'Waiting on the Lord means trusting Him. It is not sitting still.',
  'The guard waits for the morning. He knows the morning will come. It always has.',
]);
assert.deepEqual(got[3].paragraphs, ['Hope stands on what God has said.']);
assert.deepEqual(got[4].paragraphs, ['Psalm 130 is a pilgrim song. People sang it on the road to Jerusalem.']);

// without the article (or with the other edition's words): paragraphs of three under each heading
const blind = plainParts(breakdown, null);
assert.deepEqual(blind[2].paragraphs, [
  'Waiting on the Lord means trusting Him. It is not sitting still. The guard waits for the morning.',
  'He knows the morning will come. It always has.',
]);
assert.deepEqual(plainParts(breakdown, { sections: [{ heading: 'x', body: 'Something else entirely.' }] })[1].paragraphs, [
  'It is hard to wait. We want our answers now. The man who wrote the psalm also had to wait. He tells us how he did it.',
]);

// pieces whose words are not found go on with the paragraph before them; a found piece then settles where it stands
const mixed = plainParts({ parts: [
  piece('Introduction', 'Not in the booklet.', 'One.'),
  piece('Introduction', 'Waiting is hard.', 'Two.'),
  piece('Introduction', 'The psalmist waited too, and he tells us how.', 'Three.'),
] }, service);
assert.deepEqual(mixed[0].paragraphs, ['One. Two.', 'Three.']);

// nothing in, nothing out
assert.deepEqual(plainParts(null, service), []);
assert.deepEqual(plainParts({ parts: [piece('Message', 'x', '   ')] }, service), []);

console.log('plain.js: all checks passed');

#!/usr/bin/env node
/*
 * Checks the Bible search (src/search-lib.js) against the two translations
 * that travel with the app, and the typed references (src/books.js parseRef).
 *
 *   node tools/test_search.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOKS, parseRef } from '../src/books.js';
import { fold, plain, distance, wordPattern, parseQuery, makeCorpus, near, find, testFor, marks } from '../src/search-lib.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** A whole built-in translation as the search reads it: one row for each verse, in the order of the Bible. */
function load(id) {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, id, 'index.json'), 'utf8'));
  const rows = [];
  for (const b of BOOKS) {
    if (!index.books[b.id]) continue;
    const book = JSON.parse(fs.readFileSync(path.join(DATA, id, b.id + '.json'), 'utf8'));
    book.chapters.forEach((verses, c) => verses.forEach((text, v) => { if (text) rows.push({ book: b.id, chapter: c + 1, verse: v + 1, text }); }));
  }
  return makeCorpus(rows);
}
const at = h => `${h.book} ${h.chapter}:${h.verse}`;
const has = (out, place) => out.hits.some(h => at(h) === place);

/* ---- the small parts */
assert.equal(fold('Esegiël'), 'esegiel');
assert.equal(plain('The Lord’s name – “Holy”!'), 'the lord s name holy');
assert.equal(distance('sheperd', 'shepherd'), 1);
assert.equal(distance('jhon', 'john'), 1, 'two letters swapped count as one slip');
assert.equal(distance('love', 'hope', 1), 2, 'stops counting past the limit');
const finds = (typed, word, lang) => new RegExp('^' + wordPattern(typed, lang) + '$').test(word);
assert.ok(finds('love', 'loving') && finds('love', 'loveth') && finds('love', 'loved'));
assert.ok(finds('mercy', 'mercies') && finds('run', 'runneth') && finds('sin', 'sinned') && finds('give', 'given'));
assert.ok(finds('forgiv', 'forgiveness'), 'a long word finds every word that starts with it');
assert.ok(!finds('light', 'lightning') && !finds('bread', 'breadth'), 'a short word only takes its endings');
assert.ok(!finds('for', 'forest') && !finds('the', 'thee') && !finds('her', 'here') && !finds('go', 'god'), 'the small words find only themselves');
assert.ok(finds('your', 'thy') && finds('you', 'thee') && finds('believes', 'believeth') && finds('lord', 'yahweh'), 'today\'s English finds the King James\'s');
assert.ok(finds('berg', 'berge', 'af') && finds('kind', 'kinders', 'af') && finds('skaap', 'skape', 'af') && finds('kom', 'gekom', 'af') && finds('herder', 'herders', 'af'), 'Afrikaans endings for an Afrikaans text');
assert.ok(!finds('die', 'dies', 'af') && !finds('your', 'thy', 'af'));
assert.deepEqual(parseQuery('God\'s  "my shepherd" a 23 LOVE love').map(x => x.typed), ['god', 'my shepherd', 'love']);
assert.deepEqual(parseQuery('“my shepherd”')[0], { typed: 'my shepherd', words: ['my', 'shepherd'], exact: true }, 'a phone\'s curly quotes are quotes');
assert.deepEqual(parseQuery('  '), []);

/* ---- the King James Version */
let t0 = Date.now();
const kjv = load('kjv');
console.log(`KJV: ${kjv.rows.length} verses made ready in ${Date.now() - t0} ms`);
assert.ok(kjv.rows.length > 36000);

let out = find(kjv, 'shepherd want');
assert.equal(out.kind, 'all');
assert.ok(has(out, 'PSA 23:1'), '"shepherd want" finds Psalm 23:1');
assert.ok(out.hits.length < 10);

out = find(kjv, 'SHEPHERD,  Want!');
assert.ok(has(out, 'PSA 23:1'), 'capitals and punctuation do not count');

t0 = Date.now();
out = find(kjv, 'sheperd want');
console.log(`a spelling slip looked up in ${Date.now() - t0} ms (the first time counts the words of the Bible)`);
assert.equal(out.kind, 'all');
assert.deepEqual(out.fixed.map(x => x.typed), ['sheperd']);
assert.ok(out.fixed[0].used.includes('shepherd'));
assert.ok(has(out, 'PSA 23:1'), 'a spelling slip still finds the verse');

out = find(kjv, 'god so loved the world');
assert.equal(out.kind, 'all');
assert.deepEqual(out.hits.map(at), ['JHN 3:16']);

out = find(kjv, 'light world');
assert.ok(out.close >= 3 && out.close < out.hits.length, 'the verses with the words close together come first, then the others');
assert.deepEqual(out.hits.slice(0, out.close).map(at).filter(x => /^(MAT 5:14|JHN 8:12|JHN 9:5)$/.test(x)), ['MAT 5:14', 'JHN 8:12', 'JHN 9:5'], '"the light of the world" counts as close together');
assert.ok(!out.hits.slice(0, out.close).some(h => at(h) === 'JOB 18:18'), '"from light into darkness, and chased out of the world" does not');

out = find(kjv, 'love your neighbour as yourself');
assert.equal(out.kind, 'all', 'today\'s "your" and "yourself" find the King James\'s "thy" and "thyself"');
assert.ok(has(out, 'MAT 22:39') && has(out, 'LEV 19:18'));

out = find(kjv, 'he who believes in me');
assert.ok(has(out, 'JHN 11:25'), '"believes" finds "believeth", "who" finds "that"');

out = find(kjv, '"my shepherd"');
assert.deepEqual(out.hits.map(at), ['PSA 23:1', 'ISA 44:28', 'ZEC 13:7'], 'quotes: the words side by side, exactly');
assert.ok(out.hits.every(h => /my shepherd/.test(h.text)));
assert.ok(find(kjv, 'my shepherd').hits.length > 3, 'without quotes the words may stand apart');

out = find(kjv, 'trust in the lord with all your heart');
assert.equal(out.kind, 'all', 'the King James says "thine heart"');
assert.equal(at(out.hits[0]), 'PRO 3:5');

out = find(kjv, 'trust in the lord with your whole heart');
assert.equal(out.kind, 'closest', 'no verse has every one of these words');
assert.equal(at(out.hits[0]), 'PRO 3:5', 'the closest verse comes first');

out = find(kjv, 'love');
assert.ok(out.hits.some(h => /\bloving/i.test(h.text)) && out.hits.some(h => /\bloveth\b/i.test(h.text)), 'a word finds its endings');
assert.ok(!out.hits.some(h => !/lov/i.test(h.text)));
for (let i = 1; i < out.hits.length; i++) {
  const a = out.hits[i - 1], b = out.hits[i];
  const order = x => BOOKS.findIndex(k => k.id === x.book) * 1e6 + x.chapter * 1e3 + x.verse;
  assert.ok(order(a) < order(b), 'one word: the verses come in the order of the Bible');
}

out = find(kjv, 'xyzzyq');
assert.equal(out.kind, 'none');
assert.deepEqual(out.dropped, ['xyzzyq']);

out = find(kjv, 'shepherd xyzzyq');
assert.equal(out.kind, 'all', 'a word that is nowhere is left out, and said so');
assert.deepEqual(out.dropped, ['xyzzyq']);
assert.ok(has(out, 'PSA 23:1'));

assert.deepEqual(near(kjv, 'forgivness').slice(0, 1), ['forgiveness']);
assert.deepEqual(near(kjv, 'lod'), [], 'a word under four letters is not guessed at');
assert.ok(!near(kjv, 'worry').includes('sorry'), 'a guess keeps the first letter');

/* ---- marking the words found */
out = find(kjv, 'shepherd want');
const verse = out.hits.find(h => at(h) === 'PSA 23:1').text;
assert.deepEqual(marks(verse, out.test).map(([a, b]) => verse.slice(a, b)), ['shepherd', 'want']);
assert.deepEqual(marks('Die Here is my Herder, sê Esegiël.', testFor('herder esegiel', 'af')).map(([a, b]) => 'Die Here is my Herder, sê Esegiël.'.slice(a, b)), ['Herder', 'Esegiël']);

/* ---- an Afrikaans text, as a person pastes it in (these lines are made up for the test) */
const af = makeCorpus([
  { book: 'PSA', chapter: 23, verse: 1, text: 'Die herder sorg vir sy skape; hulle kom niks kort nie.' },
  { book: 'PSA', chapter: 23, verse: 2, text: 'Hy lei my na waters waar daar rus is.' },
  { book: 'JHN', chapter: 10, verse: 11, text: 'Die goeie herders ken hulle kinders en hulle skaap.' },
], 'af');
assert.deepEqual(find(af, 'herder skaap').hits.map(at), ['PSA 23:1', 'JHN 10:11']);
assert.deepEqual(find(af, 'kind').hits.map(at), ['JHN 10:11']);
out = find(af, 'herdr rus');
assert.equal(out.kind, 'closest');
assert.deepEqual(out.fixed.map(x => x.typed), ['herdr']);
assert.equal(testFor('a 1'), null);

/* ---- the World English Bible words it differently */
const web = load('web');
console.log(`WEB: ${web.rows.length} verses`);
out = find(web, 'shepherd lack nothing');
assert.ok(has(out, 'PSA 23:1'));
out = find(web, 'the lord is my shepherd');
assert.ok(has(out, 'PSA 23:1'), '"Lord" finds "Yahweh", as the World English Bible writes the name');
out = find(web, 'love your neighbour');
assert.deepEqual(out.fixed.map(x => x.typed), ['neighbour'], 'the World English Bible spells it "neighbor": the spelling is looked up');
assert.ok(has(out, 'MAT 22:39'));
t0 = Date.now();
for (let i = 0; i < 20; i++) find(web, 'light of the world');
console.log(`a search of four words takes ${Math.round((Date.now() - t0) / 20)} ms`);

/* ---- typed references */
const ref = (text, opts) => { const r = parseRef(text, opts); return r ? `${r.book} ${r.chapter}${r.verse ? ':' + r.verse + (r.verseEnd !== r.verse ? '-' + r.verseEnd : '') : ''}` : null; };
assert.equal(ref('Ps 130:7'), 'PSA 130:7');
assert.equal(ref('Psalm 57v10'), 'PSA 57:10');
assert.equal(ref('John 3:16-18'), 'JHN 3:16-18');
assert.equal(ref('Lukas 8:16'), 'LUK 8:16');
assert.equal(ref('1 Kor 13'), '1CO 13');
assert.equal(ref('Openb 21'), 'REV 21');
assert.equal(ref('Rev 21'), 'REV 21', '"Rev 21" is chapter 21, not chapter 1 verse 21');
assert.equal(ref('Lev 5'), 'LEV 5');
assert.equal(ref('Heb 11'), 'HEB 11');
assert.equal(ref('Rev 21:4'), 'REV 21:4');
assert.equal(ref('Joh 3.16'), 'JHN 3:16', 'a dot between chapter and verse');
assert.equal(ref('John 3 16'), 'JHN 3:16', 'a space between chapter and verse');
assert.equal(ref('Joh 3 vers 16'), 'JHN 3:16');
assert.equal(ref('John chapter 3 verse 16'), 'JHN 3:16');
assert.equal(ref('Hebr 4 v 12'), 'HEB 4:12');
assert.equal(ref('Gen 1 1-3'), 'GEN 1:1-3');
assert.equal(ref('Romans'), 'ROM 1');
assert.equal(ref('love'), null);
assert.equal(ref('Jesus wept'), null);
assert.equal(ref('7 churches'), null);
assert.equal(ref('Jhon 3:16'), null, 'the strict reading does not guess at a book');
assert.equal(ref('Jhon 3:16', { loose: true }), 'JHN 3:16', 'the reader\'s box forgives a slip in the book\'s name');
assert.equal(ref('Mathew 5:3', { loose: true }), 'MAT 5:3');
assert.equal(ref('Revelations 21', { loose: true }), 'REV 21');
assert.equal(ref('1 Corintians 13', { loose: true }), '1CO 13');
assert.equal(ref('Phillipians 4:13', { loose: true }), 'PHP 4:13');
assert.equal(ref('Genisis 1', { loose: true }), 'GEN 1');
assert.equal(ref('Johanes 3:16', { loose: true }), 'JHN 3:16');
assert.equal(ref('3 days', { loose: true }), null, 'a number and a word are not turned into a book');
assert.equal(ref('2 fish 5 loaves', { loose: true }), null);

console.log('The Bible search and the typed references: all checks passed.');

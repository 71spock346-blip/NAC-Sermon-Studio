#!/usr/bin/env node
// Checks how the app finds the verses a sermon names and keeps their words (src/verses.js), without a browser:  node tools/test_verses.mjs
import assert from 'node:assert/strict';
import { findRefs, quoteKey, isWord, wordText, refsToQuote, quotesFor, textsOf, wanted, langCode, sourceOrder, gather, MAX_VERSES } from '../src/verses.js';

let n = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const refs = text => findRefs(text).map(r => quoteKey(r));

test('the references in a main point, in order, as in the point Jerome sent', () => {
  const text = 'He came to us Himself in Jesus Christ (John 1:14). Jesus told Nicodemus we must be born again, which means getting a new start from God (John 3:3). '
    + '"If anyone is in Christ, he is a new creation" (2 Corinthians 5:17). So the new things begin with Jesus.';
  assert.deepEqual(refs(text), ['JHN.1.14', 'JHN.3.3', '2CO.5.17']);
  assert.equal(findRefs(text)[2].match, '2 Corinthians 5:17');
});

test('the ways a reference is written: abbreviations, a dot, a dash, "verse", a list after a comma', () => {
  assert.deepEqual(refs('See Ps. 23:1 and Rom 8:28-29, then 1 Cor 13:4–7 and Rev 21:5.'), ['PSA.23.1', 'ROM.8.28-29', '1CO.13.4-7', 'REV.21.5']);
  assert.deepEqual(refs('Read John 3 verse 16 and Matthew 5 v 3 to the children.'), ['JHN.3.16', 'MAT.5.3']);
  assert.deepEqual(refs('Compare John 3:16, 18, 20-21 with the rest.'), ['JHN.3.16', 'JHN.3.18', 'JHN.3.20-21']);
  assert.deepEqual(refs('As Paul says (Galatians 5:22; Ephesians 2:8-9).'), ['GAL.5.22', 'EPH.2.8-9']);
  assert.deepEqual(refs('I John 4:8 says God is love.'), ['1JN.4.8']);
  assert.deepEqual(refs('the Gospel of John 1:1 and the Song of Solomon 2:1'), ['JHN.1.1', 'SNG.2.1']);
});

test('Afrikaans names and abbreviations', () => {
  const text = 'Hy het self na ons gekom (Johannes 1:14). Ons moet weer gebore word (Joh 3:3). "Iemand wat aan Christus behoort, is \'n nuwe mens" (2 Korintiërs 5:17). Lees ook Ps 23:1-3, Openb 21:5, Matt 5:3 en 1 Kor 13:13.';
  assert.deepEqual(refs(text), ['JHN.1.14', 'JHN.3.3', '2CO.5.17', 'PSA.23.1-3', 'REV.21.5', 'MAT.5.3', '1CO.13.13']);
  assert.deepEqual(refs('Spreuke 3:5-6 en Hebreërs 11:1 en Op 22:20 en Johannes 3 vers 16'), ['PRO.3.5-6', 'HEB.11.1', 'REV.22.20', 'JHN.3.16']);
});

test('a slip in the book\'s name is forgiven; a word of the sentence, a time or a Catechism number is not a verse', () => {
  assert.deepEqual(refs('as Jhon 3:16 says and Revelations 21:5 promises'), ['JHN.3.16', 'REV.21.5']);
  assert.deepEqual(refs('The answer is 3:16 and he 11:1; we meet at 10:30 on Sunday 9:30.'), []);
  assert.deepEqual(refs('Catechism 3.4.9 and CNAC 9:6 and the year 2026:1'), []);
  assert.deepEqual(refs('John 3 and Psalm 23 are chapters, not verses.'), []);
  assert.deepEqual(refs('John 3:16, 2 Corinthians 5:17'), ['JHN.3.16', '2CO.5.17']);
});

test('keys, and a passage too long to write out', () => {
  assert.equal(quoteKey({ book: 'JHN', chapter: 3, verse: 16, verseEnd: 16 }), 'JHN.3.16');
  assert.equal(quoteKey({ book: 'JHN', chapter: 3, verse: 16, verseEnd: 18 }), 'JHN.3.16-18');
  assert.equal(MAX_VERSES, 6);
  assert.deepEqual(refsToQuote('Luke 15:11-16 fits, and John 11:35 twice: John 11:35').map(r => r.key), ['LUK.15.11-16', 'JHN.11.35']);
  assert.deepEqual(refsToQuote('Luke 15:11-17 does not').map(r => r.key), []);
  const seen = new Set();
  assert.deepEqual(refsToQuote('John 3:16 and Romans 8:28.', { seen }).map(r => r.key), ['JHN.3.16', 'ROM.8.28']);
  assert.deepEqual(refsToQuote('John 3:16 again, and Romans 8:28-29.', { seen }).map(r => r.key), ['ROM.8.28-29']);
});

test('the text word, where a part names it, comes from step 1 as it stands there', () => {
  const s = { ref: { book: 'REV', chapter: 21, verse: 5, verseEnd: 5 }, text: '5 And he that sat upon the throne said, Behold, I make all things new.', translation: 'KJV', quotes: {} };
  assert.equal(isWord({ book: 'REV', chapter: 21, verse: 5, verseEnd: 5 }, s), true);
  assert.equal(isWord({ book: 'REV', chapter: 21, verse: 4, verseEnd: 5 }, s), false);
  assert.equal(isWord({ book: 'REV', chapter: 21, verse: 5, verseEnd: 5 }, { ...s, text: '' }), false);
  assert.equal(wordText(s), 'And he that sat upon the throne said, Behold, I make all things new.');
  const two = { ref: { book: 'PSA', chapter: 23, verse: 1, verseEnd: 2 }, text: '1 The LORD is my shepherd; I shall not want. 2 He maketh me to lie down' };
  assert.equal(wordText(two), '1 The LORD is my shepherd; I shall not want. 2 He maketh me to lie down');
  const q = quotesFor('As our text says (Revelation 21:5), and (Revelation 21:6).', s);
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].key, q[0].text, q[0].short, q[0].source], ['REV.21.5', 'And he that sat upon the throne said, Behold, I make all things new.', 'KJV', 'word']);
  assert.deepEqual(wanted({ ...s, intro: 'Revelation 21:5 and Revelation 21:6' }).map(r => r.key), ['REV.21.6']);
});

test('the other verses come from s.quotes, in the order of the text; one without words is left out', () => {
  const s = {
    ref: { book: 'REV', chapter: 21, verse: 5, verseEnd: 5 }, text: '',
    translation: 'NKJV',
    quotes: {
      'JHN.1.14': { book: 'JHN', chapter: 1, verse: 14, verseEnd: 14, text: 'NKJV test words for John 1:14', short: 'NKJV', lang: 'en', source: 'api:x' },
      'JHN.3.3': { book: 'JHN', chapter: 3, verse: 3, verseEnd: 3, text: 'WEB test words for John 3:3', short: 'WEB', lang: 'en', source: 'web' },
    },
  };
  const q = quotesFor('See (2 Corinthians 5:17), then (John 3:3) and (John 1:14), and John 3:3 again.', s);
  assert.deepEqual(q.map(x => x.key), ['JHN.3.3', 'JHN.1.14']);
  assert.equal(q[0].short, 'WEB');
  assert.equal(q[1].text, 'NKJV test words for John 1:14');
  assert.deepEqual(quotesFor('Revelation 21:5', s), []);   // the text word with no words in step 1: none yet
  assert.deepEqual(quotesFor('', s), []);
});

test('every text of a preparation is looked through, and every verse is fetched once', () => {
  const s = {
    ref: { book: 'REV', chapter: 21, verse: 5, verseEnd: 5 }, text: 'Behold, I make all things new.',
    core: 'All things new (Isaiah 43:19)', guide: '', intro: 'We open with Isaiah 43:19.', context: 'John wrote on Patmos (Revelation 1:9).', keywords: '',
    application: '', summary: '', conclusion: 'Back to Revelation 21:5 and Isaiah 43:19.', illustrations: '', crossRefs: 'Romans 8:28 – all things',
    points: [{ heading: 'One', body: 'John 1:14 here', weave: { body: 'John 1:14 and John 3:3 woven' } }, null, { heading: '', body: '' }],
    build: { intro: { text: 'Psalm 23:1' }, points: [{ body: '2 Corinthians 5:17' }], application: 'Micah 6:8', conclusion: '', illustrations: [{ body: 'Luke 15:20' }], lighter: { text: '' } },
    ai: { points: [{ body: 'Galatians 2:20' }], application: '', crossRefs: [{ reference: 'Ephesians 2:8', why: 'grace' }], context: [{ answer: 'Hebrews 11:1' }], keywords: [{ meaning: 'see James 1:5' }] },
  };
  assert.equal(textsOf(s).length, 16);   // 5 boxes with text, a point and its woven text, 4 parts of the outline, 5 of the suggestions
  assert.deepEqual(wanted(s).map(r => r.key), ['ISA.43.19', 'REV.1.9', 'ROM.8.28', 'JHN.1.14', 'JHN.3.3', 'PSA.23.1', '2CO.5.17', 'MIC.6.8', 'LUK.15.20', 'GAL.2.20', 'EPH.2.8', 'HEB.11.1', 'JAS.1.5']);
  assert.deepEqual(wanted({ intro: 'nothing here' }), []);
});

test('the language of a source, however it names it', () => {
  assert.equal(langCode('af'), 'af');
  assert.equal(langCode('Afrikaans'), 'af');
  assert.equal(langCode('en-ZA'), 'en');
  assert.equal(langCode('English'), 'en');
  assert.equal(langCode('Engels'), 'en');
  assert.equal(langCode('Deutsch'), '');
  assert.equal(langCode(''), '');
});

const ALL = [
  { id: 'kjv', short: 'KJV', lang: 'en', builtin: true },
  { id: 'web', short: 'WEB', lang: 'en', builtin: true },
  { id: 'mine:afr83', short: 'AFR83', lang: 'af', provider: 'mine' },
  { id: 'mine:afr53', short: 'AFR53', lang: 'af', provider: 'mine' },
  { id: 'api:nkjv', short: 'NKJV', lang: 'English', provider: 'api' },
  { id: 'yv:111', short: 'NIV', lang: 'en', provider: 'yv' },
];

test('the Bibles to read from: the text word\'s first, then the sermon\'s language, then English, WEB and KJV last', () => {
  assert.deepEqual(sourceOrder(ALL, { translationId: 'api:nkjv', reader: 'kjv', lang: 'en' }), ['api:nkjv', 'kjv', 'yv:111', 'web']);
  assert.deepEqual(sourceOrder(ALL, { translationId: '', translation: 'NKJV', reader: 'kjv', lang: 'en' }), ['api:nkjv', 'kjv', 'yv:111', 'web']);   // a Guide's text word names its Bible only
  assert.deepEqual(sourceOrder(ALL, { translationId: 'mine:afr83', reader: 'api:nkjv', lang: 'af' }), ['mine:afr83', 'mine:afr53', 'api:nkjv', 'yv:111', 'web', 'kjv']);
  assert.deepEqual(sourceOrder(ALL, { translationId: '', translation: 'AFR53', reader: 'kjv', lang: 'af' }), ['mine:afr53', 'mine:afr83', 'kjv', 'api:nkjv', 'yv:111', 'web']);
  assert.deepEqual(sourceOrder(ALL.slice(0, 2), { translationId: 'api:gone', translation: 'NKJV', lang: 'af' }), ['web', 'kjv']);   // nothing but the bundled two
});

/** A pretend Bible: what each source has, by key; fetch() answers from the first source of the list that has it, as bible.js versesFrom does. */
function bible(has) {
  const asked = [];
  const fetch = async (ids, r) => {
    asked.push([quoteKey(r), ids.join(' ')]);
    for (const id of ids) {
      const text = (has[id] || {})[quoteKey(r)];
      if (text) return { text, short: id.toUpperCase(), lang: id.includes('afr') ? 'af' : 'en', source: id };
    }
    return null;
  };
  return { fetch, asked };
}

test('gather: fetches what is missing, keeps what it has, lets go of what is no longer named', async () => {
  const s = { ref: null, intro: 'John 1:14 and John 3:3 and John 22:5', quotes: { 'JHN.3.3': { text: 'old', source: 'web', lang: 'en' }, 'ROM.8.28': { text: 'gone', source: 'web' } } };
  const b = bible({ web: { 'JHN.1.14': 'The Word became flesh.' } });
  const notFound = new Set();
  assert.equal(await gather(s, { ids: ['web', 'kjv'], fetch: b.fetch, notFound, now: () => 'T' }), true);
  assert.deepEqual(Object.keys(s.quotes).sort(), ['JHN.1.14', 'JHN.3.3']);
  assert.deepEqual(s.quotes['JHN.1.14'], { book: 'JHN', chapter: 1, verse: 14, verseEnd: 14, text: 'The Word became flesh.', short: 'WEB', lang: 'en', source: 'web', at: 'T' });
  assert.deepEqual([...notFound], ['JHN.22.5']);
  b.asked.length = 0;
  assert.equal(await gather(s, { ids: ['web', 'kjv'], fetch: b.fetch, notFound }), false);
  assert.deepEqual(b.asked, []);   // nothing new to fetch, and John 22:5 is not asked for again on this visit
});

test('gather with upgrade: a better Bible is asked again, only the ones above; a Bible this device lacks is kept in the sermon\'s language', async () => {
  const ids = ['mine:afr83', 'api:nkjv', 'web', 'kjv'];
  const s = { lang: 'af', intro: 'Johannes 1:14, Johannes 3:3, Romeine 8:28 en Psalm 23:1', quotes: {
    'JHN.1.14': { text: 'The Word became flesh.', source: 'web', lang: 'en' },
    'JHN.3.3': { text: 'NKJV test words for John 3:3', source: 'api:nkjv', lang: 'en' },
    'ROM.8.28': { text: 'AFR53-toetswoorde vir Romeine 8:28', source: 'mine:afr53', lang: 'af' },   // pasted on the other device only
    'PSA.23.1': { text: 'AFR83-toetswoorde vir Psalm 23:1', source: 'mine:afr83', lang: 'af' },
  } };
  const b = bible({ 'mine:afr83': { 'JHN.1.14': 'AFR83-toetswoorde vir Johannes 1:14' }, 'api:nkjv': { 'JHN.1.14': 'NKJV test words for John 1:14', 'JHN.3.3': 'NKJV test words for John 3:3' } });
  assert.equal(await gather(s, { ids, fetch: b.fetch, lang: 'af', upgrade: false }), false);
  assert.deepEqual(b.asked, []);
  assert.equal(await gather(s, { ids, fetch: b.fetch, lang: 'af', upgrade: true }), true);
  assert.deepEqual(b.asked, [['JHN.1.14', 'mine:afr83 api:nkjv'], ['JHN.3.3', 'mine:afr83']]);
  assert.equal(s.quotes['JHN.1.14'].text, 'AFR83-toetswoorde vir Johannes 1:14');
  assert.equal(s.quotes['JHN.3.3'].source, 'api:nkjv');   // AFR83 does not have it: kept as it was
  assert.equal(s.quotes['ROM.8.28'].source, 'mine:afr53');
  // the sermon now in English: the Afrikaans verse from a Bible this device lacks is fetched again in English
  const en = { intro: 'Romans 8:28', quotes: { 'ROM.8.28': { text: 'AFR53-toetswoorde vir Romeine 8:28', source: 'mine:afr53', lang: 'af' } } };
  const b2 = bible({ web: { 'ROM.8.28': 'WEB test words for Romans 8:28' } });
  assert.equal(await gather(en, { ids: ['web', 'kjv'], fetch: b2.fetch, lang: 'en', upgrade: true }), true);
  assert.equal(en.quotes['ROM.8.28'].source, 'web');
});

for (const [name, fn] of tests) { await fn(); n++; console.log('ok  ', name); }
console.log(`\n${n} checks passed`);

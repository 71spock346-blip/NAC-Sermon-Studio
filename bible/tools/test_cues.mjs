#!/usr/bin/env node
// Checks the words the app puts on the cue cards (src/cues.js) without a browser:  node tools/test_cues.mjs
import assert from 'node:assert/strict';
import { cuePhrase, autoCues, splitCues, cueLine, cueParts, cuesOf, mainThoughts, sentences } from '../src/cues.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ', name); };

test('one cue for a sentence: the words that carry it, the lead-in gone', () => {
  const en = [
    ['We cannot always get up by our own strength.', 'Cannot always get up by our own strength'],
    ['The moon has no light of its own: The moon is just rock and dust.', 'Moon has no light of its own'],
    ['Yet on a clear night it lights up the whole veld, because the sun shines on it.', 'Clear night it lights up the whole veld'],
    ['the same way: God\'s glory is risen upon us.', 'God\'s glory is risen upon us'],
    ['If we think of Elijah.', 'Think of Elijah'],
    ['Have you noticed?', 'Noticed?'],
    ['And those of us who have: who was that angel?', 'Angel?'],
    ['When Jesus died on the cross, it looked like total defeat.', 'Jesus died on the cross'],
    ['Our faith can falter.', 'Faith can falter'],
    ['Let us arise!', 'Arise!'],
    ['Never give up.', 'Never give up'],
    ['All is well.', 'All is well'],
    ['The Israelites came back from Babylon and found Jerusalem in ruins.', 'Israelites came back from Babylon'],
    ['They got up and rebuilt the city and the temple.', 'Got up and rebuilt the city'],
    ['The problem is when we stay down.', 'Problem is when we stay down'],
    ['However, the light comes from God.', 'Light comes from God'],
    ['Jesus is the way.', 'Jesus is the way'],
    ['He forgives, He strengthens, He lets His light shine through us.', 'Forgives, He strengthens'],
    ['The question is this: do we get up?', 'Get up?'],
  ];
  for (const [sentence, cue] of en) assert.equal(cuePhrase(sentence, 'en'), cue, sentence);
  const af = [
    ['Ons kan nie altyd uit eie krag opstaan nie.', 'Nie altyd uit eie krag opstaan nie'],
    ['Die maan het geen lig van sy eie nie: dit is net klip en stof.', 'Maan het geen lig van sy eie nie'],
    ['Laat ons opstaan!', 'Opstaan!'],
    ['As ons aan Elia dink.', 'Elia dink'],
    ['Toe Jesus aan die kruis gesterf het, het dit soos \'n nederlaag gelyk.', 'Jesus aan die kruis gesterf het'],
    ['\'n Mens se geloof kan wankel.', 'Geloof kan wankel'],
  ];
  for (const [sentence, cue] of af) assert.equal(cuePhrase(sentence, 'af'), cue, sentence);
  assert.equal(cuePhrase('', 'en'), '');
  assert.equal(cuePhrase('   ', 'en'), '');
});

test('the cues of a text: one from each line, or three from one paragraph', () => {
  const list = 'We cannot always get up by our own strength.\n- If we think of Elijah.\nLet us arise!';
  assert.deepEqual(autoCues(list, 'en'), ['Cannot always get up by our own strength', 'Think of Elijah', 'Arise!']);
  const para = 'The Israelites came back from Babylon and found Jerusalem in ruins. They got up and rebuilt the city and the temple. The problem is when we stay down.';
  assert.deepEqual(autoCues(para, 'en'), ['Israelites came back from Babylon', 'Got up and rebuilt the city', 'Problem is when we stay down']);
  assert.deepEqual(autoCues('', 'en'), []);
  assert.deepEqual(sentences('Rom. 8 says so. We believe it.'), ['Rom. 8 says so.', 'We believe it.'], 'a short form does not end a sentence');
  assert.equal(sentences('Yes! Arise. Shine?').length, 3);
});

test('the cues the minister typed: between the # marks, however he spaces them', () => {
  assert.deepEqual(splitCues('# Israelites from Babylon, Jerusalem in ruins # got up, rebuilt city & and temple # problem when we stay down.'),
    ['Israelites from Babylon, Jerusalem in ruins', 'got up, rebuilt city & and temple', 'problem when we stay down.']);
  assert.deepEqual(splitCues('Light#Dark #  Moon'), ['Light', 'Dark', 'Moon']);
  assert.deepEqual(splitCues('one\ntwo'), ['one', 'two']);
  assert.deepEqual(splitCues(' # # '), []);
  assert.deepEqual(splitCues(''), []);
  assert.deepEqual(splitCues(null), []);
  assert.equal(cueLine(['Light', 'Dark', 'Moon']), '# Light # Dark # Moon');
  assert.equal(cueLine([]), '');
});

test('the parts of the cards: his own cues first, the app\'s while a line is empty, the Guide\'s introduction while his is empty', () => {
  const s = {
    intro: '',
    points: [
      { heading: 'Arise!', body: 'We cannot always get up by our own strength.\nIf we think of Elijah.', thought: 'And have you noticed how Angels are the ones who come to administer whenever strength is needed, how often do we pray.' },
      { heading: 'Shine!', body: 'Our light comes from Him.', cues: '# Candle # Mirror' },
      { heading: '', body: '' },
      { heading: '', body: 'Only a first line.\nAnd a second one.' },
    ],
    application: 'Get up this week. Help someone up.',
    conclusion: '',
    cues: { intro: '', application: '', conclusion: '# Altar # Communion' },
  };
  const service = { introduction: 'The Israelites came back from Babylon and found Jerusalem in ruins.\nThey got up and rebuilt the city.\n\nThe problem is when we stay down.' };
  const parts = cueParts(s, { service, lang: 'en' });
  assert.deepEqual(parts.map(p => p.key), ['intro', 'point', 'point', 'point', 'application', 'conclusion']);
  assert.equal(parts[0].guide, true, 'the Guide\'s introduction stands in');
  assert.deepEqual(cuesOf(parts[0]), ['Israelites came back from Babylon', 'Problem is when we stay down'], 'one cue from each paragraph of the Guide\'s introduction');
  assert.deepEqual(cuesOf(parts[1]), ['Cannot always get up by our own strength', 'Think of Elijah', 'Noticed how Angels'], 'his thought gives the last cue');
  assert.deepEqual(cuesOf(parts[2]), ['Candle', 'Mirror'], 'his own cues win');
  assert.deepEqual(parts[2].auto, ['Light comes from Him'], 'and the app\'s are still known, for the Fill in button');
  assert.equal(parts[3].heading, 'Only a first line.', 'a point without a heading is headed by its first line');
  assert.deepEqual(cuesOf(parts[3]), ['Second one']);
  assert.deepEqual(cuesOf(parts[4]), ['Get up this week', 'Help someone up']);
  assert.deepEqual(cuesOf(parts[5]), ['Altar', 'Communion'], 'typed cues print even where the text is empty');
  assert.equal(parts[1].i, 0);
  assert.equal(parts[3].i, 3, 'a point keeps its place in the list');
  // his own introduction, once written, takes the Guide's place
  const own = cueParts({ ...s, intro: 'A question to begin with. Then the text.' }, { service, lang: 'en' });
  assert.equal(own[0].guide, false);
  assert.deepEqual(cuesOf(own[0]), ['Question to begin with', 'Text']);
  // without a Guide and without text, the introduction has no cues, but is still a line to type in
  const bare = cueParts({ points: [] }, { lang: 'en' });
  assert.deepEqual(bare.map(p => p.key), ['intro', 'application', 'conclusion']);
  assert.deepEqual(cuesOf(bare[0]), []);
});

console.log(`${n} tests passed`);

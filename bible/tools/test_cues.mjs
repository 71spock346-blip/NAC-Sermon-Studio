#!/usr/bin/env node
// Checks the words the app puts on the cue cards (src/cues.js) without a browser:  node tools/test_cues.mjs
import assert from 'node:assert/strict';
import { cuePhrase, autoCues, splitCues, cueLine, cueParts, cuesOf, mainThoughts, sentences, cuesNotIn, sameCues, textSig, setOwn, keepOwn, ownLine } from '../src/cues.js';

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
  assert.deepEqual(parts[2].auto, ['Light comes from Him'], 'and the app\'s are still known, for "From the text"');
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

test('the cards follow the sermon: own cues that are not in the text now are stale, until they are kept or the text\'s are taken', () => {
  // the lines were filled in from a morning introduction; the sermon became the evening's
  const morning = '# Good morning, brothers and sisters # Morning God says something much bigger # Started, with you and with me';
  const s = {
    intro: 'Good evening, brothers and sisters, and a warm welcome. Tonight an old man on an island hears a voice say: "I make all things new." God has already started, with you and with me.',
    points: [
      { heading: 'A new start', body: 'Every new house starts with a foundation. They got up and rebuilt the city and the temple.', cues: '# got up, rebuilt city and temple' },
      { heading: 'Light', body: 'Our light comes from Him.', cues: '# Candle # Mirror' },
    ],
    application: 'Pray for one neighbour this week.', conclusion: '',
    cues: { intro: morning },
  };
  let parts = cueParts(s, { lang: 'en' });
  assert.deepEqual(parts[0].missing, ['Good morning, brothers and sisters', 'Morning God says something much bigger'], 'the morning cues are not in the evening\'s text');
  assert.equal(parts[0].stale, true);
  assert.deepEqual(cuesOf(parts[0]), splitCues(morning), 'the own line still prints until the minister says otherwise');
  assert.equal(parts[1].stale, false, 'own words that are in the text are fine, in other forms too');
  assert.equal(parts[2].stale, true, 'own picture words that the text does not have, written before the text was signed');
  assert.equal(parts[3].stale, false, 'a line of the app\'s is never stale');

  // "From the text": the line is the app's again and says what the text says now, and changes with it
  setOwn(s, parts[0], '');
  assert.equal(ownLine(s, parts[0]), '');
  assert.equal(s.cues.intro, undefined, 'nothing is kept for a line of the app\'s');
  parts = cueParts(s, { lang: 'en' });
  assert.deepEqual(cuesOf(parts[0]), autoCues(s.intro, 'en'));
  assert.equal(cuesOf(parts[0])[0], 'Good evening, brothers and sisters', 'the cards say what the sermon says');
  s.intro = 'Good afternoon, friends. God makes all things new.';
  assert.deepEqual(cuesOf(cueParts(s, { lang: 'en' })[0]), ['Good afternoon, friends', 'God makes all things new'], 'the app\'s line follows the text');

  // "Keep these": the own cues stay, and are not stale again until the text changes
  keepOwn(s, parts[2]);
  assert.equal(s.points[1].cuesFor, textSig('Light\nOur light comes from Him.'));
  assert.equal(cueParts(s, { lang: 'en' })[2].stale, false);
  s.points[1].body = 'Our light comes from Him, as the moon has it from the sun.';
  assert.equal(cueParts(s, { lang: 'en' })[2].stale, true, 'the text changed and Candle is still not in it');

  // a line typed now is an own line, for the text as it is now: not stale while the text stays as it is
  parts = cueParts(s, { lang: 'en' });
  assert.equal(parts[3].key, 'application');
  setOwn(s, parts[3], '# Neighbour # A whole street');
  assert.equal(s.cues.application, '# Neighbour # A whole street');
  assert.equal(cueParts(s, { lang: 'en' })[3].stale, false, 'written for this text');
  s.application = 'Pray for your family this week.';
  const now = cueParts(s, { lang: 'en' })[3];
  assert.equal(now.stale, true);
  assert.deepEqual(now.missing, ['Neighbour', 'A whole street']);

  // a point's own line lives on the point
  setOwn(s, parts[1], '');
  assert.equal('cues' in s.points[0], false);
  assert.equal('cuesFor' in s.points[0], false);
});

test('a cue is in a text when its words that carry meaning are: other endings count, little words do not', () => {
  const text = 'He says we started to rebuild. The problem is when we stay down. God\'s light shines on a brand-new day.';
  assert.deepEqual(cuesNotIn(['Say', 'Start again', 'Start the race', 'Rebuilt', 'Problem when we stay down', 'God\'s light', 'New day', 'The', 'Problem is when we give up'], text, 'en'), ['Start the race', 'Problem is when we give up']);
  assert.deepEqual(cuesNotIn(['Good morning, brothers and sisters'], 'Good evening, brothers and sisters', 'en'), ['Good morning, brothers and sisters']);
  assert.deepEqual(cuesNotIn(['God'], 'Be good to each other', 'en'), ['God'], 'God is not good');
  assert.deepEqual(cuesNotIn(['Son'], 'Sing a new song', 'en'), ['Son'], 'a short word only as it is, or with an s');
  assert.deepEqual(cuesNotIn(['Sons'], 'He sent His Son', 'en'), []);
  assert.deepEqual(cuesNotIn(['Goeie môre, broers en susters'], 'Goeie naand, broers en susters', 'af'), ['Goeie môre, broers en susters'], 'in Afrikaans too');
  assert.deepEqual(cuesNotIn(['Opstaan in eie krag'], 'Ons kan nie altyd uit eie krag opstaan nie.', 'af'), []);
  assert.deepEqual(cuesNotIn([], 'anything', 'en'), []);
});

test('lines and texts compared: the same cues however they are spaced; a text\'s signature leaves the spacing aside', () => {
  assert.equal(sameCues('#A #  B', ['A', 'B']), true);
  assert.equal(sameCues('# A # B', '# A # C'), false);
  assert.equal(sameCues('', []), true);
  assert.equal(textSig(' one  two\nthree '), textSig('one two three'));
  assert.notEqual(textSig('Good morning'), textSig('Good evening'));
  assert.equal(textSig(''), '');
});

console.log(`${n} tests passed`);

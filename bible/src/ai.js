/*
 * The AI helper: Claude, Anthropic's model, called straight from this browser.
 *
 * The app has no server, so the person's own Anthropic key (Settings → AI
 * helper, kept on the device like the Bible keys, never in a backup) goes with
 * each request to api.anthropic.com. Two jobs live here:
 *
 *   readGuide(file)   a monthly Divine Service Guide (PDF) comes back as one
 *                     entry per service, copied word for word
 *   suggest(s, …)     for one preparation: answers to the context questions,
 *                     key words, Catechism sections, cross references and a
 *                     few sermon thoughts, drawn from the text, the Guide's
 *                     article and the Catechism
 *   outline(s, …)     for the same preparation: how the sermon is best built
 *                     from all of that: introduction, main points,
 *                     application, conclusion and illustrations
 *
 * Both ask for an answer in a fixed JSON shape, streamed so a long answer does
 * not time out. What is sent (the Guide, the Catechism sections, the text and
 * the person's notes) is processed by Anthropic to answer; nothing of it goes
 * onto the public site.
 *
 * The suggestions are shaped for the minister and the people in front of him:
 * every answer comes in short sentences and everyday words (he reads it on a
 * phone and preaches freely), the age group and a line about the congregation
 * on the preparation steer the pictures and the application, humour is
 * offered to the degree he chose (never at a funeral or a service for the
 * departed), and his own note on how he preaches (Settings → AI helper) is
 * followed. Each preparation can also pick its own language.
 */
import { state } from './store.js';
import { parseRef, formatRef } from './books.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';

const API = 'https://api.anthropic.com/v1';
const API_VERSION = '2026-10-21';

/* The models offered in Settings, with their list prices (US dollars per million tokens) for the cost line. */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'the most capable; the default', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'quicker and about half the price', input: 2, output: 10 },
];
export const LANGS = [['en', 'English'], ['af', 'Afrikaans']];

/* Who is listening: the age groups a preparation can name. '' is an ordinary mixed congregation. */
export const AUDIENCES = [
  ['', 'All ages together'],
  ['children', 'Children'],
  ['youth', 'Young people (teens)'],
  ['young-adults', 'Young adults'],
  ['families', 'Families with children'],
  ['older', 'Mostly older members'],
];
/* How much humour the suggestions may carry. The standing choice is in Settings; a preparation can differ. */
export const HUMOUR = [
  ['none', 'None'],
  ['some', 'A little, where it fits'],
  ['more', 'A bit more'],
];
const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES);
const HUMOUR_LABEL = Object.fromEntries(HUMOUR);

/** The language the suggestions for this preparation come in: its own choice, else the setting. */
export function langOf(s) {
  const own = s && s.lang;
  if (own === 'en' || own === 'af') return own;
  return state.settings.aiLang === 'af' ? 'af' : 'en';
}

/** The age group a preparation speaks to: its own choice, else what the occasion says. */
export function audienceOf(s) {
  if (s && s.audience && AUDIENCE_LABEL[s.audience] !== undefined) return s.audience;
  const occ = (s && s.occasion) || '';
  if (/youth|jeug/i.test(occ)) return 'youth';
  if (/children|kinder/i.test(occ)) return 'children';
  return '';
}

export function audienceLabel(id) { return AUDIENCE_LABEL[id] || AUDIENCES[0][1]; }

/** How much humour this preparation may carry: none at a funeral or a service for the departed, else its own choice, else the setting. */
export function humourOf(s) {
  if (/departed|funeral|ontslapene|begrafnis/i.test((s && s.occasion) || '')) return 'none';
  if (s && s.humour && HUMOUR_LABEL[s.humour]) return s.humour;
  return HUMOUR_LABEL[state.settings.aiHumour] ? state.settings.aiHumour : 'some';
}

export function humourLabel(id) { return HUMOUR_LABEL[id] || HUMOUR_LABEL.some; }

export function ready() { return !!(state.settings.aiKey || '').trim(); }

export function model() {
  return MODELS.find(m => m.id === state.settings.aiModel) || MODELS[0];
}

export function modelLabel(id) {
  const m = MODELS.find(x => x.id === id);
  return m ? m.label : (id || 'Claude');
}

function headers() {
  const key = (state.settings.aiKey || '').trim();
  if (!key) throw new Error('Add your Anthropic key under Settings → AI helper first.');
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',   // the API only answers a browser that says so
    'anthropic-beta': 'server-side-fallback-2026-07-01',     // a request the safety filter declines is retried on another Claude model
  };
}

/** The API's error body as one plain sentence. */
function apiError(status, text) {
  let msg = '';
  try { msg = JSON.parse(text).error.message || ''; } catch (e) { msg = ''; }
  if (status === 401) return new Error('Anthropic did not accept the key. Check it under Settings → AI helper.');
  if (status === 403) return new Error('This key is not allowed to do that. Make a new key at console.anthropic.com.');
  if (status === 429) return new Error('Anthropic is busy or your limit is reached for now. Wait a minute and try again.');
  if (status === 529 || /overloaded/i.test(msg)) return new Error('Anthropic is overloaded right now. Try again in a minute.');
  if (/credit|balance|billing/i.test(msg)) return new Error('Your Anthropic account has no credit left. Add credit under Billing at console.anthropic.com.');
  return new Error(msg ? `Anthropic: ${msg}` : `Anthropic error ${status}`);
}

/** Roughly what a finished request cost, in US dollars, from the usage the API reports. */
export function cost(usage, modelId) {
  const m = MODELS.find(x => x.id === modelId) || model();
  if (!usage) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) * 0.1;
  return (inTok * m.input + (usage.output_tokens || 0) * m.output) / 1e6;
}

export function fmtCost(c) {
  if (!c) return '';
  return c < 0.01 ? 'under 1 US cent' : `about $${c.toFixed(2)}`;
}

/** Does the key work? Lists the models it may use. */
export async function checkKey() {
  let r;
  try { r = await fetch(`${API}/models?limit=5`, { headers: headers() }); }
  catch (e) { throw new Error('No connection to Anthropic. Check your network and try again.'); }
  if (!r.ok) throw apiError(r.status, await r.text());
  return true;
}

/**
 * One request to Claude. `content` is the user turn (text and document blocks),
 * `schema` the JSON shape the answer must take. The answer is streamed;
 * onProgress(chars) reports how much has arrived, `signal` cancels.
 * Resolves to {data, usage, model}.
 */
export async function run({ system, content, schema, effort = 'medium', maxTokens = 16000, signal, onProgress }) {
  const body = {
    model: model().id,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
    fallbacks: 'default',
  };
  let r;
  try {
    r = await fetch(`${API}/messages`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('No connection to Anthropic. Check your network and try again.');
  }
  if (!r.ok) throw apiError(r.status, await r.text());

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', stop = '', served = '', failure = null;
  const usage = {};
  const take = ev => {
    if (ev.type === 'message_start' && ev.message) { Object.assign(usage, ev.message.usage || {}); served = ev.message.model || ''; }
    else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (onProgress) onProgress(text.length); }
    else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage) Object.assign(usage, ev.usage); }
    else if (ev.type === 'error') failure = ev.error || {};
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {   // one event per blank line
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try { take(JSON.parse(json)); } catch (e) { /* not an event: skip */ }
      }
    }
  }
  if (failure) throw new Error(failure.message ? `Anthropic: ${failure.message}` : 'Anthropic stopped the answer.');
  if (stop === 'refusal') throw new Error('Claude declined to answer this. Try again, or change the wording of your notes.');
  if (stop === 'max_tokens') throw new Error('The answer was cut off because it grew too long. Try again.');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Claude sent an answer the app could not read. Try again.'); }
  return { data, usage, model: served || model().id };
}

/** A file as the base64 string a document block carries. */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------------------------------------------------------------- the Guide */

const GUIDE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'month', 'year', 'language', 'services'],
  properties: {
    title: { type: 'string', description: 'The booklet, e.g. "Divine Service Guide November 2026"' },
    month: { type: 'integer', description: 'The month the booklet is for, 1 to 12' },
    year: { type: 'integer' },
    language: { type: 'string', enum: ['en', 'af', 'other'], description: 'The language of the booklet' },
    services: {
      type: 'array',
      description: 'One entry per divine service article, in the order of the booklet',
      items: {
        type: 'object', additionalProperties: false,
        required: ['date', 'dateText', 'kind', 'label', 'reference', 'bibleText', 'title', 'message', 'introduction', 'sections', 'context', 'summary', 'catechismRefs', 'reading'],
        properties: {
          date: { type: 'string', description: 'The date of the service as yyyy-mm-dd. A midweek service printed as "4/5 November" takes the first day. Empty when no date is printed.' },
          dateText: { type: 'string', description: 'The date as printed at the foot of the article, e.g. "1 November 2026" or "4/5 November 2026"' },
          kind: { type: 'string', enum: ['sunday', 'midweek', 'youth', 'children', 'other'] },
          label: { type: 'string', description: 'The heading above the article, e.g. "First Sunday | Divine service for the departed", "Midweek", "Youth"' },
          reference: { type: 'string', description: 'The Bible reference exactly as printed, e.g. "Psalm 130:7 (excerpt)" or "Philippians 3:20–21"' },
          bibleText: { type: 'string', description: 'The Bible text quoted at the top of the article, word for word' },
          title: { type: 'string', description: 'The title of the article, printed above "Message"' },
          message: { type: 'string', description: 'The sentence(s) under "Message"' },
          introduction: { type: 'string', description: 'The paragraph(s) under "Introduction", word for word' },
          sections: {
            type: 'array', description: 'Every further subheading of the article with its paragraphs, word for word, in order',
            items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: { type: 'string' }, body: { type: 'string', description: 'The paragraphs under the heading; bullet points as lines starting with "- "' } } },
          },
          context: { type: 'string', description: 'The text of the "Context" box, word for word' },
          summary: { type: 'array', items: { type: 'string' }, description: 'The bullet points of the "Summary" box, one string each' },
          catechismRefs: { type: 'array', items: { type: 'string' }, description: 'The Catechism sections the article cites as CNAC, as bare numbers such as "9.6.3"' },
          reading: { type: 'string', description: 'A reading the article suggests for the service (e.g. "Matthew 25:1–13"), else empty' },
        },
      },
    },
  },
};

const GUIDE_SYSTEM = 'You transcribe the monthly Divine Service Guide of the New Apostolic Church into a fixed JSON shape for one minister\'s own sermon preparation. You copy; you do not summarise, shorten, translate or add.';

const GUIDE_TASK = `This PDF is one month's Divine Service Guide. Put every divine service article in it into the JSON shape, one entry per article, in the booklet's order: the Sunday services, the midweek services, the youth service and any other service that has its own article.

Copy the text of each article word for word in the language of the booklet. Join words that are hyphenated across a line, and separate paragraphs with a blank line inside a field. Keep the booklet's own headings as the "sections" headings. Where a box of bullet points sits in the running text, write each point as a line starting with "- ". The "Context" box and the "Summary" bullets stand beside or below the article; they belong to that article. "Thoughts from the Chief Apostle" is a heading with no text: leave it out. Write Catechism citations such as "(CNAC 9.6.3)" where they stand in the text, and also list the bare numbers in catechismRefs.

Leave out the cover, the list of contents, the foreword, the page that advertises other publications, the "Notes" pages, the calendar at the back and the publisher's page. A "Reading" page that prints a Bible passage for the youth service belongs to the youth service as its "reading" (the reference only). The date of a service stands at the foot of its article; the booklet's month and year give the rest of the date.`;

/** Reads a Guide PDF into {title, month, year, language, services, fileName, model, usage, cost}. */
export async function readGuide(file, { signal, onProgress } = {}) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose the Guide as a PDF file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That PDF is larger than 25 MB; the Guide is usually under 1 MB.');
  const data = await fileToBase64(file);
  const r = await run({
    system: GUIDE_SYSTEM,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: file.name },
      { type: 'text', text: GUIDE_TASK },
    ],
    schema: GUIDE_SCHEMA, effort: 'medium', maxTokens: 32000, signal, onProgress,
  });
  const g = tidyGuide(r.data);
  if (!g.services.length) throw new Error('No divine service articles were found in that PDF. Is it the monthly Guide?');
  return { ...g, fileName: file.name, model: r.model, usage: r.usage, cost: cost(r.usage, r.model) };
}

const KINDS = ['sunday', 'midweek', 'youth', 'children', 'other'];
const str = v => (typeof v === 'string' ? v.trim() : '');

function tidyGuide(d) {
  const month = Math.min(12, Math.max(1, parseInt(d.month, 10) || 0));
  const year = parseInt(d.year, 10) || new Date().getFullYear();
  const services = (Array.isArray(d.services) ? d.services : []).map(x => x || {}).map(x => ({
    date: isoDate(str(x.date), str(x.dateText), month, year),
    dateText: str(x.dateText),
    kind: KINDS.includes(x.kind) ? x.kind : 'other',
    label: str(x.label),
    reference: str(x.reference),
    bibleText: str(x.bibleText),
    title: str(x.title),
    message: str(x.message),
    introduction: str(x.introduction),
    sections: (Array.isArray(x.sections) ? x.sections : []).map(s => ({ heading: str(s && s.heading), body: str(s && s.body) })).filter(s => s.heading || s.body),
    context: str(x.context),
    summary: (Array.isArray(x.summary) ? x.summary : []).map(str).filter(Boolean),
    catechismRefs: (Array.isArray(x.catechismRefs) ? x.catechismRefs : []).map(n => str(n).replace(/^CNAC\s*/i, '')).filter(n => /^\d+(\.\d+)*$/.test(n)),
    reading: str(x.reading),
  })).filter(x => x.title || x.reference || x.bibleText);
  return { title: str(d.title) || `Divine Service Guide ${month}/${year}`, month, year, language: ['en', 'af'].includes(d.language) ? d.language : 'other', services };
}

/** A sound yyyy-mm-dd, from the model's date or from the day printed in the text. */
function isoDate(date, dateText, month, year) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date + 'T12:00:00'))) return date;
  const m = dateText.match(/(\d{1,2})/);
  if (!m || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- suggestions */

const QUESTIONS = {
  en: [
    'Who is speaking, and to whom?',
    'Why are these words spoken? What is the occasion?',
    'What happened before this text?',
    'What follows after it?',
    'Where and when does it take place?',
    'What does the text say, and what does it mean?',
  ],
  af: [
    'Wie praat, en met wie?',
    'Waarom word dit gesê? Wat is die aanleiding?',
    'Wat het voor hierdie teks gebeur?',
    'Wat volg daarna?',
    'Waar en wanneer speel dit af?',
    'Wat sê die teks, en wat beteken dit?',
  ],
};

const SUGGEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['context', 'keywords', 'catechism', 'crossRefs', 'points', 'application', 'note'],
  properties: {
    context: {
      type: 'array', description: 'The context questions, in the order asked, each with its answer',
      items: { type: 'object', additionalProperties: false, required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } },
    },
    keywords: {
      type: 'array', description: 'The words of the text that carry the weight, with what each means here',
      items: { type: 'object', additionalProperties: false, required: ['word', 'meaning'], properties: { word: { type: 'string' }, meaning: { type: 'string' } } },
    },
    catechism: {
      type: 'array', description: 'Catechism sections that belong with this text and message, by number from the index given',
      items: { type: 'object', additionalProperties: false, required: ['n', 'why'], properties: { n: { type: 'string', description: 'The section number as in the index, e.g. "9.6.3"' }, why: { type: 'string', description: 'One line on what the section gives the sermon' } } },
    },
    crossRefs: {
      type: 'array', description: 'Other Bible passages in line with the text and the message',
      items: { type: 'object', additionalProperties: false, required: ['reference', 'why'], properties: { reference: { type: 'string', description: 'English book name, chapter and verse(s), e.g. "Romans 8:28" or "1 Peter 3:18-20"' }, why: { type: 'string', description: 'One line on how it connects' } } },
    },
    points: {
      type: 'array', description: 'Two or three possible main points for the sermon',
      items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: { type: 'string', description: 'A few words' }, body: { type: 'string', description: 'Two or three short sentences' } } },
    },
    application: { type: 'string', description: 'A short application for the congregation: what the text asks of them this week, in two or three short sentences' },
    note: { type: 'string', description: 'Anything the minister should know about these suggestions, e.g. where the Catechism does not speak to this text; else empty' },
  },
};

/* ------------------------------------------------- how the answers are written */

/**
 * How every answer is written. The minister reads it on a phone, preaches
 * freely in everyday words, did not study theology, and wants text he can
 * take in at a glance and say out loud as it stands.
 */
function voiceRules(lang) {
  return `How to write, always:
- Short sentences, one thought each. Everyday words, the kind people use at the kitchen table. No long paragraphs: three or four sentences, then a break.
- Write it so the minister could say it out loud as it stands, in his own voice.
- He did not study theology and keeps his words simple. When a Bible or Church word is the right one (covenant, justification, sacrament), use it and say in a few plain words what it means here. Never use a hard word to sound learned.
- Put the main thing first. Start a line with its key word. Leave out what does not help this sermon. Nothing padded, nothing repeated.
- Where the content is a list, make it a list: one short line per item.
- No names of theologians, movements or Hebrew and Greek words, unless one word truly opens the text; then give it with its plain meaning.
- Answer in ${lang === 'af' ? 'Afrikaans: plain, everyday Afrikaans as it is spoken in the congregation, not stiff or bookish' : 'English: plain, everyday English as it is spoken in South Africa'}.`;
}

/** Who is listening shapes the words, the pictures, the examples and the application. */
function peopleRules() {
  return `Who is listening shapes the words, the pictures, the examples and the application:
- Children: very simple words, one clear picture or a short story they can see, a question they can answer, and only one thing to take home.
- Young people: their world (school, friends, phones, pressure, choices, standing for their faith among friends who do not believe). Honest and direct, never talking down, no forced slang.
- Young adults: work, money, relationships, young families, finding one's place, keeping faith in a busy life.
- Families with children: pictures from family life; a word the children catch and a word for the parents.
- Older members: respect for a long life of faith; memory, loss, loneliness, health, children and grandchildren, the hope of the Lord's return. Nothing hurried.
- All ages together: a picture everyone understands, and now and then a word for the young and a word for the old.
Where the minister describes the people (their work, language, what they are going through), take the examples and the application from their life, not from a life they do not know.`;
}

/** How much humour the sermon may carry, for the level chosen for this preparation. */
function humourRules(level) {
  const how = level === 'none'
    ? 'None in this service: no humour at all.'
    : level === 'more'
      ? 'A bit more: two or three light, warm moments, still gentle, for the introduction and an illustration or a main point.'
      : 'A little, where it fits: where the text and the people allow it, one light, warm moment, such as a familiar situation everyone recognises or a gentle word about our own ways. A smile, not a joke. If nothing fits naturally, leave it out.';
  return `Humour: the minister likes to bring a smile where it fits, and the people know him for it. For this service: ${how}
- Never at the cost of a person or a group, never about Scripture itself, sin, suffering or the sacraments, never sarcasm. Humour opens the door; it never carries the message.
- In a funeral or a divine service for the departed there is no humour.`;
}

function suggestSystem(lang) {
  return `You help a minister of the New Apostolic Church prepare an unscripted sermon for a divine service. The Bible text and the message of the service are given; the message comes from the Church's Divine Service Guide and sets the direction. Your task is to give the minister input for his own preparation, not to write the sermon: answer the context questions about the text, explain the key words, point to the Catechism sections that belong with the text and the message, suggest other Bible passages in line with the message, and offer a few sermon thoughts he can make his own.

Rules:
- Stay faithful to the Bible text and to the doctrine of the New Apostolic Church as the Catechism states it. Lean on the Catechism text given below where it speaks to the matter. Cite Catechism sections only by numbers that appear in the index given below, and never state what a section says unless its text is given. Where you draw on a section, say what it says in plain words.
- The message of the service gives the direction. The suggestions serve that message and do not pull the text elsewhere.
- Cross references: five to eight passages that genuinely shed light on the text or the message, each with one line on how it connects. Give each reference with the English book name, chapter and verse(s). Do not quote the verse.
- Sermon thoughts: two or three possible main points, each a heading of a few words and two or three short sentences drawn from the text and the message, and one short application for the congregation. They are starting points, not a finished sermon. Shape them for the people who will be listening (see below).
- Answer the context questions in two to four short sentences each.

${voiceRules(lang)}

${peopleRules()}

Put nothing outside the JSON fields.`;
}

/**
 * Suggestions for one preparation. `service` is the Guide's article when the
 * preparation is linked to one. Resolves to the suggestions, tidied, with
 * when, which model and roughly what it cost.
 */
export async function suggest(s, { service = null, guideTitle = '', signal, onProgress } = {}) {
  const lang = langOf(s);
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));

  const own = [s.context ? `Context: ${s.context}` : '', s.keywords ? `Key words: ${s.keywords}` : '', s.crossRefs ? `Cross references: ${s.crossRefs}` : '', (s.points || []).some(p => p.heading || p.body) ? 'Main points so far: ' + s.points.filter(p => p.heading || p.body).map(p => `${p.heading}${p.body ? ' – ' + p.body : ''}`).join(' | ') : ''].filter(Boolean);
  if (own.length) parts.push('THE MINISTER\'S OWN NOTES SO FAR (build on them; do not repeat them)\n' + own.join('\n'));

  parts.push(await catechismPart(s, service));

  const qs = QUESTIONS[lang];
  parts.push(`THE CONTEXT QUESTIONS to answer, in this order, each in two to four short sentences:\n` + qs.map((q, i) => `${i + 1}. ${q}`).join('\n'));

  const r = await run({
    system: suggestSystem(lang),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: SUGGEST_SCHEMA, effort: 'high', maxTokens: 16000, signal, onProgress,
  });
  return { ...tidySuggestions(r, lang, qs), audience: audienceOf(s) };
}

/** The service in a few lines: date, occasion, congregation, text word. */
function servicePart(s) {
  const ref = s.ref ? formatRef(s.ref, 'en') : (s.refText || '');
  return `THE SERVICE\nDate: ${s.date || '–'}\nOccasion: ${s.occasion || '–'}\nCongregation: ${s.congregation || '–'}\nText word: ${ref || '(no reference given)'}${s.translation ? ` (${s.translation})` : ''}`;
}

/** Who is listening: the age group, the minister's line about the people, and the language they will hear. */
function peoplePart(s, lang) {
  const a = audienceOf(s);
  const lines = ['WHO IS LISTENING', `Age group: ${audienceLabel(a)}${a ? '' : ' (an ordinary mixed congregation)'}`];
  if ((s.people || '').trim()) lines.push(`About the people, in the minister's words: ${s.people.trim()}`);
  lines.push(`The sermon is preached in ${lang === 'af' ? 'Afrikaans' : 'English'}.`);
  return lines.join('\n');
}

/** What the minister wrote in Settings about how he preaches; '' when nothing. */
function preacherPart() {
  const style = (state.settings.aiStyle || '').trim();
  return style ? `HOW THE MINISTER PREACHES, in his own words (follow it)\n${style}` : '';
}

/** The whole chapter of the text word (World English Bible, bundled), for the context; '' when there is none. */
async function chapterPart(s) {
  if (!s.ref) return '';
  try {
    const ch = await Bible.getChapter('web', s.ref.book, s.ref.chapter);
    if (ch && ch.verses && ch.verses.length) {
      return `THE WHOLE CHAPTER, ${formatRef({ book: s.ref.book, chapter: s.ref.chapter }, 'en')} (World English Bible), for the context\n` + ch.verses.map(v => `${v.n} ${v.text}`).join('\n');
    }
  } catch (e) { /* no chapter text: Claude knows the Bible */ }
  return '';
}

/** The Guide's article when the preparation is linked to one, else the message as the minister noted it. */
function messagePart(s, service, guideTitle) {
  if (service) {
    const g = [`THE ARTICLE IN THE DIVINE SERVICE GUIDE${guideTitle ? ` (${guideTitle}` : ''}${service.dateText ? `${guideTitle ? ', ' : ' ('}${service.dateText}` : ''}${guideTitle || service.dateText ? ')' : ''}`];
    if (service.label) g.push(`Service: ${service.label}`);
    if (service.title) g.push(`Title: ${service.title}`);
    if (service.message) g.push(`Message: ${service.message}`);
    if (service.introduction) g.push(`Introduction: ${service.introduction}`);
    for (const sec of service.sections || []) g.push(`${sec.heading}\n${sec.body}`);
    if (service.context) g.push(`Context: ${service.context}`);
    if ((service.summary || []).length) g.push('Summary:\n' + service.summary.map(x => `- ${x}`).join('\n'));
    if ((service.catechismRefs || []).length) g.push(`Catechism sections the article cites: ${service.catechismRefs.join(', ')}`);
    if (service.reading) g.push(`Suggested reading: ${service.reading}`);
    return g.join('\n\n');
  }
  if (s.theme || s.core || s.guide) {
    return ['THE MESSAGE OF THE SERVICE, as the minister noted it from the Divine Service Guide', s.theme ? `Message: ${s.theme}` : '', s.core ? `Core thought: ${s.core}` : '', s.guide ? `Notes from the Guide: ${s.guide}` : ''].filter(Boolean).join('\n');
  }
  return 'THE MESSAGE OF THE SERVICE\nNot given: take the direction from the text itself.';
}

/**
 * The Catechism sections that quote the text (with their text when it is on
 * the device) and, unless `index` is false, the whole index.
 */
async function catechismPart(s, service, { index = true } = {}) {
  await Cat.load().catch(() => null);
  const haveText = await Cat.loadText().catch(() => false);
  const lines = ['THE CATECHISM OF THE NEW APOSTOLIC CHURCH'];
  const picked = [];
  if (s.ref) {
    const verses = s.ref.verse ? [] : [null];
    for (let v = s.ref.verse; s.ref.verse && v <= (s.ref.verseEnd || s.ref.verse); v++) verses.push(v);
    for (const v of verses) for (const sec of Cat.refsFor(s.ref.book, s.ref.chapter, v)) if (!picked.includes(sec.n)) picked.push(sec.n);
  }
  for (const n of (service && service.catechismRefs) || []) if (Cat.section(n) && !picked.includes(n)) picked.push(n);
  for (const c of s.catechism || []) if (Cat.section(c.n) && !picked.includes(c.n)) picked.push(c.n);
  const shown = picked.slice(0, 10);
  if (shown.length) {
    lines.push(haveText
      ? 'Sections that quote this text, that the Guide cites, or that the minister ticked (their text follows each):'
      : 'Sections that quote this text, that the Guide cites, or that the minister ticked. Their text is not loaded on this device, so only number and title are given:');
    for (const n of shown) {
      const sec = Cat.section(n);
      lines.push(`--- ${n} ${sec.title}`);
      if (haveText) {
        const body = Cat.plainLines(n).map(l => (l.kind === 'li' ? '- ' : '') + l.text).join('\n');
        const sum = Cat.summaryOf(n);
        if (body) lines.push(body);
        if (sum.length) lines.push('In short: ' + sum.join(' '));
      }
    }
  } else {
    lines.push('No section of the Catechism quotes this text directly.');
  }
  if (index) {
    lines.push('INDEX OF THE CATECHISM (number and title; cite only these numbers):');
    lines.push(Cat.allSections().filter(x => x.n !== 'Intro' && x.n !== 'Appendix').map(x => `${x.n} ${x.title}`).join('\n'));
  }
  return lines.join('\n');
}

const DASHES = /[–—]/g;

function tidySuggestions(r, lang, qs) {
  const d = r.data || {};
  const list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const context = list(d.context).map((c, i) => ({ question: str(c.question) || qs[i] || '', answer: str(c.answer) })).filter(c => c.answer);
  const keywords = list(d.keywords).map(k => ({ word: str(k.word), meaning: str(k.meaning) })).filter(k => k.word);
  const catechism = [];
  for (const c of list(d.catechism)) {
    const n = str(c.n).replace(/^CNAC\s*/i, '');
    const sec = Cat.section(n);
    if (sec && !catechism.find(x => x.n === n)) catechism.push({ n, title: sec.title, why: str(c.why) });
  }
  const crossRefs = list(d.crossRefs).map(x => {
    const reference = str(x.reference).replace(DASHES, '-');
    return { reference, why: str(x.why), ref: parseRef(reference) };
  }).filter(x => x.reference);
  const points = list(d.points).map(p => ({ heading: str(p.heading), body: str(p.body) })).filter(p => p.heading || p.body);
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    context, keywords, catechism, crossRefs, points,
    application: str(d.application), note: str(d.note),
  };
}

/* ---------------------------------------------------------------- building the sermon */

const OUTLINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intro', 'points', 'application', 'conclusion', 'illustrations', 'lighter', 'note'],
  properties: {
    intro: {
      type: 'object', additionalProperties: false, required: ['text', 'why'], description: 'The introduction: how the sermon opens',
      properties: { text: { type: 'string', description: 'Three to five short sentences, as the minister could speak them' }, why: { type: 'string', description: 'One short line on why this opening works for this text, this message and these people' } },
    },
    points: {
      type: 'array', description: 'Two or three main points, in the order to preach them',
      items: { type: 'object', additionalProperties: false, required: ['heading', 'body', 'why'], properties: { heading: { type: 'string', description: 'A few words' }, body: { type: 'string', description: 'Three to six short sentences: what the text says, what it means, what it asks of us' }, why: { type: 'string', description: 'One short line on what this point does for the message' } } },
    },
    application: { type: 'string', description: 'The application for the congregation: what the text asks of them this week, named for the people in front of the minister; two to four short sentences' },
    conclusion: { type: 'string', description: 'The conclusion: gathers the thoughts and leads to the altar; two to four short sentences' },
    illustrations: {
      type: 'array', description: 'One to three pictures, stories or examples that make a point visible, from the world of the people who are listening',
      items: { type: 'object', additionalProperties: false, required: ['title', 'body', 'serves'], properties: { title: { type: 'string', description: 'A few words' }, body: { type: 'string', description: 'The picture or story in two to five short sentences' }, serves: { type: 'string', description: 'The part of the sermon it serves, e.g. "the introduction" or "main point 2"' } } },
    },
    lighter: {
      type: 'object', additionalProperties: false, required: ['text', 'where'], description: 'A lighter moment: one warm touch of humour that fits this text and these people, in the minister\'s own voice. Both fields empty when the humour level is none or nothing fits naturally.',
      properties: { text: { type: 'string', description: 'The light moment in one to three short sentences, as he could say it' }, where: { type: 'string', description: 'Where it belongs, e.g. "the introduction" or "main point 1"' } },
    },
    note: { type: 'string', description: 'Anything the minister should know about this outline, e.g. a choice made between two directions; else empty' },
  },
};

function outlineSystem(lang, humour) {
  return `You help a minister of the New Apostolic Church build an unscripted sermon for a divine service. The Bible text and the message of the service are given; the message comes from the Church's Divine Service Guide and sets the direction. Your task is to propose how the sermon is best built from them: an introduction that opens the door, two or three main points that each stand on the text, an application for the congregation, a conclusion that leads to the altar, and a few illustrations. For each part say in one short line why it works here. The minister decides; he takes what serves him.

Rules:
- Stay faithful to the Bible text and to the doctrine of the New Apostolic Church as the Catechism states it. Where the Catechism text given below speaks to the matter, let it shape the points. Do not state what a Catechism section says unless its text is given; where you draw on it, say it in plain words.
- The message of the service gives the direction: the whole outline serves it and does not pull the text elsewhere. The Guide's article, where given, is the first source for the points.
- A New Apostolic sermon is preached freely, lasts about twenty to thirty minutes, and leads the congregation to the forgiveness of sins and Holy Communion: the conclusion ends there. In a divine service for the departed, the departed are included in the hope and the intercession.
- Write every part so the minister could speak it as it stands: in the voice of a minister speaking to his congregation, "we" and "us", no headings inside the text. Each main point has a heading of a few words and three to six short sentences.
- Build on what the minister has written already: keep his direction and wording where he has one, fill what is empty, and offer an alternative only where his draft is thin. Do not repeat his text back to him.
- Illustrations: a picture from daily life, a true-to-life example or a Bible story that makes a point visible, taken from the world of the people who are listening. When one of the minister's own notes fits, use that one and say so ("from your notes: …") rather than inventing another.
- The lighter moment: fill it only when the humour level below allows it and something fits naturally; otherwise leave both fields empty. It may also be woven into the introduction or an illustration.

${voiceRules(lang)}

${peopleRules()}

${humourRules(humour)}

Put nothing outside the JSON fields.`;
}

/**
 * How the sermon is best built for one preparation: introduction, main
 * points, application, conclusion and illustrations, each with a line on why
 * it works. Draws on the text and its chapter, the Guide's article, the
 * minister's own notes under steps 2 to 5, the ticked Catechism sections and
 * the minister's experience and illustration notes.
 */
export async function outline(s, { service = null, guideTitle = '', signal, onProgress } = {}) {
  const lang = langOf(s);
  const humour = humourOf(s);
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));

  const seen = [s.context ? `Context: ${s.context}` : '', s.keywords ? `Key words: ${s.keywords}` : '', s.crossRefs ? `Cross references: ${s.crossRefs}` : ''].filter(Boolean);
  if (seen.length) parts.push('THE MINISTER\'S UNDERSTANDING OF THE TEXT (his notes under step 3)\n' + seen.join('\n'));
  if (s.ai && ((s.ai.points || []).length || s.ai.application)) {
    parts.push('SERMON THOUGHTS SUGGESTED EARLIER (build on them where they serve; do not repeat them unchanged)\n'
      + (s.ai.points || []).map(p => `- ${p.heading}${p.body ? ': ' + p.body : ''}`).join('\n')
      + (s.ai.application ? `\n- Application: ${s.ai.application}` : ''));
  }

  const points = (s.points || []).filter(p => p.heading || p.body);
  const draft = [
    s.intro ? `Introduction: ${s.intro}` : '',
    ...points.map((p, i) => `Main point ${i + 1}: ${p.heading}${p.body ? ' – ' + p.body : ''}`),
    s.application ? `Application: ${s.application}` : '',
    s.conclusion ? `Conclusion: ${s.conclusion}` : '',
    s.illustrations ? `Illustrations: ${s.illustrations}` : '',
  ].filter(Boolean);
  parts.push(draft.length
    ? 'THE MINISTER\'S DRAFT OF THE SERMON SO FAR (keep his direction; fill what is missing; improve only what is thin)\n' + draft.join('\n')
    : 'THE MINISTER\'S DRAFT OF THE SERMON SO FAR\nNothing written yet: propose the whole build.');

  parts.push(await catechismPart(s, service, { index: false }));

  const notes = (state.notes || []).filter(n => n.kind === 'experience' || n.kind === 'illustration').slice(0, 15);
  if (notes.length) {
    parts.push('THE MINISTER\'S OWN EXPERIENCES AND ILLUSTRATIONS, from his notes (use one where it fits the message)\n'
      + notes.map(n => `- ${formatRef({ book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verseEnd }, 'en')}${n.title ? ` – ${n.title}` : ''}: ${(n.body || '').slice(0, 500)}`).join('\n'));
  }

  const r = await run({
    system: outlineSystem(lang, humour),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: OUTLINE_SCHEMA, effort: 'high', maxTokens: 12000, signal, onProgress,
  });
  return { ...tidyOutline(r, lang, humour), audience: audienceOf(s) };
}

function tidyOutline(r, lang, humour) {
  const d = r.data || {};
  const list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const intro = d.intro && typeof d.intro === 'object' ? { text: str(d.intro.text), why: str(d.intro.why) } : { text: str(d.intro), why: '' };
  const points = list(d.points).map(p => ({ heading: str(p.heading), body: str(p.body), why: str(p.why) })).filter(p => p.heading || p.body);
  const illustrations = list(d.illustrations).map(x => ({ title: str(x.title), body: str(x.body), serves: str(x.serves) })).filter(x => x.body);
  const lighter = humour !== 'none' && d.lighter && typeof d.lighter === 'object' && str(d.lighter.text) ? { text: str(d.lighter.text), where: str(d.lighter.where) } : null;
  return {
    at: new Date().toISOString(), model: r.model, lang, humour,
    cost: cost(r.usage, r.model),
    intro, points, application: str(d.application), conclusion: str(d.conclusion), illustrations, lighter, note: str(d.note),
  };
}

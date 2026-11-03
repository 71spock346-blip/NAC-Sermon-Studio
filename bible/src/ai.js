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
 *                     application, conclusion and illustrations, with the
 *                     minister's own thoughts on the main points woven in
 *   readThoughts(s, …) before the sermon is built: Claude reads those
 *                     thoughts, says where each would go, and asks the
 *                     minister where one is unclear
 *   weaveThought(s, i, …) one thought into its own main point only: that
 *                     point's text again with the thought in it, or first a
 *                     question when the thought is unclear
 *
 * One rule stands over both: the main points of the sermon come from the
 * Divine Service Guide, never from Claude. The parts of the Guide's article,
 * each under its own heading, are main point 1, 2, 3 and so on, in the
 * Guide's order (guides.js mainPoints). suggest() and outline() give the model
 * that list as fixed, tell it so, and alignPoints() holds the answer to it:
 * a point the model adds is left out, one it leaves out is kept in the Guide's
 * words. Without a linked article the model gets the minister's own points
 * (his Guide, in his hand) or, failing those, is told to propose none and
 * to say that the main points need the Guide. Only a funeral or a wedding,
 * which the monthly Guide has no article for, lets it take the points from
 * the text.
 *   breakdown(s, …)   the Guide's article for the service taken apart piece by
 *                     piece: what each sentence says in plain words, what it
 *                     gives the sermon, and the Bible passages and Catechism
 *                     sections that bring depth to it
 *   readReflection(file) the Church's one-page guide for a reflection evening
 *                     (PDF): the sermon's title, its text and the questions,
 *                     copied word for word for the slides (reflect.js)
 *   insight(level, ref, …) theological background for the Theology section
 *                     (theology.js) on a passage, a chapter or a whole book:
 *                     what it says, its background and writer, what it
 *                     teaches, what the Church teaches on it, how other
 *                     Christians read it and whether that agrees with New
 *                     Apostolic teaching
 *
 * All of them ask for an answer in a fixed JSON shape, streamed so a long answer does
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
import { t } from './i18n.js';
import { parseRef, formatRef, bookName } from './books.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import { mainPoints } from './guides.js';

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
  if (!key) throw new Error(t('Add your Anthropic key under Settings → AI helper first.'));
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
  if (status === 401) return new Error(t('Anthropic did not accept the key. Check it under Settings → AI helper.'));
  if (status === 403) return new Error(t('This key is not allowed to do that. Make a new key at console.anthropic.com.'));
  if (status === 429) return new Error(t('Anthropic is busy or your limit is reached for now. Wait a minute and try again.'));
  if (status === 529 || /overloaded/i.test(msg)) return new Error(t('Anthropic is overloaded right now. Try again in a minute.'));
  if (/credit|balance|billing/i.test(msg)) return new Error(t('Your Anthropic account has no credit left. Add credit under Billing at console.anthropic.com.'));
  return new Error(msg ? `Anthropic: ${msg}` : t('Anthropic error {status}', { status }));
}

/** Roughly what a finished request cost, in US dollars, from the usage the API reports. */
export function cost(usage, modelId) {
  const m = MODELS.find(x => x.id === modelId) || model();
  if (!usage) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;   // writing the cache costs a quarter more, reading it a tenth
  return (inTok * m.input + (usage.output_tokens || 0) * m.output) / 1e6;
}

export function fmtCost(c) {
  if (!c) return '';
  return c < 0.01 ? t('under 1 US cent') : t('about ${amount}', { amount: c.toFixed(2) });
}

/** Does the key work? Lists the models it may use. */
export async function checkKey() {
  let r;
  try { r = await fetch(`${API}/models?limit=5`, { headers: headers() }); }
  catch (e) { throw new Error(t('No connection to Anthropic. Check your network and try again.')); }
  if (!r.ok) throw apiError(r.status, await r.text());
  return true;
}

/**
 * One request to Claude. `system` is the instructions (a string, or text
 * blocks, the last of which may be marked for the prompt cache), `content`
 * the user turn (text and document blocks), `schema` the JSON shape the
 * answer must take. The answer is streamed;
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
    throw new Error(t('No connection to Anthropic. Check your network and try again.'));
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
  if (failure) throw new Error(failure.message ? `Anthropic: ${failure.message}` : t('Anthropic stopped the answer.'));
  if (stop === 'refusal') throw new Error(t('Claude declined to answer this. Try again, or change the wording of your notes.'));
  if (stop === 'max_tokens') throw new Error(t('The answer was cut off because it grew too long. Try again.'));
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(t('Claude sent an answer the app could not read. Try again.')); }
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
    language: { type: 'string', enum: ['en', 'af', 'other'], description: 'The language of the booklet: "af" for the Afrikaans edition ("Handleiding vir Godsdienste")' },
    services: {
      type: 'array',
      description: 'One entry per divine service article, in the order of the booklet',
      items: {
        type: 'object', additionalProperties: false,
        required: ['date', 'dateText', 'kind', 'label', 'reference', 'bibleText', 'title', 'message', 'introduction', 'sections', 'context', 'summary', 'catechismRefs', 'reading'],
        properties: {
          date: { type: 'string', description: 'The date of the service as yyyy-mm-dd. A midweek service printed as "4/5 November" takes the first day. Empty when no day is printed (e.g. only "November 2026").' },
          dateText: { type: 'string', description: 'The date as printed at the foot of the article, e.g. "1 November 2026" or "4/5 November 2026"' },
          kind: { type: 'string', enum: ['sunday', 'midweek', 'youth', 'children', 'other'], description: 'Midweek ("Weekdiens" in Afrikaans) is midweek; Youth ("Jongmense") is youth' },
          label: { type: 'string', description: 'The heading above the article, e.g. "First Sunday | Divine service for the departed", "Midweek", "Youth"; in Afrikaans e.g. "Eerste Sondag | Godsdiens vir die ontslapenes", "Weekdiens", "Jongmense"' },
          reference: { type: 'string', description: 'The Bible reference exactly as printed, e.g. "Psalm 130:7 (excerpt)" or "Philippians 3:20–21"' },
          bibleText: { type: 'string', description: 'The Bible text quoted at the top of the article, word for word' },
          title: { type: 'string', description: 'The title of the article, printed above "Message"' },
          message: { type: 'string', description: 'The sentence(s) under "Message" ("Boodskap" in Afrikaans)' },
          introduction: { type: 'string', description: 'The paragraph(s) under "Introduction" ("Inleiding"), word for word' },
          sections: {
            type: 'array', description: 'Every further subheading of the article with its paragraphs, word for word, in order',
            items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: { type: 'string' }, body: { type: 'string', description: 'The paragraphs under the heading; bullet points as lines starting with "- "' } } },
          },
          context: { type: 'string', description: 'The text of the "Context" box ("Agtergrond" in Afrikaans), word for word' },
          summary: { type: 'array', items: { type: 'string' }, description: 'The bullet points of the "Summary" box ("Samevatting"), one string each' },
          catechismRefs: { type: 'array', items: { type: 'string' }, description: 'The Catechism sections the article cites as CNAC, as bare numbers such as "9.6.3"' },
          reading: { type: 'string', description: 'A reading the article suggests for the service (e.g. "Matthew 25:1–13"), else empty' },
        },
      },
    },
  },
};

const GUIDE_SYSTEM = 'You transcribe the monthly Divine Service Guide of the New Apostolic Church into a fixed JSON shape for one minister\'s own sermon preparation. You copy; you do not summarise, shorten, translate or add.';

const GUIDE_TASK = `This PDF is one month's Divine Service Guide, in English or in Afrikaans (the Afrikaans edition is called "Handleiding vir Godsdienste"). Put every divine service article in it into the JSON shape, one entry per article, in the booklet's order: the Sunday services, the midweek services, the youth service and any other service that has its own article.

Copy the text of each article word for word in the language of the booklet: an Afrikaans booklet stays in Afrikaans, with its own spelling and its Bible quotations as printed. Never translate. Join words that are hyphenated across a line, and separate paragraphs with a blank line inside a field. Keep the booklet's own headings as the "sections" headings. Where a box of bullet points sits in the running text, write each point as a line starting with "- ". The "Context" box ("Agtergrond" in Afrikaans) and the "Summary" bullets ("Samevatting") stand beside or below the article; they belong to that article. "Thoughts from the Chief Apostle" ("Gedagtes vanaf die Stamapostel") is a heading with no text: leave it out. Write Catechism citations such as "(CNAC 9.6.3)" where they stand in the text, and also list the bare numbers in catechismRefs.

Leave out the cover, the list of contents, the foreword ("Voorwoord"), the page that advertises other publications, the "Notes" pages ("Aantekeninge"), the calendar at the back and the publisher's page. A "Reading" page ("Voorlesing") that prints a Bible passage for the youth service belongs to the youth service as its "reading" (the reference only). The date of a service stands at the foot of its article; the booklet's month and year give the rest of the date.`;

/** Reads a Guide PDF into {title, month, year, language, services, fileName, model, usage, cost}. */
export async function readGuide(file, { signal, onProgress } = {}) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(t('Choose the Guide as a PDF file.'));
  if (file.size > 25 * 1024 * 1024) throw new Error(t('That PDF is larger than 25 MB; the Guide is usually under 1 MB.'));
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
  if (!g.services.length) throw new Error(t('No divine service articles were found in that PDF. Is it the monthly Guide?'));
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

/** A sound yyyy-mm-dd, from the model's date or from the day printed in the text ("November 2026" alone has none). */
function isoDate(date, dateText, month, year) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date + 'T12:00:00'))) return date;
  const m = dateText.match(/(?:^|\D)(\d{1,2})(?!\d)/);   // a day, not the first figures of the year
  if (!m || !month || parseInt(m[1], 10) > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- the reflection guide */

const REFLECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['language', 'heading', 'service', 'date', 'dateText', 'title', 'reference', 'bibleText', 'questions'],
  properties: {
    language: { type: 'string', enum: ['en', 'af', 'other'], description: 'The language of the guide' },
    heading: { type: 'string', description: 'The heading at the top, as printed, e.g. "DIVINE SERVICE REFLECTIONS"' },
    service: { type: 'string', description: 'The divine service the guide looks back on, as printed, e.g. "Divine service for the departed"; "Divine service" for an ordinary one' },
    date: { type: 'string', description: 'The date that service was held, as yyyy-mm-dd; empty when none is printed' },
    dateText: { type: 'string', description: 'That date as printed, e.g. "Sunday, 1 November 2026"' },
    title: { type: 'string', description: 'The title of the sermon, e.g. "God delivers from great distress"' },
    reference: { type: 'string', description: 'The Bible reference exactly as printed, e.g. "Psalm 130:7 (excerpt)"' },
    bibleText: { type: 'string', description: 'The Bible text, word for word' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Every question for the evening, word for word, in the order printed' },
  },
};

const REFLECTION_SYSTEM = 'You transcribe a one-page discussion guide of the New Apostolic Church into a fixed JSON shape, for a minister who makes slides for a reflection evening. You copy; you do not summarise, shorten, translate or add.';

const REFLECTION_TASK = `This PDF is a discussion guide for a reflection evening ("Divine Service Reflections", or the same in Afrikaans): the congregation looks back on a divine service that was held, with the sermon's title, its Bible text and a few questions to talk about. Copy them into the JSON shape, word for word, in the language of the guide. Never translate. Join words that are hyphenated across a line. The questions are the lines that ask something, usually each above a space to write in; copy every one, in order, as printed.`;

/** Reads the Church's reflection guide (a one-page PDF) into {language, heading, service, date, title, reference, bibleText, questions, fileName, …}. */
export async function readReflection(file, { signal, onProgress } = {}) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(t('Choose the reflection guide as a PDF file.'));
  if (file.size > 25 * 1024 * 1024) throw new Error(t('That PDF is larger than 25 MB; the reflection guide is one page.'));
  const data = await fileToBase64(file);
  const r = await run({
    system: REFLECTION_SYSTEM,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: file.name },
      { type: 'text', text: REFLECTION_TASK },
    ],
    schema: REFLECTION_SCHEMA, effort: 'low', maxTokens: 4000, signal, onProgress,
  });
  const d = r.data || {};
  const g = {
    language: ['en', 'af'].includes(d.language) ? d.language : 'other',
    heading: str(d.heading), service: str(d.service),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(d.date)) && !isNaN(new Date(str(d.date) + 'T12:00:00')) ? str(d.date) : '',
    dateText: str(d.dateText), title: str(d.title), reference: str(d.reference), bibleText: str(d.bibleText),
    questions: (Array.isArray(d.questions) ? d.questions : []).map(str).filter(Boolean),
  };
  if (!g.questions.length && !g.title && !g.bibleText) throw new Error(t('No questions were found in that PDF. Is it the reflection guide?'));
  return { ...g, fileName: file.name, model: r.model, usage: r.usage, cost: cost(r.usage, r.model) };
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
      type: 'array', description: 'The main points of the sermon, as the rules on the main points say: the Guide\'s, in its order, and what the text gives each; empty when the rules say to propose none',
      items: { type: 'object', additionalProperties: false, required: ['heading', 'body', 'source'], properties: { heading: { type: 'string', description: 'The heading of the point, in the language of the sermon: the Guide\'s heading, or the minister\'s' }, body: { type: 'string', description: 'Two or three short sentences: what the text word gives this point' }, source: { type: 'string', description: 'The heading this point comes from, word for word as given under THE MAIN POINTS; empty only when no Guide applies' } } },
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

function suggestSystem(lang, where) {
  return `You help a minister of the New Apostolic Church prepare an unscripted sermon for a divine service. The Bible text and the message of the service are given; the message comes from the Church's Divine Service Guide and sets the direction. Your task is to give the minister input for his own preparation, not to write the sermon: answer the context questions about the text, explain the key words, point to the Catechism sections that belong with the text and the message, suggest other Bible passages in line with the message, and show what the text gives each main point of the sermon.

Rules:
- Stay faithful to the Bible text and to the doctrine of the New Apostolic Church as the Catechism states it. Lean on the Catechism text given below where it speaks to the matter. Cite Catechism sections only by numbers that appear in the index given below, and never state what a section says unless its text is given. Where you draw on a section, say what it says in plain words.
- The message of the service gives the direction. The suggestions serve that message and do not pull the text elsewhere.
- Cross references: five to eight passages that genuinely shed light on the text or the message, each with one line on how it connects. Give each reference with the English book name, chapter and verse(s). Do not quote the verse.
${pointsRule(where.mode, 'suggest')}
- The application: one short application for the congregation, drawn from the main points and the message, shaped for the people who will be listening (see below).
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
  const where = pointAnchors(s, service);
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));
  const broken = breakdownPart(s);
  if (broken) parts.push(broken);
  parts.push(pointsPart(where));

  const own = [s.context ? `Context: ${s.context}` : '', s.keywords ? `Key words: ${s.keywords}` : '', s.crossRefs ? `Cross references: ${s.crossRefs}` : '', where.mode === 'guide' ? ownPointsLine(s, where) : ''].filter(Boolean);
  if (own.length) parts.push('THE MINISTER\'S OWN NOTES SO FAR (build on them; do not repeat them)\n' + own.join('\n'));

  parts.push(await catechismPart(s, service));

  const qs = QUESTIONS[lang];
  parts.push(`THE CONTEXT QUESTIONS to answer, in this order, each in two to four short sentences:\n` + qs.map((q, i) => `${i + 1}. ${q}`).join('\n'));

  const r = await run({
    system: suggestSystem(lang, where),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: SUGGEST_SCHEMA, effort: 'high', maxTokens: 16000, signal, onProgress,
  });
  return { ...tidySuggestions(r, lang, qs, where, service), audience: audienceOf(s) };
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

/* ------------------------------------------------- the main points, from the Guide */

/* Occasions the monthly Guide has no article for; there the main points may come from the text. */
const NO_GUIDE_OCCASION = /funeral|begrafnis|wedding|huwelik|troue/i;

/** Text as a key for matching: letters and digits only, lower case, one space between words. */
const norm = v => str(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Where the main points of this preparation come from, and what they are:
 *   guide    the Guide's article is linked: its parts, in its order, are the points
 *   own      no article (or one without headed parts), but the minister wrote his
 *            main points under step 4: the Guide's, in his hand
 *   article  the article is linked but has neither headed parts nor a Summary:
 *            Claude takes the points from its paragraphs, in order
 *   free     a funeral or a wedding, which the Guide has no article for, and
 *            nothing written: Claude may propose the points from the text
 *   none     no article and nothing written: Claude must propose none
 * Gives {mode, anchors: [{n, heading, body, from}]}; the anchors are the fixed
 * list the model is held to, empty for article, free and none.
 */
export function pointAnchors(s, service) {
  if (service) {
    const pts = mainPoints(service);
    if (pts.length) return { mode: 'guide', anchors: pts.map(p => ({ ...p, from: 'guide' })) };
  }
  const own = (s.points || []).filter(p => p && (p.heading || '').trim()).map((p, i) => ({ n: i + 1, heading: p.heading.trim(), body: (p.body || '').trim(), from: 'own' }));
  if (own.length) return { mode: 'own', anchors: own };
  if (service) return { mode: 'article', anchors: [] };
  if (NO_GUIDE_OCCASION.test(s.occasion || '')) return { mode: 'free', anchors: [] };
  return { mode: 'none', anchors: [] };
}

/** The rule on the main points for the system prompt; `job` is 'suggest' or 'outline'. */
function pointsRule(mode, job) {
  const body = job === 'outline'
    ? 'Write the body of each point from what the Guide says under that heading: three to six short sentences in plain words, as the minister could say them, with what the text word says there and what it asks of the people.'
    : 'For each point, say in two or three short sentences what the text word gives it: which words of the text carry it, and what it means for the people.';
  const never = 'The main points of the sermon come from the Church\'s Divine Service Guide, never from you.';
  switch (mode) {
    case 'guide':
      return `- ${never} The parts of the Guide's article, each under its own heading, are the main points, in the Guide's order: main point 1 is the first part, main point 2 the second, and so on. They stand under THE MAIN POINTS, FROM THE GUIDE below. Keep that number and that order. The heading of a point is the Guide's heading, in the language of the sermon; put the Guide's own words in "source". ${body} Add no point of your own and leave none out. Where the minister has written a point in his own words, keep his wording.`;
    case 'own':
      return `- ${never} The Guide's article is not given here with its parts, but the minister has written the main points under step 4 from his Guide; they stand under THE MAIN POINTS below. Keep them: that number, that order, his headings (put his heading in "source"). ${body} Add no point of your own and leave none out.`;
    case 'article':
      return `- ${never} The Guide's article is given below, but without headings over its parts: take the main points from its paragraphs, in the Guide's order, one point for each paragraph that carries a thought of its own, with a heading of a few words from that paragraph. Put the first sentence of that paragraph, word for word, in "source". ${body} Add no point of your own.`;
    case 'free':
      return `- This service has no article in the Divine Service Guide (a funeral or a wedding), so the main points come from the text word and the message: propose two or three, each with a heading of a few words, and leave "source" empty. ${body}`;
    default:
      return `- ${never} The Guide's article is not given here, and the minister has not written the main points. So propose no main points: leave "points" empty, and say in "note", in one or two plain sentences, that the main points need the Guide: take the message from the Guide under step 2, or write the Guide's main points under step 4, then ask again. ${job === 'outline' ? 'Still propose the introduction, the application, the conclusion and the illustrations from the text and the message.' : 'Still answer the rest.'}`;
  }
}

/** The fixed list of main points for the user turn, as pointAnchors found them. */
function pointsPart({ mode, anchors }) {
  if (mode === 'guide') return 'THE MAIN POINTS, FROM THE GUIDE (fixed: this number, this order, these headings)\n' + anchors.map(a => `${a.n}. ${a.heading}${a.body ? '\n' + a.body : ''}`).join('\n\n');
  if (mode === 'own') return 'THE MAIN POINTS, AS THE MINISTER WROTE THEM FROM THE GUIDE (fixed: this number, this order, his headings)\n' + anchors.map(a => `${a.n}. ${a.heading}${a.body ? ' – ' + a.body : ''}`).join('\n');
  if (mode === 'article') return 'THE MAIN POINTS\nThe article above has no headings over its parts: take the main points from its paragraphs, in order, as the rules say.';
  if (mode === 'free') return 'THE MAIN POINTS\nThis service has no article in the Guide: propose them from the text and the message, as the rules say.';
  return 'THE MAIN POINTS\nNone are given: the Guide\'s article is not linked and the minister has not written them. Propose none, and say in the note that they need the Guide.';
}

/**
 * The minister's own main points when the Guide's are the anchors: his
 * wording for a Guide point is kept; a point of his that is not in the Guide
 * is named as such. '' when he has written none, or only the Guide's own words.
 */
function ownPointsLine(s, { anchors }) {
  const own = (s.points || []).filter(p => p && ((p.heading || '').trim() || (p.body || '').trim()));
  const lines = own.map((p, i) => {
    const a = anchors.find(x => x.n === p.guide) || anchors.find(x => norm(x.heading) === norm(p.heading));
    const untouched = a && norm(p.heading) === norm(a.heading) && norm(p.body) === norm(a.body);
    if (untouched) return '';   // still the Guide's own words, as prefilled
    return `Main point ${i + 1}: ${p.heading || ''}${p.body ? ' – ' + p.body : ''}${a ? ` (his words for the Guide's point ${a.n}: keep his wording)` : ' (not in the Guide: not a main point; say so in the note)'}`;
  }).filter(Boolean);
  return lines.length ? 'His main points so far, where he has changed them from the Guide\'s:\n' + lines.join('\n') : '';
}

/** The article as Claude broke it down earlier (step 2), by heading: the plain words and the insight of each piece; '' when there is none. */
function breakdownPart(s) {
  const b = s.breakdown;
  if (!b || !(b.parts || []).length) return '';
  const lines = ['THE ARTICLE BROKEN DOWN EARLIER (what each piece says in plain words and gives the sermon, under the Guide\'s headings; draw on it for the main point under that heading)'];
  let heading = null;
  for (const p of b.parts) {
    if ((p.heading || '') !== heading) { heading = p.heading || ''; if (heading) lines.push(`[${heading}]`); }
    const said = [p.said, p.insight].filter(Boolean).join(' ');
    if (said) lines.push(`- ${said}`);
  }
  if (b.thread) lines.push(`The thread: ${b.thread}`);
  return lines.join('\n');
}

/**
 * The model's main points held to the anchors: each anchor gets the model's
 * point for it (matched by "source" or heading, then by place when one is
 * left for each hole), else the anchor's own words; points that match no
 * anchor are left out and counted. Without anchors: free points as given;
 * article points only when their "source" is in the article's text.
 */
function alignPoints(items, { mode, anchors }, service) {
  const given = (Array.isArray(items) ? items : []).filter(Boolean).map(p => ({ heading: str(p.heading), body: str(p.body), why: str(p.why), source: str(p.source) })).filter(p => p.heading || p.body);
  if (mode === 'free') return { points: given.map((p, i) => ({ ...p, n: i + 1, source: '', from: '' })), dropped: 0 };
  if (mode === 'article') {
    const text = norm([service && service.introduction, ...((service && service.sections) || []).map(x => `${x.heading}\n${x.body}`), service && service.context].filter(Boolean).join('\n'));
    const kept = given.filter(p => p.source && norm(p.source).length >= 8 && text.includes(norm(p.source)));
    return { points: kept.map((p, i) => ({ ...p, n: i + 1, from: 'guide' })), dropped: given.length - kept.length };
  }
  if (!anchors.length) return { points: [], dropped: given.length };
  const slots = anchors.map(() => null);
  const fits = (p, a, loose) => {
    const ak = norm(a.heading);
    return [norm(p.source), norm(p.heading)].filter(Boolean).some(k => k === ak || (loose && k.length >= 8 && ak.length >= 8 && (k.includes(ak) || ak.includes(k))));
  };
  for (const loose of [false, true]) {
    for (const p of given) {
      if (slots.includes(p)) continue;
      const i = anchors.findIndex((a, j) => !slots[j] && fits(p, a, loose));
      if (i >= 0) slots[i] = p;
    }
  }
  const left = given.filter(p => !slots.includes(p));
  const holes = slots.map((p, i) => (p ? -1 : i)).filter(i => i >= 0);
  if (left.length && left.length === holes.length) { holes.forEach((i, k) => { slots[i] = left[k]; }); left.length = 0; }
  const points = anchors.map((a, i) => {
    const p = slots[i];
    return { n: a.n, heading: (p && p.heading) || a.heading, body: p ? p.body : a.body, why: p ? p.why : '', source: a.heading, from: a.from, asGiven: !p };
  });
  return { points, dropped: left.length };
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

/** Catechism references as the model gave them → [{n, title, why}], only numbers that are in the index, each once. */
function tidyCatRefs(items) {
  const out = [];
  for (const c of (Array.isArray(items) ? items : []).filter(Boolean)) {
    const n = str(c.n).replace(/^CNAC\s*/i, '');
    const sec = Cat.section(n);
    if (sec && !out.find(x => x.n === n)) out.push({ n, title: sec.title, why: str(c.why) });
  }
  return out;
}

/** Bible references as the model gave them → [{reference, why, ref}], `ref` parsed when the app understands it. */
function tidyBibleRefs(items) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map(x => {
    const reference = str(x.reference).replace(DASHES, '-');
    return { reference, why: str(x.why), ref: parseRef(reference) };
  }).filter(x => x.reference);
}

function tidySuggestions(r, lang, qs, where, service) {
  const d = r.data || {};
  const list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const context = list(d.context).map((c, i) => ({ question: str(c.question) || qs[i] || '', answer: str(c.answer) })).filter(c => c.answer);
  const keywords = list(d.keywords).map(k => ({ word: str(k.word), meaning: str(k.meaning) })).filter(k => k.word);
  const catechism = tidyCatRefs(d.catechism);
  const crossRefs = tidyBibleRefs(d.crossRefs);
  const { points, dropped } = alignPoints(d.points, where, service);
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    context, keywords, catechism, crossRefs, points, pointsFrom: where.mode, dropped,
    application: str(d.application), note: str(d.note),
  };
}

/* ---------------------------------------------------------------- building the sermon */

const OUTLINE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intro', 'points', 'application', 'conclusion', 'illustrations', 'lighter', 'thoughts', 'note'],
  properties: {
    intro: {
      type: 'object', additionalProperties: false, required: ['text', 'why'], description: 'The introduction: how the sermon opens',
      properties: { text: { type: 'string', description: 'Three to five short sentences, as the minister could speak them' }, why: { type: 'string', description: 'One short line on why this opening works for this text, this message and these people' } },
    },
    points: {
      type: 'array', description: 'The main points, as the rules on the main points say: the Guide\'s, in its order; empty when the rules say to propose none',
      items: { type: 'object', additionalProperties: false, required: ['heading', 'body', 'why', 'source'], properties: { heading: { type: 'string', description: 'The heading of the point, in the language of the sermon: the Guide\'s heading, or the minister\'s' }, body: { type: 'string', description: 'Three to six short sentences: what the Guide says under this heading, what the text says there, what it asks of us' }, why: { type: 'string', description: 'One short line on what this point does for the message' }, source: { type: 'string', description: 'The heading this point comes from, word for word as given under THE MAIN POINTS; empty only when no Guide applies' } } },
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
    thoughts: {
      type: 'array', description: 'One entry per thought of the minister\'s under THE MINISTER\'S OWN THOUGHTS, by its id; empty when there are none',
      items: { type: 'object', additionalProperties: false, required: ['id', 'where', 'how', 'question'], properties: { id: { type: 'string', description: 'T1, T2 … as given' }, where: { type: 'string', description: 'The part of the sermon it went into, e.g. "main point 3" or "the introduction"' }, how: { type: 'string', description: 'How it was woven in, in one or two short sentences, so the minister finds it' }, question: { type: 'string', description: 'One short plain question to the minister when the thought is still too unclear to use well; else empty' } } },
    },
    note: { type: 'string', description: 'Anything the minister should know about this outline, e.g. a choice made between two directions; else empty' },
  },
};

function outlineSystem(lang, humour, where, thoughts) {
  return `You help a minister of the New Apostolic Church build an unscripted sermon for a divine service. The Bible text and the message of the service are given; the message comes from the Church's Divine Service Guide and sets the direction. Your task is to propose how the sermon is best built from them: an introduction that opens the door, the main points as the Guide gives them, each standing on the text, an application for the congregation, a conclusion that leads to the altar, and a few illustrations. For each part say in one short line why it works here. The minister decides; he takes what serves him.

Rules:
${pointsRule(where.mode, 'outline')}
- The introduction, the application, the conclusion and the illustrations are yours to propose, but each stands on those main points and on the message: the introduction opens the door to the first point, the application and the conclusion gather the points up, and every illustration serves one of them. Nothing pulls away from them.
- Stay faithful to the Bible text and to the doctrine of the New Apostolic Church as the Catechism states it. Where the Catechism text given below speaks to the matter, let it shape the body of the points. Do not state what a Catechism section says unless its text is given; where you draw on it, say it in plain words.
- The message of the service gives the direction: the whole outline serves it and does not pull the text elsewhere.
- A New Apostolic sermon is preached freely, lasts fifteen to twenty minutes at most, and leads the congregation to the forgiveness of sins and Holy Communion: the conclusion ends there. In a divine service for the departed, the departed are included in the hope and the intercession.
- Write every part so the minister could speak it as it stands: in the voice of a minister speaking to his congregation, "we" and "us", no headings inside the text.
- Build on what the minister has written already: keep his direction and wording where he has one, fill what is empty, and offer an alternative only where his draft is thin. Do not repeat his text back to him. Where a main point still carries the Guide's own words, as it was filled in, write it in plain words for these people.
${thoughts ? thoughtsRule() : ''}- Illustrations: a picture from daily life, a true-to-life example or a Bible story that makes a point visible, taken from the world of the people who are listening. When one of the minister's own notes fits, use that one and say so ("from your notes: …") rather than inventing another.
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
 * minister's own notes in the other steps (his draft of the introduction,
 * main points, summary, application and conclusion, his understanding of the
 * text under step 5), the ticked Catechism sections and the minister's
 * experience and illustration notes.
 */
export async function outline(s, { service = null, guideTitle = '', signal, onProgress } = {}) {
  const lang = langOf(s);
  const humour = humourOf(s);
  const where = pointAnchors(s, service);
  const thoughts = pointThoughts(s, where);
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));
  const broken = breakdownPart(s);
  if (broken) parts.push(broken);
  parts.push(pointsPart(where));

  const seen = [s.context ? `Context: ${s.context}` : '', s.keywords ? `Key words: ${s.keywords}` : '', s.crossRefs ? `Cross references: ${s.crossRefs}` : ''].filter(Boolean);
  if (seen.length) parts.push('THE MINISTER\'S UNDERSTANDING OF THE TEXT (his notes under step 5, the context)\n' + seen.join('\n'));
  if (s.ai && ((s.ai.points || []).length || s.ai.application)) {
    parts.push('SERMON THOUGHTS SUGGESTED EARLIER (build on them where they serve; do not repeat them unchanged)\n'
      + (s.ai.points || []).map(p => `- ${p.heading}${p.body ? ': ' + p.body : ''}`).join('\n')
      + (s.ai.application ? `\n- Application: ${s.ai.application}` : ''));
  }

  const points = where.mode === 'own' ? [] : (s.points || []).filter(p => p.heading || p.body);   // his own points are the anchors already
  const draft = [
    s.intro ? `Introduction: ${s.intro}` : '',
    where.mode === 'guide' ? ownPointsLine(s, where) : points.map((p, i) => `Main point ${i + 1}: ${p.heading}${p.body ? ' – ' + p.body : ''}`).join('\n'),
    s.summary ? `Summary: ${s.summary}` : '',
    s.application ? `Application: ${s.application}` : '',
    s.conclusion ? `Conclusion: ${s.conclusion}` : '',
    s.illustrations ? `Illustrations: ${s.illustrations}` : '',
  ].filter(Boolean);
  parts.push(draft.length
    ? 'THE MINISTER\'S DRAFT OF THE SERMON SO FAR (keep his direction; fill what is missing; improve only what is thin)\n' + draft.join('\n')
    : 'THE MINISTER\'S DRAFT OF THE SERMON SO FAR\nNothing written yet: propose the whole build.');
  if (thoughts.length) parts.push(thoughtsPart(thoughts, where.mode));

  parts.push(await catechismPart(s, service, { index: false }));

  const notes = (state.notes || []).filter(n => n.kind === 'experience' || n.kind === 'illustration').slice(0, 15);
  if (notes.length) {
    parts.push('THE MINISTER\'S OWN EXPERIENCES AND ILLUSTRATIONS, from his notes (use one where it fits the message)\n'
      + notes.map(n => `- ${formatRef({ book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verseEnd }, 'en')}${n.title ? ` – ${n.title}` : ''}: ${(n.body || '').slice(0, 500)}`).join('\n'));
  }

  const r = await run({
    system: outlineSystem(lang, humour, where, thoughts.length > 0),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: OUTLINE_SCHEMA, effort: 'high', maxTokens: 12000, signal, onProgress,
  });
  return { ...tidyOutline(r, lang, humour, where, service, thoughts), audience: audienceOf(s) };
}

function tidyOutline(r, lang, humour, where, service, thoughts) {
  const d = r.data || {};
  const list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const intro = d.intro && typeof d.intro === 'object' ? { text: str(d.intro.text), why: str(d.intro.why) } : { text: str(d.intro), why: '' };
  const { points, dropped } = alignPoints(d.points, where, service);
  const illustrations = list(d.illustrations).map(x => ({ title: str(x.title), body: str(x.body), serves: str(x.serves) })).filter(x => x.body);
  const lighter = humour !== 'none' && d.lighter && typeof d.lighter === 'object' && str(d.lighter.text) ? { text: str(d.lighter.text), where: str(d.lighter.where) } : null;
  return {
    at: new Date().toISOString(), model: r.model, lang, humour,
    cost: cost(r.usage, r.model),
    intro, points, pointsFrom: where.mode, dropped, application: str(d.application), conclusion: str(d.conclusion), illustrations, lighter, note: str(d.note),
    thoughts: tidyThoughts(d.thoughts, thoughts, x => ({ where: str(x.where), how: str(x.how), question: str(x.question) })),
  };
}

/* ------------------------------------------------- the minister's own thoughts on the main points */

/**
 * The minister's own thoughts on the main points, as he wrote them under
 * each point in step 4, with the questions Claude asked about each and his
 * answers: [{id, i, p, anchor}], named T1, T2 … in the order of his points.
 * `anchor` is the Guide's point the thought belongs to, when there is one.
 */
export function pointThoughts(s, where) {
  const anchors = (where && where.anchors) || [];
  const out = [];
  (s.points || []).forEach((p, i) => {
    if (!p || !str(p.thought)) return;
    const anchor = anchors.find(x => x.n === p.guide) || anchors.find(x => norm(x.heading) && norm(x.heading) === norm(p.heading)) || null;
    out.push({ id: `T${out.length + 1}`, i, p, anchor });
  });
  return out;
}

/** Those thoughts for the user turn, each under the point it stands on, with what was asked and answered about it. */
function thoughtsPart(list, mode) {
  const lines = ['THE MINISTER\'S OWN THOUGHTS ON THE MAIN POINTS (his input for this sermon, named T1, T2 …; see the rules)'];
  for (const { id, i, p, anchor } of list) {
    const on = anchor
      ? `main point ${anchor.n}, "${anchor.heading}"`
      : `his main point ${i + 1}${str(p.heading) ? `, "${str(p.heading)}"` : ''}${mode === 'guide' ? ' (not one of the Guide\'s points)' : ''}`;
    lines.push(`${id}. On ${on}: ${str(p.thought)}`);
    for (const e of p.talk || []) {
      if (!e || !str(e.q)) continue;
      lines.push(`   You asked him: ${str(e.q)}`);
      lines.push(str(e.a) ? `   He answered: ${str(e.a)}` : '   He has not answered that yet.');
    }
  }
  return lines.join('\n');
}

/** The rule on the thoughts for the outline's system prompt. */
function thoughtsRule() {
  return `- His own thoughts (under THE MINISTER'S OWN THOUGHTS, named T1, T2 …) are his input for this sermon and belong in it. Weave each one into the main point it stands under, where it serves that point best (as the picture that opens it, as what it asks of us, as the word that carries it), in his own words where they are good; where it serves better elsewhere (the introduction, an illustration, the application, the conclusion, another point), put it there. Leave none out, and do not also repeat it as a separate illustration. Where he answered a question of yours, build on his answer. In "thoughts" account for every one by its id: where it went and how, in one or two plain sentences, so he finds it. Where one is still too unclear to use well, use it as best you can and put one short question to him there; else leave "question" empty.
`;
}

const THOUGHTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['thoughts', 'note'],
  properties: {
    thoughts: {
      type: 'array', description: 'One entry per thought, by its id, in the order given',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'clear', 'plan', 'question'],
        properties: {
          id: { type: 'string', description: 'T1, T2 … as given' },
          clear: { type: 'boolean', description: 'True when the thought is understood and its place in the sermon is clear' },
          plan: { type: 'string', description: 'Where it would go and how, in one or two short sentences' },
          question: { type: 'string', description: 'One short plain question to the minister when the thought is not clear; else empty' },
        },
      },
    },
    note: { type: 'string', description: 'Anything else the minister should know; else empty' },
  },
};

function thoughtsSystem(lang) {
  return `You help a minister of the New Apostolic Church build an unscripted sermon for a divine service. The sermon is not being built yet. Before it is, the minister wants you to read the thoughts he has written on the main points, see where each one fits into the sermon, and ask him where something is unclear, so that the sermon can carry his thoughts well. That is the whole task now.

For each thought (named T1, T2 … under THE MINISTER'S OWN THOUGHTS):
- "plan": where it would go and how, in one or two short sentences: as the picture that opens its point, as what the point asks of us, as the word that carries it, in the introduction, as an illustration, in the conclusion. Where it serves better elsewhere than under the point he put it, say so; he decides.
- "clear" is true when you understand the thought and can see where it fits. Then "question" is empty. Most thoughts are like that.
- "clear" is false when you cannot tell what he means, when it could go two ways that would change the sermon, when it does not obviously fit its point or the Guide's message, or when you need a detail to use it well (what happened, who was there, how it ended, what he wants the people to take from it). Then "question" is one short, plain question to him: the one that matters most. One question per thought at most.
- Where he has already answered a question of yours, build on his answer and do not ask it again; ask once more only if the answer still leaves the thought unclear. Where an earlier question is still unanswered and still stands, ask it again, better worded if you can; where the thought has become clear without it, let it go.
- Never judge his thought or his wording; he knows his people. Do not write the sermon or the point now.
- The main points of the sermon come from the Church's Divine Service Guide, never from you or from his thoughts: a thought enriches a point, it does not replace one.

${voiceRules(lang)}

Put nothing outside the JSON fields.`;
}

/**
 * Before the sermon is built: Claude reads the minister's thoughts on the
 * main points, says where each would go, and asks where one is unclear.
 * Resolves to {thoughts: [{i, clear, plan, question}], note, …}, `i` being
 * the place of the point under step 4; empty when he has written none.
 */
export async function readThoughts(s, { service = null, guideTitle = '', signal, onProgress } = {}) {
  const lang = langOf(s);
  const where = pointAnchors(s, service);
  const list = pointThoughts(s, where);
  if (!list.length) return { at: new Date().toISOString(), model: '', lang, cost: 0, thoughts: [], note: '' };
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));
  parts.push(pointsPart(where));
  const draft = [s.intro ? `Introduction: ${s.intro}` : '', s.application ? `Application: ${s.application}` : '', s.conclusion ? `Conclusion: ${s.conclusion}` : '', s.illustrations ? `Illustrations: ${s.illustrations}` : ''].filter(Boolean);
  if (draft.length) parts.push('THE MINISTER\'S DRAFT OF THE SERMON SO FAR (so you see where things already are)\n' + draft.join('\n'));
  parts.push(thoughtsPart(list, where.mode));
  parts.push('THE TASK\nRead each thought under THE MINISTER\'S OWN THOUGHTS and answer for each one by its id, as the rules say. The sermon itself is not built now.');

  const r = await run({
    system: thoughtsSystem(lang),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: THOUGHTS_SCHEMA, effort: 'medium', maxTokens: 4000, signal, onProgress,
  });
  const d = r.data || {};
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    thoughts: tidyThoughts(d.thoughts, list, x => ({ clear: x.clear !== false, plan: str(x.plan), question: str(x.question) })),
    note: str(d.note),
  };
}

/**
 * The model's entries on the thoughts, by id, back onto the minister's
 * points: [{i, n, heading, thought, …pick(entry)}], each thought once, in
 * the order of his points; an id the model made up is left out.
 */
function tidyThoughts(items, list, pick) {
  const out = [];
  for (const x of (Array.isArray(items) ? items : []).filter(Boolean)) {
    const th = list.find(y => y.id === str(x.id).toUpperCase());
    if (!th || out.find(o => o.i === th.i)) continue;
    out.push({ i: th.i, n: th.i + 1, heading: str(th.p.heading), thought: str(th.p.thought), ...pick(x) });
  }
  return out.sort((a, b) => a.i - b.i);
}

/* ------------------------------------------------- one thought into its own main point */

const WEAVE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['clear', 'question', 'body', 'how', 'note'],
  properties: {
    clear: { type: 'boolean', description: 'True when the thought is clear enough to weave in well; false when a question must come first' },
    question: { type: 'string', description: 'When "clear" is false: one short, plain question to the minister, the one that matters most; else empty' },
    body: { type: 'string', description: 'When "clear" is true: the text of this main point with his thought woven in, ready to speak, without the heading; else empty' },
    how: { type: 'string', description: 'When "clear" is true: where in the point his thought now stands and how, in one or two plain sentences; else empty' },
    note: { type: 'string', description: 'Anything else the minister should know; else empty' },
  },
};

function weaveSystem(lang, humour) {
  return `You help a minister of the New Apostolic Church prepare an unscripted sermon for a divine service. He has written his own thought on one of the main points, and he wants it woven into that point. Only that point is written now: the rest of the sermon stays as he has it.

Rules:
- Write the text of THIS MAIN POINT again, with his thought (under HIS THOUGHT ON THIS POINT) woven in where it serves the point best: as the picture that opens it, as the example that makes it visible, as what it asks of us. Use his own words where they are good.
- Keep his direction and his wording: what he has written under the point stays, unless a sentence must change for the thought to fit. Where the point still carries the Guide's own words, as it was filled in, write it in plain words for these people. Where nothing is written under it yet, write it in three to six short sentences: what the Guide says under this heading, what the text says there, what it asks of us, with his thought in it.
- The heading stays as it is: the main points come from the Church's Divine Service Guide, and a thought enriches a point, it does not replace one. Write only the text under the heading, with no heading inside it.
- Stay on this point. The other main points are given so you see the whole: do not take in what belongs to them, and do not write the introduction, the application or the conclusion.
- Stay faithful to the Bible text, to the message of the service and to the doctrine of the New Apostolic Church.
- Tell his story only as he told it: add no names, places, words or endings he did not give. Where you need such a detail to use the thought well, or the thought could go two ways that would change the point, set "clear" to false, ask him one short, plain question (the one that matters most) and leave "body" and "how" empty. Where he has answered a question of yours, build on his answer and do not ask it again. Most thoughts are clear: then set "clear" to true and write the point.
- In "how", say in one or two plain sentences where in the point his thought now stands and how, so he finds it.
- Never judge his thought or his wording; he knows his people.
- Write so he could speak it as it stands: in the voice of a minister speaking to his congregation, "we" and "us". About as long as the point was, a little longer for the thought; never a whole sermon.

${voiceRules(lang)}

${peopleRules()}

${humourRules(humour)}

Put nothing outside the JSON fields.`;
}

/**
 * The minister's thought on one main point (s.points[i].thought), with what
 * Claude asked about it and his answers, woven into that point only: the
 * other points, the introduction, the application and the conclusion are
 * given for the whole picture and left alone. Resolves to {clear, body, how,
 * question, note, …}: with `clear` the point's new text and where the thought
 * went; else one question to ask him first.
 */
export async function weaveThought(s, i, { service = null, guideTitle = '', signal, onProgress } = {}) {
  const lang = langOf(s);
  const humour = humourOf(s);
  const p = (s.points || [])[i];
  if (!p || !str(p.thought)) throw new Error(t('Write your thought on this point first.'));
  const where = pointAnchors(s, service);
  const anchor = where.anchors.find(x => x.n === p.guide) || where.anchors.find(x => norm(x.heading) && norm(x.heading) === norm(p.heading)) || null;
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  parts.push(messagePart(s, service, guideTitle));
  parts.push(pointsPart(where));
  // the rest of the sermon as he has it, so this point does not take what belongs elsewhere
  const clip = v => (str(v).length > 400 ? str(v).slice(0, 400) + ' …' : str(v));
  const others = (s.points || []).map((x, k) => (k === i || !x || !(str(x.heading) || str(x.body)) ? '' : `Main point ${k + 1}: ${str(x.heading)}${str(x.body) ? ' – ' + clip(x.body) : ''}`)).filter(Boolean);
  const draft = [s.intro ? `Introduction: ${clip(s.intro)}` : '', ...others, s.application ? `Application: ${clip(s.application)}` : '', s.conclusion ? `Conclusion: ${clip(s.conclusion)}` : ''].filter(Boolean);
  if (draft.length) parts.push('THE REST OF HIS SERMON AS HE HAS IT (for the whole picture; leave it alone)\n' + draft.join('\n'));
  const untouched = anchor && str(p.body) && norm(p.body) === norm(anchor.body);
  const on = anchor ? `main point ${anchor.n}, "${anchor.heading}"` : `his main point ${i + 1}${str(p.heading) ? `, "${str(p.heading)}"` : ''}`;
  parts.push(`THIS MAIN POINT (${on}; the only part you write now)\nHeading: ${str(p.heading) || (anchor ? anchor.heading : '')}\n`
    + (str(p.body) ? `What he has under it${untouched ? ' (still the Guide\'s own words, as it was filled in)' : ''}:\n${str(p.body)}` : 'Nothing is written under it yet.'));
  const talk = [];
  for (const e of p.talk || []) {
    if (!e || !str(e.q)) continue;
    talk.push(`You asked him: ${str(e.q)}`, str(e.a) ? `He answered: ${str(e.a)}` : 'He has not answered that yet.');
  }
  parts.push(`HIS THOUGHT ON THIS POINT\n${str(p.thought)}${talk.length ? '\n' + talk.join('\n') : ''}`);
  parts.push('THE TASK\nWeave his thought into this main point, as the rules say. Only this point.');

  const r = await run({
    system: weaveSystem(lang, humour),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: WEAVE_SCHEMA, effort: 'medium', maxTokens: 4000, signal, onProgress,
  });
  const d = r.data || {};
  const body = str(d.body);
  const clear = d.clear !== false && !!body;
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    clear, body: clear ? body : '', how: clear ? str(d.how) : '',
    question: clear ? '' : str(d.question), note: str(d.note),
  };
}

/* ---------------------------------------------------------------- the Guide, piece by piece */

const BREAKDOWN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['parts', 'thread', 'note'],
  properties: {
    parts: {
      type: 'array', description: 'The article taken apart piece by piece, in the order of the booklet',
      items: {
        type: 'object', additionalProperties: false, required: ['heading', 'quote', 'said', 'insight', 'bible', 'catechism'],
        properties: {
          heading: { type: 'string', description: 'The heading of the article this piece stands under, as the Guide prints it: "Message", "Introduction", the section\'s own heading, or "Context"' },
          quote: { type: 'string', description: 'The sentence, or the two or three sentences that make one thought, word for word as the Guide prints them' },
          said: { type: 'string', description: 'What it says, in plain words: one or two short sentences' },
          insight: { type: 'string', description: 'What it gives the sermon: the thought behind it, what it means for the people, what it asks of them; one to three short sentences' },
          bible: {
            type: 'array', description: 'Bible passages that bring depth to this piece: none, one or two',
            items: { type: 'object', additionalProperties: false, required: ['reference', 'why'], properties: { reference: { type: 'string', description: 'English book name, chapter and verse(s), e.g. "Romans 8:28" or "1 Peter 3:18-20"' }, why: { type: 'string', description: 'One line on what it adds here' } } },
          },
          catechism: {
            type: 'array', description: 'Catechism sections that bring depth to this piece: none, one or two, by number from the index given',
            items: { type: 'object', additionalProperties: false, required: ['n', 'why'], properties: { n: { type: 'string', description: 'The section number as in the index, e.g. "9.6.3"' }, why: { type: 'string', description: 'One line on what it adds here' } } },
          },
        },
      },
    },
    thread: { type: 'string', description: 'The line that runs through the whole article: the one thing it drives at, in two or three short sentences' },
    note: { type: 'string', description: 'Anything the minister should know about this breakdown, e.g. where the Catechism does not speak to the article; else empty' },
  },
};

function breakdownSystem(lang) {
  return `You help a minister of the New Apostolic Church prepare an unscripted sermon for a divine service. The Church's Divine Service Guide gives an article for the service: the Bible text, the message and a few paragraphs that unfold it. The minister wants to understand that article thoroughly before he builds his sermon. Your task is to take the article apart piece by piece, in its own order, and for each piece say what it says in plain words, what it gives the sermon, and which Bible passages and Catechism sections bring depth to it.

Rules:
- A piece is one sentence. Where one sentence alone is too thin to carry a thought (a list, a sentence that only leads into the next, a short question with its answer), take two or three sentences together as one piece. Never more than three.
- Cover the whole article: the Message, the Introduction, every section under its own heading, and the Context box (as one or two pieces). Leave out the Bible text at the top, the Summary box (it repeats the article) and the Catechism citations in brackets. Skip nothing else, and change the order of nothing.
- Copy each piece word for word, in the language of the Guide, so the minister finds it in his booklet. Everything else you write comes in the language given below.
- "What it says": the piece again in plain words, as you would explain it to a friend. Where the Guide uses a Church or Bible word, say what it means here.
- "What it gives the sermon": the thought behind the piece. Why the Guide says it here, what it means for the people, what it asks of them, or where it leads. One to three short sentences. Where a piece only leads into the next, say so in one line.
- Bible passages: one or two for a piece, only where a passage genuinely deepens that piece (the story it points to, the verse it echoes, the promise it rests on). Many pieces need none. Give the English book name, chapter and verse(s), and one line on what it adds. Do not quote the verse, and do not give the text word of the service itself again.
- Catechism: one or two sections for a piece, only where the Catechism speaks to that piece, by number from the index given below, with one line on what it adds. Never state what a section says unless its text is given; where it is given, draw on it in plain words. Many pieces need none.
- Stay faithful to the Bible text, to the Guide and to the doctrine of the New Apostolic Church as the Catechism states it. Do not pull the article elsewhere.
- The thread: at the end, the line that runs through the whole article, as the one thing it drives at, in two or three short sentences.

${voiceRules(lang)}

${peopleRules()}

Put nothing outside the JSON fields.`;
}

/**
 * The Guide's article for one preparation, taken apart piece by piece: for
 * each sentence (or short passage) what it says in plain words, what it
 * gives the sermon, and the Bible passages and Catechism sections that bring
 * depth to it. `service` is the Guide's article the preparation is linked to.
 */
export async function breakdown(s, { service = null, guideTitle = '', signal, onProgress } = {}) {
  if (!service) throw new Error(t('Take the message from the Guide first (step 2), so Claude has the article.'));
  const lang = langOf(s);
  const parts = [servicePart(s), peoplePart(s, lang), preacherPart()].filter(Boolean);
  if (s.text) parts.push(`THE TEXT\n${s.text}`);
  const chapter = await chapterPart(s);
  if (chapter) parts.push(chapter);
  parts.push(messagePart(s, service, guideTitle));
  parts.push(await catechismPart(s, service));
  parts.push('THE TASK\nTake the article under THE ARTICLE IN THE DIVINE SERVICE GUIDE apart piece by piece, as the rules say.');

  const r = await run({
    system: breakdownSystem(lang),
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: BREAKDOWN_SCHEMA, effort: 'high', maxTokens: 24000, signal, onProgress,
  });
  return { ...tidyBreakdown(r, lang), audience: audienceOf(s) };
}

function tidyBreakdown(r, lang) {
  const d = r.data || {};
  const parts = (Array.isArray(d.parts) ? d.parts : []).filter(Boolean).map(p => ({
    heading: str(p.heading),
    quote: str(p.quote),
    said: str(p.said),
    insight: str(p.insight),
    bible: tidyBibleRefs(p.bible),
    catechism: tidyCatRefs(p.catechism),
  })).filter(p => p.quote && (p.said || p.insight));
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    parts, thread: str(d.thread), note: str(d.note),
  };
}

/* ---------------------------------------------------------------- theology */

/*
 * Theological background on a passage, a chapter or a whole book, for the
 * Theology section (theology.js). One shape for all three, so the
 * instructions, the Creed and the Catechism's index form the same opening
 * of every request and are read from Anthropic's prompt cache when the
 * minister asks again within a few minutes (a tenth of the price).
 */
const INSIGHT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['plain', 'background', 'writer', 'place', 'parts', 'words', 'themes', 'church', 'views', 'christ', 'bible', 'catechism', 'today', 'note'],
  properties: {
    plain: { type: 'string', description: 'In plain words: what the passage says, what happens or is said in the chapter, or what the book is about' },
    background: { type: 'string', description: 'The time, the place, the people and the customs that help to understand it' },
    writer: { type: 'string', description: 'Who wrote it and how we know; for a book, what of his life and situation matters for it; for a passage or chapter, what of the writer shows here' },
    place: { type: 'string', description: 'Where it stands: what comes before and after it, and its place in the book and in the history of salvation' },
    parts: {
      type: 'array', description: 'How it is built, in order: for a chapter its parts by verses, for a book its parts by chapters; empty for a passage of a few verses',
      items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'title'], properties: { from: { type: 'integer', description: 'The first verse (a chapter) or chapter (a book) of this part' }, to: { type: 'integer', description: 'The last verse or chapter of this part' }, title: { type: 'string', description: 'A few plain words' } } },
    },
    words: {
      type: 'array', description: 'Words of the text that carry its weight',
      items: { type: 'object', additionalProperties: false, required: ['word', 'meaning'], properties: { word: { type: 'string' }, meaning: { type: 'string', description: 'What it means here, in plain words' } } },
    },
    themes: {
      type: 'array', description: 'What it teaches: about God, Jesus Christ, people, salvation, the church or the future',
      items: { type: 'object', additionalProperties: false, required: ['theme', 'text'], properties: { theme: { type: 'string', description: 'A short heading' }, text: { type: 'string', description: 'Two or three short sentences' } } },
    },
    church: { type: 'string', description: 'What the New Apostolic Church teaches about what this speaks of, as the Catechism given states it, with section numbers in brackets as the instructions show' },
    views: {
      type: 'array', description: 'How Christians read it, where that matters: up to three ways, each compared with New Apostolic teaching; empty when there is nothing worth comparing',
      items: { type: 'object', additionalProperties: false, required: ['view', 'text', 'nac', 'differs'], properties: { view: { type: 'string', description: 'A short name for the reading, e.g. "Many Protestant churches"' }, text: { type: 'string', description: 'The reading in one or two plain sentences' }, nac: { type: 'string', enum: ['agrees', 'differs', 'open'], description: '"agrees": in line with New Apostolic teaching; "differs": New Apostolic teaching says otherwise; "open": the Catechism does not decide it' }, differs: { type: 'string', description: 'When "differs": how New Apostolic teaching differs, in one plain sentence; else empty' } } },
    },
    christ: { type: 'string', description: 'How it points to Jesus Christ, or what it shows of Him' },
    bible: {
      type: 'array', description: 'Other Bible passages that shed light on it',
      items: { type: 'object', additionalProperties: false, required: ['reference', 'why'], properties: { reference: { type: 'string', description: 'English book name, chapter and verse(s), e.g. "Romans 8:28" or "1 Peter 3:18-20"' }, why: { type: 'string', description: 'One line on how it connects' } } },
    },
    catechism: {
      type: 'array', description: 'Catechism sections that belong with it, by number from the index given',
      items: { type: 'object', additionalProperties: false, required: ['n', 'why'], properties: { n: { type: 'string', description: 'The section number as in the index, e.g. "8.1"' }, why: { type: 'string', description: 'One line on what the section adds here' } } },
    },
    today: { type: 'string', description: 'What it says to us today, for the congregation and for the minister himself' },
    note: { type: 'string', description: 'Anything else he should know, e.g. where scholars disagree on something that matters; else empty' },
  },
};

/** How a study answer is written: plain words for a minister who did not study theology, and wants the depth anyway. */
function studyVoice(lang) {
  return `How to write, always:
- Short sentences, one thought each. Everyday words, the kind people use at the kitchen table. Three or four sentences, then a break.
- He did not study theology and keeps his words simple, but he wants the depth. When a Bible or Church word is the right one (covenant, grace, atonement, sacrament, prophecy), use it and say in a few plain words what it means here. Never use a hard word to sound learned.
- Put the main thing first. Start a line with its key word. Leave out what does not help him understand the text. Nothing padded, and nothing said twice in two fields.
- Name a theologian, a council or a school of thought only when it truly matters, and then say in a few plain words who or what it is.
- Answer in ${lang === 'af' ? 'Afrikaans: plain, everyday Afrikaans as it is spoken in the congregation, not stiff or bookish. Church words as the New Apostolic Church in South Africa says them: godsdiens, Apostel, gemeente, Heilige Nagmaal, Heilige Verseëling, die wederkoms van Christus' : 'English: plain, everyday English as it is spoken in South Africa'}. Give Bible references with the English book names, as the schema asks.`;
}

function insightSystem(lang) {
  return `You help a minister of the New Apostolic Church study the Bible. He asks for the theological background of a Bible passage, a chapter or a whole book: what it says, where it comes from, who wrote it, what it teaches and how it is understood, so that he understands it well and can preach from it.

What to give, field by field:
- plain: what it says (a passage), what happens or is said in it (a chapter), or what the book is about. Two to four short sentences.
- background: the time, the place, the people and the customs that help to understand it. Three to five short sentences. Say plainly what is certain; where it is not certain (a date, a place), say so in a few words.
- writer: for a book, who wrote it, how we know, and what of his life and situation matters for the book, in three to six short sentences. For a passage or a chapter, one or two sentences on the writer and what of him shows here.
- place: where it stands: what comes before and after it, and its place in the book and in God's history of salvation. One to three short sentences.
- parts: how it is built, in order. For a chapter, its parts by verses; for a book, its parts by chapters; three to seven parts, each with a title of a few plain words. For a passage of a few verses, leave it empty.
- words: three to six words of the text that carry its weight, each with what it means here in plain words. A Hebrew or Greek word only where it truly opens the text, then with its plain meaning.
- themes: two to four things it teaches: about God, about Jesus Christ, about people, about salvation, the church or the future. A short heading each, and two or three short sentences.
- church: what the New Apostolic Church teaches about what this speaks of, as the Catechism given in the request states it, in plain words, with the section number in brackets, for example ${lang === 'af' ? '"(Kategismus 8.1)"' : '"(CNAC 8.1)"'}. Where the text of a section is not given, you may name the section that treats it (number and title), but do not say what it says. Where the Catechism does not speak to it, say so in one line. Two to five short sentences.
- views: how Christians read it, where that matters: up to three readings, for example the reading of another church or two ways the text is understood. For each, a short name, one or two plain sentences, and "nac": "agrees" when it is in line with New Apostolic teaching, "differs" when New Apostolic teaching says otherwise (then say how in "differs", in one plain sentence), or "open" when the Catechism does not decide it. Mark "differs" only where the Catechism given or the New Apostolic Creed clearly says otherwise; when unsure, mark "open". Leave "views" empty when nothing is worth comparing. Speak of other churches with respect: never mock or belittle.
- christ: how it points to Jesus Christ or what it shows of Him, in one to three short sentences. The New Apostolic Church reads all of Scripture from Christ, its centre, and weighs the Old Testament by the gospel (CNAC 1.2.5.2). Do not force a link: where it is not direct, say it simply.
- bible: four to eight other passages that shed light on it, each with one line on how it connects. Do not quote them, and do not give the passage itself again.
- catechism: one to five sections of the Catechism that belong with it, by number from the index below, each with one line on what it adds here.
- today: what it says to us today, for the congregation and for the minister himself. Two or three short sentences.
- note: anything else he should know, for example where scholars disagree on something that matters; else empty.

Rules:
- Stay faithful to the Bible and to the doctrine of the New Apostolic Church. Where the teaching of other churches differs, say so plainly and kindly, and give the New Apostolic teaching beside it.
- God is the author of Holy Scripture; its writers were people whom the Holy Spirit inspired, and each book bears the mark of its writer and his time (CNAC 1.2). On who wrote a book and when, give the tradition, and where many scholars see it differently, say so in a few words, without taking sides beyond what the Catechism says.
- The later writings of the Old Testament (the Apocrypha) are, for the New Apostolic Church, as binding for faith and doctrine as the rest of the Old Testament (CNAC 1.2.3). Many Protestant churches do not count them as Scripture; the Roman Catholic and Orthodox churches count most of them. Say this where it matters.
- Cite Catechism sections only by numbers that appear in the index below. Do not state what a section says unless its text is given in the request.
- What the app already says about the book (its own short introduction, in the request) is a starting point: go deeper, do not repeat it, and where it is wrong, say so in "note".

${studyVoice(lang)}

Put nothing outside the JSON fields.`;
}

/** The ten Articles of Faith (CNAC 2.4.1 to 2.4.10), from the Catechism text on the device; '' when it is not loaded. */
function creedPart() {
  const lines = [];
  for (let i = 1; i <= 10; i++) {
    const tx = Cat.textOf(`2.4.${i}`);
    const first = tx && (tx.blocks || []).find(b => typeof b === 'string');
    if (first) lines.push(`${i}. ${first}`);
  }
  return lines.length === 10 ? 'THE NEW APOSTOLIC CREED (the ten Articles of Faith, CNAC 2.4), to weigh the readings of other churches against\n' + lines.join('\n') : '';
}

/** The instructions, the Creed and the index as system blocks, the last marked for the prompt cache: the same for every theology request in one language on this device. */
async function insightSystemBlocks(lang) {
  await Cat.load().catch(() => null);
  await Cat.loadText().catch(() => false);
  const index = 'INDEX OF THE CATECHISM OF THE NEW APOSTOLIC CHURCH (number and title; cite only these numbers)\n'
    + Cat.allSections().filter(x => x.n !== 'Intro' && x.n !== 'Appendix').map(x => `${x.n} ${x.title}`).join('\n');
  const tail = [creedPart(), index].filter(Boolean).join('\n\n\n');
  return [
    { type: 'text', text: insightSystem(lang) },
    { type: 'text', text: tail, cache_control: { type: 'ephemeral' } },
  ];
}

/** Sections of the Catechism with their text (when it is on the device) for the request, the most relevant first: at most `max`, each cut at `cap` letters. */
function catechismSections(ns, heading, max = 10, cap = 4000) {
  const haveText = Cat.textReady();
  const shown = ns.filter(n => Cat.section(n)).slice(0, max);
  if (!shown.length) return '';
  const lines = [heading + (haveText ? ' (their text follows each)' : ' (their text is not loaded on this device: number and title only)')];
  for (const n of shown) {
    const sec = Cat.section(n);
    lines.push(`--- ${n} ${sec.title}`);
    if (!haveText) continue;
    const body = Cat.plainLines(n).map(l => (l.kind === 'li' ? '- ' : '') + l.text).join('\n');
    const sum = Cat.summaryOf(n);
    if (body) lines.push(body.length > cap ? body.slice(0, cap) + ' …' : body);
    if (sum.length) lines.push('In short: ' + sum.join(' '));
  }
  return lines.join('\n');
}

/** Catechism sections that quote a passage, a chapter or a book, the most quoted first. */
export function sectionsQuoting(level, ref) {
  if (!Cat.ready()) return [];
  if (level === 'text') {
    const out = [];
    for (let v = ref.verse; v <= (ref.verseEnd || ref.verse); v++) for (const sec of Cat.refsFor(ref.book, ref.chapter, v)) if (!out.includes(sec.n)) out.push(sec.n);
    return out;
  }
  return Cat.quoting(ref.book, level === 'chapter' ? ref.chapter : 0).map(x => x.section.n);
}

/**
 * Theological background on `ref` at one `level`: 'text' (the verses
 * ref.verse to ref.verseEnd), 'chapter' or 'book'. `passage` is the text of
 * the verses as the minister reads them ({text, translation}) when he chose
 * them in the reader; `intro` is the app's own short introduction to the
 * book, as a few lines. Resolves to the tidied answer with when, which model
 * and roughly what it cost.
 */
export async function insight(level, ref, { passage = null, intro = '', lang: l = '', signal, onProgress } = {}) {
  const lang = l === 'af' || l === 'en' ? l : (state.settings.aiLang === 'af' ? 'af' : 'en');
  const system = await insightSystemBlocks(lang);
  const label = formatRef(level === 'book' ? { book: ref.book, chapter: 1 } : level === 'chapter' ? { book: ref.book, chapter: ref.chapter } : ref, 'en');
  const bookLabel = bookName(ref.book, 'en');
  const what = level === 'book' ? `THE BOOK: ${bookLabel}` : level === 'chapter' ? `THE CHAPTER: ${label}` : `THE PASSAGE: ${label}`;
  const parts = [`THE TASK\nGive the theological background of ${level === 'book' ? `the book ${bookLabel} and its writer` : level === 'chapter' ? `the chapter ${label}` : `the passage ${label}`}, as the rules say. The answer is in ${lang === 'af' ? 'Afrikaans' : 'English'}.`];
  if (level === 'text') {
    const own = passage && passage.text ? `${what}${passage.translation ? ` (${passage.translation}, as the minister reads it)` : ''}\n${passage.text}` : '';
    let web = '';
    try {
      const ch = await Bible.getChapter('web', ref.book, ref.chapter);
      const vs = (ch && ch.verses || []).filter(v => v.n >= ref.verse && v.n <= (ref.verseEnd || ref.verse));
      if (vs.length) web = `${what} (World English Bible)\n` + vs.map(v => `${v.n} ${v.text}`).join('\n');
    } catch (e) { /* Claude knows the text */ }
    parts.push([own, web].filter(Boolean).join('\n\n') || what);
  } else {
    parts.push(what);
  }
  if (level !== 'book') {
    const chapter = await chapterPart({ ref: { book: ref.book, chapter: ref.chapter } });
    if (chapter) parts.push(chapter);
  }
  if (intro) parts.push(`WHAT THE APP ALREADY SAYS ABOUT THE BOOK (its own short introduction)\n${intro}`);
  const ns = sectionsQuoting(level, ref);
  const cat = level === 'book' ? catechismSections(ns, 'CATECHISM SECTIONS THAT QUOTE THIS BOOK MOST', 6, 3000)
    : catechismSections(ns, level === 'chapter' ? 'CATECHISM SECTIONS THAT QUOTE THIS CHAPTER' : 'CATECHISM SECTIONS THAT QUOTE THIS PASSAGE', 8, 4000);
  parts.push(cat || 'No section of the Catechism quotes this directly.');

  const r = await run({
    system,
    content: [{ type: 'text', text: parts.join('\n\n\n') }],
    schema: INSIGHT_SCHEMA, effort: 'medium', maxTokens: 16000, signal, onProgress,
  });
  return tidyInsight(r, lang);
}

function tidyInsight(r, lang) {
  const d = r.data || {};
  const list = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  const int = v => { const n = parseInt(v, 10); return n > 0 ? n : 0; };
  return {
    at: new Date().toISOString(), model: r.model, lang,
    cost: cost(r.usage, r.model),
    plain: str(d.plain), background: str(d.background), writer: str(d.writer), place: str(d.place),
    parts: list(d.parts).map(p => ({ from: int(p.from), to: Math.max(int(p.from), int(p.to)), title: str(p.title) })).filter(p => p.from && p.title),
    words: list(d.words).map(w => ({ word: str(w.word), meaning: str(w.meaning) })).filter(w => w.word && w.meaning),
    themes: list(d.themes).map(x => ({ theme: str(x.theme), text: str(x.text) })).filter(x => x.theme || x.text),
    church: str(d.church),
    views: list(d.views).map(v => ({ view: str(v.view), text: str(v.text), nac: ['agrees', 'differs', 'open'].includes(v.nac) ? v.nac : 'open', differs: str(v.differs) })).filter(v => v.view || v.text),
    christ: str(d.christ),
    bible: tidyBibleRefs(d.bible),
    catechism: tidyCatRefs(d.catechism),
    today: str(d.today), note: str(d.note),
  };
}

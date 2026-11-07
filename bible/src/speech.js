/*
 * Read aloud: the sermon spoken by an ElevenLabs voice, so the minister can
 * hear the service before holding it.
 *
 * No server: the browser calls api.elevenlabs.io with the person's own key
 * (settings.voiceKey, kept on the device like the Anthropic key: out of any
 * backup, carried to the other device only with "Carry my keys"). What is
 * read is the same text as "The sermon" in pdf.js (sermonParts): the text
 * word, the introduction, the main points, the summary, the application and
 * the conclusion, with the illustrations under the parts they serve, from the
 * boxes of the preparation or from the outline Claude built. The headings
 * are spoken in the language of the preparation, not of the app.
 *
 * A sermon goes to ElevenLabs in pieces of a few thousand letters, cut
 * between paragraphs (the API takes 5,000 to 10,000 a request, and a piece
 * that fails costs less to do again); each piece is sent with the text
 * before and after it so the voice runs on. The MP3 pieces are joined into
 * one recording, kept in the database (store `audio`, one per preparation,
 * this device only: a recording is megabytes, and sync and backups never
 * carry it) with a mark of the text it was made from, so the screen can say
 * when the sermon has changed since.
 *
 * Models: the newest ElevenLabs voice (eleven_v4, which reads Afrikaans too)
 * when the account has it, else the one before it; "Cheaper" in Settings
 * takes the turbo model at half the characters. A model the account may not
 * use is passed over for the next in the list, so a change at ElevenLabs
 * does not stop the reading.
 */
import { t } from './i18n.js';
import { AF } from './af.js';
import { state, db } from './store.js';
import * as Pdf from './pdf.js';
import { langOf } from './ai.js';

const API = 'https://api.elevenlabs.io';

/*
 * The voices to read with when the person has not chosen one under Settings:
 * Jerome's own, cloned at ElevenLabs, one for each language (he gave their
 * ids on 2026-11-07). A cloned voice belongs to the account that made it, so
 * with another person's key these two are "not found": the reading then
 * falls back to the English voice that person chose, or to George, a voice
 * every ElevenLabs account has.
 */
export const STANDARD_VOICES = {
  en: { id: 'kuuBVXdil4y3mjB6lpZp', name: 'Jerome (English)' },
  af: { id: 'dqSHftR9KTiUwAUvZKkv', name: 'Jerome (Afrikaans)' },
};
export const FALLBACK_VOICE = { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' };

const PIECE = 3000;            // letters per request: under every model's and plan's limit
const CHARS_PER_MINUTE = 900;  // what a calm reading covers in a minute, about 150 words

// the models to try, best first, for each quality; the ones that read Afrikaans are marked (ElevenLabs' model pages, November 2026)
const MODELS = {
  best: ['eleven_v4', 'eleven_multilingual_v2', 'eleven_v3', 'eleven_flash_v2_5'],
  cheaper: ['eleven_v4_turbo', 'eleven_flash_v2_5', 'eleven_v4', 'eleven_multilingual_v2', 'eleven_v3'],
};
const AFRIKAANS = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3']);
const NO_LANGUAGE_CODE = new Set(['eleven_multilingual_v2', 'eleven_multilingual_v1']);   // these refuse a language_code

export const SPEEDS = [['slower', 'Slower'], ['normal', 'Normal'], ['faster', 'Faster']];
const SPEED = { slower: 0.9, normal: 1, faster: 1.1 };
export const QUALITIES = [['best', 'Best'], ['cheaper', 'Cheaper']];

const cache = { plan: null, voices: null, models: null };   // what the key told us this session

/* ------------------------------------------------------------------ the key */

export function key() { return (state.settings.voiceKey || '').trim(); }
export function ready() { return !!key(); }

function headers(extra) {
  const k = key();
  if (!k) throw new Error(t('Add your ElevenLabs key under Settings → Read aloud first.'));
  return { 'xi-api-key': k, ...(extra || {}) };
}

/** The API's error body as one plain sentence. The status word ElevenLabs sends says more than the number. */
function apiError(status, text) {
  let code = '', msg = '';
  try {
    const d = JSON.parse(text).detail;
    if (typeof d === 'string') msg = d;
    else if (Array.isArray(d)) msg = d.map(x => x && x.msg).filter(Boolean).join(' ');
    else if (d) { code = d.status || ''; msg = d.message || ''; }
  } catch (e) { msg = ''; }
  const e = new Error('');
  e.code = code;
  e.status = status;
  if (code === 'quota_exceeded' || /quota/i.test(msg)) e.message = t('Your ElevenLabs plan has no characters left for this month. Wait for the new month, or choose a bigger plan at elevenlabs.io.');
  else if (code === 'detected_unusual_activity') e.message = t('ElevenLabs stopped free use from this connection. A paid plan at elevenlabs.io lifts that.');
  else if (code === 'voice_not_found') e.message = t('The chosen voice is no longer in your ElevenLabs account. Choose another under Settings → Read aloud.');
  else if (status === 401 || code === 'invalid_api_key') e.message = t('ElevenLabs did not accept the key. Check it under Settings → Read aloud.');
  else if (status === 403 || code === 'missing_permissions') e.message = t('This key is not allowed to do that. Make a new key at elevenlabs.io and leave its access as it is.');
  else if (status === 429 || code === 'too_many_concurrent_requests' || code === 'system_busy') e.message = t('ElevenLabs is busy or your limit is reached for now. Wait a minute and try again.');
  else e.message = msg ? `ElevenLabs: ${msg}` : t('ElevenLabs error {status}', { status });
  return e;
}

async function get(path) {
  let r;
  try { r = await fetch(API + path, { headers: headers() }); }
  catch (e) { throw new Error(t('No connection to ElevenLabs. Check your network and try again.')); }
  if (!r.ok) throw apiError(r.status, await r.text());
  return r.json();
}

/** What the plan allows and what is used: {tier, used, limit, left, reset}. */
export async function plan(fresh) {
  if (cache.plan && !fresh) return cache.plan;
  const d = await get('/v1/user/subscription');
  cache.plan = {
    tier: d.tier || '', status: d.status || '',
    used: d.character_count || 0, limit: d.character_limit || 0,
    left: Math.max(0, (d.character_limit || 0) - (d.character_count || 0)),
    reset: d.next_character_count_reset_unix ? new Date(d.next_character_count_reset_unix * 1000).toISOString() : '',
  };
  return cache.plan;
}

/** The voices of the account: the person's own first, then ElevenLabs' own, each {id, name, own, labels, preview}. */
export async function voices(fresh) {
  if (cache.voices && !fresh) return cache.voices;
  const d = await get('/v2/voices?page_size=100&include_total_count=false');
  const list = (d.voices || []).map(v => ({
    id: v.voice_id, name: v.name || v.voice_id,
    own: v.category !== 'premade',
    labels: v.labels || {},
    preview: v.preview_url || '',
  })).sort((a, b) => (a.own === b.own ? a.name.localeCompare(b.name) : a.own ? -1 : 1));
  cache.voices = list;
  return list;
}

/** The models this key may use, with the languages each reads; null when the list cannot be read. */
export async function models(fresh) {
  if (cache.models && !fresh) return cache.models;
  try {
    const d = await get('/v1/models');
    cache.models = (Array.isArray(d) ? d : []).filter(m => m.can_do_text_to_speech !== false).map(m => ({
      id: m.model_id,
      langs: new Set((m.languages || []).map(l => l.language_id)),
    }));
  } catch (e) { cache.models = null; }
  return cache.models;
}

/**
 * Does the key work? Reads the plan, and lists the voices and the models for
 * the screens. A key made with less than full access may answer one of these
 * and not another: the key still works for reading when any answers.
 */
export async function checkKey() {
  headers();
  const out = { plan: null, voices: null, partial: false };
  try { out.plan = await plan(true); } catch (e) { if (e.status === 401 && e.code !== 'missing_permissions') throw e; out.partial = true; }
  try { out.voices = await voices(true); } catch (e) { if (!out.plan) throw e; out.partial = true; }
  await models(true);
  return out;
}

/** Nothing is remembered of the old key. */
export function forgetKey() { cache.plan = null; cache.voices = null; cache.models = null; }

/* ------------------------------------------------------------------ the text */

/** The standard voice for a language, named as the account's list names it once that list is read. */
export function standardVoice(l) {
  const d = STANDARD_VOICES[l] || STANDARD_VOICES.en;
  const listed = (cache.voices || []).find(v => v.id === d.id);
  return { id: d.id, name: listed ? listed.name : t(d.name), standard: true };
}

/** The voice for a language: the one chosen under Settings, else the standard one. */
export function voiceFor(l) {
  const own = l === 'af' ? state.settings.voiceAf : state.settings.voiceEn;
  return own && own.id ? own : standardVoice(l);
}

/** The voice to read with when the standard one is not in this account: the English voice the person chose, else George. */
export function fallbackVoice(l) {
  const en = state.settings.voiceEn;
  return l === 'af' && en && en.id ? en : FALLBACK_VOICE;
}

/** A heading in the language of the preparation: an Afrikaans sermon is announced in Afrikaans whatever the app speaks. */
function word(l, k) {
  const s = l === 'af' ? AF[k] : undefined;
  return s === undefined ? (k.includes('|') ? k.slice(0, k.indexOf('|')) : k) : s;
}

const VERSE = { en: ['verse', 'to'], af: ['vers', 'tot'] };

/**
 * Text as a voice should see it: no verse numbers, footnote marks, bullets
 * or links, and "John 3:16-18" said as "John 3 verse 16 to 18".
 * `textWord` also drops the verse numbers the fetched text carries.
 */
export function clean(text, l, textWord) {
  const [verse, to] = VERSE[l] || VERSE.en;
  let v = String(text || '').normalize('NFC')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '')
    .replace(/\[\d{1,3}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[ \t]*(?:[•·▪◦*\-–—]|\d{1,2}[.)])[ \t]+/gm, '')   // bullets and numbered lists: the words alone
    .replace(/(\p{L}\.?\s)(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/gu, (m, pre, ch, from, end) => `${pre}${ch} ${verse} ${from}${end ? ` ${to} ${end}` : ''}`);
  if (textWord) v = v.replace(/^\s*\d{1,3}\s+/gm, '').replace(/\s\d{1,3}\s(?=\p{Lu})/gu, ' ');
  return v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The sermon as it will be read: {text, pieces, chars, words, minutes, lang,
 * title, key}. `key` marks the text, so a recording can say whether the
 * sermon has changed since it was made.
 */
export function script(s, { outline = null } = {}) {
  const l = langOf(s);
  const w = k => word(l, k);
  const parts = Pdf.sermonParts(s, { outline });
  const blocks = [];
  const push = (label, body) => {
    const text = (body || '').trim();
    if (!text) return;
    blocks.push((label ? label.replace(/[\s.:]+$/, '') + '.\n' : '') + text);
  };
  const extras = list => (list || []).map(x => {
    if (x.kind === 'illustration') return w('Illustration: ').trim().replace(/:$/, '') + (x.title ? ': ' + x.title : '') + '.\n' + x.body;
    if (x.kind === 'lighter') return w('A lighter moment') + '.\n' + x.body;
    return x.body;
  }).filter(Boolean).join('\n\n');
  const withExtras = (body, list) => [body, extras(list)].filter(Boolean).join('\n\n');

  if (parts.ref) push('', clean(parts.ref, l) + (s.translation ? `, ${s.translation}` : '') + '.');
  if ((s.text || '').trim()) push('', clean(s.text, l, true));
  if ((s.title || s.theme || '').trim()) push('', (s.title || s.theme).trim());
  const c = parts.c;
  if (c.intro) push(w('Introduction'), withExtras(c.intro, c.after.intro));
  for (const p of c.points) push(w('Main point {n}').replace('{n}', p.n) + (p.heading ? ': ' + p.heading : ''), withExtras(p.body, p.extras));
  if (c.after.loose.length) push(w('Illustrations'), extras(c.after.loose));
  if (c.summary) push(w('Summary'), c.summary);
  if (c.application) push(w('Application for the congregation'), withExtras(c.application, c.after.application));
  if (c.conclusion) push(w('Conclusion'), withExtras(c.conclusion, c.after.conclusion));

  return scripted(parts.empty ? '' : clean(blocks.join('\n\n'), l), l, parts.title);
}

/**
 * The Guide's article as it will be read, in the same shape as script(): the
 * date and the service, the Bible text, the title, the message, the
 * introduction, the parts under their own headings, the Context box, the
 * Summary and the reading, with the headings in the Guide's language.
 */
export function guideScript(service, guide) {
  const l = guide && guide.language === 'af' ? 'af' : 'en';
  const w = k => word(l, k);
  const blocks = [];
  const push = (label, body) => {
    const text = String(body || '').trim();
    if (!text) return;
    blocks.push((label ? label.replace(/[\s.:]+$/, '') + '.\n' : '') + text);
  };
  const when = [service.dateText || spokenDate(service.date, l), service.label].filter(Boolean).join(', ');
  if (when) push('', when + '.');
  if (service.reference) push('', service.reference + '.');
  if (service.bibleText) push('', service.bibleText);
  if (service.title) push('', service.title);
  if (service.message) push(w('Message '), service.message);
  if (service.introduction) push(w('Introduction'), service.introduction);
  for (const sec of service.sections || []) push(sec.heading || '', sec.body);
  if (service.context) push(w('Context|box'), service.context);
  if ((service.summary || []).length) push(w('Summary'), service.summary.join('\n\n'));
  if (service.reading) push('', w('Reading: {reading}.').replace('{reading}', service.reading));
  const text = clean(blocks.join('\n\n'), l).replace(/\s*\((?:CNAC|KNAK)\s*[\d.]+(?:\s*[,;]\s*[\d.]+)*\)/g, '');   // "(CNAC 9.6.3)" is for the eye, not the ear
  return scripted(text, l, service.title || service.reference || (guide && guide.title) || '');
}

/** A date as the Guide's language says it, for an article whose printed date was not read. */
function spokenDate(iso, l) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString(l === 'af' ? 'af-ZA' : 'en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** The script object every reading starts from. */
function scripted(text, l, title) {
  const chars = text.length;
  return {
    text, lang: l, title, chars,
    words: text ? text.split(/\s+/).length : 0,
    minutes: Math.max(1, Math.round(chars / CHARS_PER_MINUTE)),
    pieces: pieces(text),
    key: textKey(text),
  };
}

/** A short mark of a text: the same text gives the same mark. */
export function textKey(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + '-' + text.length;
}

/** The text in pieces of at most `max` letters, cut between paragraphs, or between sentences when a paragraph is longer. */
export function pieces(text, max = PIECE) {
  const out = [];
  let cur = '';
  for (const para of String(text || '').split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    for (const u of p.length > max ? sentences(p, max) : [p]) {
      if (cur && cur.length + 2 + u.length > max) { out.push(cur); cur = u; }
      else cur = cur ? `${cur}\n\n${u}` : u;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function sentences(p, max) {
  const out = [];
  let cur = '';
  for (let s of p.split(/(?<=[.!?…])\s+/)) {
    while (s.length > max) {   // one sentence longer than a piece: cut at a space
      const cut = s.lastIndexOf(' ', max) > 0 ? s.lastIndexOf(' ', max) : max;
      if (cur) { out.push(cur); cur = ''; }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (cur && cur.length + 1 + s.length > max) { out.push(cur); cur = s; }
    else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ the voice */

/** The models to try for a language and a quality, best first, kept to the ones the key may use when that is known. */
export function modelsFor(l, quality, known) {
  let list = MODELS[quality === 'cheaper' ? 'cheaper' : 'best'];
  if (l === 'af') list = list.filter(m => AFRIKAANS.has(m) || (known && known.some(k => k.id === m && k.langs.has('af'))));
  if (known && known.length) {
    const have = list.filter(m => known.some(k => k.id === m && (l !== 'af' || k.langs.has('af') || AFRIKAANS.has(m))));
    if (have.length) list = have;
  }
  return list.length ? list : [l === 'af' ? 'eleven_v3' : 'eleven_multilingual_v2'];
}

function modelProblem(e) {
  return [400, 403, 404, 422].includes(e.status) && /model/i.test((e.code || '') + ' ' + (e.message || ''));
}

/**
 * Reads the sermon, from the boxes or from the outline. Resolves to the
 * recording: {blob, chars, voice, model, lang, at, key, source, title,
 * minutes}. onProgress(i, n) says which piece is on its way; `signal` stops it.
 */
export async function make(s, { outline = null, signal, onProgress } = {}) {
  headers();   // no key stops here, before anything is built
  const sc = script(s, { outline });
  if (!sc.text) throw new Error(t('There is nothing to read yet: write the introduction, the main points, the application or the conclusion first.'));
  return speak(sc, { signal, onProgress, source: outline ? 'outline' : 'boxes' });
}

/** Reads the Guide's article for one service, in the Guide's language. */
export async function makeGuide(service, guide, { signal, onProgress } = {}) {
  headers();
  const sc = guideScript(service, guide);
  if (!sc.text) throw new Error(t('There is nothing to read in this article.'));
  return speak(sc, { signal, onProgress, source: 'guide' });
}

/** Every piece of a script to ElevenLabs in turn, the answers joined into one MP3. */
async function speak(sc, { signal, onProgress, source }) {
  let voice = voiceFor(sc.lang);
  const known = await models().catch(() => null);
  const candidates = modelsFor(sc.lang, state.settings.voiceQuality, known);
  const speed = SPEED[state.settings.voiceSpeed] || 1;
  const list = sc.pieces;
  const parts = [];
  let model = candidates[0];
  let settings = speed !== 1 ? { speed } : null;
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress(i + 1, list.length);
    for (;;) {
      if (signal && signal.aborted) throw stopped();
      const body = { text: list[i], model_id: model };
      if (!NO_LANGUAGE_CODE.has(model)) body.language_code = sc.lang;
      if (settings) body.voice_settings = settings;
      if (i > 0) body.previous_text = list[i - 1].slice(-600);
      if (i < list.length - 1) body.next_text = list[i + 1].slice(0, 600);
      let r;
      try {
        r = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`, {
          method: 'POST', headers: headers({ 'content-type': 'application/json', accept: 'audio/mpeg' }), body: JSON.stringify(body), signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw stopped();
        throw new Error(t('No connection to ElevenLabs. Check your network and try again.'));
      }
      if (r.ok) { parts.push(await r.arrayBuffer()); break; }
      const err = apiError(r.status, await r.text());
      const next = candidates[candidates.indexOf(model) + 1];
      if (err.code === 'voice_not_found' && voice.standard) { voice = fallbackVoice(sc.lang); continue; }   // the standard voice is another account's: one this account has
      if (modelProblem(err) && next) { model = next; continue; }                       // this account has no such model: the next one
      if (settings && err.status === 422 && /speed|voice_settings/i.test(err.message)) { settings = null; continue; }   // the model takes no speed: read at the usual pace
      throw err;
    }
  }
  cache.plan = null;   // the characters used show on the next look
  return {
    blob: new Blob(parts, { type: 'audio/mpeg' }),
    chars: sc.chars, words: sc.words, minutes: sc.minutes,
    voice: { id: voice.id, name: voice.name }, model, lang: sc.lang,
    at: new Date().toISOString(), key: sc.key, source, title: sc.title,
  };
}

function stopped() { return new Error(t('Reading stopped.')); }

/* ------------------------------------------------------------------ the recording kept on the device */

/* The key of a recording in the audio store: a preparation's id for its sermon, this for the Guide's article of service i (store.js deleteGuide removes them with the Guide). */
export const guideKey = (guide, i) => `guide:${guide.id}:${i}`;

export async function recording(id) { return (await db.get('audio', id)) || null; }

export async function keep(id, rec) { await db.put('audio', { ...rec, id }); }

export async function forget(id) { await db.del('audio', id); }

/** The name of the saved MP3: the date and the text word or title, like the PDFs. */
export function fileName(date, title) {
  const r = String(title || '').replace(/[^\w]+/g, '-');
  return `${date || 'undated'}-${r || 'sermon'}-read.mp3`.replace(/-+/g, '-');
}

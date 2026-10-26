/*
 * Where the Scripture text comes from.
 *
 * Two translations travel with the app as JSON files in data/: the King James
 * Version with the Apocrypha and the World English Bible with the
 * Deuterocanon. Both are public domain, so they can be bundled and read
 * offline.
 *
 * The NKJV and the Afrikaans Bibles are copyrighted and cannot be shipped.
 * They are read live, with the person's own keys, from two licensed services:
 * API.Bible and the YouVersion Platform. The keys are kept in Settings on the
 * device and never in this repository. Fetched chapters are cached (30 days
 * for API.Bible, the limit its terms allow; 7 days for YouVersion) so a
 * chapter read on Sunday morning is still there in the pulpit.
 */
import { state, cacheGet, cachePut } from './store.js';

const API = 'https://api.scripture.api.bible/v1';
const YV = 'https://api.youversion.com/v1';

export const BUILT_IN = {
  kjv: { id: 'kjv', short: 'KJV', name: 'King James Version with Apocrypha', lang: 'en', builtin: true },
  web: { id: 'web', short: 'WEB', name: 'World English Bible with Deuterocanon', lang: 'en', builtin: true },
};

/* Where to read the licensed Bibles when there is no key: YouVersion, BibleSA
   (the Bible Society of South Africa's own site) and BibleGateway deep links,
   opened in the browser. */
export const EXTERNAL = [
  { id: 'nkjv', label: 'NKJV', name: 'New King James Version', you: { v: 114, abbr: 'NKJV' }, gateway: 'NKJV' },
  { id: 'afr83', label: 'AFR83', name: 'Afrikaans 1983-vertaling', you: { v: 6, abbr: 'AFR83' }, sa: 'AFR83' },
  { id: 'afr20', label: 'AFR20', name: 'Die Bybel 2020-vertaling', you: { v: 3499, abbr: 'AFR20' }, sa: 'AFR20' },
  { id: 'afr53', label: 'AFR53', name: 'Afrikaans 1933/1953-vertaling', you: { v: 5, abbr: 'AFR53' }, sa: 'AFR53' },
];

const memory = new Map();   // url -> parsed JSON, so a chapter is fetched once per visit

async function fetchJson(url) {
  if (memory.has(url)) return memory.get(url);
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
    return r.json();
  });
  memory.set(url, p);
  try { return await p; } catch (e) { memory.delete(url); throw e; }
}

/** The body as JSON. An empty body (204 No Content, some 404s) gives null instead of a parse error. */
async function readJson(r) {
  const text = await r.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch (e) { throw new Error('The service sent an answer the app could not read.'); }
}

/** Every source the person can read from: the bundled two plus the API Bibles they ticked. */
export function sources() {
  const list = Object.values(BUILT_IN);
  for (const b of state.settings.apiBibles || []) {
    list.push({ id: 'api:' + b.id, short: b.abbreviation || b.name, name: b.name, lang: b.language || '', builtin: false, apiId: b.id, provider: 'api' });
  }
  for (const b of state.settings.yvBibles || []) {
    list.push({ id: 'yv:' + b.id, short: b.abbreviation || b.name, name: b.name, lang: b.language || '', builtin: false, yvId: b.id, provider: 'yv' });
  }
  return list;
}

export function source(id) {
  return sources().find(s => s.id === id) || null;
}

/** Chapter counts per book for navigation (the bundled index; the canon is the same for the API Bibles). */
export async function bookIndex(sourceId) {
  const key = source(sourceId)?.builtin ? sourceId : 'kjv';
  const idx = await fetchJson(`data/${key}/index.json`);
  return idx.books;
}

export async function copyrightOf(sourceId) {
  const s = source(sourceId);
  if (!s) return '';
  if (s.builtin) return (await fetchJson(`data/${s.id}/index.json`)).copyright;
  if (s.provider === 'yv') return `${s.name}. Scripture text from the YouVersion Platform, © its publisher.`;
  return `${s.name}. Scripture text provided by API.Bible.`;
}

/**
 * One chapter: {verses: [{n, text}], title, copyright, fums, missing}.
 * `missing` is set when the Bible does not contain the book (an Apocrypha
 * book in a Protestant Bible, for instance) instead of throwing.
 */
export async function getChapter(sourceId, book, chapter) {
  const s = source(sourceId);
  if (!s) throw new Error('Unknown translation');
  if (s.builtin) {
    let data;
    try { data = await fetchJson(`data/${s.id}/${book}.json`); } catch (e) { return { verses: [], missing: true }; }
    const verses = (data.chapters[chapter - 1] || []).map((text, i) => ({ n: i + 1, text }));
    if (!verses.length) return { verses: [], missing: true };
    return { verses, title: data.titles ? data.titles[String(chapter)] : undefined };
  }
  if (s.provider === 'yv') return yvChapter(s.yvId, book, chapter);
  return apiChapter(s.apiId, book, chapter);
}

/* ---------------------------------------------------------------- API.Bible */

function apiHeaders() {
  const key = (state.settings.apiKey || '').trim();
  if (!key) throw new Error('Add your API.Bible key in Settings to read this translation.');
  return { 'api-key': key, 'Accept': 'application/json' };
}

async function apiGet(path) {
  let r;
  try {
    r = await fetch(API + path, { headers: apiHeaders() });
  } catch (e) {
    throw new Error('No connection to API.Bible. Check your network, or read the bundled KJV.');
  }
  if (r.status === 401 || r.status === 403) throw new Error('API.Bible did not accept the key. Check it in Settings.');
  if (r.status === 204 || r.status === 404) return null;
  if (r.status === 429) throw new Error('API.Bible limit reached for this month. Cached chapters still work.');
  if (!r.ok) throw new Error(`API.Bible error ${r.status}`);
  return readJson(r);
}

/** The Bibles this key may read: [{id, abbreviation, name, language}]. */
export async function listBibles() {
  const res = await apiGet('/bibles');
  if (!res) return [];
  return res.data.map(b => ({
    id: b.id,
    abbreviation: b.abbreviationLocal || b.abbreviation,
    name: b.nameLocal || b.name,
    language: b.language ? (b.language.nameLocal || b.language.name) : '',
    description: b.descriptionLocal || b.description || '',
  })).sort((a, b) => (a.language + a.name).localeCompare(b.language + b.name));
}

/** Split "[1] In the beginning ... [2] And the earth" into verses. */
function parseApiText(content) {
  const verses = [];
  const re = /\[(\d+)\]\s*/g;
  let m, last = null, lastIndex = 0;
  while ((m = re.exec(content))) {
    if (last !== null) verses.push({ n: last, text: content.slice(lastIndex, m.index).replace(/\s+/g, ' ').trim() });
    last = parseInt(m[1], 10);
    lastIndex = re.lastIndex;
  }
  if (last !== null) verses.push({ n: last, text: content.slice(lastIndex).replace(/\s+/g, ' ').trim() });
  else if (content.trim()) verses.push({ n: 1, text: content.trim() });
  return verses;
}

async function apiChapter(bibleId, book, chapter) {
  const cacheKey = `api:${bibleId}:${book}.${chapter}`;
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;
  const q = 'content-type=text&include-verse-numbers=true&include-titles=false&include-notes=false' +
    '&include-chapter-numbers=false&include-verse-spans=false';
  const res = await apiGet(`/bibles/${bibleId}/chapters/${book}.${chapter}?${q}`);
  if (!res) return { verses: [], missing: true };
  const out = {
    verses: parseApiText(res.data.content || ''),
    copyright: res.data.copyright || '',
    reference: res.data.reference,
    fums: res.meta && res.meta.fumsNoScript ? res.meta.fumsNoScript : '',
  };
  cachePut(cacheKey, out).catch(() => {});
  return out;
}

/* ---------------------------------------------------------------- YouVersion Platform */

function yvHeaders() {
  const key = (state.settings.yvKey || '').trim();
  if (!key) throw new Error('Add your YouVersion app key in Settings to read this translation.');
  return { 'X-YVP-App-Key': key, 'Accept': 'application/json' };
}

async function yvGet(path) {
  let r;
  try {
    r = await fetch(YV + path, { headers: yvHeaders() });
  } catch (e) {
    throw new Error('No connection to YouVersion. Check your network, or read the bundled KJV.');
  }
  // 204 means nothing matches (a language with no Bibles for this key); it is not an error.
  if (r.status === 204 || r.status === 404) return null;
  if (r.status === 401) throw new Error('YouVersion did not accept the app key. Check it in Settings.');
  if (r.status === 403) throw new Error('This Bible is not licensed to your YouVersion app yet. Request it for your app at platform.youversion.com, then try again.');
  if (r.status === 412) throw new Error('YouVersion says this app was archived or removed. Create a new app at platform.youversion.com and paste its key in Settings.');
  if (r.status === 429) throw new Error('YouVersion limit reached for now. Cached chapters still work.');
  if (!r.ok) {
    const body = await readJson(r).catch(() => null);
    throw new Error(`YouVersion error ${r.status}` + (body && body.message ? `: ${body.message}` : ''));
  }
  return readJson(r);
}

/**
 * The Bibles the app key may read, one language at a time (the Platform only
 * answers for the first language that has Bibles): [{id, abbreviation, name, language}].
 * With allAvailable, everything YouVersion carries in that language, licensed or not.
 */
let yvFields = '&fields[]=id&fields[]=abbreviation&fields[]=localized_abbreviation&fields[]=title&fields[]=localized_title&fields[]=language_tag';

export async function yvListBibles(languages, { allAvailable = false } = {}) {
  const out = new Map();
  for (const lang of languages) {
    let token = '';
    for (let page = 0; page < 100; page++) {   // the whole catalogue is a few thousand Bibles at most
      const q = `language_ranges[]=${encodeURIComponent(lang)}&page_size=99` + (allAvailable ? '&all_available=true' : '') + (token ? `&page_token=${encodeURIComponent(token)}` : '');
      let res;
      try {
        res = await yvGet(`/bibles?${q}${yvFields}`);
      } catch (e) {
        // the slim field list was refused: ask for whole Bible records instead
        if (!yvFields || !/error 4(00|22)/.test(e.message)) throw e;
        yvFields = '';
        res = await yvGet(`/bibles?${q}`);
      }
      if (!res) break;   // 204: no Bibles in this language for this key
      for (const b of res.data || []) {
        out.set(b.id, { id: b.id, abbreviation: b.abbreviation || b.localized_abbreviation || String(b.id), name: b.localized_title || b.title || b.abbreviation, language: b.language_tag || lang });
      }
      token = res.next_page_token || '';
      if (!token) break;
    }
  }
  return [...out.values()].sort((a, b) => (a.language + a.name).localeCompare(b.language + b.name));
}

/**
 * Everything YouVersion carries in those languages, each marked `licensed`:
 * whether this app key may read its text. Only the passage endpoint checks the
 * licence, so the licensed list is compared with the whole catalogue here.
 */
export async function yvCatalogue(languages) {
  const licensed = await yvListBibles(languages);
  const ids = new Set(licensed.map(b => String(b.id)));
  let all = [];
  try { all = await yvListBibles(languages, { allAvailable: true }); } catch (e) { all = []; }
  const out = new Map(all.map(b => [String(b.id), { ...b, licensed: ids.has(String(b.id)) }]));
  for (const b of licensed) if (!out.has(String(b.id))) out.set(String(b.id), { ...b, licensed: true });
  return [...out.values()].sort((a, b) => (b.licensed - a.licensed) || (a.language + a.name).localeCompare(b.language + b.name));
}

/** The licence YouVersion applies to a Bible: {id, name, uri} or null. */
export async function yvLicence(bibleId) {
  const res = await yvGet(`/licenses?bible_id=${encodeURIComponent(bibleId)}`);
  const lic = res && Array.isArray(res.data) ? res.data[0] : null;
  return lic ? { id: lic.id, name: lic.name || `Licence ${lic.id}`, uri: lic.uri || '' } : null;
}

/**
 * Split the Platform's chapter HTML into verses. YouVersion marks each verse
 * with class "verse vN" (a verse split over paragraphs appears more than once)
 * and its number in a "label" span; headings and notes are dropped.
 */
export function parseYvHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const byN = new Map();
  for (const node of doc.querySelectorAll('.verse')) {
    const cls = node.getAttribute('class') || '';
    const m = cls.match(/\bv(\d+)\b/);
    const usfm = node.getAttribute('data-usfm') || '';
    const n = m ? parseInt(m[1], 10) : parseInt((usfm.split('.')[2] || ''), 10);
    if (!n) continue;
    const copy = node.cloneNode(true);
    for (const x of copy.querySelectorAll('.label, .note, .heading, .footnote, sup')) x.remove();
    const text = copy.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    byN.set(n, byN.has(n) ? byN.get(n) + ' ' + text : text);
  }
  return [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([n, text]) => ({ n, text }));
}

async function yvChapter(bibleId, book, chapter) {
  const cacheKey = `yv:${bibleId}:${book}.${chapter}`;
  const hit = await cacheGet(cacheKey, 7);
  if (hit) return hit;
  const res = await yvGet(`/bibles/${bibleId}/passages/${book}.${chapter}?format=html&include_headings=false&include_notes=false`);
  if (!res) return { verses: [], missing: true };
  let verses = parseYvHtml(res.content || '');
  if (!verses.length) {
    // no verse markup: show the chapter as one block rather than nothing
    const plain = new DOMParser().parseFromString(res.content || '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
    if (!plain) return { verses: [], missing: true };
    verses = [{ n: 1, text: plain }];
  }
  const out = { verses, copyright: '', reference: res.reference, fums: '' };
  cachePut(cacheKey, out).catch(() => {});
  return out;
}

/* ---------------------------------------------------------------- links out */

/** https://www.bible.com/bible/114/JHN.3.16.NKJV */
export function youVersionUrl(ext, book, chapter, verse) {
  const v = verse ? `.${verse}` : '';
  return `https://www.bible.com/bible/${ext.you.v}/${book}.${chapter}${v}.${ext.you.abbr}`;
}

/** https://www.biblesa.co.za/bible/AFR83/PSA.23 */
export function bibleSaUrl(ext, book, chapter) {
  return `https://www.biblesa.co.za/bible/${ext.sa}/${book}.${chapter}`;
}

export function bibleGatewayUrl(refText, version) {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(refText)}&version=${version || 'NKJV'}`;
}

/** The text of a few verses as one string, for a sermon or the clipboard. */
export function joinVerses(verses, from, to) {
  return verses
    .filter(v => v.n >= from && v.n <= (to || from))
    .map(v => `${v.n} ${v.text}`)
    .join(' ');
}

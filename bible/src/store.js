import { t } from './i18n.js';
/*
 * Storage. Everything a person writes lives in IndexedDB on the device:
 * notes, service preparations, settings, and a cache of chapters fetched
 * from API.Bible. On start the small stores are loaded into memory, and
 * every change is written through, so the rest of the app can treat the
 * arrays as the truth. Export/Import moves the lot between devices by file;
 * sync.js keeps the person's devices the same over the app's own server.
 *
 * For sync, every write here does two more things: it tells the listeners
 * (onChange) which part of the data changed, so the change is sent on, and a
 * deletion leaves a small marker (the id and the time, in state.deleted) so
 * the other device deletes the same thing instead of bringing it back.
 * Rows that arrive from another device are written with applyRemote(),
 * which tells nobody, so they are not sent back again.
 */
const DB_NAME = 'nac-study-bible';
const DB_VERSION = 5;
const STORES = ['notes', 'sermons', 'settings', 'cache', 'texts', 'catechism', 'guides', 'sync'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sermons')) db.createObjectStore('sermons', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('catechism')) db.createObjectStore('catechism', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('guides')) db.createObjectStore('guides', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  all: store => tx(store, 'readonly', s => s.getAll()),
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  keys: store => tx(store, 'readonly', s => s.getAllKeys()),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: store => tx(store, 'readwrite', s => s.clear()),
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const DEFAULT_SETTINGS = {
  translation: 'kjv',
  compare: '',
  beside: '',             // BibleSA version shown next to the text ('AFR83'), or ''
  bookLang: 'en',
  uiLang: 'en',           // language of the interface: 'en' or 'af' (i18n.js); the switch also sets bookLang and aiLang
  fontSize: 'm',
  theme: 'system',        // 'system' follows the device; 'paper', 'white' or 'dark' are fixed
  apiKey: '',
  apiBibles: [],          // [{id, abbreviation, name, language}] chosen from the key's catalogue
  yvKey: '',              // YouVersion Platform app key, same rules as apiKey
  yvBibles: [],           // [{id, abbreviation, name, language}] chosen from that catalogue
  myTexts: [],            // versions the person pastes in chapter by chapter ('afr83'), shown as "(pasted)"
  aiKey: '',              // Anthropic key for the AI helper, same rules as apiKey
  aiModel: 'claude-opus-5-5',
  aiLang: 'en',           // language of the suggestions: 'en' or 'af'; a preparation can choose its own
  aiHumour: 'some',       // how much humour the suggested sermon may carry: 'none', 'some' or 'more' (see HUMOUR in ai.js)
  aiStyle: '',            // the person's own note on how they preach, sent with every request for suggestions
  readMode: 'book',       // 'book' (Literata, normal spacing) or 'easy' (plain letters, wider spacing: easier with dyslexia)
  name: '',
  congregation: '',
  lastRef: 'PSA.23',
};

/** The keys never leave the device in a backup file. Sync carries them only when the person ticks "Carry my keys" (locked with the code). */
export const SECRET = new Set(['apiKey', 'yvKey', 'aiKey']);

/** Settings that belong to this screen rather than to the person: a phone and a PC may well differ. Sync leaves them alone. */
export const DEVICE_ONLY = new Set(['theme', 'fontSize']);

/** Settings that may change often and matter little: sent on with the next sync rather than at once. */
const LAZY = new Set(['lastRef']);

/** In-memory state, filled by load(). */
export const state = {
  notes: [],
  sermons: [],
  settings: { ...DEFAULT_SETTINGS },
  settingsAt: {},         // key -> when it was last set (ISO), so two devices can tell whose setting is newer
  texts: {},              // version -> Set of 'BOOK.chapter' pasted in (the text itself stays in the database)
  catechism: null,        // {edition, sections, builtAt, loadedAt} when the Catechism text is loaded on this device
  guides: [],             // Divine Service Guides read by the AI helper, each with its services (device only, see guides.js)
  deleted: { notes: {}, sermons: {}, texts: {}, guides: {}, catechism: '' },   // id -> when it was deleted here (ISO), kept so sync can pass the deletion on
};

/* ---- who wants to know about a change (sync.js) ---- */
const listeners = new Set();

/** fn(part, {lazy}) is called after every write the person makes; part is 'notes', 'sermons', 'settings', 'texts', 'catechism' or 'guides'. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(part, opts) {
  for (const fn of listeners) {
    try { fn(part, opts || {}); } catch (e) { console.error(e); }
  }
}

/** The deletion markers, as a row of the sync store. Markers older than half a year are dropped: every device has long seen them. */
const KEEP_DELETED_DAYS = 183;

async function markDeleted(part, id) {
  state.deleted[part][id] = new Date().toISOString();
  await saveDeleted();
}

async function saveDeleted() {
  await db.put('sync', { key: 'deleted', value: state.deleted });
}

function pruneDeleted(deleted) {
  const d = { notes: {}, sermons: {}, texts: {}, guides: {}, catechism: '', ...(deleted || {}) };
  const cutoff = new Date(Date.now() - KEEP_DELETED_DAYS * 86400000).toISOString();
  for (const part of ['notes', 'sermons', 'texts', 'guides']) {
    const m = d[part] && typeof d[part] === 'object' ? d[part] : {};
    d[part] = Object.fromEntries(Object.entries(m).filter(([, at]) => typeof at === 'string' && at > cutoff));
  }
  if (typeof d.catechism !== 'string' || d.catechism <= cutoff) d.catechism = '';
  return d;
}

export async function load() {
  const [notes, sermons, settings, textKeys, catMeta, guides, deleted] = await Promise.all([db.all('notes'), db.all('sermons'), db.all('settings'), db.keys('texts'), db.get('catechism', 'meta'), db.all('guides'), db.get('sync', 'deleted')]);
  state.catechism = catMeta ? catMeta.value : null;
  state.guides = guides;
  state.deleted = pruneDeleted(deleted && deleted.value);
  state.texts = {};
  for (const k of textKeys) {
    const [version, ref] = String(k).split(':');
    if (!state.texts[version]) state.texts[version] = new Set();
    state.texts[version].add(ref);
  }
  state.notes = notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  state.sermons = sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  state.settings = { ...DEFAULT_SETTINGS };
  state.settingsAt = {};
  for (const row of settings) { state.settings[row.key] = row.value; state.settingsAt[row.key] = row.at || ''; }
  return state;
}

export async function saveSetting(key, value) {
  const at = new Date().toISOString();
  state.settings[key] = value;
  state.settingsAt[key] = at;
  await db.put('settings', { key, value, at });
  if (!DEVICE_ONLY.has(key)) changed('settings', { lazy: LAZY.has(key) });
}

export async function saveNote(note) {
  note.updated = new Date().toISOString();
  if (!note.created) note.created = note.updated;
  if (!note.id) note.id = uid();
  const i = state.notes.findIndex(n => n.id === note.id);
  if (i >= 0) state.notes[i] = note; else state.notes.unshift(note);
  await db.put('notes', note);
  changed('notes');
  return note;
}

export async function deleteNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  await db.del('notes', id);
  await markDeleted('notes', id);
  changed('notes');
}

export async function saveSermon(sermon) {
  sermon.updated = new Date().toISOString();
  if (!sermon.created) sermon.created = sermon.updated;
  if (!sermon.id) sermon.id = uid();
  const i = state.sermons.findIndex(s => s.id === sermon.id);
  if (i >= 0) state.sermons[i] = sermon; else state.sermons.unshift(sermon);
  state.sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  await db.put('sermons', sermon);
  changed('sermons');
  return sermon;
}

export async function deleteSermon(id) {
  state.sermons = state.sermons.filter(s => s.id !== id);
  await db.del('sermons', id);
  await markDeleted('sermons', id);
  changed('sermons');
}

/* ---- chapter cache for texts fetched from API.Bible (kept 30 days, as its terms ask) ---- */
const CACHE_DAYS = 30;

export async function cacheGet(key, days) {
  const row = await db.get('cache', key);
  if (!row) return null;
  if (Date.now() - row.at > (days || CACHE_DAYS) * 86400000) return null;
  return row.data;
}

export function cachePut(key, data) {
  return db.put('cache', { key, data, at: Date.now() });
}

export async function clearCache() {
  await db.clear('cache');
}

/* ---- text the person pasted in, chapter by chapter ----
   It is theirs to use on this device only, so it lives in its own store, is
   not part of the normal backup, and moves between devices with its own file. */
export function textKey(version, book, chapter) { return `${version}:${book}.${chapter}`; }

export function hasText(version, book, chapter) {
  return !!(state.texts[version] && state.texts[version].has(`${book}.${chapter}`));
}

export function textCount(version) {
  return state.texts[version] ? state.texts[version].size : 0;
}

export async function getText(version, book, chapter) {
  return hasText(version, book, chapter) ? db.get('texts', textKey(version, book, chapter)) : null;
}

export async function saveText(version, book, chapter, verses, title) {
  const row = { key: textKey(version, book, chapter), version, book, chapter, verses, title: title || '', at: new Date().toISOString() };
  await db.put('texts', row);
  indexText(row);
  changed('texts');
  return row;
}

/** Puts a pasted chapter into the in-memory index (the text itself stays in the database). */
function indexText(row) {
  if (!state.texts[row.version]) state.texts[row.version] = new Set();
  state.texts[row.version].add(`${row.book}.${row.chapter}`);
}

function unindexText(key) {
  const [version, ref] = String(key).split(':');
  if (state.texts[version]) state.texts[version].delete(ref);
}

export async function deleteText(version, book, chapter) {
  const key = textKey(version, book, chapter);
  await db.del('texts', key);
  unindexText(key);
  await markDeleted('texts', key);
  changed('texts');
}

export async function exportTexts() {
  return { app: 'nac-study-bible-texts', version: 1, exportedAt: new Date().toISOString(), texts: await db.all('texts') };
}

/** Loads a pasted-text file: newer chapters win, nothing is deleted. Returns the number of chapters taken. */
export async function importTexts(data) {
  if (!data || data.app !== 'nac-study-bible-texts' || !Array.isArray(data.texts)) throw new Error(t('Not a pasted-text file from this app'));
  let n = 0;
  for (const t of data.texts) {
    if (!t || !t.version || !t.book || !t.chapter || !Array.isArray(t.verses)) continue;
    const mine = await getText(t.version, t.book, t.chapter);
    if (mine && (mine.at || '') >= (t.at || '')) continue;
    // the chapter keeps the time it was pasted, so the newest copy wins on every device
    const row = { key: textKey(t.version, t.book, t.chapter), version: t.version, book: t.book, chapter: t.chapter, verses: t.verses, title: t.title || '', at: t.at || new Date().toISOString() };
    await db.put('texts', row);
    indexText(row);
    n++;
  }
  if (n) changed('texts');
  return n;
}

export async function wipeTexts() {
  const keys = await db.keys('texts');
  await db.clear('texts');
  state.texts = {};
  const at = new Date().toISOString();
  for (const k of keys) state.deleted.texts[k] = at;
  await saveDeleted();
  changed('texts');
}

/* ---- the text of the Catechism, loaded from the file the build script makes ----
   The Church's text is for the person's own study, so it lives on the device
   only: its own store, not in the backup. 'meta' is read at start (is it
   there, which edition); 'text' holds the sections and is read when needed. */
export async function saveCatechismText(data) {
  if (!data || data.app !== 'nac-study-bible-catechism' || !Array.isArray(data.sections) || !data.sections.length) throw new Error(t('Not a Catechism text file from this app'));
  const sections = data.sections.filter(x => x && x.n && Array.isArray(x.blocks));
  if (!sections.length) throw new Error(t('The file holds no Catechism sections'));
  const meta = { edition: data.edition || 'Catechism of the New Apostolic Church', copyright: data.copyright || '', builtAt: data.builtAt || '', sections: sections.length, loadedAt: new Date().toISOString() };
  await db.put('catechism', { key: 'text', value: sections });
  await db.put('catechism', { key: 'meta', value: meta });
  state.catechism = meta;
  state.deleted.catechism = '';
  await saveDeleted();
  changed('catechism');
  return meta;
}

export async function getCatechismText() {
  const row = await db.get('catechism', 'text');
  return row ? row.value : null;
}

export async function deleteCatechismText() {
  await db.clear('catechism');
  state.catechism = null;
  state.deleted.catechism = new Date().toISOString();
  await saveDeleted();
  changed('catechism');
}

/* ---- the Divine Service Guides the AI helper has read ----
   The Church's text again, so: on this device only, not in the backup. */
export async function saveGuide(guide) {
  if (!guide.id) guide.id = uid();
  if (!guide.loadedAt) guide.loadedAt = new Date().toISOString();
  const i = state.guides.findIndex(g => g.id === guide.id);
  if (i >= 0) state.guides[i] = guide; else state.guides.push(guide);
  await db.put('guides', guide);
  changed('guides');
  return guide;
}

export async function deleteGuide(id) {
  state.guides = state.guides.filter(g => g.id !== id);
  await db.del('guides', id);
  await markDeleted('guides', id);
  changed('guides');
}

/* ---- backup (pasted text and the Catechism text are not in it: see exportTexts) ---- */
export async function exportAll() {
  return {
    app: 'nac-study-bible',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
    sermons: state.sermons,
    settings: Object.fromEntries(Object.entries(state.settings).filter(([k]) => !SECRET.has(k))),
  };
}

/** Merge a backup in: newer copies win, nothing is deleted. Returns counts. */
export async function importAll(data) {
  if (!data || data.app !== 'nac-study-bible') throw new Error(t('Not a Study Bible backup file'));
  let notes = 0, sermons = 0;
  for (const n of data.notes || []) {
    const mine = state.notes.find(x => x.id === n.id);
    if (!mine || (n.updated || '') > (mine.updated || '')) {
      await db.put('notes', n);
      if (mine) Object.assign(mine, n); else state.notes.push(n);
      notes++;
    }
  }
  for (const s of data.sermons || []) {
    const mine = state.sermons.find(x => x.id === s.id);
    if (!mine || (s.updated || '') > (mine.updated || '')) {
      await db.put('sermons', s);
      if (mine) Object.assign(mine, s); else state.sermons.push(s);
      sermons++;
    }
  }
  for (const [k, v] of Object.entries(data.settings || {})) {
    if (SECRET.has(k)) continue;
    if (!(k in DEFAULT_SETTINGS)) continue;
    await saveSetting(k, v);
  }
  state.notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  state.sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (notes) changed('notes');
  if (sermons) changed('sermons');
  return { notes, sermons };
}

/** Erases this device only: no deletion markers, so the other devices and the copy on the server keep everything. */
export async function wipeAll() {
  for (const s of STORES) await db.clear(s);
  state.notes = [];
  state.sermons = [];
  state.settings = { ...DEFAULT_SETTINGS };
  state.settingsAt = {};
  state.texts = {};
  state.catechism = null;
  state.guides = [];
  state.deleted = { notes: {}, sermons: {}, texts: {}, guides: {}, catechism: '' };
}

/* ---- what came from another device (sync.js) ----
   Written straight into the database and the in-memory state, without a
   change event, so it is not sent back. Rows the other device deleted are
   removed here too; the markers for them are kept in state.deleted. */

/** Settings rows [{key, value, at}] from the other device: each one is newer than ours (sync.js decided). */
export async function applyRemoteSettings(rows) {
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    state.settings[r.key] = r.value;
    state.settingsAt[r.key] = r.at || '';
    await db.put('settings', { key: r.key, value: r.value, at: r.at || '' });
  }
}

/** Notes or preparations: `put` rows replace ours (in place, so an open screen keeps its object), `remove` ids go. */
export async function applyRemoteList(part, put, remove, deleted) {
  const list = state[part];
  for (const row of put) {
    const mine = list.find(x => x.id === row.id);
    if (mine) { for (const k of Object.keys(mine)) if (!(k in row)) delete mine[k]; Object.assign(mine, row); }
    else list.push(row);
    await db.put(part, mine || row);
  }
  for (const id of remove) {
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) list.splice(i, 1);
    await db.del(part, id);
  }
  if (part === 'notes') list.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  if (part === 'sermons') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (part === 'guides') list.sort((a, b) => (a.loadedAt || '').localeCompare(b.loadedAt || ''));
  if (deleted) { state.deleted[part] = deleted; await saveDeleted(); }
}

/** Pasted chapters from the other device. */
export async function applyRemoteTexts(put, remove, deleted) {
  for (const row of put) { await db.put('texts', row); indexText(row); }
  for (const key of remove) { await db.del('texts', key); unindexText(key); }
  if (deleted) { state.deleted.texts = deleted; await saveDeleted(); }
}

/** The Catechism text as the other device has it: loaded (meta and sections) or removed (null, with the time it was removed). */
export async function applyRemoteCatechism(meta, sections, removedAt) {
  if (meta && sections) {
    await db.put('catechism', { key: 'text', value: sections });
    await db.put('catechism', { key: 'meta', value: meta });
    state.catechism = meta;
    state.deleted.catechism = '';
  } else {
    await db.clear('catechism');
    state.catechism = null;
    state.deleted.catechism = removedAt || '';
  }
  await saveDeleted();
}

/** The sync store holds this device's sync settings (the code, what was last sent and seen) beside the deletion markers. */
export function syncGet(key) { return db.get('sync', key).then(r => (r ? r.value : undefined)); }
export function syncPut(key, value) { return db.put('sync', { key, value }); }
export function syncDel(key) { return db.del('sync', key); }

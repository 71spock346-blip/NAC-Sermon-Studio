/*
 * Storage. Everything a person writes lives in IndexedDB on the device:
 * notes, service preparations, settings, and a cache of chapters fetched
 * from API.Bible. On start the small stores are loaded into memory, and
 * every change is written through, so the rest of the app can treat the
 * arrays as the truth. Export/Import moves the lot between devices.
 */
const DB_NAME = 'nac-study-bible';
const DB_VERSION = 1;
const STORES = ['notes', 'sermons', 'settings', 'cache'];

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
  bookLang: 'en',
  fontSize: 'm',
  apiKey: '',
  apiBibles: [],          // [{id, abbreviation, name, language}] chosen from the key's catalogue
  yvKey: '',              // YouVersion Platform app key, same rules as apiKey
  yvBibles: [],           // [{id, abbreviation, name, language}] chosen from that catalogue
  name: '',
  congregation: '',
  lastRef: 'PSA.23',
};

/** In-memory state, filled by load(). */
export const state = {
  notes: [],
  sermons: [],
  settings: { ...DEFAULT_SETTINGS },
};

export async function load() {
  const [notes, sermons, settings] = await Promise.all([db.all('notes'), db.all('sermons'), db.all('settings')]);
  state.notes = notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  state.sermons = sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  state.settings = { ...DEFAULT_SETTINGS };
  for (const row of settings) state.settings[row.key] = row.value;
  return state;
}

export async function saveSetting(key, value) {
  state.settings[key] = value;
  await db.put('settings', { key, value });
}

export async function saveNote(note) {
  note.updated = new Date().toISOString();
  if (!note.created) note.created = note.updated;
  if (!note.id) note.id = uid();
  const i = state.notes.findIndex(n => n.id === note.id);
  if (i >= 0) state.notes[i] = note; else state.notes.unshift(note);
  await db.put('notes', note);
  return note;
}

export async function deleteNote(id) {
  state.notes = state.notes.filter(n => n.id !== id);
  await db.del('notes', id);
}

export async function saveSermon(sermon) {
  sermon.updated = new Date().toISOString();
  if (!sermon.created) sermon.created = sermon.updated;
  if (!sermon.id) sermon.id = uid();
  const i = state.sermons.findIndex(s => s.id === sermon.id);
  if (i >= 0) state.sermons[i] = sermon; else state.sermons.unshift(sermon);
  state.sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  await db.put('sermons', sermon);
  return sermon;
}

export async function deleteSermon(id) {
  state.sermons = state.sermons.filter(s => s.id !== id);
  await db.del('sermons', id);
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

/* ---- backup ---- */
export async function exportAll() {
  return {
    app: 'nac-study-bible',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
    sermons: state.sermons,
    settings: Object.fromEntries(Object.entries(state.settings).filter(([k]) => k !== 'apiKey' && k !== 'yvKey')),
  };
}

/** Merge a backup in: newer copies win, nothing is deleted. Returns counts. */
export async function importAll(data) {
  if (!data || data.app !== 'nac-study-bible') throw new Error('Not a Study Bible backup file');
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
    if (k === 'apiKey' || k === 'yvKey') continue;
    if (!(k in DEFAULT_SETTINGS)) continue;
    await saveSetting(k, v);
  }
  state.notes.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  state.sermons.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { notes, sermons };
}

export async function wipeAll() {
  for (const s of STORES) await db.clear(s);
  state.notes = [];
  state.sermons = [];
  state.settings = { ...DEFAULT_SETTINGS };
}

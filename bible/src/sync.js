/*
 * Sync: keeps the person's PC and phone the same.
 *
 * There is no account. On the first device "Turn on sync" makes a code of 20
 * letters and numbers; the other device joins by typing or scanning it. The
 * code is the whole secret: a key is derived from it, every part of the data
 * is locked with that key (AES-GCM) before it leaves the device, and the
 * server (api/sync.js, a small function beside the app that keeps blobs in
 * Vercel Blob) only ever sees the locked bytes under a name that is a hash
 * of the code. It cannot read notes, keys or the Church's texts, and nobody
 * without the code can find or open them.
 *
 * The data goes in six parts (notes, preparations, settings, pasted text,
 * the Catechism text and the Guides), each its own blob with an ETag. A sync
 * asks the server for each part "has it changed since the copy I saw?"; a
 * changed part is merged with the rows here (merge.js: newer wins, deletions
 * travel as markers) and, when this device holds anything the server lacks,
 * sent back with "only if it is still the copy I saw", so two devices writing
 * at once simply merge again. It runs when the app opens, a few seconds after
 * a change, when the app comes back to the front, and every few minutes.
 */
import { t } from './i18n.js';
import { toast } from './ui.js';
import { state, db, DEFAULT_SETTINGS, SECRET, DEVICE_ONLY, onChange, getCatechismText, applyRemoteSettings, applyRemoteList, applyRemoteTexts, applyRemoteCatechism, syncGet, syncPut, syncDel } from './store.js';
import { mergeCollection, mergeSettings, mergeSingle } from './merge.js';
import * as Cat from './catechism.js';

export const PARTS = ['notes', 'sermons', 'settings', 'texts', 'catechism', 'guides'];
const API = 'api/sync';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0, O, 1 or I: nothing to mistake when typing
const CODE_LENGTH = 20;
const MAX_PART = 4 * 1024 * 1024;   // the server takes 4.5 MB per request

let config = null;         // {code, carryKeys, enabledAt, lastAt}
let etags = {};            // part -> the ETag of the server copy this device last saw (and merged)
let dirty = {};            // part -> true while this device holds changes the server has not got
const gen = {};            // part -> a counter that moves on every local change, so a change made during a sync is not marked as sent
let cryptoKey = null, id = '';
let running = null, again = false, timer = null, timerAt = 0;
const status = { on: false, busy: false, lastAt: '', error: '', ready: false };
const watchers = new Set();

/* ---------------------------------------------------------------- status */

/** {on, busy, lastAt, error, ready}: ready is true once the settings have been read from the database. */
export function getStatus() { return { ...status, code: config ? config.code : '', carryKeys: config ? config.carryKeys !== false : true }; }
export function isOn() { return !!config; }

/** fn(status) is called whenever the status changes; returns the function that stops the calls. */
export function onStatus(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function notify() { const s = getStatus(); for (const fn of watchers) { try { fn(s); } catch (e) { console.error(e); } } }

/* ---------------------------------------------------------------- the code */

/** A fresh code: 20 characters from the alphabet, 100 bits, shown in groups of five. */
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return s;
}

/** "ABCDE-FGHJK-…" for reading out and typing. */
export function formatCode(code) { return (code || '').replace(/(.{5})(?=.)/g, '$1-'); }

/** What the person typed, as a code: upper case, groups and spaces removed; null when it is not a code. */
export function parseCode(text) {
  const s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  // O and I are not in the alphabet, so a 0 or 1 someone typed cannot be meant: refuse rather than guess
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}

/** The link a QR code or a message carries: opening it on the other device offers to join. */
export function linkFor(code) {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#sync/${code}`;
}

async function derive(code) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('nac-study-bible-sync-id-v1:' + code));
  id = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  cryptoKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('nac-study-bible-sync-key-v1'), iterations: 120000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ---------------------------------------------------------------- locking */

async function gzip(bytes, inflate) {
  if (typeof CompressionStream === 'undefined') return null;
  const s = inflate ? new DecompressionStream('gzip') : new CompressionStream('gzip');
  const w = s.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(s.readable).arrayBuffer());
}

/** JSON -> bytes: [1][flags][12-byte IV][AES-GCM ciphertext]; flag 1 = gzip. The part name is bound in, so a blob cannot be passed off as another part. */
async function seal(part, obj) {
  let plain = new TextEncoder().encode(JSON.stringify(obj));
  let flags = 0;
  const packed = await gzip(plain, false);
  if (packed && packed.length < plain.length) { plain = packed; flags |= 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(part) }, cryptoKey, plain));
  const out = new Uint8Array(14 + ct.length);
  out[0] = 1; out[1] = flags; out.set(iv, 2); out.set(ct, 14);
  return out;
}

async function open(part, bytes) {
  if (bytes.length < 15 || bytes[0] !== 1) throw new Error(t('The copy on the server is not in a form this app knows.'));
  const flags = bytes[1], iv = bytes.slice(2, 14), ct = bytes.slice(14);
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(part) }, cryptoKey, ct));
  } catch (e) {
    throw new Error(t('The copy on the server could not be unlocked with this code.'));
  }
  if (flags & 1) plain = await gzip(plain, true);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------------------------------------------------------------- the server */

async function serverError(r) {
  let body = null;
  try { body = await r.json(); } catch (e) { /* no JSON */ }
  const code = body && body.error;
  if (r.status === 503 && code === 'no-store') return new Error(t('The server has no storage for sync yet. It is switched on once in Vercel (see the setup steps); until then nothing can be sent.'));
  if (r.status === 413) return new Error(t('One part of your data is too big to send.'));
  return new Error(t('The server answered {status}.', { status: r.status + (body && body.message ? ' ' + body.message : '') }));
}

function partUrl(part) { return `${API}?id=${id}&part=${part}`; }

/** {unchanged} when the server copy is the one we saw, {missing} when there is none, else {etag, data}. */
async function fetchPart(part) {
  const headers = {};
  if (etags[part]) headers['If-None-Match'] = etags[part];
  const r = await fetch(partUrl(part), { cache: 'no-store', headers });
  if (r.status === 304) return { unchanged: true };
  if (r.status === 404) return { missing: true };
  if (r.status === 410) throw Object.assign(new Error('gone'), { gone: true });
  if (!r.ok) throw await serverError(r);
  const etag = r.headers.get('ETag') || '';
  const data = await open(part, new Uint8Array(await r.arrayBuffer()));
  return { etag, data };
}

/** Sends a part; with an etag only if the server copy is still that one, without one only if there is none yet. Returns the new etag, or null when someone wrote first. */
async function sendPart(part, obj, etag) {
  const body = await seal(part, obj);
  if (body.length > MAX_PART) throw new Error(t('Too big to sync: {part} ({mb} MB). It stays on this device.', { part: partName(part), mb: (body.length / 1048576).toFixed(1) }));
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (etag) headers['If-Match'] = etag; else headers['If-None-Match'] = '*';
  const r = await fetch(partUrl(part), { method: 'PUT', cache: 'no-store', headers, body });
  if (r.status === 412 || r.status === 409) return null;
  if (!r.ok) throw await serverError(r);
  const out = await r.json();
  return out.etag || '';
}

function partName(part) {
  return { notes: t('notes|part'), sermons: t('preparations|part'), settings: t('settings|part'), texts: t('pasted chapters|part'), catechism: t('Catechism text|part'), guides: t('Guides|part') }[part] || part;
}

/* ---------------------------------------------------------------- the parts */

/** The settings that travel: not the ones that belong to this screen, and the keys only when the person wants them to. */
function syncedKeys() {
  return Object.keys(DEFAULT_SETTINGS).filter(k => !DEVICE_ONLY.has(k) && (config.carryKeys !== false || !SECRET.has(k)));
}

/** This device's copy of a part, in the form that is locked and sent. */
async function localPayload(part) {
  switch (part) {
    case 'notes': return { v: 1, items: state.notes, deleted: state.deleted.notes };
    case 'sermons': return { v: 1, items: state.sermons, deleted: state.deleted.sermons };
    case 'guides': return { v: 1, items: state.guides, deleted: state.deleted.guides };
    case 'texts': return { v: 1, items: await db.all('texts'), deleted: state.deleted.texts };
    case 'settings': {
      const rows = {};
      for (const k of syncedKeys()) if (k in state.settingsAt) rows[k] = { value: state.settings[k], at: state.settingsAt[k] || '' };
      return { v: 1, rows };
    }
    case 'catechism': {
      const meta = state.catechism;
      return { v: 1, at: meta ? meta.loadedAt || '' : state.deleted.catechism || '', meta: meta || null, sections: meta ? await getCatechismText() : null };
    }
  }
  throw new Error('unknown part ' + part);
}

const STAMP = { notes: r => r.updated || '', sermons: r => r.updated || '', guides: r => r.loadedAt || '', texts: r => r.at || '' };
const KEY = { notes: r => r.id, sermons: r => r.id, guides: r => r.id, texts: r => r.key };

/**
 * Merges the server copy into this device and says what must go back:
 * {changed: did this device change, upload: the payload to send or null}.
 */
async function mergeIn(part, local, remote) {
  if (part === 'settings') {
    const m = mergeSettings(local, remote, DEFAULT_SETTINGS);
    // a row for a key this device does not carry (the keys, when "carry my keys" is off here) is not taken, but stays on the server for the devices that do
    const keep = new Set(syncedKeys());
    const put = m.put.filter(r => keep.has(r.key));
    if (put.length) await applyRemoteSettings(put);
    const rows = Object.fromEntries(Object.entries(m.rows).filter(([k]) => !DEVICE_ONLY.has(k)));
    return { changed: put.length > 0, upload: m.remoteDiffers ? { v: 1, rows } : null };
  }
  if (part === 'catechism') {
    const which = mergeSingle({ at: local.at, present: !!local.sections }, { at: remote.at, present: !!remote.sections });
    if (which === 'remote') {
      await applyRemoteCatechism(remote.meta, remote.sections, remote.at);
      Cat.forgetText();
    }
    return { changed: which === 'remote', upload: which === 'local' ? local : null };
  }
  const m = mergeCollection(local, remote, { key: KEY[part], stamp: STAMP[part] });
  const changed = m.put.length > 0 || m.remove.length > 0 || JSON.stringify(m.deleted) !== JSON.stringify(local.deleted || {});
  if (changed) {
    if (part === 'texts') await applyRemoteTexts(m.put, m.remove, m.deleted);
    else await applyRemoteList(part, m.put, m.remove, m.deleted);
  }
  return { changed, upload: m.remoteDiffers ? { v: 1, items: m.items, deleted: m.deleted } : null };
}

/**
 * One part, once: fetch, merge, send. Returns 'conflict' when the server
 * changed under us (the caller goes again), 'changed' when this device took
 * something new, or '' when there was nothing to do.
 */
async function syncPart(part) {
  const g = gen[part] || 0;
  const got = await fetchPart(part);
  if (got.unchanged && !dirty[part]) return '';
  let result = '';
  if (got.unchanged || got.missing) {
    // the server has what we last merged (or nothing): our copy is the whole truth
    const etag = await sendPart(part, await localPayload(part), got.missing ? '' : etags[part]);
    if (!etag) return 'conflict';
    etags[part] = etag;
  } else {
    const local = await localPayload(part);
    const m = await mergeIn(part, local, got.data);
    if (m.changed) result = 'changed';
    if (m.upload || dirty[part]) {
      const etag = await sendPart(part, m.upload || await localPayload(part), got.etag);
      if (!etag) return 'conflict';
      etags[part] = etag;
    } else {
      etags[part] = got.etag;
    }
  }
  if ((gen[part] || 0) === g) dirty[part] = false;
  return result;
}

async function pass() {
  const results = await Promise.all(PARTS.map(p => syncPart(p).catch(e => { e.part = p; throw e; })));
  return { conflict: results.includes('conflict'), changed: PARTS.filter((p, i) => results[i] === 'changed') };
}

async function run() {
  status.busy = true; status.error = '';
  notify();
  const changed = new Set();
  try {
    if (!cryptoKey) await derive(config.code);
    for (let round = 0; round < 4; round++) {
      const r = await pass();
      r.changed.forEach(p => changed.add(p));
      if (!r.conflict) break;
      if (round === 3) throw new Error(t('Another device kept writing at the same time. Try again in a moment.'));
    }
    status.lastAt = new Date().toISOString();
    config.lastAt = status.lastAt;
    await saveConfig();
  } catch (e) {
    if (e && e.gone) {
      // another device deleted the copy on the server: this device stops, and keeps what it has
      await disable();
      toast(t('The copy on the server was deleted from another device, so sync is off here. Everything on this device stays.'), true);
      return changed;
    }
    status.error = e.message || String(e);
    if (!(e instanceof TypeError)) console.warn('sync', e);   // a TypeError is the network being away: nothing to log
    if (e instanceof TypeError) status.error = t('No connection. The app syncs when it is back.');
  } finally {
    await syncPut('etags', etags).catch(() => {});
    await syncPut('dirty', dirty).catch(() => {});
    status.busy = false;
    notify();
  }
  if (changed.size) document.dispatchEvent(new CustomEvent('sb-sync', { detail: { parts: [...changed] } }));
  return changed;
}

/** Runs a sync now, or queues one after the sync in progress. Resolves when done; never throws (the status carries the error). */
export function syncNow() {
  if (!config) return Promise.resolve(new Set());
  clearTimeout(timer); timer = null;
  if (running) { again = true; return running; }
  running = run().finally(() => {
    running = null;
    if (again) { again = false; schedule(500); }
  });
  return running;
}

/** Runs a sync in `ms` from now, unless one is already due sooner. */
function schedule(ms) {
  if (!config) return;
  const at = Date.now() + ms;
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => { timer = null; syncNow(); }, ms);
}

/* ---------------------------------------------------------------- turning on and off */

async function saveConfig() { await syncPut('config', config); }

/** Reads this device's sync settings. Called once at start, before start(). */
export async function init() {
  const [c, e, d] = await Promise.all([syncGet('config'), syncGet('etags'), syncGet('dirty')]);
  config = c && c.code ? c : null;
  etags = (e && typeof e === 'object') ? e : {};
  dirty = (d && typeof d === 'object') ? d : {};
  status.on = !!config;
  status.lastAt = config ? config.lastAt || '' : '';
  status.ready = true;
  notify();
}

/** Watches for changes and the app's comings and goings, and runs the first sync. */
export function start() {
  onChange((part, opts) => {
    if (!config || !PARTS.includes(part)) return;
    dirty[part] = true;
    gen[part] = (gen[part] || 0) + 1;
    syncPut('dirty', dirty).catch(() => {});
    schedule(opts && opts.lazy ? 60000 : 2500);
  });
  document.addEventListener('visibilitychange', () => {
    if (!config) return;
    if (document.visibilityState === 'visible') {
      const last = status.lastAt ? Date.parse(status.lastAt) : 0;
      if (Date.now() - last > 60000) schedule(300);
    } else if (Object.values(dirty).some(Boolean)) {
      schedule(0);
    }
  });
  window.addEventListener('online', () => schedule(500));
  setInterval(() => { if (config && document.visibilityState === 'visible' && !running && !timer) syncNow(); }, 5 * 60 * 1000);
  if (config) schedule(700);
}

/** Does the server hold anything under this code? Used before joining, so a mistyped code is caught. */
export async function probe(code) {
  await derive(code);
  const r = await fetch(partUrl('settings'), { cache: 'no-store' });
  if (r.status === 404 || r.status === 410) return false;
  if (!r.ok) throw await serverError(r);
  return true;
}

/** Turns sync on with a new code (the first device) or with the code of another device (join). Everything here merges with what is on the server. */
export async function enable(code, { carryKeys = true } = {}) {
  config = { code, carryKeys, enabledAt: new Date().toISOString(), lastAt: '' };
  etags = {};
  dirty = Object.fromEntries(PARTS.map(p => [p, true]));
  cryptoKey = null;
  status.on = true; status.lastAt = ''; status.error = '';
  await saveConfig();
  await syncPut('etags', etags);
  await syncPut('dirty', dirty);
  notify();
  await syncNow();
  if (status.error) {
    // the first sync failed: do not leave a half-joined device behind
    const msg = status.error;
    await disable();
    throw new Error(msg);
  }
}

/** Whether the keys travel from this device, and whether it takes them from the server. */
export async function setCarryKeys(on) {
  if (!config) return;
  config.carryKeys = !!on;
  await saveConfig();
  dirty.settings = true;
  gen.settings = (gen.settings || 0) + 1;
  await syncPut('dirty', dirty);
  notify();
  schedule(300);
}

/** Stops syncing on this device. Everything on the device stays; the copy on the server stays for the other devices. */
export async function disable() {
  clearTimeout(timer); timer = null;
  config = null; cryptoKey = null; id = '';
  etags = {}; dirty = {};
  status.on = false; status.lastAt = ''; status.error = ''; status.busy = false;
  await Promise.all([syncDel('config'), syncDel('etags'), syncDel('dirty')]);
  notify();
}

/** Deletes the copy on the server and stops syncing here. The other devices keep what they have and stop finding anything to sync with. */
export async function deleteRemote() {
  if (!config) return;
  if (!cryptoKey) await derive(config.code);
  const r = await fetch(`${API}?id=${id}`, { method: 'DELETE', cache: 'no-store' });
  if (!r.ok) throw await serverError(r);
  await disable();
}

/** Counts for the status line: what this device holds that travels. */
export function summary() {
  return { notes: state.notes.length, sermons: state.sermons.length, guides: state.guides.length, catechism: !!state.catechism, texts: Object.values(state.texts).reduce((n, s) => n + s.size, 0) };
}

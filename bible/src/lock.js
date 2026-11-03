/*
 * The lock on the AI helper: Claude's help is the minister's own.
 *
 * The app is a public site, so anyone may open it, and the minister's own
 * phone or PC may be in someone else's hands for a moment. The helper
 * (reading the Guide, the suggestions in Prepare, the translation of a
 * note, the reflection guide) therefore shows only after a password the
 * minister chose. One part stays open to everyone: in Theology anyone may
 * ask Claude, but only with a key of their own (settings.guestAiKey, kept
 * on that device only); the minister's key is never used while the helper
 * is locked (ai.js activeKey).
 *
 * What is kept where:
 *   settings.helperLock  {v, salt, hash, iter, at}: not the password, but
 *                        a PBKDF2 hash of it with a salt, so it can be
 *                        checked and never read back. It travels with the
 *                        sync and the backup like any setting, so every
 *                        device of the minister's knows the lock.
 *   settings.helperOpen  the lock's `at` once the password was typed on
 *                        this device. Device only, never synced or backed
 *                        up (store.js DEVICE_ONLY + SECRET): each device is
 *                        unlocked once, by hand, and a new password (a new
 *                        `at`) locks every device again until it is typed.
 *
 * Before a lock is chosen, the helper shows wherever the minister's own key
 * is (that is how it was until November 2026), and a card in Settings asks
 * him to choose a password. A device without his key and without a lock
 * never shows the helper: that is every visitor's device.
 *
 * The password is taken as typed, with the ends trimmed, the spaces inside
 * made single and capitals made small, so a slip of the Shift key does not
 * lock anyone out. Four characters at least; a few words are advised.
 */
import { state, saveSetting } from './store.js';
import { t } from './i18n.js';

const ITERATIONS = 200000;
export const MIN_LENGTH = 4;

/** The password as it is checked: trimmed, one space between words, no capitals. */
export function tidy(text) { return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

/** The lock as set, or null when the helper has none yet. */
export function lock() {
  const l = state.settings.helperLock;
  return l && typeof l === 'object' && l.hash && l.salt ? l : null;
}

/** Is there a lock on this device's copy of the settings (set here, or come by sync or backup)? */
export function hasLock() { return !!lock(); }

/**
 * May this device use the whole helper? With a lock: once the password was
 * typed here (and not since a newer password). Without one: wherever the
 * minister's own key is, as before the lock existed.
 */
export function unlocked() {
  const l = lock();
  return l ? state.settings.helperOpen === l.at : !!(state.settings.aiKey || '').trim();
}

export function locked() { return !unlocked(); }

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

function subtle() {
  const s = crypto && crypto.subtle;
  if (!s) throw new Error(t('This browser cannot keep a password here. Open the app over https.'));
  return s;
}

/** PBKDF2-SHA-256 of the tidied password with the salt, as base64. */
async function digest(text, saltB64, iterations) {
  const enc = new TextEncoder();
  const base = await subtle().importKey('raw', enc.encode(tidy(text)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' }, base, 256);
  return b64(new Uint8Array(bits));
}

function announce() { document.dispatchEvent(new CustomEvent('sb-lock')); }

/** Sets (or changes) the password. This device stays unlocked; every other device asks for the new password once. */
export async function setPassword(text) {
  if (tidy(text).length < MIN_LENGTH) throw new Error('too short');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const at = new Date().toISOString();
  const hash = await digest(text, salt, ITERATIONS);
  await saveSetting('helperLock', { v: 1, salt, hash, iter: ITERATIONS, at });
  await saveSetting('helperOpen', at);
  announce();
}

/** Checks the password; true unlocks this device. Without a lock there is nothing to open. */
export async function open(text) {
  const l = lock();
  if (!l) return true;
  const hash = await digest(text, l.salt, l.iter || ITERATIONS);
  if (hash !== l.hash) return false;
  await saveSetting('helperOpen', l.at);
  announce();
  return true;
}

/** Locks the helper on this device again; the password opens it. */
export async function close() {
  await saveSetting('helperOpen', '');
  announce();
}

/** Takes the lock away on every device: the helper shows again wherever the minister's key is. */
export async function remove() {
  await saveSetting('helperLock', null);
  await saveSetting('helperOpen', '');
  announce();
}

/*
 * The language of the interface: English or Afrikaans.
 *
 * Every word the app shows (tabs, buttons, labels, hints, messages, the
 * headings in the printed notes) goes through t(). The English text is the
 * key, so the code stays readable and English needs no table; af.js maps each
 * English text to its Afrikaans. A text with no Afrikaans entry is shown in
 * English rather than lost. Variables are written as {name} in the key:
 * t('Saved {name}', { name }). Where one English word needs two Afrikaans
 * words in different places, the key carries a tag after a bar, which the
 * English never shows: t('Context|box').
 *
 * The Bible text itself is not translated here: it is read in whichever
 * translation the person chooses. Book names follow the "Book names"
 * setting (books.js), so they can differ from the interface if wanted.
 *
 * The choice is kept in the settings (uiLang) and mirrored to localStorage
 * as 'sb-lang', so help.html and the first paint know it without the database.
 */
import { AF } from './af.js';

export const LANGS = [['en', 'English'], ['af', 'Afrikaans']];

let current = 'en';

/** The language in use: 'en' or 'af'. */
export function lang() { return current; }

/** The locale for dates: Afrikaans dates read "Sondag 1 November 2026". */
export function locale() { return current === 'af' ? 'af-ZA' : 'en-ZA'; }

export function setLang(l) {
  current = l === 'af' ? 'af' : 'en';
  document.documentElement.lang = current;
  try { localStorage.setItem('sb-lang', current); } catch (e) { /* private mode: the database still has it */ }
}

/** The text for a key in the current language, with {name} variables filled in. */
export function t(key, vars) {
  let s = current === 'af' ? AF[key] : undefined;
  if (s === undefined) s = key.includes('|') ? key.slice(0, key.indexOf('|')) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/** One of two keys by count, with {n} filled in: tn(3, '{n} note', '{n} notes') → "3 notes". */
export function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, { n, ...(vars || {}) });
}

/** Fills every element marked data-t (text), data-t-aria (aria-label) or data-t-title (title) in the static page. */
export function translatePage(root) {
  for (const node of (root || document).querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  for (const node of (root || document).querySelectorAll('[data-t-aria]')) node.setAttribute('aria-label', t(node.dataset.tAria));
  for (const node of (root || document).querySelectorAll('[data-t-title]')) node.title = t(node.dataset.tTitle);
}

/*
 * The Catechism of the New Apostolic Church as an index, not as text.
 *
 * data/catechism.json holds the section numbers and titles, the id of each
 * section's page on nak.org, and which Bible verses each section quotes. The
 * reader uses it to mark a verse the Catechism refers to; this tab lets the
 * person browse or search the sections. The text itself is read at nak.org,
 * which keeps the app on the right side of the Church's copyright.
 */
import { el, clear } from './ui.js';
import { keyToRef, formatRef } from './books.js';
import { state } from './store.js';

let data = null;
let loading = null;

export function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch('data/catechism.json').then(r => r.json()).then(d => {
      d.byN = Object.fromEntries(d.sections.map(s => [s.n, s]));
      data = d;
      return d;
    });
  }
  return loading;
}

export function ready() { return !!data; }

export function url(section) {
  return data ? data.url + section.id : 'https://nak.org/en/abouttheNAC/catechism';
}

export function section(n) {
  return data ? data.byN[n] || null : null;
}

/** Sections that refer to a verse (or, with no verse, anywhere in a chapter). */
export function refsFor(book, chapter, verse) {
  if (!data) return [];
  const ns = new Set();
  if (verse) {
    for (const n of data.refs[`${book}.${chapter}.${verse}`] || []) ns.add(n);
  } else {
    const prefix = `${book}.${chapter}.`;
    for (const k of Object.keys(data.refs)) if (k.startsWith(prefix) || k === `${book}.${chapter}`) for (const n of data.refs[k]) ns.add(n);
  }
  for (const n of data.refs[`${book}.${chapter}`] || []) if (!verse) ns.add(n);
  return [...ns].sort(compareN).map(n => data.byN[n]).filter(Boolean);
}

/** verse number -> [section] for one chapter, for the reader's markers. */
export function chapterMap(book, chapter) {
  const out = new Map();
  if (!data) return out;
  const prefix = `${book}.${chapter}.`;
  for (const [k, ns] of Object.entries(data.refs)) {
    if (!k.startsWith(prefix)) continue;
    const v = parseInt(k.slice(prefix.length), 10);
    out.set(v, ns.slice().sort(compareN).map(n => data.byN[n]).filter(Boolean));
  }
  return out;
}

/** The verses a section quotes: [{key, label, ref}]. */
export function versesOf(n) {
  if (!data) return [];
  return (data.bySection[n] || []).map(([key, label]) => ({ key, label, ref: keyToRef(key) }));
}

/** Sort "3.4.1" before "3.4.10"; Intro first, Appendix last. */
function compareN(a, b) {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
function parts(n) {
  if (n.startsWith('Intro')) return [0, ...n.split('.').slice(1).map(Number)];
  if (n === 'Appendix') return [99];
  return n.split('.').map(Number);
}

export function search(q) {
  if (!data) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return data.sections.filter(s => {
    const hay = (s.n + ' ' + s.title).toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/* ---------------------------------------------------------------- the tab */

export function render(container, route) {
  clear(container);
  if (!data) {
    container.append(el('p', { class: 'muted', text: 'Loading the Catechism index…' }));
    load().then(() => render(container, route));
    return;
  }
  const n = route[1] ? decodeURIComponent(route[1]) : null;
  if (n && data.byN[n]) return renderSection(container, data.byN[n]);
  renderIndex(container, route[1] === 'search' ? decodeURIComponent(route[2] || '') : '');
}

function renderIndex(container, q) {
  const input = el('input', { type: 'search', placeholder: 'Search the Catechism by number or title, e.g. "baptism" or 8.1', value: q });
  const results = el('div', { class: 'list' });
  const lang = state.settings.bookLang;
  function show() {
    clear(results);
    const text = input.value.trim();
    const hits = text ? search(text) : data.sections.filter(s => parts(s.n).length <= 2);
    if (!hits.length) results.append(el('p', { class: 'muted', text: 'Nothing found. Try one word, such as "sacrament".' }));
    for (const s of hits.slice(0, 200)) {
      const depth = parts(s.n).length;
      results.append(el('a', { class: 'item cat depth' + Math.min(depth, 4), href: `#catechism/${encodeURIComponent(s.n)}` }, [
        el('span', { class: 'num', text: s.n === 'Intro' ? '' : s.n }),
        el('span', { class: 'grow', text: s.title }),
        el('span', { class: 'count muted', text: (data.bySection[s.n] || []).length ? `${(data.bySection[s.n] || []).length} refs` : '' }),
      ]));
    }
    if (hits.length > 200) results.append(el('p', { class: 'muted small', text: `Showing 200 of ${hits.length}. Add a word to narrow it.` }));
  }
  input.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Catechism of the New Apostolic Church' })]),
    el('p', { class: 'muted small', text: 'The chapters below are an index. Open a section to see which Bible verses it quotes and to read the section itself at nak.org. The reader marks every verse the Catechism refers to with a "C".' }),
    input, results);
  show();
}

function renderSection(container, s) {
  const lang = state.settings.bookLang;
  const children = data.sections.filter(x => x.n !== s.n && x.n.startsWith(s.n + '.') && parts(x.n).length === parts(s.n).length + 1);
  const parentN = parts(s.n).length > 1 ? s.n.split('.').slice(0, -1).join('.') : null;
  const verses = versesOf(s.n);
  container.append(
    el('div', { class: 'crumbs' }, [
      el('a', { href: '#catechism', text: 'Catechism' }),
      parentN && data.byN[parentN] ? [' › ', el('a', { href: `#catechism/${encodeURIComponent(parentN)}`, text: parentN })] : null,
    ].flat()),
    el('div', { class: 'docbar' }, [
      el('h3', { text: (s.n === 'Intro' || s.n === 'Appendix' ? '' : s.n + '  ') + s.title }),
      el('div', { class: 'spacer' }),
      el('a', { class: 'btn small', href: url(s), target: '_blank', rel: 'noopener', text: 'Read at nak.org' }),
    ]),
    el('p', { class: 'muted small', text: `Printed edition page ${s.page}. The text of the Catechism is read on the Church's own site.` }),
  );
  if (children.length) {
    container.append(el('h3', { class: 'sub', text: 'In this section' }));
    const list = el('div', { class: 'list' });
    for (const c of children) {
      list.append(el('a', { class: 'item cat', href: `#catechism/${encodeURIComponent(c.n)}` }, [
        el('span', { class: 'num', text: c.n }), el('span', { class: 'grow', text: c.title }),
      ]));
    }
    container.append(list);
  }
  container.append(el('h3', { class: 'sub', text: verses.length ? `Bible references (${verses.length})` : 'Bible references' }));
  if (!verses.length) {
    container.append(el('p', { class: 'muted small', text: 'No Bible references were read for this heading. Its subsections may carry them.' }));
  } else {
    const list = el('div', { class: 'pills big' });
    for (const v of verses) {
      if (!v.ref) continue;
      list.append(el('a', { class: 'pill link', href: `#read/${v.ref.book}/${v.ref.chapter}/${v.ref.verse || ''}`, text: v.label }));
    }
    container.append(list);
  }
}

/** Short list of sections for a verse popover: [{n, title, url}] */
export function summarise(sections) {
  return sections.map(s => ({ n: s.n, title: s.title, url: url(s) }));
}

export function formatVerseLabel(key) {
  const ref = keyToRef(key);
  return ref ? formatRef(ref, state.settings.bookLang) : key;
}

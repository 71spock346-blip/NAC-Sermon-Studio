/*
 * The Catechism of the New Apostolic Church: an index that is always there,
 * and the text itself when the person has loaded it on this device.
 *
 * data/catechism.json holds the section numbers and titles, the id of each
 * section's page on nak.org, and which Bible verses each section quotes. The
 * reader uses it to mark a verse the Catechism refers to; this tab lets the
 * person browse or search the sections.
 *
 * The text of the sections is the Church's copyright, so it is not published
 * with the app. Settings > Catechism loads the file that tools/build_catechism.py
 * makes from the Catechism PDF into this browser only. Once it is there, the
 * sections are read here, shown under a service preparation, and printed in
 * the sermon notes; without it the app links to the section at nak.org.
 */
import { el, clear } from './ui.js';
import { keyToRef, formatRef } from './books.js';
import { state, getCatechismText } from './store.js';

let data = null;
let loading = null;
let text = null;            // n -> {blocks, summary, notes} once loaded from the device
let textLoading = null;

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
  if (!data || !section || !section.id) return 'https://nak.org/en/abouttheNAC/catechism';
  return data.url + section.id;
}

export function section(n) {
  return data ? data.byN[n] || null : null;
}

/* ---------------------------------------------------------------- the text */

/** Is the Catechism text loaded on this device (whether or not it is in memory yet)? */
export function hasText() { return !!state.catechism; }

/** Reads the text from the device into memory once; resolves to true when it is there. */
export function loadText() {
  if (text) return Promise.resolve(true);
  if (!state.catechism) return Promise.resolve(false);
  if (!textLoading) {
    textLoading = getCatechismText().then(sections => {
      if (!sections) { textLoading = null; return false; }
      text = Object.fromEntries(sections.map(s => [s.n, s]));
      return true;
    }).catch(() => { textLoading = null; return false; });
  }
  return textLoading;
}

/** Called when the text is loaded or removed in Settings. */
export function forgetText() { text = null; textLoading = null; }

export function textReady() { return !!text; }

/** {blocks, summary, notes} of a section, or null when the text is not in memory. */
export function textOf(n) {
  return text && text[n] ? text[n] : null;
}

/** The section's text as plain lines, for search and for the PDF: [{kind, text}] */
export function plainLines(n) {
  const t = textOf(n);
  if (!t) return [];
  const out = [];
  for (const b of t.blocks || []) {
    if (typeof b === 'string') out.push({ kind: 'p', text: b });
    else if (b.h) out.push({ kind: 'h', text: b.h });
    else if (b.l) for (const it of b.l) out.push({ kind: 'li', text: it, single: b.l.length === 1 });
    else if (b.v) out.push({ kind: 'v', text: b.v.join('\n') });
    else if (b.table) {
      for (const row of b.table.rows) {
        out.push({ kind: 'h', text: row[0] });
        row.slice(1).forEach((cell, i) => { if (cell) out.push({ kind: 'cell', text: cell, label: b.table.head[i] || '' }); });
      }
    }
  }
  return out;
}

/** The section's summary paragraphs (the book's own), or []. */
export function summaryOf(n) {
  const t = textOf(n);
  return t && t.summary ? t.summary : [];
}

export function notesOf(n) {
  const t = textOf(n);
  return t && t.notes ? t.notes : [];
}

/** "see 4.2" and "(see 8 and 12.1.13)" become links to those sections. */
function withLinks(s) {
  const parts = [];
  const re = /\b(see|cf\.)\s+((?:\d+(?:\.\d+)*)(?:\s*(?:,|and)\s*\d+(?:\.\d+)*)*)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    parts.push(s.slice(last, m.index), m[1] + ' ');
    const nums = m[2].split(/\s*(?:,|and)\s*/);
    const seps = m[2].match(/\s*(?:,|and)\s*/g) || [];
    nums.forEach((num, i) => {
      parts.push(data && data.byN[num] ? el('a', { href: `#catechism/${encodeURIComponent(num)}`, text: num }) : num);
      if (seps[i]) parts.push(seps[i]);
    });
    last = m.index + m[0].length;
  }
  parts.push(s.slice(last));
  return parts;
}

/** The text of one section as DOM: the book's summary, the paragraphs, the footnotes. */
export function renderText(n, opts = {}) {
  const t = textOf(n);
  const box = el('div', { class: 'cat-text' });
  if (!t) return box;
  if (!opts.noSummary && t.summary && t.summary.length) {
    box.append(el('div', { class: 'cat-sum' }, [el('b', { text: 'In short' }), ...t.summary.map(p => el('p', {}, withLinks(p)))]));
  }
  for (const b of t.blocks || []) {
    if (typeof b === 'string') box.append(el('p', {}, withLinks(b)));
    else if (b.h) box.append(el('h4', { text: b.h }));
    else if (b.l) box.append(b.l.length === 1 ? el('p', { class: 'cat-def' }, withLinks(b.l[0])) : el('ul', {}, b.l.map(it => el('li', {}, withLinks(it)))));
    else if (b.v) box.append(el('p', { class: 'cat-verse' }, b.v.flatMap((line, i) => i ? [el('br'), line] : [line])));
    else if (b.table) box.append(renderTable(b.table));
  }
  if (t.notes && t.notes.length) {
    box.append(el('div', { class: 'cat-notes small muted' }, t.notes.map(nt => el('p', {}, [el('sup', { text: nt.n }), ' ', ...withLinks(nt.t)]))));
  }
  if (!opts.noCredit) box.append(el('p', { class: 'cat-credit muted small', text: credit() }));
  return box;
}

function renderTable(t) {
  const table = el('table', { class: 'cat-table' });
  table.append(el('thead', {}, el('tr', {}, [el('th', { text: '' }), ...t.head.map(h => el('th', { text: h }))])));
  const body = el('tbody');
  for (const row of t.rows) {
    body.append(el('tr', {}, [el('th', { text: row[0] }), ...row.slice(1).map(cell => el('td', {}, String(cell).split('\n').flatMap((line, i) => i ? [el('br'), line] : [line])))]));
  }
  table.append(body);
  return el('div', { class: 'cat-table-wrap' }, table);
}

export function credit() {
  const m = state.catechism;
  return (m && m.edition ? m.edition : 'Catechism of the New Apostolic Church') + ' © New Apostolic Church International, Zurich. Loaded on this device for personal study.';
}

/* ---------------------------------------------------------------- references */

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

/**
 * Sections whose number or title holds every word; with the text loaded,
 * also those whose text does, each with a snippet around the first word.
 */
export function search(q) {
  if (!data) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  const seen = new Set();
  for (const s of data.sections) {
    const hay = (s.n + ' ' + s.title).toLowerCase();
    if (words.every(w => hay.includes(w))) { hits.push({ section: s }); seen.add(s.n); }
  }
  if (text) {
    for (const s of data.sections) {
      if (seen.has(s.n)) continue;
      const body = plainLines(s.n).map(l => l.text).concat(summaryOf(s.n)).join(' ');
      const low = body.toLowerCase();
      if (!words.every(w => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      const from = Math.max(0, body.lastIndexOf(' ', Math.max(0, at - 60)) + 1);
      const to = Math.min(body.length, at + words[0].length + 110);
      hits.push({ section: s, snippet: (from > 0 ? '…' : '') + body.slice(from, to).trim() + (to < body.length ? '…' : '') });
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- the tab */

export function render(container, route) {
  clear(container);
  if (!data) {
    container.append(el('p', { class: 'muted', text: 'Loading the Catechism index…' }));
    load().then(() => render(container, route));
    return;
  }
  if (hasText() && !text) {
    loadText().then(() => render(container, route));
    container.append(el('p', { class: 'muted', text: 'Loading the Catechism…' }));
    return;
  }
  const n = route[1] ? decodeURIComponent(route[1]) : null;
  if (n && data.byN[n]) return renderSection(container, data.byN[n]);
  renderIndex(container, route[1] === 'search' ? decodeURIComponent(route[2] || '') : '');
}

function renderIndex(container, q) {
  const input = el('input', { type: 'search', 'aria-label': 'Search the Catechism', autocomplete: 'off', placeholder: text ? 'Search by number, title or a word in the text: "baptism", 8.1, "forgive"…' : 'Search by number or title: "baptism" or 8.1…', value: q });
  const results = el('div', { class: 'list' });
  function show() {
    clear(results);
    const q = input.value.trim();
    const hits = q ? search(q) : data.sections.filter(s => parts(s.n).length <= 2).map(s => ({ section: s }));
    if (!hits.length) results.append(el('p', { class: 'muted', text: 'Nothing found. Try one word, such as "sacrament".' }));
    for (const h of hits.slice(0, 200)) {
      const s = h.section;
      const depth = parts(s.n).length;
      const refs = (data.bySection[s.n] || []).length;
      results.append(el('a', { class: 'item cat depth' + Math.min(q ? 1 : depth, 4), href: `#catechism/${encodeURIComponent(s.n)}` }, [
        el('span', { class: 'num', text: s.n === 'Intro' ? '' : s.n }),
        el('span', { class: 'grow' }, [s.title, h.snippet ? el('span', { class: 'snippet muted small', text: h.snippet }) : null]),
        el('span', { class: 'count muted', text: refs ? `${refs} refs` : '' }),
      ]));
    }
    if (hits.length > 200) results.append(el('p', { class: 'muted small', text: `Showing 200 of ${hits.length}. Add a word to narrow it.` }));
  }
  input.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: 'Catechism of the New Apostolic Church' })]),
    text
      ? el('p', { class: 'muted small', text: 'Open a chapter to read its sections, see which Bible verses each one quotes, and search the whole text by word. The reader marks every verse the Catechism refers to with a "C".' })
      : el('p', { class: 'muted small' }, ['The chapters below are an index. Open a section to see which Bible verses it quotes and to read the section itself at nak.org. To read the sections here and print them in your sermon notes, load the Catechism text under ', el('a', { href: '#settings', text: 'Settings' }), '.']),
    input, results);
  show();
}

function renderSection(container, s) {
  const children = data.sections.filter(x => x.n !== s.n && x.n.startsWith(s.n + '.') && parts(x.n).length === parts(s.n).length + 1);
  const parentN = parts(s.n).length > 1 ? s.n.split('.').slice(0, -1).join('.') : null;
  const verses = versesOf(s.n);
  const t = textOf(s.n);
  container.append(
    el('div', { class: 'crumbs' }, [
      el('a', { href: '#catechism', text: 'Catechism' }),
      parentN && data.byN[parentN] ? [' › ', el('a', { href: `#catechism/${encodeURIComponent(parentN)}`, text: parentN })] : null,
    ].flat()),
    el('div', { class: 'docbar' }, [
      el('h2', { text: (s.n === 'Intro' || s.n === 'Appendix' ? '' : s.n + '  ') + s.title }),
      el('div', { class: 'spacer' }),
      el('a', { class: 'btn small ghost', href: url(s), target: '_blank', rel: 'noopener', text: 'nak.org ↗' }),
    ]),
  );
  if (t && (t.blocks.length || (t.summary || []).length)) {
    container.append(el('div', { class: 'page' }, [
      renderText(s.n, { noCredit: true }),
      el('p', { class: 'muted small', text: `Printed edition page ${s.page || '–'}. ${credit()}` }),
    ]));
  } else if (text) {
    container.append(el('p', { class: 'muted small', text: `This heading has no text of its own; its sections below carry it. Printed edition page ${s.page || '–'}.` }));
  } else {
    container.append(el('p', { class: 'muted small' }, [
      `Printed edition page ${s.page || '–'}. The text of this section is read at nak.org, or here once the Catechism text is loaded under `, el('a', { href: '#settings', text: 'Settings' }), '.',
    ]));
  }
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

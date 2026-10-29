import { t, locale } from './i18n.js';
/*
 * Small DOM helpers shared by every tab. No framework: the app is a few
 * screens, and plain functions are easier for the next person to follow.
 */

/** el('div', {class: 'card', onclick: fn, text: 'Hi'}, [children...]) */
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  if (tag === 'textarea') autosize(node);   // every text box grows with its text
  return node;
}

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** True on a phone or tablet, where focusing a field opens the keyboard. */
export function isTouch() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}

let toastTimer;
/** A short message at the bottom; with `undo` (a function) it carries an Undo button and stays a little longer. */
export function toast(msg, isError, undo) {
  const box = $('#toast');
  if (!box) return;
  box.textContent = msg;
  if (typeof undo === 'function') {
    box.append(el('button', { class: 'toast-undo', type: 'button', text: t('Undo'), onclick: () => { box.className = 'toast'; undo(); } }));
  }
  box.className = 'toast show' + (isError ? ' error' : '') + (typeof undo === 'function' ? ' action' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast'; }, isError ? 5000 : typeof undo === 'function' ? 8000 : 3000);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** "Sun 1 Nov 2026" from an ISO date (yyyy-mm-dd) or timestamp. */
export function fmtDate(iso, withWeekday) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return iso;
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withWeekday) opts.weekday = 'short';
  return d.toLocaleDateString(locale(), opts);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Next Sunday (or today if it is Sunday) as yyyy-mm-dd: the usual service day. */
export function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- theme */

export const THEMES = [['system', 'System'], ['paper', 'Paper'], ['white', 'White'], ['dark', 'Dark']];
export const SIZES = [['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Pulpit']];
/* Letters and spacing: the book face, or plain letters with more room between them and the lines, which many readers with dyslexia find easier. */
export const READS = [['book', 'Book'], ['easy', 'Easy-read']];

/**
 * Applies the letters-and-spacing choice: "easy" puts data-read="easy" on the
 * page (see styles.css), "book" takes it off. Kept in localStorage too so
 * index.html can apply it before the first paint, like the theme.
 */
export function applyRead(mode) {
  const m = mode === 'easy' ? 'easy' : 'book';
  const root = document.documentElement;
  if (m === 'easy') root.dataset.read = 'easy'; else delete root.dataset.read;
  try { localStorage.setItem('sb-read', m); } catch (e) { /* private mode: the database still has it */ }
}

/**
 * Applies a theme to the page. "system" follows the device; the others are
 * fixed. The choice is also kept in localStorage so index.html can apply it
 * before the first paint, without waiting for the database.
 */
export function applyTheme(theme) {
  const t = THEMES.some(x => x[0] === theme) ? theme : 'system';
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = t;
  try { localStorage.setItem('sb-theme', t); } catch (e) { /* private mode: the database still has it */ }
  syncThemeColor();
}

/** The browser's own bars take the page colour, so a dark page gets a dark frame. */
export function syncThemeColor() {
  requestAnimationFrame(() => {
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  });
}

/**
 * A row of choices where one is on, such as the text size:
 * seg([['s', 'Small'], ['m', 'Normal']], 'm', v => ...)
 */
export function seg(options, value, onChange, opts = {}) {
  const box = el('div', { class: 'seg' + (opts.block ? ' block' : ''), role: 'group', 'aria-label': opts.label || null });
  const draw = (current) => {
    clear(box);
    for (const [v, label] of options) {
      box.append(el('button', { type: 'button', class: v === current ? 'on' : '', 'aria-pressed': v === current ? 'true' : 'false', text: t(label), onclick: () => { draw(v); onChange(v); } }));
    }
  };
  draw(value);
  return box;
}

/* ---------------------------------------------------------------- sheets */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet. Returns {root, body, close, head}. On a phone it rises from
 * the bottom; on a desk it sits in the middle. Escape or a tap outside
 * closes it. Focus moves into the sheet and comes back to the button that
 * opened it, and Tab stays inside while it is open.
 */
export function sheet(title, opts = {}) {
  const opener = document.activeElement;
  const titleId = 'sheet-' + Math.random().toString(36).slice(2, 8);
  const body = el('div', { class: 'sheet-body' });
  const closeBtn = el('button', { class: 'icon', type: 'button', 'aria-label': t('Close'), text: '✕', onclick: () => close() });
  const head = el('div', { class: 'sheet-head' }, [el('h2', { text: title, id: titleId }), closeBtn]);
  const card = el('div', { class: 'sheet-card' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, [head, body]);
  const root = el('div', { class: 'overlay' }, card);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = $$(FOCUSABLE, card).filter(x => x.offsetParent !== null);
    if (!items.length) { e.preventDefault(); card.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey);
    if (!$('.overlay')) document.body.classList.remove('has-sheet');
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    if (opts.onclose) opts.onclose(result);
  }
  root.addEventListener('click', e => { if (e.target === root && !opts.sticky) close(); });
  document.addEventListener('keydown', onKey);
  document.body.classList.add('has-sheet');
  document.body.append(root);
  card.focus();
  return { root, body, close, head };
}

/** A yes/no question. Resolves true when the person taps the action. */
export function confirmBox(message, action, danger) {
  return new Promise(resolve => {
    const s = sheet(t('Please confirm'), { onclose: () => resolve(false), sticky: true });
    const ok = el('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', text: action || 'OK', onclick: () => { resolve(true); s.close(true); } });
    s.body.append(
      el('p', { text: message }),
      el('div', { class: 'row end' }, [
        el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => s.close() }),
        ok,
      ]));
    setTimeout(() => ok.focus(), 30);
  });
}

/**
 * A sheet for work that takes a while, such as a request to Claude:
 * busy('Reading the Guide', onCancel) → {say(text), done(), fail(message)}.
 * Closing the sheet (the ✕, Escape or Cancel) calls onCancel while the work runs.
 */
export function busy(title, onCancel) {
  let finished = false;
  const s = sheet(title, { sticky: true, onclose: () => { if (!finished && onCancel) onCancel(); } });
  const text = el('p', { class: 'busy-text', role: 'status' });
  const spin = el('span', { class: 'spin', 'aria-hidden': 'true' });
  const cancel = el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => s.close() });
  s.body.append(el('div', { class: 'busy' }, [spin, text]), el('div', { class: 'row end' }, [cancel]));
  return {
    say(msg) { text.textContent = msg; },
    done() { finished = true; s.close(); },
    fail(msg) {
      finished = true;
      spin.remove();
      text.textContent = msg;
      text.classList.add('error');
      cancel.textContent = t('Close');
    },
  };
}

/* ---------------------------------------------------------- growing boxes */

/*
 * Every textarea grows with its text, so nothing scrolls inside a box: the
 * page (or the sheet) scrolls instead, and `rows` is only the smallest size.
 * el() attaches this to each textarea it makes. Typing is handled here; text
 * set from code (ta.value = …) needs fit(ta) afterwards.
 */
const widths = new WeakMap();
const resizer = 'ResizeObserver' in window ? new ResizeObserver(entries => {
  // a turned phone or a resized window wraps the text differently
  const changed = [];
  for (const e of entries) {
    const w = e.contentRect.width;
    if (w === widths.get(e.target)) continue;
    widths.set(e.target, w);
    if (w) changed.push(e.target);
  }
  if (changed.length) requestAnimationFrame(() => fitAll(changed));   // outside the observer's own callback
}) : null;
let queued = [];

export function autosize(ta) {
  if (ta.classList.contains('grows')) return ta;
  ta.classList.add('grows');
  ta.addEventListener('input', () => fit(ta));
  if (resizer) resizer.observe(ta);
  // the first measure, once the script that made the box has put it on the page
  if (!queued.length) queueMicrotask(() => { const q = queued; queued = []; fitAll(q); });
  queued.push(ta);
  return ta;
}

/** Sets a textarea's height to its text: call it after setting .value from code. */
export function fit(ta) { fitAll([ta]); }

function fitAll(tas) {
  const list = tas.filter(t => t.isConnected);
  if (!list.length) return;
  // the page and the sheet keep their place while the boxes are measured
  const scrollerOf = t => t.closest('.sheet-body') || document.scrollingElement;
  const scrollers = [...new Set(list.map(scrollerOf))];
  const tops = scrollers.map(s => s.scrollTop);
  const before = list.map(t => t.offsetHeight);
  for (const t of list) t.style.height = 'auto';
  const heights = list.map(t => {
    const h = t.scrollHeight;
    if (!h) return '';   // not shown yet: measured again when it is
    const cs = getComputedStyle(t);
    return h + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + 'px';
  });
  list.forEach((t, i) => { t.style.height = heights[i]; });
  scrollers.forEach((s, i) => { if (s.scrollTop !== tops[i]) s.scrollTop = tops[i]; });
  // typing at the foot of a box that has just grown: keep the new line in sight, above the keyboard
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  const ta = list[i], grew = ta.offsetHeight - before[i];
  if (grew <= 0) return;
  const scroller = scrollerOf(ta);
  const vv = window.visualViewport;
  let seen = vv ? vv.offsetTop + vv.height : window.innerHeight;
  if (scroller !== document.scrollingElement) seen = Math.min(seen, scroller.getBoundingClientRect().bottom);
  const below = ta.getBoundingClientRect().bottom - seen;
  if (below > 0) scroller.scrollTop += Math.min(below, grew);
}

/**
 * A one-line box, such as a title, that wraps onto a second line instead of
 * scrolling sideways: a textarea that never takes a newline. On a phone the
 * Enter key reads "Done" and closes the keyboard.
 */
export function lineBox(attrs = {}) {
  const { value, ...rest } = attrs;
  const ta = el('textarea', { rows: 1, enterkeyhint: 'done', ...rest, class: 'oneline' + (rest.class ? ' ' + rest.class : '') });
  if (value != null) ta.value = value;
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (isTouch()) ta.blur();
  });
  ta.addEventListener('input', () => {   // pasted line breaks become spaces
    if (/[\r\n]/.test(ta.value)) { ta.value = ta.value.replace(/\s*[\r\n]+\s*/g, ' '); fit(ta); }
  });
  return ta;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Save a text/blob as a download. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

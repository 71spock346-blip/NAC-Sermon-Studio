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
export function toast(msg, isError) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, isError ? 5000 : 3000);
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
  return d.toLocaleDateString('en-ZA', opts);
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
      box.append(el('button', { type: 'button', class: v === current ? 'on' : '', 'aria-pressed': v === current ? 'true' : 'false', text: label, onclick: () => { draw(v); onChange(v); } }));
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
  const closeBtn = el('button', { class: 'icon', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() });
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
    const s = sheet('Please confirm', { onclose: () => resolve(false), sticky: true });
    const ok = el('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', text: action || 'OK', onclick: () => { resolve(true); s.close(true); } });
    s.body.append(
      el('p', { text: message }),
      el('div', { class: 'row end' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => s.close() }),
        ok,
      ]));
    setTimeout(() => ok.focus(), 30);
  });
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

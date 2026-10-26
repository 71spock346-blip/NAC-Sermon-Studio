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

/**
 * A modal sheet. Returns {root, body, close}. On a phone it rises from the
 * bottom; on a desk it sits in the middle. Escape or a tap outside closes it.
 */
export function sheet(title, opts = {}) {
  const body = el('div', { class: 'sheet-body' });
  const head = el('div', { class: 'sheet-head' }, [
    el('h3', { text: title }),
    el('div', { class: 'spacer' }),
    el('button', { class: 'icon', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
  ]);
  const card = el('div', { class: 'sheet-card' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, [head, body]);
  const root = el('div', { class: 'overlay' }, card);
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close(result) {
    root.remove();
    document.removeEventListener('keydown', onKey);
    if (opts.onclose) opts.onclose(result);
  }
  root.addEventListener('click', e => { if (e.target === root && !opts.sticky) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  return { root, body, close, head };
}

/** A yes/no question. Resolves true when the person taps the action. */
export function confirmBox(message, action, danger) {
  return new Promise(resolve => {
    const s = sheet('Please confirm', { onclose: () => resolve(false), sticky: true });
    s.body.append(
      el('p', { text: message }),
      el('div', { class: 'row end' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => s.close() }),
        el('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', text: action || 'OK', onclick: () => { resolve(true); s.root.remove(); } }),
      ]));
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

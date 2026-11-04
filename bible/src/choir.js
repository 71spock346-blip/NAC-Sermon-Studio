/*
 * Choir programme: the conductor's hymn index, service programme,
 * before-service running order, festive preparation form and practice sheets.
 *
 * It was the standalone Choir Programme Planner and is now a tab here. The
 * work of it is choir-app.js, carried over from that app; this file puts its
 * markup on the page, starts it, and gives it its storage.
 *
 * What is kept: each service is a row of its own in the `seating` store's
 * neighbour, the `choir` store, with the conductor's settings and the hymn
 * edits beside them, so a programme written on a PC is on the phone through
 * the same sync as the notes. One row per service matters: two devices that
 * each add a programme keep both, where one row for everything would have let
 * the last device to save wipe the other's work.
 */
import { el, clear, $, toast } from './ui.js';
import { state, saveChoir, deleteChoir } from './store.js';
import { t } from './i18n.js';
import { MARKUP } from './choir-markup.js';
import { Choir, setIo } from './choir-app.js';

let started = false;
let written = new Map();   // row id -> what was last written, so only real changes are saved

/* ------------------------------------------------------------- storage */

function loadState() {
  const settings = state.choir.find(r => r.id === 'settings');
  const edits = state.choir.find(r => r.id === 'hymnEdits');
  const services = state.choir.filter(r => r.kind === 'service' && r.service).map(r => r.service);
  if (!settings && !services.length) return null;          // nothing here yet: the app starts blank
  written = new Map();
  if (settings) written.set('settings', JSON.stringify(settings.settings));
  if (edits) written.set('hymnEdits', JSON.stringify(edits.hymnEdits));
  for (const r of state.choir) if (r.kind === 'service') written.set(r.id, JSON.stringify(r.service));
  return {
    settings: settings ? settings.settings : undefined,
    hymnEdits: edits ? edits.hymnEdits : {},
    services,
    currentId: (settings && settings.currentId) || (services[0] && services[0].id) || null,
  };
}

/** Write only what actually changed, so one device's edit cannot overwrite another's untouched programme. */
function saveState(s) {
  const seen = new Set();
  const put = (id, key, value, extra) => {
    seen.add(id);
    const json = JSON.stringify(value);
    if (written.get(id) === json) return;
    written.set(id, json);
    saveChoir({ id, kind: key, [key]: value, ...(extra || {}) });
  };
  put('settings', 'settings', s.settings, { currentId: s.currentId });
  put('hymnEdits', 'hymnEdits', s.hymnEdits || {});
  for (const service of s.services || []) put('service:' + service.id, 'service', service);
  // a programme deleted here is deleted on the other devices too
  for (const row of state.choir.slice()) {
    if (row.kind === 'service' && !seen.has(row.id)) { written.delete(row.id); deleteChoir(row.id); }
  }
}

/* -------------------------------------------------------------- the tab */

export function render(container, route) {
  clear(container);
  container.append(el('p', { class: 'eyebrow', text: t('Choir') }));
  container.append(el('h2', { class: 'title', text: t('The choir programme') }));

  const host = el('div', { class: 'choir-host' });
  host.innerHTML = MARKUP;
  container.append(host);

  setIo({ load: loadState, save: saveState });
  // choir-app.js binds to its own markup once; afterwards it only needs redrawing.
  if (!started) { Choir.init(); started = true; } else Choir.renderAll();
  if (route && route[1] === 'new') { const b = $('#btn-new-programme', host); if (b) b.click(); }
}

/** A backup file from the standalone Choir Programme Planner. */
export async function importStandalone(data) {
  if (!data || !Array.isArray(data.services)) throw new Error(t('Not a choir planner backup file'));
  if (data.settings) await saveChoir({ id: 'settings', kind: 'settings', settings: data.settings, currentId: data.currentId || null });
  if (data.hymnEdits) await saveChoir({ id: 'hymnEdits', kind: 'hymnEdits', hymnEdits: data.hymnEdits });
  let n = 0;
  for (const service of data.services) {
    if (!service || !service.id) continue;
    await saveChoir({ id: 'service:' + service.id, kind: 'service', service });
    n++;
  }
  written = new Map();
  started = false;        // the app is rebuilt from what has just arrived
  toast(t('{n} choir programmes added.', { n }));
  return { services: n };
}

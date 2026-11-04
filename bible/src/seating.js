/*
 * Seating & Communion: who sits where and who serves communion.
 *
 * The plan of a congregation's building is drawn from a layout
 * (seating-layouts.js); seats and the hatched serving stations are tapped to
 * put a minister in them, and the sheet that comes out is the A4 page a
 * congregation is used to (seating-pdf.js). The layout editor is
 * seating-editor.js.
 *
 * What is kept: the congregations' layouts, the saved plans and the roster of
 * ministers are rows in the `seating` store, so they travel with the sync and
 * the backup - a layout drawn on a PC is on the phone and on the rector's
 * devices without anyone sending a file. The plan being worked on is not one
 * of those rows: it stays on its own device until it is saved, so two people
 * are never editing each other's half-finished plan.
 *
 * #seating opens the tab, #seating/<id> opens a saved plan.
 */
import { el, clear, $, $$, toast, seg, sheet, confirmBox, download, copyText } from './ui.js';
import { state, saveSeating, deleteSeating, uid } from './store.js';
import { t, lang } from './i18n.js';
import { Layout } from './seating-layouts.js';
import { Editor } from './seating-editor.js';
import { PdfExport } from './seating-pdf.js';

const DRAFT_KEY = 'sb-seating-draft';
const RANKS = ['Ap', 'Bi', 'DE', 'DEv', 'Sh', 'Ev', 'Pr.', 'Dn', 'De'];
const DEFAULT_ROSTER = [
  ['Ap', '', '#FFFFFF'], ['De', '', '#FFD966'], ['Pr.', 'Coskey', '#FFD966'], ['Pr.', 'Swart', '#FFD966'],
  ['Pr.', 'Schlaphoff', '#A9D18E'], ['Pr.', 'Crerar', '#A9D18E'], ['Pr.', 'Liddle', '#A9D18E'],
  ['Pr.', 'Boniface', '#9DC3E6'], ['Pr.', 'Findlay', '#9DC3E6'], ['Pr.', 'Wentzel', '#9DC3E6'],
];
const ZOOMS = [100, 150, 200, 300];

let view = { section: 'seats', selected: null, zoom: 0 };
let draft = null;
let box = null;            // the tab's container, so a redraw can be asked for from anywhere

/* ------------------------------------------------------------- the rows */

const rows = kind => state.seating.filter(r => r.kind === kind);
const storedLayouts = () => rows('layout').map(r => r.layout).filter(Boolean);

function allLayouts() {
  const list = storedLayouts();
  for (const b of Layout.BUILTIN) if (!list.some(l => l.id === b.id)) list.push(b);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
function layoutById(id) {
  return storedLayouts().find(l => l.id === id) || Layout.BUILTIN.find(l => l.id === id) || null;
}
function layoutRow(id) { return rows('layout').find(r => r.layout && r.layout.id === id) || null; }

function roster() {
  const row = state.seating.find(r => r.id === 'roster');
  if (row && Array.isArray(row.roster)) return row.roster;
  return DEFAULT_ROSTER.map(r => ({ id: uid(), rank: r[0], name: r[1], color: r[2] }));
}
async function saveRoster(list) {
  await saveSeating({ id: 'roster', kind: 'roster', roster: list });
}
const personLabel = p => ((p.rank || '') + ' ' + (p.name || '')).trim();
function colorOf(name) {
  const p = roster().find(r => personLabel(r) === name);
  return p ? (p.color || '#FFFFFF') : null;
}

/* ------------------------------------------------------- the plan in hand */

function planContent(p) {
  return JSON.stringify({ l: p.layoutId, d: p.date, s: p.service, seats: p.seats, st: p.stations, c: p.cups, com: p.communion, n: p.note });
}
const isDirty = () => draft && planContent(draft) !== draft.savedHash;
function markSaved(p) { p.savedHash = planContent(p); }

function newPlan(layout) {
  const p = {
    layoutId: layout.id,
    date: new Date().toISOString().slice(0, 10),
    service: t('Divine Service'),
    seats: {},
    stations: Layout.blankStations(layout),
    cups: JSON.parse(JSON.stringify(layout.cups || { left: 0, right: 0 })),
    communion: { serves: [], pairs: [] },
    note: '',
    savedId: null,
  };
  markSaved(p);
  return p;
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* a full or blocked store: the plan still works, it is just not kept */ }
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { d = null; }
  if (d && d.savedHash != null && planContent(d) !== d.savedHash && layoutById(d.layoutId)) return d;   // work that was never saved
  const lay = (d && layoutById(d.layoutId)) || layoutById(localStorage.getItem('sb-seating-last') || '') || Layout.BUILTIN[0];
  return newPlan(lay);
}
const currentLayout = () => layoutById(draft.layoutId) || Layout.BUILTIN[0];

/** The layout to write into: a built-in one is copied on first edit, as its own row. */
async function editableLayout() {
  const lay = currentLayout();
  if (!lay.builtin) return lay;
  const copy = JSON.parse(JSON.stringify(lay));
  copy.builtin = false;
  await saveSeating({ id: 'layout:' + copy.id, kind: 'layout', layout: copy });
  return layoutById(copy.id);
}
const isForkedBuiltin = () => { const l = currentLayout(); return !l.builtin && Layout.BUILTIN.some(b => b.id === l.id); };

/* ------------------------------------------------------------- rendering */

function drawPlan() {
  const host = $('#plan', box);
  if (!host) return;
  host.innerHTML = Layout.render(currentLayout(), draft, {
    interactive: !Editor.active, selected: view.selected, idPrefix: 'sb',
    colorOf, edit: Editor.active, editSel: Editor.selected,
  });
  host.classList.toggle('editing', !!Editor.active);
  host.style.setProperty('--plan-zoom', ZOOMS[view.zoom] + '%');
}

/** What seating-editor.js is given: the few things it needs from the tab. */
const App = {
  current: () => draft,
  currentLayout,
  editableLayout: () => { const l = currentLayout(); if (!l.builtin) return l; editableLayout().then(() => redraw()); return l; },
  save: () => { const l = currentLayout(); if (!l.builtin) saveSeating({ id: 'layout:' + l.id, kind: 'layout', layout: l }); saveDraft(); },
  renderPlan: drawPlan,
  toast,
};

function redraw() { if (box) render(box, ['seating']); }

export function render(container, route) {
  box = container;
  clear(container);
  if (!draft) draft = loadDraft();
  if (route && route[1]) {
    const row = state.seating.find(r => r.id === 'plan:' + route[1] || r.id === route[1]);
    if (row && row.plan) { openPlan(row); history.replaceState(null, '', '#seating'); }
  }
  if (!layoutById(draft.layoutId)) draft.layoutId = allLayouts()[0].id;

  container.append(el('p', { class: 'eyebrow', text: t('Seating and communion') }));
  container.append(el('h2', { class: 'title', text: t('Who sits where, and who serves') }));

  /* --- the service --- */
  const layoutSel = el('select', { 'aria-label': t('Congregation'), onchange: e => switchLayout(e.target.value) },
    allLayouts().map(l => el('option', { value: l.id, text: l.name, selected: l.id === draft.layoutId ? '' : null })));
  const dateIn = el('input', { type: 'date', value: draft.date || '', oninput: e => { draft.date = e.target.value; saveDraft(); refreshSaveState(); } });
  const serviceIn = el('input', { type: 'text', value: draft.service || '', placeholder: t('e.g. Apostle service'), oninput: e => { draft.service = e.target.value; saveDraft(); refreshSaveState(); } });
  container.append(el('div', { class: 'fields three' }, [
    el('label', { class: 'f', text: t('Congregation') }, [layoutSel]),
    el('label', { class: 'f', text: t('Date') }, [dateIn]),
    el('label', { class: 'f', text: t('Service') }, [serviceIn]),
  ]));

  /* --- the plan --- */
  const planCard = el('div', { class: 'card seating-plan' });
  const zoomOut = el('button', { class: 'btn ghost small', type: 'button', 'aria-label': t('Zoom out'), text: '−', onclick: () => setZoom(view.zoom - 1) });
  const zoomIn = el('button', { class: 'btn ghost small', type: 'button', 'aria-label': t('Zoom in'), text: '+', onclick: () => setZoom(view.zoom + 1) });
  planCard.append(el('div', { class: 'row line plan-tools' }, [
    el('span', { class: 'muted small', text: t('Tap a seat or a station to fill it.') }),
    el('span', { class: 'row', style: 'margin:0;margin-left:auto' }, [zoomOut, zoomIn]),
  ]));
  const planWrap = el('div', { class: 'plan-wrap' }, [el('div', { id: 'plan', 'aria-label': t('Floor plan') })]);
  planWrap.addEventListener('click', onPlanClick);
  planWrap.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.hit')) { e.preventDefault(); onPlanClick(e); } });
  planCard.append(planWrap);
  const legend = el('div', { class: 'legend' });
  for (const s of currentLayout().sections || []) legend.append(el('span', { style: '--sw:' + s.color, text: s.name }));
  legend.append(el('span', { class: 'hatch', text: t('Serving station') }));
  planCard.append(legend);
  container.append(planCard);

  /* --- what to do with it --- */
  const saveBtn = el('button', { class: 'btn', type: 'button', id: 'seating-save', text: t('Save plan'), onclick: () => savePlan(false) });
  const pdfBtn = el('button', { class: 'btn ghost', type: 'button', text: t('Save PDF'), onclick: () => makePdf(false) });
  const actions = [saveBtn, pdfBtn];
  if (PdfExport.canShareFiles()) actions.push(el('button', { class: 'btn ghost', type: 'button', text: t('Share PDF'), onclick: () => makePdf(true) }));
  actions.push(el('button', { class: 'btn ghost', type: 'button', text: t('Print'), onclick: printSheet }));
  container.append(el('div', { class: 'row' }, actions));

  /* --- the sections --- */
  container.append(seg([['seats', 'Seats'], ['communion', 'Communion'], ['roster', 'Roster'], ['plans', 'Plans'], ['layout', 'Layout']],
    view.section, v => { view.section = v; drawSection(); }, { block: true, label: t('Seating sections') }));
  const panel = el('div', { id: 'seating-section' });
  container.append(panel);

  drawPlan();
  drawSection();
  refreshSaveState();
  Editor.init(App);
}

function setZoom(i) {
  view.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
  drawPlan();
}
function refreshSaveState() {
  const b = $('#seating-save', box);
  if (b) b.textContent = isDirty() ? t('Save plan') + ' •' : t('Save plan');
}

async function switchLayout(id) {
  const lay = layoutById(id);
  if (!lay) return;
  if (isDirty() && !(await confirmBox(t('This plan has changes that are not saved. Change congregation and lose them?'), t('Change')))) { redraw(); return; }
  draft = newPlan(lay);
  try { localStorage.setItem('sb-seating-last', id); } catch (e) { /* nothing worth failing for */ }
  view.selected = null; Editor.setActive(false); saveDraft(); redraw();
}

/* --------------------------------------------------------- the plan taps */

function seatOf(name) { return Object.keys(draft.seats).find(k => draft.seats[k] === name) || null; }

function assign(seatId, name) {
  name = (name || '').trim();
  if (!name) { delete draft.seats[seatId]; }
  else {
    const prev = seatOf(name);
    if (prev && prev !== seatId) { delete draft.seats[prev]; toast(t('{name} moved from seat {from} to seat {to}.', { name, from: prev, to: seatId })); }
    draft.seats[seatId] = name;
  }
  saveDraft(); drawPlan(); drawSection(); refreshSaveState();
}
function swapSeats(a, b) {
  const va = draft.seats[a], vb = draft.seats[b];
  if (vb) draft.seats[a] = vb; else delete draft.seats[a];
  if (va) draft.seats[b] = va; else delete draft.seats[b];
  saveDraft(); toast(t('Seats {a} and {b} swapped.', { a, b }));
}
function setStation(key, value) {
  const i = key.lastIndexOf('-'), g = key.slice(0, i), idx = parseInt(key.slice(i + 1), 10);
  draft.stations[g] = draft.stations[g] || [];
  draft.stations[g][idx] = value || '';
  saveDraft(); drawPlan(); drawSection(); refreshSaveState();
}

function onPlanClick(e) {
  if (Editor.active) return;
  const seat = e.target.closest('[data-seat]'), station = e.target.closest('[data-station]');
  if (seat) {
    const id = seat.getAttribute('data-seat');
    if (view.selected && view.selected.type === 'seat' && view.selected.id !== id) {
      swapSeats(view.selected.id, id); view.selected = null; drawPlan(); drawSection(); refreshSaveState(); return;
    }
    view.selected = { type: 'seat', id };
    drawPlan();
    seatSheet(id);
  } else if (station) {
    view.selected = { type: 'station', id: station.getAttribute('data-station') };
    drawPlan();
    stationSheet(view.selected.id);
  }
}

function seatSheet(id) {
  const s = sheet(t('Seat {id}', { id }), { onclose: () => { view.selected = null; drawPlan(); } });
  const name = draft.seats[id] || '';
  s.body.append(el('p', { class: 'muted', text: name ? name : t('Empty') }));
  const chips = el('div', { class: 'row chips' });
  for (const person of roster()) {
    const label = personLabel(person);
    if (!label) continue;
    const where = seatOf(label);
    chips.append(el('button', {
      class: 'chip seat-chip' + (where === id ? ' on' : ''), type: 'button',
      style: 'background:' + (person.color || '#fff') + ';color:' + (Layout.dark(person.color) ? '#fff' : '#111'),
      text: label + (where && where !== id ? ' (' + where + ')' : ''),
      onclick: () => { assign(id, label); s.close(); },
    }));
  }
  s.body.append(chips);
  const typed = el('input', { type: 'text', placeholder: t('Or type a name…'), 'aria-label': t('Name for this seat') });
  s.body.append(el('form', { class: 'row line', onsubmit: e => { e.preventDefault(); if (typed.value.trim()) { assign(id, typed.value); s.close(); } } },
    [typed, el('button', { class: 'btn', type: 'submit', text: t('Put in seat') })]));
  s.body.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn ghost', type: 'button', text: t('Clear seat'), onclick: () => { assign(id, ''); s.close(); } }),
    el('span', { class: 'muted small', text: t('Tap another seat on the plan to swap the two.') }),
  ]));
}

function stationSheet(key) {
  const i = key.lastIndexOf('-'), g = key.slice(0, i), idx = parseInt(key.slice(i + 1), 10);
  const group = (currentLayout().stationGroups || []).find(x => x.id === g);
  const s = sheet(t('Serving station'), { onclose: () => { view.selected = null; drawPlan(); } });
  const val = (draft.stations[g] || [])[idx] || '';
  s.body.append(el('p', { class: 'muted', text: (group ? group.label : g) + ' · ' + t('position {n}', { n: idx + 1 }) }));
  const chips = el('div', { class: 'row chips' });
  for (const sid of Layout.seatIds(currentLayout())) {
    const occ = draft.seats[sid];
    chips.append(el('button', {
      class: 'chip seat-chip num' + (val === sid ? ' on' : ''), type: 'button',
      style: occ ? 'background:' + colorOf(occ) + ';color:' + (Layout.dark(colorOf(occ)) ? '#fff' : '#111') : '',
      text: sid, title: occ || t('Seat {id}', { id: sid }),
      onclick: () => { setStation(key, sid); s.close(); },
    }));
  }
  s.body.append(chips);
  s.body.append(el('div', { class: 'row' }, [el('button', { class: 'btn ghost', type: 'button', text: t('Clear station'), onclick: () => { setStation(key, ''); s.close(); } })]));
}

/* ------------------------------------------------------------- sections */

function drawSection() {
  const panel = $('#seating-section', box);
  if (!panel) return;
  clear(panel);
  ({ seats: secSeats, communion: secCommunion, roster: secRoster, plans: secPlans, layout: secLayout })[view.section](panel);
}

function seatSelect(seatId) {
  const value = draft.seats[seatId] || '';
  const labels = roster().map(personLabel).filter(Boolean);
  if (value && !labels.includes(value)) labels.unshift(value);
  const sel = el('select', { 'aria-label': t('Seat {id}', { id: seatId }) }, [
    el('option', { value: '', text: '—', selected: value ? null : '' }),
    ...labels.map(l => el('option', { value: l, text: l, selected: l === value ? '' : null })),
  ]);
  if (value) sel.style.cssText = 'background:' + colorOf(value) + ';color:' + (Layout.dark(colorOf(value)) ? '#fff' : '#111');
  sel.addEventListener('change', () => assign(seatId, sel.value));
  return sel;
}

function secSeats(panel) {
  const ids = Layout.seatIds(currentLayout()), half = Math.ceil(ids.length / 2);
  const body = el('tbody');
  for (let i = 0; i < half; i++) {
    const a = ids[i], b = ids[i + half];
    body.append(el('tr', {}, [
      el('td', { class: 'num', text: a }), el('td', {}, [seatSelect(a)]),
      el('td', { class: 'num', text: b || '' }), el('td', {}, b ? [seatSelect(b)] : []),
    ]));
  }
  panel.append(el('div', { class: 'card' }, [el('table', { class: 'grid seating-grid' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: t('Minister') }), el('th', { text: '#' }), el('th', { text: t('Minister') })])]),
    body,
  ])]));
}

function numSelect(value, onchange, label) {
  const sel = el('select', { 'aria-label': label }, [
    el('option', { value: '', text: '—', selected: value ? null : '' }),
    ...Layout.seatIds(currentLayout()).map(id => el('option', { value: id, text: id + (draft.seats[id] ? ' · ' + draft.seats[id] : ''), selected: id === value ? '' : null })),
  ]);
  sel.addEventListener('change', () => { onchange(sel.value); saveDraft(); refreshSaveState(); drawSection(); });
  return sel;
}

function stepper(label, value, max, onDelta) {
  return el('span', { class: 'stepper', role: 'group', 'aria-label': label }, [
    el('span', { class: 'muted small', text: label }),
    el('button', { class: 'btn ghost small', type: 'button', text: '−', 'aria-label': t('Fewer') + ' ' + label, disabled: value <= 0 ? '' : null, onclick: () => onDelta(-1) }),
    el('output', { text: String(value) }),
    el('button', { class: 'btn ghost small', type: 'button', text: '+', 'aria-label': t('More') + ' ' + label, disabled: value >= max ? '' : null, onclick: () => onDelta(1) }),
  ]);
}

function secCommunion(panel) {
  const com = draft.communion;
  const serves = el('tbody');
  com.serves.forEach((s, i) => serves.append(el('tr', {}, [
    el('td', {}, [numSelect(s.seat, v => { s.seat = v; }, t('Serving seat'))]),
    el('td', {}, [el('input', { type: 'text', value: s.text || '', 'aria-label': t('What this seat serves'), onchange: e => { s.text = e.target.value; saveDraft(); refreshSaveState(); } })]),
    el('td', {}, [el('button', { class: 'icon', type: 'button', title: t('Remove row'), text: '×', onclick: () => { com.serves.splice(i, 1); saveDraft(); drawSection(); refreshSaveState(); } })]),
  ])));
  const pairs = el('tbody');
  com.pairs.forEach((p, i) => pairs.append(el('tr', {}, [
    el('td', {}, [numSelect(p[0], v => { p[0] = v; }, t('Takes the cup'))]),
    el('td', {}, [numSelect(p[1], v => { p[1] = v; }, t('Takes the inner cup'))]),
    el('td', {}, [el('button', { class: 'icon', type: 'button', title: t('Remove row'), text: '×', onclick: () => { com.pairs.splice(i, 1); saveDraft(); drawSection(); refreshSaveState(); } })]),
  ])));
  const card = el('div', { class: 'card' }, [
    el('table', { class: 'grid seating-grid' }, [el('thead', {}, [el('tr', {}, [el('th', { text: t('Seat') }), el('th', { text: t('Serves') }), el('th', {})])]), serves]),
    el('div', { class: 'row' }, [el('button', { class: 'btn ghost small', type: 'button', text: t('Add a serving row'), onclick: () => { com.serves.push({ seat: '', text: '' }); saveDraft(); drawSection(); } })]),
    el('table', { class: 'grid seating-grid', style: 'margin-top:10px' }, [el('thead', {}, [el('tr', {}, [el('th', { text: t('Takes the cup') }), el('th', { text: t('Takes the inner cup') }), el('th', {})])]), pairs]),
    el('div', { class: 'row' }, [el('button', { class: 'btn ghost small', type: 'button', text: t('Add a cup pair'), onclick: () => { com.pairs.push(['', '']); saveDraft(); drawSection(); } })]),
  ]);
  const stations = el('div', { class: 'row' });
  for (const g of currentLayout().stationGroups || []) {
    const arr = draft.stations[g.id] = draft.stations[g.id] || [];
    stations.append(stepper(g.label, arr.length, Layout.MAX_STATIONS, d => {
      if (d > 0) arr.push(''); else arr.pop();
      view.selected = null; saveDraft(); drawPlan(); drawSection(); refreshSaveState();
    }));
  }
  card.append(el('h3', { class: 'eyebrow', style: 'margin-top:14px', text: t('Serving stations on the plan') }), stations,
    el('div', { class: 'row' }, [el('button', { class: 'btn ghost small', type: 'button', text: t('Put the stations back as they usually are'), onclick: () => { draft.stations = Layout.defaultStations(currentLayout()); saveDraft(); drawPlan(); drawSection(); refreshSaveState(); } })]));
  const cups = el('div', { class: 'row' });
  draft.cups = draft.cups || { left: 0, right: 0 };
  for (const side of ['left', 'right']) {
    cups.append(stepper(side === 'left' ? t('Left of the altar') : t('Right of the altar'), draft.cups[side] || 0, Layout.MAX_CUPS, d => {
      draft.cups[side] = Layout.clamp((draft.cups[side] || 0) + d, 0, Layout.MAX_CUPS);
      saveDraft(); drawPlan(); drawSection(); refreshSaveState();
    }));
  }
  card.append(el('h3', { class: 'eyebrow', style: 'margin-top:14px', text: t('Cups on the altar') }), cups);
  panel.append(card);
}

function secRoster(panel) {
  const list = roster();
  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'muted small', text: t('Give each minister the colour of the section they serve. The colour follows them to their seat, to the station that carries their seat number, and onto the sheet.') }));
  const ul = el('ul', { class: 'seating-roster' });
  list.forEach((person, i) => {
    const rank = el('input', { type: 'text', class: 'rank', list: 'seating-ranks', value: person.rank || '', placeholder: t('Rank'), 'aria-label': t('Rank') });
    const name = el('input', { type: 'text', value: person.name || '', placeholder: t('Surname'), 'aria-label': t('Surname') });
    const update = async () => {
      const was = personLabel(person);
      person.rank = rank.value.trim(); person.name = name.value.trim();
      const now = personLabel(person), seat = was && seatOf(was);
      if (seat && now !== was) { draft.seats[seat] = now; saveDraft(); }
      await saveRoster(list); drawPlan(); drawSection();
    };
    rank.addEventListener('change', update); name.addEventListener('change', update);
    const swatches = el('span', { class: 'swatches' });
    for (const s of [{ name: t('None'), color: '#FFFFFF' }, ...(currentLayout().sections || [])]) {
      swatches.append(el('button', {
        class: 'swatch' + ((person.color || '#FFFFFF').toUpperCase() === s.color.toUpperCase() ? ' on' : ''),
        type: 'button', style: 'background:' + s.color, title: s.name, 'aria-label': s.name,
        onclick: async () => { person.color = s.color; await saveRoster(list); drawPlan(); drawSection(); },
      }));
    }
    const custom = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(person.color || '') ? person.color : '#ffffff', 'aria-label': t('Another colour') });
    custom.addEventListener('change', async () => { person.color = custom.value; await saveRoster(list); drawPlan(); drawSection(); });
    swatches.append(custom);
    ul.append(el('li', {}, [rank, name, swatches,
      el('button', { class: 'icon', type: 'button', title: t('Take off the roster'), text: '×', onclick: async () => { list.splice(i, 1); await saveRoster(list); drawPlan(); drawSection(); } })]));
  });
  card.append(ul);
  const newRank = el('input', { type: 'text', class: 'rank', list: 'seating-ranks', placeholder: t('Rank'), 'aria-label': t('Rank') });
  const newName = el('input', { type: 'text', placeholder: t('Surname'), 'aria-label': t('Surname') });
  card.append(el('form', { class: 'row line', onsubmit: async e => {
    e.preventDefault();
    if (!newRank.value.trim() && !newName.value.trim()) return;
    list.push({ id: uid(), rank: newRank.value.trim(), name: newName.value.trim(), color: '#FFFFFF' });
    await saveRoster(list); drawSection();
  } }, [newRank, newName, el('button', { class: 'btn', type: 'submit', text: t('Add') })]));
  card.append(el('datalist', { id: 'seating-ranks' }, RANKS.map(r => el('option', { value: r }))));
  panel.append(card);
}

/* ----------------------------------------------------------- saved plans */

const planTitle = row => [row.plan.date, row.plan.service, (layoutById(row.plan.layoutId) || {}).name].filter(Boolean).join(' · ');

function openPlan(row) {
  draft = JSON.parse(JSON.stringify(row.plan));
  draft.savedId = row.id;
  markSaved(draft);
  view.selected = null; Editor.setActive(false); saveDraft();
}

async function savePlan(asNew) {
  const copy = JSON.parse(JSON.stringify(draft));
  delete copy.savedHash; delete copy.savedId;
  const existing = !asNew && draft.savedId ? state.seating.find(r => r.id === draft.savedId) : null;
  const id = existing ? existing.id : 'plan:' + uid();
  await saveSeating({ id, kind: 'plan', plan: copy });
  draft.savedId = id; markSaved(draft); saveDraft(); refreshSaveState(); drawSection();
  toast(t('Plan saved.'));
}

function secPlans(panel) {
  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'muted small', text: t('A plan is kept only once you save it, and saved plans are on every device you sync with.') }));
  card.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn', type: 'button', text: t('Save as a new plan'), onclick: () => savePlan(true) }),
    el('button', { class: 'btn ghost', type: 'button', text: t('Start an empty plan'), onclick: async () => {
      if (isDirty() && !(await confirmBox(t('This plan has changes that are not saved. Start an empty one and lose them?'), t('Start empty')))) return;
      draft = newPlan(currentLayout()); view.selected = null; saveDraft(); redraw();
    } }),
  ]));
  const saved = rows('plan').filter(r => r.plan).sort((a, b) => (b.plan.date || '').localeCompare(a.plan.date || ''));
  card.append(el('h3', { class: 'eyebrow', style: 'margin-top:14px', text: t('Saved plans') }));
  if (!saved.length) card.append(el('p', { class: 'muted', text: t('No plans saved yet.') }));
  const ul = el('ul', { class: 'seating-plans' });
  for (const row of saved) {
    ul.append(el('li', {}, [
      el('button', { class: 'btn ghost small', type: 'button', text: planTitle(row), onclick: async () => {
        if (isDirty() && !(await confirmBox(t('This plan has changes that are not saved. Open "{name}" and lose them?', { name: planTitle(row) }), t('Open')))) return;
        openPlan(row); redraw(); toast(t('Opened {name}.', { name: planTitle(row) }));
      } }),
      el('button', { class: 'icon', type: 'button', title: t('Delete this saved plan'), text: '×', onclick: async () => {
        if (!(await confirmBox(t('Delete the saved plan "{name}"?', { name: planTitle(row) }), t('Delete'), true))) return;
        await deleteSeating(row.id);
        if (draft.savedId === row.id) draft.savedId = null;
        drawSection(); toast(t('Saved plan deleted.'));
      } }),
    ]));
  }
  card.append(ul);
  panel.append(card);
}

/* --------------------------------------------------------- the layouts */

function secLayout(panel) {
  const lay = currentLayout();
  const card = el('div', { class: 'card' });
  const nameIn = el('input', { type: 'text', value: lay.name, disabled: lay.builtin ? '' : null, 'aria-label': t('Name of this layout') });
  nameIn.addEventListener('change', async () => {
    if (lay.builtin) return;
    lay.name = nameIn.value.trim() || lay.name;
    await saveSeating({ id: 'layout:' + lay.id, kind: 'layout', layout: lay });
    redraw();
  });
  card.append(el('label', { class: 'f', text: t('Name of this layout') }, [nameIn]));

  const buttons = [
    el('button', { class: 'btn' + (Editor.active ? '' : ' ghost'), type: 'button', text: Editor.active ? t('Finished editing') : t('Edit this layout'), onclick: async () => {
      const on = !Editor.active;
      if (on) { await editableLayout(); view.selected = null; }
      Editor.setActive(on); redraw();
      if (on) toast(t('Drag the pieces on the plan. Tap one to change it.'));
    } }),
    el('button', { class: 'btn ghost', type: 'button', text: t('New layout from this one'), onclick: async () => {
      const name = prompt(t('Name of the congregation for the new layout:'), '');
      if (!name) return;
      const copy = JSON.parse(JSON.stringify(lay));
      copy.id = uid(); copy.name = name.trim(); copy.builtin = false;
      await saveSeating({ id: 'layout:' + copy.id, kind: 'layout', layout: copy });
      await switchLayout(copy.id);
    } }),
  ];
  if (!lay.builtin) buttons.push(el('button', { class: 'btn ghost danger', type: 'button', text: t('Delete this layout'), onclick: async () => {
    if (!(await confirmBox(t('Delete the layout "{name}"?', { name: lay.name }), t('Delete'), true))) return;
    const row = layoutRow(lay.id);
    if (row) await deleteSeating(row.id);
    await switchLayout(allLayouts()[0].id);
  } }));
  if (isForkedBuiltin()) buttons.push(el('button', { class: 'btn ghost', type: 'button', text: t('Put the built-in version back'), onclick: async () => {
    if (!(await confirmBox(t('Put the built-in "{name}" back? Your own changes to it are lost.', { name: lay.name }), t('Put it back')))) return;
    const row = layoutRow(lay.id);
    if (row) await deleteSeating(row.id);
    Editor.setActive(false); await switchLayout(lay.id); toast(t('The built-in layout is back.'));
  } }));
  card.append(el('div', { class: 'row' }, buttons));

  const file = el('input', { type: 'file', accept: 'application/json,.json,image/*', hidden: '' });
  file.addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importLayoutFile(f); });
  card.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn ghost', type: 'button', text: t('Save this layout to a file'), onclick: () => {
      const copy = JSON.parse(JSON.stringify(lay)); delete copy.builtin;
      download(new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' }), 'layout-' + lay.name.replace(/[^A-Za-z0-9]+/g, '_') + '.json');
    } }),
    el('button', { class: 'btn ghost', type: 'button', text: t('Open a layout file or a picture'), onclick: () => file.click() }),
    file,
  ]));
  card.append(el('p', { class: 'muted small', text: t('Layouts are on every device you sync with, so another congregation only needs a file if they do not share your sync.') }));

  card.append(el('h3', { class: 'eyebrow', style: 'margin-top:14px', text: t('The sections that are served, and their colours') }));
  const ul = el('ul', { class: 'seating-sections' });
  (lay.sections || []).forEach((s, i) => {
    const colour = el('input', { type: 'color', value: s.color, 'aria-label': t('Colour of this section') });
    const name = el('input', { type: 'text', value: s.name, 'aria-label': t('Name of this section') });
    const save = async () => {
      const e = await editableLayout();
      e.sections[i].name = name.value; e.sections[i].color = colour.value;
      await saveSeating({ id: 'layout:' + e.id, kind: 'layout', layout: e });
      redraw();
    };
    name.addEventListener('change', save); colour.addEventListener('change', save);
    ul.append(el('li', {}, [colour, name, el('button', { class: 'icon', type: 'button', title: t('Remove this section'), text: '×', onclick: async () => {
      const e = await editableLayout(); e.sections.splice(i, 1);
      await saveSeating({ id: 'layout:' + e.id, kind: 'layout', layout: e }); redraw();
    } })]));
  });
  card.append(ul);
  card.append(el('div', { class: 'row' }, [el('button', { class: 'btn ghost small', type: 'button', text: t('Add a section'), onclick: async () => {
    const e = await editableLayout(); e.sections.push({ name: t('New section'), color: '#E0E0E0' });
    await saveSeating({ id: 'layout:' + e.id, kind: 'layout', layout: e }); redraw();
  } })]));
  card.append(el('div', { id: 'editor' }));
  panel.append(card);
  Editor.render();
}

const validLayout = l => l && typeof l.name === 'string' && Array.isArray(l.blocks) && Array.isArray(l.seats) && Array.isArray(l.stationGroups) && l.altar && l.altar.inner;

function importLayoutFile(file) {
  if (/^image\//.test(file.type)) {
    const name = prompt(t('Name of the congregation for this picture:'), file.name.replace(/\.[^.]+$/, ''));
    if (!name) return;
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = async () => {
      const scale = Math.min(1, 1400 / img.width, 1100 / img.height), c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const lay = Layout.blankLayout(name.trim());
      lay.id = uid();
      lay.background = { dataUrl: c.toDataURL('image/jpeg', 0.8), opacity: 0.5, show: true };
      await saveSeating({ id: 'layout:' + lay.id, kind: 'layout', layout: lay });
      await switchLayout(lay.id);
      view.section = 'layout';
      Editor.setActive(true); redraw();
      toast(t('The picture is behind the plan to trace over. Drag the altar into place, then add the blocks, seats and stations.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast(t('That picture could not be read.'), true); };
    img.src = url;
    return;
  }
  const r = new FileReader();
  r.onload = async () => {
    let lay = null;
    try { lay = JSON.parse(r.result); } catch (e) { lay = null; }
    if (!validLayout(lay)) { toast(t('That file is not a layout.'), true); return; }
    lay.id = uid(); lay.builtin = false;
    await saveSeating({ id: 'layout:' + lay.id, kind: 'layout', layout: lay });
    await switchLayout(lay.id);
    toast(t('Layout "{name}" added.', { name: lay.name }));
  };
  r.readAsText(file);
}

/* ------------------------------------------------------------- the sheet */

async function makePdf(share) {
  try {
    if (share) {
      const how = await PdfExport.share(currentLayout(), draft, colorOf);
      if (how === 'shared') toast(t('Sent.'));
      else if (how === 'downloaded') toast(t('Sharing is not available here, so the PDF was saved instead.'));
      return;
    }
    const r = await PdfExport.createPdf(currentLayout(), draft, colorOf);
    download(r.blob, r.name);
    toast(t('PDF saved: {name}', { name: r.name }));
  } catch (e) {
    toast(t('The PDF could not be made: {error}', { error: e.message || e }), true);
  }
}

function printSheet() {
  const host = $('#seating-print') || el('div', { id: 'seating-print' });
  if (!host.parentNode) document.body.append(host);
  host.innerHTML = PdfExport.buildPageSvg(currentLayout(), draft, colorOf);
  document.body.classList.add('printing-seating');
  const after = () => { document.body.classList.remove('printing-seating'); window.removeEventListener('afterprint', after); };
  window.addEventListener('afterprint', after);
  window.print();
}

/** A backup file from the standalone Seating & Communion Planner. */
export async function importStandalone(data) {
  if (!data || !Array.isArray(data.plans) || !Array.isArray(data.roster)) throw new Error(t('Not a seating planner backup file'));
  let layouts = 0, plans = 0;
  for (const lay of data.layouts || []) {
    if (!validLayout(lay)) continue;
    if (!lay.id) lay.id = uid();
    lay.builtin = false;
    await saveSeating({ id: 'layout:' + lay.id, kind: 'layout', layout: lay });
    layouts++;
  }
  for (const p of data.plans) {
    if (!p || !p.layoutId) continue;
    const copy = { ...p };
    delete copy.savedHash; delete copy.savedId; delete copy.id;
    await saveSeating({ id: 'plan:' + uid(), kind: 'plan', plan: copy });
    plans++;
  }
  if (data.roster.length) await saveRoster(data.roster.map(r => ({ id: r.id || uid(), rank: r.rank || '', name: r.name || '', color: r.color || '#FFFFFF' })));
  return { layouts, plans, roster: data.roster.length };
}

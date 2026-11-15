/*
 * The month plan: the district's programme with who holds each service.
 *
 * Every month the district sends its programme as an Excel sheet. The rector
 * opens it here; the app reads the month, the days and the ministers
 * (plan-lib.js, through the sheet's own XML: plan-xlsx.js) and lists the
 * congregation's service days, every Sunday and Wednesday and any other day
 * the sheet marks. For each he picks who holds it: himself, one of his
 * priests, the District Rector or the Apostle when the sheet puts them in
 * the congregation that day, or a name typed in. Then "Send to the priests"
 * gives the district's own file with his column filled in, the month as a
 * one-page programme (plan-pdf.js), or a WhatsApp message; and the plan can
 * go to Google Calendar as a feed the calendar follows (api/plan.js), so a
 * change here shows there on its own.
 *
 * What is kept: one row per month ('plan:2025-10') in the `plans` store, with
 * the sheet as read, the rector's choices and the file itself (so the file
 * can be written on any of his devices), and one row of the tab's settings
 * ('settings': the congregation, his code in the ministers' list, the names
 * of his priests as he wants them shown, with any he added or took off, the
 * service times, which events go to the calendar, and the feed's key). A
 * month also keeps his own events (a service at another congregation). They travel with the sync and the
 * backup. #plan opens the latest month, #plan/2025-10 one month.
 */
import { el, clear, toast, sheet, confirmBox, download, copyText, seg } from './ui.js';
import { state, savePlan, deletePlan } from './store.js';
import { t, tn, lang, locale } from './i18n.js';
import * as X from './plan-xlsx.js';
import * as L from './plan-lib.js';
import * as Pdf from './pdf.js';
import { programmePdf } from './plan-pdf.js';

const DEFAULTS = { congregation: '', myCode: '', roster: [], hidden: [], sundayTime: '09:00', midweekTime: '19:30', eventDefaults: 'all', calKey: '', calId: '', calOn: false, calAt: '' };
const EVENT_CHOICES = [['services', 'Services only'], ['district', 'Services and district events'], ['all', 'Also meetings and deadlines'], ['none', 'Nothing until I tick it']];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let box = null;       // the tab's container, for a redraw from anywhere
let current = '';     // the id of the month on the screen
let feedTimer = 0;    // the feed is sent a moment after the last change

/* ------------------------------------------------------------------ rows */

const months = () => state.plans.filter(r => r.kind === 'plan' && r.parsed).sort((a, b) => b.id.localeCompare(a.id));

/** The tab's settings. The congregation falls back to the app's own "You" setting. */
function settings() {
  const row = state.plans.find(r => r.id === 'settings');
  const s = { ...DEFAULTS, ...((row && row.settings) || {}) };
  if (!s.congregation) s.congregation = state.settings.congregation || '';
  return s;
}
async function saveSettings(patch) {
  const row = state.plans.find(r => r.id === 'settings');
  await savePlan({ id: 'settings', kind: 'settings', settings: { ...((row && row.settings) || {}), ...patch } });
}

/** The plan of a month as plan-lib wants it: the sheet as read plus the rector's choices. */
const planOf = row => ({ ...row.parsed, month: row.month, year: row.year, services: row.services || {}, events: row.events || {}, extraDays: row.extraDays || [], own: row.own || [] });

function compute(row) {
  const s = settings();
  const plan = planOf(row);
  const services = L.serviceDays(plan, s);
  const list = L.events(plan, s, services);
  return { plan, services, list, settings: s };
}

async function saveChoice(row, date, patch) {
  row.services = { ...(row.services || {}), [date]: { ...((row.services || {})[date] || {}), ...patch } };
  await savePlan(row);
  queueFeed();
}

/* ------------------------------------------------------------------ bytes */

function toBase64(bytes) {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function newKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
}
async function idOf(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** Hands a file to the phone's share sheet (WhatsApp is there), or downloads it on a PC. */
async function shareOrSave(blob, name, type) {
  try {
    const file = new File([blob], name, { type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
  } catch (e) { /* no File or no share here: saved instead */ }
  download(blob, name);
  return 'saved';
}

/* --------------------------------------------------------------- the file */

/** Reads the district's sheet into a plan row and keeps it; an open month that is loaded again keeps the rector's choices. */
async function openFile(file) {
  if (!X.supported()) throw new Error(t('This browser cannot open the file. Update it, or open the app in Chrome.'));
  const bytes = new Uint8Array(await file.arrayBuffer());
  let wb;
  try { wb = await X.openWorkbook(bytes); }
  catch (e) { throw new Error(t('{file} could not be read as an Excel file (.xlsx).', { file: file.name })); }
  const s = settings();
  const congregation = s.congregation || '';
  let parsed = null, sheetPath = '';
  const order = [...wb.sheets.filter(x => x.state === 'visible'), ...wb.sheets.filter(x => x.state !== 'visible')];
  for (const sh of order) {
    const grid = X.toGrid(await X.readSheet(wb, sh));
    const p = L.parseProgramme(grid, { congregation, fileName: file.name });
    if (p.days.length) { parsed = p; sheetPath = sh.path; break; }
    if (!parsed) parsed = p;
  }
  if (!parsed || !parsed.days.length) throw new Error((parsed && parsed.problems[0]) || t('No days were found in this sheet.'));
  const myCode = s.myCode || L.guessMyCode(parsed);
  const roster = L.mergeRoster(s.roster, parsed, myCode, s.hidden);
  await saveSettings({ myCode, roster, congregation });
  const id = `plan:${parsed.year}-${L.pad(parsed.month)}`;
  const have = state.plans.find(r => r.id === id);
  const { title, month, year, headerRows, columns, days, ministers, notes, problems, first, last } = parsed;
  const row = {
    id, kind: 'plan', month, year, title, fileName: file.name, sheetPath, file: toBase64(bytes),
    parsed: { headerRows, columns, days, ministers, notes, problems, first, last },
    services: have ? have.services || {} : {}, events: have ? have.events || {} : {}, extraDays: have ? have.extraDays || [] : [], own: have ? have.own || [] : [],
  };
  await savePlan(row);
  current = id;
  queueFeed();
  return row;
}

/** The district's file with the congregation's column written in: the code of who holds each service, nothing on a day with no service. */
async function excelFile(row) {
  const { plan, services } = compute(row);
  const values = {};
  for (const s of services) {
    const day = plan.days.find(d => d.date === s.date);
    if (!day) continue;
    values[day.rows[0]] = s.off ? '' : s.who;
  }
  const bytes = fromBase64(row.file);
  const cols = plan.columns;
  const opts = { sheetPath: row.sheetPath, values };
  if (cols.mine) opts.col = cols.mine;
  else {
    opts.insertAt = cols.comments || cols.ministries || Math.max(cols.date, ...cols.leaders.map(l => l.col), cols.cross || 0) + 1;
    opts.header = (settings().congregation || t('Congregation')).toUpperCase();
    opts.headerRows = plan.headerRows;
  }
  const out = await X.writeColumn(bytes, opts);
  const base = (row.fileName || 'programme.xlsx').replace(/\.xlsx$/i, '');
  const cong = settings().congregation;
  const name = cong && !base.toLowerCase().includes(cong.toLowerCase()) ? `${base} - ${cong}.xlsx` : `${base}.xlsx`;
  return { blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name };
}

/* --------------------------------------------------------------- the feed */

export function feedUrl() {
  const s = settings();
  return s.calId ? new URL('api/plan?id=' + s.calId, location.href.split('#')[0]).href : '';
}

/** Builds the feed from every month and sends it; says so only when it fails. */
export async function sendFeed({ loud = false } = {}) {
  const s = settings();
  if (!s.calOn || !s.calKey || !s.calId) return false;
  const all = months().map(row => ({ events: compute(row).list }));
  const body = L.buildFeed(all, { name: s.congregation || t('Month plan') });
  try {
    const r = await fetch('api/plan?id=' + s.calId, { method: 'PUT', headers: { 'X-Plan-Key': s.calKey, 'Content-Type': 'text/calendar; charset=utf-8' }, body });
    if (r.status === 503) throw new Error(t('The calendar feed is not switched on on the server yet.'));
    if (!r.ok) throw new Error(t('The feed could not be sent ({status}).', { status: r.status }));
    await saveSettings({ calAt: new Date().toISOString() });
    if (loud) toast(t('Sent. Google Calendar picks it up within about a day.'));
    return true;
  } catch (e) {
    if (loud || navigator.onLine) toast(e.message || t('The feed could not be sent.'), true);
    return false;
  }
}

function queueFeed() {
  if (!settings().calOn) return;
  clearTimeout(feedTimer);
  feedTimer = setTimeout(() => sendFeed(), 2500);
}

async function startFeed() {
  const s = settings();
  const calKey = s.calKey || newKey();
  const calId = await idOf(calKey);
  await saveSettings({ calKey, calId, calOn: true });
  const ok = await sendFeed({ loud: true });
  if (!ok) { await saveSettings({ calOn: false }); return false; }
  return true;
}

async function stopFeed() {
  const s = settings();
  if (s.calId && s.calKey) {
    try { await fetch('api/plan?id=' + s.calId, { method: 'DELETE', headers: { 'X-Plan-Key': s.calKey } }); } catch (e) { /* offline: the feed stays on the server until the next try */ }
  }
  await saveSettings({ calOn: false, calAt: '' });
}

/* ------------------------------------------------------------- the screen */

function section(title, children, attrs = {}) {
  return el('section', { class: 'sec' + (attrs.class ? ' ' + attrs.class : '') }, [el('div', { class: 'docbar' }, [el('h2', { text: title }), ...(attrs.actions || [])]), ...children]);
}

const field = (label, control, hint) => el('label', { class: 'f' }, [label, control, hint ? el('span', { class: 'hint muted small', text: hint }) : null]);

export function render(container, route) {
  box = container;
  const sub = route && route[1];
  const all = months();
  if (sub && /^\d{4}-\d{2}$/.test(sub)) current = 'plan:' + sub;
  if (!all.some(r => r.id === current)) current = all.length ? all[0].id : '';
  const row = all.find(r => r.id === current) || null;
  clear(container);
  const s = settings();
  container.append(el('p', { class: 'eyebrow', text: t('Month plan') }));
  container.append(el('h2', { class: 'title', text: row ? `${s.congregation || t('Congregation')} – ${L.monthLabel(row.month, row.year, lang())}` : t('Month plan') }));
  const bar = el('div', { class: 'row plan-bar' });
  if (all.length > 1) bar.append(seg(all.map(r => [r.id, L.monthLabel(r.month, r.year, lang())]), current, id => { location.hash = '#plan/' + id.slice(5); }, { label: t('Month') }));
  bar.append(el('span', { class: 'spacer' }), el('button', { class: 'btn small ghost', type: 'button', text: t('Settings'), onclick: () => settingsSheet(row) }));
  if (all.length) container.append(bar);
  if (!row) { container.append(openCard(true)); return; }
  const c = compute(row);
  if (c.plan.problems.length) container.append(el('p', { class: 'hint error', text: c.plan.problems.join(' ') }));
  container.append(servicesCard(row, c), eventsCard(row, c), sendCard(row, c), calendarCard(row, c), notesCard(row, c), openCard(false));
}

/* ---- opening the file */

function openCard(first) {
  const s = settings();
  const file = el('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
  const cong = el('input', { type: 'text', value: s.congregation, placeholder: t('Gezina'), autocomplete: 'off' });
  cong.addEventListener('change', () => saveSettings({ congregation: cong.value.trim() }));
  const note = el('p', { class: 'small', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    if (!cong.value.trim()) { toast(t('Type the name of your congregation first: it names your column in the sheet.'), true); cong.focus(); return; }
    await saveSettings({ congregation: cong.value.trim() });
    note.hidden = false; note.textContent = t('Reading {file}…', { file: f.name });
    try {
      const row = await openFile(f);
      const { services } = compute(row);
      toast(tn(services.length, '{month} read: {n} service day.', '{month} read: {n} service days.', { month: L.monthLabel(row.month, row.year, lang()) }));
      location.hash = '#plan/' + row.id.slice(5);
      render(box, ['plan', row.id.slice(5)]);
    } catch (e) { note.textContent = e.message || t('That file could not be read.'); note.classList.add('error'); }
  });
  return section(first ? t('Open this month\'s file') : t('Next month'), [
    el('p', { class: 'small', text: first
      ? t('Open the district\'s programme for the month (the Excel file you get every month). The app reads the days and the ministers on your device; the file goes nowhere.')
      : t('When the next programme comes, open it here. A month that is already here is read again and keeps your choices.') }),
    first || !s.congregation ? field(t('Your congregation'), cong, t('The heading of your column in the sheet, as the district writes it.')) : null,
    el('div', { class: 'row' }, [el('button', { class: 'btn' + (first ? '' : ' ghost'), type: 'button', text: t('Choose the Excel file'), onclick: () => file.click() }), file]),
    note,
  ]);
}

/* ---- the services */

function servicesCard(row, c) {
  const list = el('div', { class: 'list plan-list' });
  for (const s of c.services) {
    const who = L.whoLabel(s.who, c.plan, c.settings);
    const notes = [...s.notes, s.note].filter(Boolean);
    const state_ = s.off ? el('span', { class: 'pill status held', text: t('No service') })
      : who ? el('span', { class: 'pill status ready', text: who })
        : el('span', { class: 'pill warn', text: t('Choose who') });
    list.append(el('button', { class: 'item plan-row' + (s.off ? ' off' : ''), type: 'button', onclick: () => rowSheet(row, s.date) }, [
      el('span', { class: 'plan-when' }, [
        el('b', { text: L.shortDate(s.date, locale()) }),
        el('span', { class: 'muted small', text: s.off ? L.serviceName(s) : `${L.serviceName(s)} · ${s.time}` }),
      ]),
      el('span', { class: 'grow plan-what' }, [
        state_,
        s.movedFrom ? el('span', { class: 'small muted plan-note', text: t('The Wednesday service, moved from {day}', { day: L.shortDate(s.movedFrom, locale()) }) }) : null,
        s.visiting.length && !s.off ? el('span', { class: 'small muted plan-note', text: t('{who} at {congregation}', { who: s.visiting.map(v => v.label).join(', '), congregation: c.settings.congregation }) }) : null,
        ...notes.map(n => el('span', { class: 'small muted plan-note', text: n })),
      ]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
    ]));
  }
  const open = c.services.filter(s => !s.off && !s.who).length;
  const add = el('button', { class: 'btn small ghost', type: 'button', text: t('Add a day'), onclick: () => addDaySheet(row, c) });
  return section(t('Services'), [
    el('p', { class: 'small', text: open
      ? tn(open, 'Tap a service to say who holds it. {n} still has nobody.', 'Tap a service to say who holds it. {n} still have nobody.')
      : t('Tap a service to change who holds it, its time, or to mark a day without a service.') }),
    list,
  ], { actions: [add] });
}

function rowSheet(row, date) {
  const c = compute(row);
  const s = c.services.find(x => x.date === date);
  if (!s) return;
  const sh = sheet(`${L.shortDate(date, locale())} · ${L.serviceName(s)}`);
  const choice = () => (row.services || {})[date] || {};
  // who: the rector's own people, the leader the sheet puts here today, or a name typed in
  const chips = el('div', { class: 'row chips plan-chips' });
  const other = el('input', { type: 'text', placeholder: t('Name, as the priests should see it'), value: '', autocomplete: 'off', hidden: true });
  const options = [...c.settings.roster.map(r => [r.code, r.label || L.ministerLabel(r)])];
  for (const v of s.visiting) if (v.code && !options.some(o => o[0].toUpperCase() === v.code.toUpperCase())) options.push([v.code, `${v.label} (${t('visiting')})`]);
  const known = options.some(o => o[0].toUpperCase() === (s.who || '').toUpperCase());
  const draw = () => {
    clear(chips);
    const who = (choice().who ?? s.auto.who) || '';
    for (const [code, label] of options) chips.append(el('button', { type: 'button', class: 'chip' + (who.toUpperCase() === code.toUpperCase() ? ' on' : ''), text: label, onclick: async () => { other.hidden = true; await saveChoice(row, date, { who: code }); draw(); redraw(); } }));
    const typed = who && !options.some(o => o[0].toUpperCase() === who.toUpperCase());
    chips.append(el('button', { type: 'button', class: 'chip' + (typed || !other.hidden ? ' on' : ''), text: typed ? who : t('Someone else'), onclick: () => { other.hidden = false; other.value = typed ? who : ''; other.focus(); } }));
    chips.append(el('button', { type: 'button', class: 'chip' + (!who ? ' on' : ''), text: t('Nobody yet'), onclick: async () => { other.hidden = true; await saveChoice(row, date, { who: '' }); draw(); redraw(); } }));
  };
  other.addEventListener('change', async () => { await saveChoice(row, date, { who: other.value.trim() }); draw(); redraw(); });
  if (!known && s.who) { other.hidden = false; other.value = s.who; }
  draw();
  const time = el('input', { type: 'time', value: s.time });
  time.addEventListener('change', async () => { await saveChoice(row, date, { time: time.value }); redraw(); });
  const off = el('input', { type: 'checkbox', id: 'plan-off' }); off.checked = s.off;
  off.addEventListener('change', async () => { await saveChoice(row, date, { off: off.checked }); redraw(); });
  const note = el('textarea', { rows: '2', placeholder: t('A line for the priests about this day (optional)') });
  note.value = s.note;
  note.addEventListener('change', async () => { await saveChoice(row, date, { note: note.value.trim() }); redraw(); });
  sh.body.append(...[
    s.notes.length ? el('div', { class: 'plan-sheet-notes' }, [el('p', { class: 'eyebrow', text: t('The district says') }), ...s.notes.map(n => el('p', { class: 'small', text: n }))]) : null,
    s.visiting.length ? el('p', { class: 'small', text: t('{who} at {congregation}', { who: s.visiting.map(v => v.label).join(', '), congregation: c.settings.congregation }) }) : null,
    el('h3', { class: 'sub', text: t('Who holds it') }),
    chips,
    other,
    el('div', { class: 'fields two' }, [field(t('Time'), time)]),
    el('label', { class: 'check', for: 'plan-off' }, [off, ' ', t('No service on this day')]),
    field(t('Note'), note),
    el('div', { class: 'row end' }, [el('button', { class: 'btn', type: 'button', text: t('Done'), onclick: () => sh.close() })]),
  ].filter(Boolean));
}

function addDaySheet(row, c) {
  const sh = sheet(t('Add a day'));
  const date = el('input', { type: 'date', min: c.plan.first, max: c.plan.last, value: '' });
  sh.body.append(
    el('p', { class: 'small', text: t('A service on another day than a Sunday or a Wednesday, for instance when a holiday moves it.') }),
    field(t('Date'), date),
    el('div', { class: 'row end' }, [el('button', { class: 'btn', type: 'button', text: t('Add'), onclick: async () => {
      const d = date.value;
      if (!d) return;
      if (!c.plan.days.some(x => x.date === d)) { toast(t('That day is not in this month\'s sheet.'), true); return; }
      if (!(row.extraDays || []).includes(d)) row.extraDays = [...(row.extraDays || []), d];
      row.services = { ...(row.services || {}), [d]: { ...((row.services || {})[d] || {}), off: false } };
      await savePlan(row);
      queueFeed();
      sh.close();
      redraw();
      rowSheet(row, d);
    } })]),
  );
}

/* ---- the events for the calendar */

function eventsCard(row, c) {
  const list = el('div', { class: 'list plan-list' });
  const KIND = { service: t('Service'), district: t('District'), meeting: t('Meeting'), admin: t('Deadline'), own: t('Own') };
  for (const e of c.list) {
    const id = 'ev-' + e.id.replace(/[^a-z0-9]+/gi, '-');
    const tick = el('input', { type: 'checkbox', id });
    tick.checked = e.on;
    tick.addEventListener('change', async () => {
      row.events = { ...(row.events || {}), [e.id]: tick.checked };
      await savePlan(row);
      queueFeed();
    });
    const when = el('span', { class: 'plan-when' }, [el('b', { text: L.shortDate(e.date, locale()) }), el('span', { class: 'muted small', text: e.start ? e.start + (e.end ? '–' + e.end : '') : e.lastDay ? t('to {date}', { date: L.shortDate(e.lastDay, locale()) }) : t('all day') })]);
    const what = el('span', { class: 'grow' }, [el('span', { text: e.title }), ' ', el('span', { class: 'pill kind ' + e.kind, text: KIND[e.kind] })]);
    if (e.kind === 'own') {
      // the rector's own event: its tick as on the other rows, and a button to change or remove it
      list.append(el('div', { class: 'item plan-event' }, [el('label', { class: 'plan-event-own', for: id }, [tick, when, what]), el('button', { class: 'btn small ghost', type: 'button', text: t('Change'), onclick: () => ownSheet(row, c, e.id.slice(4)) })]));
    } else list.append(el('label', { class: 'item plan-event', for: id }, [tick, when, what]));
  }
  const on = c.list.filter(e => e.on).length;
  const add = el('button', { class: 'btn small ghost', type: 'button', text: t('Add an event'), onclick: () => ownSheet(row, c, '') });
  return section(t('In the calendar'), [
    el('p', { class: 'small', text: t('What goes into your calendar from this month: {on} of {n} ticked. Untick what you do not need; the standard is set under Settings. Add what is yours alone, such as a service you hold at another congregation.', { on, n: c.list.length }) }),
    list,
  ], { actions: [add] });
}

/** An event of the rector's own, new or to change: a day, a time, what it is. It goes into the calendar and onto the priests' programme. */
function ownSheet(row, c, id) {
  const cur = id ? (row.own || []).find(e => e.id === id) : null;
  const sh = sheet(cur ? t('Change the event') : t('Add an event'));
  const title = el('input', { type: 'text', value: cur ? cur.title : '', placeholder: t('Divine service at Sinoville'), autocomplete: 'off' });
  const date = el('input', { type: 'date', min: c.plan.first, max: c.plan.last, value: cur ? cur.date : '' });
  const start = el('input', { type: 'time', value: cur ? cur.start || '' : '' });
  const end = el('input', { type: 'time', value: cur ? cur.end || '' : '' });
  const note = el('textarea', { rows: '2', placeholder: t('A line for the calendar (optional)') });
  note.value = cur ? cur.note || '' : '';
  const save = el('button', { class: 'btn', type: 'button', text: cur ? t('Save') : t('Add'), onclick: async () => {
    if (!date.value || !title.value.trim()) { toast(t('Give the day and what it is.'), true); return; }
    const e = { id: cur ? cur.id : Date.now().toString(36), date: date.value, start: start.value, end: end.value, title: title.value.trim(), note: note.value.trim() };
    row.own = [...(row.own || []).filter(x => x.id !== e.id), e].sort((x, y) => x.date.localeCompare(y.date) || (x.start || '').localeCompare(y.start || ''));
    await savePlan(row);
    queueFeed();
    sh.close();
    redraw();
  } });
  const remove = cur ? el('button', { class: 'btn ghost danger', type: 'button', text: t('Remove'), onclick: async () => {
    row.own = (row.own || []).filter(x => x.id !== cur.id);
    await savePlan(row);
    queueFeed();
    sh.close();
    redraw();
  } }) : null;
  sh.body.append(...[
    el('p', { class: 'small', text: t('Something of your own for the calendar and the priests\' programme: a service you hold at another congregation, a visit, a meeting.') }),
    field(t('What'), title),
    el('div', { class: 'fields two' }, [field(t('Date'), date), field(t('From'), start), field(t('Until'), end)]),
    field(t('Note'), note),
    el('div', { class: 'row end' }, [remove, save]),
  ].filter(Boolean));
}

/* ---- sending */

function sendCard(row, c) {
  const open = c.services.filter(s => !s.off && !s.who).length;
  const excel = el('button', { class: 'btn', type: 'button', text: t('Excel file'), onclick: async () => {
    excel.disabled = true;
    try {
      const f = await excelFile(row);
      const r = await shareOrSave(f.blob, f.name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (r === 'saved') toast(t('Saved {name}.', { name: f.name }));
    } catch (e) { toast(e.message || t('The file could not be written.'), true); }
    excel.disabled = false;
  } });
  const pdf = el('button', { class: 'btn', type: 'button', text: t('Programme (PDF)'), onclick: async () => {
    pdf.disabled = true;
    try {
      const r = await programmePdf(c.plan, c.settings, c.services, c.list);
      const how = Pdf.canShare() ? await Pdf.share(r) : (Pdf.download(r), 'downloaded');
      if (how === 'downloaded') toast(t('Saved {name}.', { name: r.name }));
    } catch (e) { toast(e.message || t('The PDF could not be made.'), true); }
    pdf.disabled = false;
  } });
  const text = el('button', { class: 'btn', type: 'button', text: t('WhatsApp text'), onclick: () => textSheet(row, c) });
  return section(t('Send to the priests'), [
    el('p', { class: 'small', text: t('The district\'s file with your column filled in, the month as a one-page programme, or the plan as a message. On a phone each opens the share sheet; on a PC it is saved.') }),
    open ? el('p', { class: 'hint small', text: tn(open, '{n} service still has nobody: it goes out marked "still open".', '{n} services still have nobody: they go out marked "still open".') }) : null,
    el('div', { class: 'row' }, [excel, pdf, text]),
  ]);
}

function textSheet(row, c) {
  const sh = sheet(t('WhatsApp text'));
  const ta = el('textarea', { rows: '14' });
  ta.value = L.messageText(c.plan, c.settings, c.services, c.list, locale(), lang());
  const copy = el('button', { class: 'btn', type: 'button', text: t('Copy'), onclick: async () => { toast((await copyText(ta.value)) ? t('Copied. Paste it in the group.') : t('Could not copy. Select the text and copy it by hand.'), false); } });
  const share = navigator.share ? el('button', { class: 'btn ghost', type: 'button', text: t('Share'), onclick: async () => { try { await navigator.share({ text: ta.value }); } catch (e) { /* cancelled */ } } }) : null;
  sh.body.append(el('p', { class: 'small', text: t('Change the words if you like, then copy or share.') }), ta, el('div', { class: 'row end' }, [share, copy]));
}

/* ---- the calendar feed */

function calendarCard(row, c) {
  const s = c.settings;
  const on = s.calOn && s.calId;
  const total = months().reduce((n, r) => n + compute(r).list.filter(e => e.on).length, 0);
  const children = [];
  if (!on) {
    const start = el('button', { class: 'btn', type: 'button', text: t('Put the plan in Google Calendar'), onclick: async () => {
      start.disabled = true;
      if (await startFeed()) { redraw(); stepsSheet(); }
      start.disabled = false;
    } });
    children.push(
      el('p', { class: 'small', text: t('The app keeps a calendar feed of the plan. You add its address to Google Calendar once, on the PC; from then on every month and every change shows there by itself, in a calendar of its own beside yours, on the phone too.') }),
      el('div', { class: 'row' }, [start]),
    );
  } else {
    children.push(
      el('p', { class: 'small', text: t('Google Calendar follows this plan: {n} events in the feed. A change here shows there within about a day.', { n: total }) + (s.calAt ? ' ' + t('Last sent {when}.', { when: new Date(s.calAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) : '') }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small', type: 'button', text: t('Show the steps and the address'), onclick: stepsSheet }),
        el('button', { class: 'btn small ghost', type: 'button', text: t('Send now'), onclick: () => sendFeed({ loud: true }).then(redraw) }),
        el('button', { class: 'btn small ghost danger', type: 'button', text: t('Stop the feed'), onclick: async () => {
          if (await confirmBox(t('Stop the feed? Google Calendar then shows nothing from the plan any more, and you remove the calendar there yourself.'), t('Stop'), true)) { await stopFeed(); redraw(); }
        } }),
      ]),
    );
  }
  return section(t('Google Calendar'), children);
}

function stepsSheet() {
  const url = feedUrl();
  const sh = sheet(t('Google Calendar'));
  const addr = el('input', { type: 'text', value: url, readonly: true, class: 'plan-url' });
  addr.addEventListener('focus', () => addr.select());
  sh.body.append(
    el('p', { class: 'small', text: t('Do this once, on the PC.') }),
    el('ol', { class: 'plan-steps' }, [
      el('li', { text: t('Copy the address below.') }),
      el('li', { text: t('Open calendar.google.com. On the left, next to "Other calendars", tap + and choose "From URL".') }),
      el('li', { text: t('Paste the address and tap "Add calendar".') }),
      el('li', { text: t('A calendar named after your congregation appears beside your own. On the phone, open the Google Calendar app\'s menu and tick it.') }),
    ]),
    field(t('The address'), addr),
    el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: t('Copy the address'), onclick: async () => toast((await copyText(url)) ? t('Copied.') : t('Could not copy. Select the address and copy it by hand.')) })]),
    el('p', { class: 'small muted', text: t('Google reads the feed a few times a day, so a change shows within about a day. The address is long and random: only someone who has it can see the plan, and nobody can change it from there.') }),
  );
}

/* ---- the district's notes */

function notesCard(row, c) {
  if (!c.plan.notes.length) return el('span');
  return section(t('District notes'), [el('ul', { class: 'plan-notes' }, c.plan.notes.map(n => el('li', { class: 'small', text: n })))]);
}

/* ---- settings */

function settingsSheet(row) {
  const s = settings();
  const sh = sheet(t('Month plan settings'), { wide: true });
  const cong = el('input', { type: 'text', value: s.congregation, placeholder: t('Gezina') });
  cong.addEventListener('change', () => saveSettings({ congregation: cong.value.trim() }).then(redraw));
  const code = el('input', { type: 'text', value: s.myCode, placeholder: 'C', style: 'max-width: 6em', autocapitalize: 'characters' });
  code.addEventListener('change', async () => {
    const myCode = code.value.trim().toUpperCase();
    const patch = { myCode };
    if (row) patch.roster = L.mergeRoster(s.roster, planOf(row), myCode, s.hidden);
    await saveSettings(patch);
    sh.close(); settingsSheet(row); redraw();
  });
  const sun = el('input', { type: 'time', value: s.sundayTime });
  sun.addEventListener('change', () => saveSettings({ sundayTime: sun.value }).then(() => { queueFeed(); redraw(); }));
  const mid = el('input', { type: 'time', value: s.midweekTime });
  mid.addEventListener('change', () => saveSettings({ midweekTime: mid.value }).then(() => { queueFeed(); redraw(); }));
  const defaults = seg(EVENT_CHOICES, s.eventDefaults, v => saveSettings({ eventDefaults: v }).then(() => { queueFeed(); redraw(); }), { block: true, label: t('Which events go into the calendar') });
  // the ministers: the section's codes from the sheet, less those taken off, plus those added by hand; each with the name the priests should see
  const roster = el('div', { class: 'plan-roster' });
  const drawRoster = () => {
    clear(roster);
    const cur = settings();
    for (const r of cur.roster) {
      const label = el('input', { type: 'text', value: r.label || '' });
      label.addEventListener('change', async () => {
        const list = settings().roster.map(x => (x.code === r.code ? { ...x, label: label.value.trim() || L.ministerLabel(x) } : x));
        await saveSettings({ roster: list });
        queueFeed(); redraw();
      });
      const remove = el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), title: t('Take this minister off your list'), onclick: async () => {
        const now = settings();
        await saveSettings({ roster: now.roster.filter(x => x.code !== r.code), hidden: r.custom ? now.hidden : [...new Set([...(now.hidden || []), r.code])] });
        drawRoster(); redraw();
      } });
      roster.append(el('div', { class: 'row line plan-roster-row' }, [el('code', { class: 'plan-code', text: r.custom && r.code === r.label ? '' : r.code }), label, remove]));
    }
    // those taken off the sheet's list, with a way back
    const gone = row ? (cur.hidden || []).map(code => L.section(planOf(row), cur.myCode).find(m => String(m.code).toUpperCase() === code.toUpperCase())).filter(Boolean) : [];
    if (gone.length) {
      roster.append(el('p', { class: 'small muted' }, [
        t('Removed from the list: {list}', { list: gone.map(m => `${m.code} ${L.ministerLabel(m)}`).join(', ') }), ' ',
        el('button', { class: 'linklike', type: 'button', text: t('Show again'), onclick: async () => {
          const now = settings();
          await saveSettings({ hidden: [], roster: L.mergeRoster(now.roster, planOf(row), now.myCode, []) });
          drawRoster(); redraw();
        } }),
      ]));
    }
  };
  drawRoster();
  const newName = el('input', { type: 'text', placeholder: 'Pr A Williams', autocomplete: 'off' });
  const newCode = el('input', { type: 'text', placeholder: t('Code'), style: 'max-width: 6em', autocapitalize: 'characters' });
  const addRow = el('div', { class: 'row line plan-roster-row' }, [newName, newCode, el('button', { class: 'btn small', type: 'button', text: t('Add a priest'), onclick: async () => {
    const name = newName.value.trim(), code = newCode.value.trim().toUpperCase();
    if (!name) { newName.focus(); return; }
    const key = code || name;
    const now = settings();
    if (now.roster.some(x => String(x.code).toUpperCase() === key.toUpperCase())) { toast(t('That code is already in the list.'), true); return; }
    await saveSettings({ roster: [...now.roster, { code: key, label: name, name, custom: true }], hidden: (now.hidden || []).filter(h => h.toUpperCase() !== key.toUpperCase()) });
    newName.value = ''; newCode.value = '';
    drawRoster(); redraw();
  } })]);
  sh.body.append(...[
    el('div', { class: 'fields two' }, [
      field(t('Your congregation'), cong, t('The heading of your column in the sheet.')),
      field(t('Your code in the ministers\' list'), code, t('The letter your section\'s codes start with (C for C, C1, C2 …).')),
      field(t('Sunday service'), sun),
      field(t('Midweek service'), mid),
    ]),
    el('h3', { class: 'sub', text: t('Your ministers') }),
    el('p', { class: 'small', text: s.roster.length ? t('From the sheet\'s ministers\' list, with any you add. Write each name as the priests should see it; a priest without a code is written into the sheet by name.') : t('Open a month\'s file first: the names come from its ministers\' list.') }),
    roster,
    addRow,
    el('h3', { class: 'sub', text: t('Calendar') }),
    field(t('Which events go into the calendar'), defaults, t('The standard for a month when its file is opened; each event can still be ticked or unticked.')),
    row ? el('div', { class: 'row end' }, [el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove {month}', { month: L.monthLabel(row.month, row.year, lang()) }), onclick: async () => {
      if (!await confirmBox(t('Remove this month\'s plan from the app? The file you opened is not touched.'), t('Remove'), true)) return;
      await deletePlan(row.id);
      current = '';
      queueFeed();
      sh.close();
      location.hash = '#plan';
      redraw();
    } })]) : null,
  ].filter(Boolean));
}

function redraw() {
  if (box && location.hash.startsWith('#plan')) render(box, location.hash.replace(/^#\/?/, '').split('/').filter(Boolean));
}

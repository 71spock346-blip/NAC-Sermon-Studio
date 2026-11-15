/*
 * The month plan: the parts that know nothing of the screen.
 *
 * Every month the district sends a programme as an Excel sheet: a row per
 * day with where the District Apostle, the Apostle and the District Rector
 * are, the district's cross bookings, a Comments column of district events,
 * and a Ministries table of every minister's code (C, C1 …), rank, name and
 * number. The rector adds a column of his own congregation and writes in it
 * the code of who holds each service.
 *
 * Here that sheet becomes a plan: the title's month and year, each day's
 * date (the sheet gives day numbers only, which roll over where the month
 * changes), the ministers, the district's notes; from it the congregation's
 * service days (Sundays and Wednesdays, and any other day the column marks)
 * with who holds each; the events for the calendar, sorted by kind; and the
 * calendar feed and the WhatsApp text that go out. Nothing here touches the
 * database or the page, so each piece can be tried in Node
 * (tools/test_plan.mjs).
 */
import { t } from './i18n.js';
import { parseMonth, monthName } from './reminders-lib.js';
import { escapeText, fold } from './reminders-ics.js';

/* ------------------------------------------------------------------ small */

export const pad = n => String(n).padStart(2, '0');
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const dateOf = s => new Date(s + 'T12:00:00');
export const isoOf = d => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
export const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
export const dow = s => dateOf(s).getDay();   // 0 = Sunday

const str = v => (v == null ? '' : String(v)).trim();
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, son: 0, maa: 1, din: 2, woe: 3, don: 4, vry: 5, sat_: 6 };
/** 'Thurs', 'Tue', 'SUN', 'Woensdag' → the day of the week, or -1. */
export function weekdayOf(v) {
  const k = str(v).toLowerCase().slice(0, 3);
  return k in WEEKDAY ? WEEKDAY[k] : -1;
}

/** 'DR HINRICHSEN' → 'HINRICHSEN': the last word of a heading. */
const lastWord = s => str(s).split(/\s+/).pop().toLowerCase();

/** A first-letters key for a minister's surname: 'Q Hinrichsen' → 'hinrichsen'. */
const surnameOf = name => lastWord(name);

/** The month and year in a text: 'PROGRAMME - OCTOBER 2025 …' or 'PCD Planning October 2025.xlsx'. */
export function monthYearIn(text) {
  const s = str(text);
  const year = /(?:^|\D)(20\d{2})(?:\D|$)/.exec(s);
  if (!year) return null;
  for (const word of s.split(/[^A-Za-z]+/)) {
    const m = word.length >= 3 ? parseMonth(word) : undefined;
    if (m) return { month: m, year: Number(year[1]) };
  }
  return null;
}

/* ---------------------------------------------------------------- parsing */

const HEADERS = [
  ['day', /^(day|dag)$/i],
  ['date', /^(date|datum)$/i],
  ['cross', /cross|bookings|kruis/i],
  ['comments', /^(comments?|notes?|opmerkings?|kommentaar)$/i],
  ['ministries', /^(ministries|ministers|ampsdraers)$/i],
];

/**
 * The sheet (grid[row][col], 1-based, from plan-xlsx toGrid) read into a
 * plan. `congregation` names the rector's own column; `fileName` helps when
 * the title does not say the month.
 */
export function parseProgramme(grid, { congregation = '', fileName = '' } = {}) {
  const problems = [];
  const rows = grid.length - 1;
  // the title: the first text in the top rows that names a month and a year
  let title = '', when = null;
  for (let r = 1; r <= Math.min(rows, 6) && !when; r++) {
    for (const v of grid[r] || []) {
      if (typeof v === 'string' && v.trim()) { if (!title) title = v.trim(); const my = monthYearIn(v); if (my) { title = v.trim(); when = my; break; } }
    }
  }
  if (!when) when = monthYearIn(fileName);
  // the header row: DAY and DATE side by side
  let headerRow = 0;
  const columns = { leaders: [] };
  for (let r = 1; r <= Math.min(rows, 30) && !headerRow; r++) {
    const row = grid[r] || [];
    const dayCol = row.findIndex(v => typeof v === 'string' && HEADERS[0][1].test(v.trim()));
    const dateCol = row.findIndex(v => typeof v === 'string' && HEADERS[1][1].test(v.trim()));
    if (dayCol > 0 && dateCol > 0) { headerRow = r; columns.day = dayCol; columns.date = dateCol; }
  }
  if (!headerRow) return { problems: [t('No DAY and DATE columns were found. Is this the district\'s programme?')], days: [], ministers: [], notes: [], columns, title, month: when && when.month, year: when && when.year };
  const header = grid[headerRow];
  const mine = str(congregation).toLowerCase();
  for (let c = 1; c < header.length; c++) {
    const v = header[c];
    if (typeof v !== 'string' || !v.trim() || c === columns.day || c === columns.date) continue;
    const text = v.trim();
    const known = HEADERS.find(([key, rx]) => rx.test(text));
    if (known) { if (!columns[known[0]]) columns[known[0]] = c; continue; }
    if (mine && text.toLowerCase() === mine) { columns.mine = c; continue; }
    if (columns.comments || columns.ministries) continue;   // past the comments: the ministers' table and whatever else
    columns.leaders.push({ col: c, header: text, key: lastWord(text) });
  }
  // the days: every row under the header whose DAY is a weekday and DATE a number
  const dayRows = [];
  let started = false, blank = 0;
  for (let r = headerRow + 1; r <= rows; r++) {
    const row = grid[r] || [];
    const wd = weekdayOf(row[columns.day]);
    const num = Number(row[columns.date]);
    if (wd >= 0 && Number.isInteger(num) && num >= 1 && num <= 31) { dayRows.push({ r, wd, num }); started = true; blank = 0; continue; }
    if (started && ++blank >= 2) break;
    if (started && /denotes|legend|sleutel/i.test(str(row[columns.day]) + str(row[columns.day + 1]))) break;
  }
  if (!dayRows.length) problems.push(t('No day rows were found under the headings.'));
  // the day numbers roll over where the month changes: the longest run is the month of the title
  const segments = [];
  for (const d of dayRows) {
    const last = segments[segments.length - 1];
    if (last && d.num >= last[last.length - 1].num) last.push(d); else segments.push([d]);
  }
  let month = when ? when.month : 0, year = when ? when.year : 0;
  if (!month) {
    // no month in the title or the file name: the longest run's first weekday is tried against this year's months
    const main = segments.reduce((a, b) => (b.length > a.length ? b : a), segments[0] || []);
    const now = new Date();
    year = now.getFullYear();
    for (let m = 1; m <= 12 && main.length; m++) if (dateOf(iso(year, m, main[0].num)).getDay() === main[0].wd) { month = m; break; }
    if (!month) { month = now.getMonth() + 1; problems.push(t('The sheet does not say which month it is for; {month} {year} was assumed.', { month: monthName(month), year })); }
  }
  const mainIndex = segments.reduce((best, s, i) => (s.length > segments[best].length ? i : best), 0);
  const days = [];
  for (let i = 0; i < segments.length; i++) {
    let m = month + (i - mainIndex), y = year;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    for (const d of segments[i]) {
      const date = iso(y, m, d.num);
      if (dateOf(date).getMonth() !== m - 1) { problems.push(t('{day} {month} is not a date on the calendar.', { day: d.num, month: monthName(m) })); continue; }
      const row = grid[d.r] || [];
      const take = c => (c ? str(row[c]) : '');
      let day = days[days.length - 1];
      if (!day || day.date !== date) {
        day = { date, dow: dateOf(date).getDay(), rows: [], leaders: {}, cross: [], comments: [], mine: '', wrongDay: false };
        for (const l of columns.leaders) day.leaders[l.key] = [];
        days.push(day);
      }
      day.rows.push(d.r);
      if (d.wd !== day.dow) day.wrongDay = true;
      for (const l of columns.leaders) { const v = take(l.col); if (v) day.leaders[l.key].push(v); }
      const cross = take(columns.cross); if (cross) day.cross.push(cross);
      const comment = take(columns.comments); if (comment) day.comments.push(comment);
      const own = take(columns.mine); if (own && !day.mine) day.mine = own;
    }
  }
  const wrong = days.filter(d => d.wrongDay).length;
  if (days.length && wrong > days.length / 3) problems.push(t('The weekday names do not match the dates of {month} {year}: check the month of the plan.', { month: monthName(month), year }));
  // the ministers' table: code, rank, name, number, under the Ministries heading
  const ministers = [];
  if (columns.ministries) {
    const c = columns.ministries;
    for (let r = headerRow + 1; r <= rows; r++) {
      const row = grid[r] || [];
      const code = str(row[c]), rank = str(row[c + 1]), name = str(row[c + 2]);
      if (!name || !rank || /^mobile$/i.test(str(row[c + 3]))) continue;
      ministers.push({ code, rank: rank.toUpperCase(), name, mobile: str(row[c + 3]) });
    }
  }
  // the district's notes under the days ("Denotes: 1 …")
  const notes = [];
  const lastRow = dayRows.length ? dayRows[dayRows.length - 1].r : headerRow;
  for (let r = lastRow + 1; r <= rows; r++) {
    for (let c = 1; c < (grid[r] || []).length; c++) {
      if (columns.ministries && c >= columns.ministries) continue;
      const v = grid[r][c];
      if (typeof v === 'string' && v.trim() && !/^denotes:?$/i.test(v.trim()) && !notes.includes(v.trim())) notes.push(v.trim());
    }
  }
  return { title, month, year, headerRow, headerRows: [headerRow, dayRows.length ? dayRows[0].r - 1 : headerRow], columns, days, ministers, notes, problems, first: days.length ? days[0].date : '', last: days.length ? days[days.length - 1].date : '' };
}

/* --------------------------------------------------------------- ministers */

/** 'PR' → 'Pr', 'DR' → 'DR', 'R' → 'Rector' …: how a rank is written before a name. */
const PREFIX = { PR: 'Pr', SH: 'Sh', SHP: 'Sh', EV: 'Ev', DEL: 'DEl', DE: 'DEv', DR: 'DR', DRH: 'DRH', BI: 'Bi', A: 'Ap', AP: 'Ap', DA: 'DA', P: 'DA', DC: 'Dc', R: '' };
export function ministerLabel(m) {
  if (!m) return '';
  const code = str(m.code).toUpperCase(), rank = str(m.rank).toUpperCase();
  const prefix = code === 'DA' ? 'DA' : code === 'AP' ? 'Ap' : rank === 'R' ? t('Rector') : (PREFIX[rank] ?? rank);
  return `${prefix} ${m.name}`.trim();
}

/** The letter the rector's own codes start with ('C' for C, C1 …), from the codes written in his column, or ''. */
export function guessMyCode(plan) {
  const count = {};
  for (const d of plan.days) { const m = /^([A-Z])\d*$/i.exec(str(d.mine)); if (m) count[m[1].toUpperCase()] = (count[m[1].toUpperCase()] || 0) + 1; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}

/** The rector and the ministers of his section: every code that starts with his letter. */
export function section(plan, myCode) {
  const letter = str(myCode).toUpperCase();
  if (!letter) return [];
  return plan.ministers.filter(m => new RegExp(`^${letter}\\d*$`, 'i').test(str(m.code)));
}

/** The settings' roster brought up to date with the file: new codes are added with a label, labels already given stay. */
export function mergeRoster(roster, plan, myCode) {
  const out = (roster || []).map(r => ({ ...r }));
  for (const m of section(plan, myCode)) {
    const have = out.find(r => str(r.code).toUpperCase() === str(m.code).toUpperCase());
    if (have) { if (!have.name) have.name = m.name; have.rank = m.rank; }
    else out.push({ code: str(m.code), label: ministerLabel(m), name: m.name, rank: m.rank });
  }
  return out.sort((a, b) => str(a.code).localeCompare(str(b.code), undefined, { numeric: true }));
}

/** Who a code or a typed name is, as it is shown: the roster's label, a minister of the district by code, or the text itself. */
export function whoLabel(who, plan, settings) {
  const w = str(who);
  if (!w) return '';
  const r = (settings.roster || []).find(x => str(x.code).toUpperCase() === w.toUpperCase());
  if (r) return r.label || ministerLabel(r);
  const m = (plan.ministers || []).find(x => str(x.code).toUpperCase() === w.toUpperCase());
  return m ? ministerLabel(m) : w;
}

/* ----------------------------------------------------------- the services */

const OFF = /no (morning |evening )?service|geen (oggend|aand)?diens|public holiday|openbare vakansie/i;

/**
 * The congregation's service days: every Sunday and Wednesday of the plan,
 * and any other day its column marks or the rector added. Each has what the
 * sheet says for that day, a suggestion for who holds it (the column's code,
 * or the district leader the sheet puts in the congregation that day), and
 * the rector's own choice over it (plan.services[date]).
 */
export function serviceDays(plan, settings) {
  const cong = str(settings.congregation).toLowerCase();
  const choices = plan.services || {};
  const extra = new Set(plan.extraDays || []);
  const out = [];
  for (const day of plan.days) {
    const kind = day.dow === 0 ? 'sunday' : day.dow === 3 ? 'midweek' : (day.mine || extra.has(day.date)) ? 'extra' : '';
    if (!kind) continue;
    const visiting = [];
    for (const [key, values] of Object.entries(day.leaders)) {
      if (values.some(v => v.toLowerCase() === cong)) {
        const m = plan.ministers.find(x => surnameOf(x.name) === key) || null;
        visiting.push({ key, code: m ? str(m.code) : '', label: m ? ministerLabel(m) : plan.columns.leaders.find(l => l.key === key).header });
      }
    }
    const texts = [...day.comments, ...day.cross.filter(c => c.toLowerCase().includes(cong))];
    const holiday = Object.values(day.leaders).some(vs => vs.some(v => /public holiday|openbare vakansie/i.test(v)));
    // "No service. Service on the 25th" closes the day; "No morning service at Sinoville" is about Sinoville, and a code in the column says the service is held
    const offNote = texts.find(x => OFF.test(x) && /no .*service|geen .*diens/i.test(x) && !/\b(at|in|by)\b/i.test(x));
    const auto = { who: day.mine || (visiting[0] && visiting[0].code) || '', off: holiday || (!!offNote && !day.mine) };
    const choice = choices[day.date] || {};
    const time = choice.time || (kind === 'sunday' ? settings.sundayTime : settings.midweekTime) || '';
    out.push({
      date: day.date, dow: day.dow, kind, time, visiting, holiday,
      notes: texts, leaders: day.leaders,
      who: 'who' in choice ? str(choice.who) : auto.who,
      off: 'off' in choice ? !!choice.off : auto.off,
      note: str(choice.note),
      auto,
    });
  }
  return out;
}

/* -------------------------------------------------------------- the events */

const MEETING = /rector|minister|module|vergadering vir|ampsdraers/i;
const ADMIN = /closing of accounts|\bmis\b|\baccounts?\b|rekeninge/i;
const LEADER_EVENT = /^reflections?\b|besinning/i;

/** A time of day in a text: '19:00', '19h30', '8am', '09:00 - 13:00' → {start, end}. */
export function timesIn(text) {
  const s = str(text);
  const two = /(\d{1,2})[:hH](\d{2})\s*(?:-|–|to|tot)\s*(\d{1,2})[:hH](\d{2})/.exec(s);
  if (two) return { start: `${pad(two[1])}:${two[2]}`, end: `${pad(two[3])}:${two[4]}` };
  const one = /(\d{1,2})[:hH](\d{2})/.exec(s);
  if (one && Number(one[1]) < 24) return { start: `${pad(one[1])}:${one[2]}`, end: '' };
  const ampm = /(\d{1,2})\s*(am|pm)\b/i.exec(s);
  if (ampm) { let h = Number(ampm[1]) % 12; if (ampm[2].toLowerCase() === 'pm') h += 12; return { start: `${pad(h)}:00`, end: '' }; }
  return null;
}

/** A span of days in a text, '10-12 Oct 25' or '10 – 12 October': the last day, when the first is the event's date. */
export function lastDayIn(text, date) {
  const m = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,})/.exec(str(text));
  if (!m) return '';
  const month = parseMonth(m[3]);
  const d = dateOf(date);
  if (!month || month !== d.getMonth() + 1 || Number(m[1]) !== d.getDate()) return '';
  const end = iso(d.getFullYear(), month, Number(m[2]));
  return end > date ? end : '';
}

export const slug = s => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * Everything in the plan that can go in the calendar: the services, with
 * who holds them, and the district's events by kind ('district', 'meeting',
 * 'admin'). A district note on a service day that gives no time of its own
 * (Thanksgiving Day, Young People Serving Christ Sunday) belongs to that
 * service and is not an event of its own. `on` says whether it goes in:
 * the rector's tick (plan.events[id]), else the setting's default.
 */
export function events(plan, settings, services) {
  const cong = str(settings.congregation).toLowerCase();
  const defaults = settings.eventDefaults || 'district';   // Jerome's choice (2026-11-15): the services and the district's events; meetings and deadlines are ticked by hand
  const ticked = plan.events || {};
  const onByDefault = kind => defaults === 'all' || (defaults === 'district' && kind !== 'meeting' && kind !== 'admin') || (defaults === 'services' && kind === 'service');
  const out = [];
  const add = e => { e.on = e.id in ticked ? !!ticked[e.id] : onByDefault(e.kind); out.push(e); };
  const byDate = Object.fromEntries(services.map(s => [s.date, s]));
  // a note on a service day that gives no time, or the service's own time (an AVT at 09:00), belongs to the service
  const partOf = (s, n) => { const tm = timesIn(n); return !MEETING.test(n) && !ADMIN.test(n) && (!tm || tm.start === s.time); };
  for (const s of services) {
    if (s.off) continue;
    const who = whoLabel(s.who, plan, settings);
    const attached = s.notes.filter(n => partOf(s, n));
    add({ id: `${s.date}|service`, kind: 'service', date: s.date, start: s.time, end: '', lastDay: '',
      title: `${t('Divine service')} – ${settings.congregation || t('Congregation')}${who ? ` (${who})` : ''}`,
      detail: [...attached, s.note].filter(Boolean).join('\n'), who, service: s });
  }
  for (const day of plan.days) {
    const service = byDate[day.date];
    const seen = new Set();
    const texts = [...day.comments];
    for (const [key, values] of Object.entries(day.leaders)) for (const v of values) if (LEADER_EVENT.test(v) && !texts.some(x => LEADER_EVENT.test(x))) texts.push(v);
    for (const text of texts) {
      if (OFF.test(text) && !/\d{1,2}[:hH]\d{2}/.test(text)) continue;   // "No service. Service on the 25th": said on the service row already
      const kind = ADMIN.test(text) ? 'admin' : MEETING.test(text) ? 'meeting' : 'district';
      const times = timesIn(text);
      if (service && !service.off && kind === 'district' && (!times || times.start === service.time)) continue;   // part of that day's service
      const key = slug(text);
      if (seen.has(key)) continue;
      seen.add(key);
      add({ id: `${day.date}|${kind}|${key}`, kind, date: day.date, start: times ? times.start : '', end: times ? times.end : '', lastDay: lastDayIn(text, day.date), title: text, detail: '', who: '' });
    }
    for (const c of day.cross) if (c.toLowerCase().includes(cong) && (!service || service.off)) add({ id: `${day.date}|district|${slug(c)}`, kind: 'district', date: day.date, start: '', end: '', lastDay: '', title: c, detail: '', who: '' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '') || a.kind.localeCompare(b.kind));
}

/* ------------------------------------------------------------ the feed */

const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** South Africa keeps one time all year (UTC+2), so a local time is written as UTC without a time zone table. */
const utc = (date, time) => { const [h, m] = time.split(':').map(Number); const d = new Date(Date.UTC(...date.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)), h - 2, m)); return stamp(d); };

/**
 * The calendar feed: every ticked event of every month, as an iCalendar
 * file Google Calendar can follow. A service lasts an hour and a half on a
 * Sunday and an hour in the week; a district event with a start but no
 * end lasts two hours; one with no time is a whole day.
 */
export function buildFeed(months, { name, now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NAC Study Bible//Month plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name || t('Month plan'))}`, 'X-WR-TIMEZONE:Africa/Johannesburg', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  const ts = stamp(now);
  for (const { events: list } of months) {
    for (const e of list) {
      if (!e.on) continue;
      lines.push('BEGIN:VEVENT', `UID:${e.id.replace(/[^a-z0-9]+/gi, '-')}@nac-study-bible-plan`, `DTSTAMP:${ts}`);
      if (e.start) {
        const minutes = e.end ? 0 : e.kind === 'service' ? (e.service && e.service.kind === 'sunday' ? 90 : 60) : 120;
        const endTime = e.end || `${pad(Math.floor((Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3)) + minutes) / 60) % 24)}:${pad((Number(e.start.slice(3)) + minutes) % 60)}`;
        lines.push(`DTSTART:${utc(e.date, e.start)}`, `DTEND:${utc(e.date, endTime)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(e.lastDay || e.date, 1).replace(/-/g, '')}`);
      }
      lines.push(`SUMMARY:${escapeText(e.title)}`);
      if (e.detail) lines.push(`DESCRIPTION:${escapeText(e.detail)}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------- the words */

export function monthLabel(month, year, language) {
  return `${monthName(month, language)} ${year}`;
}

/** 'Sun 5 Oct' in the language of the app. */
export function shortDate(date, locale) {
  const d = dateOf(date);
  return `${d.toLocaleDateString(locale, { weekday: 'short' }).replace(/\.$/, '')} ${d.getDate()} ${d.toLocaleDateString(locale, { month: 'short' }).replace(/\.$/, '')}`;
}

export function serviceName(s) {
  if (s.kind === 'sunday') return t('Sunday service');
  if (s.kind === 'midweek') return t('Midweek service');
  return t('Divine service');
}

/** The plan as a message for the priests' WhatsApp group. */
export function messageText(plan, settings, services, list, locale, language) {
  const lines = [`*${settings.congregation || t('Congregation')} – ${monthLabel(plan.month, plan.year, language)}*`, ''];
  for (const s of services) {
    const when = `${shortDate(s.date, locale)}${s.off ? '' : s.time ? ' ' + s.time : ''}`;
    if (s.off) { lines.push(`${when} – ${t('No service')}${s.notes.length ? ' (' + s.notes[0] + ')' : ''}`); continue; }
    const who = whoLabel(s.who, plan, settings) || t('still open');
    const notes = [...s.notes.filter(n => { const tm = timesIn(n); return !MEETING.test(n) && !ADMIN.test(n) && (!tm || tm.start === s.time); }), s.note].filter(Boolean);
    lines.push(`${when} – ${who}${notes.length ? ' – ' + notes.join('; ') : ''}`);
  }
  const rest = list.filter(e => e.kind !== 'service' && e.on);
  if (rest.length) {
    lines.push('', `*${t('District')}*`);
    for (const e of rest) lines.push(`${shortDate(e.date, locale)}${e.start ? ' ' + e.start : ''} – ${e.title}`);
  }
  return lines.join('\n');
}

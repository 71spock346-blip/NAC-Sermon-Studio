#!/usr/bin/env node
/*
 * Checks the month plan without a browser:  node tools/test_plan.mjs
 *
 * tools/fixtures/plan-sample.xlsx is a made-up district programme in the
 * layout of the real one (a title with the month, DAY and DATE columns, the
 * three leaders, cross bookings, Comments, the Ministries table, a second
 * row for one date, a "Denotes" block, a conditional format and a picture).
 * The real programme holds the ministers' numbers and stays out of the
 * repository.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as X from '../src/plan-xlsx.js';
import * as L from '../src/plan-lib.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = new Uint8Array(fs.readFileSync(path.join(here, 'fixtures', 'plan-sample.xlsx')));
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };

/* ---- the zip and the sheet */

const wb = await X.openWorkbook(bytes);
const sheet = await X.readSheet(wb, wb.sheets[0]);
const grid = X.toGrid(sheet);

await test('the workbook opens: one sheet, its cells and merges', async () => {
  assert.equal(wb.sheets.length, 1);
  assert.equal(wb.sheets[0].name, 'Program');
  assert.ok(sheet.cells.size > 100);
  assert.ok(sheet.merges.includes('A1:J2'));
  assert.equal(grid[4][1], 'DAY');
  assert.equal(grid[4][2], 'DATE');
  assert.equal(grid[7][2], 22);          // a number stays a number
  assert.equal(typeof grid[1][1], 'string');
});

await test('a zip written here opens again, with the untouched entries copied through', async () => {
  const entries = X.unzip(bytes);
  const again = X.unzip(await X.zip(entries));
  assert.deepEqual([...again.keys()].sort(), [...entries.keys()].sort());
  for (const [name, e] of entries) assert.equal(again.get(name).crc, e.crc, name);
  const fresh = X.unzip(await X.zip(new Map([['a.txt', new TextEncoder().encode('hello hello hello')]])));
  assert.equal(new TextDecoder().decode(await X.entryData(fresh.get('a.txt'))), 'hello hello hello');
});

/* ---- reading the programme */

const plan = L.parseProgramme(grid, { congregation: 'Sunnyside', fileName: 'plan-sample.xlsx' });

await test('the title gives the month, the days run from the 22nd of September to the 31st of October', async () => {
  assert.equal(plan.month, 10);
  assert.equal(plan.year, 2025);
  assert.equal(plan.first, '2025-09-22');
  assert.equal(plan.last, '2025-10-31');
  assert.equal(plan.days.length, 40);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.days.filter(d => d.wrongDay).length, 0);
});

await test('the columns are found by their headings; there is no column of our own yet', async () => {
  assert.equal(plan.columns.day, 1);
  assert.equal(plan.columns.date, 2);
  assert.deepEqual(plan.columns.leaders.map(l => l.key), ['smith', 'jones', 'brown']);
  assert.equal(plan.columns.cross, 6);
  assert.equal(plan.columns.comments, 7);
  assert.equal(plan.columns.ministries, 8);
  assert.equal(plan.columns.mine, undefined);
  assert.deepEqual(plan.headerRows, [4, 6]);
});

await test('two rows for one date become one day with both entries', async () => {
  const d = plan.days.find(x => x.date === '2025-10-19');
  assert.deepEqual(d.rows.length, 2);
  assert.deepEqual(d.leaders.jones, ['Riverbend', 'Mountain Pass']);
  assert.equal(d.comments.length, 2);
  assert.deepEqual(d.cross, ['Pr H Silver to Sunnyside']);
});

await test('the ministers and the notes are read', async () => {
  assert.equal(plan.ministers.length, 12);
  assert.deepEqual(plan.ministers.find(m => m.code === 'C1'), { code: 'C1', rank: 'PR', name: 'M Grey', mobile: '9' });
  assert.equal(plan.ministers.find(m => m.code === '1').rank, 'DR');
  assert.equal(plan.notes.length, 3);
  assert.equal(L.ministerLabel(plan.ministers.find(m => m.code === 'C')), 'Rector J Black');
  assert.equal(L.ministerLabel(plan.ministers.find(m => m.code === '1')), 'DR K Brown');
  assert.equal(L.ministerLabel(plan.ministers.find(m => m.code === 'AP')), 'Ap Jones');
});

await test('the month in a text or a file name', async () => {
  assert.deepEqual(L.monthYearIn('DISTRICT PROGRAMME - OCTOBER 2025 "x"'), { month: 10, year: 2025 });
  assert.deepEqual(L.monthYearIn('PCD Planning November 2026.xlsx'), { month: 11, year: 2026 });
  assert.deepEqual(L.monthYearIn('Program Maart 2026'), { month: 3, year: 2026 });
  assert.equal(L.monthYearIn('nothing here'), null);
});

await test('times and spans of days in a note', async () => {
  assert.deepEqual(L.timesIn('Olympus 09:00 - 13:00'), { start: '09:00', end: '13:00' });
  assert.deepEqual(L.timesIn('Divine Service @ 19h30'), { start: '19:30', end: '' });
  assert.deepEqual(L.timesIn('starts 8am'), { start: '08:00', end: '' });
  assert.equal(L.timesIn('Closing of Accounts'), null);
  assert.equal(L.lastDayIn('Confirmation Camp 10-12 Oct 25', '2025-10-10'), '2025-10-12');
  assert.equal(L.lastDayIn('Confirmation Camp 10-12 Oct 25', '2025-10-11'), '');
});

/* ---- the services and the events */

const settings = { congregation: 'Sunnyside', myCode: 'C', roster: L.mergeRoster([], plan, 'C'), sundayTime: '09:00', midweekTime: '19:30', eventDefaults: 'all' };

await test('the roster is the rector and his section, labelled', async () => {
  assert.deepEqual(settings.roster.map(r => r.code), ['C', 'C1', 'C2', 'C3']);
  assert.equal(settings.roster[1].label, 'Pr M Grey');
  const kept = L.mergeRoster([{ code: 'C1', label: 'Pr Mark Grey' }], plan, 'C');
  assert.equal(kept.find(r => r.code === 'C1').label, 'Pr Mark Grey');
  assert.equal(kept.length, 4);
  // one taken off stays off, one added by hand (by name) stays
  const edited = L.mergeRoster([{ code: 'C1', label: 'Pr Mark Grey' }, { code: 'Pr Williams', label: 'Pr Williams', name: 'Pr Williams', custom: true }], plan, 'C', ['C3']);
  assert.deepEqual(edited.map(r => r.code), ['C', 'C1', 'C2', 'Pr Williams']);
  assert.equal(L.whoLabel('Pr Williams', plan, { roster: edited }), 'Pr Williams');
});

await test('where a closed Wednesday\'s service goes', async () => {
  assert.equal(L.movedTo('2025-09-24', 'No Service. Service on 25 September'), '2025-09-25');
  assert.equal(L.movedTo('2025-09-24', 'Geen diens. Diens op Donderdag'), '2025-09-25');
  assert.equal(L.movedTo('2025-09-24', 'No service. Service on Friday'), '2025-09-26');
  assert.equal(L.movedTo('2025-09-24', ''), '2025-09-25');
  assert.equal(L.movedTo('2025-12-31', 'Service on 2 January'), '2026-01-02');
});

const services = L.serviceDays(plan, settings);

await test('every Sunday and Wednesday is a service day; the holiday Wednesday is off and its service moves to the Thursday; the DR at the congregation holds that Sunday', async () => {
  assert.equal(services.length, 12);
  assert.ok(services.every(s => s.dow === 0 || s.dow === 3 || s.kind === 'moved'));
  const holiday = services.find(s => s.date === '2025-09-24');
  assert.equal(holiday.off, true);
  assert.equal(holiday.holiday, true);
  const moved = services.find(s => s.date === '2025-09-25');
  assert.equal(moved.kind, 'moved');
  assert.equal(moved.movedFrom, '2025-09-24');
  assert.equal(moved.time, '19:30');
  assert.equal(moved.off, false);
  assert.equal(L.serviceName(moved), 'Midweek service');
  const sun = services.find(s => s.date === '2025-09-28');
  assert.equal(sun.who, '1');
  assert.equal(sun.visiting[0].label, 'DR K Brown');
  assert.equal(L.whoLabel(sun.who, plan, settings), 'DR K Brown');
  const plain = services.find(s => s.date === '2025-10-08');
  assert.equal(plain.who, '');
  assert.equal(plain.time, '19:30');
  assert.equal(services.find(s => s.date === '2025-10-05').time, '09:00');
  // the Apostle's service transmitted to all congregations: nobody holds it here, so AVT stands as who
  const avt = services.find(s => s.date === '2025-10-26');
  assert.equal(avt.avt, true);
  assert.equal(avt.who, 'AVT');
  assert.equal(L.whoLabel('AVT', plan, settings), 'AVT');
  assert.deepEqual(services.filter(s => s.avt).map(s => s.date), ['2025-10-26']);
  assert.equal(L.serviceDays({ ...plan, services: { '2025-10-26': { who: 'C' } } }, settings).find(s => s.date === '2025-10-26').who, 'C', 'the rector may still hold it himself');
});

await test('the rector\'s choices win over the sheet, and a day can be added', async () => {
  const chosen = { ...plan, services: { '2025-10-08': { who: 'C1' }, '2025-09-24': { off: false, who: 'C2', time: '18:00' } }, extraDays: ['2025-10-03'] };
  const list = L.serviceDays(chosen, settings);
  assert.equal(list.find(s => s.date === '2025-10-08').who, 'C1');
  const wed = list.find(s => s.date === '2025-09-24');
  assert.equal(wed.off, false);
  assert.equal(wed.time, '18:00');
  assert.ok(!list.some(s => s.date === '2025-09-25'), 'held on the Wednesday after all: nothing moves to the Thursday');
  const extra = list.find(s => s.date === '2025-10-03');
  assert.equal(extra.kind, 'extra');
  assert.equal(extra.time, '19:30');
});

/* ---- the feast days: a December programme */

await test('Easter and the feast days of the Church year', async () => {
  assert.equal(L.easter(2025), '2025-04-20');
  assert.equal(L.easter(2026), '2026-04-05');
  assert.equal(L.easter(2027), '2027-03-28');
  const f = L.feasts(2026);
  assert.equal(f['2026-04-03'].key, 'goodFriday');
  assert.equal(f['2026-04-05'].key, 'easter');
  assert.equal(f['2026-05-14'].key, 'ascension');
  assert.equal(f['2026-05-24'].key, 'pentecost');
  assert.equal(f['2026-12-25'].key, 'christmas');
  assert.deepEqual(Object.keys(L.feastsBetween('2026-11-22', '2027-01-03')), ['2026-12-25']);
  assert.deepEqual(Object.keys(L.feastsBetween('2027-03-22', '2027-04-30')), ['2027-03-26', '2027-03-28']);
  assert.deepEqual(Object.keys(L.feastsBetween('2025-09-22', '2025-10-31')), []);
});

/**
 * A made-up December programme as a grid: Sun 22 Nov 2026 to Sun 3 Jan
 * 2027, the public holidays marked in the leaders' columns as the district
 * marks them, Christmas Day on the Friday. `cells` = {date: {col: value}}
 * changes a day's row.
 */
function decemberGrid(cells = {}) {
  const grid = [];
  const set = (r, c, v) => { (grid[r] = grid[r] || [])[c] = v; };
  set(1, 1, 'SAMPLE DISTRICT PROGRAMME - DECEMBER 2026');
  ['DAY', 'DATE', 'DA SMITH', 'AP JONES', 'DR BROWN', 'DISTRICT CROSS BOOKINGS', 'Comments', 'Ministries'].forEach((h, i) => set(4, i + 1, h));
  [['DA', 'P', 'Smith', 'Mobile'], ['1', 'DR', 'K Brown', '3'], ['C', 'R', 'J Black', '8'], ['C1', 'PR', 'M Grey', '9']].forEach((m, i) => m.forEach((v, j) => set(5 + i, 8 + j, v)));
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thurs', 'Fri', 'Sat'];
  const holiday = ['2026-12-16', '2026-12-25', '2026-12-26', '2027-01-01'];
  const comments = {
    '2026-12-16': 'No Service. Service on Thursday', '2026-12-23': 'No Service', '2026-12-25': 'Christmas Day Service',
    '2026-12-27': 'Close of Year Service', '2027-01-03': "New Year's Service: AVT to all congregations (09:00)",
  };
  let r = 5;
  for (let d = '2026-11-22'; d <= '2027-01-03'; d = L.addDays(d, 1), r++) {
    set(r, 1, DAY[L.dow(d)]);
    set(r, 2, Number(d.slice(8)));
    if (holiday.includes(d)) [3, 4, 5].forEach(c => set(r, c, 'Public Holiday'));
    if (d === '2026-12-08') set(r, 5, 'Sunnyside');
    if (comments[d]) set(r, 7, comments[d]);
    for (const [c, v] of Object.entries(cells[d] || {})) set(r, Number(c), v);
  }
  return grid;
}

const dec = L.parseProgramme(decemberGrid(), { congregation: 'Sunnyside' });
const decSettings = { ...settings, roster: L.mergeRoster([], dec, 'C') };

await test('December: Christmas Day is a service on the Friday, in the morning; the closed Wednesday before it does not move', async () => {
  assert.equal(dec.month, 12);
  assert.equal(dec.year, 2026);
  assert.equal(dec.first, '2026-11-22');
  assert.equal(dec.last, '2027-01-03');
  assert.deepEqual(dec.problems, []);
  const list = L.serviceDays(dec, decSettings);
  const xmas = list.find(s => s.date === '2026-12-25');
  assert.equal(xmas.kind, 'feast');
  assert.equal(xmas.feast, 'christmas');
  assert.equal(xmas.off, false, 'the public holiday does not close a feast day');
  assert.equal(xmas.holiday, true);
  assert.equal(xmas.time, '09:00');
  assert.equal(xmas.who, '');
  assert.equal(L.serviceName(xmas), 'Christmas Day service');
  assert.equal(L.dayName(xmas), 'Christmas Day');
  assert.equal(L.serviceTitle(xmas), 'Christmas Day service');
  const wed = list.find(s => s.date === '2026-12-23');
  assert.equal(wed.off, true);
  assert.ok(!list.some(s => s.date === '2026-12-24'), 'Christmas Eve gets no moved service: Christmas Day is that week\'s service');
  const thu = list.find(s => s.date === '2026-12-17');
  assert.equal(thu.kind, 'moved');
  assert.equal(thu.movedFrom, '2026-12-16');
  assert.ok(!list.some(s => s.date === '2026-12-26'), 'the Day of Goodwill is no service day');
  assert.ok(!list.some(s => s.date === '2027-01-01'), 'nor is New Year\'s Day');
  assert.equal(L.serviceTitle(list.find(s => s.date === '2026-12-20')), 'Divine service');
  // the DR at the congregation on a Tuesday is a service there, held by him, in the evening
  const tue = list.find(s => s.date === '2026-12-08');
  assert.equal(tue.kind, 'extra');
  assert.equal(tue.who, '1');
  assert.equal(tue.time, '19:30');
  assert.equal(tue.visiting[0].label, 'DR K Brown');
  // a Sunday the sheet marks as a public holiday is held all the same
  const sun = L.serviceDays(L.parseProgramme(decemberGrid({ '2026-12-20': { 3: 'Public Holiday', 4: 'Public Holiday', 5: 'Public Holiday' } }), { congregation: 'Sunnyside' }), decSettings).find(s => s.date === '2026-12-20');
  assert.equal(sun.off, false);
  assert.equal(sun.holiday, true);
  // ticked off, Christmas Day stays on the list as closed, and the Wednesday's service moves to the Thursday after all
  const off = L.serviceDays({ ...dec, services: { '2026-12-25': { off: true } } }, decSettings);
  assert.equal(off.find(s => s.date === '2026-12-25').off, true);
  assert.equal(off.find(s => s.date === '2026-12-24').kind, 'moved');
  // a Wednesday the rector closes himself moves nothing either
  const mine = L.serviceDays({ ...dec, services: { '2026-12-30': { off: true } } }, decSettings);
  assert.equal(mine.find(s => s.date === '2026-12-30').off, true);
  assert.ok(!mine.some(s => s.date === '2026-12-31'));
});

await test('Christmas Day in the calendar, in the message and on the programme', async () => {
  const list = L.serviceDays(dec, decSettings);
  const ev = L.events(dec, decSettings, list);
  const x = ev.find(e => e.date === '2026-12-25' && e.kind === 'service');
  assert.ok(x.title.startsWith('Christmas Day service – Sunnyside'), x.title);
  assert.ok(x.detail.includes('Christmas Day Service'), 'the district\'s note belongs to the service');
  assert.ok(!ev.some(e => e.date === '2026-12-25' && e.kind !== 'service'));
  assert.ok(ev.find(e => e.date === '2026-12-20' && e.kind === 'service').title.startsWith('Divine service – Sunnyside'));
  const ics = L.buildFeed([{ events: ev }], { name: 'Sunnyside', now: new Date('2026-11-21T12:00:00Z') });
  assert.ok(ics.includes('DTSTART:20261225T070000Z'));
  assert.ok(ics.includes('DTEND:20261225T083000Z'), 'a feast day\'s service lasts an hour and a half, like a Sunday\'s');
  assert.ok(ics.includes('SUMMARY:Christmas Day service – Sunnyside'));
  const text = L.messageText(dec, decSettings, list, ev, 'en-ZA', 'en');
  assert.ok(text.includes('Fri 25 Dec 09:00 – still open – Christmas Day Service'), text);
  assert.ok(!text.includes('Christmas Day; Christmas Day Service'), 'the district\'s note names the day already');
  const bare = L.parseProgramme(decemberGrid({ '2026-12-25': { 7: '' } }), { congregation: 'Sunnyside' });
  const bareList = L.serviceDays(bare, decSettings);
  assert.ok(L.messageText(bare, decSettings, bareList, L.events(bare, decSettings, bareList), 'en-ZA', 'en').includes('Fri 25 Dec 09:00 – still open – Christmas Day\n'));
  assert.deepEqual(L.withDayName(bareList.find(s => s.date === '2026-12-25'), ['', 'Carols 18:00']), ['Christmas Day', 'Carols 18:00']);
  assert.ok(text.includes('Wed 23 Dec – No service'));
  assert.ok(text.includes('Thu 17 Dec 19:30 – still open'));
  // New Year's Sunday is an AVT: nobody holds it, in the list, the message and the calendar
  const ny = list.find(s => s.date === '2027-01-03');
  assert.equal(ny.avt, true);
  assert.equal(ny.who, 'AVT');
  assert.ok(text.includes('Sun 3 Jan 09:00 – AVT – New Year\'s Service'), text);
  assert.ok(ev.find(e => e.date === '2027-01-03' && e.kind === 'service').title.endsWith('(AVT)'));
  assert.ok(!list.filter(s => !s.off && !s.who).some(s => s.date === '2027-01-03'), 'an AVT Sunday is not "still open"');
});

await test('a day the rector adds, with a name and a time; a day the sheet has no row for; a code in his column on any day', async () => {
  const added = { ...dec, extraDays: ['2026-12-12', '2027-01-05'], services: { '2026-12-12': { off: false, name: 'Youth service', time: '17:00' } } };
  const list = L.serviceDays(added, decSettings);
  const sat = list.find(s => s.date === '2026-12-12');
  assert.equal(sat.kind, 'extra');
  assert.equal(sat.added, true);
  assert.equal(sat.name, 'Youth service');
  assert.equal(sat.time, '17:00');
  assert.equal(L.serviceName(sat), 'Youth service');
  assert.equal(L.dayName(sat), 'Youth service');
  assert.equal(L.serviceTitle(sat), 'Youth service');
  const jan = list.find(s => s.date === '2027-01-05');
  assert.equal(jan.kind, 'extra');
  assert.deepEqual(jan.notes, []);
  assert.equal(jan.time, '19:30');
  assert.equal(list[list.length - 1].date, '2027-01-05');
  assert.ok(L.events(added, decSettings, list).some(e => e.title.startsWith('Youth service – Sunnyside')));
  // a code written in the column on a Saturday is a service there whoever wrote it
  const marked = L.parseProgramme(decemberGrid({ '2026-12-05': { 7: 'C1' } }), { congregation: 'Sunnyside' });
  const col = L.serviceDays({ ...marked, days: marked.days.map(d => (d.date === '2026-12-05' ? { ...d, mine: 'C1', comments: [] } : d)) }, decSettings).find(s => s.date === '2026-12-05');
  assert.equal(col.kind, 'extra');
  assert.equal(col.who, 'C1');
  assert.equal(col.added, false);
});

/* ---- the events */

const list = L.events(plan, settings, services);

await test('the events: services, district events, meetings and deadlines, with notes on a service day attached to the service', async () => {
  const kinds = list.reduce((m, e) => ({ ...m, [e.kind]: (m[e.kind] || 0) + 1 }), {});
  assert.equal(kinds.service, 11);   // the moved Thursday service too
  assert.ok(kinds.district >= 4);
  assert.equal(kinds.meeting, 2);   // the module for rectors, all rectors invited
  assert.equal(kinds.admin, 2);     // closing of accounts, twice
  assert.ok(!list.some(e => e.title === 'Thanksgiving Day'), 'Thanksgiving is part of that Sunday\'s service');
  assert.ok(list.find(e => e.date === '2025-10-05' && e.kind === 'service').detail.includes('Thanksgiving'));
  assert.ok(!list.some(e => e.title.startsWith('AVT')), 'an AVT at the service time is the service');
  const camp = list.find(e => e.title.startsWith('Confirmation Camp at Riverbend'));
  assert.equal(camp.lastDay, '2025-10-12');
  const yp = list.find(e => e.title.startsWith('YP Service'));
  assert.equal(yp.start, '17:00');
  assert.ok(list.every(e => e.on));
  assert.ok(!list.some(e => /no service/i.test(e.title)));
});

await test('the defaults by kind, and a tick over them', async () => {
  const only = L.events(plan, { ...settings, eventDefaults: 'services' }, services);
  assert.ok(only.filter(e => e.on).every(e => e.kind === 'service'));
  const district = L.events(plan, { ...settings, eventDefaults: 'district' }, services);
  assert.ok(district.filter(e => e.on).every(e => e.kind === 'service' || e.kind === 'district'));
  assert.ok(district.some(e => e.kind === 'district' && e.on));
  const none = L.events(plan, { ...settings, eventDefaults: 'none' }, services);
  assert.ok(none.every(e => !e.on));
  const ticked = L.events({ ...plan, events: { [none[0].id]: true } }, { ...settings, eventDefaults: 'none' }, services);
  assert.equal(ticked[0].on, true);
  // the rector's own event is in whatever the default, and lasts an hour and a half in the feed when it has no end
  const own = L.events({ ...plan, own: [{ id: 'a1', date: '2025-10-22', start: '09:30', end: '', title: 'Divine service at Sinoville', note: '' }] }, { ...settings, eventDefaults: 'none' }, services);
  const mine = own.find(e => e.kind === 'own');
  assert.equal(mine.on, true);
  assert.equal(mine.id, 'own|a1');
  const ics = L.buildFeed([{ events: own }], { name: 'Sunnyside', now: new Date('2026-11-15T12:00:00Z') });
  assert.ok(ics.includes('DTSTART:20251022T073000Z'));
  assert.ok(ics.includes('DTEND:20251022T090000Z'));
  assert.ok(ics.includes('SUMMARY:Divine service at Sinoville'));
});

await test('the feed is an iCalendar file with the local times as UTC, whole days for a camp, stable ids', async () => {
  const ics = L.buildFeed([{ events: list }], { name: 'Sunnyside', now: new Date('2026-11-15T12:00:00Z') });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:Sunnyside'));
  assert.ok(ics.includes('DTSTART:20251005T070000Z'));      // 09:00 in South Africa
  assert.ok(ics.includes('DTEND:20251005T083000Z'));        // an hour and a half on a Sunday
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20251010'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20251013'));     // the day after the camp's last day
  assert.ok(ics.includes('UID:2025-10-05-service@nac-study-bible-plan'));
  assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, list.filter(e => e.on).length);
});

await test('the feed\'s mark says what it holds, not when it was built', async () => {
  const at = (when, events = list, name = 'Sunnyside') => L.buildFeed([{ events }], { name, now: new Date(when) });
  const a = at('2026-11-15T12:00:00Z');
  assert.notEqual(a, at('2026-11-21T09:00:00Z'));                       // the stamps differ
  assert.equal(L.feedMark(a), L.feedMark(at('2026-11-21T09:00:00Z')));  // the mark does not
  assert.match(L.feedMark(a), /^[0-9a-f]{8}$/);
  // one event unticked, or another name on the calendar: a new mark, so the feed goes again
  const first = list.findIndex(e => e.on);
  const fewer = list.map((e, i) => (i === first ? { ...e, on: false } : e));
  assert.notEqual(L.feedMark(at('2026-11-15T12:00:00Z', fewer)), L.feedMark(a));
  assert.notEqual(L.feedMark(at('2026-11-15T12:00:00Z', list, 'Gezina')), L.feedMark(a));
  assert.equal(L.fingerprint(''), '811c9dc5');
  assert.equal(L.fingerprint('a'), 'e40c292c');
});

await test('the message for the priests', async () => {
  const text = L.messageText(plan, settings, services, list, 'en-ZA', 'en');
  assert.ok(text.startsWith('*Sunnyside – October 2025*'));
  assert.ok(text.includes('Sun 28 Sept 09:00 – DR K Brown'));
  assert.ok(text.includes('No service'));
  assert.ok(text.includes('*District*'));
  assert.ok(text.includes('Closing of Accounts'));
});

/* ---- writing the column */

await test('a column of our own goes in before Comments, with a merged heading, and the rest of the sheet shifts with it', async () => {
  const values = {};
  for (const s of services) values[plan.days.find(d => d.date === s.date).rows[0]] = s.off ? '' : s.who || 'C';
  const out = await X.writeColumn(bytes, { sheetPath: wb.sheets[0].path, insertAt: plan.columns.comments, header: 'SUNNYSIDE', headerRows: plan.headerRows, width: 14, values });
  const wb2 = await X.openWorkbook(out);
  const sheet2 = await X.readSheet(wb2, wb2.sheets[0]);
  const grid2 = X.toGrid(sheet2);
  const plan2 = L.parseProgramme(grid2, { congregation: 'Sunnyside' });
  assert.equal(plan2.columns.mine, 7);
  assert.equal(plan2.columns.comments, 8);
  assert.equal(plan2.columns.ministries, 9);
  assert.equal(grid2[4][7], 'SUNNYSIDE');
  assert.ok(sheet2.merges.includes('G4:G6'));
  assert.ok(sheet2.merges.includes('A1:K2'), 'the title now spans the new column too');
  assert.ok(sheet2.merges.includes('I4:L4'), 'the Ministries heading moved right');
  assert.equal(plan2.days.find(d => d.date === '2025-09-28').mine, '1');
  assert.equal(plan2.days.find(d => d.date === '2025-10-05').mine, 'C');
  assert.equal(plan2.days.find(d => d.date === '2025-09-24').mine, '');
  assert.equal(plan2.days.find(d => d.date === '2025-10-26').mine, 'AVT');
  assert.equal(plan2.ministers.length, 12);
  assert.deepEqual(plan2.notes, plan.notes);
  const xml = new TextDecoder().decode(await X.entryData(X.unzip(out).get('xl/worksheets/sheet1.xml')));
  assert.ok(/<col min="7" max="7" width="14"/.test(xml), 'the new column has its width');
  assert.ok(/sqref="B7:H53"/.test(xml), 'the conditional format grew over the new column');
  const drawing = new TextDecoder().decode(await X.entryData(X.unzip(out).get('xl/drawings/drawing1.xml')));
  assert.ok(/<(xdr:)?col>7<\/(xdr:)?col>/.test(drawing), 'the picture at G moved to H');
  // and the column already there is written into, in place
  const again = await X.writeColumn(out, { sheetPath: wb2.sheets[0].path, col: 7, values: { 20: 'C2', 21: '' } });
  const grid3 = X.toGrid(await X.readSheet(await X.openWorkbook(again), wb2.sheets[0]));
  assert.equal(grid3[20][7], 'C2');
  assert.equal(grid3[21] && grid3[21][7], undefined);
  assert.equal(grid3[4][7], 'SUNNYSIDE');
});

console.log(`${n} checks passed`);

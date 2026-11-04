/*
 * Reminders: the calendar file.
 *
 * This is how a reminder actually pops up. A web page cannot reliably wake
 * itself on a phone — an iPhone allows that only with a push server behind it
 * — but the phone's own calendar can, and does so every year without the app
 * being opened. Each birthday and anniversary becomes a yearly all-day entry
 * with an alarm, carrying the member's number and a WhatsApp link, so the
 * reminder is enough to act on.
 */
import { t } from './i18n.js';
import { buildUpcoming, coupleName, firstName, isUsablePhone } from './reminders-lib.js';

/** A text field, per RFC 5545. */
const escapeText = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines fold at 75 octets — counted in bytes, since an accented name costs more than one per letter — or calendar apps refuse the file. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }   // a continuation line's leading space costs one
    cur += ch; bytes += size;
  }
  if (cur) out.push(cur);
  return out.map((p, i) => (i ? ' ' + p : p)).join('\r\n');
}

const pad = n => String(n).padStart(2, '0');
const dateStamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const utcStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function describe(event, appUrl) {
  const people = [event.person, ...event.partners];
  const lines = [];
  // the member number first: it is what the Church's own records are looked up by
  lines.push(people.length > 1 ? t('Member nos. {list}', { list: people.map(p => p.memberNo).join(', ') }) : t('Member no. {n}', { n: event.person.memberNo }));
  if (event.type === 'birthday' && event.person.birthYear) lines.push(t('Born {year}', { year: event.person.birthYear }));
  if (event.type === 'anniversary' && event.person.weddingYear) lines.push(t('Married {year}', { year: event.person.weddingYear }));
  for (const p of people) if (isUsablePhone(p.phone)) lines.push(`${firstName(p)}: https://wa.me/${p.phone}`);
  const without = people.filter(p => !isUsablePhone(p.phone));
  if (without.length) lines.push(t('No number on file for {names}', { names: without.map(firstName).join(', ') }));
  if (event.person.notes) lines.push(t('Note: {note}', { note: event.person.notes }));
  if (appUrl) lines.push(t('Write the message: {url}', { url: appUrl }));
  return lines.join('\n');
}

const alarm = (trigger, summary) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(summary)}`, `TRIGGER:${trigger}`, 'END:VALARM'];

function vevent(event, { reminderHour, remindDayBefore, appUrl }, stamp) {
  const names = coupleName([event.person, ...event.partners]);
  const summary = event.type === 'birthday' ? `🎂 ${t('Birthday')} — ${names}` : `💐 ${t('Anniversary')} — ${names}`;
  const start = event.date, end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const hours = Math.min(Math.max(reminderHour, 0), 23);   // an all-day entry starts at midnight; the alarm is measured forward from there
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.type}-${event.person.memberNo}@congregation-reminders`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dateStamp(start)}`,
    `DTEND;VALUE=DATE:${dateStamp(end)}`,
    'RRULE:FREQ=YEARLY',
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(describe(event, appUrl))}`,
    'TRANSP:TRANSPARENT',
    ...alarm(`PT${hours}H`, summary),
  ];
  if (remindDayBefore) lines.push(...alarm(`-PT${24 - hours}H`, t('Tomorrow: {summary}', { summary })));   // back from midnight on the day
  lines.push('END:VEVENT');
  return lines;
}

/**
 * The whole calendar: every member once, on the next occurrence of their date,
 * yearly from there. options: {reminderHour, remindDayBefore, appUrl,
 * congregationName, today}.
 */
export function buildCalendar(people, options) {
  const today = options.today || new Date();
  const events = buildUpcoming(people, { today, lookaheadDays: 366, gracePeriodDays: 0 });   // a year forward catches everyone exactly once
  const name = t('{congregation} birthdays & anniversaries', { congregation: options.congregationName || t('Congregation') });
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NAC Study Bible//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, 'X-WR-TIMEZONE:Africa/Johannesburg',
    ...events.flatMap(e => vevent(e, options, utcStamp(today))),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function calendarBlob(people, options) {
  return new Blob([buildCalendar(people, options)], { type: 'text/calendar;charset=utf-8' });
}

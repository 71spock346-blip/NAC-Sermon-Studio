/*
 * Reminders: the parts that know nothing of the screen.
 *
 * The congregation's Birthday Listing and Marriage Anniversary Listing PDFs
 * are read into a roster of members; from the roster come the dates coming
 * up, who is married to whom, how a person is addressed, and the WhatsApp
 * link that opens with the greeting typed in. Carried over from the standalone
 * Congregation Reminders app; only the screen (reminders.js) is new.
 *
 * Nothing here touches the database or the page, so each piece can be tried
 * in Node against fixture data.
 */
import { t } from './i18n.js';

/* ------------------------------------------------------------------ months */

export const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_NAMES_AF = ['Januarie', 'Februarie', 'Maart', 'April', 'Mei', 'Junie', 'Julie', 'Augustus', 'September', 'Oktober', 'November', 'Desember'];

/** A month cell to 1–12: an English or Afrikaans name, an abbreviation or a number, since the listing can be run in either language. */
export function parseMonth(value) {
  const text = (value || '').trim().toLowerCase();
  if (!text) return undefined;
  if (/^\d{1,2}$/.test(text)) { const n = Number(text); return n >= 1 && n <= 12 ? n : undefined; }
  for (const names of [MONTH_NAMES_EN, MONTH_NAMES_AF]) {
    const exact = names.findIndex(m => m.toLowerCase() === text);
    if (exact >= 0) return exact + 1;
    const prefix = names.findIndex(m => m.toLowerCase().startsWith(text.slice(0, 3)));
    if (text.length >= 3 && prefix >= 0) return prefix + 1;
  }
  return undefined;
}

export function monthName(month, language = 'en') {
  return (language === 'af' ? MONTH_NAMES_AF : MONTH_NAMES_EN)[month - 1] || '';
}

/* ------------------------------------------------------------------- phone */

/** Numbers written in local form are South African. */
export const DEFAULT_COUNTRY_CODE = '27';
const SUBSCRIBER_DIGITS = 9;

/** Two numbers in one box ("082 … / 083 …", "… or 072 …") are split, and the first that works is taken, rather than run together into nonsense. */
function candidates(input) {
  return (input || '').split(/\s*(?:\/|\||,|;|&|\bor\b|\ben\b)\s*/i).map(p => p.replace(/\D/g, '')).filter(Boolean);
}

function normaliseDigits(input, cc) {
  let d = input;
  if (d.startsWith('00')) d = d.slice(2);                                  // 0027…: the international prefix
  // "+27 (0)82 555 0101": the trunk 0 is for dialling locally and must come out once the country code is in front, or the number is a digit too long
  if (d.startsWith(cc + '0') && d.length === cc.length + SUBSCRIBER_DIGITS + 1) d = cc + d.slice(cc.length + 1);
  if (d.startsWith(cc) && d.length >= cc.length + SUBSCRIBER_DIGITS) return d;   // already international
  if (d.startsWith('0')) return cc + d.slice(1);                           // 0821234567
  if (d.length === SUBSCRIBER_DIGITS) return cc + d;                       // 821234567
  return d;
}

/** The bare international digits WhatsApp wants: "082 123 4567" → "27821234567". Empty when there is nothing usable. */
export function normalisePhone(input, cc = DEFAULT_COUNTRY_CODE) {
  const parts = candidates(input);
  for (const p of parts) { const n = normaliseDigits(p, cc); if (isUsablePhone(n)) return n; }
  return parts.length ? normaliseDigits(parts[0], cc) : '';   // the best attempt, so the editor can show what was made of it
}

/** For the screen: +27 82 123 4567. */
export function formatPhone(n) {
  if (!n) return '';
  if (n.startsWith(DEFAULT_COUNTRY_CODE) && n.length === 11) { const s = n.slice(2); return `+27 ${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5)}`; }
  return '+' + n;
}

/** A South African number is the code plus exactly nine digits: strict, so a digit too many or too few is caught here and not in WhatsApp. */
export function isUsablePhone(n) {
  if (!/^\d{10,15}$/.test(n)) return false;
  if (n.startsWith(DEFAULT_COUNTRY_CODE)) return n.length === DEFAULT_COUNTRY_CODE.length + SUBSCRIBER_DIGITS;
  return true;
}

/** What the app makes of what someone typed: {empty, ok, normalised, display, problem}. The editor shows it as they type, so a number is never rejected in silence. */
export function checkPhone(input, cc = DEFAULT_COUNTRY_CODE) {
  const raw = (input || '').trim();
  if (!raw) return { empty: true, ok: false, normalised: '', display: '' };
  const normalised = normalisePhone(raw, cc);
  if (isUsablePhone(normalised)) return { empty: false, ok: true, normalised, display: formatPhone(normalised) };
  const digits = raw.replace(/\D/g, '');
  let problem;
  if (!digits.length) problem = t('That has no digits in it.');
  else if (normalised.startsWith(cc)) {
    const got = normalised.length - cc.length, off = Math.abs(got - SUBSCRIBER_DIGITS);
    problem = got < SUBSCRIBER_DIGITS
      ? (off === 1 ? t('That is 1 digit short — a number needs 9 after the 0, like 082 555 0101.') : t('That is {n} digits short — a number needs 9 after the 0, like 082 555 0101.', { n: off }))
      : (off === 1 ? t('That is 1 digit too many — a number needs 9 after the 0, like 082 555 0101.') : t('That is {n} digits too many — a number needs 9 after the 0, like 082 555 0101.', { n: off }));
  } else problem = t('That does not look like a phone number. Try the form 082 555 0101.');
  return { empty: false, ok: false, normalised, display: '', problem };
}

/* ------------------------------------------------------------------ names */

export function titleCase(value) {
  return String(value || '').toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

/** "Kayden Liebenberg", honouring a preferred name set by hand. */
export function displayName(p) {
  if (p.preferredName) return p.preferredName;
  return `${titleCase(p.firstNames)} ${titleCase(p.surname)}`.trim();
}

/** The first given name, for a warm opening line. */
export function firstName(p) {
  if (p.preferredName) return p.preferredName.split(/\s+/)[0];
  return titleCase((p.firstNames || '').trim().split(/\s+/)[0] || '');
}

/** First given name and surname: every given name overflows a phone-width list. */
export function shortName(p) {
  if (p.preferredName) return p.preferredName;
  return `${firstName(p)} ${titleCase(p.surname)}`.trim();
}

/** "Brandon & Zeldi Nel" when a couple share a surname, otherwise both names in full. */
export function coupleName(people) {
  const named = people.filter(Boolean);
  if (!named.length) return '';
  if (named.length === 1) return shortName(named[0]);
  const same = named.every(p => (p.surname || '').toUpperCase() === (named[0].surname || '').toUpperCase() && !p.preferredName);
  if (same) return `${named.map(firstName).join(' & ')} ${titleCase(named[0].surname)}`;
  return named.map(shortName).join(' & ');
}

export const sortKey = p => `${p.surname} ${p.firstNames}`.toLowerCase();

/* -------------------------------------------------------------- salutation */

/** The listing's ministry abbreviations, spelt out: "Priest Mollentze", not "PR Mollentze". */
const TITLES = {
  BR: ['Brother', 'Broer'], SIS: ['Sister', 'Suster'], SR: ['Sister', 'Suster'], DC: ['Deacon', 'Diaken'],
  PR: ['Priest', 'Priester'], SH: ['Shepherd', 'Herder'], EV: ['Evangelist', 'Evangelis'], DEV: ['District Evangelist', 'Distriksevangelis'],
  BSH: ['Bishop', 'Biskop'], AP: ['Apostle', 'Apostel'], DAP: ['District Apostle', 'Distriksapostel'],
};
const baseTitle = title => String(title || '').replace(/\(.*?\)/g, '').trim().toUpperCase();   // "(RET)" comes off: a retired minister keeps the address

export function titleWord(p, language) {
  const e = TITLES[baseTitle(p.title)];
  return e ? (language === 'af' ? e[1] : e[0]) : '';
}

/** Children and teenagers by first name ("Brother Liebenberg" to a ten-year-old reads as a form letter); adults by title and surname. */
export function salutation(p, language, age) {
  const word = titleWord(p, language);
  if ((age !== undefined && age < 18) || !word) return firstName(p);
  return `${word} ${titleCase(p.surname)}`;
}

/** "Brother and Sister Nel": one address for a couple. */
export function coupleSalutation(people, language) {
  const named = people.filter(Boolean);
  if (!named.length) return '';
  if (named.length === 1) return salutation(named[0], language);
  const joiner = language === 'af' ? ' en ' : ' and ';
  const same = named.every(p => (p.surname || '').toUpperCase() === (named[0].surname || '').toUpperCase());
  const words = named.map(p => titleWord(p, language)).filter(Boolean);
  if (same && words.length === named.length) return `${words.join(joiner)} ${titleCase(named[0].surname)}`;
  return named.map(p => salutation(p, language)).join(joiner);
}

/** "Brandon and Zeldi", for the warmer wordings. */
export function coupleFirstNames(people, language) {
  const names = people.filter(Boolean).map(firstName);
  if (names.length <= 1) return names[0] || '';
  const joiner = language === 'af' ? ' en ' : ' and ';
  return names.slice(0, -1).join(', ') + joiner + names[names.length - 1];
}

/* ------------------------------------------------------------------ roster */

/**
 * Folds a parsed listing into the roster. Listings are re-issued monthly and a
 * member is on both listings, so this is idempotent on member number: the
 * record is updated, never duplicated. `referenceYear` is the year the printed
 * age or years refer to; a birth year is kept, so the numbers stay right next
 * year. Returns {people, added, updated}.
 */
export function mergeListing(existing, listing, referenceYear) {
  const people = { ...existing };
  let added = 0, updated = 0;
  for (const row of listing.rows) {
    const before = people[row.memberNo];
    if (before) updated++; else added++;
    const p = {
      ...before,
      memberNo: row.memberNo,
      title: row.title || (before && before.title) || '',
      surname: row.surname || (before && before.surname) || '',
      firstNames: row.firstNames || (before && before.firstNames) || '',
      phone: row.phone || (before && before.phone) || '',           // a blank cell never wipes a number typed in by hand
      sectionNo: row.sectionNo || (before && before.sectionNo) || '',
      sectionName: row.sectionName || (before && before.sectionName) || '',
    };
    const year = row.count === undefined || Number.isNaN(row.count) ? undefined : referenceYear - row.count;
    if (listing.type === 'birthday') { p.birthday = { month: row.month, day: row.day }; p.birthYear = year; }
    else { p.anniversary = { month: row.month, day: row.day }; p.weddingYear = year; }
    people[row.memberNo] = p;
  }
  return { people: linkSpouses(people), added, updated };
}

/**
 * The anniversary listing prints each partner on a line of their own. Where
 * both are members they are paired on surname, date and wedding year, so one
 * card covers the couple and the greeting names them together.
 */
export function linkSpouses(people) {
  const key = p => [(p.surname || '').toUpperCase(), p.anniversary.month, p.anniversary.day, p.weddingYear ?? '?'].join('|');
  const groups = new Map();
  for (const p of Object.values(people)) {
    if (!p.anniversary) continue;
    const k = key(p);
    if (groups.has(k)) groups.get(k).push(p.memberNo); else groups.set(k, [p.memberNo]);
  }
  const linked = {};
  for (const [no, p] of Object.entries(people)) {
    if (!p.anniversary) { linked[no] = { ...p, spouseMemberNos: undefined }; continue; }
    const others = (groups.get(key(p)) || []).filter(x => x !== no);
    linked[no] = { ...p, spouseMemberNos: others.length ? others : undefined };
  }
  return linked;
}

/** Every distinct section on the roster, for the "my section" picker. */
export function sectionsIn(people) {
  return [...new Set(Object.values(people).map(p => p.sectionName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The roster narrowed to one section. A couple stays whole when either partner is in it. */
export function filterBySection(people, section) {
  if (!section) return people;
  const kept = {};
  for (const [no, p] of Object.entries(people)) {
    const partnerIn = (p.spouseMemberNos || []).some(x => people[x] && people[x].sectionName === section);
    if (p.sectionName === section || partnerIn) kept[no] = p;
  }
  return kept;
}

/* ------------------------------------------------------------------ dates */

const MS_PER_DAY = 86400000;
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);

/** A recurring day in a given year; 29 February falls back to the 28th in a common year (day 0 of the next month is the last day of this one). */
export function occurrenceIn(year, when) {
  const d = new Date(year, when.month - 1, when.day);
  return d.getMonth() !== when.month - 1 ? new Date(year, when.month, 0) : d;
}

/** This year's date while it is within the grace window after passing, otherwise next year's. */
export function nextOccurrence(today, when, graceDays) {
  const thisYear = occurrenceIn(today.getFullYear(), when);
  return daysBetween(today, thisYear) >= -graceDays ? thisYear : occurrenceIn(today.getFullYear() + 1, when);
}

export const isAgeMilestone = age => age > 0 && ([1, 16, 18, 21].includes(age) || (age >= 20 && age % 10 === 0) || (age >= 60 && age % 5 === 0));
export const isAnniversaryMilestone = y => y > 0 && (y === 1 || y % 5 === 0);

/** "Brother and Sister Nel" rather than the other way round. */
function coupleOrder(a, b) {
  const rank = p => (/^SIS|^SR\b/.test((p.title || '').toUpperCase()) ? 1 : 0);
  return rank(a) - rank(b) || a.memberNo.localeCompare(b.memberNo);
}

/**
 * The birthdays and anniversaries inside the window, nearest first. A couple
 * appears once, with the partner carried along. Each event:
 * {id, type, person, partners, date, daysAway, count, isMilestone}, where id is
 * '<type>:<memberNo>:<year>', the key a sent mark is kept under.
 */
export function buildUpcoming(people, { today, lookaheadDays, gracePeriodDays = 3 }) {
  const now = startOfDay(today || new Date());
  const events = [], claimed = new Set();
  const make = (type, person, date, count, isMilestone, partners) => ({
    id: `${type}:${person.memberNo}:${date.getFullYear()}`, type, person, partners, date,
    daysAway: daysBetween(now, date), count, isMilestone,
  });
  for (const p of Object.values(people)) {
    if (p.birthday) {
      const date = nextOccurrence(now, p.birthday, gracePeriodDays);
      const age = p.birthYear === undefined ? undefined : date.getFullYear() - p.birthYear;
      events.push(make('birthday', p, date, age, age !== undefined && isAgeMilestone(age), []));
    }
    if (p.anniversary && !claimed.has(p.memberNo)) {
      const couple = [p, ...(p.spouseMemberNos || []).map(no => people[no]).filter(Boolean)].sort(coupleOrder);
      for (const m of couple) claimed.add(m.memberNo);
      const [lead, ...partners] = couple;
      const date = nextOccurrence(now, lead.anniversary, gracePeriodDays);
      const years = lead.weddingYear === undefined ? undefined : date.getFullYear() - lead.weddingYear;
      events.push(make('anniversary', lead, date, years, years !== undefined && isAnniversaryMilestone(years), partners));
    }
  }
  return events.filter(e => e.daysAway <= lookaheadDays).sort((a, b) => a.daysAway - b.daysAway || a.person.surname.localeCompare(b.person.surname));
}

/** "Today", "Tomorrow", "in 3 days", "2 days ago", in the language of the screen. */
export function relativeLabel(daysAway) {
  if (daysAway === 0) return t('Today');
  if (daysAway === 1) return t('Tomorrow');
  if (daysAway === -1) return t('Yesterday');
  if (daysAway < 0) return t('{n} days ago', { n: -daysAway });
  return t('in {n} days', { n: daysAway });
}

/* --------------------------------------------------------------- WhatsApp */

/** WhatsApp's click-to-chat link with the greeting typed in: it opens the chat, nothing is sent until the person presses send. */
export function whatsappLink(phone, message) {
  return isUsablePhone(phone) ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : undefined;
}
export const whatsappShareLink = message => `https://wa.me/?text=${encodeURIComponent(message)}`;

/* ----------------------------------------------------------- the listing */

/*
 * The listing PDFs are a real grid: every cell is its own text item at a fixed
 * x, and the header row says where each column starts. So rather than guess
 * where a surname ends and the first names begin (hopeless with VAN DER
 * MERWE), items are grouped into lines by y and each is put in the column it
 * physically sits in.
 */
const LINE_TOLERANCE = 3;

function groupIntoLines(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const line = lines.find(l => Math.abs(l.y - it.y) <= LINE_TOLERANCE);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.map(l => l.items);
}

/** The header line as column bands, each from its header's left edge to the next header's: right for left-aligned text and right-aligned numbers alike. */
function detectColumns(line, expected) {
  const found = expected.map(label => line.find(i => i.str.trim() === label));
  if (found.some(f => !f)) return null;
  return found.map((it, i) => ({ label: expected[i], start: it.x, end: i + 1 < found.length ? found[i + 1].x : Infinity }));
}

function assign(item, columns) {
  let best = columns[0], bestScore = -Infinity;
  for (const c of columns) {
    const score = Math.min(item.x + Math.max(item.width, 1), c.end) - Math.max(item.x, c.start);
    if (score > bestScore) { best = c; bestScore = score; }   // a tie goes to the earlier column
  }
  return best;
}

/** Every page into rows {cells, raw}; the header repeats on each page and is re-read as it comes. */
export function extractRows(pages, expectedHeaders) {
  const rows = [];
  let columns = null;
  for (const items of pages) {
    for (const line of groupIntoLines(items)) {
      const header = detectColumns(line, expectedHeaders);
      if (header) { columns = header; continue; }
      if (!columns) continue;
      const cells = Object.fromEntries(columns.map(c => [c.label, '']));
      for (const it of line) { const c = assign(it, columns); cells[c.label] = (cells[c.label] + ' ' + it.str.trim()).trim(); }
      const raw = line.map(i => i.str.trim()).filter(Boolean).join(' ');
      if (raw) rows.push({ cells, raw });
    }
  }
  return rows;
}

const COMMON = ['Member No', 'Title', 'Surname', 'First Names', 'Month', 'Day'];
const TAIL = ['Contact Number', 'Section No', 'Section Name'];
const HEADERS = { birthday: [...COMMON, 'Age', ...TAIL], anniversary: [...COMMON, 'Years Married', ...TAIL] };
const COUNT_COLUMN = { birthday: 'Age', anniversary: 'Years Married' };

/** Which listing this is, from its distinctive header. */
export function detectListingType(pages) {
  const text = pages.flat().map(i => i.str).join(' ');
  if (text.includes('Years Married')) return 'anniversary';
  if (text.includes('Age')) return 'birthday';
  return undefined;
}

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
const digitsOnly = v => String(v || '').replace(/\D/g, '');

/** A listing's text items as {type, rows, skipped}; a row missing its number, month or day is reported, not dropped in silence. */
export function parseListing(pages, forcedType) {
  const type = forcedType || detectListingType(pages);
  if (!type) return { type: 'birthday', rows: [], skipped: [t('Could not recognise this as a listing PDF.')] };
  const rows = [], skipped = [];
  for (const { cells, raw } of extractRows(pages, HEADERS[type])) {
    const memberNo = digitsOnly(cells['Member No']);
    const month = parseMonth(cells['Month']);
    const day = Number(digitsOnly(cells['Day']));
    if (!memberNo || !month || !day || day < 1 || day > 31) { skipped.push(raw); continue; }
    const count = digitsOnly(cells[COUNT_COLUMN[type]]);
    rows.push({
      memberNo, title: clean(cells['Title']), surname: clean(cells['Surname']), firstNames: clean(cells['First Names']),
      month, day, count: count ? Number(count) : undefined, phone: normalisePhone(cells['Contact Number'] || ''),
      sectionNo: clean(cells['Section No']), sectionName: clean(cells['Section Name']),
    });
  }
  return { type, rows, skipped };
}

/**
 * Reads a PDF into one list of positioned text items per page, with the
 * app's own pdf.js (vendor/pdfjs/, fetched the first time it is needed, as the
 * altar booklet does). The file never leaves the device.
 */
export async function readListingPdf(data) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableFontFace: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = [];
    for (const it of content.items) if ('str' in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width });
    pages.push(items);
  }
  await doc.destroy();
  return pages;
}

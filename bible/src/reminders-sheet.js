/*
 * Reminders: the Excel round trip with the priests.
 *
 * A priest is far more likely to fill in a spreadsheet than to open an app and
 * tap through a list, so the missing numbers are asked for this way: a workbook
 * of their members with the gaps highlighted goes out, they type into it, and
 * when it comes back only the three columns they were asked to fill — the
 * number, a preferred name, a note — are read, matched on member number. An
 * edit anywhere else cannot quietly corrupt the roster.
 *
 * It is a real .xlsx and not a CSV because Excel turns 27825455201 in a CSV
 * into 2.78E+10, and the number is gone. The two libraries (vendor/
 * write-excel-file.min.js, read-excel-file.min.js, MIT) are fetched the first
 * time they are needed, like the PowerPoint one.
 */
import { t } from './i18n.js';
import { displayName, linkSpouses, formatPhone, isUsablePhone, normalisePhone, monthName } from './reminders-lib.js';

const loaded = {};
/** Loads a vendored script once and resolves to the global it defines. */
function vendor(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(window[global]);
      s.onerror = () => { delete loaded[src]; reject(new Error(t('Could not load {file}. Are you online?', { file: src }))); };
      document.head.append(s);
    });
  }
  return loaded[src];
}

/* The Church's blue for the heading, so the sheet matches the app. */
const BRAND = '0168B5', BRAND_DEEP = '0B4A7A', BRAND_PALE = 'E6F1FA', LINE = 'D7DEE6', INK_2 = '4B5563', AMBER = 'FEF3C7', PAPER = 'F7F7F5';

/*
 * The column headers are matched by name when the sheet comes back, so they
 * stay in English whatever the app's language; the instruction line above
 * them is in the app's language. The three the priest fills in sit together
 * at the right-hand end, where they are easy to reach.
 */
const COLUMNS = ['Member No', 'Title', 'Surname', 'First Names', 'Section', 'Birthday', 'Born', 'Anniversary', 'Married', 'WhatsApp Number', 'Preferred Name', 'Notes'];
const EDITABLE = new Set(['WhatsApp Number', 'Preferred Name', 'Notes']);
const WIDTHS = { 'Member No': 12, Title: 10, Surname: 18, 'First Names': 22, Section: 20, Birthday: 13, Born: 8, Anniversary: 13, Married: 9, 'WhatsApp Number': 20, 'Preferred Name': 18, Notes: 34 };

const headerRow = () => COLUMNS.map(name => ({ value: name, fontWeight: 'bold', color: '#FFFFFF', backgroundColor: '#' + (EDITABLE.has(name) ? BRAND : BRAND_DEEP), align: 'left', wrap: true }));

function personRow(p) {
  const needsNumber = !isUsablePhone(p.phone);
  // everything as text: a number in a number cell loses its leading digits to Excel's formatting
  const cell = (value, editable) => ({ type: String, value: value || undefined, backgroundColor: editable ? '#' + (needsNumber ? AMBER : PAPER) : undefined, borderColor: '#' + LINE, align: 'left' });
  return [
    cell(p.memberNo), cell(p.title), cell(p.surname), cell(p.firstNames), cell(p.sectionName),
    cell(p.birthday ? `${p.birthday.day} ${monthName(p.birthday.month)}` : ''), cell(p.birthYear ? String(p.birthYear) : ''),
    cell(p.anniversary ? `${p.anniversary.day} ${monthName(p.anniversary.month)}` : ''), cell(p.weddingYear ? String(p.weddingYear) : ''),
    cell(isUsablePhone(p.phone) ? formatPhone(p.phone) : '', true),   // the readable form is friendlier to check and type over; normalised again on the way in
    cell(p.preferredName || '', true), cell(p.notes || '', true),
  ];
}

const instructionRow = () => [{
  value: t('Please fill in the highlighted WhatsApp numbers, and correct anything that is wrong. Leave the Member No column alone — it is how the app matches your changes back up. Then send this file back.'),
  span: COLUMNS.length, fontStyle: 'italic', color: '#' + INK_2, backgroundColor: '#' + BRAND_PALE, wrap: true, align: 'left',
}];

const slug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

/** Writes and downloads the workbook of these people; `scope` names the file ("missing numbers", a section). */
export async function exportSpreadsheet(people, scope) {
  const writeXlsxFile = await vendor('vendor/write-excel-file.min.js?v=1', 'writeXlsxFile');
  const rows = Object.values(people).sort((a, b) => `${a.sectionName} ${a.surname} ${a.firstNames}`.localeCompare(`${b.sectionName} ${b.surname} ${b.firstNames}`));
  await writeXlsxFile([instructionRow(), headerRow(), ...rows.map(personRow)], {
    columns: COLUMNS.map(n => ({ width: WIDTHS[n] })),
    sheet: 'Congregants',
    stickyRowsCount: 2,   // the instruction and the headers stay in view down a long section
    fileName: `congregant-details-${slug(scope)}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  });
}

/**
 * Reads a returned workbook. Only the three editable columns are taken; a
 * blank cell means "no change", not "delete"; a number that cannot be made
 * sense of and a row whose member is not on the roster are reported by name
 * rather than dropped — the listing PDF, not a spreadsheet, says who is a
 * member. Returns {people, updated, numbersAdded, unmatched, badNumbers}.
 */
export async function importSpreadsheet(file, current) {
  const readXlsxFile = await vendor('vendor/read-excel-file.min.js?v=1', 'readXlsxFile');
  const grid = await readXlsxFile(file);
  const headerIndex = grid.findIndex(row => row.some(c => String(c ?? '').trim() === 'Member No'));   // wherever it sits: the instruction row may have been deleted
  if (headerIndex < 0) throw new Error(t('This does not look like the congregant sheet — no "Member No" column found.'));
  const header = grid[headerIndex].map(c => String(c ?? '').trim());
  const col = name => header.indexOf(name);
  const memberCol = col('Member No'), phoneCol = col('WhatsApp Number'), preferredCol = col('Preferred Name'), notesCol = col('Notes');
  const people = { ...current }, unmatched = [], badNumbers = [];
  let updated = 0, numbersAdded = 0;
  for (const row of grid.slice(headerIndex + 1)) {
    const memberNo = String(row[memberCol] ?? '').replace(/\D/g, '');
    if (!memberNo) continue;
    const existing = people[memberNo];
    if (!existing) { unmatched.push(memberNo); continue; }
    const rawPhone = phoneCol >= 0 ? String(row[phoneCol] ?? '').trim() : '';
    const phone = rawPhone ? normalisePhone(rawPhone) : '';
    if (rawPhone && !isUsablePhone(phone)) badNumbers.push(`${displayName(existing)}: "${rawPhone}"`);
    const preferred = preferredCol >= 0 ? String(row[preferredCol] ?? '').trim() : '';
    const notes = notesCol >= 0 ? String(row[notesCol] ?? '').trim() : '';
    const next = { ...existing, phone: isUsablePhone(phone) ? phone : existing.phone, preferredName: preferred || existing.preferredName, notes: notes || existing.notes };
    if (next.phone !== existing.phone || next.preferredName !== existing.preferredName || next.notes !== existing.notes) {
      updated++;
      if (!isUsablePhone(existing.phone) && isUsablePhone(next.phone)) numbersAdded++;
      people[memberNo] = next;
    }
  }
  return { people: linkSpouses(people), updated, numbersAdded, unmatched, badNumbers };
}

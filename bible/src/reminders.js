/*
 * Reminders: the congregation's birthdays and wedding anniversaries, with the
 * greeting written and handed to WhatsApp.
 *
 * It was the standalone Congregation Reminders app and is now a tab here. The
 * monthly Birthday Listing and Marriage Anniversary Listing PDFs are read on
 * the device (reminders-lib.js) into a roster; from it come the dates coming
 * up, a wording for each person (reminders-templates.js), a calendar file so
 * the phone itself does the reminding (reminders-ics.js), and a spreadsheet for
 * the priests to fill in the missing numbers (reminders-sheet.js).
 *
 * What is kept: every member is a row of their own in the `reminders` store
 * ('person:<memberNo>'), as is every greeting marked sent ('sent:<event>'),
 * the tab's settings ('settings') and each of the minister's own wordings
 * ('template:<id>'), so they travel with the sync and the backup. One row per
 * member matters: two priests each adding a number keep both, where one row
 * for the roster would have let the last device to save wipe the other's work.
 *
 * #reminders opens the dates coming up, #reminders/people the roster,
 * #reminders/import the listings, #reminders/settings the tab's settings, and
 * #reminders/send/<event> the greeting for one person.
 */
import { el, clear, $, $$, toast, seg, sheet, confirmBox, download, copyText, fmtDate } from './ui.js';
import { state, saveReminder, deleteReminder, uid } from './store.js';
import { t, tn, lang } from './i18n.js';
import * as Lib from './reminders-lib.js';
import { templatesFor, fillPlaceholders } from './reminders-templates.js';
import { calendarBlob } from './reminders-ics.js';

const GRACE_DAYS = 3;   // a date stays listed this long after passing, so a greeting missed over a weekend can still be caught up

const DEFAULTS = { senderName: '', congregationName: '', language: '', includeScripture: true, lookaheadDays: 30, sectionFilter: '', reminderHour: 8, remindDayBefore: false };

let box = null;        // the tab's container, for a redraw from anywhere
let view = 'upcoming';
let search = '';
let onlyMissing = false;

/* ----------------------------------------------------------------- rows */

const rows = kind => state.reminders.filter(r => r.kind === kind);

/** The roster as {memberNo: person}, spouses paired. */
function roster() {
  return Lib.linkSpouses(Object.fromEntries(rows('person').filter(r => r.person && r.person.memberNo).map(r => [r.person.memberNo, r.person])));
}

/** The tab's settings. The signature and congregation fall back to the app's own "You" settings, and the message language to the app's. */
function settings() {
  const row = state.reminders.find(r => r.id === 'settings');
  const s = { ...DEFAULTS, ...((row && row.settings) || {}) };
  if (!s.senderName) s.senderName = state.settings.name || '';
  if (!s.congregationName) s.congregationName = state.settings.congregation || '';
  if (!s.language) s.language = lang();
  return s;
}
async function saveSettings(patch) {
  const row = state.reminders.find(r => r.id === 'settings');
  await saveReminder({ id: 'settings', kind: 'settings', settings: { ...((row && row.settings) || {}), ...patch } });
}

const sentSet = () => new Set(rows('sent').map(r => r.id.slice(5)));
const customTemplates = () => rows('template').map(r => r.template).filter(Boolean);
const visibleRoster = () => Lib.filterBySection(roster(), settings().sectionFilter);

/** Writes a person's row only when something actually changed, so a re-import does not churn every row through the sync. */
async function savePerson(person) {
  const id = 'person:' + person.memberNo;
  const mine = state.reminders.find(r => r.id === id);
  const clean = { ...person }; delete clean.spouseMemberNos;   // pairing is worked out from the roster, not kept
  if (mine && JSON.stringify(mine.person) === JSON.stringify(clean)) return false;
  await saveReminder({ id, kind: 'person', person: clean });
  return true;
}

function upcoming(days) {
  return Lib.buildUpcoming(visibleRoster(), { lookaheadDays: Math.max(days, 7), gracePeriodDays: GRACE_DAYS });
}

/* ------------------------------------------------------------- the tab */

const ICON_CAKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="3.7" r="1.05" fill="currentColor" stroke="none"/><path d="M12 5.4v2.1"/><path d="M5.7 12.3a6.3 6.3 0 0 1 12.6 0z"/><path d="M5.7 12.3 7.1 19.7a1 1 0 0 0 1 .8h7.8a1 1 0 0 0 1-.8l1.4-7.4z"/></svg>';
const ICON_RINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9.2" cy="14.8" r="4.6"/><circle cx="14.8" cy="14.8" r="4.6"/><path d="m12 4.5 2 2.4-2 2.4-2-2.4z"/></svg>';

function section(title, children) {
  return el('section', { class: 'sec' }, [el('div', { class: 'docbar' }, [el('h2', { text: title })]), ...children]);
}

export function render(container, route) {
  box = container;
  const sub = route && route[1];
  if (sub === 'send' && route[2]) { view = 'upcoming'; }
  else if (['people', 'import', 'settings'].includes(sub)) view = sub;
  else if (!sub) view = 'upcoming';

  clear(container);
  container.append(el('p', { class: 'eyebrow', text: t('Reminders') }));
  container.append(el('h2', { class: 'title', text: t('Birthdays and anniversaries') }));

  if (!rows('person').length && view !== 'import' && view !== 'settings') {
    container.append(section(t('Nothing here yet'), [
      el('p', { class: 'small', text: t('Load the congregation’s Birthday Listing and Marriage Anniversary Listing PDFs, and the dates coming up appear here with a greeting ready for each person.') }),
      el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: t('Load a listing'), onclick: () => { location.hash = '#reminders/import'; } })]),
    ]));
    return;
  }

  container.append(seg([['upcoming', 'Coming up'], ['people', 'Congregants'], ['import', 'Listings'], ['settings', 'Settings']], view, v => { location.hash = v === 'upcoming' ? '#reminders' : '#reminders/' + v; }, { block: true, label: t('Reminders') }));

  const body = el('div', { class: 'rem-body' });
  container.append(body);
  if (view === 'upcoming') drawUpcoming(body);
  else if (view === 'people') drawPeople(body);
  else if (view === 'import') drawImport(body);
  else drawSettings(body);

  if (sub === 'send' && route[2]) {
    const ev = upcoming(400).find(e => e.id === decodeURIComponent(route[2]));
    if (ev) composer(ev);
    history.replaceState(null, '', '#reminders');
  }
}

const redraw = () => { if (box) render(box, location.hash.replace(/^#\/?/, '').split('/')); };

/* ----------------------------------------------------------- coming up */

function drawUpcoming(body) {
  const s = settings();
  const events = upcoming(s.lookaheadDays);
  const sent = sentSet();
  const today = events.filter(e => e.daysAway <= 0);
  const week = events.filter(e => e.daysAway > 0 && e.daysAway <= 7);
  const people = visibleRoster();
  const missing = Object.values(people).filter(p => !Lib.isUsablePhone(p.phone)).length;

  body.append(el('div', { class: 'rem-stats' }, [
    stat(today.filter(e => !sent.has(e.id)).length, t('to greet today')),
    stat(week.length, t('in the next 7 days')),
    stat(Object.keys(people).length, s.sectionFilter ? t('in your section') : t('congregants')),
  ]));
  if (!s.senderName) body.append(el('p', { class: 'hint rem-note', text: t('Add your name under Settings so the greetings are signed.') }));
  if (missing) body.append(el('p', { class: 'hint rem-note', text: tn(missing, '{n} congregant has no contact number. Add it under Congregants, or send the list to their priest.', '{n} congregants have no contact number. Add them under Congregants, or send the list to their priest.') }));
  if (s.sectionFilter) body.append(el('p', { class: 'small muted', text: t('Showing {section} only. Change this under Settings.', { section: s.sectionFilter }) }));

  if (!events.length) {
    body.append(el('p', { class: 'muted', text: t('Nothing in the next {n} days.', { n: s.lookaheadDays }) }));
    return;
  }
  const groups = [];
  for (const e of events) {
    const key = e.date.toDateString();
    const g = groups.find(x => x.key === key);
    if (g) g.events.push(e); else groups.push({ key, date: e.date, daysAway: e.daysAway, events: [e] });
  }
  for (const g of groups) {
    body.append(el('h3', { class: 'sub rem-day' }, [
      el('span', { text: `${g.date.getDate()} ${Lib.monthName(g.date.getMonth() + 1, lang())}` }),
      el('span', { class: 'rem-when', text: Lib.relativeLabel(g.daysAway) }),
    ]));
    const list = el('div', { class: 'list' });
    for (const e of g.events) list.append(eventRow(e, sent.has(e.id)));
    body.append(list);
  }
}

const stat = (n, label) => el('div', { class: 'rem-stat' }, [el('div', { class: 'n', text: String(n) }), el('div', { class: 'l', text: label })]);

function eventRow(e, isSent) {
  const people = [e.person, ...e.partners];
  const anyPhone = people.some(p => Lib.isUsablePhone(p.phone));
  const what = e.type === 'birthday'
    ? (e.count !== undefined ? t('Turning {n}', { n: e.count }) : t('Birthday'))
    : (e.count !== undefined ? tn(e.count, '{n} year married', '{n} years married') : t('Anniversary'));
  const meta = el('div', { class: 'rem-meta' }, [el('span', { text: what })]);
  if (e.isMilestone) meta.append(el('span', { class: 'pill warn', text: t('Milestone') }));
  if (isSent) meta.append(el('span', { class: 'badge', text: t('Sent') }));
  if (!anyPhone) meta.append(el('span', { class: 'pill rem-nonum', text: t('No number') }));
  if (e.person.sectionName) meta.append(el('span', { class: 'muted small', text: e.person.sectionName }));
  return el('button', { class: 'item rem-item' + (isSent ? ' sent' : ''), type: 'button', onclick: () => composer(e) }, [
    el('span', { class: 'rem-glyph ' + e.type, html: e.type === 'birthday' ? ICON_CAKE : ICON_RINGS }),
    el('span', { class: 'rem-who' }, [el('span', { class: 'rem-name', text: Lib.coupleName(people) }), meta]),
    el('span', { class: 'pill link', text: t('Message') }),
  ]);
}

/* ------------------------------------------------------------ composer */

/** The greeting for one event: pick a wording, change it if wanted, hand it to WhatsApp. A couple gets a button for each spouse. */
function composer(event) {
  const s = settings();
  const options = templatesFor(event, { language: s.language, includeScripture: s.includeScripture, custom: customTemplates() });
  const ctx = { person: event.person, partners: event.partners, type: event.type, count: event.count, date: event.date, language: s.language, senderName: s.senderName, congregationName: s.congregationName };
  const recipients = [event.person, ...event.partners];
  let chosen = options[0] ? options[0].id : '';
  let edited = false;

  const sh = sheet(Lib.coupleName(recipients), { wide: true });
  const subline = [
    `${event.date.getDate()} ${Lib.monthName(event.date.getMonth() + 1, lang())}`,
    event.count === undefined ? '' : (event.type === 'birthday' ? t('turning {n}', { n: event.count }) : tn(event.count, '{n} year married', '{n} years married')),
    event.isMilestone ? t('milestone') : '',
  ].filter(Boolean).join(' · ');
  sh.body.append(el('p', { class: 'small muted', text: subline }));
  sh.body.append(el('p', { class: 'small muted rem-memberno', text: recipients.map(p => t('No. {n}', { n: p.memberNo })).join(' · ') }));
  if (event.person.notes) sh.body.append(el('p', { class: 'hint rem-note', text: t('Note: {note}', { note: event.person.notes }) }));

  const chips = el('div', { class: 'chips rem-chips', role: 'group', 'aria-label': t('Wording') });
  const ta = el('textarea', { rows: 10, 'aria-label': t('Message') });
  const editedNote = el('p', { class: 'small muted', text: t('Changed by hand — pick a wording above to start again.'), hidden: true });

  const fill = () => {
    const tp = options.find(o => o.id === chosen) || options[0];
    ta.value = tp ? fillPlaceholders(tp.body, ctx) : '';
    ta.dispatchEvent(new Event('input'));
    edited = false; editedNote.hidden = true;
    for (const c of $$('.chip', chips)) { const on = c.dataset.id === chosen; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    refreshLinks();
  };
  for (const o of options) chips.append(el('button', { class: 'chip', type: 'button', text: o.label, dataset: { id: o.id }, onclick: () => { chosen = o.id; fill(); } }));
  ta.addEventListener('input', () => { if (document.activeElement === ta) { edited = true; editedNote.hidden = false; } refreshLinks(); });

  const sendRow = el('div', { class: 'row rem-send' });
  const copyBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Copy message'), onclick: async () => { toast((await copyText(ta.value)) ? t('Copied.') : t('Could not copy.')); } });
  const shareLink = el('a', { class: 'btn small ghost', target: '_blank', rel: 'noreferrer', text: t('Choose the chat in WhatsApp') });
  const sentBtn = el('button', { class: 'btn small ghost', type: 'button' });
  const refreshSent = () => { sentBtn.textContent = sentSet().has(event.id) ? t('Mark as not sent') : t('Mark as sent'); };
  sentBtn.addEventListener('click', async () => { await markSent(event, !sentSet().has(event.id)); refreshSent(); redraw(); });
  refreshSent();

  function refreshLinks() {
    clear(sendRow);
    for (const p of recipients) {
      const link = Lib.whatsappLink(p.phone, ta.value);
      const a = el('a', { class: 'btn rem-wa' + (link ? '' : ' disabled'), href: link || '#', target: '_blank', rel: 'noreferrer', 'aria-disabled': link ? null : 'true',
        text: recipients.length > 1 ? t('Send to {name}', { name: Lib.firstName(p) }) : t('Open in WhatsApp') });
      a.addEventListener('click', ev => { if (!link) { ev.preventDefault(); return; } markSent(event, true).then(() => { refreshSent(); redraw(); }); });
      sendRow.append(a);
    }
    shareLink.href = Lib.whatsappShareLink(ta.value);
  }

  const without = recipients.filter(p => !Lib.isUsablePhone(p.phone));
  sh.body.append(chips, ta, editedNote, sendRow);
  if (without.length) sh.body.append(el('p', { class: 'hint rem-note', text: t('No WhatsApp number on file for {names}. Copy the message, or add a number under Congregants.', { names: without.map(Lib.firstName).join(', ') }) }));
  sh.body.append(el('div', { class: 'row' }, [copyBtn, shareLink, sentBtn]));
  const withNum = recipients.filter(p => Lib.isUsablePhone(p.phone));
  if (withNum.length) sh.body.append(el('p', { class: 'small muted', text: withNum.map(p => `${Lib.firstName(p)}: ${Lib.formatPhone(p.phone)}`).join(' · ') }));
  fill();
}

async function markSent(event, sent) {
  const id = 'sent:' + event.id;
  if (sent) await saveReminder({ id, kind: 'sent', sentAt: new Date().toISOString() });
  else await deleteReminder(id);
}

/* ---------------------------------------------------------- congregants */

function drawPeople(body) {
  const all = visibleRoster();
  const list = Object.values(all);
  const missing = list.filter(p => !Lib.isUsablePhone(p.phone));
  if (!list.length) { body.append(el('p', { class: 'muted', text: t('No congregants yet. Load a listing PDF to begin.') })); return; }

  if (missing.length) {
    body.append(section(tn(missing.length, '{n} congregant has no contact number', '{n} congregants have no contact number'), [
      el('p', { class: 'small', text: t('Add the numbers below, or send the list to the priest who looks after them to fill in.') }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small ghost', type: 'button', text: t('Show just these'), onclick: () => { onlyMissing = true; search = ''; redraw(); } }),
        el('button', { class: 'btn small', type: 'button', text: t('Export them to Excel'), onclick: () => exportPeople(missing, [settings().sectionFilter, t('missing numbers')].filter(Boolean).join(' ')) }),
      ]),
    ]));
  }

  const needle = search.trim().toLowerCase();
  const shown = list.filter(p => (!onlyMissing || !Lib.isUsablePhone(p.phone)) && (!needle || `${p.firstNames} ${p.surname} ${p.memberNo} ${p.sectionName}`.toLowerCase().includes(needle)))
    .sort((a, b) => Lib.sortKey(a).localeCompare(Lib.sortKey(b)));

  const input = el('input', { type: 'search', value: search, placeholder: t('Search by name, member number or section'), 'aria-label': t('Search congregants') });
  input.addEventListener('input', () => { search = input.value; drawList(); });
  const check = el('input', { type: 'checkbox', id: 'rem-only-missing' });
  check.checked = onlyMissing;
  check.addEventListener('change', () => { onlyMissing = check.checked; drawList(); });
  const sec = section(t('Congregants'), [
    el('div', { class: 'row line' }, [input]),
    el('label', { class: 'check', for: 'rem-only-missing' }, [check, ' ', t('Only those without a number')]),
  ]);
  const head = el('div', { class: 'row rem-listhead' });
  const listBox = el('div', { class: 'list' });
  sec.append(head, listBox);
  body.append(sec);

  function drawList() {
    const needle2 = search.trim().toLowerCase();
    const rows2 = list.filter(p => (!onlyMissing || !Lib.isUsablePhone(p.phone)) && (!needle2 || `${p.firstNames} ${p.surname} ${p.memberNo} ${p.sectionName}`.toLowerCase().includes(needle2)))
      .sort((a, b) => Lib.sortKey(a).localeCompare(Lib.sortKey(b)));
    clear(head);
    head.append(
      el('span', { class: 'muted small', text: t('{shown} of {total} shown', { shown: rows2.length, total: list.length }) }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Export these to Excel'), disabled: !rows2.length, onclick: () => exportPeople(rows2, [settings().sectionFilter, onlyMissing ? t('missing numbers') : '', search.trim()].filter(Boolean).join(' ')) }),
    );
    clear(listBox);
    for (const p of rows2) listBox.append(personRow(p, all));
  }
  drawList();
  void shown;
}

function personRow(p, all) {
  const bits = [];
  bits.push(el('span', { class: 'rem-memberno', text: t('No. {n}', { n: p.memberNo }) }));
  if (p.birthday) bits.push(el('span', { text: `🎂 ${p.birthday.day} ${Lib.monthName(p.birthday.month, lang())}${p.birthYear ? ` (${p.birthYear})` : ''}` }));
  if (p.anniversary) bits.push(el('span', { text: `💐 ${p.anniversary.day} ${Lib.monthName(p.anniversary.month, lang())}${p.weddingYear ? ` (${p.weddingYear})` : ''}` }));
  const line2 = el('div', { class: 'rem-meta' }, [
    Lib.isUsablePhone(p.phone) ? el('span', { text: Lib.formatPhone(p.phone) }) : el('span', { class: 'pill rem-nonum', text: t('No number') }),
    p.sectionName ? el('span', { class: 'muted small', text: p.sectionName }) : null,
  ]);
  return el('button', { class: 'item rem-item', type: 'button', onclick: () => editPerson(p, all) }, [
    el('span', { class: 'rem-who' }, [
      el('span', { class: 'rem-name' }, [Lib.displayName(p), ' ', p.title ? el('span', { class: 'pill kind', text: p.title }) : null]),
      el('div', { class: 'rem-meta' }, bits),
      line2,
    ]),
    el('span', { class: 'pill link', text: t('Edit') }),
  ]);
}

/** The editor says as the number is typed what will be saved, or why it cannot be, and refuses an undialable one: the list cannot tell that from no number at all. */
function editPerson(p) {
  const sh = sheet(Lib.displayName(p));
  sh.body.append(el('p', { class: 'small muted rem-memberno', text: t('No. {n}', { n: p.memberNo }) }));
  const phone = el('input', { type: 'tel', value: p.phone ? Lib.formatPhone(p.phone) : '', placeholder: '082 123 4567', autocomplete: 'off' });
  const note = el('p', { class: 'hint small' });
  const pref = el('input', { type: 'text', value: p.preferredName || '', placeholder: Lib.displayName(p) });
  const notes = el('input', { type: 'text', value: p.notes || '', placeholder: t('e.g. recently bereaved — keep it gentle') });
  const save = el('button', { class: 'btn', type: 'button', text: t('Save') });
  const check = () => {
    const c = Lib.checkPhone(phone.value);
    note.textContent = c.ok ? t('Will be saved as {number}', { number: c.display }) : (c.empty ? '' : c.problem);
    note.classList.toggle('error', !c.empty && !c.ok);
    save.disabled = !c.empty && !c.ok;
    return c;
  };
  phone.addEventListener('input', check);
  check();
  save.addEventListener('click', async () => {
    const c = check();
    const next = { ...p, phone: c.ok ? c.normalised : '', preferredName: pref.value.trim() || undefined, notes: notes.value.trim() || undefined };
    await savePerson(next);
    sh.close();
    toast(Lib.isUsablePhone(next.phone) ? t('Saved — {name} is now on {number}.', { name: Lib.displayName(next), number: Lib.formatPhone(next.phone) }) : t('Saved — {name} still has no contact number.', { name: Lib.displayName(next) }));
    redraw();
  });
  sh.body.append(el('div', { class: 'fields two' }, [
    el('label', {}, [el('span', { text: t('WhatsApp number') }), phone, note]),
    el('label', {}, [el('span', { text: t('Preferred name (optional)') }), pref]),
    el('label', { class: 'full' }, [el('span', { text: t('Note, shown when you write to them') }), notes]),
  ]));
  sh.body.append(el('div', { class: 'row end' }, [
    el('button', { class: 'btn ghost danger', type: 'button', text: t('Remove'), onclick: async () => {
      if (!(await confirmBox(t('Remove {name} from the list? A later listing will bring them back.', { name: Lib.displayName(p) }), t('Remove'), true))) return;
      await deleteReminder('person:' + p.memberNo);
      sh.close(); redraw();
    } }),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => sh.close() }),
    save,
  ]));
  setTimeout(() => phone.focus(), 30);
}

async function exportPeople(list, scope) {
  try {
    const { exportSpreadsheet } = await import('./reminders-sheet.js');
    await exportSpreadsheet(Object.fromEntries(list.map(p => [p.memberNo, p])), scope || settings().congregationName || 'congregation');
  } catch (e) { toast(e.message || t('That file could not be made.'), true); }
}

/* -------------------------------------------------------------- listings */

function drawImport(body) {
  const year = el('input', { type: 'number', value: String(new Date().getFullYear()), min: '1900', max: '2200', style: 'max-width: 8em' });
  // November's layout of the listing has no Month column: the month is then taken from the file's name, or from this
  const month = el('select', { style: 'max-width: 12em' }, Array.from({ length: 12 }, (_, i) => el('option', { value: String(i + 1), text: Lib.monthName(i + 1, lang()), selected: i === new Date().getMonth() })));
  const file = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true });
  const results = el('div');
  file.addEventListener('change', async () => {
    const files = [...file.files];
    file.value = '';
    if (!files.length) return;
    clear(results);
    const current = roster();
    let working = current;
    for (const f of files) {
      try {
        const pages = await Lib.readListingPdf(new Uint8Array(await f.arrayBuffer()));
        const namedMonth = Lib.monthInText(f.name);
        const parsed = Lib.parseListing(pages, { month: namedMonth || Number(month.value) });
        if (!parsed.rows.length) {
          // say why, so a scan, the wrong file and a changed layout can be told apart from the phone
          const why = Lib.describeListing(pages);
          const text = why.reason === 'noText'
            ? t('{file}: there is no text in this PDF — it looks like a scan or a picture. Export the listing from the system as a PDF rather than printing or photographing it.', { file: f.name })
            : why.reason === 'noHeader'
              ? t('{file}: the column headings (Member No, Title, Surname … Section Name) were not found, so this does not look like the Birthday or Marriage Anniversary listing. Its first line reads: “{sample}”', { file: f.name, sample: why.sample })
              : t('{file}: the headings were found but none of the {n} lines under them could be read. The first reads: “{sample}”', { file: f.name, n: parsed.skipped.length, sample: String(parsed.skipped[0] || '').slice(0, 90) });
          results.append(el('p', { class: 'hint error', text }));
          continue;
        }
        const m = Lib.mergeListing(working, parsed, Number(year.value) || new Date().getFullYear());
        working = m.people;
        const what = parsed.type === 'birthday' ? tn(parsed.rows.length, '{n} birthday', '{n} birthdays') : tn(parsed.rows.length, '{n} anniversary', '{n} anniversaries');
        const monthNote = !parsed.monthless ? ''
          : namedMonth ? ' ' + t('This listing has no month column; {month} was taken from the file’s name.', { month: Lib.monthName(namedMonth, lang()) })
            : ' ' + t('This listing has no month column; {month} was taken from the month chosen above.', { month: Lib.monthName(Number(month.value), lang()) });
        results.append(el('p', { class: 'small', text: t('{file}: {what} read — {added} new, {updated} updated.', { file: f.name, what, added: m.added, updated: m.updated }) + (parsed.skipped.length ? ' ' + tn(parsed.skipped.length, '{n} line could not be read and was left out.', '{n} lines could not be read and were left out.') : '') + monthNote }));
      } catch (e) { results.append(el('p', { class: 'hint error', text: `${f.name}: ${e.message || t('That file could not be read.')}` })); }
    }
    let written = 0;
    for (const p of Object.values(working)) if (await savePerson(p)) written++;
    if (written) toast(tn(written, '{n} congregant updated.', '{n} congregants updated.'));
  });

  body.append(section(t('Load a listing'), [
    el('p', { class: 'small', text: t('Add the Birthday Listing and Marriage Anniversary Listing PDFs. A member already on the list is updated, not added again, so a fresh listing can be loaded every month. The files are read here on the device.') }),
    el('div', { class: 'fields' }, [
      el('label', {}, [el('span', { text: t('Year the printed ages and years refer to') }), year]),
      el('label', {}, [el('span', { text: t('Month of the listing, when the file does not say') }), month]),
    ]),
    el('p', { class: 'small muted', text: t('The listing prints an age, not a birth year. Set the year it was drawn up in, so the ages stay right in later years. Some listings have no month column: the month is then read from the file’s name (“… November.pdf”), or failing that taken from the choice above.') }),
    el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: t('Choose the PDFs'), onclick: () => file.click() }), file]),
    results,
  ]));

  // a returned spreadsheet
  const xfile = el('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true });
  const xnote = el('p', { class: 'small' });
  xfile.addEventListener('change', async () => {
    const f = xfile.files[0]; xfile.value = '';
    if (!f) return;
    try {
      const { importSpreadsheet } = await import('./reminders-sheet.js');
      const r = await importSpreadsheet(f, roster());
      for (const p of Object.values(r.people)) await savePerson(p);
      const parts = [tn(r.updated, '{n} congregant updated', '{n} congregants updated'), r.numbersAdded ? tn(r.numbersAdded, '{n} new number', '{n} new numbers') : ''].filter(Boolean).join(', ') + '.';
      const warn = [
        r.unmatched.length ? tn(r.unmatched.length, '{n} row had a member number not on your list and was left out.', '{n} rows had a member number not on your list and were left out.') : '',
        r.badNumbers.length ? t('Could not make sense of these numbers: {list}', { list: r.badNumbers.slice(0, 5).join('; ') + (r.badNumbers.length > 5 ? '…' : '') }) : '',
      ].filter(Boolean).join(' ');
      xnote.textContent = parts + (warn ? ' ' + warn : '');
      xnote.classList.toggle('error', !!warn);
    } catch (e) { xnote.textContent = e.message || t('That file could not be read.'); xnote.classList.add('error'); }
  });
  body.append(section(t('A spreadsheet back from a priest'), [
    el('p', { class: 'small', text: t('Under Congregants you can export a spreadsheet of the members still without a number. When a priest sends it back filled in, load it here: only the WhatsApp number, preferred name and notes columns are read, matched on the member number.') }),
    el('div', { class: 'row' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Load a returned spreadsheet'), onclick: () => xfile.click() }), xfile]),
    xnote,
  ]));
}

/* -------------------------------------------------------------- settings */

function drawSettings(body) {
  const s = settings();
  const field = (label, input) => el('label', {}, [el('span', { text: label }), input]);
  const text = (key, placeholder) => { const i = el('input', { type: 'text', value: s[key] || '', placeholder: placeholder || '' }); i.addEventListener('change', () => saveSettings({ [key]: i.value.trim() })); return i; };

  body.append(section(t('How the greetings are signed'), [
    el('div', { class: 'fields two' }, [field(t('Your name, as you sign off'), text('senderName', t('e.g. Priest J Coskey'))), field(t('Congregation'), text('congregationName'))]),
    el('p', { class: 'small muted', text: t('Left blank, these come from your name and congregation under the app’s own Settings.') }),
  ]));

  const langSeg = seg([['en', 'English'], ['af', 'Afrikaans']], s.language, v => saveSettings({ language: v }), { label: t('Language of the greetings') });
  const scripture = el('input', { type: 'checkbox', id: 'rem-scripture' }); scripture.checked = s.includeScripture;
  scripture.addEventListener('change', () => saveSettings({ includeScripture: scripture.checked }));
  const look = el('input', { type: 'number', min: '1', max: '366', value: String(s.lookaheadDays), style: 'max-width: 7em' });
  look.addEventListener('change', () => saveSettings({ lookaheadDays: Math.max(1, Number(look.value) || 30) }));
  const sections = Lib.sectionsIn(roster());
  const sel = el('select', { 'aria-label': t('Section') }, [el('option', { value: '', text: t('The whole congregation') }), ...sections.map(x => el('option', { value: x, text: x, selected: x === s.sectionFilter || null }))]);
  sel.addEventListener('change', () => saveSettings({ sectionFilter: sel.value }).then(redraw));
  body.append(section(t('Greetings'), [
    el('p', { class: 'small', text: t('The language the messages are written in, apart from the language of the app.') }),
    langSeg,
    el('label', { class: 'check', for: 'rem-scripture' }, [scripture, ' ', t('Offer wordings with a scripture verse')]),
    el('div', { class: 'fields two' }, [field(t('Show dates up to this many days ahead'), look), sections.length ? field(t('Whose dates do you see?'), sel) : null]),
    sections.length ? el('p', { class: 'small muted', text: t('Everyone shares the one list. Pick your section and the dates, the counts and the calendar file keep to the members you look after.') }) : null,
  ]));

  const hour = el('select', { 'aria-label': t('Reminder time') }, Array.from({ length: 24 }, (_, h) => el('option', { value: String(h), text: `${String(h).padStart(2, '0')}:00`, selected: h === s.reminderHour || null })));
  hour.addEventListener('change', () => saveSettings({ reminderHour: Number(hour.value) }));
  const dayBefore = el('input', { type: 'checkbox', id: 'rem-daybefore' }); dayBefore.checked = s.remindDayBefore;
  dayBefore.addEventListener('change', () => saveSettings({ remindDayBefore: dayBefore.checked }));
  const count = Object.keys(visibleRoster()).length;
  body.append(section(t('Reminders on your phone'), [
    el('p', { class: 'small', text: t('Save a calendar file and open it: your phone adds every birthday and anniversary as a yearly appointment with an alarm. It goes off each year on its own, whether or not this app is open, and carries the member’s WhatsApp link. Save it again after loading a new listing.') }),
    el('div', { class: 'fields two' }, [field(t('Remind me at'), hour)]),
    el('label', { class: 'check', for: 'rem-daybefore' }, [dayBefore, ' ', t('Also remind me the day before')]),
    el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', disabled: !count, text: t('Save calendar file ({n})', { n: count }), onclick: () => {
      const cur = settings();
      download(calendarBlob(visibleRoster(), { reminderHour: cur.reminderHour, remindDayBefore: cur.remindDayBefore, appUrl: location.href.split('#')[0] + '#reminders', congregationName: cur.congregationName }), 'congregation-reminders.ics');
      toast(t('Saved. Open the file and your phone will offer to add it to your calendar.'));
    } })]),
  ]));

  // the minister's own wordings
  const own = customTemplates();
  const list = el('div', { class: 'list' });
  for (const tp of own) {
    list.append(el('div', { class: 'item rem-item' }, [
      el('span', { class: 'rem-who' }, [el('span', { class: 'rem-name', text: tp.label }), el('span', { class: 'muted small', text: `${tp.type === 'birthday' ? t('Birthday') : t('Anniversary')} · ${tp.language === 'af' ? 'Afrikaans' : 'English'}` })]),
      el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove'), onclick: async () => { await deleteReminder('template:' + tp.id); redraw(); } }),
    ]));
  }
  const kind = el('select', {}, [el('option', { value: 'birthday', text: t('Birthdays') }), el('option', { value: 'anniversary', text: t('Anniversaries') })]);
  const label = el('input', { type: 'text', placeholder: t('e.g. My usual greeting') });
  const bodyTa = el('textarea', { rows: 5, placeholder: 'Dear {salutation}\n\nHappy birthday!\n\n{sender}' });
  const add = el('button', { class: 'btn small', type: 'button', text: t('Add wording'), onclick: async () => {
    if (!label.value.trim() || !bodyTa.value.trim()) return;
    await saveReminder({ id: 'template:' + uid(), kind: 'template', template: { id: uid(), type: kind.value, language: settings().language, label: label.value.trim(), body: bodyTa.value.trim() } });
    redraw();
  } });
  body.append(section(t('Your own wordings'), [
    el('p', { class: 'small', text: t('A wording you add here is offered beside the built-in ones, in the language chosen above. These are filled in for each person:') }),
    el('p', { class: 'small rem-ph', text: '{salutation} {first} {name} {age} {years} {couple} {coupleFirst} {sender} {congregation} {date} {scripture} {toYou}' }),
    own.length ? list : null,
    el('div', { class: 'fields two' }, [field(t('For'), kind), field(t('Name this wording'), label)]),
    bodyTa,
    el('div', { class: 'row' }, [add]),
  ]));

  const sent = rows('sent').length;
  body.append(section(t('Greetings marked sent'), [
    el('p', { class: 'small', text: tn(sent, '{n} greeting is marked as sent. Marks are per person per year, so next year everyone starts fresh.', '{n} greetings are marked as sent. Marks are per person per year, so next year everyone starts fresh.') }),
    el('div', { class: 'row' }, [el('button', { class: 'btn small ghost', type: 'button', disabled: !sent, text: t('Clear the sent marks'), onclick: async () => {
      if (!(await confirmBox(t('Clear every sent mark?'), t('Clear')))) return;
      for (const r of rows('sent')) await deleteReminder(r.id);
      redraw();
    } })]),
  ]));
}

/* ----------------------------------------------------- the old app's file */

/** A backup file from the standalone Congregation Reminders app: {people, sent, settings, customTemplates}. */
export async function importStandalone(data) {
  if (!data || typeof data.people !== 'object') throw new Error(t('Not a Congregation Reminders backup file'));
  let people = 0, sent = 0;
  for (const p of Object.values(data.people)) if (p && p.memberNo && await savePerson(p)) people++;
  for (const key of Object.keys(data.sent || {})) { await saveReminder({ id: 'sent:' + key, kind: 'sent', sentAt: (data.sent[key] && data.sent[key].sentAt) || new Date().toISOString() }); sent++; }
  for (const tp of data.customTemplates || []) if (tp && tp.id && tp.body) await saveReminder({ id: 'template:' + tp.id, kind: 'template', template: tp });
  if (data.settings) {
    const s = data.settings, patch = {};
    for (const k of Object.keys(DEFAULTS)) if (k in s) patch[k] = s[k];
    await saveSettings(patch);
  }
  return { people, sent };
}

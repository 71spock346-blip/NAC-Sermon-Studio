/*
 * The Apostle's own word. Now and then an Apostle or a District Apostle holds
 * a Sunday's divine service and brings a text word of his own instead of the
 * Guide's. The Guide's word for that Sunday is not lost: it rolls to the
 * Wednesday evening service after it, and the Guide's word for that
 * Wednesday falls away (Jerome, November 2026: "Then the Sunday word that
 * would have been rolls to the Wednesday evening service and that Wednesday
 * service word falls away").
 *
 * Such a Sunday is an entry among the preparations with `apostle` ({by: 'AP'
 * or 'DA', name, to: the Wednesday, moved, aside}): the day of his service,
 * his text word once it is known (typed in the service record) and that
 * Sunday's service record (record.js). It goes with the sync and the backup
 * like a preparation, but it is not a sermon of the minister's own: the
 * Prepare list leaves it out, and the Sunday card and the record show it as
 * the Apostle's service.
 *
 * mark() moves the minister's preparation of that Sunday to the Wednesday
 * (its date and its kind of service; a service record already typed on it
 * stays with the Sunday), and sets the preparation of the Wednesday's word
 * aside without a date. Both are written down in the entry, so unmark() ("Put
 * the Guide's word back") puts them back as they were. The Guide's own
 * services follow by rule (guides.js placeOf): the Sunday's is held on the
 * Wednesday and the Wednesday's falls away, so a Guide loaded later, or a
 * preparation started later, lands on the right day too.
 */
import { el, toast, sheet, confirmBox, fmtDate, seg } from './ui.js';
import { t } from './i18n.js';
import { state, saveSermon, deleteSermon } from './store.js';
import { parseRef, formatRef } from './books.js';
import * as Guides from './guides.js';
import * as AI from './ai.js';

/** Who serves: the title, and the letters the district's plan writes before his name ("AP PAGE", "DA LAMBERT"). */
const BY = { AP: 'Apostle', DA: 'District Apostle' };

/** "Apostle Page", in the app's language. */
export const whoServes = s => [t(BY[s.apostle.by] || BY.AP), s.apostle.name].filter(Boolean).join(' ');
/** "AP Page": who conducted the service, as the service record and the district's plan write it. */
export const conductor = s => [s.apostle.by === 'DA' ? 'DA' : 'AP', s.apostle.name].filter(Boolean).join(' ');

/** The kinds of service a Sunday's preparation has, which move with the Guide's word. */
const SUNDAY_KINDS = ['', 'Sunday divine service', 'Divine service for the departed', 'Other'];
/** A preparation of the usual congregation (or of none named), and not such an entry itself. */
function ours(s) {
  if (s.apostle) return false;
  const usual = (state.settings.congregation || '').trim().toLowerCase();
  const c = (s.congregation || '').trim().toLowerCase();
  return !usual || !c || c === usual;
}
const refOfPrep = s => (s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || ''));
/** A Sunday preparation of the minister's own that an Apostle could take with his own word: not one already marked so. */
export const canMark = s => !!(s && s.date && Guides.isSunday(s.date) && ours(s) && SUNDAY_KINDS.includes(s.occasion || '') && !Guides.apostleSunday(s.date));

/** The Guide's word of a day ("Galatians 6:9"), from the Guide in the language usually preached in; '' when no Guide has one. */
function guideWord(date, midweek) {
  const usual = AI.langOf(null);
  const guides = Guides.all().sort((a, b) => (a.language === usual ? 0 : 1) - (b.language === usual ? 0 : 1));
  for (const g of guides) {
    for (const svc of g.services) {
      if (svc.date !== date || (midweek ? svc.kind !== 'midweek' : ['midweek', 'youth', 'children'].includes(svc.kind))) continue;
      const ref = Guides.refOf(svc);
      return ref ? formatRef(ref, state.settings.bookLang) : (svc.reference || '');
    }
  }
  return '';
}

/** What a mark of this Sunday moves: the preparation of the Sunday to the Wednesday, and the Wednesday's aside. */
function plan(date) {
  const to = Guides.midweekAfter(date);
  const moving = state.sermons.filter(s => ours(s) && s.date === date && SUNDAY_KINDS.includes(s.occasion || ''));
  const aside = state.sermons.filter(s => ours(s) && s.date === to && s.occasion === 'Midweek divine service');
  return { to, moving, aside };
}

/** The Guide's word for the Sunday an entry stands on, or the word of the preparation that moved: "Galatians 6:9", or ''. */
export function movedWord(entry) {
  const w = guideWord(entry.date, false);
  if (w) return w;
  const m = (entry.apostle.moved || []).map(x => state.sermons.find(s => s.id === x.id)).find(Boolean);
  return m ? refOfPrep(m) : '';
}

/**
 * Marks a Sunday as held by an Apostle with his own word: the preparation of
 * that Sunday goes to the Wednesday after it, the Wednesday's goes aside
 * without a date, and the entry for his service is made. Gives the entry.
 */
export async function mark(date, { by = 'AP', name = '', word = '' } = {}) {
  const { to, moving, aside } = plan(date);
  const apostle = { by: BY[by] ? by : 'AP', name: String(name || '').trim(), to, moved: [], aside: [] };
  const entry = { date, congregation: state.settings.congregation || '', occasion: 'Sunday divine service', ref: null, refText: '', title: '', theme: '', hymns: { opening: '', sermon: '', communion: '', closing: '' }, status: 'draft', apostle };
  const typed = String(word || '').trim();
  if (typed) { const ref = parseRef(typed); entry.ref = ref || null; entry.refText = ref ? formatRef(ref, state.settings.bookLang) : typed; }
  for (const s of moving) {
    const m = { id: s.id, date: s.date, occasion: s.occasion || '' };
    // a record typed in already is the record of this Sunday's service, which is now his: it stays on the Sunday
    if (s.record && !entry.record) {
      entry.record = s.record;
      const was = entry.record.conductedBy || '';
      if (!was || was === (state.settings.name || '')) { entry.record.conductedBy = conductor(entry); m.conductedBy = was; }   // he conducted it: "AP Page"
      delete s.record;
      m.record = true;
    }
    apostle.moved.push(m);
    s.date = to;
    s.occasion = 'Midweek divine service';
  }
  for (const s of aside) {
    apostle.aside.push({ id: s.id, date: s.date });
    s.date = '';
  }
  const saved = await saveSermon(entry);   // first, so a record that moved to it is never only in memory
  for (const s of [...moving, ...aside]) await saveSermon(s);
  return saved;
}

/** Puts the Guide's word back on the Sunday: the preparations as they were (a record that came from one goes back to it), and the entry gone. */
export async function unmark(entry) {
  const a = entry.apostle;
  for (const m of a.moved || []) {
    const s = state.sermons.find(x => x.id === m.id);
    if (!s || s.date !== a.to) continue;   // moved again by hand since: left where it is
    s.date = m.date;
    s.occasion = m.occasion || 'Sunday divine service';
    if (m.record && entry.record && !s.record) {
      s.record = entry.record;
      if ('conductedBy' in m && s.record.conductedBy === conductor(entry)) s.record.conductedBy = m.conductedBy;   // the minister's name again, as it was
    }
    await saveSermon(s);
  }
  for (const x of a.aside || []) {
    const s = state.sermons.find(y => y.id === x.id);
    if (s && !s.date) { s.date = x.date; await saveSermon(s); }
  }
  await deleteSermon(entry.id);
}

/**
 * The sheet that marks a Sunday as the Apostle's, with his own word: who
 * serves, his name and, when it is known, his text word. onDone(entry) once
 * it is marked, onDone(null) when the toast's Undo takes it back.
 */
export function markSheet(date, onDone) {
  const { to, moving, aside } = plan(date);
  const sh = sheet(t('The Apostle\'s own word'));
  let by = 'AP';
  const name = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'words', placeholder: t('e.g. Page') });
  const word = el('input', { type: 'text', autocomplete: 'off', placeholder: t('e.g. Matthew 5:9') });
  const sunday = fmtDate(date, true), wednesday = fmtDate(to, true);
  const sunWord = guideWord(date, false) || (moving[0] ? refOfPrep(moving[0]) : '');
  const wedWord = guideWord(to, true) || (aside[0] ? refOfPrep(aside[0]) : '');
  const says = [
    t('His own word takes the place of the Guide\'s on {sunday}.', { sunday }),
    sunWord ? t('The Guide\'s word for that Sunday, {ref}, moves to {wednesday}.', { ref: sunWord, wednesday }) : t('The Guide\'s word for that Sunday moves to {wednesday}.', { wednesday }),
    moving.length ? t('Your preparation of it moves with it.') : '',
    wedWord ? t('The Guide\'s word for {wednesday}, {ref}, falls away.', { ref: wedWord, wednesday }) : t('The Guide\'s word for {wednesday} falls away.', { wednesday }),
    aside.length ? t('Your preparation of that word stays under Prepare, without a date.') : '',
  ].filter(Boolean);
  const go = el('button', { class: 'btn', type: 'button', text: t('Move the Guide\'s word'), onclick: async () => {
    go.disabled = true;
    const entry = await mark(date, { by, name: name.value, word: word.value });
    sh.close();
    onDone(entry);
    toast(t('The Guide\'s word is on {date} now.', { date: wednesday }), false, async () => { await unmark(entry); onDone(null); });
  } });
  sh.body.append(
    el('p', { class: 'apostle-says', text: says.join(' ') }),
    el('div', { class: 'f' }, [el('span', { text: t('Who serves') }), seg([['AP', 'Apostle'], ['DA', 'District Apostle']], by, v => { by = v; }, { label: t('Who serves') })]),
    el('label', { class: 'f' }, [el('span', { text: t('His name') }), name]),
    el('label', { class: 'f' }, [el('span', { text: t('His text word, if you know it') }), word]),
    el('p', { class: 'small muted', text: t('You can type his text word in the service record later. This can be undone.') }),
    el('div', { class: 'row end' }, [el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => sh.close() }), go]),
  );
  setTimeout(() => name.focus(), 30);
}

/** "Apostle Page serves with his own word. The Guide's word for this Sunday, Galatians 6:9, is on Wed, 25 Nov 2026." */
export function apostleLine(entry) {
  const w = movedWord(entry);
  const date = fmtDate(entry.apostle.to || Guides.midweekAfter(entry.date), true);
  return [
    t('{who} serves with his own word.', { who: whoServes(entry) }),
    w ? t('The Guide\'s word for this Sunday, {ref}, is on {date}.', { ref: w, date }) : t('The Guide\'s word for this Sunday is on {date}.', { date }),
  ].join(' ');
}

/** "Put the Guide's word back": asks first (and says so when his service record would go with it), then undoes the mark; onDone() after. */
export function backButton(entry, onDone) {
  return el('button', { class: 'btn small ghost', type: 'button', text: t('Put the Guide\'s word back'), onclick: async () => {
    const sunday = fmtDate(entry.date, true);
    const msg = t('Put the Guide\'s word back on {sunday}? Your preparation goes back to that Sunday, and the Wednesday\'s word comes back.', { sunday })
      + (entry.record && !(entry.apostle.moved || []).some(m => m.record) ? ' ' + t('The service record of his service is deleted.') : '');
    if (!(await confirmBox(msg, t('Put it back')))) return;
    await unmark(entry);
    toast(t('The Guide\'s word is back on {date}.', { date: sunday }));
    onDone();
  } });
}

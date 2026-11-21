/*
 * One preparation as a file, from one minister to another.
 *
 * "Send to a minister" under "Print or save" (prepare.js) makes a small file
 * of one preparation and hands it to the phone's share sheet (WhatsApp,
 * e-mail) or, on a PC, saves it to send by hand. On the other device the file
 * lands under Prepare as that minister's own copy, a draft to change: shared
 * to the installed app from WhatsApp (manifest.json share_target, sw.js,
 * files.js takeShared), or picked with "Open the file" at the foot of the
 * Prepare list (pick). No account and no key is needed, and nothing goes
 * through the site; a rector hands a service to a priest this way, or a
 * priest asks the rector to look at his.
 *
 * The file carries the person's own words and choices (KEYS below): the
 * service and its hymns, the text word, the title and message, the
 * introduction, the main points with the thoughts under them, the context,
 * the summary and conclusion, the illustrations and the words on the cards.
 * It leaves behind what is the sender's alone: the status, the reflection
 * after the service, the slides of the reflection evening, Claude's
 * suggestions and the voice of the recording. The copy remembers who sent it
 * (s.from) and is linked to the same service of the Guide when that Guide is
 * loaded on the receiving device. The same preparation sent again replaces
 * the copy, after a question.
 */
import { el, toast, confirmBox, shareOrSave, fmtDate } from './ui.js';
import { state, saveSermon, uid } from './store.js';
import { t } from './i18n.js';
import { formatRef } from './books.js';
import * as Guides from './guides.js';
import * as AI from './ai.js';
import * as Hymn from './hymns.js';

export const FILE_APP = 'nac-study-bible-preparation';

/** The parts of a preparation that travel: the boxes of the form, nothing of the device or of Claude. */
const KEYS = ['date', 'congregation', 'occasion', 'title', 'hymns', 'audience', 'people', 'lang',
  'ref', 'refText', 'translation', 'translationId', 'text',
  'theme', 'core', 'guide', 'context', 'keywords', 'catechism', 'catechismText', 'crossRefs',
  'intro', 'summary', 'application', 'illustrations', 'conclusion', 'cues'];
const TEXT = new Set(KEYS.filter(k => !['hymns', 'ref', 'catechism', 'cues'].includes(k)));   // the keys that hold one string
const str = v => (typeof v === 'string' ? v : (v === undefined || v === null ? '' : String(v)));
const has = v => !!str(v).trim();

/**
 * The preparation's travelling parts, each in the shape the editor expects.
 * It reads the sender's preparation when the file is made and the file's
 * when it is opened, so a file from anywhere brings in only what the editor
 * knows (KEYS), each part as text, a list or the few fields of a reference.
 */
export function pack(p) {
  const s = {};
  for (const k of KEYS) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (TEXT.has(k)) s[k] = str(v);
    else if (k === 'hymns' && typeof v === 'object') { s.hymns = Hymn.blank(); for (const slot of Hymn.SLOTS) s.hymns[slot] = str(v[slot]); }
    else if (k === 'ref' && typeof v === 'object' && v.book && v.chapter) {
      s.ref = { book: str(v.book), chapter: Number(v.chapter) || 0 };
      if (v.verse) s.ref.verse = Number(v.verse) || 0;
      if (v.verseEnd) s.ref.verseEnd = Number(v.verseEnd) || 0;
    } else if (k === 'catechism' && Array.isArray(v)) s.catechism = v.filter(c => c && typeof c === 'object').map(c => ({ n: typeof c.n === 'number' ? c.n : str(c.n), title: str(c.title) }));
    else if (k === 'cues' && typeof v === 'object') { s.cues = {}; for (const [key, val] of Object.entries(v)) if (typeof val === 'string') s.cues[key] = val; }
  }
  s.points = (Array.isArray(p.points) ? p.points : []).filter(x => x && typeof x === 'object').map(x => {
    const q = { heading: str(x.heading), body: str(x.body) };
    if (has(x.cues)) q.cues = str(x.cues);
    if (has(x.thought)) q.thought = str(x.thought);
    if (x.guide) q.guide = typeof x.guide === 'number' ? x.guide : true;   // the "Guide" mark: the point came from the Guide's article
    return q;
  });
  return s;
}

/** Whether a preparation (or a file's) has anything in it worth carrying. */
export const hasContent = p => !!p && typeof p === 'object' && (!!p.ref || has(p.refText) || has(p.text) || has(p.title) || has(p.theme) || has(p.intro)
  || (Array.isArray(p.points) && p.points.some(x => x && (has(x.heading) || has(x.body)))));

/** The file as it is sent: who sends it, and the preparation (pack). */
export function file(s) {
  return {
    app: FILE_APP, version: 1, builtAt: new Date().toISOString(),
    id: s.id,   // the same preparation sent again is known by it on the other device
    from: { name: str(state.settings.name).trim(), congregation: str(state.settings.congregation).trim() },
    preparation: pack(s),
  };
}

/** "22 Nov 2026, Galatians 6:9": the service in a few words, for the toasts and the share sheet. */
export function label(s) {
  const ref = s.ref ? formatRef(s.ref, state.settings.bookLang) : str(s.refText).trim();
  return [fmtDate(s.date), ref || str(s.title).trim()].filter(Boolean).join(', ');
}

/** "Preparation-2026-11-22-Galatians-6-9.json" */
export function fileNameFor(s) {
  const ref = s.ref ? formatRef(s.ref, state.settings.bookLang) : str(s.refText).trim();
  return [t('Preparation'), str(s.date), ref || str(s.title).trim()].filter(Boolean).join(' ').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') + '.json';
}

/** "Send to a minister": the share sheet on a phone (WhatsApp is in it), a saved file on a PC. Resolves to 'shared', 'saved' or 'cancelled'. */
export async function send(s) {
  const name = fileNameFor(s);
  const blob = new Blob([JSON.stringify(file(s))], { type: 'application/json' });
  const r = await shareOrSave(blob, name, 'application/json', `${t('Service preparation')}: ${label(s)}`);
  if (r === 'saved') toast(t('Saved as "{file}". Send it to the other minister by WhatsApp or e-mail; it opens under Prepare with "Open the file".', { file: name }));
  return r;
}

/** Whether parsed JSON is a preparation file from the app. */
export const isFile = data => !!(data && typeof data === 'object' && data.app === FILE_APP);

/**
 * Opens a file that may be a preparation another minister sent. Resolves to
 * null when it is not one (nothing is said, so the caller can try the Guide
 * file), to the copy saved when it is, and to false when it is one that
 * could not be taken or the person said no.
 */
export async function readFile(f) {
  if (!f || f.size > 5 * 1024 * 1024) return null;
  let data = null;
  try { data = JSON.parse(await f.text()); } catch (e) { return null; }
  if (!isFile(data)) return null;
  return take(data);
}

/**
 * Takes the preparation in a file as this person's own copy: a draft with a
 * new id, the sender remembered under s.from, linked to the Guide's service
 * when that Guide is here. Sent again, the same preparation replaces the
 * earlier copy after a question; one's own preparation coming back is added
 * as a second copy after a question.
 */
export async function take(data) {
  const p = data.preparation;
  if (!hasContent(p)) { toast(t('There is no preparation in that file.'), true); return false; }
  const from = data.from && typeof data.from === 'object' ? data.from : {};
  const who = [from.name, from.congregation].map(x => str(x).trim()).filter(Boolean).join(', ');
  const s = pack(p);
  s.id = uid();
  s.status = 'draft';
  s.from = { id: str(data.id), who, at: str(data.builtAt) || new Date().toISOString() };
  if (!s.hymns) s.hymns = Hymn.blank();
  if (!s.catechism) s.catechism = [];
  if (!s.catechismText) s.catechismText = 'full';
  if (!s.points.length) s.points = [{ heading: '', body: '' }, { heading: '', body: '' }, { heading: '', body: '' }];
  const twin = data.id ? state.sermons.find(x => x.id === data.id || (x.from && x.from.id === data.id)) : null;
  if (twin && twin.id === data.id) {
    if (!(await confirmBox(t('This preparation is on this device already: {service}. Add the file as a second copy?', { service: label(twin) }), t('Add a copy')))) return false;
  } else if (twin) {
    if (!(await confirmBox(t('You already have this preparation from {who}: {service}. Put this file in its place? Changes made to your copy are lost.', { who: (twin.from && twin.from.who) || who || t('a minister'), service: label(twin) }), t('Replace')))) return false;
    s.id = twin.id;
    s.created = twin.created;
  }
  const m = s.ref ? Guides.matchService(s.ref, AI.langOf(s)) : null;   // the same service in a Guide loaded here, so the article and the Guide's cues come along
  if (m) s.guideLink = { guideId: m.guide.id, i: m.i };
  await saveSermon(s);
  toast(who ? t('Added to your preparations: {service}, from {who}.', { service: label(s), who }) : t('Added to your preparations: {service}.', { service: label(s) }));
  location.hash = `#prepare/${s.id}`;
  return s;
}

/** "Open the file" under Prepare: picks the file another minister sent. A Guide file picked here loads where it belongs. */
export function pick() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    if (await readFile(f) !== null) return;
    let data = null;
    try { data = JSON.parse(await f.text()); } catch (e) { /* not JSON: said below */ }
    if (data && data.app === Guides.FILE_APP) { await Guides.readFile(f); return; }
    toast(t('That is not a preparation from this app. Ask the minister who sent it to use "Send to a minister" in the app.'), true);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

/** The line at the top of a copy another minister sent: "Sent by {who} on {date}." */
export function fromLine(s) {
  if (!s.from || !s.from.who) return null;
  return el('p', { class: 'muted small from-line', text: t('Sent by {who} on {date}.', { who: s.from.who, date: fmtDate(s.from.at) }) });
}

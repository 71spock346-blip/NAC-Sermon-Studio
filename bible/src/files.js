/*
 * Church files: one screen for the Church's own texts. They are the Church's
 * copyright, so they are not part of the public app: the minister loads each
 * one once, from its own file, and the app reads it on the device itself,
 * with no key and no helper. A row per file says whether it is on this
 * device, with one Load button, and Remove once it is loaded; what is loaded
 * reaches the other devices through the sync and is not in the backup file.
 *
 * The files: the text of the Catechism (catechism.js shows it), the altar
 * booklet in English and in Afrikaans (liturgy.js), the handbooks for
 * ministers (handbooks.js) and the Divine Service Guides (guides.js). Claude
 * reads a Guide's PDF, so only an unlocked device offers that; any device
 * loads the Guide file another minister sent, and sends the month's Guide on
 * as such a file. Until November 2026 each loaded in a place of its own, the
 * booklet under Liturgy, the handbooks under Handbooks, the Catechism under
 * Settings and the Guide under Prepare, which a new minister could not find;
 * those places now point here. Prepare keeps its Guide card, since the Guide
 * is read there.
 *
 * On an installed phone app, the share sheet of WhatsApp lists the app
 * (manifest.json share_target): a Guide file shared to it comes through sw.js
 * to #files/shared, and takeShared() loads it as if it had been picked here.
 *
 * The Catechism's own PDF is read here as the booklet and the handbooks are:
 * pdf.js takes the pieces of text off every page (booklet.js readPages) and
 * catechism-pdf.js gathers them into the sections of the built-in index
 * (data/catechism.json). Until November 2026 the text came as a JSON file
 * that tools/build_catechism.py made on a PC from the PDF's text, which no
 * other minister could make; such a file still loads here.
 *
 * #files opens the screen: on a PC from the side menu, before Settings; on a
 * phone from a row under More (more.js).
 */
import { $, el, clear, toast, confirmBox, busy, fmtDate } from './ui.js';
import { state, saveCatechismText, deleteCatechismText } from './store.js';
import { t } from './i18n.js';
import * as Cat from './catechism.js';
import * as Liturgy from './liturgy.js';
import * as Handbooks from './handbooks.js';
import * as Guides from './guides.js';
import * as PrepFile from './prepfile.js';   // a preparation another minister sent: the same share sheet brings it here, and it goes on to Prepare
import * as AI from './ai.js';
import * as Sync from './sync.js';
import { KNOWN } from './handbook.js';

/** One line on each handbook the app knows by name, for its row while it is not loaded yet. */
const ABOUT = {
  'guide-for-ministers': () => t('The rule book for ministers: ministry, the divine service, the sacraments and acts of blessing, pastoral care, administration, and the competency profiles.'),
  'serving-and-leading': () => t('The guiding principle for everyone who leads in the Church: serving, authority, delegation, communication, conflict resolution.'),
  'liturgy': () => t('The full liturgy book of 2024: the divine service in its short and long form, the special services, the sacraments and every act of blessing.'),
};

let root = null;   // the screen, so a row can draw it again after a load or a removal

export function render(container, parts = []) {
  root = container;
  clear(container);
  if (parts[1] === 'shared') takeShared();   // a file shared to the app (sw.js): loaded once the screen stands
  const list = el('div', { class: 'files-list' }, [
    catechismRow(),
    ...Liturgy.LANGS.map(bookletRow),
    ...handbookRows(),
    el('div', { class: 'row files-more' }, [el('button', { class: 'btn small ghost', type: 'button', text: t('Load another handbook'), onclick: loadHandbook })]),
    guidesRow(),
  ]);
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('Church files') })]),
    el('p', { class: 'files-lead', text: t('The Church\'s own books are not part of the app. Load each one here once, from its own file: the app reads it on this device itself, and it reaches your other devices through the sync. Each row says what is on this device.') }),
    list,
    el('p', { class: 'muted small files-note', text: t('What is loaded here is the Church\'s copyright, for your own work as a minister. It stays on your devices and is not in the backup file.') }),
  );
}

/** The screen drawn again after a change, while it is the one open. */
function redraw() {
  if (root && /^#\/?files/.test(location.hash)) render(root);
}

/* ---------------------------------------------------------------- the rows */

/** One file: the icon of its section, its name, Loaded or Not loaded, a line on each copy on the device (or on what the file is), and the buttons. */
function fileRow({ icon, title, loaded, lines = [], about = '', buttons, lang = null }) {
  const name = el('b', { text: title });
  if (lang) name.lang = lang;
  return el('div', { class: 'file-row' + (loaded ? ' on' : '') }, [
    iconOf(icon),
    el('div', { class: 'grow' }, [
      el('div', { class: 'file-head' }, [name, el('span', { class: 'file-state', text: loaded ? t('Loaded') : t('Not loaded') })]),
      ...lines.map(x => el('div', { class: 'small file-line', text: x })),
      about ? el('div', { class: 'muted small file-about', text: about }) : null,
      el('div', { class: 'row' }, buttons),
    ]),
  ]);
}

/** The icon of a section, copied from its button in the menu (index.html), so the row and the section match. */
function iconOf(key) {
  const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
  const svg = $(`#tab-btn-${key} .ico svg`);
  if (svg) span.append(svg.cloneNode(true));
  return span;
}

const languageName = l => (l === 'af' ? t('Afrikaans') : l === 'de' ? t('German') : t('English'));

/** The Catechism's text: read here from its PDF, or from the text file an earlier build made. */
function catechismRow() {
  const meta = state.catechism;
  return fileRow({
    icon: 'catechism',
    title: t('Catechism of the New Apostolic Church'),
    loaded: !!meta,
    lines: meta ? [t('{n} sections, loaded {date} from {file}.', { n: meta.sections, date: fmtDate(meta.loadedAt), file: meta.fileName || t('a file') }) + (meta.edition ? ' ' + meta.edition + '.' : '')] : [],
    about: meta ? '' : t('The text of every section, read here from the Church\'s own PDF of the Catechism. With it you read each section in the app, search the Catechism by word and print the sections you tick into your sermon notes; without it, each section links to nak.org.'),
    buttons: [
      el('button', { class: 'btn small' + (meta ? ' ghost' : ''), type: 'button', text: meta ? t('Load a newer file') : t('Load the Catechism (PDF)'), onclick: () => pick('application/pdf,.pdf,application/json,.json', readCatechism) }),
      meta ? el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove'), onclick: removeCatechism }) : null,
    ],
  });
}

/** The altar booklet in one language (liturgy.js): "Liturgy for altar use", the words at the altar card by card. */
function bookletRow(l) {
  const b = Liturgy.booklet(l);
  return fileRow({
    icon: 'liturgy',
    title: l === 'af' ? t('Altar booklet, Afrikaans') : t('Altar booklet, English'),
    loaded: !!b,
    lines: b ? [t('{cover}, {n} cards, loaded {date} from {file}.', { cover: b.cover || t('Liturgy for altar use'), n: b.cards.length, date: fmtDate(b.loadedAt), file: b.fileName || 'PDF' })] : [],
    about: b ? '' : l === 'af' ? t('The same booklet in Afrikaans.') : t('The words said at the altar, card by card, from the Church\'s booklet "Liturgy for altar use": the divine service and each act of blessing.'),
    buttons: [
      el('button', { class: 'btn small' + (b ? ' ghost' : ''), type: 'button', text: b ? t('Load a newer file') : t('Load it (PDF)'), onclick: async () => {
        if (await Liturgy.mayReplace(b)) pick('application/pdf,.pdf', async file => { if (await Liturgy.read(file)) redraw(); });
      } }),
      b ? el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove'), onclick: () => Liturgy.remove(l, redraw) }) : null,
    ],
  });
}

/** The handbooks (handbooks.js): the ones the app knows by name, loaded or not, then any other loaded from its file. */
function handbookRows() {
  const keys = [...KNOWN.map(([key]) => key), ...state.handbooks.map(h => h.key).filter(k => !KNOWN.some(([key]) => key === k))];
  return [...new Set(keys)].map(key => {
    const all = Handbooks.copies(key);
    const known = KNOWN.find(([k]) => k === key);
    return fileRow({
      icon: 'handbooks',
      title: all[0] ? all[0].title : known[2],
      lang: all[0] ? all[0].language : null,
      loaded: all.length > 0,
      lines: all.map(hb => t('{language}, {about}, loaded {date} from {file}.', { language: languageName(hb.language), about: Handbooks.aboutLine(hb), date: fmtDate(hb.loadedAt), file: hb.fileName || t('a file') })),
      about: !all.length && ABOUT[key] ? ABOUT[key]() : '',
      buttons: [
        el('button', { class: 'btn small' + (all.length ? ' ghost' : ''), type: 'button', text: all.length ? t('Load a newer file') : t('Load it (PDF or text file)'), onclick: loadHandbook }),
        ...all.map(hb => el('button', { class: 'btn small ghost danger', type: 'button', text: all.length > 1 ? t('Remove ({language})', { language: hb.language.toUpperCase() }) : t('Remove'), onclick: () => Handbooks.remove(hb, redraw) })),
      ],
    });
  });
}

/**
 * The Divine Service Guides (guides.js): the months on this device. Where
 * the helper is unlocked Claude reads the PDF, here or under Prepare; on any
 * device the Guide file another minister sent loads with no key, and the
 * month's Guide goes on to another minister as such a file.
 */
function guidesRow() {
  const months = Guides.months();
  const reads = AI.unlocked();
  return fileRow({
    icon: 'prepare',
    title: t('Divine Service Guides'),
    loaded: months.length > 0,
    lines: months.length ? [t('On this device: {list}.', { list: months.map(m => Guides.monthName(m) + ' (' + m.editions.map(g => Guides.editionLabel(g)).join(', ') + ')').join(', ') })] : [],
    about: reads
      ? t('The month\'s Guide for the divine services, which Claude reads into the services of the month, with their text words, messages and articles; a preparation starts from it. "Send this month\'s Guide" makes a file of it for another minister (WhatsApp on a phone), who loads it here with no key.')
      : t('The month\'s Guide for the divine services: its services with their text words, messages and articles, so a preparation starts with the main points filled in. Another minister sends it to you as a file from the app (WhatsApp on a phone); load that file here.'),
    buttons: [
      reads ? el('button', { class: 'btn small' + (months.length ? ' ghost' : ''), type: 'button', text: t('Load a Guide (PDF)'), onclick: async () => { if (await Guides.load()) redraw(); } }) : null,
      el('button', { class: 'btn small' + (reads || months.length ? ' ghost' : ''), type: 'button', text: t('Load a Guide file'), onclick: () => pick('application/json,.json', async file => { if (await PrepFile.readFile(file) !== null) return; if (await Guides.readFile(file)) redraw(); }) }),   // a preparation picked here by mistake opens under Prepare
      months.length ? el('button', { class: 'btn small', type: 'button', text: t('Send this month\'s Guide'), onclick: () => Guides.sendAny() }) : null,
    ],
  });
}

/* ---------------------------------------------------------------- a file shared to the app */

/*
 * The share sheet of an Android phone lists the installed app (manifest.json
 * share_target). The file shared to it comes as a POST, which sw.js keeps in
 * a cache of its own and answers by opening #files/shared; here the file is
 * taken out of that cache and loaded as if it had been picked: the Guide file
 * another minister sent over WhatsApp.
 */
const SHARED_CACHE = 'bible-shared', SHARED_KEY = 'shared-file';

async function takeShared() {
  let file = null;
  try {
    const c = await caches.open(SHARED_CACHE);
    const res = await c.match(SHARED_KEY);
    if (res) {
      const name = decodeURIComponent(res.headers.get('X-File-Name') || '') || SHARED_KEY;
      file = new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' });
      await c.delete(SHARED_KEY);
    }
  } catch (e) { console.warn(e); }
  history.replaceState(null, '', '#files');   // the address is the screen's own again, so a reload does not look for the file twice
  if (!file) return;
  if (/\.json$/i.test(file.name) || /json/i.test(file.type)) {
    if (await PrepFile.readFile(file) !== null) return;   // a preparation another minister sent: it opens under Prepare (prepfile.js)
    if (await Guides.readFile(file)) redraw();
    return;
  }
  toast(t('The app cannot load that file. It takes a Guide file or a preparation another minister sent from the app.'), true);
}

/* ---------------------------------------------------------------- loading */

/** The file picker; `onFile` gets the file chosen. */
function pick(accept, onFile) {
  const input = el('input', { type: 'file', accept, hidden: true });
  document.body.append(input);
  input.addEventListener('change', async () => { const file = input.files[0]; input.remove(); if (file) await onFile(file); });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

function loadHandbook() {
  pick('application/pdf,.pdf,text/plain,.txt', async file => { if (await Handbooks.read(file)) redraw(); });
}

/** Reads the Catechism's own PDF on the device (catechism-pdf.js), or the text file an earlier build made, and keeps the text in the catechism store. */
async function readCatechism(file) {
  const b = busy(t('Reading the Catechism'));
  try {
    b.say(t('Opening {file}…', { file: file.name }));
    let data, missing = 0;
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      data = { ...JSON.parse(await file.text()), fileName: file.name };
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      const [{ readPages }, { parseCatechism, catechismFile }, index] = await Promise.all([import('./booklet.js'), import('./catechism-pdf.js'), Cat.load()]);
      const pages = await readPages(pdfjs, bytes, (n, total) => b.say(t('Page {n} of {total}', { n, total })));
      b.say(t('Finding the sections…'));
      await new Promise(r => setTimeout(r, 30));   // the sheet shows those words before the parse holds the page for a moment
      let parsed;
      try {
        parsed = parseCatechism(pages, index.sections);
      } catch (e) {
        console.warn(e);
        throw new Error(t('That PDF does not look like the Catechism: its sections were not found in it. It needs the Church\'s own file, the Catechism of the New Apostolic Church as a PDF.'));
      }
      missing = parsed.missing.length;
      data = catechismFile(parsed, file.name);
    }
    const meta = await saveCatechismText(data);
    Cat.forgetText();
    b.done();
    toast(missing ? t('Catechism loaded: {n} sections; {m} of the index were not found in the file.', { n: meta.sections, m: missing }) : t('Catechism loaded: {n} sections.', { n: meta.sections }));
    redraw();
  } catch (e) {
    console.error(e);
    b.fail(e.message || t('The file could not be read.'));
  }
}

async function removeCatechism() {
  const q = Sync.isOn()
    ? t('Remove the text of the Catechism from this device and, through sync, from your other devices? The index stays, and you can load the file again later.')
    : t('Remove the text of the Catechism from this device? The index stays, and you can load the file again later.');
  if (!(await confirmBox(q, t('Remove'), true))) return;
  await deleteCatechismText();
  Cat.forgetText();
  toast(t('Catechism text removed.'));
  redraw();
}

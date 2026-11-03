/*
 * Settings: the language of the app, the API.Bible key and which of its
 * Bibles to show, the person's name and congregation, book-name language,
 * backup, offline texts, and the copyright notices the bundled texts and
 * API.Bible ask for.
 */
import { el, clear, toast, confirmBox, download, today, sheet, busy, fmtDate, seg, copyText, THEMES, SIZES, READS, applyTheme, applyRead } from './ui.js';
import { t, tn, LANGS, requestLang } from './i18n.js';
import { state, saveSetting, exportAll, importAll, clearCache, wipeAll, textCount, exportTexts, importTexts, wipeTexts, saveCatechismText, deleteCatechismText } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as AI from './ai.js';
import * as Sync from './sync.js';
import { BOOKS } from './books.js';

export const VERSION = '0.2.0';

let root = null;   // the Settings tab, so a section can redraw the whole tab after a change

/** One card of settings with its heading. */
function section(title, children) {
  return el('section', { class: 'sec' }, [el('div', { class: 'docbar' }, [el('h2', { text: title })]), ...children]);
}

export function render(container) {
  root = container;
  clear(container);
  const S = state.settings;

  // ---- language
  const uiSeg = seg(LANGS, S.uiLang || 'en', v => requestLang(v), { block: true, label: t('Language of the app') });
  container.append(section(t('Language'), [
    el('label', { class: 'f' }, [t('Language of the app'), uiSeg, el('span', { class: 'hint muted small', text: t('The screens, the buttons, the help page and the headings in the printed notes. Switching also sets the book names and the language of Claude\'s suggestions below; each can be changed on its own afterwards. The Bible text stays in the translation you choose.') })]),
  ]));

  // ---- about you
  const nameInput = el('input', { type: 'text', value: S.name || '', placeholder: t('Your name'), autocomplete: 'name' });
  nameInput.addEventListener('change', () => saveSetting('name', nameInput.value.trim()));
  const congInput = el('input', { type: 'text', value: S.congregation || '', placeholder: t('Your usual congregation') });
  congInput.addEventListener('change', () => saveSetting('congregation', congInput.value.trim()));
  container.append(section(t('You'), [
    el('p', { class: 'small', text: t('Your name goes in the footer of the sermon notes, and the congregation is filled in for each new preparation.') }),
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, [t('Name'), nameInput]),
      el('label', { class: 'f' }, [t('Congregation'), congInput]),
    ]),
  ]));

  syncSection(container);

  // ---- appearance
  const themeSeg = seg(THEMES, S.theme || 'system', async v => { await saveSetting('theme', v); applyTheme(v); }, { block: true, label: t('Look') });
  const sizeSeg = seg(SIZES, S.fontSize || 'm', v => saveSetting('fontSize', v), { block: true, label: t('Text size in the reader') });
  const readSeg = seg(READS, S.readMode || 'book', async v => { await saveSetting('readMode', v); applyRead(v); }, { block: true, label: t('Letters and spacing') });
  const langSel = el('select', {}, [el('option', { value: 'en', text: t('English (Psalm, John, 1 Corinthians)'), selected: S.bookLang !== 'af' }), el('option', { value: 'af', text: t('Afrikaans (Psalms, Johannes, 1 Korintiërs)'), selected: S.bookLang === 'af' })]);
  langSel.addEventListener('change', async () => { await saveSetting('bookLang', langSel.value); toast(t('Book names changed.')); });
  container.append(section(t('Appearance'), [
    el('p', { class: 'small', text: t('How the app looks on this device. The "Aa" button in the reader changes the same things while you read.') }),
    el('div', { class: 'theme-row' }, [
      el('label', { class: 'f' }, [t('Look'), themeSeg, el('span', { class: 'hint muted small', text: t('"White" is the Church\'s blue and white, as on the slides. "Paper" keeps the blue with warm cream pages. "System" is White by day and Dark at night, as this phone or PC is set.') })]),
      el('label', { class: 'f' }, [t('Text size in the reader'), sizeSeg, el('span', { class: 'hint muted small', text: t('"Pulpit" is for reading while standing.') })]),
      el('label', { class: 'f' }, [t('Letters and spacing'), readSeg, el('span', { class: 'hint muted small', text: t('"Easy-read" uses plain letters with more room between them and between the lines, in the whole app. Many people with dyslexia find it easier.') })]),
    ]),
    el('label', { class: 'f' }, [t('Book names'), langSel]),
  ]));

  // ---- translations: the two licensed services, each with its own key
  const trans = section(t('Translations'), [
    el('p', { class: 'small' }, [
      t('The King James Version (with the Apocrypha) and the World English Bible are built in and work offline. '),
      t('The NKJV and the Afrikaans Bibles are copyrighted, so they are read live from a licensed service with your own free key: '),
      el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }), t(' or the '),
      el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'YouVersion Platform' }),
      t('. A key stays on this device: it is not in any backup and not shared.'),
    ]),
  ]);
  container.append(trans);

  providerSection(trans, {
    title: 'API.Bible',
    keyName: 'apiKey', listName: 'apiBibles', placeholder: t('Paste your API.Bible key'),
    howTo: [
      [t('Open '), el('a', { href: 'https://scripture.api.bible/signup', target: '_blank', rel: 'noopener', text: 'scripture.api.bible/signup' }), t(' and create a free account (non-commercial use).')],
      [t('Create an application in the dashboard; its page shows the key.')],
      [t('Paste the key below and tap "Check key". Then tick the Bibles to show in the reader.')],
      [t('Which Bibles a key may read depends on the licences API.Bible has granted it.')],
    ],
    fetchList: () => Bible.listBibles(),
    note: t('Chapters from API.Bible are kept for 30 days so they open offline.'),
  });

  providerSection(trans, {
    title: 'YouVersion Platform',
    keyName: 'yvKey', listName: 'yvBibles', placeholder: t('Paste your YouVersion app key'),
    howTo: [
      [t('Register at '), el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'platform.youversion.com' }), t(' (free, non-commercial) and create an app; its page shows the app key.')],
      [t('Paste the key below, choose the languages to look in, and tap "Check key".')],
      [t('Tick the Bibles to show in the reader.')],
      [t('YouVersion only sends the text of Bibles licensed to your app. The others are marked "licence needed": tap Licence next to one to see which agreement covers it, accept it on platform.youversion.com, then check the key again.')],
    ],
    languages: true,
    fetchList: langs => Bible.yvCatalogue(langs),
    licenceInfo: licenceSheet,
    note: t('Chapters from YouVersion are kept for 7 days so they open offline.'),
  });

  trans.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: t('Clear cached chapters'), onclick: async () => { await clearCache(); toast(t('Cached chapters cleared.')); } }),
    el('span', { class: 'muted small', text: t('Removes the chapters fetched from both services; they are fetched again when opened.') }),
  ]));

  myTextsSection(trans);
  catechismSection(container);
  aiSection(container);

  // ---- backup
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await importAll(data);
      const what = { notes: tn(r.notes, '{n} note', '{n} notes'), sermons: tn(r.sermons, '{n} preparation', '{n} preparations') };
      toast(r.theology
        ? t('Backup loaded: {notes}, {sermons} and {theology} added or updated.', { ...what, theology: tn(r.theology, '{n} theology study', '{n} theology studies') })
        : t('Backup loaded: {notes} and {sermons} added or updated.', what));
      render(root);
    } catch (e) { toast(e.message || t('That file could not be read.'), true); }
    fileInput.value = '';
  });
  container.append(section(t('Backup'), [
    el('p', { class: 'small', text: t('Everything you write stays in this browser on this device: {notes} and {sermons} right now. Save a backup file regularly and keep it in your Google Drive, even with sync on: it is your own copy, in a file you can see. Load it on another device to carry your notes across; newer copies win and nothing is deleted. Pasted Bible text is not in this file: it has its own save file under Translations.', { notes: tn(state.notes.length, '{n} note', '{n} notes'), sermons: tn(state.sermons.length, '{n} preparation', '{n} preparations') }) }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: t('Save backup file'), onclick: async () => {
        const data = await exportAll();
        download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `study-bible-backup-${today()}.json`);
        toast(t('Backup saved.'));
      } }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Load backup file'), onclick: () => fileInput.click() }),
      fileInput,
    ]),
  ]));

  // ---- offline
  const progress = el('span', { class: 'muted small', role: 'status' });
  const dlBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Download all texts for offline'), onclick: async () => {
    dlBtn.disabled = true;
    const files = ['data/catechism.json'];
    for (const t of ['kjv', 'web']) { files.push(`data/${t}/index.json`); for (const b of BOOKS) files.push(`data/${t}/${b.id}.json`); }
    let done = 0, failed = 0;
    for (const f of files) {
      try { const r = await fetch(f); if (!r.ok) failed++; } catch (e) { failed++; }
      done++;
      progress.textContent = `${done} / ${files.length}`;
    }
    progress.textContent = failed ? t('{done} of {total} saved; try again when online.', { done: files.length - failed, total: files.length }) : t('All texts are saved on this device.');
    dlBtn.disabled = false;
  } });
  container.append(section(t('Offline'), [
    el('p', { class: 'small', text: t('The app keeps every chapter you open. To have the whole KJV, WEB and Catechism index ready without a connection (about 10 MB), download them once here. The Catechism text, once loaded, is already on the device. Add the app to your home screen to open it like any other app.') }),
    el('div', { class: 'row' }, [dlBtn, progress]),
  ]));

  // ---- about
  container.append(section(t('About'), [
    el('p', { class: 'small' }, [
      t('NAC Study Bible {version}. A personal study tool for preparing divine services. ', { version: VERSION }),
      el('a', { href: 'help.html', text: t('Read the help page') }), '.',
    ]),
    el('ul', { class: 'small muted' }, [
      el('li', { text: t('King James Version (1769 text) with the Apocrypha: public domain. Text from the SWORD KJVA module via scrollmapper/bible_databases.') }),
      el('li', { text: t('World English Bible with the Deuterocanon: public domain, ebible.org. "World English Bible" is a trademark of eBible.org.') }),
      el('li', { text: t('Scripture read through API.Bible or the YouVersion Platform is the copyright of its publishers and is shown under their terms; see the notice under each chapter.') }),
      el('li', { text: t('Text you paste in yourself stays on this device for your own study and remains the copyright of its publisher.') }),
      el('li', { text: t('Catechism of the New Apostolic Church © New Apostolic Church International, Zurich. The app carries only the section numbers, titles and Bible references; the text itself is loaded by you onto this device for your own study, or read at nak.org.') }),
      el('li', { text: t('Divine Service Guide © New Apostolic Church International. A Guide you load is read by Claude (Anthropic) with your own key and kept on this device only, for your own preparation.') }),
      el('li', { text: t('Liturgy for Altar Use © New Apostolic Church Cape. The booklet you load is read on this device itself, without Claude, kept on your own devices only, and is not part of the public app.') }),
      el('li', { text: t('The booklet\'s PDF is read with pdf.js (Mozilla), Apache License 2.0.') }),
      el('li', { text: t('Typeface: Montserrat (© The Montserrat Project Authors), SIL Open Font License 1.1. The slides of a reflection evening use Cambria and Calibri, as in PowerPoint, or where a device lacks them Caladea (© The Caladea Project Authors) and Carlito (© The Carlito Project Authors), both SIL Open Font License 1.1.') }),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost danger', type: 'button', text: t('Erase everything on this device'), onclick: async () => {
        if (await confirmBox(Sync.isOn() ? t('Erase all notes, preparations, settings and cached chapters from this device? Save a backup first. This cannot be undone. The copy on the server and your other devices are left as they are; this device stops syncing.') : t('Erase all notes, preparations, settings and cached chapters from this device? Save a backup first. This cannot be undone.'), t('Erase everything'), true)) {
          await wipeAll();
          await Sync.disable();   // the device is empty on purpose: it must not fill up again from the server
          toast(t('Everything was erased.'));
          render(root);
        }
      } }),
    ]),
  ]));
}

/** Versions the person pastes in chapter by chapter, with their own save file. */
function myTextsSection(container) {
  const S = state.settings;
  const rows = Bible.EXTERNAL.map(x => {
    const cb = el('input', { type: 'checkbox', checked: (S.myTexts || []).includes(x.id) });
    cb.addEventListener('change', async () => {
      const list = Bible.EXTERNAL.filter(y => (y.id === x.id ? cb.checked : (S.myTexts || []).includes(y.id))).map(y => y.id);
      await saveSetting('myTexts', list);
      toast(cb.checked ? t('{label} is now in the reader\'s translation list.', { label: x.label }) : t('{label} removed from the list{kept}.', { label: x.label, kept: textCount(x.id) ? t('; its chapters are kept') : '' }));
    });
    const n = textCount(x.id);
    return el('label', { class: 'check' }, [cb, el('b', { text: x.label }), el('span', { class: 'grow', text: x.name }), el('span', { class: 'muted small', text: n ? tn(n, '{n} chapter pasted', '{n} chapters pasted') : t('nothing pasted yet') })]);
  });
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const n = await importTexts(JSON.parse(await f.text()));
      toast(tn(n, '{n} chapter loaded.', '{n} chapters loaded.'));
      render(root);
    } catch (e) { toast(e.message || t('That file could not be read.'), true); }
    fileInput.value = '';
  });
  container.append(
    el('h3', { class: 'sub', text: t('My pasted text') }),
    el('p', { class: 'small', text: t('For a text you may use yourself: tick its version here, choose it in the reader (listed by its short name, such as AFR83), and paste each chapter in when you open it, copied from the page where you read it. The text stays in this browser on this device. It is not part of the normal backup; save it with its own file here to carry it to another device.') }),
    el('div', { class: 'list' }, rows),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost', type: 'button', text: t('Save pasted text to a file'), onclick: async () => {
        const data = await exportTexts();
        if (!data.texts.length) { toast(t('Nothing has been pasted yet.'), true); return; }
        download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `study-bible-pasted-text-${today()}.json`);
        toast(tn(data.texts.length, 'Saved: {n} chapter.', 'Saved: {n} chapters.'));
      } }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Load a pasted-text file'), onclick: () => fileInput.click() }),
      el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove all pasted text'), onclick: async () => {
        if (await confirmBox(Sync.isOn() ? t('Remove every pasted chapter from this device and, through sync, from your other devices? Save them to a file first if you want them back.') : t('Remove every pasted chapter from this device? Save them to a file first if you want them back.'), t('Remove'), true)) { await wipeTexts(); toast(t('Pasted text removed.')); render(root); }
      } }),
      fileInput,
    ]),
  );
}

/** The text of the Catechism: loaded from its file onto this device, shown and printed from here. */
function catechismSection(container) {
  const meta = state.catechism;
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const m = await saveCatechismText(JSON.parse(await f.text()));
      Cat.forgetText();
      toast(t('Catechism loaded: {n} sections.', { n: m.sections }));
      render(root);
    } catch (e) { toast(e.message || t('That file could not be read.'), true); }
    fileInput.value = '';
  });
  container.append(section(t('Catechism'), [
    el('p', { class: 'small', text: t('The index of the Catechism (section numbers, titles and the Bible verses each section quotes) is built in. The text of the sections is the Church\'s copyright, so it is not part of the public app: load it here from its file, and it stays in this browser on this device. You can then read every section in the Catechism tab and under a service preparation, search the Catechism by word, and print the sections you tick into your sermon notes. The file is made from the Catechism PDF with tools/build_catechism.py (see the help page); load it once on each device you use.') }),
    el('p', { class: 'small' }, meta
      ? [el('b', { text: t('Loaded on this device: ') }), t('{n} sections, {edition}{built}, loaded {date}.', { n: meta.sections, edition: meta.edition, built: meta.builtAt ? t(', file built {date}', { date: meta.builtAt }) : '', date: fmtDate(meta.loadedAt) })]
      : [el('b', { text: t('Not loaded on this device. ') }), t('Until it is, the app links each section to nak.org and the sermon notes list the chosen sections by number and title.')]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: meta ? t('Load a newer Catechism file') : t('Load the Catechism text file'), onclick: () => fileInput.click() }),
      meta ? el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove the Catechism text'), onclick: async () => {
        if (await confirmBox(Sync.isOn() ? t('Remove the text of the Catechism from this device and, through sync, from your other devices? The index stays, and you can load the file again later.') : t('Remove the text of the Catechism from this device? The index stays, and you can load the file again later.'), t('Remove'), true)) {
          await deleteCatechismText();
          Cat.forgetText();
          toast(t('Catechism text removed.'));
          render(root);
        }
      } }) : null,
      fileInput,
    ]),
  ]));
}

/**
 * A box for a key (API.Bible, YouVersion, Anthropic). The key has a line of
 * its own, the full width, so it can be read on a phone too; Show and the
 * check sit under it and wrap when they do not fit, instead of squeezing the
 * box. A line under the box says whether a key is saved here and how it
 * ends. Emptying the box removes the key, with Undo in case it was a slip.
 */
function keyBox({ label, setting, placeholder, checkText, onCheck }) {
  const current = () => state.settings[setting] || '';   // read each time: a sync or a backup can replace the settings
  const input = el('input', { type: 'password', class: 'key-input', value: current(), placeholder, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const status = el('p', { class: 'key-state small', role: 'status' });
  const showState = () => {
    const key = current();
    status.textContent = key ? t('A key is saved on this device. It ends in {end}.', { end: key.slice(-4) }) : t('No key on this device yet.');
  };
  const save = async value => { await saveSetting(setting, value); showState(); };
  input.addEventListener('change', async () => {
    const before = current(), now = input.value.trim();
    await save(now);
    if (now) toast(t('Key saved on this device.'));
    else toast(t('Key removed.'), false, before ? async () => { input.value = before; await save(before); toast(t('The key is back.')); } : undefined);
  });
  // both words are in the button, one hidden, so it is as wide as the longer one and the check beside it never moves
  const showBtn = el('button', { class: 'btn small ghost key-show', type: 'button', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    showBtn.classList.toggle('on', show);
  } }, [el('span', { text: t('Show') }), el('span', { text: t('Hide') })]);
  const checkBtn = el('button', { class: 'btn small', type: 'button', text: checkText, onclick: async () => {
    await save(input.value.trim());
    if (!current()) { toast(t('Paste the key first.'), true); return; }
    checkBtn.disabled = true;
    try { await onCheck(); }
    catch (e) { toast(e.message, true); }
    checkBtn.disabled = false;
  } });
  showState();
  return el('div', { class: 'keybox' }, [
    el('label', { class: 'f' }, [label, input]),
    status,
    el('div', { class: 'row key-btns' }, [showBtn, checkBtn]),
  ]);
}

/** The AI helper: the Anthropic key, which Claude to ask, and the language of the suggestions. */
function aiSection(container) {
  const S = state.settings;
  const keyField = keyBox({
    label: t('Anthropic key'), setting: 'aiKey', placeholder: t('Paste your Anthropic key (sk-ant-…)'), checkText: t('Check key'),
    onCheck: async () => { await AI.checkKey(); toast(t('The key works. Claude is ready in the Prepare tab.')); },
  });
  const modelSel = el('select', {}, AI.MODELS.map(m => el('option', { value: m.id, text: `${m.label} – ${t(m.note)}`, selected: m.id === AI.model().id })));
  modelSel.addEventListener('change', async () => { await saveSetting('aiModel', modelSel.value); toast(`Claude: ${AI.modelLabel(modelSel.value)}.`); });
  const langSel = el('select', {}, AI.LANGS.map(([v, l]) => el('option', { value: v, text: l, selected: (S.aiLang || 'en') === v })));
  langSel.addEventListener('change', async () => { await saveSetting('aiLang', langSel.value); toast(langSel.value === 'af' ? t('Suggestions will come in Afrikaans unless a preparation chooses otherwise.') : t('Suggestions will come in English unless a preparation chooses otherwise.')); });

  // how the person preaches: the humour they like, and their own note on their way, sent with every request
  const humourSeg = seg(AI.HUMOUR, AI.HUMOUR.some(h => h[0] === S.aiHumour) ? S.aiHumour : 'some', async v => { await saveSetting('aiHumour', v); toast(v === 'none' ? t('No humour in the suggestions.') : v === 'more' ? t('Claude may offer a bit more humour.') : t('Claude may offer a little humour where it fits.')); }, { block: true, label: t('Humour') });
  const styleBox = el('textarea', { rows: 3, placeholder: t('For example: I speak plainly and like a story from everyday life. I often use pictures from my work. I do not use big words. I like to end with one clear thought to take home.') });
  styleBox.value = S.aiStyle || '';
  styleBox.addEventListener('change', async () => { await saveSetting('aiStyle', styleBox.value.trim()); toast(styleBox.value.trim() ? t('Saved. Claude will follow it.') : t('Note removed.')); });

  container.append(section(t('AI helper'), [
    el('p', { class: 'small', text: t('Claude, the AI from Anthropic, can read the monthly Divine Service Guide into the Prepare tab and suggest answers for a preparation: the context of the text, key words, Catechism sections, cross references, sermon thoughts and the build of the sermon. It works with a key of your own, so you pay Anthropic only for what you use (roughly R10 to read a month\'s Guide and a few rand for a set of suggestions) and the key stays on this device, out of any backup.') }),
    el('details', { class: 'small' }, [
      el('summary', { text: t('How to get a key') }),
      el('ol', {}, [
        el('li', {}, [t('Open '), el('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener', text: 'console.anthropic.com' }), t(' and create an account, or sign in.')]),
        el('li', { text: t('Under Billing, add some credit; it is prepaid, and $5 to $10 lasts months.') }),
        el('li', { text: t('Under API Keys, create a key, copy it (it is shown once) and paste it below. Then tap "Check key".') }),
      ]),
    ]),
    keyField,
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, [t('Which Claude'), modelSel]),
      el('label', { class: 'f' }, [t('Language of the suggestions'), langSel, el('span', { class: 'hint muted small', text: t('The usual language. Each preparation can choose English or Afrikaans for itself.') })]),
    ]),
    el('h3', { class: 'sub', text: t('How you preach') }),
    el('p', { class: 'small', text: t('The suggestions always come in short sentences and everyday words, so they are easy to read on a phone and to say from the pulpit. On each preparation you say who is listening (the age group and a line about the people); Claude shapes the pictures, the examples and the application for them. Here you set what stays the same from service to service.') }),
    el('p', { class: 'small', text: t('The main points of the sermon always come from the Divine Service Guide: the parts of its article, in its order, are main point 1, 2, 3 and so on. Claude puts them in plain words for your people but never adds a point of its own. Without the Guide\'s article it leaves the main points to you.') }),
    el('label', { class: 'f' }, [t('Humour'), humourSeg, el('span', { class: 'hint muted small', text: t('How much lightness the suggested sermon may carry. Never at a funeral or a service for the departed. A preparation can choose differently.') })]),
    el('label', { class: 'f' }, [t('Your way of preaching (optional)'), styleBox, el('span', { class: 'hint muted small', text: t('A few lines in your own words: what you like to do, what you avoid, where your pictures come from. Claude follows it in every suggestion.') })]),
    el('p', { class: 'muted small', text: t('What goes to Anthropic to answer: the Guide PDF when you load one, the text word with its chapter, the Catechism sections that belong to it, your own notes on that preparation, who is listening and this note on how you preach. Anthropic processes it to answer and does not train its models on it. Nothing is put on the public site, and the suggestions are a starting point: the sermon remains yours.') }),
  ]));
}

/** What YouVersion says about the licence of a Bible the key may not read yet. */
async function licenceSheet(b) {
  const s = sheet(t('Licence for {abbr}', { abbr: b.abbreviation }));
  s.body.append(el('p', { class: 'muted small', text: t('Asking YouVersion…') }));
  let lic = null, problem = '';
  try { lic = await Bible.yvLicence(b.id); } catch (e) { problem = e.message; }
  clear(s.body);
  s.body.append(el('div', {}, [
    el('p', { text: t('{name} ({abbr}) is on YouVersion, but its text is not licensed to your app yet.', { name: b.name, abbr: b.abbreviation }) }),
    lic ? el('p', {}, [t('It is covered by the licence '), el('b', { text: lic.name }), ...(lic.uri ? [' (', el('a', { href: lic.uri, target: '_blank', rel: 'noopener', text: t('open the licence') }), ')'] : []), '.']) : null,
    problem ? el('p', { class: 'muted small', text: t('YouVersion gave no licence details ({problem}).', { problem }) }) : null,
    el('p', { class: 'small' }, [
      t('Sign in at '), el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'platform.youversion.com' }),
      t(', open your app and accept the licence for this Bible. If it is not offered there, the publisher has not opened it to the Platform yet: ask at '),
      el('a', { href: 'https://platform.youversion.com/support', target: '_blank', rel: 'noopener', text: 'platform.youversion.com/support' }),
      t('. Afterwards tap "Check key and list Bibles" again.'),
    ]),
  ]));
}

/** One licensed service: key box, catalogue check, and the tick list of Bibles to show. */
function providerSection(container, o) {
  const S = state.settings;
  const langInput = o.languages ? el('input', { type: 'text', value: 'af, en', placeholder: t('Languages, e.g. af, en'), 'aria-label': t('Languages') }) : null;
  const filter = el('input', { type: 'search', placeholder: t('Filter: Afrikaans, NKJV, English…'), hidden: true });
  const bibleList = el('div', { class: 'list biblelist' });
  const chosenNow = el('p', { class: 'small' });
  let catalogue = null;

  function showChosen() {
    const chosen = S[o.listName] || [];
    chosenNow.textContent = chosen.length ? t('In the reader from {service}: {list}', { service: o.title, list: chosen.map(b => b.abbreviation).join(', ') }) : t('No {service} Bibles chosen yet.', { service: o.title });
  }
  function showCatalogue() {
    clear(bibleList);
    if (!catalogue) return;
    const q = filter.value.trim().toLowerCase();
    const chosen = new Set((S[o.listName] || []).map(b => String(b.id)));
    const items = catalogue.filter(b => !q || (b.name + ' ' + b.abbreviation + ' ' + b.language + ' ' + (b.description || '')).toLowerCase().includes(q));
    items.sort((a, b) => (chosen.has(String(b.id)) - chosen.has(String(a.id))) || ((b.licensed !== false) - (a.licensed !== false)) || (a.language + a.name).localeCompare(b.language + b.name));
    if (!items.length) bibleList.append(el('p', { class: 'muted small', text: catalogue.length ? t('No Bible matches that filter.') : t('This key lists no Bibles yet.') }));
    for (const b of items.slice(0, 80)) {
      const cb = el('input', { type: 'checkbox', checked: chosen.has(String(b.id)) });
      cb.addEventListener('change', async () => {
        const list = (S[o.listName] || []).filter(x => String(x.id) !== String(b.id));
        if (cb.checked) list.push({ id: b.id, abbreviation: b.abbreviation, name: b.name, language: b.language });
        await saveSetting(o.listName, list);
        showChosen();
        toast(cb.checked ? t('{abbr} added to the reader.', { abbr: b.abbreviation }) : t('{abbr} removed from the reader.', { abbr: b.abbreviation }));
      });
      const unlicensed = b.licensed === false;
      bibleList.append(el('label', { class: 'check' }, [
        cb, el('b', { text: b.abbreviation }), el('span', { class: 'grow', text: b.name }),
        unlicensed ? el('span', { class: 'pill warn', text: t('licence needed') }) : null,
        unlicensed && o.licenceInfo ? el('button', { class: 'btn small ghost', type: 'button', text: t('Licence'), onclick: ev => { ev.preventDefault(); ev.stopPropagation(); o.licenceInfo(b); } }) : null,
        el('span', { class: 'muted small', text: b.language }),
      ]));
    }
    if (items.length > 80) bibleList.append(el('p', { class: 'muted small', text: t('Showing 80 of {total}. Type to narrow the list.', { total: items.length }) }));
  }
  filter.addEventListener('input', showCatalogue);
  const keyField = keyBox({
    label: t('{service} key', { service: o.title }), setting: o.keyName, placeholder: o.placeholder, checkText: t('Check key and list Bibles'),
    onCheck: async () => {
      const langs = langInput ? langInput.value.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean) : [];
      catalogue = await o.fetchList(langs.length ? langs : ['af', 'en']);
      filter.hidden = false;
      showCatalogue();
      const ready = catalogue.filter(b => b.licensed !== false).length, need = catalogue.length - ready;
      toast(!catalogue.length ? t('The key works, but {service} lists no Bibles for those languages.', { service: o.title })
        : !ready ? t('The key works, but none of the {need} Bibles listed is licensed to your app yet. Tap Licence next to one to see how to get it.', { need })
        : need ? t('The key works: {ready} ready to read, and {need} more need a licence for your app (marked in the list).', { ready, need })
        : t('The key works: {ready} Bibles available. Tick the ones to show in the reader.', { ready }));
    },
  });
  showChosen();

  container.append(...[
    el('h3', { class: 'sub', text: o.title }),
    el('details', { class: 'small' }, [
      el('summary', { text: t('How to get a key for {service}', { service: o.title }) }),
      el('ol', {}, o.howTo.map(parts => el('li', {}, parts))),
    ]),
    keyField,
    langInput ? el('label', { class: 'f' }, [t('Languages to list (codes such as af, en, de)'), langInput]) : null,
    chosenNow, filter, bibleList,
    el('p', { class: 'muted small', text: o.note }),
  ].filter(Boolean));
}

/* ------------------------------------------------------------------ sync */

let syncWatch = null;   // stops the status updates of the last drawn Sync section

/** "Synced 3 minutes ago": the time of the last sync in words. */
function ago(iso) {
  if (!iso) return t('Not synced yet.');
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return t('Synced just now.');
  if (s < 3600) return t('Synced {ago}.', { ago: tn(Math.round(s / 60), '{n} minute ago', '{n} minutes ago') });
  if (s < 86400) return t('Synced {ago}.', { ago: tn(Math.round(s / 3600), '{n} hour ago', '{n} hours ago') });
  return t('Synced on {date}.', { date: fmtDate(iso, true) });
}

/** Keeping this device and the person's other devices the same, over the app's own server. */
function syncSection(container) {
  const box = section(t('Sync between your devices'), []);
  const body = el('div');
  box.append(body);
  container.append(box);

  const draw = st => {
    clear(body);
    if (!st.on) {
      body.append(
        el('p', { class: 'small', text: t('Keep your PC and phone the same. Turn sync on here; the app shows you a code. On your other device open Settings → Sync, tap "I have a code" and type that code in (or scan it). From then on the two keep each other up to date on their own: notes, preparations, settings, pasted text, the Catechism text, the Guides and the altar booklet.') }),
        el('p', { class: 'muted small', text: t('Everything is locked with your code before it leaves the device. The server keeps only the locked copy and cannot read it, and nobody can find or open it without the code, so keep the code where you keep passwords.') }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn small', type: 'button', text: t('Turn on sync'), onclick: turnOn }),
          el('button', { class: 'btn small ghost', type: 'button', text: t('I have a code'), onclick: () => joinSheet() }),
        ]),
      );
      return;
    }
    const n = Sync.summary();
    const dot = el('span', { class: 'sync-dot' + (st.busy ? ' busy' : st.error ? ' error' : ''), 'aria-hidden': 'true' });
    const line = el('span', { class: 'grow', role: 'status', text: st.busy ? t('Syncing…') : ago(st.lastAt) });
    const syncBtn = el('button', { class: 'btn small ghost', type: 'button', text: t('Sync now'), disabled: st.busy, onclick: () => Sync.syncNow() });
    const carry = el('input', { type: 'checkbox', checked: st.carryKeys });
    carry.addEventListener('change', async () => { await Sync.setCarryKeys(carry.checked); toast(carry.checked ? t('Your keys travel with the sync from now on.') : t('Your keys stay on each device from now on.')); });
    body.append(el('div', {}, [
      el('div', { class: 'row sync-status' }, [dot, line, syncBtn]),
      st.error ? el('p', { class: 'small error', text: st.error }) : null,
      el('p', { class: 'small', text: t('This device shares with your other devices: {notes}, {sermons}, {texts}, {guides}, {booklets} and the Catechism text{cat}. A change here reaches the others within a few seconds of their opening the app.', {
        notes: tn(n.notes, '{n} note', '{n} notes'), sermons: tn(n.sermons, '{n} preparation', '{n} preparations'),
        texts: tn(n.texts, '{n} pasted chapter', '{n} pasted chapters'), guides: tn(n.guides, '{n} Guide', '{n} Guides'), booklets: tn(n.liturgy, '{n} altar booklet', '{n} altar booklets'),
        cat: n.catechism ? '' : t(' (not loaded here)'),
      }) }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small', type: 'button', text: t('Show the code'), onclick: () => codeSheet(st.code) }),
        el('button', { class: 'btn small ghost', type: 'button', text: t('Stop syncing on this device'), onclick: async () => {
          if (await confirmBox(t('Stop syncing on this device? Everything stays on it, and the copy on the server stays for your other devices. You can join again later with the code.'), t('Stop syncing'))) {
            await Sync.disable();
            toast(t('Sync is off on this device.'));
          }
        } }),
        el('button', { class: 'btn small ghost danger', type: 'button', text: t('Delete the copy on the server'), onclick: async () => {
          if (await confirmBox(t('Delete the copy on the server? Your devices keep what they have, but they stop syncing until you turn sync on again, with a new code.'), t('Delete the copy'), true)) {
            try { await Sync.deleteRemote(); toast(t('The copy on the server was deleted.')); }
            catch (e) { toast(e.message, true); }
          }
        } }),
      ]),
      el('label', { class: 'check sync-keys' }, [carry, el('span', { class: 'grow', text: t('Carry my keys too (API.Bible, YouVersion and Anthropic), locked with the code, so I need not paste them again on the other device.') })]),
    ]));
  };

  if (syncWatch) syncWatch();
  syncWatch = Sync.onStatus(draw);
  draw(Sync.getStatus());

  async function turnOn() {
    const code = Sync.newCode();
    const b = busy(t('Turning sync on'));
    b.say(t('Locking your notes and sending them to the server…'));
    try {
      await Sync.enable(code);
      b.done();
      codeSheet(code, true);
    } catch (e) {
      b.fail(e.message || t('Sync could not be turned on.'));
    }
  }
}

/** The code in large letters with its QR square, for the other device. */
async function codeSheet(code, fresh) {
  const s = sheet(t('Your sync code'));
  const codeBox = el('div', { class: 'sync-code', text: Sync.formatCode(code), 'aria-label': t('Sync code') });
  const qr = el('div', { class: 'sync-qr', 'aria-hidden': 'true' });
  s.body.append(el('div', {}, [
    fresh ? el('p', { text: t('Sync is on. Now join from your other device.') }) : null,
    codeBox,
    qr,
    el('ol', { class: 'small' }, [
      el('li', { text: t('On your other device, open the app and go to Settings → Sync between your devices.') }),
      el('li', { text: t('Tap "I have a code" and type these letters, in any case, with or without the dashes.') }),
      el('li', { text: t('Or point the phone\'s camera at the square: the link opens the app with the code filled in. If the app is on your home screen, open it from there and type the code instead, so that copy is the one that joins.') }),
    ]),
    el('p', { class: 'muted small', text: t('Keep the code where you keep passwords. It is the only key to the copy on the server: without it nobody can open it, not even the maker of the app. You can see it again here any time.') }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: t('Copy code'), onclick: async () => toast(await copyText(Sync.formatCode(code)) ? t('Code copied.') : t('Could not copy; please type it over.'), false) }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Copy link'), onclick: async () => toast(await copyText(Sync.linkFor(code)) ? t('Link copied. Send it to yourself and open it on the other device.') : t('Could not copy; please type it over.'), false) }),
    ]),
  ]));
  try {
    const { default: qrcode } = await import('../vendor/qrcode.mjs');
    const q = qrcode(0, 'M');
    q.addData(Sync.linkFor(code));
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    qr.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
  } catch (e) {
    qr.remove();
  }
}

/** Typing (or pasting) another device's code. `prefill` comes from a scanned link. */
export function joinSheet(prefill) {
  if (Sync.isOn()) { toast(t('Sync is already on here. Stop it first to join with another code.'), true); return; }
  const s = sheet(t('Join with a code'));
  const input = el('input', { type: 'text', class: 'sync-input', placeholder: 'ABCDE-FGHJK-LMNPQ-RSTUV', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', 'aria-label': t('Sync code') });
  if (prefill) input.value = Sync.formatCode(prefill);
  const hint = el('p', { class: 'hint small muted', text: t('The 20 letters and numbers shown under "Show the code" on the device that is already syncing.') });
  const joinBtn = el('button', { class: 'btn', type: 'button', text: t('Join') });
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    input.value = raw.replace(/(.{5})(?=.)/g, '$1-');
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); joinBtn.click(); } });
  joinBtn.addEventListener('click', async () => {
    const code = Sync.parseCode(input.value);
    if (!code) { hint.textContent = t('That is not a whole code: it has 20 letters and numbers, in four groups of five, and never 0, O, 1 or I.'); hint.classList.add('error'); input.focus(); return; }
    joinBtn.disabled = true;
    hint.classList.remove('error');
    hint.textContent = t('Looking for the copy on the server…');
    try {
      const found = await Sync.probe(code);
      if (!found) {
        joinBtn.disabled = false;
        hint.textContent = '';
        if (!(await confirmBox(t('Nothing is on the server under this code yet. Check the letters, or turn sync on on your other device first. Start a new sync with this code anyway?'), t('Start anyway')))) return;
      }
      s.close();
      const b = busy(t('Joining'));
      b.say(t('Fetching your notes and preparations and merging them with this device…'));
      try {
        await Sync.enable(code);
        b.done();
        const n = Sync.summary();
        toast(t('Joined. On this device now: {notes} and {sermons}.', { notes: tn(n.notes, '{n} note', '{n} notes'), sermons: tn(n.sermons, '{n} preparation', '{n} preparations') }));
        if (root) render(root);
      } catch (e) {
        b.fail(e.message || t('Could not join.'));
      }
    } catch (e) {
      joinBtn.disabled = false;
      hint.textContent = e.message || t('Could not reach the server.');
      hint.classList.add('error');
    }
  });
  s.body.append(
    el('p', { class: 'small', text: t('Everything already on this device is kept and merged with what is on the server; newer copies win.') }),
    el('label', { class: 'f sync-join' }, [t('Sync code'), input]),
    hint,
    el('div', { class: 'row end' }, [el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => s.close() }), joinBtn]),
  );
  setTimeout(() => input.focus(), 30);
}

/*
 * Settings: the API.Bible key and which of its Bibles to show, the person's
 * name and congregation, book-name language, backup, offline texts, and the
 * copyright notices the bundled texts and API.Bible ask for.
 */
import { el, clear, toast, confirmBox, download, today, sheet, fmtDate } from './ui.js';
import { state, saveSetting, exportAll, importAll, clearCache, wipeAll, textCount, exportTexts, importTexts, wipeTexts, saveCatechismText, deleteCatechismText } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import { BOOKS } from './books.js';

export const VERSION = '0.1.0';

export function render(container) {
  clear(container);
  const S = state.settings;

  // ---- translations: the two licensed services, each with its own key
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Translations' })]),
    el('p', { class: 'small' }, [
      'The King James Version (with the Apocrypha) and the World English Bible are built in and work offline. ',
      'The NKJV and the Afrikaans Bibles are copyrighted, so they are read live from a licensed service with your own free key: ',
      el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }), ' or the ',
      el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'YouVersion Platform' }),
      '. A key stays on this device: it is not in any backup and not shared.',
    ]),
  );

  providerSection(container, {
    title: 'API.Bible',
    keyName: 'apiKey', listName: 'apiBibles', placeholder: 'Paste your API.Bible key',
    howTo: [
      ['Open ', el('a', { href: 'https://scripture.api.bible/signup', target: '_blank', rel: 'noopener', text: 'scripture.api.bible/signup' }), ' and create a free account (non-commercial use).'],
      ['Create an application in the dashboard; its page shows the key.'],
      ['Paste the key below and tap "Check key". Then tick the Bibles to show in the reader.'],
      ['Which Bibles a key may read depends on the licences API.Bible has granted it.'],
    ],
    fetchList: () => Bible.listBibles(),
    note: 'Chapters from API.Bible are kept for 30 days so they open offline.',
  });

  providerSection(container, {
    title: 'YouVersion Platform',
    keyName: 'yvKey', listName: 'yvBibles', placeholder: 'Paste your YouVersion app key',
    howTo: [
      ['Register at ', el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'platform.youversion.com' }), ' (free, non-commercial) and create an app; its page shows the app key.'],
      ['Paste the key below, choose the languages to look in, and tap "Check key".'],
      ['Tick the Bibles to show in the reader.'],
      ['YouVersion only sends the text of Bibles licensed to your app. The others are marked "licence needed": tap Licence next to one to see which agreement covers it, accept it on platform.youversion.com, then check the key again.'],
    ],
    languages: true,
    fetchList: langs => Bible.yvCatalogue(langs),
    licenceInfo: licenceSheet,
    note: 'Chapters from YouVersion are kept for 7 days so they open offline.',
  });

  container.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: 'Clear cached chapters', onclick: async () => { await clearCache(); toast('Cached chapters cleared.'); } }),
    el('span', { class: 'muted small', text: 'Removes the chapters fetched from both services; they are fetched again when opened.' }),
  ]));

  myTextsSection(container);
  catechismSection(container);

  // ---- about you
  const nameInput = el('input', { type: 'text', value: S.name || '', placeholder: 'Your name, for the footer of the sermon notes' });
  nameInput.addEventListener('change', () => saveSetting('name', nameInput.value.trim()));
  const congInput = el('input', { type: 'text', value: S.congregation || '', placeholder: 'Your usual congregation' });
  congInput.addEventListener('change', () => saveSetting('congregation', congInput.value.trim()));
  const langSel = el('select', {}, [el('option', { value: 'en', text: 'English (Psalm, John, 1 Corinthians)', selected: S.bookLang !== 'af' }), el('option', { value: 'af', text: 'Afrikaans (Psalms, Johannes, 1 Korintiërs)', selected: S.bookLang === 'af' })]);
  langSel.addEventListener('change', async () => { await saveSetting('bookLang', langSel.value); toast('Book names changed.'); });
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'You' })]),
    el('div', { class: 'fields three' }, [
      el('label', { class: 'f' }, ['Name', nameInput]),
      el('label', { class: 'f' }, ['Congregation', congInput]),
      el('label', { class: 'f' }, ['Book names', langSel]),
    ]),
  );

  // ---- backup
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await importAll(data);
      toast(`Backup loaded: ${r.notes} note${r.notes === 1 ? '' : 's'} and ${r.sermons} preparation${r.sermons === 1 ? '' : 's'} added or updated.`);
      render(container);
    } catch (e) { toast(e.message || 'That file could not be read.', true); }
    fileInput.value = '';
  });
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Backup' })]),
    el('p', { class: 'small', text: `Everything you write stays in this browser on this device: ${state.notes.length} note${state.notes.length === 1 ? '' : 's'} and ${state.sermons.length} preparation${state.sermons.length === 1 ? '' : 's'} right now. Save a backup file regularly and keep it in your Google Drive. Load it on another device to carry your notes across; newer copies win and nothing is deleted. Pasted Bible text is not in this file: it has its own save file under Translations.` }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: 'Save backup file', onclick: async () => {
        const data = await exportAll();
        download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `study-bible-backup-${today()}.json`);
        toast('Backup saved.');
      } }),
      el('button', { class: 'btn small ghost', type: 'button', text: 'Load backup file', onclick: () => fileInput.click() }),
      fileInput,
    ]),
  );

  // ---- offline
  const progress = el('span', { class: 'muted small' });
  const dlBtn = el('button', { class: 'btn small ghost', type: 'button', text: 'Download all texts for offline', onclick: async () => {
    dlBtn.disabled = true;
    const files = ['data/catechism.json'];
    for (const t of ['kjv', 'web']) { files.push(`data/${t}/index.json`); for (const b of BOOKS) files.push(`data/${t}/${b.id}.json`); }
    let done = 0, failed = 0;
    for (const f of files) {
      try { const r = await fetch(f); if (!r.ok) failed++; } catch (e) { failed++; }
      done++;
      progress.textContent = `${done} / ${files.length}`;
    }
    progress.textContent = failed ? `${files.length - failed} of ${files.length} saved; try again when online.` : 'All texts are saved on this device.';
    dlBtn.disabled = false;
  } });
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Offline' })]),
    el('p', { class: 'small', text: 'The app keeps every chapter you open. To have the whole KJV, WEB and Catechism index ready without a connection (about 10 MB), download them once here. The Catechism text, once loaded, is already on the device. Add the app to your home screen to open it like any other app.' }),
    el('div', { class: 'row' }, [dlBtn, progress]),
  );

  // ---- about
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'About' })]),
    el('p', { class: 'small' }, [
      `NAC Study Bible ${VERSION}. A personal study tool for preparing divine services. `,
      el('a', { href: 'help.html', text: 'Read the help page' }), '.',
    ]),
    el('ul', { class: 'small muted' }, [
      el('li', { text: 'King James Version (1769 text) with the Apocrypha: public domain. Text from the SWORD KJVA module via scrollmapper/bible_databases.' }),
      el('li', { text: 'World English Bible with the Deuterocanon: public domain, ebible.org. "World English Bible" is a trademark of eBible.org.' }),
      el('li', { text: 'Scripture read through API.Bible or the YouVersion Platform is the copyright of its publishers and is shown under their terms; see the notice under each chapter.' }),
      el('li', { text: 'Text you paste in yourself stays on this device for your own study and remains the copyright of its publisher.' }),
      el('li', { text: 'Catechism of the New Apostolic Church © New Apostolic Church International, Zurich. The app carries only the section numbers, titles and Bible references; the text itself is loaded by you onto this device for your own study, or read at nak.org.' }),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost danger', type: 'button', text: 'Erase everything on this device', onclick: async () => {
        if (await confirmBox('Erase all notes, preparations, settings and cached chapters from this device? Save a backup first. This cannot be undone.', 'Erase everything', true)) {
          await wipeAll();
          toast('Everything was erased.');
          render(container);
        }
      } }),
    ]),
  );
}

/** Versions the person pastes in chapter by chapter, with their own save file. */
function myTextsSection(container) {
  const S = state.settings;
  const rows = Bible.EXTERNAL.map(x => {
    const cb = el('input', { type: 'checkbox', checked: (S.myTexts || []).includes(x.id) });
    cb.addEventListener('change', async () => {
      const list = Bible.EXTERNAL.filter(y => (y.id === x.id ? cb.checked : (S.myTexts || []).includes(y.id))).map(y => y.id);
      await saveSetting('myTexts', list);
      toast(cb.checked ? `${x.label} (pasted) is now in the reader's translation list.` : `${x.label} (pasted) removed from the list${textCount(x.id) ? '; its chapters are kept' : ''}.`);
    });
    const n = textCount(x.id);
    return el('label', { class: 'check' }, [cb, el('b', { text: x.label }), el('span', { class: 'grow', text: x.name }), el('span', { class: 'muted small', text: n ? `${n} chapter${n === 1 ? '' : 's'} pasted` : 'nothing pasted yet' })]);
  });
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const n = await importTexts(JSON.parse(await f.text()));
      toast(`${n} chapter${n === 1 ? '' : 's'} loaded.`);
      render(container);
    } catch (e) { toast(e.message || 'That file could not be read.', true); }
    fileInput.value = '';
  });
  container.append(
    el('h3', { class: 'sub', text: 'My pasted text' }),
    el('p', { class: 'small', text: 'For a text you may use yourself: tick its version here, choose it in the reader (marked "pasted"), and paste each chapter in when you open it, copied from the page where you read it. The text stays in this browser on this device. It is not part of the normal backup; save it with its own file here to carry it to another device.' }),
    el('div', { class: 'list' }, rows),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost', type: 'button', text: 'Save pasted text to a file', onclick: async () => {
        const data = await exportTexts();
        if (!data.texts.length) { toast('Nothing has been pasted yet.', true); return; }
        download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `study-bible-pasted-text-${today()}.json`);
        toast(`Saved: ${data.texts.length} chapter${data.texts.length === 1 ? '' : 's'}.`);
      } }),
      el('button', { class: 'btn small ghost', type: 'button', text: 'Load a pasted-text file', onclick: () => fileInput.click() }),
      el('button', { class: 'btn small ghost danger', type: 'button', text: 'Remove all pasted text', onclick: async () => {
        if (await confirmBox('Remove every pasted chapter from this device? Save them to a file first if you want them back.', 'Remove', true)) { await wipeTexts(); toast('Pasted text removed.'); render(container); }
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
      toast(`Catechism loaded: ${m.sections} sections.`);
      render(container);
    } catch (e) { toast(e.message || 'That file could not be read.', true); }
    fileInput.value = '';
  });
  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Catechism' })]),
    el('p', { class: 'small', text: 'The index of the Catechism (section numbers, titles and the Bible verses each section quotes) is built in. The text of the sections is the Church\'s copyright, so it is not part of the public app: load it here from its file, and it stays in this browser on this device. You can then read every section in the Catechism tab and under a service preparation, search the Catechism by word, and print the sections you tick into your sermon notes. The file is made from the Catechism PDF with tools/build_catechism.py (see the help page); load it once on each device you use.' }),
    el('p', { class: 'small' }, meta
      ? [el('b', { text: 'Loaded on this device: ' }), `${meta.sections} sections, ${meta.edition}${meta.builtAt ? ', file built ' + meta.builtAt : ''}, loaded ${fmtDate(meta.loadedAt)}.`]
      : [el('b', { text: 'Not loaded on this device. ' }), 'Until it is, the app links each section to nak.org and the sermon notes list the chosen sections by number and title.']),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small', type: 'button', text: meta ? 'Load a newer Catechism file' : 'Load the Catechism text file', onclick: () => fileInput.click() }),
      meta ? el('button', { class: 'btn small ghost danger', type: 'button', text: 'Remove the Catechism text', onclick: async () => {
        if (await confirmBox('Remove the text of the Catechism from this device? The index stays, and you can load the file again later.', 'Remove', true)) {
          await deleteCatechismText();
          Cat.forgetText();
          toast('Catechism text removed.');
          render(container);
        }
      } }) : null,
      fileInput,
    ]),
  );
}

/** What YouVersion says about the licence of a Bible the key may not read yet. */
async function licenceSheet(b) {
  const s = sheet(`Licence for ${b.abbreviation}`);
  s.body.append(el('p', { class: 'muted small', text: 'Asking YouVersion…' }));
  let lic = null, problem = '';
  try { lic = await Bible.yvLicence(b.id); } catch (e) { problem = e.message; }
  clear(s.body);
  s.body.append(
    el('p', { text: `${b.name} (${b.abbreviation}) is on YouVersion, but its text is not licensed to your app yet.` }),
    lic ? el('p', {}, ['It is covered by the licence ', el('b', { text: lic.name }), ...(lic.uri ? [' (', el('a', { href: lic.uri, target: '_blank', rel: 'noopener', text: 'open the licence' }), ')'] : []), '.']) : null,
    problem ? el('p', { class: 'muted small', text: `YouVersion gave no licence details (${problem}).` }) : null,
    el('p', { class: 'small' }, [
      'Sign in at ', el('a', { href: 'https://platform.youversion.com', target: '_blank', rel: 'noopener', text: 'platform.youversion.com' }),
      ', open your app and accept the licence for this Bible. If it is not offered there, the publisher has not opened it to the Platform yet: ask at ',
      el('a', { href: 'https://platform.youversion.com/support', target: '_blank', rel: 'noopener', text: 'platform.youversion.com/support' }),
      '. Afterwards tap "Check key and list Bibles" again.',
    ]),
  );
}

/** One licensed service: key box, catalogue check, and the tick list of Bibles to show. */
function providerSection(container, o) {
  const S = state.settings;
  const keyInput = el('input', { type: 'password', value: S[o.keyName] || '', placeholder: o.placeholder, autocomplete: 'off', spellcheck: 'false' });
  const showBtn = el('button', { class: 'btn small ghost', type: 'button', text: 'Show', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; showBtn.textContent = keyInput.type === 'password' ? 'Show' : 'Hide'; } });
  keyInput.addEventListener('change', async () => { await saveSetting(o.keyName, keyInput.value.trim()); toast(keyInput.value.trim() ? 'Key saved on this device.' : 'Key removed.'); });
  const langInput = o.languages ? el('input', { type: 'text', value: 'af, en', placeholder: 'Languages, e.g. af, en', 'aria-label': 'Languages' }) : null;
  const filter = el('input', { type: 'search', placeholder: 'Filter: Afrikaans, NKJV, English…', hidden: true });
  const bibleList = el('div', { class: 'list biblelist' });
  const chosenNow = el('p', { class: 'small' });
  let catalogue = null;

  function showChosen() {
    const chosen = S[o.listName] || [];
    chosenNow.textContent = chosen.length ? `In the reader from ${o.title}: ${chosen.map(b => b.abbreviation).join(', ')}` : `No ${o.title} Bibles chosen yet.`;
  }
  function showCatalogue() {
    clear(bibleList);
    if (!catalogue) return;
    const q = filter.value.trim().toLowerCase();
    const chosen = new Set((S[o.listName] || []).map(b => String(b.id)));
    const items = catalogue.filter(b => !q || (b.name + ' ' + b.abbreviation + ' ' + b.language + ' ' + (b.description || '')).toLowerCase().includes(q));
    items.sort((a, b) => (chosen.has(String(b.id)) - chosen.has(String(a.id))) || ((b.licensed !== false) - (a.licensed !== false)) || (a.language + a.name).localeCompare(b.language + b.name));
    if (!items.length) bibleList.append(el('p', { class: 'muted small', text: catalogue.length ? 'No Bible matches that filter.' : 'This key lists no Bibles yet.' }));
    for (const b of items.slice(0, 80)) {
      const cb = el('input', { type: 'checkbox', checked: chosen.has(String(b.id)) });
      cb.addEventListener('change', async () => {
        const list = (S[o.listName] || []).filter(x => String(x.id) !== String(b.id));
        if (cb.checked) list.push({ id: b.id, abbreviation: b.abbreviation, name: b.name, language: b.language });
        await saveSetting(o.listName, list);
        showChosen();
        toast(cb.checked ? `${b.abbreviation} added to the reader.` : `${b.abbreviation} removed from the reader.`);
      });
      const unlicensed = b.licensed === false;
      bibleList.append(el('label', { class: 'check' }, [
        cb, el('b', { text: b.abbreviation }), el('span', { class: 'grow', text: b.name }),
        unlicensed ? el('span', { class: 'pill warn', text: 'licence needed' }) : null,
        unlicensed && o.licenceInfo ? el('button', { class: 'btn small ghost', type: 'button', text: 'Licence', onclick: ev => { ev.preventDefault(); ev.stopPropagation(); o.licenceInfo(b); } }) : null,
        el('span', { class: 'muted small', text: b.language }),
      ]));
    }
    if (items.length > 80) bibleList.append(el('p', { class: 'muted small', text: `Showing 80 of ${items.length}. Type to narrow the list.` }));
  }
  filter.addEventListener('input', showCatalogue);
  const checkBtn = el('button', { class: 'btn small', type: 'button', text: 'Check key and list Bibles', onclick: async () => {
    await saveSetting(o.keyName, keyInput.value.trim());
    if (!S[o.keyName]) { toast('Paste the key first.', true); return; }
    checkBtn.disabled = true;
    try {
      const langs = langInput ? langInput.value.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean) : [];
      catalogue = await o.fetchList(langs.length ? langs : ['af', 'en']);
      filter.hidden = false;
      showCatalogue();
      const ready = catalogue.filter(b => b.licensed !== false).length, need = catalogue.length - ready;
      toast(!catalogue.length ? `The key works, but ${o.title} lists no Bibles for those languages.`
        : !ready ? `The key works, but none of the ${need} Bibles listed is licensed to your app yet. Tap Licence next to one to see how to get it.`
        : need ? `The key works: ${ready} ready to read, and ${need} more need a licence for your app (marked in the list).`
        : `The key works: ${ready} Bibles available. Tick the ones to show in the reader.`);
    } catch (e) { toast(e.message, true); }
    checkBtn.disabled = false;
  } });
  showChosen();

  container.append(...[
    el('h3', { class: 'sub', text: o.title }),
    el('details', { class: 'small' }, [
      el('summary', { text: `How to get a ${o.title} key` }),
      el('ol', {}, o.howTo.map(parts => el('li', {}, parts))),
    ]),
    el('label', { class: 'f' }, [`${o.title} key`, el('div', { class: 'row line' }, [keyInput, showBtn, checkBtn])]),
    langInput ? el('label', { class: 'f' }, ['Languages to list (codes such as af, en, de)', langInput]) : null,
    chosenNow, filter, bibleList,
    el('p', { class: 'muted small', text: o.note }),
  ].filter(Boolean));
}

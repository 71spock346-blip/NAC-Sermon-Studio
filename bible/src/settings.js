/*
 * Settings: the API.Bible key and which of its Bibles to show, the person's
 * name and congregation, book-name language, backup, offline texts, and the
 * copyright notices the bundled texts and API.Bible ask for.
 */
import { el, clear, toast, confirmBox, download, today } from './ui.js';
import { state, saveSetting, exportAll, importAll, clearCache, wipeAll } from './store.js';
import * as Bible from './bible.js';
import { BOOKS } from './books.js';

export const VERSION = '0.1.0';

export function render(container) {
  clear(container);
  const S = state.settings;

  // ---- translations and the key
  const keyInput = el('input', { type: 'password', value: S.apiKey || '', placeholder: 'Paste your API.Bible key', autocomplete: 'off', spellcheck: 'false' });
  const showBtn = el('button', { class: 'btn small ghost', type: 'button', text: 'Show', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; showBtn.textContent = keyInput.type === 'password' ? 'Show' : 'Hide'; } });
  keyInput.addEventListener('change', async () => { await saveSetting('apiKey', keyInput.value.trim()); toast(keyInput.value.trim() ? 'Key saved on this device.' : 'Key removed.'); });
  const bibleList = el('div', { class: 'list biblelist' });
  const filter = el('input', { type: 'search', placeholder: 'Filter: Afrikaans, NKJV, English…', hidden: true });
  let catalogue = null;

  function showCatalogue() {
    clear(bibleList);
    if (!catalogue) return;
    const q = filter.value.trim().toLowerCase();
    const chosen = new Set((S.apiBibles || []).map(b => b.id));
    const items = catalogue.filter(b => !q || (b.name + ' ' + b.abbreviation + ' ' + b.language + ' ' + b.description).toLowerCase().includes(q));
    items.sort((a, b) => (chosen.has(b.id) - chosen.has(a.id)) || (a.language + a.name).localeCompare(b.language + b.name));
    if (!items.length) bibleList.append(el('p', { class: 'muted small', text: 'No Bible matches that filter.' }));
    for (const b of items.slice(0, 80)) {
      const cb = el('input', { type: 'checkbox', checked: chosen.has(b.id) });
      cb.addEventListener('change', async () => {
        const list = (S.apiBibles || []).filter(x => x.id !== b.id);
        if (cb.checked) list.push({ id: b.id, abbreviation: b.abbreviation, name: b.name, language: b.language });
        await saveSetting('apiBibles', list);
        toast(cb.checked ? `${b.abbreviation} added to the reader.` : `${b.abbreviation} removed from the reader.`);
      });
      bibleList.append(el('label', { class: 'check' }, [cb, el('b', { text: b.abbreviation }), el('span', { class: 'grow', text: b.name }), el('span', { class: 'muted small', text: b.language })]));
    }
    if (items.length > 80) bibleList.append(el('p', { class: 'muted small', text: `Showing 80 of ${items.length}. Type to narrow the list.` }));
  }
  filter.addEventListener('input', showCatalogue);
  const checkBtn = el('button', { class: 'btn small', type: 'button', text: 'Check key and list Bibles', onclick: async () => {
    await saveSetting('apiKey', keyInput.value.trim());
    if (!S.apiKey) { toast('Paste the key first.', true); return; }
    checkBtn.disabled = true;
    try {
      catalogue = await Bible.listBibles();
      filter.hidden = false;
      showCatalogue();
      toast(`The key works: ${catalogue.length} Bibles available. Tick the ones to show in the reader.`);
    } catch (e) { toast(e.message, true); }
    checkBtn.disabled = false;
  } });

  const chosenNow = el('p', { class: 'small' });
  function showChosen() {
    chosenNow.textContent = (S.apiBibles || []).length ? 'In the reader: ' + S.apiBibles.map(b => b.abbreviation).join(', ') : 'No API Bibles chosen yet. The reader has the KJV and the WEB built in.';
  }
  showChosen();
  bibleList.addEventListener('change', showChosen);

  container.append(
    el('div', { class: 'docbar' }, [el('h3', { text: 'Translations' })]),
    el('p', { class: 'small' }, [
      'The King James Version (with the Apocrypha) and the World English Bible are built in and work offline. ',
      'The NKJV and the Afrikaans Bibles are copyrighted, so they are read live from ',
      el('a', { href: 'https://scripture.api.bible', target: '_blank', rel: 'noopener', text: 'API.Bible' }),
      ' with your own free key. The key stays on this device: it is not in any backup and not shared.',
    ]),
    el('details', { class: 'small' }, [
      el('summary', { text: 'How to get a key' }),
      el('ol', {}, [
        el('li', {}, ['Open ', el('a', { href: 'https://scripture.api.bible/signup', target: '_blank', rel: 'noopener', text: 'scripture.api.bible/signup' }), ' and create a free account (non-commercial use).']),
        el('li', { text: 'Create an application in the dashboard. Every application has a key.' }),
        el('li', { text: 'Copy the key, paste it below and tap "Check key". Then tick the Bibles to show in the reader.' }),
        el('li', { text: 'Which Bibles a key may read depends on the licences API.Bible has granted it. If a translation is not listed, request it in your API.Bible dashboard.' }),
      ]),
    ]),
    el('label', { class: 'f' }, ['API.Bible key', el('div', { class: 'row line' }, [keyInput, showBtn, checkBtn])]),
    chosenNow, filter, bibleList,
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ghost', type: 'button', text: 'Clear cached chapters', onclick: async () => { await clearCache(); toast('Cached chapters cleared.'); } }),
      el('span', { class: 'muted small', text: 'Chapters from API.Bible are kept for 30 days so they open offline.' }),
    ]),
  );

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
    el('p', { class: 'small', text: `Everything you write stays in this browser on this device: ${state.notes.length} note${state.notes.length === 1 ? '' : 's'} and ${state.sermons.length} preparation${state.sermons.length === 1 ? '' : 's'} right now. Save a backup file regularly and keep it in your Google Drive. Load it on another device to carry your notes across; newer copies win and nothing is deleted.` }),
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
    el('p', { class: 'small', text: 'The app keeps every chapter you open. To have the whole KJV, WEB and Catechism index ready without a connection (about 10 MB), download them once here. Add the app to your home screen to open it like any other app.' }),
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
      el('li', { text: 'Scripture read through API.Bible is the copyright of its publishers and is shown under their terms; see the notice under each chapter.' }),
      el('li', { text: 'Catechism of the New Apostolic Church: only the section numbers, titles and Bible references are indexed here. The text is read at nak.org.' }),
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

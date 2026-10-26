/*
 * Start-up and navigation.
 *
 * The address decides the screen: #read/PSA/130/7 opens Psalm 130 at verse 7,
 * #notes lists the notes, #prepare/<id> opens one service preparation,
 * #catechism/3.4.1 opens a Catechism section, #settings is settings. The back
 * button therefore works as people expect, and a link to a verse can be
 * shared.
 */
import { $, $$ } from './ui.js';
import { load } from './store.js';
import * as Reader from './reader.js';
import * as Notes from './notes.js';
import * as Prepare from './prepare.js';
import * as Cat from './catechism.js';
import * as Settings from './settings.js';

const TABS = {
  read: Reader.render,
  notes: Notes.render,
  prepare: Prepare.render,
  catechism: Cat.render,
  settings: Settings.render,
};

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS[parts[0]] ? parts[0] : 'read';
  for (const b of $$('nav.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const panel of $$('.card.tab')) panel.hidden = panel.id !== 'tab-' + tab;
  const container = $('#tab-' + tab);
  container.scrollTop = 0;
  try {
    TABS[tab](container, parts.length ? parts : [tab]);
  } catch (e) {
    container.textContent = 'Something went wrong on this screen: ' + (e.message || e);
    console.error(e);
  }
  if (parts[0] !== 'read' || parts.length <= 2) window.scrollTo(0, 0);
}

async function start() {
  await load();
  Cat.load().catch(() => {});
  for (const b of $$('nav.tabs button')) b.addEventListener('click', () => { location.hash = '#' + b.dataset.tab; });
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start().catch(e => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="error" style="padding:12px">The app could not start: ${e.message || e}</p>`);
  console.error(e);
});

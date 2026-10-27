/*
 * Start-up and navigation.
 *
 * The address decides the screen: #read/PSA/130/7 opens Psalm 130 at verse 7,
 * #notes lists the notes, #prepare/<id> opens one service preparation,
 * #catechism/3.4.1 opens a Catechism section, #settings is settings. The back
 * button therefore works as people expect, and a link to a verse can be
 * shared.
 */
import { $, $$, applyTheme, syncThemeColor } from './ui.js';
import { load, state } from './store.js';
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
const ORDER = Object.keys(TABS);

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS[parts[0]] ? parts[0] : 'read';
  for (const b of $$('.tabs button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
  for (const panel of $$('main .tab')) panel.hidden = panel.id !== 'tab-' + tab;
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

/** Arrow keys move between the tabs, as a tab list should. */
function tabKeys(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  const buttons = $$('.tabs button');
  const i = buttons.findIndex(b => b === document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const k = keys[e.key];
  const next = k === 'first' ? 0 : k === 'last' ? buttons.length - 1 : (i + k + buttons.length) % buttons.length;
  buttons[next].focus();
  location.hash = '#' + ORDER[next];
}

async function start() {
  await load();
  applyTheme(state.settings.theme || 'system');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  Cat.load().catch(() => {});
  for (const b of $$('.tabs button')) b.addEventListener('click', () => { location.hash = '#' + b.dataset.tab; });
  $('.tabs').addEventListener('keydown', tabKeys);
  $('.skip').addEventListener('click', e => { e.preventDefault(); $('#content').focus(); });
  const v = $('#nav-version');
  if (v) v.textContent = 'Version ' + Settings.VERSION;
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

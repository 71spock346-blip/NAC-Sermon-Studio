/*
 * Start-up and navigation.
 *
 * The address decides the screen: #read/PSA/130/7 opens Psalm 130 at verse 7,
 * #notes lists the notes, #prepare/<id> opens one service preparation,
 * #reflect lists the reflection evenings and #reflect/<id> opens the slides
 * of one, #catechism/3.4.1 opens a Catechism section, #theology/ROM/8 opens
 * the background to a chapter (theology.js), #liturgy/baptism opens a card
 * of the altar booklet (liturgy.js), #settings is settings.
 * The back button therefore works as people expect, and a link to a verse
 * can be shared.
 *
 * The interface speaks English or Afrikaans (i18n.js). The switch sits in the
 * header on a phone and in the side menu on a PC, and under Settings; a change
 * redraws the open screen in the other language.
 *
 * #seating opens the seating and communion plan, #seating/<id> a saved one,
 * and #choir the choir programme.
 *
 * #sync/<code> is the link a sync QR code or "Copy link" carries: it opens
 * Settings and offers to join with that code (sync.js keeps the devices the
 * same from then on). When a sync brings changes from another device, the
 * open screen is redrawn, unless the person is typing in it.
 */
import { $, $$, applyTheme, applyRead, syncThemeColor, toast } from './ui.js';
import { load, state, saveSetting } from './store.js';
import { t, lang, setLang, translatePage } from './i18n.js';
import { unlocked as helperUnlocked } from './lock.js';   // is the AI helper open on this device? (what a locked device may not mention)
import * as Reader from './reader.js';
import * as Notes from './notes.js';
import * as Prepare from './prepare.js';
import * as Cat from './catechism.js';
import * as Theology from './theology.js';
import * as Liturgy from './liturgy.js';
import * as Seating from './seating.js';
import * as ChoirTab from './choir.js';
import * as Settings from './settings.js';
import * as Sync from './sync.js';
import * as Update from './update.js';   // a newer version of the app on the site: a bar offers to load it

const TABS = {
  read: Reader.render,
  notes: Notes.render,
  prepare: Prepare.render,
  reflect: Prepare.renderReflect,
  liturgy: Liturgy.render,
  seating: Seating.render,
  choir: ChoirTab.render,
  catechism: Cat.render,
  theology: Theology.render,
  settings: Settings.render,
};

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'sync') {
    // a scanned or pasted sync link: the code must not stay in the address bar or the history
    const code = parts[1] || '';
    history.replaceState(null, '', '#settings');
    route();
    if (code) Settings.joinSheet(code);
    return;
  }
  if (parts[0] === 'prepare' && parts[2] === 'reflect') {
    // the reflection evening's old address (until November 2026): it has its own place in the menu now
    history.replaceState(null, '', `#reflect/${parts[1]}`);
    route();
    return;
  }
  const tab = TABS[parts[0]] ? parts[0] : 'read';
  for (const b of $$('.tabs button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    // the phone's bar has no Theology or Liturgy tab (they are reached from the reader and from Prepare), so there Read or Prepare stays lit
    b.classList.toggle('also', (tab === 'theology' && b.dataset.tab === 'read') || (tab === 'liturgy' && b.dataset.tab === 'prepare'));
  }
  for (const panel of $$('main .tab')) panel.hidden = panel.id !== 'tab-' + tab;
  const container = $('#tab-' + tab);
  container.scrollTop = 0;
  try {
    TABS[tab](container, parts.length ? parts : [tab]);
  } catch (e) {
    container.textContent = t('Something went wrong on this screen: {error}', { error: e.message || e });
    console.error(e);
  }
  if (parts[0] !== 'read' || parts.length <= 2) window.scrollTo(0, 0);
}

/** Arrow keys move between the tabs, as a tab list should. */
function tabKeys(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  const buttons = $$('.tabs button').filter(b => b.offsetParent !== null);   // the tabs shown: the phone has no Theology or Liturgy tab
  const i = buttons.findIndex(b => b === document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const k = keys[e.key];
  const next = k === 'first' ? 0 : k === 'last' ? buttons.length - 1 : (i + k + buttons.length) % buttons.length;
  buttons[next].focus();
  location.hash = '#' + buttons[next].dataset.tab;
}

/* ---------------------------------------------------------------- language */

/** Puts the page's own words (tabs, header, menu) in the chosen language and marks the switch. */
function applyLang(l) {
  setLang(l);
  document.title = t('NAC Study Bible');
  translatePage();
  const v = $('#nav-version');
  if (v) v.textContent = t('Version {v}', { v: Update.versionText(Settings.VERSION) });
  for (const b of $$('.lang-switch button')) {
    const on = b.dataset.lang === lang();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/**
 * Switches the whole app to English or Afrikaans and redraws the open screen.
 * The book names and the language of Claude's suggestions follow, so one tap
 * sets all three; Settings can still set either of them apart afterwards.
 * The other screens ask for it with i18n.js requestLang: nothing imports
 * app.js, which must run only once.
 */
async function switchLang(l) {
  const to = l === 'af' ? 'af' : 'en';
  if (to === lang()) return;
  await saveSetting('uiLang', to);
  await saveSetting('bookLang', to);
  await saveSetting('aiLang', to);
  applyLang(to);
  route();
  toast(helperUnlocked() ? t('The app is now in English: the screens, the book names and Claude\'s suggestions.') : t('The app is now in English: the screens and the book names.'));
}

/** Another device's changes have arrived: redraw the open screen, unless the person is in the middle of typing or of a preparation. */
function onSynced(e) {
  const parts = e.detail.parts || [];
  if (parts.includes('settings')) {
    applyRead(state.settings.readMode || 'book');
    if ((state.settings.uiLang || 'en') !== lang()) applyLang(state.settings.uiLang || 'en');
  }
  const hash = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS[hash[0]] ? hash[0] : 'read';
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing || $('.overlay')) return;
  if (tab === 'read') return;                               // the reader keeps its place; the notes show on the next chapter
  if ((tab === 'prepare' || tab === 'reflect') && hash.length > 1) return;   // an open preparation or evening is not pulled from under the person
  if (tab === 'notes' && !parts.includes('notes')) return;
  if (tab === 'catechism' && !parts.includes('catechism')) return;
  if (tab === 'theology' && (hash.length > 1 || !parts.includes('theology'))) return;   // an open book or chapter keeps its place; the list shows what came
  if (tab === 'liturgy' && (hash.length > 1 || !parts.includes('liturgy'))) return;      // a card open at the altar is not redrawn under the person
  if ((tab === 'prepare' || tab === 'reflect') && !parts.some(p => p === 'sermons' || p === 'guides' || p === 'settings')) return;
  route();
}

/**
 * The welcome screen (index.html) stays at least a little over a second, so
 * it is seen rather than flashed, then fades; a tap sends it away at once.
 * It shows once each time the app is opened (index.html keeps a note in
 * sessionStorage), not on a reload or on coming back from the help page.
 */
function hideSplash() {
  const splash = $('#splash');
  if (!splash) return;
  const go = () => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 600); };
  splash.addEventListener('click', go);
  setTimeout(go, Math.max(0, 1300 - performance.now()));
}

/**
 * Asks the browser to keep what is saved in the app (notes, preparations,
 * what Claude wrote in Theology) even when the device runs short of space,
 * instead of clearing it as it may for a site it thinks is little used.
 * Most browsers decide by themselves without asking; Firefox asks once.
 */
function keepData() {
  const s = navigator.storage;
  if (!s || !s.persist || !s.persisted) return;
  s.persisted().then(kept => kept || s.persist()).catch(() => {});
}

async function start() {
  await load();
  await Sync.init();
  applyTheme(state.settings.theme || 'system');
  applyRead(state.settings.readMode || 'book');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  Cat.load().catch(() => {});
  for (const b of $$('.tabs button')) b.addEventListener('click', () => { location.hash = '#' + b.dataset.tab; });
  $('.tabs').addEventListener('keydown', tabKeys);
  $('.skip').addEventListener('click', e => { e.preventDefault(); $('#content').focus(); });
  for (const b of $$('.lang-switch button')) b.addEventListener('click', () => switchLang(b.dataset.lang));
  document.addEventListener('sb-lang', e => switchLang(e.detail));   // the reader's Aa sheet and Settings (i18n.js requestLang)
  applyLang(state.settings.uiLang || 'en');
  window.addEventListener('hashchange', route);
  route();
  hideSplash();
  document.addEventListener('sb-sync', onSynced);
  document.addEventListener('sb-lock', route);   // the helper was unlocked or locked here (lock.js): the screen shows or hides Claude's part
  Sync.start();
  keepData();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  Update.start();
}

start().catch(e => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="error" style="padding:12px">${t('The app could not start: {error}', { error: e.message || e })}</p>`);
  hideSplash();
  console.error(e);
});

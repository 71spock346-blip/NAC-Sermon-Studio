/*
 * Start-up and navigation.
 *
 * The address decides the screen: #sunday is the front door, the next divine
 * service with one tap to the cue cards and the altar card (sunday.js), where
 * the app opens; #read/PSA/130/7 opens Psalm 130 at verse 7,
 * #notes lists the notes, #prepare/<id> opens one service preparation,
 * #reflect lists the reflection evenings and #reflect/<id> opens the slides
 * of one, #catechism/3.4.1 opens a Catechism section, #theology/ROM/8 opens
 * the background to a chapter (theology.js), #liturgy/baptism opens a card
 * of the altar booklet (liturgy.js), #handbooks/<key>/<n> a chapter of one of
 * the Church's handbooks (handbooks.js), #files is Church files (files.js),
 * where the Church's own texts are loaded, #settings is settings.
 * The back button therefore works as people expect, and a link to a verse
 * can be shared.
 *
 * The interface speaks English or Afrikaans (i18n.js). The switch sits in the
 * header on a phone and in the side menu on a PC, and under Settings; a change
 * redraws the open screen in the other language.
 *
 * #seating opens the seating and communion plan, #seating/<id> a saved one,
 * and #choir the choir programme. #more is the last tab of the phone's bar
 * (more.js): the sections the bar has no room for, one under the other, the Tools
 * (Seating, Choir, Reminders, MIS, Reflection evening) under their heading
 * as in the PC's side menu, and Handbooks, since Sunday has the bar's place
 * it had. The Catechism and the Liturgy are listed under Handbooks
 * (handbooks.js), which stays lit while one of them is open on a PC; on a
 * phone More is lit for all three. #reminders is
 * the birthdays and anniversaries (#reminders/people the roster,
 * #reminders/import the listings). #plan is the month plan (#plan/2025-10 one
 * month of it): the district's programme with who holds each service.
 *
 * #altar/<id> is Altar mode (altar.js): the cue cards and the altar card of
 * one preparation on one full screen, a swipe apart, opened from the Sunday
 * card; the header, the menu and the bar are hidden while it is open
 * (body.altar). #record/<id> is the service record of one preparation
 * (record.js), the form for the district's WhatsApp group, opened from the
 * Sunday card once the day has come and from the preparation's Print step.
 * It has a tab of its own on the bar and in the menu, Service record:
 * #record alone opens the service just held (today's, else the last one,
 * else the next).
 *
 * #sync/<code> is the link a sync QR code or "Copy link" carries: it opens
 * Settings and offers to join with that code (sync.js keeps the devices the
 * same from then on). When a sync brings changes from another device, the
 * open screen is redrawn, unless the person is typing in it.
 *
 * #fill/<code> is the deacons' link (fill.js): the service record of the
 * current service and nothing else. The app then starts as that one page
 * (startFill): no menu, no bar, no sync, nothing of the device's own.
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
import * as Handbooks from './handbooks.js';   // the Church's handbooks, read from their files on the device
import * as Files from './files.js';   // Church files: the Church's own texts, each loaded once from its file
import * as Seating from './seating.js';
import * as ChoirTab from './choir.js';
import * as Reminders from './reminders.js';
import * as Plan from './plan.js';   // the month plan: the district's programme with who holds each service
import * as Settings from './settings.js';
import * as More from './more.js';
import * as Tools from './tools.js';   // "What I use": the tools unticked in Settings leave the menu and More
import * as Sunday from './sunday.js';   // the front door: the next divine service, one tap to each thing used at the altar
import * as Altar from './altar.js';   // Altar mode: the cue cards and the altar card on one full screen, from the Sunday card
import * as Record from './record.js';   // the service record: NACSA's form, filled in after the service for the district's WhatsApp group
import * as Mis from './mis.js';   // the Church's MIS: a section whose button opens the site itself
import * as Sync from './sync.js';
import * as Update from './update.js';   // a newer version of the app on the site: a bar offers to load it
import * as Fill from './fill.js';   // the deacons' link: the service record filled in on their phones
import * as Welcome from './welcome.js';   // first-time setup: five steps on a new device, once, after the splash

const TABS = {
  sunday: Sunday.render,
  altar: Altar.render,
  record: Record.render,
  read: Reader.render,
  notes: Notes.render,
  prepare: Prepare.render,
  reflect: Prepare.renderReflect,
  liturgy: Liturgy.render,
  seating: Seating.render,
  choir: ChoirTab.render,
  reminders: Reminders.render,
  plan: Plan.render,
  catechism: Cat.render,
  handbooks: Handbooks.render,
  files: Files.render,
  theology: Theology.render,
  settings: Settings.render,
  mis: Mis.render,
  more: More.render,
};

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'sync') {
    // a scanned or pasted sync link: the code must not stay in the address bar or the history
    const code = parts[1] || '';
    history.replaceState(null, '', '#settings/sync');
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
  const tab = TABS[parts[0]] ? parts[0] : (parts.length ? 'read' : 'sunday');   // no address: the app opens on Sunday, the next service; one it does not know opens the reader
  document.body.classList.toggle('altar', tab === 'altar');   // Altar mode has the whole screen: the header, the menu and the bar go (styles.css)
  for (const b of $$('.tabs button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
    // a section listed under another lights that one too: More while one of its sections is open (the phone's bar; a PC shows them in the menu, and no More), Handbooks while the Catechism or the Liturgy is open
    b.classList.toggle('also', (b.dataset.tab === 'more' && More.isMore(tab)) || (b.dataset.tab === 'handbooks' && Handbooks.holds(tab)));
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
  const buttons = $$('.tabs button').filter(b => b.offsetParent !== null);   // the tabs shown: the phone's bar has six, the PC's menu has no More
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
  document.title = t('Study Bible');
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
    Tools.apply();   // a tool ticked or unticked on another device
    if ((state.settings.uiLang || 'en') !== lang()) applyLang(state.settings.uiLang || 'en');
  }
  const hash = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = TABS[hash[0]] ? hash[0] : (hash.length ? 'read' : 'sunday');
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing || $('.overlay')) return;
  if (tab === 'read') return;                               // the reader keeps its place; the notes show on the next chapter
  if (tab === 'altar') return;                              // nothing is pulled from under the person at the altar
  if (tab === 'record' && hash.length > 1) return;          // the record being filled in keeps what is typed; the other device's lines show on the next open
  if (tab === 'record' && !parts.includes('sermons')) return;   // "No service with a date yet": a preparation that comes from another device opens its record
  if ((tab === 'prepare' || tab === 'reflect') && hash.length > 1) return;   // an open preparation or evening is not pulled from under the person
  if (tab === 'notes' && !parts.includes('notes')) return;
  if (tab === 'catechism' && !parts.includes('catechism')) return;
  if (tab === 'theology' && (hash.length > 1 || !parts.includes('theology'))) return;   // an open book or chapter keeps its place; the list shows what came
  if (tab === 'liturgy' && (hash.length > 1 || !parts.includes('liturgy'))) return;      // a card open at the altar is not redrawn under the person
  if (tab === 'handbooks' && (hash.length > 1 || !parts.includes('handbooks'))) return;  // an open chapter keeps its place; the list shows what came
  if (tab === 'files' && !parts.some(p => p === 'catechism' || p === 'liturgy' || p === 'handbooks' || p === 'guides')) return;   // the rows follow what is loaded
  if (tab === 'sunday' && !parts.some(p => p === 'sermons' || p === 'guides' || p === 'liturgy' || p === 'settings')) return;   // the next service follows the preparations, the Guides and the altar booklet
  if (tab === 'plan' && !parts.includes('plans')) return;
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

/**
 * A deacon opened the minister's link (#fill/<code>): the page is the service
 * record of the service on the link and nothing else (fill.js). The header
 * keeps the language switch; a change of language is for this page only and
 * is not saved. Another address opens the app as usual, from the start.
 */
function startFill(code) {
  document.body.classList.add('fill');   // styles.css: no menu, no bar, the header on a PC too
  applyTheme(state.settings.theme || 'system');
  applyRead(state.settings.readMode || 'book');
  const container = $('#tab-record');
  for (const panel of $$('main .tab')) panel.hidden = panel !== container;
  // the page's title, in the header (where the app's name stands) and in the browser's tab: Service Record Gezina
  const name = $('header.top h1 [data-t]');
  if (name) name.removeAttribute('data-t');
  let place = '';
  const together = s => s.replace(/ /g, '\u00a0');   // "Service Record" stays on one line; on a narrow phone the name goes to the next
  const showTitle = () => { const title = Fill.heading(place); document.title = title; if (name) name.textContent = title.replace(t('Service Record'), together(t('Service Record'))); };
  const useLang = l => { state.settings.uiLang = l; state.settings.bookLang = l; applyLang(l); showTitle(); };
  useLang(state.settings.uiLang || 'en');
  const page = Fill.openPage(container, code, { setLang: useLang, setPlace: p => { place = p; showTitle(); } });
  for (const b of $$('.lang-switch button')) b.addEventListener('click', () => { if (b.dataset.lang === lang()) return; useLang(b.dataset.lang); page.redraw(); });
  window.addEventListener('hashchange', () => location.reload());
  hideSplash();
}

async function start() {
  await load();
  const fill = Fill.codeFromHash();
  if (fill) return startFill(fill);
  await Sync.init();
  applyTheme(state.settings.theme || 'system');
  applyRead(state.settings.readMode || 'book');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  Cat.load().catch(() => {});
  for (const b of $$('.tabs button')) b.addEventListener('click', () => {
    location.hash = '#' + b.dataset.tab;
    if (b.dataset.tab === 'mis') Mis.open();   // the MIS section is the way back; the site itself opens at once (mis.js)
  });
  $('.tabs').addEventListener('keydown', tabKeys);
  $('.skip').addEventListener('click', e => { e.preventDefault(); $('#content').focus(); });
  for (const b of $$('.lang-switch button')) b.addEventListener('click', () => switchLang(b.dataset.lang));
  document.addEventListener('sb-lang', e => switchLang(e.detail));   // the reader's Aa sheet and Settings (i18n.js requestLang)
  applyLang(state.settings.uiLang || 'en');
  Tools.apply();
  window.addEventListener('hashchange', route);
  route();
  hideSplash();
  Welcome.maybe();
  document.addEventListener('sb-sync', onSynced);
  document.addEventListener('sb-lock', route);   // the helper was unlocked or locked here (lock.js): the screen shows or hides Claude's part
  Sync.start();
  Fill.start();   // the deacons' link, when there is one: their lines come into the record, and it moves on to the next service
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

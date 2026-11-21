/*
 * First-time setup: five short steps on a new device, shown once.
 *
 * A device that had never been used opened on Psalm 23 with no hint of what
 * to do, so a minister given the link needed someone beside him for an hour.
 * Now, the first time the app opens with no address on a fresh device (no
 * name, no sync, no notes, no preparations), a sheet walks through the five
 * things a new device needs, after the splash: the language; the name and
 * congregation; the sync code from another device, or starting fresh; what
 * Church files is; and putting the app on the home screen. "Skip for now" or
 * the ✕ ends it, and it does not come back by itself: Settings → About has it
 * again ("Set up this device again"). A device already in use before this
 * version never sees it. The help page lists the same five steps under
 * "Start here".
 *
 * The walk never interrupts an address: a sync link (#join…), a file shared
 * to the app (#files/shared) or a bookmark opens as it always did.
 *
 * On Android, Chrome, Edge and Samsung Internet offer to install the app
 * themselves (beforeinstallprompt). The offer is kept here and shown as the
 * "Add to Home Screen" button, in the last step and under Settings → Offline;
 * until now the app never asked. Where there is no such offer (Safari on an
 * iPhone, Firefox, a PC browser that does not install), the step says where
 * the browser's own button is. The home-screen copy also keeps what is saved
 * safe: a browser throws a site's data away sooner than an installed app's.
 */
import { el, clear, sheet, seg } from './ui.js';
import { t, lang, LANGS, requestLang } from './i18n.js';
import { state, saveSetting } from './store.js';
import * as Sync from './sync.js';
import { joinForm } from './join.js';
import { installed } from './mis.js';

let offer = null;    // the browser's offer to install (beforeinstallprompt), kept until the person asks for it
let added = false;   // installed from this very page: the tab itself still runs in the browser, so installed() stays false here
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); offer = e; document.dispatchEvent(new CustomEvent('sb-install')); });
window.addEventListener('appinstalled', () => { offer = null; added = true; document.dispatchEvent(new CustomEvent('sb-install')); });

const onIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));
const onPhone = () => onIos() || /Android|Mobile/.test(navigator.userAgent);

/** Does the browser offer to install the app? (Chrome, Edge and Samsung Internet do, once the app is not installed yet.) */
export function canInstall() { return !!offer; }

/** Shows the browser's own install box. Resolves true once the person has accepted. */
export async function install() {
  const e = offer;
  if (!e) return false;
  offer = null;
  try {
    e.prompt();
    const choice = await e.userChoice;
    if (choice && choice.outcome === 'accepted') added = true;
  } catch (err) { /* the browser would not show it: the hint takes the button's place */ }
  document.dispatchEvent(new CustomEvent('sb-install'));
  return added;
}

/** Where the browser's own button is, for a browser that makes no offer of its own. */
export function homeHint() {
  if (onIos()) return t('In Safari, tap Share (the square with the arrow at the bottom), then "Add to Home Screen".');
  if (onPhone()) return t('In the browser\'s menu (the three dots at the top), tap "Add to Home screen" or "Install app".');
  return t('In the browser\'s address bar, click the install icon at the right, or "Install Study Bible" in the browser\'s menu.');
}

/**
 * The install row: the "Add to Home Screen" button while the browser offers
 * to install, otherwise where the browser's own button is, or a line that
 * the app is on the home screen already. It draws itself again when the
 * offer comes, since the browser can make it after the row stands.
 */
export function homeRow() {
  const box = el('div', { class: 'home-row' });
  let first = true;
  const draw = () => {
    if (!first && !box.isConnected) { document.removeEventListener('sb-install', draw); return; }
    first = false;
    clear(box);
    if (installed()) box.append(el('p', { class: 'muted small', text: onPhone() ? t('Already on this device\'s home screen.') : t('Already installed on this PC.') }));
    else if (added) box.append(el('p', { class: 'muted small', text: onPhone() ? t('Added to the home screen. Open the Study Bible from there from now on.') : t('Installed. Open the Study Bible from its own icon from now on.') }));
    else if (offer) box.append(el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: onPhone() ? t('Add to Home Screen') : t('Install as an app'), onclick: e => { e.currentTarget.disabled = true; install(); } })]));
    else box.append(el('p', { class: 'small', text: homeHint() }));
  };
  draw();
  document.addEventListener('sb-install', draw);
  return box;
}

let walk = null;   // the sheet while it is open

/** Once the app stands (app.js start): opens the walk on a fresh device opened with no address, after the splash. */
export function maybe() {
  if (location.hash.length > 1) return;
  const S = state.settings;
  if (S.welcomed) return;
  const fresh = !S.name && !Sync.isOn() && !state.notes.length && !state.sermons.length;
  if (!fresh) { saveSetting('welcomed', true); return; }   // in use before this version: it has found its way already
  const splash = document.getElementById('splash');
  setTimeout(() => open(), splash ? Math.max(0, 1300 - performance.now()) + 700 : 150);
}

/** Is any of the Church's texts on this device? (Church files opens after the walk when none is.) */
function anyChurchFile() {
  return !!state.catechism || state.liturgy.length > 0 || state.handbooks.length > 0 || state.guides.length > 0;
}

/** The five steps in a sheet; Settings → About opens it again at any time. Closing it, in any way, counts as seen. */
export function open() {
  if (walk) return;
  let i = 0;
  let step = null;
  const s = sheet(t('Welcome to the Study Bible'), { sticky: true, onclose: () => { walk = null; saveSetting('welcomed', true); } });
  walk = s;
  s.root.classList.add('welcome');
  const steps = [languageStep, youStep, syncStep, filesStep, homeStep];
  const ctl = {
    async next() { if (step && step.onLeave) await step.onLeave(); if (i < steps.length - 1) { i++; draw(); } else finish(); },
    async back() { if (step && step.onLeave) await step.onLeave(); if (i > 0) { i--; draw(); } },
    redraw: () => draw(),
  };
  function finish() {
    s.close();
    if (!anyChurchFile() && location.hash !== '#files') location.hash = '#files';
  }
  function draw() {
    clear(s.body);
    s.head.querySelector('h2').textContent = t('Welcome to the Study Bible');
    step = steps[i](ctl);
    s.body.append(el('div', { class: 'welcome-step' }, [
      el('p', { class: 'muted small step-of', text: t('Step {n} of {m}', { n: i + 1, m: steps.length }) }),
      el('h3', { text: step.title }),
      ...step.body,
    ]));
    const foot = el('div', { class: 'row end welcome-foot' });
    if (i > 0) foot.append(el('button', { class: 'btn ghost', type: 'button', text: t('Back'), onclick: ctl.back }));
    if (i < steps.length - 1) foot.append(el('button', { class: 'btn ghost', type: 'button', text: t('Skip for now'), onclick: () => s.close() }));
    if (!step.noNext) foot.append(el('button', { class: 'btn', type: 'button', text: i < steps.length - 1 ? t('Next') : t('Done'), onclick: ctl.next }));
    s.body.append(foot);
    s.body.scrollTop = 0;
  }
  draw();
}

/* ------------------------------------------------------------- the steps */

/** 1. The language: the whole app switches at once (app.js), and this sheet follows once it has. */
function languageStep({ redraw }) {
  const pick = seg(LANGS, lang(), v => {
    requestLang(v);
    let tries = 0;
    const follow = () => { if (lang() === v || tries++ > 100) redraw(); else setTimeout(follow, 20); };
    follow();
  }, { block: true, label: t('Language of the app') });
  return {
    title: t('In which language should the app speak?'),
    body: [pick, el('p', { class: 'muted small', text: t('The screens, the buttons, the help page and the book names. It can be changed at any time with EN or AF at the top of the app.') })],
  };
}

/** 2. The name and congregation, saved on the way to the next step. */
function youStep() {
  const S = state.settings;
  const name = el('input', { type: 'text', value: S.name || '', placeholder: t('Your name'), autocomplete: 'name' });
  const cong = el('input', { type: 'text', value: S.congregation || '', placeholder: t('Your usual congregation') });
  return {
    title: t('Who are you?'),
    body: [
      el('p', { class: 'small', text: t('Your name goes in the footer of the sermon notes, and the congregation is filled in for each new preparation.') }),
      el('div', { class: 'fields two' }, [el('label', { class: 'f' }, [t('Name'), name]), el('label', { class: 'f' }, [t('Congregation'), cong])]),
    ],
    async onLeave() {
      if (name.value.trim() !== (state.settings.name || '')) await saveSetting('name', name.value.trim());
      if (cong.value.trim() !== (state.settings.congregation || '')) await saveSetting('congregation', cong.value.trim());
    },
  };
}

/** 3. Another device, or a fresh start: the code is typed here (join.js), and a join goes on to the next step by itself. */
function syncStep({ next }) {
  if (Sync.isOn()) {
    return { title: t('Your other devices'), body: [el('p', { class: 'small', text: t('Sync is on here already: this device and your other devices keep the same notes and preparations.') })] };
  }
  const haveCode = el('button', { class: 'btn ghost', type: 'button', text: t('I have a code') });
  const fresh = el('button', { class: 'btn ghost', type: 'button', text: t('Start fresh'), onclick: next });
  const choice = el('div', { class: 'welcome-choice' }, [haveCode, fresh]);
  haveCode.addEventListener('click', () => {
    const form = joinForm({ onJoined: next });
    haveCode.replaceWith(el('div', { class: 'welcome-join' }, [form.field, form.hint, el('div', { class: 'row end' }, [form.button])]));
    setTimeout(() => form.input.focus(), 30);
  });
  return {
    title: t('Do you already use the Study Bible on another device?'),
    body: [
      el('p', { class: 'small', text: t('With the code from that device (Settings → Sync → Show the code), your notes and preparations come over to this one, and the two stay the same from then on. Starting fresh, this device begins empty; a code can still be typed in later under Settings → Sync.') }),
      choice,
    ],
    noNext: true,
  };
}

/** 4. Church files: what it is, and that it opens next when nothing is loaded yet. */
function filesStep() {
  return {
    title: t('The Church\'s own texts'),
    body: [
      el('p', { class: 'small', text: t('The text of the Catechism, the altar booklet, the handbooks for ministers and the month\'s Divine Service Guide are the Church\'s own, so they are not part of the app. Each is loaded once from its file under Church files and then stays on your devices. A minister who has them can send you the files from his app.') }),
      el('p', { class: 'muted small', text: anyChurchFile() ? t('Some are on this device already; the rest can be loaded under Church files at any time.') : t('None is on this device yet: Church files opens when you finish here.') }),
    ],
  };
}

/** 5. The home screen (or the PC's own window): the button when the browser offers it, else where its own button is. */
function homeStep() {
  const phone = onPhone();
  return {
    title: phone ? t('On your home screen') : t('As an app on this PC'),
    body: [
      el('p', { class: 'small', text: phone
        ? t('Put the Study Bible on the home screen: it opens like an app, works without the network, and what you save is kept safe.')
        : t('Install the Study Bible as an app: it opens in its own window from its own icon, works without the network, and what you save is kept safe.') }),
      homeRow(),
    ],
  };
}

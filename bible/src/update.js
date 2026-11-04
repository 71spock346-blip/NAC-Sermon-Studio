/*
 * A newer version of the app on the site.
 *
 * The app is often left open for days: in its window on the PC, and among
 * the phone's recent apps. An open page keeps running the code it was opened
 * with, so a change put live in the meantime only showed once the app was
 * closed and opened again, and nothing said so. Now the app asks the site
 * which version it serves whenever the person comes back to it (it is shown
 * again, gets the focus, or the device is back online), a little after it
 * starts, and every half hour while it stays open; at most once in five
 * minutes, and never offline. When the site has another version than the one
 * running here, a bar at the bottom says a newer version is ready, with one
 * button that loads it. "Later" hides the bar until a still newer one comes.
 * Settings → About can also ask straight away.
 *
 * The version is the number after ?v= on app.js: index.html loads
 * src/app.js?v=49, and sw.js lists the same address for offline use. Every
 * change put live raises that number, so the number in the site's sw.js says
 * which version the site serves. (Asking for the site's index.html would
 * tell the same, but the service worker would then keep the new page among
 * the offline files while the code it loads is still the old.)
 *
 * The bar sits under any open sheet and under the slides of a reflection
 * evening, and it waits while a card of the altar booklet (liturgy.js) is
 * open. "Update now" lets the forms save what was just typed (they save half
 * a second after the last key), then loads the page again; the service worker
 * fetches the app's own files from the network first, so the reload brings
 * the new version.
 */
import { el } from './ui.js';
import { t } from './i18n.js';

/** The version running on this page: the ?v= number of src/app.js in index.html ('' when it has none). */
export const BUILD = (() => {
  const script = document.querySelector('script[type="module"][src*="app.js"]');
  try { return (script && new URL(script.src, location.href).searchParams.get('v')) || ''; } catch (e) { return ''; }
})();

/** "0.2.0 (49)": the app's version with the number of this build, for Settings and the side menu. */
export function versionText(version) {
  return BUILD ? `${version} (${BUILD})` : version;
}

const FIRST = 15 * 1000;          // the first check, once the app has settled after starting
const EVERY = 30 * 60 * 1000;     // a check while the app stays open in front of the person
const SPACE = 5 * 60 * 1000;      // at most one check in this time, however often the app comes to the front

let lastCheck = 0;
let found = '';                   // the version the site serves, when it is not the one running here
let later = '';                   // the version the person said "Later" to
let bar = null;

/** The version the site serves now: the ?v= number of app.js in its sw.js. */
async function onSite() {
  const r = await fetch('sw.js', { cache: 'no-cache' });
  if (!r.ok) return '';
  const m = /src\/app\.js\?v=([\w.-]+)/.exec(await r.text());
  return m ? m[1] : '';
}

/** Asks the site, unless it was asked a moment ago (or `now`), and shows or hides the bar. Gives 'newer', 'same' or 'offline'. */
async function check(now) {
  const due = now || Date.now() - lastCheck >= SPACE;
  if (BUILD && navigator.onLine && document.visibilityState === 'visible' && due) {
    lastCheck = Date.now();
    try {
      const v = await onSite();
      if (v) found = v === BUILD ? '' : v;
      else if (now) return finish('offline');
    } catch (e) {
      return finish(now ? 'offline' : '');   // no connection after all, or the site is busy: the next check asks again
    }
  } else if (now && !navigator.onLine) {
    return finish('offline');
  }
  return finish(found ? 'newer' : 'same');
}

function finish(answer) {
  place();
  return answer;
}

/** Asks the site straight away (Settings → About): 'newer' shows the bar, 'same' or 'offline' is for the caller to say. */
export function checkNow() {
  later = '';
  return check(true);
}

/* A card of the altar booklet is read out at the altar: the bar waits until it is closed. */
const waits = () => /^#\/?liturgy\/./.test(location.hash);

/** Shows the bar while a newer version is there and nothing is in the way; else hides it. */
function place() {
  if (!bar) return;
  const show = !!found && found !== later && !waits();
  if (show && !bar.firstChild) fill();
  bar.hidden = !show;
  measure();
}

/* The bar's words go in only when it is shown, so that a screen reader reads them out (the bar is a status region). */
function fill() {
  const now = el('button', { class: 'update-now', type: 'button', 'data-t': 'Update now', text: t('Update now'), onclick: () => go(now) });
  bar.append(
    el('span', { class: 'update-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>' }),
    el('span', { class: 'update-text', 'data-t': 'A newer version of the app is ready.', text: t('A newer version of the app is ready.') }),
    el('span', { class: 'update-actions' }, [
      now,
      el('button', { class: 'update-later', type: 'button', 'data-t': 'Later', text: t('Later'), onclick: () => { later = found; place(); } }),
    ]),
  );
}

/** Loads the new version, once what was just typed is saved. */
function go(button) {
  button.disabled = true;
  button.textContent = t('Updating…');
  const box = document.activeElement;
  if (box && box !== document.body && box.blur) box.blur();
  setTimeout(() => location.reload(), 1000);
}

/** Keeps the messages (the toast in ui.js) clear of the bar: its height goes into --update-h. */
function measure() {
  requestAnimationFrame(() => {
    const h = bar && !bar.hidden ? Math.ceil(bar.getBoundingClientRect().height) + 10 : 0;
    document.documentElement.style.setProperty('--update-h', h + 'px');
  });
}

/** Starts watching for a newer version (app.js, once the app is up). */
export function start() {
  bar = el('div', { class: 'update-bar', role: 'status', hidden: true });
  document.body.append(bar);
  if (!BUILD) return;
  const soon = () => check(false);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });
  window.addEventListener('focus', soon);
  window.addEventListener('online', soon);
  window.addEventListener('hashchange', place);
  window.addEventListener('resize', measure);
  setTimeout(soon, FIRST);
  setInterval(soon, EVERY);
}

/*
 * MIS: the Church's own site (mis.nac-sa.org.za), shown inside the app.
 *
 * The site does not forbid being shown inside another page (no X-Frame-Options
 * and no Content-Security-Policy on its pages, checked 2026-11-04), so this
 * section holds it in a frame. The sign-in and everything after it happen on
 * the site itself: the app cannot see what is typed there and keeps no
 * password.
 *
 * Whether the sign-in HOLDS inside the frame is up to the browser. The site
 * signs in with a cookie, and inside another site that is a "third-party"
 * cookie: Safari on an iPhone blocks it, and other browsers send it only when
 * the site marks the cookie for cross-site use. So each device remembers a
 * choice (localStorage, never synced): inside the app, or in the site's own
 * tab, where it always works. With the second, the menu button and the More
 * row open the tab straight away (app.js, more.js).
 */
import { el, clear, seg } from './ui.js';
import { t } from './i18n.js';

export const URL = 'https://mis.nac-sa.org.za/sign-in';
const KEY = 'sb-mis';   // 'in' (inside the app, the default) or 'out' (its own tab), per device

/** Does this device open the MIS in its own tab? */
export function outside() {
  try { return localStorage.getItem(KEY) === 'out'; } catch { return false; }
}
function remember(v) {
  try { localStorage.setItem(KEY, v); } catch { /* a private window: the choice holds for this page only */ }
}

/** Opens the site in its own tab; noopener, so the site cannot reach the app's window. */
export function open() {
  window.open(URL, '_blank', 'noopener');
}

export function render(container) {
  clear(container);
  const inside = !outside();
  const choice = seg([['in', 'Inside the app'], ['out', 'In its own tab']], inside ? 'in' : 'out',
    v => { remember(v); render(container); }, { label: t('Where the MIS opens on this device') });
  container.append(
    el('div', { class: 'docbar mis-bar' }, [
      el('h2', { text: 'MIS' }),
      el('button', { type: 'button', class: 'btn small ghost', text: t('Open in its own tab') + ' \u2197', onclick: open }),
    ]),
    el('div', { class: 'mis-choice' }, [el('span', { class: 'small muted', text: t('On this device:') }), choice]),
  );
  if (inside) {
    container.append(
      el('details', { class: 'mis-help small muted' }, [
        el('summary', { text: t('Sign in there as always. If the MIS does not work here…') }),
        el('p', { text: t('The app cannot see what you type and keeps no password. If the MIS stays empty here, or sends you back to the sign-in after you signed in, this browser does not allow the MIS inside another site (an iPhone usually does not): choose "In its own tab".') }),
      ]),
      el('iframe', { class: 'mis-frame', src: URL, title: t('The Church\'s MIS'), allow: 'clipboard-read; clipboard-write', referrerpolicy: 'strict-origin-when-cross-origin' }),
    );
  } else {
    container.append(
      el('p', { class: 'mis-note', text: t('On this device the MIS opens in its own tab. Sign in there as always; the app keeps no password.') }),
      el('p', {}, el('button', { type: 'button', class: 'btn', text: t('Open the MIS') + ' \u2197', onclick: open })),
    );
  }
}

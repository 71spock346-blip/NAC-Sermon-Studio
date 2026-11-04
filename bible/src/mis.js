/*
 * MIS: the Church's own site (mis.nac-sa.org.za), opened from the app.
 *
 * The site allows being shown inside another page (no X-Frame-Options and no
 * Content-Security-Policy on its pages, checked 2026-11-04), and the first
 * version of this section held it in a frame. The sign-in went through, but
 * the site did not move on: it signs in with a cookie, and inside another
 * site's page that is a third-party cookie, which the browser holds back
 * (Safari always; Chrome and Edge unless the site marks the cookie for
 * cross-site use). So the MIS now opens as a page of its own, where the
 * cookie is first-party and holds:
 *  - in the installed app (its own window on a PC, the icon on a phone) the
 *    app's window goes to the site (installed()). A phone shows the site over
 *    the app with a way back (Done on an iPhone, ✕ on Android); a PC shows it
 *    in the app's window with a bar at the top whose ✕ returns to the app;
 *  - in a browser tab the site opens in a tab of its own (noopener, so the
 *    site cannot reach the app's window).
 * The menu button and the More row open this section and the site at once
 * (app.js, more.js); the section is the place to come back to, with the
 * button to open the site again. Nothing of the sign-in passes through the
 * app: it cannot see what is typed there and keeps no password.
 */
import { el, clear } from './ui.js';
import { t } from './i18n.js';

export const URL = 'https://mis.nac-sa.org.za/sign-in';

/** Is the app running as an installed app (its own window on a PC, the icon on a phone) rather than in a browser tab? */
export function installed() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

let timer = null;

/** Opens the site: in the app's own window in the installed app, otherwise in a tab of its own. */
export function open() {
  if (installed()) {
    // a moment later, so that a save still waiting on a typed change (0.5 s, prepare.js, reflect.js) is written before the window leaves
    clearTimeout(timer);
    timer = setTimeout(() => location.assign(URL), 600);
  } else {
    window.open(URL, '_blank', 'noopener');
  }
}

export function render(container) {
  clear(container);
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: 'MIS' })]),
    el('p', { class: 'mis-note', text: installed()
      ? t('The MIS opens over the app. Sign in there as always; the app keeps no password. Close it to come back here.')
      : t('The MIS opens in its own tab. Sign in there as always; the app keeps no password.') }),
    el('p', {}, el('button', { type: 'button', class: 'btn', text: t('Open the MIS') + ' ↗', onclick: open })),
    el('details', { class: 'mis-help small muted' }, [
      el('summary', { text: t('Why not inside this page?') }),
      el('p', { text: t('The MIS signs you in with a cookie. Inside another site\'s page the browser holds that cookie back, so you signed in but the MIS could not see it. On a page of its own it can.') }),
    ]),
  );
}

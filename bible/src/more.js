/*
 * "More": the fifth tab of the phone's bar.
 *
 * The app has eleven sections. A PC lists them all in the side menu, but a bar
 * the width of a phone holds five names at a size that can be read; with
 * more, the last ones were cut off the edge of the screen. So the phone's
 * bar keeps the four used most (Read, Notes, Prepare, Catechism) and a fifth
 * tab, More, which is this page: the other sections one under the other, as
 * big rows with the icon, the name and one line on what each is for. While
 * one of those sections is open, More stays lit in the bar (app.js route),
 * so the way back to the list is plain.
 *
 * Theology is still reached from the reader and Liturgy from the top of
 * Prepare as well; this page gives each a front door of its own. On a PC the
 * More tab is not shown (styles.css), though #more still draws this page.
 *
 * The Church's MIS is a section like the others (mis.js). On a device that
 * opens the MIS in its own tab, its row here opens that tab straight away.
 */
import { $, el, clear } from './ui.js';
import { t } from './i18n.js';
import { VERSION } from './settings.js';
import { versionText } from './update.js';
import * as Mis from './mis.js';

/** The sections that live under More on a phone, in the order of the side menu, each with one line on what it is for (read when the page is drawn, in the language of the moment). */
export const MORE = [
  ['reflect', () => t('Slides and questions for the evening')],
  ['liturgy', () => t('The words at the altar, card by card')],
  ['theology', () => t('The background to a book, a chapter or verses')],
  ['seating', () => t('Who sits where, and who serves')],
  ['choir', () => t('The choir programme')],
  ['reminders', () => t('Birthdays and anniversaries, with a greeting ready')],
  ['mis', () => Mis.outside() ? t('The Church\'s MIS, in its own tab') : t('The Church\'s MIS, inside the app')],   // the line follows the device's choice (mis.js)
  ['settings', () => t('Language, letters, sync and keys')],
];

/** Is this section one of those listed under More? Then the More tab is lit while it is open. */
export function isMore(tab) {
  return MORE.some(([key]) => key === tab);
}

/** The More page: a row per section. The icon and the name come from the section's own button in the side menu, so they stay the same. */
export function render(container) {
  clear(container);
  const list = el('nav', { class: 'more-list', 'aria-label': t('More|tab') });
  const row = (from, line, attrs, mark) => {
    const name = from.querySelector('.lbl-long') || from.querySelector('.lbl');
    return el('a', attrs, [
      el('span', { class: 'ico', 'aria-hidden': 'true' }, from.querySelector('.ico svg').cloneNode(true)),
      el('span', { class: 'grow' }, [el('b', { text: name.textContent }), el('span', { class: 'muted small', text: line() })]),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: mark }),
    ]);
  };
  for (const [key, line] of MORE) {
    const out = key === 'mis' && Mis.outside();   // this device opens the MIS in its own tab (mis.js)
    list.append(row($('#tab-btn-' + key), line, out ? { class: 'more-row ext', href: Mis.URL, target: '_blank', rel: 'noopener' } : { class: 'more-row', href: '#' + key }, out ? '↗' : '›'));
  }
  container.append(
    el('div', { class: 'docbar' }, [el('h2', { text: t('More|tab') })]),
    el('p', { class: 'more-lead', text: t('The other parts of the app.') }),
    list,
    el('p', { class: 'more-foot small muted' }, [
      el('a', { href: 'help.html', text: t('Help and manual') }),
      ' · ',
      t('Version {v}', { v: versionText(VERSION) }),
    ]),
  );
}

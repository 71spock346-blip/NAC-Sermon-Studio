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
 * After the sections come the outside sites the side menu links to (index.html
 * .menu-links): the Church's MIS, which is its own site and not a part of the
 * app. Its row opens the site in its own tab, where the person signs in as
 * always; the app never sees the password. On this page the row comes just
 * before Settings: as the last row it sat under the bar on a phone the size
 * of an iPhone, and had to be scrolled to.
 */
import { $, el, clear } from './ui.js';
import { t } from './i18n.js';
import { VERSION } from './settings.js';
import { versionText } from './update.js';

/** The sections that live under More on a phone, in the order of the side menu, each with one line on what it is for (read when the page is drawn, in the language of the moment). */
export const MORE = [
  ['reflect', () => t('Slides and questions for the evening')],
  ['liturgy', () => t('The words at the altar, card by card')],
  ['theology', () => t('The background to a book, a chapter or verses')],
  ['seating', () => t('Who sits where, and who serves')],
  ['choir', () => t('The choir programme')],
  ['reminders', () => t('Birthdays and anniversaries, with a greeting ready')],
  ['settings', () => t('Language, letters, sync and keys')],
];

/** The outside sites under the sections, each with one line on what it is: the key names its link in the side menu (#link-mis), which gives the address, the icon and the name. */
export const LINKS = [
  ['mis', () => t('The Church\'s MIS. Opens in its own tab; sign in there as always.')],
];

/** Is this section one of those listed under More? Then the More tab is lit while it is open. */
export function isMore(tab) {
  return MORE.some(([key]) => key === tab);
}

/** The More page: a row per section, and the outside links just before Settings. The icon and the name come from the section's own button or link in the side menu, so they stay the same. */
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
  const links = LINKS.map(([key, line]) => {
    const link = $('#link-' + key);
    return row(link, line, { class: 'more-row ext', href: link.href, target: '_blank', rel: 'noopener' }, '↗');
  });
  for (const [key, line] of MORE) {
    if (key === 'settings') list.append(...links);
    list.append(row($('#tab-btn-' + key), line, { class: 'more-row', href: '#' + key }, '›'));
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

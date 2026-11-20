/*
 * "More": the fifth tab of the phone's bar.
 *
 * The app has many sections. A PC lists them all in the side menu, but a bar
 * the width of a phone holds five names at a size that can be read; with
 * more, the last ones were cut off the edge of the screen. So the phone's
 * bar keeps the four used most (Sunday, Read, Notes, Prepare) and a fifth
 * tab, More, which is this page: the other sections one under the other, as
 * big rows with the icon, the name and one line on what each is for. The
 * rows come in groups, as the side menu has them: Handbooks (which had the
 * bar's fourth place until Sunday took it, November 2026), Theology and the
 * Month plan; then the Tools (Seating, Choir, Reminders, MIS, Reflection
 * evening) under their heading; then Church files and Settings. While one of those sections
 * is open, More stays lit in the bar (app.js route), so the way back to the
 * list is plain; so it is while the Catechism or the Liturgy is open, since
 * they are listed under Handbooks.
 *
 * Theology is still reached from the reader as well; this page gives each
 * section a front door of its own. On a PC the More tab is not shown
 * (styles.css), though #more still draws this page. The Catechism and the
 * Liturgy are not rows here: they are listed under Handbooks (handbooks.js).
 *
 * The Church's MIS is a section like the others (mis.js); its row here also
 * opens the site itself straight away, as the menu button does.
 */
import { $, el, clear } from './ui.js';
import { t } from './i18n.js';
import { VERSION } from './settings.js';
import { versionText } from './update.js';
import * as Mis from './mis.js';
import { holds } from './handbooks.js';   // the sections listed under Handbooks: More is lit for them too

/**
 * The sections that live under More on a phone, in groups and in the order
 * of the side menu, each with one line on what it is for (read when the page
 * is drawn, in the language of the moment). A group with a title is drawn
 * under a heading; the Tools are the same five as the group in the PC's menu.
 */
export const MORE = [
  { rows: [
    ['handbooks', () => t('The Catechism, the Creed, the Liturgy and the handbooks for ministers')],
    ['theology', () => t('The background to a book, a chapter or verses')],
    ['plan', () => t('The month\'s services and who holds them')],
  ] },
  { title: () => t('Tools'), rows: [
    ['seating', () => t('Who sits where, and who serves')],
    ['choir', () => t('The choir programme')],
    ['reminders', () => t('Birthdays and anniversaries, with a greeting ready')],
    ['mis', () => t('The Church\'s MIS')],
    ['reflect', () => t('Slides and questions for the evening')],
  ] },
  { rows: [
    ['files', () => t('The Catechism, the altar booklet, the handbooks and the Guides, each loaded once from its file')],
    ['settings', () => t('Language, letters, sync and keys')],
  ] },
];

/** Is this section one of those listed under More? Then the More tab is lit while it is open. */
export function isMore(tab) {
  const key = holds(tab) ? 'handbooks' : tab;   // the Catechism and the Liturgy are listed under Handbooks
  return MORE.some(group => group.rows.some(([k]) => k === key));
}

/** The More page: a row per section, in groups. The icon and the name come from the section's own button in the side menu, so they stay the same. */
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
  for (const group of MORE) {
    const box = el('div', { class: 'more-group' }, group.title ? [el('h3', { class: 'sub', text: group.title() })] : []);
    for (const [key, line] of group.rows) {
      // the MIS row opens the section, as the others do, and the site itself at once (mis.js)
      const mis = key === 'mis';
      box.append(row($('#tab-btn-' + key), line, mis ? { class: 'more-row ext', href: '#mis', onclick: Mis.open } : { class: 'more-row', href: '#' + key }, mis ? '↗' : '›'));
    }
    list.append(box);
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

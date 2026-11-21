/*
 * "What I use" (Settings → Start here): the five tools a minister may not
 * need. A deacon's phone need not show the rector's month plan or the
 * conductor's choir programme. What is unticked leaves the side menu on a
 * PC and the More page on a phone (more.js); nothing is deleted, the
 * section still opens from its own address, and a tick brings it back. The
 * choice is a setting (hiddenTools), so it travels with the sync and the
 * backup to the person's other devices.
 */
import { $ } from './ui.js';
import { t } from './i18n.js';
import { state, saveSetting } from './store.js';

/** The tools, in the order of the menu: the month plan, then the Tools group without MIS (the Church's site is not a tool to hide). */
export const TOOLS = ['plan', 'seating', 'choir', 'reminders', 'reflect'];

/** One line on what each is for, as the More page and the tick list show it. */
export const LINES = {
  plan: () => t('The month\'s services and who holds them'),
  seating: () => t('Who sits where, and who serves'),
  choir: () => t('The choir programme'),
  reminders: () => t('Birthdays, anniversaries and visits, with a greeting ready'),
  reflect: () => t('Slides and questions for the evening'),
};

/** Is this section shown? Everything but the five tools always is. */
export const used = key => !TOOLS.includes(key) || !(state.settings.hiddenTools || []).includes(key);

/** The tool's name as the menu shows it, in the language of the moment. */
export function name(key) {
  const b = $('#tab-btn-' + key);
  const l = b && (b.querySelector('.lbl-long') || b.querySelector('.lbl'));
  return l ? l.textContent : key;
}

/** Shows and hides the tools' buttons in the side menu. Run at the start, after a tick, and after a sync. */
export function apply() {
  for (const key of TOOLS) {
    const b = $('#tab-btn-' + key);
    if (b) b.hidden = !used(key);
  }
}

/** Ticks or unticks one tool, and shows the menu as it now is. */
export async function setUsed(key, on) {
  await saveSetting('hiddenTools', TOOLS.filter(k => (k === key ? !on : !used(k))));
  apply();
}

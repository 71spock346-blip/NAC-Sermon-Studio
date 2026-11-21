/*
 * Joining the sync with a code: the form itself, shared by two screens.
 * Settings → Sync opens it in a sheet of its own ("Join with a code"), and the
 * first-time setup (welcome.js) shows it inside its third step, so the code
 * from the other device is typed where a new device asks for it. Both do the
 * same: shape the code as it is typed, look for the copy on the server, ask
 * before starting a new sync under an unknown code, then join and say what
 * came over. A form here and not in settings.js, so welcome.js, which
 * Settings imports, does not import Settings back.
 */
import { el, toast, confirmBox, busy } from './ui.js';
import { t, tn } from './i18n.js';
import * as Sync from './sync.js';

/**
 * joinForm({ prefill, beforeJoin, onJoined }) → { field, input, hint, button }.
 * `field` is the labelled input, `hint` the line under it (what the code is,
 * or what went wrong), `button` the Join button. beforeJoin() runs once the
 * code is accepted, before the busy sheet (Settings closes its own sheet
 * there); onJoined() runs after a successful join.
 */
export function joinForm({ prefill = '', beforeJoin, onJoined } = {}) {
  const input = el('input', { type: 'text', class: 'sync-input', placeholder: 'ABCDE-FGHJK-LMNPQ-RSTUV', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', 'aria-label': t('Sync code') });
  if (prefill) input.value = Sync.formatCode(prefill);
  const hint = el('p', { class: 'hint small muted', text: t('The 20 letters and numbers shown under "Show the code" on the device that is already syncing.') });
  const button = el('button', { class: 'btn', type: 'button', text: t('Join') });
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    input.value = raw.replace(/(.{5})(?=.)/g, '$1-');
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); button.click(); } });
  button.addEventListener('click', async () => {
    const code = Sync.parseCode(input.value);
    if (!code) { hint.textContent = t('That is not a whole code: it has 20 letters and numbers, in four groups of five, and never 0, O, 1 or I.'); hint.classList.add('error'); input.focus(); return; }
    button.disabled = true;
    hint.classList.remove('error');
    hint.textContent = t('Looking for the copy on the server…');
    try {
      const found = await Sync.probe(code);
      if (!found) {
        button.disabled = false;
        hint.textContent = '';
        if (!(await confirmBox(t('Nothing is on the server under this code yet. Check the letters, or turn sync on on your other device first. Start a new sync with this code anyway?'), t('Start anyway')))) return;
      }
      if (beforeJoin) beforeJoin();
      const b = busy(t('Joining'));
      b.say(t('Fetching your notes and preparations and merging them with this device…'));
      try {
        await Sync.enable(code);
        b.done();
        const n = Sync.summary();
        toast(t('Joined. On this device now: {notes} and {sermons}.', { notes: tn(n.notes, '{n} note', '{n} notes'), sermons: tn(n.sermons, '{n} preparation', '{n} preparations') }));
        if (onJoined) onJoined();
      } catch (e) {
        button.disabled = false;
        b.fail(e.message || t('Could not join.'));
      }
    } catch (e) {
      button.disabled = false;
      hint.textContent = e.message || t('Could not reach the server.');
      hint.classList.add('error');
    }
  });
  const field = el('label', { class: 'f sync-join' }, [t('Sync code'), input]);
  return { field, input, hint, button };
}

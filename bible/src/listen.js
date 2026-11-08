/*
 * The player under a text an ElevenLabs voice reads (speech.js): the sermon
 * under "Print or save" and the Guide's article under step 2 of a
 * preparation. Before a reading the card says how long the text is and
 * offers "Read aloud"; after it, the player, a line about the recording,
 * "Read again", "Save as MP3" and "Remove". The recording stays on this
 * device with a mark of the text it was made from, and the card says when
 * the text has changed since.
 */
import { el, clear, toast, busy, confirmBox, fmtDate, download, debounce } from './ui.js';
import { t, locale } from './i18n.js';
import * as Speech from './speech.js';

/**
 * A card for one text. `o` holds:
 *   title       the heading ("Hear the sermon")
 *   id          the recording's key in the audio store
 *   noKey       what the card says while there is no ElevenLabs key; with `quiet` it is one line, no heading
 *   empty       what the estimate says while there is nothing to read
 *   script(rec) the text as it stands now, for the estimate and the "changed since" line (speech.js script, guideScript)
 *   read(opts, {signal, onProgress})  makes the recording (speech.js make, makeGuide)
 *   againWith(rec)  the opts "Read again" passes to read(), e.g. the sermon's outline; else {}
 *   fileName(rec)   the name of the saved MP3
 *   from(rec)   where the text came from, for the line under the player ("from the boxes")
 *   stale, reading, ready, failed   the sentences about this text
 * Returns { box, render(), check(), read(opts) }: check() after the text
 * changed (it waits for the typing to stop), read() from a button elsewhere.
 */
export function listenCard(o) {
  const box = el('div', { class: 'listen' });
  const num = n => Number(n || 0).toLocaleString(locale());
  let url = '';
  let shown = null;   // what the card shows: the recording with its "changed since" line, or the estimate while there is none
  const estimate = sc => sc.text
    ? t('About {words} words, {minutes} minutes of listening, {chars} characters of your ElevenLabs plan.', { words: num(sc.words), minutes: sc.minutes, chars: num(sc.chars) })
    : o.empty;
  const check = debounce(() => {
    if (!shown) return;
    if (!shown.rec) { const sc = o.script(null); shown.line.textContent = estimate(sc); shown.btn.disabled = !sc.text; return; }
    const changed = shown.rec.key !== o.script(shown.rec).key;
    shown.stale.hidden = !changed;
    shown.again.classList.toggle('ghost', !changed);
  }, 800);

  async function render() {
    clear(box);
    shown = null;
    if (url) { URL.revokeObjectURL(url); url = ''; }
    if (!Speech.ready()) {
      if (o.quiet) box.append(el('p', { class: 'muted small' }, [o.noKey, ' ', el('a', { href: '#settings', text: t('Open Settings') })]));
      else box.append(el('h3', { text: o.title }), el('p', { class: 'small', text: o.noKey }), el('div', { class: 'row' }, [el('a', { class: 'btn small ghost', href: '#settings', text: t('Open Settings') })]));
      return;
    }
    box.append(el('h3', { text: o.title }));
    const rec = await Speech.recording(o.id).catch(() => null);
    if (!rec) {
      const sc = o.script(null);
      const line = el('p', { class: 'small', text: estimate(sc) });
      const btn = el('button', { class: 'btn small', type: 'button', text: t('Read aloud'), disabled: !sc.text, onclick: () => read({}) });
      shown = { rec: null, line, btn };
      box.append(line, el('div', { class: 'row' }, [btn, el('span', { class: 'muted small', text: t('Voice: {name}.', { name: Speech.voiceFor(sc.lang).name }) })]));
      return;
    }
    url = URL.createObjectURL(rec.blob);
    const changed = rec.key !== o.script(rec).key;
    const stale = el('p', { class: 'small stale', text: o.stale, hidden: !changed });
    const again = el('button', { class: changed ? 'btn small' : 'btn small ghost', type: 'button', text: t('Read again'), onclick: () => read(o.againWith ? o.againWith(rec) : {}) });
    shown = { rec, stale, again };
    box.append(
      el('audio', { controls: true, src: url, preload: 'metadata' }),
      el('p', { class: 'muted small', text: t('Read {date} by {voice}, {from}. {chars} characters, about {minutes} minutes.', { date: fmtDate(rec.at), voice: rec.voice.name, from: o.from(rec), chars: num(rec.chars), minutes: rec.minutes }) }),
      stale,
      el('div', { class: 'row' }, [
        again,
        el('button', { class: 'btn small ghost', type: 'button', text: t('Save as MP3'), onclick: () => { const name = o.fileName(rec); download(rec.blob, name); toast(t('Saved ') + name); } }),
        el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: async () => {
          if (!(await confirmBox(t('Remove this recording? Reading it again uses your ElevenLabs characters again.'), t('Remove'), true))) return;
          await Speech.forget(o.id);
          toast(t('Recording removed.'));
          render();
        } }),
      ]));
  }

  /** Reads the text and keeps the recording under o.id; opts go to o.read (the sermon's outline). */
  async function read(opts = {}) {
    if (!Speech.ready()) { toast(t('Add your ElevenLabs key under Settings → Read aloud first.'), true); return; }
    const ctrl = new AbortController();
    const wait = busy(o.reading, () => ctrl.abort());
    wait.say(t('Making the voice… this takes a moment.'));
    try {
      const rec = await o.read(opts, { signal: ctrl.signal, onProgress: (i, n) => { if (n > 1) wait.say(t('Part {i} of {n}…', { i, n })); } });
      await Speech.keep(o.id, rec);
      wait.done();
      await render();
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const audio = box.querySelector('audio');
      if (audio) audio.play().catch(() => {});   // a phone may want a tap on Play instead
      toast(o.ready);
    } catch (e) {
      if (ctrl.signal.aborted) { wait.done(); return; }
      wait.fail(e.message || o.failed);
    }
  }

  render();
  return { box, render, check, read };
}

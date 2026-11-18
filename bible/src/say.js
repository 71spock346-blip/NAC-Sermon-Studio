/*
 * The voice this device has: the browser's own speech (speechSynthesis), the
 * voices built into the phone or the PC. It costs nothing, needs no key and
 * sends nothing anywhere, so the notes are read with it (notes.js; Jerome:
 * "Cheapest voice possible"). An Android phone has Google's voices, English
 * and Afrikaans among them; a Windows PC has Microsoft's English voices, and
 * Afrikaans ones in Edge. A text goes in short pieces, since Chrome cuts off
 * an utterance that runs long; the Speed under Settings → Read aloud sets
 * the pace here too. One reading at a time: a new one stops the old.
 */
import { state } from './store.js';
import { pieces } from './speech.js';

const RATE = { slower: 0.9, normal: 1, faster: 1.1 };
const PIECE = 220;   // letters per utterance: well under what Chrome stops at

/** Does this browser have a voice of its own? */
export function available() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

let known = null;

/** The voices the device has, once they are known: some browsers hand them over a moment after the first ask. */
export function voices() {
  if (!available()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) { known = now; return Promise.resolve(now); }
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; known = speechSynthesis.getVoices(); resolve(known); };
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

/**
 * The best voice for a language: the region's own first (af-ZA, en-ZA), for
 * English then British, a natural or local one before the rest; null when the
 * device has none for the language.
 */
export function voiceFor(l, all) {
  const want = l === 'af' ? 'af' : 'en';
  const tag = v => String(v.lang || '').toLowerCase().replace('_', '-');
  const fit = (all || known || []).filter(v => tag(v) === want || tag(v).startsWith(want + '-'));
  if (!fit.length) return null;
  const score = v => (tag(v) === `${want}-za` ? 40 : want === 'en' && tag(v) === 'en-gb' ? 30 : 0)
    + (/natural|neural|premium|enhanced/i.test(v.name) ? 8 : 0) + (v.localService ? 4 : 0) + (v.default ? 2 : 0);
  return fit.slice().sort((a, b) => score(b) - score(a))[0];
}

let current = null;   // the reading under way

/**
 * Reads `text` with `voice` (from voiceFor). Returns the job, {stop()};
 * `onEnd(err, stopped)` is called once, when the reading ends on its own,
 * fails, or is stopped.
 */
export async function speak(text, voice, { onEnd } = {}) {
  stop();
  if (speechSynthesis.speaking || speechSynthesis.pending) {   // Chrome swallows an utterance sent right after cancel()
    speechSynthesis.cancel();
    await new Promise(r => setTimeout(r, 150));
  }
  const parts = pieces(String(text || ''), PIECE);
  const job = { over: false, stop() { if (job.over) return; job.over = true; if (current === job) current = null; speechSynthesis.cancel(); if (onEnd) onEnd(null, true); } };
  const finish = err => { if (job.over) return; job.over = true; if (current === job) current = null; if (onEnd) onEnd(err, false); };
  current = job;
  if (!parts.length) { finish(null); return job; }
  const rate = RATE[state.settings.voiceSpeed] || 1;
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;
    if (i === parts.length - 1) u.onend = () => finish(null);
    u.onerror = e => {
      const why = e && e.error;
      if (why === 'interrupted' || why === 'canceled') return;   // stopped on purpose
      speechSynthesis.cancel();
      finish(new Error(why || 'error'));
    };
    speechSynthesis.speak(u);
  });
  return job;
}

/** Stops the reading under way, if any. */
export function stop() { if (current) current.stop(); }

/** Is this job the one speaking? */
export function speaking(job) { return !!job && current === job; }

/*
 * Notes: a person's own thoughts, experiences, doctrine links, illustrations
 * and questions, each tied to a verse or a few verses. The reader marks the
 * verses that carry notes; this tab lists and searches them.
 *
 * A note reads in English and in Afrikaans (Jerome: "Is it possible to switch
 * between English and Afrikaans here too?"). The EN | AF switch on a note
 * shows it as it was written, or has Claude translate it once into the other
 * language. The translation is kept in the note as `alt`
 * ({lang, title, body, of, at, model, edited}), so it travels with the sync
 * and the backup, and switching back and forth needs no connection. `lang` is
 * the language the note is written in: guessed from its words until it is
 * kept, on saving or on translating. `of` marks the note as it was when it was
 * translated, so that a translation says when the note changed after it.
 * Edit changes the language on the screen; the other stays as it is.
 *
 * "Listen" on a card reads the note aloud (Jerome: "I want to be able to
 * listen to these notes too. Cheapest voice possible"): with the voice built
 * into the phone or the PC (say.js), which costs nothing, or, when Settings
 * say so or the device has no voice for the note's language, with
 * ElevenLabs' cheapest model (speech.js makeNote); that recording stays with
 * the note on this device, so hearing it again is free. One note at a time.
 */
import { el, clear, toast, sheet, confirmBox, busy, fmtDate, isTouch, lineBox } from './ui.js';
import { t, lang, locale } from './i18n.js';
import { parseRef, formatRef, BY_ID } from './books.js';
import { state, saveNote, deleteNote } from './store.js';
import * as AI from './ai.js';
import * as Speech from './speech.js';
import * as Say from './say.js';

export const KINDS = [
  ['thought', 'Thought'],
  ['experience', 'Experience'],
  ['doctrine', 'Doctrine'],
  ['illustration', 'Illustration'],
  ['sermon', 'Sermon idea'],
  ['question', 'Question'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

/** The name of a kind of note in the interface language. */
export function kindLabel(kind) { return t(KIND_LABEL[kind] || kind); }

export function notesFor(book, chapter) {
  return state.notes
    .filter(n => n.book === book && n.chapter === chapter)
    .sort((a, b) => (a.verse || 0) - (b.verse || 0) || (b.updated || '').localeCompare(a.updated || ''));
}

export function draft(ref) {
  return { book: ref.book, chapter: ref.chapter, verse: ref.verse || null, verseEnd: ref.verseEnd || ref.verse || null, kind: 'thought', title: '', body: '', tags: [] };
}

export function refOf(n) {
  return { book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verseEnd };
}

export function refLabel(n) {
  return formatRef(refOf(n), state.settings.bookLang);
}

/* ---------------------------------------------------------------- English and Afrikaans */

/* Short words that give a text away as Afrikaans or as English: frequent in the one, rare in the other ("is", "in",
   "was" and "of" are both). */
const AF_WORDS = new Set(['die', 'nie', 'het', 'vir', 'ons', 'deur', 'oor', 'wat', 'sal', 'moet', 'ook', 'hulle', 'julle', 'jy', 'ek', 'en', 'van',
  'uit', 'aan', 'maar', 'baie', 'kan', 'hy', 'sy', 'hom', 'haar', 'dit', 'wees', 'gaan', 'nou', 'hier', 'daar', 'wanneer', 'omdat', 'hierdie', 'daardie']);
const EN_WORDS = new Set(['the', 'and', 'to', 'that', 'with', 'this', 'from', 'they', 'have', 'are', 'which', 'will', 'would', 'what', 'his', 'you',
  'it', 'for', 'not', 'but', 'be', 'who', 'their', 'he', 'we', 'our', 'your', 'has', 'been', 'were', 'she', 'her', 'on', 'at', 'all', 'an', 'when',
  'because', 'there', 'these']);

/** 'af' or 'en' for a text, by the short words in it; '' when it does not say. */
export function guessLang(text) {
  let af = 0, en = 0;
  for (const raw of String(text || '').toLowerCase().split(/[^a-z\u00e0-\u00ff\u0149'\u2019]+/)) {
    if (!raw) continue;
    if (raw === "'n" || raw === '\u2019n' || raw === '\u0149') { af++; continue; }   // 'n, the Afrikaans "a"
    const w = raw.replace(/^['\u2019]+|['\u2019]+$/g, '');
    if (AF_WORDS.has(w)) af++;
    else if (EN_WORDS.has(w)) en++;
  }
  return af > en ? 'af' : en > af ? 'en' : '';
}

/** The language a note is written in: as kept, else as its words give away, else the app's. */
export function noteLang(n) {
  return n.lang === 'af' || n.lang === 'en' ? n.lang : guessLang(`${n.title || ''}\n${n.body || ''}`) || lang();
}

/** A short mark of a text, to see later whether it changed after it was translated (a note here, an answer in Theology). */
export function textMark(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}.${h.toString(36)}`;
}

/** The mark of a note's title and text. */
function mark(title, body) {
  return textMark(`${(title || '').trim()}\n\u0000${(body || '').trim()}`);
}

/** A note in a language: its translation when it has one in that language, else the note as written. {title, body, lang, translated} */
export function textIn(n, l) {
  const own = noteLang(n);
  if (l && l !== own && n.alt && n.alt.lang === l) return { title: n.alt.title || '', body: n.alt.body || '', lang: l, translated: true };
  return { title: n.title || '', body: n.body || '', lang: own, translated: false };
}

const langName = l => (l === 'af' ? t('Afrikaans') : t('English'));

/* The language picked on a note's switch (note id -> {l, ui}): it holds while the app keeps the language it had then. */
const picked = new Map();
/* Translations under way (note id -> {ctrl, l, label}). */
const working = new Map();

/** The language a note shows in: the one picked on it, else the app's when the note has it, else its own. */
function shownLang(n) {
  const p = picked.get(n.id);
  if (p && p.ui === lang()) return p.l;
  const own = noteLang(n), app = lang();
  return app === own || (n.alt && n.alt.lang === app) ? app : own;
}

/**
 * EN | AF under the words of a note that has both languages, with a line on
 * the translation shown; while Claude translates a note (from the editor,
 * editNote), the line on that instead. Nothing on a note in one language:
 * the cards are for reading, and the switch only where it has two texts to switch between.
 */
function langRow(n, x, redraw) {
  const job = working.get(n.id);
  const own = noteLang(n);
  const both = !!(n.alt && n.alt.lang && n.alt.lang !== own);
  if (!both && !job) return null;
  const open = AI.unlocked();   // translating is Claude's work, the minister's own (lock.js); locked, the switch only flips between the texts the note has
  const button = l => el('button', {
    type: 'button', text: l.toUpperCase(), title: langName(l), class: x.lang === l ? 'on' : null, 'aria-pressed': String(x.lang === l),
    disabled: !!job, onclick: () => choose(n, l, redraw),
  });
  const row = el('div', { class: 'note-lang' }, both ? [el('div', { class: 'seg mini', role: 'group', 'aria-label': t('Language of this note') }, [button('en'), button('af')])] : []);
  if (job) {
    job.label = el('span', { class: 'small muted', role: 'status', text: t('Claude is translating this note into {language}…', { language: langName(job.l) }) });
    row.append(job.label, el('button', { class: 'btn small ghost', type: 'button', text: t('Cancel'), onclick: () => job.ctrl.abort() }));
  } else if (x.translated && open) {   // locked, the switch is just a switch: no line on who translated
    const stale = n.alt.of !== mark(n.title, n.body);
    row.append(el('span', { class: 'small muted', text: stale
      ? t('The note in {language} was changed after this translation.', { language: langName(own) })
      : n.alt.edited ? t('Translated by Claude from {language}, then changed by you.', { language: langName(own) })
        : t('Translated by Claude from {language}.', { language: langName(own) }) }));
    if (stale && open) row.append(el('button', { class: 'btn small ghost', type: 'button', text: t('Translate again'), onclick: () => translate(n, x.lang, redraw) }));
  }
  return row;
}

/** A tap on EN or AF: show that language (the switch only shows where the note has both; a language it lacks would be translated first). */
function choose(n, l, redraw) {
  if (working.has(n.id)) return;
  if (l === noteLang(n) || (n.alt && n.alt.lang === l)) { picked.set(n.id, { l, ui: lang() }); redraw(); return; }
  translate(n, l, redraw);
}

/** Claude translates the note into `l` (the editor's "Translate into …", or "Translate again" on the card); the translation is kept in the note, in place of an earlier one. */
async function translate(n, l, redraw) {
  if (working.has(n.id)) return;
  if (!AI.unlocked()) return;   // not offered on a locked device (lock.js); the switch only flips between the texts a note has
  if (!AI.ready()) { toast(t('Add your Anthropic key under Settings → AI helper first.'), true); return; }
  if (n.alt && n.alt.lang === l && n.alt.edited
    && !(await confirmBox(t('Translate again? Your own changes to the note in {language} are replaced.', { language: langName(l) }), t('Translate again')))) return;
  const job = { ctrl: new AbortController(), l, label: null };
  working.set(n.id, job);
  redraw();
  const src = { title: (n.title || '').trim(), body: (n.body || '').trim() };
  const size = src.title.length + src.body.length;
  try {
    const r = await AI.translateNote(src, l, {
      signal: job.ctrl.signal,
      onProgress: chars => {
        if (job.label) job.label.textContent = `${t('Claude is translating this note into {language}…', { language: langName(l) })} ${Math.min(99, Math.round(chars * 100 / (size * 1.2 + 60)))}%`;
      },
    });
    const kept = state.notes.find(x => x.id === n.id);
    if (!kept) return;   // deleted in the meantime
    kept.lang = noteLang(kept);
    kept.alt = { lang: l, title: r.title, body: r.body, of: mark(src.title, src.body), at: r.at, model: r.model };
    await saveNote(kept);
    if (kept !== n) Object.assign(n, kept);
    picked.set(n.id, { l, ui: lang() });
    toast(r.cost ? t('The note is translated ({cost}).', { cost: AI.fmtCost(r.cost) }) : t('The note is translated.'));
  } catch (e) {
    if (!(e && e.name === 'AbortError')) toast(e.message || String(e), true);
  } finally {
    working.delete(n.id);
    redraw();
  }
}

/* ---------------------------------------------------------------- hearing a note */

/* The note being heard: {id, lang, job: {stop()}, refresh()}; one at a time, a new one stops it. */
let hearing = null;
function stopHearing() {
  if (!hearing) return;
  const h = hearing;
  hearing = null;
  h.job.stop();
  h.refresh();
}
window.addEventListener('hashchange', stopHearing);   // leaving the page leaves nothing talking
/* Recordings to play as soon as their card shows them (noteKey). */
const autoplay = new Set();
const num = v => Number(v || 0).toLocaleString(locale());

/**
 * Reads note `n` as shown (`x`) for its card (`card`: {refresh, redraw, play}):
 * with the device's own voice, or with ElevenLabs' cheapest when Settings say
 * so, or when the device has no voice for the language and the person agrees.
 */
async function hear(n, x, card) {
  const l = x.lang === 'af' ? 'af' : 'en';
  stopHearing();
  const sc = Speech.noteScript(x);
  if (!sc.text) { toast(t('There is nothing to read in this note.'), true); return; }
  if (state.settings.voiceNotes === 'eleven' && Speech.ready()) return hearEleven(n, l, sc, card);
  if (!Say.available()) { toast(t('This browser has no voice of its own. Choose ElevenLabs for notes under Settings → Read aloud.'), true); return; }
  const voice = Say.voiceFor(l, await Say.voices());
  if (!voice) {
    if (Speech.ready() && await confirmBox(t('This device has no voice for {language}. Read the note with ElevenLabs\' cheapest voice instead? About {chars} characters of your plan.', { language: langName(l), chars: num(sc.chars) }), t('Read with ElevenLabs'))) return hearEleven(n, l, sc, card);
    toast(t('This device has no voice for {language}. Add one in the device\'s text-to-speech settings, or choose ElevenLabs for notes under Settings → Read aloud.', { language: langName(l) }), true);
    return;
  }
  const mine = { id: n.id, lang: l, job: null, refresh: card.refresh };
  mine.job = await Say.speak(sc.text, voice, { onEnd: err => {
    if (hearing === mine) hearing = null;
    card.refresh();
    if (err) toast(t('The voice stopped: {error}', { error: err.message }), true);
  } });
  if (mine.job.over) return;
  hearing = mine;
  card.refresh();
}

/** ElevenLabs reads the note with its cheapest voice; the recording stays with the note on this device, so the next hearing costs nothing. */
async function hearEleven(n, l, sc, card) {
  const key = Speech.noteKey(n.id, l);
  const rec = await Speech.recording(key).catch(() => null);
  if (rec && rec.key === sc.key) { card.play(); return; }
  const ctrl = new AbortController();
  const wait = busy(t('Reading the note aloud'), () => ctrl.abort());
  wait.say(t('Making the voice… this takes a moment.'));
  try {
    const made = await Speech.makeNote(sc, { signal: ctrl.signal, onProgress: (i, k) => { if (k > 1) wait.say(t('Part {i} of {n}…', { i, n: k })); } });
    await Speech.keep(key, made);
    wait.done();
    toast(t('The note is ready to hear.'));
    autoplay.add(key);
    card.redraw();
  } catch (e) {
    if (ctrl.signal.aborted) { wait.done(); return; }
    wait.fail(e.message || t('The note could not be read.'));
  }
}

/* ---------------------------------------------------------------- the card and the editor */

/** A note as a card: the words first (reference and kind, title, text), the language switch where it has both languages, then the date, Listen and Edit, and the recording ElevenLabs made, when there is one. */
export function card(n, onChange) {
  const href = `#read/${n.book}/${n.chapter}${n.verse ? '/' + n.verse : ''}`;
  const box = el('article', { class: 'note' });
  let x = null, btn = null, audio = null, url = '';
  const isMine = () => !!hearing && hearing.id === n.id && hearing.lang === (x.lang === 'af' ? 'af' : 'en');
  /** The Listen button and the card's outline as the reading stands, without redrawing (a redraw would stop a playing recording). */
  const refresh = () => {
    if (!btn) return;
    const on = isMine();
    btn.textContent = on ? t('Stop') : t('Listen');
    btn.className = on ? 'btn small' : 'btn small ghost';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? t('Stop reading') : t('Listen to the note on {ref}', { ref: refLabel(n) }));
    box.classList.toggle('hearing', on);
  };
  const api = { refresh, redraw: () => draw(), play: () => { if (audio) audio.play().catch(() => {}); else autoplay.add(Speech.noteKey(n.id, x.lang === 'af' ? 'af' : 'en')); } };
  function draw() {
    x = textIn(n, shownLang(n));
    const mine = x;
    const l = x.lang === 'af' ? 'af' : 'en';
    const key = Speech.noteKey(n.id, l);
    clear(box);
    audio = null;
    if (url) { URL.revokeObjectURL(url); url = ''; }
    btn = el('button', { class: 'btn small ghost', type: 'button', text: t('Listen'), onclick: () => { if (isMine()) stopHearing(); else hear(n, x, api).catch(e => toast(e.message || String(e), true)); } });
    const hearRow = el('div', { class: 'note-hear' });
    // the words first, so that a long list reads like a page: the verse and the kind, the title, the text;
    // then the switch where the note has both languages, and under everything the date, Listen and Edit
    box.append(
      el('div', { class: 'note-head' }, [
        el('a', { class: 'ref', href, text: refLabel(n) }),
        el('span', { class: 'pill kind ' + n.kind, text: kindLabel(n.kind) }),
        ...(n.tags || []).map(tag => el('span', { class: 'pill', text: '#' + tag })),
      ]),
      ...[
        x.title ? el('div', { class: 'note-title', lang: x.lang, text: x.title }) : null,
        el('div', { class: 'note-body', lang: x.lang, text: x.body }),
        langRow(n, x, draw),
      ].filter(Boolean),   // a DOM append() writes a bare null as the word "null"
      el('div', { class: 'note-foot' }, [
        el('span', { class: 'muted small', text: fmtDate(n.updated) }),
        btn,
        el('button', { class: 'btn small ghost', type: 'button', text: t('Edit'), 'aria-label': t('Edit the note on {ref}', { ref: refLabel(n) }), onclick: () => editNote(n, onChange, { alt: x.translated }) }),
      ]),
      hearRow,
    );
    refresh();
    // the recording ElevenLabs made of this note in this language, when there is one
    Speech.recording(key).then(rec => {
      if (!rec || x !== mine) return;   // none, or the card was drawn again meanwhile
      url = URL.createObjectURL(rec.blob);
      audio = el('audio', { controls: true, src: url, preload: 'metadata' });
      const job = { audio, stop: () => audio.pause() };
      audio.addEventListener('play', () => {
        if (!(hearing && hearing.job === job)) { stopHearing(); hearing = { id: n.id, lang: l, job, refresh }; }
        refresh();
      });
      const off = () => { if (hearing && hearing.job === job) hearing = null; refresh(); };
      audio.addEventListener('pause', off);
      audio.addEventListener('ended', off);
      const changed = rec.key !== Speech.noteScript(x).key;
      hearRow.append(
        audio,
        el('span', { class: 'muted small', text: t('Read {date} by {voice}. {chars} characters.', { date: fmtDate(rec.at), voice: rec.voice.name, chars: num(rec.chars) }) + (changed ? ' ' + t('The note has changed since.') : '') }),
        el('button', { class: 'btn small ghost', type: 'button', text: t('Remove'), onclick: async () => {
          if (!(await confirmBox(t('Remove this recording? Reading it again uses your ElevenLabs characters again.'), t('Remove'), true))) return;
          await Speech.forget(key);
          toast(t('Recording removed.'));
          draw();
        } }),
      );
      if (autoplay.delete(key)) audio.play().catch(() => {});   // a phone may want a tap on Play instead
    }).catch(() => {});
  }
  draw();
  return box;
}

/**
 * The editor sheet. `note` may be a draft without an id. With {alt: true} it
 * changes the note's translation (the language on the screen), and the note
 * as written stays as it is.
 */
export function editNote(note, onSaved, { alt = false } = {}) {
  const n = { ...note, tags: [...(note.tags || [])] };
  if (note.alt) n.alt = { ...note.alt };
  const inAlt = !!(alt && n.alt);
  const own = noteLang(n);
  const lang = state.settings.bookLang;
  const s = sheet(n.id ? t('Edit note') : t('New note'), { sticky: true });

  const refInput = el('input', { type: 'text', value: n.book ? formatRef(refOf(n), lang) : '', placeholder: t('e.g. Psalm 130:7 or Lukas 8:16-18'), autocomplete: 'off' });
  const refHint = el('div', { class: 'hint muted small' });
  function checkRef() {
    const r = parseRef(refInput.value);
    refHint.textContent = r ? '→ ' + formatRef(r, lang) : (refInput.value.trim() ? t('Not understood yet. Book, chapter, then verse: "Johannes 3:16".') : t('Which verse or verses is this about?'));
    refHint.classList.toggle('error', !r && !!refInput.value.trim());
    return r;
  }
  refInput.addEventListener('input', checkRef);
  checkRef();

  const kindSel = el('select', {}, KINDS.map(([v, label]) => el('option', { value: v, text: t(label), selected: v === n.kind })));
  const titleInput = lineBox({ value: (inAlt ? n.alt.title : n.title) || '', placeholder: t('A short title (optional)') });
  const body = el('textarea', { rows: 8, placeholder: t('What struck you? What happened? How does it connect to the Church\'s teaching?') });
  body.value = (inAlt ? n.alt.body : n.body) || '';
  const tagsInput = lineBox({ value: (n.tags || []).join(', '), placeholder: t('grace, prayer, youth (optional, comma separated)') });

  /** Keeps the note as the fields have it and closes the sheet: the note, or null while something is missing. */
  async function save() {
    const r = checkRef();
    if (!r) { toast(t('Please give the verse this note belongs to.'), true); refInput.focus(); return null; }
    const title = titleInput.value.trim(), text = body.value.trim();
    if (!text && !title) { toast(t('Write something first.'), true); body.focus(); return null; }
    Object.assign(n, { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd, kind: kindSel.value,
      tags: tagsInput.value.split(/[,;]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean) });
    if (inAlt) {
      // the translation, in his own words now; the note as written stays
      const changed = title !== (note.alt.title || '') || text !== (note.alt.body || '');
      n.alt = { ...n.alt, title, body: text, edited: !!(n.alt.edited || changed) };
    } else {
      Object.assign(n, { title, body: text });
      // the language it is written in: from its words, while there is no translation to keep it apart from
      if (!n.alt) n.lang = guessLang(`${title}\n${text}`) || n.lang || own;
    }
    await saveNote(n);
    toast(t('Note saved.'));
    s.close();
    if (onSaved) onSaved(n);
    return n;
  }
  const saveBtn = el('button', { class: 'btn', type: 'button', text: t('Save'), onclick: save });
  // Claude's translation of a kept note into its other language (translate): offered here, once per note, rather than on every card
  const other = own === 'af' ? 'en' : 'af';
  const translateRow = n.id && !inAlt && !n.alt && AI.unlocked() ? el('div', { class: 'row line note-translate' }, [
    el('span', { class: 'small muted', text: t('This note is in {language} only.', { language: langName(own) }) }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Translate into {language}', { language: langName(other) }), onclick: async () => {
      const kept = await save();   // what is in the boxes is what gets translated
      if (kept) translate(kept, other, () => { if (onSaved) onSaved(kept); });
    } }),
  ]) : null;
  const row = el('div', { class: 'row end' }, [
    n.id ? el('button', { class: 'btn ghost danger', type: 'button', text: t('Delete'), onclick: async () => {
      if (await confirmBox(n.alt ? t('Delete this note, in both languages? This cannot be undone.') : t('Delete this note? This cannot be undone.'), t('Delete'), true)) {
        await deleteNote(n.id);
        toast(t('Note deleted.'));
        s.close();
        if (onSaved) onSaved(null);
      }
    } }) : null,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => s.close() }),
    saveBtn,
  ]);
  s.body.append(
    ...[inAlt ? el('p', { class: 'small muted', text: t('You are changing the note in {language}. The note in {other} stays as it is.', { language: langName(n.alt.lang), other: langName(own) }) })
      : n.alt ? el('p', { class: 'small muted', text: AI.unlocked()
        ? t('This note also has a translation into {language}. It stays as it is until you translate it again.', { language: langName(n.alt.lang) })
        : t('This note is also kept in {language}. That one stays as it is.', { language: langName(n.alt.lang) }) }) : null].filter(Boolean),
    el('label', { class: 'f' }, [t('Verse(s)'), refInput, refHint]),
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, [t('Kind'), kindSel]),
      el('label', { class: 'f' }, [t('Title'), titleInput]),
    ]),
    el('label', { class: 'f' }, [t('Note'), body]),
    el('label', { class: 'f' }, [t('Tags'), tagsInput]),
    ...[translateRow].filter(Boolean),
    row,
  );
  if (!isTouch()) setTimeout(() => (n.book ? body : refInput).focus(), 50);
  return s;
}

/* ---------------------------------------------------------------- the tab */
let filterKind = '';

export function render(container, route) {
  clear(container);
  if (route[1]) {
    const n = state.notes.find(x => x.id === route[1]);
    if (n) { editNote(n, () => { if (location.hash === '#notes') show(); else location.hash = '#notes'; }); }   // show() draws the list again (a translation from the editor ends on it)
  }
  const search = el('input', { type: 'search', placeholder: t('Search notes: a word, a tag, or a reference such as "Ps 23"…'), 'aria-label': t('Search notes'), autocomplete: 'off' });
  const list = el('div', { class: 'notes' });
  const chips = el('div', { class: 'row chips' });
  function chip(v, label) {
    return el('button', { class: 'chip' + (filterKind === v ? ' on' : ''), type: 'button', text: label, onclick: () => { filterKind = v; show(); for (const c of chips.children) c.classList.toggle('on', c.dataset.v === v); }, dataset: { v } });
  }
  chips.append(chip('', t('All')), ...KINDS.map(([v, l]) => chip(v, t(l))));

  function show() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const ref = q ? parseRef(q) : null;
    let items = state.notes.slice();
    if (filterKind) items = items.filter(n => n.kind === filterKind);
    if (ref) {
      items = items.filter(n => n.book === ref.book && (!ref.chapter || n.chapter === ref.chapter || q.split(/\s+/).length === 1) && (!ref.verse || !n.verse || (ref.verse >= n.verse && ref.verse <= (n.verseEnd || n.verse))));
    } else if (q) {
      items = items.filter(n => [n.title, n.body, n.alt && n.alt.title, n.alt && n.alt.body, (n.tags || []).join(' '), refLabel(n)].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    if (!items.length) {
      list.append(el('p', { class: 'muted', text: state.notes.length ? t('No notes match.') : t('No notes yet. Open a chapter, tap a verse and choose "Note", or tap "New note".') }));
    }
    for (const n of items) list.append(card(n, show));
  }
  search.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [
      el('h2', { text: t('Notes ({n})', { n: state.notes.length }) }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small', type: 'button', text: t('New note'), onclick: () => editNote({ kind: 'thought', tags: [] }, show) }),
    ]),
    search, chips, list);
  show();
}

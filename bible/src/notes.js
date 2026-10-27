/*
 * Notes: a person's own thoughts, experiences, doctrine links, illustrations
 * and questions, each tied to a verse or a few verses. The reader marks the
 * verses that carry notes; this tab lists and searches them.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, isTouch } from './ui.js';
import { parseRef, formatRef, BY_ID } from './books.js';
import { state, saveNote, deleteNote } from './store.js';

export const KINDS = [
  ['thought', 'Thought'],
  ['experience', 'Experience'],
  ['doctrine', 'Doctrine'],
  ['illustration', 'Illustration'],
  ['sermon', 'Sermon idea'],
  ['question', 'Question'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

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

/** A note as a card: reference, kind, title, text, edit. */
export function card(n, onChange) {
  const ref = refOf(n);
  const href = `#read/${n.book}/${n.chapter}${n.verse ? '/' + n.verse : ''}`;
  return el('article', { class: 'note' }, [
    el('div', { class: 'note-top' }, [
      el('div', { class: 'note-head' }, [
        el('a', { class: 'ref', href, text: refLabel(n) }),
        el('span', { class: 'pill kind ' + n.kind, text: KIND_LABEL[n.kind] || n.kind }),
        ...(n.tags || []).map(t => el('span', { class: 'pill', text: '#' + t })),
      ]),
      el('div', { class: 'note-meta' }, [
        el('span', { class: 'muted small', text: fmtDate(n.updated) }),
        el('button', { class: 'btn small ghost', type: 'button', text: 'Edit', 'aria-label': `Edit the note on ${refLabel(n)}`, onclick: () => editNote(n, onChange) }),
      ]),
    ]),
    n.title ? el('div', { class: 'note-title', text: n.title }) : null,
    el('div', { class: 'note-body', text: n.body }),
  ]);
}

/** The editor sheet. `note` may be a draft without an id. */
export function editNote(note, onSaved) {
  const n = { ...note, tags: [...(note.tags || [])] };
  const lang = state.settings.bookLang;
  const s = sheet(n.id ? 'Edit note' : 'New note', { sticky: true });

  const refInput = el('input', { type: 'text', value: n.book ? formatRef(refOf(n), lang) : '', placeholder: 'e.g. Psalm 130:7 or Lukas 8:16-18', autocomplete: 'off' });
  const refHint = el('div', { class: 'hint muted small' });
  function checkRef() {
    const r = parseRef(refInput.value);
    refHint.textContent = r ? '→ ' + formatRef(r, lang) : (refInput.value.trim() ? 'Not understood yet. Book, chapter, then verse: "Johannes 3:16".' : 'Which verse or verses is this about?');
    refHint.classList.toggle('error', !r && !!refInput.value.trim());
    return r;
  }
  refInput.addEventListener('input', checkRef);
  checkRef();

  const kindSel = el('select', {}, KINDS.map(([v, label]) => el('option', { value: v, text: label, selected: v === n.kind })));
  const titleInput = el('input', { type: 'text', value: n.title || '', placeholder: 'A short title (optional)' });
  const body = el('textarea', { rows: 8, placeholder: 'What struck you? What happened? How does it connect to the Church\'s teaching?' });
  body.value = n.body || '';
  const tagsInput = el('input', { type: 'text', value: (n.tags || []).join(', '), placeholder: 'grace, prayer, youth (optional, comma separated)' });

  const saveBtn = el('button', { class: 'btn', type: 'button', text: 'Save', onclick: async () => {
    const r = checkRef();
    if (!r) { toast('Please give the verse this note belongs to.', true); refInput.focus(); return; }
    if (!body.value.trim() && !titleInput.value.trim()) { toast('Write something first.', true); body.focus(); return; }
    Object.assign(n, { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd, kind: kindSel.value, title: titleInput.value.trim(), body: body.value.trim(),
      tags: tagsInput.value.split(/[,;]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean) });
    await saveNote(n);
    toast('Note saved.');
    s.close();
    if (onSaved) onSaved(n);
  } });
  const row = el('div', { class: 'row end' }, [
    n.id ? el('button', { class: 'btn ghost danger', type: 'button', text: 'Delete', onclick: async () => {
      if (await confirmBox('Delete this note? This cannot be undone.', 'Delete', true)) {
        await deleteNote(n.id);
        toast('Note deleted.');
        s.close();
        if (onSaved) onSaved(null);
      }
    } }) : null,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => s.close() }),
    saveBtn,
  ]);
  s.body.append(
    el('label', { class: 'f' }, ['Verse(s)', refInput, refHint]),
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, ['Kind', kindSel]),
      el('label', { class: 'f' }, ['Title', titleInput]),
    ]),
    el('label', { class: 'f' }, ['Note', body]),
    el('label', { class: 'f' }, ['Tags', tagsInput]),
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
    if (n) { editNote(n, () => { location.hash = '#notes'; }); }
  }
  const search = el('input', { type: 'search', placeholder: 'Search notes: a word, a tag, or a reference such as "Ps 23"…', 'aria-label': 'Search notes', autocomplete: 'off' });
  const list = el('div', { class: 'notes' });
  const chips = el('div', { class: 'row chips' });
  function chip(v, label) {
    return el('button', { class: 'chip' + (filterKind === v ? ' on' : ''), type: 'button', text: label, onclick: () => { filterKind = v; show(); for (const c of chips.children) c.classList.toggle('on', c.dataset.v === v); }, dataset: { v } });
  }
  chips.append(chip('', 'All'), ...KINDS.map(([v, l]) => chip(v, l)));

  function show() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const ref = q ? parseRef(q) : null;
    let items = state.notes.slice();
    if (filterKind) items = items.filter(n => n.kind === filterKind);
    if (ref) {
      items = items.filter(n => n.book === ref.book && (!ref.chapter || n.chapter === ref.chapter || q.split(/\s+/).length === 1) && (!ref.verse || !n.verse || (ref.verse >= n.verse && ref.verse <= (n.verseEnd || n.verse))));
    } else if (q) {
      items = items.filter(n => (n.title + ' ' + n.body + ' ' + (n.tags || []).join(' ') + ' ' + refLabel(n)).toLowerCase().includes(q));
    }
    if (!items.length) {
      list.append(el('p', { class: 'muted', text: state.notes.length ? 'No notes match.' : 'No notes yet. Open a chapter, tap a verse and choose "Note", or tap "New note".' }));
    }
    for (const n of items) list.append(card(n, show));
  }
  search.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [
      el('h2', { text: `Notes (${state.notes.length})` }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small', type: 'button', text: 'New note', onclick: () => editNote({ kind: 'thought', tags: [] }, show) }),
    ]),
    search, chips, list);
  show();
}

/*
 * Prepare: a guided path from a Bible text to a divine service.
 *
 * One preparation is one service. The form walks the usual order of work:
 * the text word and the message from the Divine Service Guide, understanding
 * the text, building the sermon, illustrations from the person's own notes,
 * and a reflection afterwards. Everything saves as it is typed. Two printed
 * outputs come from it: the full sermon notes and a one-page cue card.
 */
import { el, clear, toast, sheet, confirmBox, fmtDate, debounce, nextSunday, fit, lineBox } from './ui.js';
import { parseRef, formatRef } from './books.js';
import { state, saveSermon, deleteSermon } from './store.js';
import * as Bible from './bible.js';
import * as Cat from './catechism.js';
import * as Notes from './notes.js';
import * as Pdf from './pdf.js';

export const OCCASIONS = [
  'Sunday divine service', 'Midweek divine service', 'Divine service for the departed',
  'Youth service', 'Children\'s service', 'Funeral service', 'Wedding', 'Other',
];
const STATUS = [['draft', 'Draft'], ['ready', 'Ready'], ['held', 'Held']];
const STATUS_LABEL = Object.fromEntries(STATUS);

export async function newFromText(ref, text, translationShort) {
  await Cat.load().catch(() => {});
  const s = {
    date: nextSunday(),
    congregation: state.settings.congregation || '',
    occasion: OCCASIONS[0],
    title: '',
    ref, refText: formatRef(ref, state.settings.bookLang),
    translation: translationShort || '', translationId: state.settings.translation,
    text: text || '',
    theme: '', core: '', guide: '', context: '', keywords: '',
    catechism: sectionsForRef(ref).slice(0, 12).map(c => ({ n: c.n, title: c.title })),
    catechismText: 'full',
    crossRefs: '', intro: '', points: [{ heading: '', body: '' }, { heading: '', body: '' }, { heading: '', body: '' }],
    application: '', illustrations: '', conclusion: '', reflection: '', status: 'draft',
  };
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

function sectionsForRef(ref) {
  if (!ref) return [];
  const out = [];
  if (!ref.verse) return Cat.refsFor(ref.book, ref.chapter, null);
  for (let v = ref.verse; v <= (ref.verseEnd || ref.verse); v++) {
    for (const sec of Cat.refsFor(ref.book, ref.chapter, v)) if (!out.includes(sec)) out.push(sec);
  }
  return out;
}

export function render(container, route) {
  clear(container);
  if (route[1]) {
    const s = state.sermons.find(x => x.id === route[1]);
    if (s) return renderEditor(container, s);
    toast('That preparation was not found.', true);
    location.hash = '#prepare';
    return;
  }
  renderList(container);
}

/* ---------------------------------------------------------------- the list */
function renderList(container) {
  const search = el('input', { type: 'search', placeholder: 'Search by text, congregation or theme…', 'aria-label': 'Search preparations', autocomplete: 'off' });
  const list = el('div', { class: 'list' });
  function show() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const items = state.sermons.filter(s => !q || [s.refText, s.congregation, s.theme, s.title, s.occasion, s.date].join(' ').toLowerCase().includes(q));
    if (!items.length) list.append(el('p', { class: 'muted', text: state.sermons.length ? 'Nothing matches.' : 'No preparations yet. Tap "New preparation", or select verses in the reader and choose "Prepare a service".' }));
    for (const s of items) {
      list.append(el('a', { class: 'item sermon', href: `#prepare/${s.id}` }, [
        el('div', { class: 'when' }, [el('b', { text: fmtDate(s.date, true) || 'No date' }), el('span', { class: 'muted small', text: [s.congregation, s.occasion].filter(Boolean).join(' · ') })]),
        el('div', { class: 'grow' }, [
          el('div', { class: 'ref', text: s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || 'No text word yet') }),
          el('div', { class: 'muted small', text: s.title || s.theme || '' }),
        ]),
        el('span', { class: 'pill status ' + (s.status || 'draft'), text: STATUS_LABEL[s.status] || 'Draft' }),
      ]));
    }
  }
  search.addEventListener('input', show);
  container.append(
    el('div', { class: 'docbar' }, [
      el('h2', { text: `Service preparations (${state.sermons.length})` }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small', type: 'button', text: 'New preparation', onclick: () => newBlank() }),
    ]),
    el('p', { class: 'muted small', text: 'Each card is one divine service: the text word, the message from the Divine Service Guide, your own thoughts, and the printed sermon notes and cue card.' }),
    search, list);
  show();
}

async function newBlank() {
  const s = {
    date: nextSunday(), congregation: state.settings.congregation || '', occasion: OCCASIONS[0], title: '',
    ref: null, refText: '', translation: Bible.source(state.settings.translation)?.short || 'KJV', translationId: state.settings.translation, text: '',
    theme: '', core: '', guide: '', context: '', keywords: '', catechism: [], catechismText: 'full', crossRefs: '', intro: '',
    points: [{ heading: '', body: '' }, { heading: '', body: '' }, { heading: '', body: '' }],
    application: '', illustrations: '', conclusion: '', reflection: '', status: 'draft',
  };
  await saveSermon(s);
  location.hash = `#prepare/${s.id}`;
}

/* ---------------------------------------------------------------- editor */
function renderEditor(container, s) {
  const lang = state.settings.bookLang;
  const savedBadge = el('span', { class: 'badge', text: 'Saved', hidden: true });
  const save = debounce(async () => {
    await saveSermon(s);
    savedBadge.hidden = false;
    setTimeout(() => { savedBadge.hidden = true; }, 1500);
  }, 500);
  const touch = () => { save(); };

  // the title of a section of the sermon, above its box: styled as a heading (see #tab-prepare .f-title in styles.css)
  const title = text => el('span', { class: 'f-title', text });
  // every box grows with its text (see autosize in ui.js); `line` is a one-line box that wraps rather than scrolls sideways
  function field(label, key, opts = {}) {
    const input = opts.rows
      ? el('textarea', { rows: opts.rows, placeholder: opts.placeholder || '' })
      : opts.line
        ? lineBox({ placeholder: opts.placeholder || '' })
        : el('input', { type: opts.type || 'text', placeholder: opts.placeholder || '' });
    input.value = s[key] || '';
    input.addEventListener('input', () => { s[key] = input.value; touch(); });
    return el('label', { class: 'f' + (opts.cls ? ' ' + opts.cls : '') }, [title(label), input, opts.hint ? el('span', { class: 'hint muted small', text: opts.hint }) : null]);
  }
  function step(n, title, hint) {
    return el('div', { class: 'step-head' }, [el('span', { class: 'step-n', text: n }), el('div', {}, [el('h3', { text: title }), hint ? el('p', { class: 'muted small', text: hint }) : null])]);
  }

  // ---- header
  const statusSel = el('select', { class: 'status-sel', 'aria-label': 'Status of this preparation' }, STATUS.map(([v, l]) => el('option', { value: v, text: l, selected: (s.status || 'draft') === v })));
  statusSel.addEventListener('change', () => { s.status = statusSel.value; touch(); });
  container.append(
    el('div', { class: 'crumbs' }, [el('a', { href: '#prepare', text: '‹ All preparations' })]),
    el('div', { class: 'prep-head' }, [el('div', { class: 'docbar' }, [
      el('h2', { text: s.ref ? formatRef(s.ref, lang) : 'Service preparation' }),
      savedBadge,
      el('div', { class: 'spacer' }),
      statusSel,
    ])]));
  // the form itself sits on a page under the pinned heading
  const page = el('div', { class: 'page' });
  container.append(page);
  container = page;

  // ---- service details
  const occSel = el('select', {}, [...OCCASIONS, ...(OCCASIONS.includes(s.occasion) || !s.occasion ? [] : [s.occasion])].map(o => el('option', { value: o, text: o, selected: o === s.occasion })));
  occSel.addEventListener('change', () => { s.occasion = occSel.value; touch(); });
  container.append(el('div', { class: 'fields three' }, [
    field('Date', 'date', { type: 'date' }),
    field('Congregation', 'congregation', { placeholder: 'e.g. Phumolong' }),
    el('label', { class: 'f wide' }, [title('Occasion'), occSel]),
    field('Sermon title (optional)', 'title', { cls: 'full', line: true, placeholder: 'A heading for your notes' }),
  ]));

  // ---- 1. text word
  container.append(step(1, 'The text word', 'Read it slowly, more than once, and pray before writing anything. Fetch the text from a translation, or type it in yourself.'));
  const refInput = el('input', { type: 'text', value: s.ref ? formatRef(s.ref, lang) : (s.refText || ''), placeholder: 'e.g. Psalm 130:7 or Lukas 8:16-18' });
  const refHint = el('span', { class: 'hint muted small' });
  const transSel = el('select', {});
  for (const src of Bible.sources()) transSel.append(el('option', { value: src.id, text: src.short, selected: src.id === s.translationId }));
  transSel.append(el('option', { value: '', text: 'Typed / pasted', selected: !s.translationId }));
  const textArea = el('textarea', { rows: 5, placeholder: 'The Bible text as it will be read. Tap "Fetch text" to fill it from the chosen translation.' });
  textArea.value = s.text || '';
  textArea.addEventListener('input', () => { s.text = textArea.value; touch(); });
  const catBox = el('div', { class: 'catbox' });

  function applyRef() {
    const r = parseRef(refInput.value);
    refHint.textContent = r ? '→ ' + formatRef(r, lang) : (refInput.value.trim() ? 'Not understood yet. Book, chapter, verse: "Johannes 3:16".' : '');
    refHint.classList.toggle('error', !r && !!refInput.value.trim());
    s.refText = refInput.value.trim();
    if (r) { s.ref = r; } else if (!refInput.value.trim()) { s.ref = null; }
    touch();
    renderCatechism();
    return r;
  }
  refInput.addEventListener('input', applyRef);
  const typedTrans = el('input', { type: 'text', value: s.translation || '', placeholder: 'e.g. NKJV', hidden: !!s.translationId });
  transSel.addEventListener('change', () => {
    s.translationId = transSel.value;
    s.translation = transSel.value ? Bible.source(transSel.value)?.short || '' : (s.translation || '');
    typedTrans.hidden = !!transSel.value;
    touch();
  });
  typedTrans.addEventListener('input', () => { s.translation = typedTrans.value.trim(); touch(); });

  const fetchBtn = el('button', { class: 'btn small ghost', type: 'button', text: 'Fetch text', onclick: async () => {
    const r = parseRef(refInput.value);
    if (!r) { toast('Give a reference first, such as "Psalm 130:7".', true); return; }
    if (!transSel.value) { toast('Choose a translation to fetch from, or type the text yourself.', true); return; }
    try {
      const ch = await Bible.getChapter(transSel.value, r.book, r.chapter);
      if (ch.missing) { toast('That translation does not contain this book.', true); return; }
      const from = r.verse || 1, to = r.verse ? (r.verseEnd || r.verse) : ch.verses.length;
      s.text = Bible.joinVerses(ch.verses, from, to);
      s.translation = Bible.source(transSel.value).short;
      textArea.value = s.text;
      fit(textArea);
      touch();
      toast('Text fetched.');
    } catch (e) { toast(e.message, true); }
  } });

  container.append(
    el('div', { class: 'fields two' }, [
      el('label', { class: 'f' }, [title('Reference'), refInput, refHint]),
      el('label', { class: 'f' }, [title('Translation'), el('div', { class: 'row line' }, [transSel, typedTrans, fetchBtn])]),
    ]),
    el('label', { class: 'f' }, [title('Text'), textArea]),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn small ghost', href: '#read', text: 'Open in the reader', onclick: e => { if (s.ref) { e.preventDefault(); location.hash = `#read/${s.ref.book}/${s.ref.chapter}${s.ref.verse ? '/' + s.ref.verse : ''}`; } } }),
    ]));

  // ---- 2. the Guide
  container.append(step(2, 'The message from the Divine Service Guide',
    'Write the message and core thought of the Guide in your own words first. The Guide gives the direction; the sermon is how it reaches this congregation.'));
  container.append(
    field('Message of the service', 'theme', { line: true, placeholder: 'The theme in one sentence' }),
    field('Core thought', 'core', { rows: 2, placeholder: 'The one thing the congregation should take home' }),
    field('Notes from the Guide', 'guide', { rows: 5, placeholder: 'Key thoughts from the Guide, in your own words. Which sentences struck you? What should be kept?' }),
  );

  // ---- 3. understand
  container.append(step(3, 'Understand the text',
    'Who is speaking, to whom, and why? What came before and after? Which words carry the weight? The Catechism sections below quote this very text: tick the ones to keep, and open one to read it here.'));
  const catChoice = el('select', { class: 'small' }, [
    el('option', { value: 'full', text: 'Full text of each section' }),
    el('option', { value: 'summary', text: 'The Catechism\'s own summary' }),
    el('option', { value: 'ref', text: 'Number and title only' }),
  ]);
  catChoice.value = s.catechismText || 'full';
  catChoice.addEventListener('change', () => { s.catechismText = catChoice.value; touch(); });
  const catNote = el('p', { class: 'muted small cat-note' });
  container.append(
    field('Context', 'context', { rows: 4, placeholder: 'The setting of the text: the people, the situation, the surrounding chapters' }),
    field('Key words and their meaning', 'keywords', { rows: 3, placeholder: 'One word per line, with what it means here' }),
    el('label', { class: 'f' }, [title('Catechism references'), catBox]),
    el('div', { class: 'row line cat-row' }, [el('span', { class: 'small', text: 'In the sermon notes:' }), catChoice]),
    catNote,
    field('Cross references', 'crossRefs', { rows: 3, placeholder: 'Other passages that shed light, one per line: "Romans 8:28 – all things work together"' }),
  );

  function catRow(sec, checked, onChange, extraRef) {
    const cb = el('input', { type: 'checkbox', checked });
    cb.addEventListener('change', () => onChange(cb.checked));
    const row = el('label', { class: 'check' }, [cb, el('span', { class: 'num', text: sec.n }), el('span', { class: 'grow', text: sec.title })]);
    const wrap = el('div', { class: 'cat-item' }, row);
    if (Cat.textReady() && Cat.textOf(sec.n)) {
      const body = el('div', { class: 'cat-read', hidden: true });
      const btn = el('button', { class: 'btn small ghost', type: 'button', text: 'Read', 'aria-expanded': 'false', onclick: e => {
        e.preventDefault();
        if (body.hidden) { if (!body.firstChild) body.append(Cat.renderText(sec.n, { noCredit: true })); body.hidden = false; btn.textContent = 'Hide'; btn.setAttribute('aria-expanded', 'true'); }
        else { body.hidden = true; btn.textContent = 'Read'; btn.setAttribute('aria-expanded', 'false'); }
      } });
      row.append(btn);
      wrap.append(body);
    } else {
      row.append(el('a', { class: 'small', href: Cat.url(extraRef || sec), target: '_blank', rel: 'noopener', text: 'nak.org ↗' }));
    }
    return wrap;
  }

  function renderCatechism() {
    clear(catBox);
    if (!Cat.ready()) { Cat.load().then(renderCatechism); catBox.append(el('span', { class: 'muted small', text: 'Loading…' })); return; }
    if (Cat.hasText() && !Cat.textReady()) { Cat.loadText().then(renderCatechism); }
    const secs = sectionsForRef(s.ref);
    if (!s.ref) { catBox.append(el('span', { class: 'muted small', text: 'Give a reference above to see the Catechism sections that refer to it.' })); }
    else if (!secs.length) { catBox.append(el('span', { class: 'muted small', text: 'The Catechism does not quote these verses directly. Search the Catechism tab by subject instead.' })); }
    const chosen = new Set((s.catechism || []).map(c => c.n));
    for (const sec of secs) {
      catBox.append(catRow(sec, chosen.has(sec.n), on => {
        s.catechism = (s.catechism || []).filter(c => c.n !== sec.n);
        if (on) s.catechism.push({ n: sec.n, title: sec.title });
        touch();
      }));
    }
    // keep any section chosen earlier that is no longer in the list (the reference changed)
    for (const c of (s.catechism || [])) if (!secs.find(x => x.n === c.n)) {
      catBox.append(catRow(c, true, () => { s.catechism = s.catechism.filter(x => x.n !== c.n); touch(); renderCatechism(); }, Cat.section(c.n)));
    }
    catNote.textContent = Cat.hasText()
      ? 'Ticked sections go into the sermon notes as chosen above.'
      : 'The text of the Catechism is not loaded on this device, so the notes list the ticked sections by number and title. Load it under Settings → Catechism to read the sections here and print them.';
  }
  renderCatechism();

  // ---- 4. build
  container.append(step(4, 'Build the sermon',
    'An introduction that opens the door, two or three main points that each stand on the text, and a conclusion that leads to the altar. Plain words, short sentences.'));
  container.append(field('Introduction', 'intro', { rows: 4, placeholder: 'How you will begin: a question, a picture from daily life, the setting of the text' }));
  const pointsBox = el('div', { class: 'points' });
  function renderPoints() {
    clear(pointsBox);
    s.points = s.points && s.points.length ? s.points : [{ heading: '', body: '' }];
    s.points.forEach((p, i) => {
      const head = lineBox({ value: p.heading || '', placeholder: `Main point ${i + 1}` });
      head.addEventListener('input', () => { p.heading = head.value; touch(); });
      const body = el('textarea', { rows: 4, placeholder: 'What the text says, what it means, what it asks of us' });
      body.value = p.body || '';
      body.addEventListener('input', () => { p.body = body.value; touch(); });
      pointsBox.append(el('div', { class: 'point' }, [
        el('div', { class: 'row line' }, [el('span', { class: 'step-n small', text: i + 1 }), head,
          el('button', { class: 'icon del', type: 'button', 'aria-label': 'Remove this point', text: '✕', onclick: () => { s.points.splice(i, 1); touch(); renderPoints(); } })]),
        body,
      ]));
    });
    pointsBox.append(el('div', { class: 'row' }, [el('button', { class: 'btn small ghost', type: 'button', text: 'Add a point', onclick: () => { s.points.push({ heading: '', body: '' }); touch(); renderPoints(); } })]));
  }
  renderPoints();
  container.append(
    pointsBox,
    field('Application for the congregation', 'application', { rows: 4, placeholder: 'What does this ask of us this week? Name it for the people in front of you.' }),
    field('Conclusion', 'conclusion', { rows: 3, placeholder: 'Gather the thoughts and lead to the altar: forgiveness, Holy Communion, the hope we share' }),
  );

  // ---- 5. illustrations
  container.append(step(5, 'Illustrations and experiences',
    'A true experience says more than an explanation. Bring one in from your notes, or write it here.'));
  const illus = field('Illustrations', 'illustrations', { rows: 5, placeholder: 'A story, an experience, a picture that makes the point visible' });
  const illusArea = illus.querySelector('textarea');
  container.append(illus, el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: 'Insert from my notes', onclick: () => pickNote(note => {
      const line = `${Notes.refLabel(note)}${note.title ? ' – ' + note.title : ''}: ${note.body}`;
      s.illustrations = (s.illustrations ? s.illustrations.trim() + '\n\n' : '') + line;
      illusArea.value = s.illustrations;
      fit(illusArea);
      touch();
    }) }),
  ]));

  // ---- output
  container.append(step('✓', 'Print or save', 'The sermon notes carry everything above. The cue card is one page in large type for the pulpit.'));
  async function run(make, how) {
    try {
      await Cat.loadText().catch(() => false);
      const r = make(s);
      if (how === 'print') { Pdf.print(r); toast('Sending to the printer…'); }
      else if (how === 'share') Pdf.share(r).then(res => { if (res === 'downloaded') toast('Sharing is not available here, so the PDF was downloaded.'); });
      else { Pdf.download(r); toast('Saved ' + r.name); }
    } catch (e) { toast(e.message || 'The PDF could not be built.', true); }
  }
  const out = el('div', { class: 'outputs' }, [
    el('button', { class: 'btn small', type: 'button', text: 'Sermon notes PDF', onclick: () => run(Pdf.sermonPdf, 'download') }),
    el('button', { class: 'btn small', type: 'button', text: 'Cue card PDF', onclick: () => run(Pdf.cueCardPdf, 'download') }),
    el('button', { class: 'btn small ghost', type: 'button', text: 'Print notes', onclick: () => run(Pdf.sermonPdf, 'print') }),
    el('button', { class: 'btn small ghost', type: 'button', text: 'Print cue card', onclick: () => run(Pdf.cueCardPdf, 'print') }),
    Pdf.canShare() ? el('button', { class: 'btn small ghost', type: 'button', text: 'Share notes', onclick: () => run(Pdf.sermonPdf, 'share') }) : null,
  ]);
  container.append(out);

  // ---- 6. reflection
  container.append(step(6, 'After the service', 'A few honest lines while it is fresh. They make the next preparation better.'));
  container.append(field('Reflection', 'reflection', { rows: 4, placeholder: 'What spoke? What would you do differently? What did the congregation give back?' }));

  container.append(el('div', { class: 'row end' }, [
    el('button', { class: 'btn ghost danger', type: 'button', text: 'Delete this preparation', onclick: async () => {
      if (await confirmBox('Delete this preparation and its notes? This cannot be undone.', 'Delete', true)) {
        await deleteSermon(s.id);
        toast('Preparation deleted.');
        location.hash = '#prepare';
      }
    } }),
  ]));
}

function pickNote(onPick) {
  const sh = sheet('Insert a note');
  const kinds = new Set(['experience', 'illustration']);
  const first = state.notes.filter(n => kinds.has(n.kind));
  const rest = state.notes.filter(n => !kinds.has(n.kind));
  if (!state.notes.length) sh.body.append(el('p', { class: 'muted', text: 'You have no notes yet. Write them in the reader: tap a verse, then "Note".' }));
  for (const n of [...first, ...rest]) {
    sh.body.append(el('button', { class: 'item pick', type: 'button', onclick: () => { sh.close(); onPick(n); } }, [
      el('div', { class: 'note-head' }, [el('b', { text: Notes.refLabel(n) }), el('span', { class: 'pill kind ' + n.kind, text: n.kind })]),
      el('div', { class: 'small', text: (n.title ? n.title + ' – ' : '') + n.body.slice(0, 160) + (n.body.length > 160 ? '…' : '') }),
    ]));
  }
}

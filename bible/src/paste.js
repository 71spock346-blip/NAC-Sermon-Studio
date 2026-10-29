/*
 * Text the person pastes in themselves, one chapter at a time: a chapter
 * copied from the page or app where they read it, kept in this browser on
 * this device only. The parser turns the pasted block into numbered verses;
 * the sheet shows how many it found before anything is saved.
 */
import { el, sheet, toast, confirmBox } from './ui.js';
import { t, tn } from './i18n.js';
import { state, getText, saveText, deleteText } from './store.js';
import { formatRef } from './books.js';
import * as Bible from './bible.js';

const SUPER = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/**
 * Splits a pasted chapter into verses by its verse numbers, which must run
 * 1, 2, 3… Numbers may be superscript, glued to the first word ("1In die
 * begin"), followed by a dot, or written as 3:1 with this chapter's number.
 * A heading line before verse 1 becomes the title; a short unpunctuated
 * last line of a verse (a section heading) is dropped; footnote letters
 * like [a] go. Returns {verses: [{n, text}], title, warnings: [string]}.
 */
export function parsePasted(raw, chapter) {
  let text = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUPER[c]);
  text = text.replace(/[\[(][a-zA-Z][\])]/g, '');                                   // footnote letters
  if (chapter) text = text.replace(new RegExp(`(^|[^\\d:])${chapter}:(\\d{1,3})(?!\\d)`, 'g'), '$1 $2 ');   // 3:7 -> 7
  text = text.replace(/^\s*(?:[^\n\d]{1,40}\s)?\d{1,3}\s*\n/, '');                  // a "Genesis 1" line at the top

  const found = [];
  let expected = 1, from = 0;
  while (true) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${expected})(?!\\p{N})`, 'gu');
    re.lastIndex = from;
    const m = re.exec(text);
    if (!m) break;
    const markerAt = m.index + m[1].length;
    let after = markerAt + String(expected).length;
    while (after < text.length && /[.):\]]/.test(text[after])) after++;
    if (!/^[\s"'“‘(\[\p{L}]/u.test(text.slice(after, after + 1) || ' ')) { from = after; continue; }
    if (found.length) found[found.length - 1].end = markerAt;
    found.push({ n: expected, at: markerAt, start: after, end: text.length });
    expected++;
    from = after;
  }

  const warnings = [];
  let title = '';
  if (found.length) {
    const lead = text.slice(0, found[0].at).split('\n').map(x => x.trim()).filter(Boolean);
    const last = lead[lead.length - 1] || '';
    if (last && last.length <= 80) title = last;
  }
  const verses = found.map(f => ({ n: f.n, text: cleanVerse(text.slice(f.start, f.end)) })).filter(v => v.text);
  if (!verses.length) warnings.push(t('No verse numbers were found: copy from a page that shows them.'));
  const long = verses.find(v => v.text.length > 1500);
  if (long) warnings.push(t('Verse {n} is very long, so some verse numbers after it may not have been recognised.', { n: long.n }));
  return { verses, title, warnings };
}

function cleanVerse(s) {
  const lines = s.split('\n').map(x => x.trim()).filter(Boolean);
  // a section heading sits between the end of a verse and the next number: short, no closing punctuation
  while (lines.length > 1 && lines[lines.length - 1].length <= 60 && !/[.!?;:,'"”’)]$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join(' ').replace(/\s+/g, ' ').replace(/^[\s.:)\]]+/, '').trim();
}

/** Where the person can read this chapter to copy it from. */
function readAt(ext, book, chapter) {
  return ext.sa ? { name: 'BibleSA', url: Bible.bibleSaUrl(ext, book, chapter) } : { name: 'YouVersion', url: Bible.youVersionUrl(ext, book, chapter) };
}

/** The card shown in the reader when a chapter of a pasted version is not there yet. */
export function unpastedCard(src, book, chapter, onChange, extra) {
  const ext = src.ext;
  const at = readAt(ext, book, chapter);
  return el('div', { class: 'paste-card' }, [
    el('p', {}, [el('b', { text: `${src.short}: ` }), t('you have not pasted {ref} in yet.', { ref: formatRef({ book, chapter }, state.settings.bookLang) })]),
    el('p', { class: 'muted small', text: t('Open the chapter on {site}, select it with its verse numbers, copy it, then paste it here. It stays in this browser only.', { site: at.name }) }),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn small ghost', href: at.url, target: '_blank', rel: 'noopener', text: t('Open on {site} ↗', { site: at.name }) }),
      el('button', { class: 'btn small', type: 'button', text: t('Paste the chapter'), onclick: () => pasteSheet(src, book, chapter, onChange) }),
      ...(extra || []),
    ]),
  ]);
}

/** The sheet where a chapter is pasted, checked and saved (or an existing one edited or removed). */
export async function pasteSheet(src, book, chapter, onChange) {
  const ext = src.ext;
  const ref = formatRef({ book, chapter }, state.settings.bookLang);
  const existing = await getText(ext.id, book, chapter);
  const s = sheet(`${existing ? t('Edit') : t('Paste')} ${ref} (${ext.label})`, { wide: true, sticky: true });
  const ta = el('textarea', { rows: 12, placeholder: '1 In die begin het God die hemel en die aarde geskep.\n2 Die aarde was …', spellcheck: 'false', 'aria-label': t('Pasted chapter') });
  if (existing) ta.value = (existing.title ? existing.title + '\n' : '') + existing.verses.map(v => `${v.n} ${v.text}`).join('\n');
  const preview = el('p', { class: 'small muted' });
  const saveBtn = el('button', { class: 'btn small', type: 'button', text: t('Save chapter'), disabled: true });
  let parsed = { verses: [], warnings: [] };
  const update = () => {
    parsed = parsePasted(ta.value, chapter);
    const n = parsed.verses.length;
    preview.textContent = !ta.value.trim() ? '' : (n ? tn(n, '{n} verse found (1–{n})', '{n} verses found (1–{n})') + (parsed.title ? t(', heading "{title}"', { title: parsed.title }) : '') + '. ' : '') + parsed.warnings.join(' ');
    preview.className = 'small ' + (n ? 'muted' : 'error');
    saveBtn.disabled = !n;
  };
  ta.addEventListener('input', update);
  saveBtn.addEventListener('click', async () => {
    await saveText(ext.id, book, chapter, parsed.verses, parsed.title);
    s.close();
    toast(t('{ref} ({label}) saved: {n} verses.', { ref, label: ext.label, n: parsed.verses.length }));
    onChange();
  });
  const at = readAt(ext, book, chapter);
  s.body.append(
    el('p', { class: 'small' }, [
      t('Open {ref} on ', { ref }), el('a', { href: at.url, target: '_blank', rel: 'noopener', text: at.name + ' ↗' }),
      t(', select the whole chapter with its verse numbers, copy it, and paste it below. Headings and footnote letters are dropped; check the verse count before saving.'),
    ]),
    ta, preview,
    el('div', { class: 'row' }, [
      existing ? el('button', { class: 'btn small ghost danger', type: 'button', text: t('Remove this chapter'), onclick: async () => {
        if (await confirmBox(t('Remove the pasted {label} text of {ref} from this device?', { label: ext.label, ref }), t('Remove'), true)) { await deleteText(ext.id, book, chapter); s.close(); onChange(); }
      } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Cancel'), onclick: () => s.close() }),
      saveBtn,
    ]),
    el('p', { class: 'muted small', text: `${ext.name} © ${ext.holder}. ` + t('What you paste stays in this browser on this device. It is not in the normal backup: Settings → Translations → My pasted text has its own save file.') }),
  );
  update();
  setTimeout(() => ta.focus(), 50);
  return s;
}

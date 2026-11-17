/*
 * "Ask Claude" about a book: the person asks in their own words, and the
 * chapters that carry the words of the question (handbook.js relevant) go
 * to Claude, who answers from them alone, in plain words, naming the
 * chapters so the answer can be checked against the book. The answer is
 * shown, not kept. The box stands under Handbooks (the Creed, the handbooks
 * loaded from their files and, once its text is on the device, the
 * Catechism) and on the Catechism tab (the Catechism alone), with its own
 * words in each place. Only where the AI helper is unlocked on this device
 * (lock.js): a locked device shows nothing of it.
 *
 * A book is a handbook in the shape handbook.js gives a loaded one: {key,
 * title, language, chapters: [{n, title, blocks}]}. The Catechism gives its
 * sections that shape (catechism.js asHandbook); its `tab` says they open
 * on its own tab (#catechism/<n>), not under #handbooks. The helpers here
 * (the address of a chapter, its link, its label) are shared with
 * handbooks.js for the same reason.
 */
import { el, clear, toast, busy, fmtDate } from './ui.js';
import { t } from './i18n.js';
import { relevant } from './handbook.js';
import { noKey } from './guides.js';
import * as AI from './ai.js';

/** A chapter's address in the hash: its number, or its place when it has none. */
export const addrOf = (hb, c) => (c.n ? c.n : 'i' + hb.chapters.indexOf(c));

/** Where a chapter opens: under Handbooks, or on the book's own tab (the Catechism's sections, at #catechism/<n>). */
export const hrefOf = (hb, c) => (hb.tab ? `#${hb.tab}/${encodeURIComponent(c.n)}` : `#handbooks/${encodeURIComponent(hb.key)}/${encodeURIComponent(addrOf(hb, c))}`);

/** The chapter at an address, or -1. */
export function indexAt(hb, addr) {
  const m = String(addr).match(/^i(\d+)$/);
  if (m) return hb.chapters[+m[1]] ? +m[1] : -1;
  return hb.chapters.findIndex(c => c.n === addr);
}

/** "4.5.4  Requirements of the sermon"; an appendix, the Catechism's introduction or an unnumbered chapter by its title alone. */
export const label = c => (c.n && !/^A/.test(c.n) && c.n !== 'Intro' ? c.n + '  ' : '') + c.title;

/** The sparkle on an Ask Claude button (theology.js draws the same). */
export function sparkle() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

/**
 * The box: the question, the Ask Claude button and, under it, the answer.
 * `books` are the books asked; `o` gives the words of the place the box
 * stands in: title, lead, placeholder, reading(n) while Claude reads, none
 * when no chapter carries the question's words, notFound when the chapters
 * read do not answer it, footer under the answer, max chapters sent, cls on
 * the box. Null on a locked device.
 */
export function askBox(books, o = {}) {
  if (!AI.unlocked()) return null;
  const w = {
    title: t('Ask the handbooks'),
    lead: t('Claude reads the chapters that fit your question and answers from them in plain words, naming the chapters, so you can check what the book says. The answer is not kept.'),
    placeholder: t('A question for the handbooks: "How long may the sermon be?", "Who may hold a prayer service?"…'),
    reading: n => t('Claude is reading {n} chapters of the handbooks. This takes about half a minute.', { n }),
    none: t('No chapter carries the words of that question. Try other words.'),
    notFound: t('The chapters read do not answer this; what stands above is as near as they come.'),
    footer: t('A help for study, not Church doctrine: the Church\'s teaching is in the Catechism, and the Apostles interpret Holy Scripture (CNAC 1.2.5.1).'),
    max: 12,
    cls: '',
    ...o,
  };
  const ta = el('textarea', { class: 'hb-q', rows: 2, 'aria-label': w.title, placeholder: w.placeholder });
  const out = el('div', { class: 'hb-answer' });
  return el('div', { class: 'th-ask hb-ask' + (w.cls ? ' ' + w.cls : '') }, [
    el('h3', { class: 'sub', text: w.title }),
    el('p', { text: w.lead }),
    ta,
    el('div', { class: 'row' }, [
      el('button', { class: 'btn small ai-btn', type: 'button', onclick: () => ask(ta.value.trim(), books, w, out) }, [sparkle(), t('Ask Claude')]),
      el('span', { class: 'muted small grow', text: t('With your own Anthropic key; usually under 10 US cents an answer.') }),
    ]),
    out,
  ]);
}

const paras = text => String(text || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => el('p', { text: x }));

async function ask(q, books, w, out) {
  if (!q) { toast(t('Type a question first.'), true); return; }
  if (!AI.ready()) { noKey(); return; }
  const picks = relevant(books, q, w.max);
  if (!picks.length) { toast(w.none, true); return; }
  const ctrl = new AbortController();
  const b = busy(t('Asking Claude'), () => ctrl.abort());
  b.say(w.reading(picks.length));
  try {
    const r = await AI.askHandbooks(q, picks.map(p => ({ handbook: p.handbook, chapter: p.chapter, addr: addrOf(p.handbook, p.chapter) })), { signal: ctrl.signal });
    b.done();
    clear(out);
    const d = r.data;
    const cites = (Array.isArray(d.cites) ? d.cites : []).map(x => {
      const hb = books.find(h => h.key === x.key);
      const i = hb ? indexAt(hb, x.n) : -1;
      return i >= 0 ? el('li', {}, [el('a', { href: hrefOf(hb, hb.chapters[i]), lang: hb.language, text: `${hb.short || hb.title}: ${label(hb.chapters[i])}` })]) : el('li', { text: [x.title, x.n].filter(Boolean).join(' ') });
    });
    out.append(...[
      el('div', { class: 'hb-answer-text' }, paras(d.answer)),
      d.found === false ? el('p', { class: 'muted small', text: w.notFound }) : null,
      cites.length ? el('div', {}, [el('b', { class: 'small', text: t('From') }), el('ul', { class: 'hb-cites small' }, cites)]) : null,
      el('p', { class: 'muted small', text: t('Written {date} by {model}{cost}.', { date: fmtDate(new Date().toISOString()), model: AI.modelLabel(r.model), cost: r.cost ? ', ' + AI.fmtCost(r.cost) : '' }) + ' ' + w.footer }),
    ].filter(Boolean));
    out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    b.fail(e.message || String(e));
  }
}

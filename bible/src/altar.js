/*
 * Altar mode: the service itself on one full screen. Opened from the Sunday
 * card (sunday.js; #altar/<id> is one preparation), it holds the cue cards
 * and then the altar card of the Liturgy for that kind of service, a swipe
 * apart, and The sermon after them when it is written, in the reader's large
 * letters, with the screen kept awake and nothing else on the screen: the
 * header, the menu and the bar are hidden while it is open (body.altar from
 * app.js; styles.css). At the altar there is no time to find things, and
 * until now the cards and the altar card sat in two places (Jerome's review
 * of 2026-11-20, idea 2).
 *
 * The pieces are drawn as their own screens draw them (read.js, liturgy.js);
 * this module only puts them side by side: the panes sit in a row that
 * scrolls sideways and snaps to a pane, so a swipe, the arrow keys or the
 * names at the top move between them, and each pane scrolls down on its
 * own. ✕ goes back to Sunday, as the phone's back button does. A sync that
 * arrives meanwhile does not redraw this screen (app.js onSynced).
 */
import { $$, el, clear, toast, seg, SIZES, fmtDate } from './ui.js';
import { t } from './i18n.js';
import { state, saveSetting } from './store.js';
import { formatRef } from './books.js';
import { sermonParts } from './pdf.js';
import * as Read from './read.js';
import * as Guides from './guides.js';
import { cardFor, cardBody, creditText } from './liturgy.js';

let live = null;   // the open view: {show, at, count}, for the arrow keys

export function render(container, route) {
  clear(container);
  live = null;
  const s = state.sermons.find(x => x.id === route[1]);
  if (!s) {
    toast(t('That preparation was not found.'), true);
    location.hash = '#sunday';
    return;
  }
  const service = (Guides.findService(s) || {}).service;   // the Guide's article: its introduction gives the cues while the minister's own is empty
  const panes = [];   // {key, name (an English key for t), node}

  // 1 the cue cards, with the text word at their head, as Read under "Print or save" shows them
  const cueArt = Read.article(s, 'cue-view');
  const parts = Read.cueList(s, service);
  if (parts.length || s.text || s.theme || s.core) Read.fillCues(cueArt, s, parts);
  else cueArt.append(empty(t('Nothing on the cards yet: write the main points under Prepare, or type the cues under Print or save.'), `#prepare/${s.id}`, t('Open the preparation')));
  panes.push({ key: 'cues', name: 'Cue cards', node: cueArt });

  // 2 the altar card for this kind of service (the funeral's for a funeral, the wedding's for a wedding, else the Divine Service's)
  const found = cardFor(s.occasion);
  const cardBox = el('div', { class: 'altar-card' });
  if (found.card) {
    cardBox.append(
      el('h1', { class: 'altar-card-title', text: found.card.title, lang: found.l }),
      cardBody(found.card, found.l),
      el('p', { class: 'muted small lit-credit', text: creditText() }),
    );
  } else cardBox.append(empty(t('Load the altar booklet under Handbooks first'), '#liturgy', t('Liturgy')));
  panes.push({ key: 'card', name: 'Altar card', node: cardBox });

  // 3 the sermon itself, for a minister who reads it out, when it is written
  const sp = sermonParts(s);
  if (!sp.empty) {
    const art = Read.article(s);
    Read.fillSermon(art, s, sp);
    panes.push({ key: 'sermon', name: 'The sermon', node: art });
  }

  // the row of panes: one screen wide each, snapping into place
  const row = el('div', { class: 'altar-panes' }, panes.map(p => el('section', { class: 'altar-pane', 'aria-label': t(p.name) }, p.node)));
  let at = 0;
  const names = seg(panes.map(p => [p.key, p.name]), panes[0].key, k => show(panes.findIndex(p => p.key === k)), { label: t('Altar mode') });
  const mark = i => $$('button', names).forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
  function show(i) {
    i = Math.max(0, Math.min(panes.length - 1, i));
    row.scrollTo({ left: i * row.clientWidth, behavior: 'smooth' });
  }
  row.addEventListener('scroll', () => {
    const i = Math.round(row.scrollLeft / Math.max(1, row.clientWidth));
    if (i !== at) { at = i; mark(i); }
  }, { passive: true });
  window.addEventListener('resize', () => row.scrollTo({ left: at * row.clientWidth }), { passive: true });

  // the text size, behind Aa: the reader's sizes, for the readings and the card alike
  const sizes = el('div', { class: 'altar-sizes', hidden: true }, seg(SIZES, state.settings.fontSize || 'm', async v => {
    await saveSetting('fontSize', v);
    for (const n of $$('.read-view, .lit-card', container)) n.className = n.className.replace(/size-\w+/, 'size-' + v);
  }, { block: true, label: t('Text size') }));
  const aa = el('button', { class: 'btn small ghost', type: 'button', text: 'Aa', 'aria-label': t('Text size'), 'aria-expanded': 'false', onclick: () => {
    sizes.hidden = !sizes.hidden;
    aa.setAttribute('aria-expanded', sizes.hidden ? 'false' : 'true');
  } });

  const ref = s.ref ? formatRef(s.ref, state.settings.bookLang) : (s.refText || '');
  const what = [s.date ? fmtDate(s.date, true) : '', ref, s.congregation].filter(Boolean).join(' · ');
  container.append(el('div', { class: 'altar' }, [
    el('div', { class: 'altar-bar' }, [
      el('div', { class: 'altar-top' }, [
        el('a', { class: 'icon altar-close', href: '#sunday', 'aria-label': t('Back to Sunday'), title: t('Back to Sunday'), text: '✕' }),
        el('span', { class: 'altar-what muted small', text: what }),
        aa,
      ]),
      names,
    ]),
    sizes,
    row,
  ]));
  live = { show, get at() { return at; }, count: panes.length };
  keepAwake();
}

/** A pane with nothing to show yet: one line, and the way to the place where it is made. */
function empty(line, href, label) {
  return el('div', { class: 'altar-empty' }, [el('p', { class: 'muted', text: line }), el('a', { class: 'btn small ghost', href, text: label })]);
}

/** The arrow keys move between the panes, as a swipe does, while nothing is being typed. */
document.addEventListener('keydown', e => {
  if (!live || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); live.show(live.at + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); live.show(live.at - 1); }
});

/* ---------------------------------------------------------------- the screen at the altar */

/*
 * The screen stays awake while Altar mode is open, as on a liturgy card
 * (liturgy.js): the browser lets go by itself when the app goes to the
 * background, and is asked again when the app comes back to this screen.
 */
let lock = null;
const here = () => /^#\/?altar\//.test(location.hash);

async function keepAwake() {
  if (lock || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { lock = null; }
}

function letSleep() {
  if (!lock) return;
  lock.release().catch(() => {});
  lock = null;
}

window.addEventListener('hashchange', () => { if (!here()) { letSleep(); live = null; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && here()) keepAwake(); });

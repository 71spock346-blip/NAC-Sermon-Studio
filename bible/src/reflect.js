/*
 * A reflection evening: on a weekday evening the congregation looks back on a
 * divine service that was held, and talks about it, one question at a time.
 * The Church sends a one-page discussion guide for it ("Divine Service
 * Reflections": the sermon's title, its Bible text and the questions).
 *
 * This screen (#prepare/<id>/reflect) makes the slides for such an evening
 * from the preparation of that service: the opening, the sermon and its text
 * word, what we heard (the message and the main points, from the Guide), one
 * slide per question, and the closing. slides.js lays them out in the look
 * the minister chose; here they are shown small to check, shown full screen
 * on the projector or the TV, and saved as a PowerPoint file to take along or
 * change. "Load the reflection guide (PDF)" lets Claude (ai.js) copy the
 * Church's title, text and questions out of the PDF, word for word.
 *
 * The evening is kept with its preparation (s.reflect), so it is saved,
 * backed up and synced with it. What the minister did not change follows the
 * preparation, and the Guide in the language of the slides when that Guide is
 * loaded; what he changed or loaded stays as it is.
 */
import { el, clear, toast, confirmBox, debounce, today, fit, lineBox, busy, seg, download, fmtDate } from './ui.js';
import { t } from './i18n.js';
import { formatRef } from './books.js';
import { state, saveSermon } from './store.js';
import * as Guides from './guides.js';
import * as AI from './ai.js';
import * as S from './slides.js';

const PX = 100;                                   // pixels per inch on a drawn slide: 1333 × 750
const SLIDE_W = S.PAGE.w * PX, SLIDE_H = S.PAGE.h * PX;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/* ---------------------------------------------------------------- what the slides say */

/** The service of a preparation in the Guide of a language (the one it follows, or the same service in the other), or null. */
function serviceIn(s, lang) {
  const link = Guides.findService(s);
  if (!link) return null;
  if (link.guide.language === lang) return link.service;
  const twin = Guides.partnerOf(link.guide, link.i);
  return twin ? twin.service : null;
}

/** The Bible text as the preparation has it, without the number in front of a single verse. */
function prepText(s) {
  const v = (s.text || '').trim();
  const one = s.ref && s.ref.verse && (!s.ref.verseEnd || s.ref.verseEnd === s.ref.verse);
  return one ? v.replace(/^\d{1,3}\s+/, '') : v;
}

/** The evening is today when the service is past, else the day after the service. */
function defaultEvening(date) {
  const now = today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date <= now) return now;
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The first sentence of a text, for a main point that has no heading. */
const firstSentence = v => { const m = String(v || '').trim().match(/^[\s\S]*?[.!?](?=\s|$)/); return (m ? m[0] : String(v || '')).trim(); };

/**
 * The main points for the slide: the Guide's headed parts when the
 * preparation follows a Guide (in the language of the slides when that Guide
 * is loaded), else the headings of the preparation's own points.
 */
export function pointsOf(s, lang) {
  const svc = serviceIn(s, lang) || (Guides.findService(s) || {}).service;
  const fromGuide = svc ? Guides.mainPoints(svc).map(p => p.heading) : [];
  if (fromGuide.length) return { list: fromGuide, guide: true };
  const own = (s.points || []).map(p => ((p && p.heading) || '').trim() || firstSentence(p && p.body).slice(0, 120)).filter(Boolean);
  return { list: own, guide: false };
}

/** The language of the slides: the evening's own choice, else the language of the sermon. */
export const langOf = s => { const l = s.reflect && s.reflect.lang; return l === 'af' || l === 'en' ? l : AI.langOf(s); };

/**
 * What slides.js needs for this evening (see deck there). The evening's own
 * words come first; else, in the sermon's own language, the preparation's;
 * else the Guide's in the language of the slides.
 */
export function input(s) {
  const r = s.reflect || {};
  const lang = langOf(s);
  const own = AI.langOf(s) === lang;
  const svc = serviceIn(s, lang);
  const pick = (mine, prep, guide) => {
    const m = String(mine || '').trim(); if (m) return m;
    const p = String(prep || '').trim(), g = String(guide || '').trim();
    return own ? (p || g) : (g || p);
  };
  const text = pick(r.text, prepText(s), svc && svc.bibleText);
  const prepRef = s.ref ? formatRef(s.ref, lang) : (s.refText || '');
  // the Guide's reference says "(excerpt)" where the text is a part of the verse
  const guideRef = svc && svc.reference && svc.bibleText && text === svc.bibleText.trim() ? svc.reference : '';
  return {
    lang,
    congregation: (s.congregation || state.settings.congregation || '').trim(),
    heading: (r.heading || '').trim(),
    service: S.servicePhrase(r.service || s.occasion, lang),
    serviceDate: s.date || '',
    evening: r.evening || defaultEvening(s.date),
    title: pick(r.title, s.title, svc && svc.title),
    text,
    reference: (r.reference || '').trim() || guideRef || pick('', prepRef, svc && svc.reference),
    message: pick(r.message, s.theme, svc && svc.message),
    points: r.showPoints === false ? [] : pointsOf(s, lang).list,
    questions: (r.questions || []).some(q => (q || '').trim()) ? r.questions : S.QUESTIONS[lang],
    closing: (r.closing || '').trim(),
  };
}

/** "Divine Service Reflections" from "DIVINE SERVICE REFLECTIONS": a heading printed in capitals reads normally on a slide. */
function tidyHeading(v, lang) {
  const h = String(v || '').trim();
  if (!h || h !== h.toUpperCase()) return h;
  const low = h.toLowerCase();
  if (lang === 'af') return low.charAt(0).toUpperCase() + low.slice(1);
  return low.replace(/(^|\s)(\p{L})/gu, (m, sp, c) => sp + c.toUpperCase()).replace(/\s(Of|The|For|And|On|In)\s/g, m => m.toLowerCase());
}

/** Puts what Claude read from the Church's reflection guide into the evening: its title, text, questions and language. */
export function fromGuide(s, g) {
  const r = s.reflect || (s.reflect = {});
  if (g.language === 'en' || g.language === 'af') r.lang = g.language;
  const lang = langOf(s);
  r.heading = tidyHeading(g.heading, lang);
  if (g.service) r.service = g.service;
  if (g.title) r.title = g.title;
  if (g.bibleText) r.text = g.bibleText;
  if (g.reference) r.reference = g.reference;
  if (g.questions && g.questions.length) r.questions = g.questions.slice();
  r.from = { name: g.fileName || '', at: new Date().toISOString(), date: g.date || '' };
  return s;
}

/**
 * Claude reads a reflection guide PDF, with a sheet while it works.
 * Resolves to what ai.js readReflection gives, or null when it was cancelled
 * or failed (the sheet then says why).
 */
export async function readPdf(file) {
  if (!AI.ready()) { Guides.noKey(); return null; }
  const ctrl = new AbortController();
  const b = busy(t('Reading the reflection guide'), () => ctrl.abort());
  b.say(t('Claude is reading the PDF: the title, the text word and the questions. This takes a few seconds.'));
  try {
    const g = await AI.readReflection(file, { signal: ctrl.signal });
    b.done();
    return g;
  } catch (e) {
    if (e && e.name === 'AbortError') { b.done(); return null; }
    b.fail(e.message || t('Claude could not read the PDF.'));
    return null;
  }
}

/** A hidden file box for a PDF; pick() opens it and calls onFile with the file chosen. */
export function pdfPicker(onFile) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) onFile(f); });
  return { input, pick: () => { if (!AI.ready()) { Guides.noKey(); return; } input.click(); } };
}

/** The small mark on a button that asks Claude. */
export function spark() {
  const span = el('span', { class: 'spark', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
  return span;
}

/* ---------------------------------------------------------------- a slide on the screen */

const box = e => `left:${e.x * PX}px;top:${e.y * PX}px;width:${e.w * PX}px;height:${e.h * PX}px;`;
const px = pt => pt * PX / 72;

/** One slide drawn as a page of 1333 × 750 pixels, from the same boxes as the PowerPoint file. */
function slideEl(sl) {
  const root = el('div', { class: `sl sl-${sl.bg}` });
  const em = S.EMBLEM[sl.bg === 'blue' ? 'blue' : 'white'];
  root.append(el('img', { class: 'sl-emblem', src: `icons/emblem-${em.key}.png`, alt: '', style: box(em), draggable: 'false' }));
  for (const e of sl.els) {
    if (e.t === 'card') root.append(el('div', { class: 'sl-card', style: box(e) + `background:#${e.fill}` }));
    else if (e.t === 'circle') root.append(el('div', { class: 'sl-circle', style: box(e) + `background:#${e.fill};color:#${e.color};font-size:${px(e.size)}px`, text: e.text }));
    else if (e.t === 'text') {
      root.append(el('div', {
        class: `sl-t sl-${e.face === 'head' ? 'head' : 'body'}${e.bold ? ' b' : ''} v-${e.valign}`,
        style: box(e) + `font-size:${px(e.size)}px;color:#${e.color};text-align:${e.align};line-height:${(1.22 * (e.line || 1)).toFixed(3)};letter-spacing:${px(e.spacing || 0)}px`,
      }, el('div', { class: 'sl-in', text: e.text })));
    }
  }
  return root;
}

/** Text that came out larger in this browser's letters than in Calibri and Cambria is made smaller until it fits its box. */
function fitSlide(root) {
  for (const box of root.querySelectorAll('.sl-t')) {
    const inner = box.firstChild;
    let size = parseFloat(box.style.fontSize);
    const min = size * 0.7;
    while ((inner.offsetHeight > box.clientHeight + 1 || inner.scrollWidth > box.clientWidth + 1) && size > min) {
      size -= 1;
      box.style.fontSize = size + 'px';
    }
  }
}

/** All the words on a slide, for a screen reader. */
const slideWords = sl => sl.els.filter(e => e.t === 'text').map(e => e.text).join('. ');

/* ---------------------------------------------------------------- the show */

/**
 * The slides full screen, for the projector or the TV. The arrow keys, the
 * space bar, Page Up and Page Down (what a presenter's clicker sends), a tap
 * or a swipe move between them; B makes the screen black; Escape ends.
 */
export function show(slides, start = 0) {
  let i = Math.max(0, Math.min(start, slides.length - 1));
  const opener = document.activeElement;
  const frame = el('div', { class: 'show-frame' });
  const stage = el('div', { class: 'show-stage' }, frame);
  const counter = el('span', { class: 'show-count', 'aria-hidden': 'true' });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
  const black = el('div', { class: 'show-black', hidden: true });
  const btn = (label, text, onclick, cls) => el('button', { type: 'button', class: 'show-btn' + (cls ? ' ' + cls : ''), 'aria-label': label, title: label, text, onclick });
  const prevBtn = btn(t('Previous slide'), '‹', () => go(i - 1));
  const nextBtn = btn(t('Next slide'), '›', () => go(i + 1));
  const fullBtn = document.fullscreenEnabled ? btn(t('Full screen'), '⛶', () => toggleFull()) : null;
  const bar = el('div', { class: 'show-bar' }, [prevBtn, counter, nextBtn, fullBtn, btn(t('End the show'), '✕', () => close(), 'end')].filter(Boolean));
  const root = el('div', { class: 'slideshow', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Slideshow'), tabindex: '-1' }, [stage, black, bar, live]);
  let current = null, lock = null, idle = null;
  let full = false, leaving = false;   // on the full screen; leaving it by the ⛶ button

  function scale() {
    const k = Math.min(root.clientWidth / SLIDE_W, root.clientHeight / SLIDE_H);
    frame.style.width = SLIDE_W * k + 'px';
    frame.style.height = SLIDE_H * k + 'px';
    if (current) current.style.transform = `scale(${k})`;
  }
  function go(n) {
    if (n < 0 || n >= slides.length) return;
    i = n;
    const next = slideEl(slides[i]);
    frame.replaceChildren(next);
    current = next;
    scale();
    fitSlide(next);
    counter.textContent = `${i + 1} / ${slides.length}`;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === slides.length - 1;
    live.textContent = t('Slide {n} of {m}', { n: i + 1, m: slides.length }) + '. ' + slideWords(slides[i]);
  }
  function toggleFull() {
    if (document.fullscreenElement) { leaving = true; document.exitFullscreen().catch(() => { leaving = false; }); }
    else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
  }
  // On the full screen the browser takes Esc for itself and only leaves the full screen: end the show then too, as Esc does in PowerPoint
  function onFull() {
    if (document.fullscreenElement === root) { full = true; return; }
    const ended = full && !leaving;
    full = false; leaving = false;
    if (ended) close();
  }
  function wake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(l => { lock = l; }).catch(() => {});
  }
  const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  function awake() {   // with a mouse the buttons show while it moves and fade when it rests; on a touch screen they stay
    root.classList.remove('idle');
    clearTimeout(idle);
    if (mouse) idle = setTimeout(() => root.classList.add('idle'), 2500);
  }
  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'Tab') {
      const items = [...bar.querySelectorAll('button:not([disabled])')];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      awake();
      return;
    }
    if (k === 'Escape') { e.preventDefault(); if (!black.hidden) { black.hidden = true; return; } close(); return; }
    if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); black.hidden = !black.hidden; return; }
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFull(); return; }
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON' && root.contains(document.activeElement);
    if ((k === ' ' || k === 'Enter') && onButton) return;   // the button itself
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); black.hidden = true; go(i + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { e.preventDefault(); black.hidden = true; go(i - 1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(slides.length - 1); }
  }
  // a tap on the left third goes back, anywhere else on; a swipe goes the way it points
  let touchX = null;
  stage.addEventListener('click', e => {
    if (!black.hidden) { black.hidden = true; return; }
    const r = stage.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 3 ? i - 1 : i + 1);
  });
  black.addEventListener('click', () => { black.hidden = true; });
  stage.addEventListener('touchstart', e => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); go(dx < 0 ? i + 1 : i - 1); }
  });
  const onVisible = () => { if (document.visibilityState === 'visible' && !lock) wake(); };
  const onResize = () => scale();
  function close() {
    document.removeEventListener('fullscreenchange', onFull);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('resize', onResize);
    root.removeEventListener('mousemove', awake);
    clearTimeout(idle);
    if (lock) lock.release().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.remove();
    document.body.classList.remove('showing');
    if (opener && opener.focus && document.contains(opener)) opener.focus();
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFull);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('resize', onResize);
  root.addEventListener('mousemove', awake);
  document.body.classList.add('showing');
  document.body.append(root);
  if (root.requestFullscreen && document.fullscreenEnabled) root.requestFullscreen().catch(() => {});
  wake();
  root.focus();
  go(i);
  awake();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (current) fitSlide(current); });
  return { close, go: n => go(n) };
}

/* ---------------------------------------------------------------- PowerPoint */

let libs = null;
/** The PowerPoint maker (vendor/pptxgen.bundle.js, with JSZip inside), loaded the first time it is needed. */
function loadPptx() {
  if (window.PptxGenJS && window.JSZip) return Promise.resolve();
  if (!libs) {
    libs = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pptxgen.bundle.js?v=1';
      s.onload = () => (window.PptxGenJS ? resolve() : reject(new Error('PptxGenJS')));
      s.onerror = () => reject(new Error('load'));
      document.head.append(s);
    }).catch(() => {
      libs = null;
      throw new Error(t('The PowerPoint maker did not load. Open the app once while online, then try again.'));
    });
  }
  return libs;
}

/** A picture from the app's icons as "image/png;base64,…", as PptxGenJS takes it. */
async function picture(name) {
  const r = await fetch(`icons/${name}`);
  if (!r.ok) throw new Error(t('The emblem could not be read.'));
  const bytes = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  return 'image/png;base64,' + btoa(s);
}

/** The name of the file: "Reflection evening 2026-11-02 - God delivers from great distress.pptx". */
function fileName(inp) {
  const w = S.words(inp.lang);
  const name = [w.evening, inp.evening, '-', inp.title || inp.reference].filter(Boolean).join(' ');
  return name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) + '.pptx';
}

/** The evening's slides as a PowerPoint file: {blob, name}. */
export async function makePptx(s) {
  await loadPptx();
  const inp = input(s);
  const slides = S.deck(inp);
  const [white, blue] = await Promise.all([picture('emblem-white.png'), picture('emblem-blue.png')]);
  const blob = await S.pptx(window.PptxGenJS, window.JSZip, slides, {
    emblems: { white, blue }, lang: inp.lang, author: (state.settings.name || '').trim(),
    title: [S.words(inp.lang).heading, inp.title].filter(Boolean).join(' – '), type: 'blob',
  });
  return { blob, name: fileName(inp) };
}

function canSharePptx() {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pptx', { type: PPTX })] })); } catch (e) { return false; }
}

/* ---------------------------------------------------------------- the screen */

export function render(root, s) {
  clear(root);
  if (!s.reflect || typeof s.reflect !== 'object') s.reflect = {};
  const r = s.reflect;
  const savedBadge = el('span', { class: 'badge', text: t('Saved'), hidden: true });
  const save = debounce(async () => {
    await saveSermon(s);
    savedBadge.hidden = false;
    setTimeout(() => { savedBadge.hidden = true; }, 1500);
  }, 500);
  const redraw = debounce(() => drawPreview(), 300);
  const touch = () => { save(); redraw(); };
  const lang0 = state.settings.bookLang;

  root.append(
    el('div', { class: 'crumbs' }, [el('a', { href: `#prepare/${s.id}`, text: t('‹ Back to the preparation') })]),
    el('div', { class: 'prep-head' }, [el('div', { class: 'docbar' }, [el('h2', { text: t('Reflection evening') }), savedBadge])]));
  const page = el('div', { class: 'page reflect' });
  root.append(page);
  const what = [fmtDate(s.date, true), t(s.occasion || ''), s.ref ? formatRef(s.ref, lang0) : (s.refText || '')].filter(Boolean).join(' · ');
  page.append(el('p', { class: 'muted small', text: t('Slides for the evening when the congregation looks back on this service and talks about it, one question at a time: {what}.', { what: what || t('this service') }) }));

  // ---- show or save, with the slides small underneath
  const grid = el('div', { class: 'sl-grid' });
  const showBtn = el('button', { class: 'btn', type: 'button', text: t('Show the slides'), onclick: () => show(S.deck(input(s)), 0) });
  async function savePptx(how) {
    try {
      const f = await makePptx(s);
      if (how === 'share') {
        const file = new File([f.blob], f.name, { type: PPTX });
        try { await navigator.share({ files: [file], title: f.name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      download(f.blob, f.name);
      toast(t('Saved ') + f.name);
    } catch (e) { toast(e.message || t('The PowerPoint file could not be made.'), true); }
  }
  page.append(
    el('div', { class: 'row reflect-actions' }, [
      showBtn,
      el('button', { class: 'btn ghost', type: 'button', text: t('Save as PowerPoint'), onclick: () => savePptx('download') }),
      canSharePptx() ? el('button', { class: 'btn ghost', type: 'button', text: t('Share'), onclick: () => savePptx('share') }) : null,
    ]),
    grid,
    el('p', { class: 'muted small', text: t('Tap a slide to start the show there. On the big screen the arrow keys, the space bar or a clicker move on, B makes the screen black, Esc ends the show. The PowerPoint file opens in PowerPoint or Google Slides, where you can still change it.') }));

  let shown = [];
  const thumbs = [];
  function drawPreview() {
    shown = S.deck(input(s));
    clear(grid);
    thumbs.length = 0;
    shown.forEach((sl, k) => {
      const slide = slideEl(sl);
      const holder = el('div', { class: 'sl-scale' }, slide);
      const b = el('button', { class: 'sl-thumb', type: 'button', 'aria-label': t('Show from slide {n}: {words}', { n: k + 1, words: slideWords(sl).slice(0, 120) }), onclick: () => show(shown, k) }, [holder, el('span', { class: 'sl-n', 'aria-hidden': 'true', text: String(k + 1) })]);
      grid.append(b);
      thumbs.push(slide);
    });
    scaleThumbs();
    thumbs.forEach(fitSlide);
  }
  function scaleThumbs() {
    for (const slide of thumbs) {
      const w = slide.parentNode.clientWidth;
      if (w) slide.style.transform = `scale(${w / SLIDE_W})`;
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(() => scaleThumbs()).observe(grid);

  // ---- 1. the Church's reflection guide
  const sec = (n, title, hint) => el('div', { class: 'step-head' }, [
    el('span', { class: 'step-n', text: n }),
    el('div', { class: 'step-text' }, [el('h3', { text: title }), hint ? el('p', { class: 'muted small', text: hint }) : null]),
  ]);
  page.append(sec(1, t('The Church\'s reflection guide'), t('The one-page PDF for the evening. Claude copies its title, text word and questions onto the slides, word for word.')));
  const fromLine = el('p', { class: 'small reflect-from' });
  const picker = pdfPicker(async file => {
    const g = await readPdf(file);
    if (!g) return;
    if (g.date && s.date && g.date !== s.date && !await confirmBox(t('This reflection guide looks back on the service of {date}, and this preparation is for {mine}. Use it here anyway?', { date: fmtDate(g.date, true), mine: fmtDate(s.date, true) }), t('Use it'))) return;
    fromGuide(s, g);
    await saveSermon(s);
    toast(t('Taken from the reflection guide: the title, the text word and {n} questions.', { n: (g.questions || []).length }));
    render(root, s);
  });
  page.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn ghost ai-btn', type: 'button', onclick: picker.pick }, [spark(), r.from ? t('Load another reflection guide') : t('Load the reflection guide (PDF)')]),
    picker.input,
  ]), fromLine);
  fromLine.textContent = r.from ? t('Taken from “{name}”, {date}.', { name: r.from.name || 'PDF', date: fmtDate(r.from.at) }) : t('Without it the slides take the title and text from the preparation, and the Church\'s four usual questions.');
  fromLine.classList.toggle('muted', !r.from);

  // ---- 2. what the slides say
  page.append(sec(2, t('What the slides say'), t('Taken from the preparation and the Guide. Change anything here: it changes the slides, not your preparation.')));
  const inputs = {};
  let closing = null;   // the box for the closing words (section 4)
  const title = text => el('span', { class: 'f-title', text });
  /** A box for one of the evening's own words: it shows what the slides use, and keeps what is typed. */
  function field(label, key, opts = {}) {
    const box = opts.rows ? el('textarea', { rows: opts.rows }) : lineBox({});
    box.value = input(s)[key] || '';
    box.addEventListener('input', () => { r[key] = box.value; touch(); });
    box.addEventListener('change', () => { if (!box.value.trim()) { delete r[key]; box.value = input(s)[key] || ''; fit(box); touch(); } });
    inputs[key] = box;
    return el('label', { class: 'f' + (opts.cls ? ' ' + opts.cls : '') }, [title(label), box, opts.hint ? el('span', { class: 'hint muted small', text: opts.hint }) : null]);
  }
  function refill() {   // after the language changes: the boxes not changed by hand follow
    const inp = input(s);
    if (closing) closing.placeholder = S.words(inp.lang).thanks;
    for (const [key, box] of Object.entries(inputs)) {
      if (key === 'evening' || key === 'congregation') continue;
      if (!String(r[key] || '').trim()) { box.value = inp[key] || ''; fit(box); }
    }
  }
  const evening = el('input', { type: 'date', value: input(s).evening });
  evening.addEventListener('change', () => { r.evening = evening.value; touch(); });
  inputs.evening = evening;
  const congregation = el('input', { type: 'text', value: s.congregation || state.settings.congregation || '', placeholder: t('e.g. Phumolong') });
  congregation.addEventListener('input', () => { s.congregation = congregation.value; touch(); });
  inputs.congregation = congregation;
  const langSeg = seg(AI.LANGS, langOf(s), v => {
    const was = langOf(s);
    r.lang = v;
    if (v !== was && (r.questions || []).length) toast(t('Your questions stay as they are. "Use the Church\'s four questions" gives them in the language of the slides.'));
    refill();
    drawQuestions();
    drawPoints();
    touch();
  }, { label: t('Language of the slides') });
  page.append(
    el('div', { class: 'fields two' }, [
      el('div', { class: 'f' }, [title(t('Slides in')), langSeg]),
      el('label', { class: 'f' }, [title(t('Date of the evening')), evening]),
    ]),
    el('label', { class: 'f' }, [title(t('Congregation')), congregation, el('span', { class: 'hint muted small', text: t('On the first and the last slide. It is the congregation of the preparation too.') })]),
    field(t('Title of the sermon'), 'title'),
    field(t('The text word'), 'text', { rows: 3 }),
    field(t('Reference'), 'reference'),
    field(t('The message'), 'message', { rows: 2, hint: t('On the slide "What we heard", beside the main points.') }),
  );
  // the main points: always the Guide's (Jerome's rule), shown here as they go on the slide
  const pointsBox = el('div', { class: 'reflect-points' });
  page.append(pointsBox);
  function drawPoints() {
    clear(pointsBox);
    const { list, guide } = pointsOf(s, langOf(s));
    const on = r.showPoints !== false;
    const check = el('input', { type: 'checkbox', checked: on && list.length ? true : null, disabled: list.length ? null : true });
    check.addEventListener('change', () => { r.showPoints = check.checked; touch(); });
    pointsBox.append(el('label', { class: 'check' }, [check, el('span', { class: 'f-title', text: t('Show the main points on a slide') })]));
    if (!list.length) {
      pointsBox.append(el('p', { class: 'muted small', text: t('This preparation has no main points yet. Take them from the Guide under step 4 of the preparation, and they come onto the slide.') }));
      return;
    }
    pointsBox.append(el('ol', { class: 'reflect-list' }, list.map(p => el('li', { text: p }))),
      el('p', { class: 'muted small', text: guide ? t('From the Divine Service Guide, word for word.') : t('From step 4 of your preparation.') }));
  }
  drawPoints();

  // ---- 3. the questions
  page.append(sec(3, t('The questions'), t('One slide for each question, in this order.')));
  const qBox = el('div', { class: 'reflect-qs' });
  page.append(qBox);
  const current = () => input(s).questions.slice();
  function setQuestions(list) { r.questions = list; touch(); }
  function drawQuestions() {
    clear(qBox);
    const list = current();
    list.forEach((q, k) => {
      const ta = el('textarea', { rows: 2, 'aria-label': t('Question {n}', { n: k + 1 }) });
      ta.value = q;
      ta.addEventListener('input', () => { const l = current(); l[k] = ta.value; setQuestions(l); });
      const move = (d) => { const l = current(); const [x] = l.splice(k, 1); l.splice(k + d, 0, x); setQuestions(l); drawQuestions(); };
      qBox.append(el('div', { class: 'reflect-q' }, [
        el('span', { class: 'step-n small', text: String(k + 1), 'aria-hidden': 'true' }),
        ta,
        el('div', { class: 'reflect-q-tools' }, [
          el('button', { class: 'icon', type: 'button', text: '↑', 'aria-label': t('Move question {n} up', { n: k + 1 }), disabled: k === 0 ? true : null, onclick: () => move(-1) }),
          el('button', { class: 'icon', type: 'button', text: '↓', 'aria-label': t('Move question {n} down', { n: k + 1 }), disabled: k === list.length - 1 ? true : null, onclick: () => move(1) }),
          el('button', { class: 'icon del', type: 'button', text: '✕', 'aria-label': t('Remove question {n}', { n: k + 1 }), onclick: () => {
            const l = current(); const [gone] = l.splice(k, 1); setQuestions(l); drawQuestions();
            toast(t('Question removed.'), false, () => { const l2 = current(); l2.splice(k, 0, gone); setQuestions(l2); drawQuestions(); });
          } }),
        ]),
      ]));
    });
  }
  drawQuestions();
  page.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn small ghost', type: 'button', text: t('Add a question'), onclick: () => {
      const l = current(); l.push(''); setQuestions(l); drawQuestions();
      const all = qBox.querySelectorAll('textarea');
      if (all.length) all[all.length - 1].focus();
    } }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('Use the Church\'s four questions'), onclick: () => {
      const old = r.questions;
      delete r.questions; touch(); drawQuestions();
      toast(t('The Church\'s four questions are back.'), false, () => { r.questions = old; touch(); drawQuestions(); });
    } }),
  ]));

  // ---- 4. the last slide
  page.append(sec(4, t('The last slide'), t('A word of thanks, with the text word to take home.')));
  closing = lineBox({ placeholder: S.words(langOf(s)).thanks });
  closing.value = r.closing || '';
  closing.addEventListener('input', () => { r.closing = closing.value; touch(); });
  page.append(el('label', { class: 'f' }, [title(t('Closing words')), closing]));

  drawPreview();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => thumbs.forEach(fitSlide));
}

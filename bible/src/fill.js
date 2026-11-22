/*
 * The deacons' link: the service record filled in by others (Jerome, 22 Nov
 * 2026: "Can I grant access to my deacons and people [who] just capture this
 * information, a single link or else hidden features").
 *
 * One link, made once on the minister's device (Record: "Let your deacons
 * fill it in") and sent to the deacons on WhatsApp. Opening it shows the
 * service record of the current service and nothing else: no menu, no other
 * part of the app, and nothing of the minister's reaches their phones but
 * that one record. Which service is current, the minister's device decides as
 * the Record tab does (record.js serviceFor: today's, else the last one
 * held); it moves the link on when a newer service is due.
 *
 * The record travels as the sync's parts do (sync.js): locked with a key made
 * from the link's code (PBKDF2, AES-GCM) and kept by the app's own sync
 * server (api/sync) as the part "record" under a hash of the code. The server
 * cannot read it, and the code never reaches it: it stands after the # of the
 * link. Anyone who has the link can fill in the record, so it goes to the
 * deacons only; "Stop the link" deletes the copy on the server, and the link
 * then says it was stopped.
 *
 * Each side keeps what it last agreed with the server (the base). What one
 * side changed since then goes in field by field; when both changed the same
 * field, the server's wins (merge3). On the minister's device the deacons'
 * lines go into the preparation's record, and from there with the sync to his
 * other devices; an open record shows them as they come, the box being typed
 * in excepted.
 */
import { el, clear, toast, sheet, confirmBox, copyText, fmtDate } from './ui.js';
import { t, lang } from './i18n.js';
import { state, saveSetting, saveSermon } from './store.js';
import { newCode } from './sync.js';
import * as Record from './record.js';

const API = 'api/sync';
const PART = 'record';
const OPEN_POLL = 15000;     // ms between looks at the server while a record is open and something is happening, on either side
const QUIET_POLL = 60000;    // once nothing has happened for QUIET_AFTER: the store counts every look
const QUIET_AFTER = 180000;
const IDLE_POLL = 600000;    // the minister's device, with the record not open
const SEND_AFTER = 1200;     // ms after the last keystroke

/** How often to look: every 15 s while something is happening, once a minute after three quiet minutes. */
function pace() {
  let stirred = Date.now(), looked = 0;
  return {
    stir() { stirred = Date.now(); },
    due() {
      const now = Date.now();
      if (now - looked < (now - stirred < QUIET_AFTER ? OPEN_POLL : QUIET_POLL) - 1000) return false;
      looked = now;
      return true;
    },
  };
}

/* ------------------------------------------------------------ the link */

/** The code of a link opened as the address (#fill/<code>), or ''. */
export function codeFromHash(hash = location.hash) {
  const m = /^#\/?fill\/([A-Z2-9]{20})$/.exec(String(hash || '').trim());
  return m ? m[1] : '';
}
/** The link the deacons open. */
export const linkFor = code => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#fill/${code}`;
/** The minister's link, when there is one: {code, at}. */
const link = () => (state.settings.fillLink && state.settings.fillLink.code ? state.settings.fillLink : null);
export const linkOn = () => !!link();

/* ------------------------------------------------------------ the lock */

const keys = new Map();   // code -> {id, key}

async function keysFor(code) {
  if (keys.has(code)) return keys.get(code);
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('nac-study-bible-fill-id-v1:' + code));
  const id = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('nac-study-bible-fill-key-v1'), iterations: 120000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const k = { id, key };
  keys.set(code, k);
  return k;
}

/** JSON -> [1][0][12-byte IV][AES-GCM ciphertext], the part's name bound in, as sync.js seals a part. */
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(PART) }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(14 + ct.length);
  out[0] = 1; out.set(iv, 2); out.set(ct, 14);
  return out;
}
async function unseal(key, bytes) {
  if (bytes.length < 15 || bytes[0] !== 1) throw new Error(t('The record on the server is not in a form this app knows.'));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(2, 14), additionalData: new TextEncoder().encode(PART) }, key, bytes.slice(14));
  } catch (e) {
    throw new Error(t('The record on the server could not be unlocked with this link.'));
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ------------------------------------------------------------ the server */

const bare = v => String(v || '').trim().replace(/^W\//, '');
const etagOf = r => bare(r.headers.get('X-Sync-Etag') || r.headers.get('ETag'));
const offline = e => Object.assign(new Error(t('No connection to the server.')), { offline: true, cause: e });

/** {unchanged} when the server's copy is the one seen (etag), {missing}, {gone} once the link was stopped, else {etag, data}. */
async function fetchSlot(code, etag) {
  const { id, key } = await keysFor(code);
  let r;
  try {
    r = await fetch(`${API}?id=${id}&part=${PART}`, { cache: 'no-store', headers: etag ? { 'X-Sync-If-None-Match': etag } : {} });
  } catch (e) { throw offline(e); }
  if (r.status === 304) return { unchanged: true };
  if (r.status === 404) return { missing: true };
  if (r.status === 410) return { gone: true };
  if (!r.ok) throw new Error(t('The server answered {status}.', { status: r.status }));
  return { etag: etagOf(r), data: await unseal(key, new Uint8Array(await r.arrayBuffer())) };
}

/** Writes the record: over the copy `etag` only, or with none only where there is no copy yet. The new etag, or null when the other side wrote first. */
async function sendSlot(code, data, etag) {
  const { id, key } = await keysFor(code);
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (etag) headers['X-Sync-If-Match'] = etag; else headers['X-Sync-If-None-Match'] = '*';
  let r;
  try {
    r = await fetch(`${API}?id=${id}&part=${PART}`, { method: 'PUT', cache: 'no-store', keepalive: true, headers, body: await seal(key, data) });   // keepalive: a send begun as the phone is put away still arrives
  } catch (e) { throw offline(e); }
  if (r.status === 412 || r.status === 409) return null;
  if (!r.ok) throw new Error(t('The server answered {status}.', { status: r.status }));
  const out = await r.json().catch(() => ({}));
  return bare(out.etag) || etagOf(r);
}

/** Deletes the copy on the server; the link then answers that it was stopped. */
async function deleteSlot(code) {
  const { id } = await keysFor(code);
  let r;
  try { r = await fetch(`${API}?id=${id}`, { method: 'DELETE', cache: 'no-store' }); } catch (e) { throw offline(e); }
  if (!r.ok) throw new Error(t('The server answered {status}.', { status: r.status }));
}

/* ------------------------------------------------------------ the merge */

const full = rec => Record.recordOf({ record: rec || {} });
const paths = rec => Object.entries(rec).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.keys(v).map(x => k + '.' + x) : [k]));
const valueAt = (rec, path) => { const [a, b] = path.split('.'); const v = b ? (rec[a] || {})[b] : rec[a]; return v == null ? '' : String(v); };
const setAt = (rec, path, v) => { const [a, b] = path.split('.'); if (b) rec[a] = { ...(rec[a] || {}), [b]: v }; else rec[a] = v; };
export const same = (a, b) => JSON.stringify(full(a)) === JSON.stringify(full(b));

/**
 * The record from both sides: a field changed on one side only since `base`
 * takes that side's; changed on both, the server's (`theirs`). Without a base
 * (a device that has not seen this link's record before), an empty field
 * takes the other side's and two different entries the server's.
 */
export function merge3(base, mine, theirs) {
  const out = full(mine), th = full(theirs), b = base ? full(base) : null;
  for (const p of paths(out)) {
    const m = valueAt(out, p), x = valueAt(th, p);
    if (m === x) continue;
    if (b) {
      const o = valueAt(b, p);
      if (x !== o) setAt(out, p, x);   // changed there (and here too: the server's)
    } else if (!m.trim() || x.trim()) setAt(out, p, x);
  }
  return out;
}

/* ------------------------------------------------------------ the minister's side */

/** What the deacons' page shows of the service: its head, from the preparation. */
function headOf(s) {
  return { date: s.date || '', congregation: s.congregation || state.settings.congregation || '', occasion: s.occasion || 'Sunday divine service', ref: s.ref || null, refText: s.refText || '' };
}
const recordOrStart = s => (s.record ? Record.recordOf(s) : Record.started(s));
/** What this device last agreed with the server for the link: {code, sid, etag, base, data} (a setting of this device only). */
const seenFor = code => { const x = state.settings.fillSeen; return x && x.code === code ? x : null; };
/** Keeps what was agreed apart from the preparation's own record, which is changed in place (an Apostle's own word sets its Conducted by). */
const keep = (code, sid, etag, base, data) => saveSetting('fillSeen', JSON.parse(JSON.stringify({ code, sid, etag, base, data })));

let view = null;          // the record open on the screen: {sid, el, current(), apply(rec), box()}
let idleTimer = null, openTimer = null, sendTimer = null;
let running = null, tickAgain = false;   // the tick under way: one at a time
const pacer = pace();     // how often the open record looks

/** The record screen of a service (record.js recordView): the deacons' lines show in it as they come, and what is typed there goes to them. */
export function watch(v) {
  view = v;
  pacer.stir();
  clearInterval(openTimer);
  openTimer = setInterval(() => { if (!view || !view.el.isConnected) { clearInterval(openTimer); view = null; return; } if (document.visibilityState === 'visible' && pacer.due()) tick(); }, OPEN_POLL);
  tick();
}

/** The minister typed in a record: once he stops, it goes to the deacons when it is the link's service. */
export function changed(s) {
  if (!linkOn()) return;
  const seen = seenFor(link().code);
  if (seen && seen.sid !== s.id) return;
  pacer.stir();
  clearTimeout(sendTimer);
  sendTimer = setTimeout(tick, SEND_AFTER);
}

/** Puts a service on the link: what the deacons see from now on. */
async function publish(code, s, etag) {
  const data = { v: 1, sid: s.id, head: headOf(s), lang: lang(), record: recordOrStart(s), by: 'minister', at: new Date().toISOString() };
  let tag = await sendSlot(code, data, etag);
  if (!tag && !etag) return null;
  if (!tag) {
    // the copy changed since it was seen: write over the one there now
    const got = await fetchSlot(code, '');
    if (got.gone) return 'gone';
    tag = await sendSlot(code, data, got.missing ? '' : got.etag);
    if (!tag) return null;
  }
  await keep(code, s.id, tag, data.record, data);
  return data;
}

/**
 * One look at the link from the minister's device: the deacons' lines into
 * the preparation's record (and the open screen), what he typed out to
 * them, and the link moved on to a newer service when one is due.
 */
export function tick() {
  if (running) { tickAgain = true; return running; }   // one more once this one is done, so nothing typed meanwhile waits for the next look
  running = once().catch(e => { if (!e.offline) console.warn('fill', e); }).finally(() => {
    running = null;
    if (view && view.el.isConnected && view.box) view.box();   // the box on the open record follows: on, off, or on another service
    if (tickAgain) { tickAgain = false; tick(); }
  });
  return running;
}

async function once() {
  const ln = link();
  if (!ln) return;
  const code = ln.code;
  let seen = seenFor(code);
  for (let round = 0; round < 4; round++) {
    const got = await fetchSlot(code, seen && seen.data ? seen.etag : '');
    if (got.gone) {
      // stopped on another of the minister's devices: this one forgets it too
      if (link() && link().code === code) await saveSetting('fillLink', null);
      return;
    }
    const target = Record.serviceFor();
    if (got.missing) {
      if (target) await publish(code, target, '');
      return;
    }
    const data = got.unchanged ? seen.data : got.data;
    let etag = got.unchanged ? seen.etag : got.etag;
    const day = (data.head && data.head.date) || '';
    const s = state.sermons.find(x => x.id === data.sid);
    const base = seen && seen.sid === data.sid ? seen.base : null;
    // The link's service has left its day: deleted, or moved to the Wednesday by an Apostle's own word. The
    // service now on that day takes the link over, with the deacons' lines (the Apostle's entry, which has the
    // record that was typed); a newer one takes it as usual. A device that never had the service (not synced
    // yet) does not count it as gone.
    const left = s ? (s.date || '') !== day : !!(state.deleted && state.deleted.sermons && state.deleted.sermons[data.sid]);
    if (left && target && target.id !== data.sid && (target.date || '') >= day) {
      if ((target.date || '') === day) {
        const mine = recordOrStart(target);
        const merged = merge3(base, mine, data.record);
        if (!same(merged, mine)) { target.record = merged; await saveSermon(target); }
      }
      await publish(code, target, etag);
      return;
    }
    if (s) {
      const open = view && view.el.isConnected && view.sid === s.id;
      const mine = open ? view.current() : recordOrStart(s);
      const merged = merge3(base, mine, data.record);
      if (!same(merged, mine)) {
        s.record = merged;
        await saveSermon(s);
        pacer.stir();   // the deacons are at it: look again soon
      }
      if (open && !same(merged, mine)) view.apply(merged);
      const head = headOf(s);   // his text word, typed on the Apostle's record, reaches the deacons' heading too
      if (!same(merged, data.record) || JSON.stringify(head) !== JSON.stringify(data.head || {})) {
        const next = { ...data, head, record: merged, by: 'minister', at: new Date().toISOString() };
        const tag = await sendSlot(code, next, etag);
        if (!tag) { seen = { code, sid: data.sid, etag: '', base, data: null }; continue; }   // the deacons wrote first: once more
        await keep(code, s.id, tag, merged, next);
        seen = seenFor(code);
        etag = tag;
      } else if (!seen || seen.etag !== etag || !same(seen.base, merged)) {
        await keep(code, s.id, etag, merged, data);
        seen = seenFor(code);
      }
    }
    // a newer service is due (the next Sunday has come): the link moves on to it. Never back to an older one: a
    // device that has not yet had the newest preparation through the sync would otherwise take the link back.
    if (target && target.id !== data.sid && (target.date || '') > (left ? (s && s.date) || day : day)) await publish(code, target, etag);
    return;
  }
}

/** Starts the looks in the background: at start, when the app comes back to the screen, and every ten minutes. */
export function start() {
  setTimeout(tick, 3000);
  clearInterval(idleTimer);
  idleTimer = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, IDLE_POLL);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { pacer.stir(); tick(); } });
}

/** Makes the link and puts the current service on it; the sheet with the link follows. */
async function makeLink(s) {
  const code = newCode();
  const done = await publish(code, Record.serviceFor() || s, '');
  if (!done || done === 'gone') throw new Error(t('The link could not be made. Try again in a moment.'));
  await saveSetting('fillLink', { code, at: new Date().toISOString() });
  return code;
}

/** Stops the link: the copy on the server goes, the deacons' link says so, and this device forgets it. */
async function stopLink() {
  const ln = link();
  if (!ln) return;
  await deleteSlot(ln.code);
  await saveSetting('fillLink', null);
  await saveSetting('fillSeen', null);
}

/** The words the WhatsApp message carries with the link. */
const message = code => [t('The service record of {congregation}: please open this link and fill it in after the service.', { congregation: state.settings.congregation || t('our congregation') }), linkFor(code)].join('\n');

/** The sheet with the link: send it on WhatsApp, copy it, or stop it. */
function linkSheet(redraw) {
  const ln = link();
  if (!ln) return;
  const sh = sheet(t('The deacons\' link'));
  const url = linkFor(ln.code);
  const seen = seenFor(ln.code);
  const s = seen && state.sermons.find(x => x.id === seen.sid);
  sh.body.append(
    el('p', { text: s ? t('The link shows the service record of {date}. When the next service has come, it moves on to that one by itself.', { date: fmtDate(s.date, true) }) : t('The link shows the service record of the current service: today\'s, or the last one held.') }),
    el('p', { class: 'fill-url', text: url }),
    el('div', { class: 'row' }, [
      el('a', { class: 'btn rem-wa', href: 'https://wa.me/?text=' + encodeURIComponent(message(ln.code)), target: '_blank', rel: 'noreferrer', text: t('Send on WhatsApp') }),
      el('button', { class: 'btn ghost', type: 'button', text: t('Copy the link'), onclick: async () => { toast((await copyText(url)) ? t('Copied.') : t('Could not copy.')); } }),
    ]),
    el('p', { class: 'small muted', text: t('Anyone who has the link can fill in the record, so send it only to your deacons. Stop it if it goes further, or when a deacon leaves; then make a new one.') }),
    el('div', { class: 'row end' }, [
      el('button', { class: 'btn ghost danger', type: 'button', text: t('Stop the link'), onclick: async () => {
        if (!(await confirmBox(t('Stop the link? Your deacons can no longer open it. What they typed stays in your records.'), t('Stop the link'), true))) return;
        try { await stopLink(); sh.close(); toast(t('The link is stopped.')); redraw(); } catch (e) { toast(t('The link could not be stopped: {error}', { error: e.message || e }), true); }
      } }),
    ]),
  );
}

/** The sheet that makes the link: what the deacons see, and who should have it. */
function makeSheet(s, redraw) {
  const sh = sheet(t('Let your deacons fill it in'));
  const go = el('button', { class: 'btn', type: 'button', text: t('Make the link'), onclick: async () => {
    go.disabled = true;
    try {
      await makeLink(s);
      sh.close();
      redraw();
      linkSheet(redraw);
    } catch (e) {
      go.disabled = false;
      toast(e.message || String(e), true);
    }
  } });
  sh.body.append(
    el('p', { text: t('Make one link and send it to your deacons on WhatsApp. When they open it, they see only the service record of the current service: today\'s, or the last one held. Nothing else of the app or of yours reaches their phones.') }),
    el('p', { text: t('What they type comes into your record here, as they type it. You check it and send it to the district as usual.') }),
    el('p', { class: 'small muted', text: t('Anyone who has the link can fill in the record, so send it only to your deacons. You can stop the link at any time.') }),
    el('div', { class: 'row end' }, [el('button', { class: 'btn ghost', type: 'button', text: t('Cancel'), onclick: () => sh.close() }), go]),
  );
}

/** What the box on a record says, in short: drawn again only when this changes. */
export function boxKey(s) {
  const ln = link();
  if (!ln) return 'off';
  const seen = seenFor(ln.code);
  return 'on:' + ln.code + ':' + (seen && seen.sid !== s.id ? seen.sid : '');
}

/** On the minister's record: the way to the deacons' link, and whether it shows this service. */
export function ownerBox(s, redraw) {
  const ln = link();
  if (!ln) {
    return el('div', { class: 'fill-box' }, [
      el('p', { class: 'muted', text: t('Your deacons can fill in the record on their own phones, with a link from you.') }),
      el('button', { class: 'btn small ghost', type: 'button', text: t('Let your deacons fill it in'), onclick: () => makeSheet(s, redraw) }),
    ]);
  }
  const seen = seenFor(ln.code);
  const other = seen && seen.sid !== s.id ? state.sermons.find(x => x.id === seen.sid) : null;
  return el('div', { class: 'fill-box on' }, [
    el('p', { text: other ? t('Your deacons\' link shows the service of {date}.', { date: fmtDate(other.date, true) }) : t('Your deacons\' link is on: what they type comes in here.') }),
    el('button', { class: 'btn small ghost', type: 'button', text: t('The deacons\' link'), onclick: () => linkSheet(redraw) }),
  ]);
}

/* ------------------------------------------------------------ the deacons' page */

/**
 * The page a deacon opens with the link (#fill/<code>, app.js): only the
 * record of the service on the link, sent as it is typed; the minister's
 * changes show in it as they come. Nothing is kept on the deacon's device.
 * One look at the server or one send at a time (busy), so that neither works
 * from what the other has just changed.
 */
export function openPage(container, code, { setLang } = {}) {
  let etag = '', data = null, base = null, page = null, note = null, sentAt = null, shownHead = '';
  let sendT = null, pollT = null, busy = false, chosenLang = false;
  const pacing = pace();
  const status = el('span', { class: 'fill-status small muted', role: 'status' });
  const say = (text, cls = '') => { status.textContent = text; status.className = 'fill-status small ' + (cls || 'muted'); };
  const hhmm = d => d.toLocaleTimeString(lang() === 'af' ? 'af-ZA' : 'en-ZA', { hour: '2-digit', minute: '2-digit' });
  const sayDone = () => say(sentAt ? t('Sent at {time}.', { time: hhmm(sentAt) }) : '');
  /** A page with a word instead of the record (opening, stopped, no record yet); make() gives [title, text, retry], again in the other language on a switch. */
  const notice = make => {
    note = make; page = null;
    const [title, text, retry] = make();
    clear(container);
    container.append(el('div', { class: 'record fill-note' }, [
      el('div', { class: 'docbar' }, [el('h2', { text: title })]),
      el('p', { text }),
      retry ? el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: t('Try again'), onclick: () => load() })]) : null,
    ]));
  };
  const stopped = () => {
    clearInterval(pollT); clearTimeout(sendT); sendT = null; data = null;
    notice(() => [t('This link was stopped'), t('Ask the minister who sent it for a new link.')]);
  };
  const asPrep = d => ({ id: 'fill', ...d.head, record: d.record });
  const typing = () => !!document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  /** The link shows another service on the same day: the one it showed under a new name (an Apostle's own word), not the next service. */
  const sameDay = d => !!(d.head && data && data.head && d.head.date && d.head.date === data.head.date);

  /** The record on the screen: the server's, or `rec` (what was typed, on a change of language). */
  function draw(rec) {
    note = null;
    shownHead = JSON.stringify(data.head || {});
    clear(container);
    page = Record.recordView(container, asPrep({ ...data, record: rec || data.record }), { fill: { status, save: () => { pacing.stir(); clearTimeout(sendT); say(t('Sending…')); sendT = setTimeout(send, SEND_AFTER); } } });
  }

  async function load() {
    notice(() => [t('Service record'), t('Opening the service record…')]);
    let got;
    try { got = await fetchSlot(code, ''); } catch (e) { notice(() => [t('Service record'), t('The service record could not be opened: {error}', { error: e.message || e }), true]); return; }
    if (got.gone) { stopped(); return; }
    if (got.missing) { notice(() => [t('Service record'), t('There is no service record on this link yet. Ask the minister who sent it to open his app once, then try again.'), true]); return; }
    ({ etag, data } = got);
    base = data.record;
    if (!chosenLang && data.lang && setLang && data.lang !== lang()) setLang(data.lang);
    draw();
    sayDone();
    clearInterval(pollT);
    pollT = setInterval(() => { if (document.visibilityState === 'visible' && pacing.due()) poll(); }, OPEN_POLL);
  }

  /** What the minister (or another deacon) changed: into the boxes not being typed in. */
  async function poll() {
    if (!data || !page || busy || sendT) return;
    busy = true;
    let again = false;
    try {
      let got;
      try { got = await fetchSlot(code, etag); } catch (e) { return; }
      if (got.gone) { stopped(); return; }
      if (!got.unchanged && !got.missing) {
        pacing.stir();   // the minister or another deacon is at it: look again soon
        if (got.data.sid !== data.sid && !sameDay(got.data)) {
          // the minister's app moved the link on to the next service
          if (typing()) return;
          ({ etag, data } = got);
          base = data.record;
          sentAt = null;
          draw();
          sayDone();
          toast(t('The link now shows the service of {date}.', { date: fmtDate(data.head.date, true) }));
          return;
        }
        // the same service (on the same day it may have a new name: an Apostle's own word): their lines in, ours kept
        const mine = page.current();
        const merged = merge3(base, mine, got.data.record);
        ({ etag, data } = got);
        base = data.record;
        if (!same(merged, mine)) page.apply(merged);
        again = !same(merged, data.record);   // something typed here that the server has not got yet
      }
      if (JSON.stringify(data.head || {}) !== shownHead && !typing()) draw(page.current());   // the heading changed (his text word): the page again, with what is typed
    } finally { busy = false; }
    if (again) send();
  }

  async function send() {
    sendT = null;
    if (!data || !page) return;
    if (busy) { sendT = setTimeout(send, 500); return; }
    busy = true;
    try {
      for (let round = 0; round < 4; round++) {
        const mine = page.current();
        const merged = merge3(base, mine, data.record);
        if (!same(merged, mine)) page.apply(merged);
        if (same(merged, data.record)) { base = merged; sayDone(); return; }
        const next = { ...data, record: merged, by: 'deacon', at: new Date().toISOString() };
        let tag;
        try { tag = await sendSlot(code, next, etag); } catch (e) { say(e.offline ? t('Not sent yet: no connection. It is sent once there is one.') : t('Not sent: {error}', { error: e.message || e }), 'warn'); sendT = setTimeout(send, 10000); return; }
        if (tag) {
          etag = tag; data = next; base = merged; sentAt = new Date();
          sayDone();
          return;
        }
        // the minister or another deacon wrote first: take theirs in and go again
        let got;
        try { got = await fetchSlot(code, ''); } catch (e) { sendT = setTimeout(send, 10000); return; }
        if (got.gone) { stopped(); return; }
        if (got.missing || (got.data.sid !== data.sid && !sameDay(got.data))) { say(t('Not sent: the link has moved on to another service.'), 'warn'); return; }
        ({ etag, data } = got);   // the base stays what was last agreed: their changes come in through the merge, ours stay
      }
      sendT = setTimeout(send, 3000);   // others kept writing first: once more in a moment
    } finally { busy = false; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { pacing.stir(); poll(); return; }
    if (data && page && !busy) { clearTimeout(sendT); send(); }   // the phone is put away: what is typed goes now, not after the pause
  });
  load();
  return {
    /** The deacon chose the other language: the page again in it, what is typed kept. */
    redraw() {
      chosenLang = true;
      if (!page) { if (note) notice(note); return; }
      const pending = !!sendT;
      draw(page.current());
      if (pending) { say(t('Sending…')); clearTimeout(sendT); sendT = setTimeout(send, SEND_AFTER); } else sayDone();
    },
  };
}

/*
 * How two copies of the same data become one, for sync.js. Pure functions:
 * nothing here touches the database or the screen, so tools/test_merge.mjs
 * can check the rules in Node.
 *
 * The rule throughout is "the newer one wins": every row carries the time it
 * was last changed, and a deletion leaves a marker with the time it happened,
 * so a row deleted on the phone is not brought back by the PC, while a row
 * edited after someone else deleted it comes back. When two copies carry the
 * same time, the local one is kept.
 */

/** Later ISO time wins; a missing time counts as the oldest. */
function later(a, b) { return (a || '') >= (b || '') ? a || '' : b || ''; }

/**
 * Two lists of rows with their deletion markers:
 *   local, remote = { items: [row], deleted: {id: whenDeleted} }
 *   key(row) gives the id, stamp(row) the time the row was last changed.
 * Returns the merged list and markers, what the device must write (put) or
 * remove, and whether the server copy has to be replaced (remoteDiffers).
 */
export function mergeCollection(local, remote, { key, stamp }) {
  const L = new Map((local.items || []).map(r => [key(r), r]));
  const R = new Map((remote.items || []).map(r => [key(r), r]));
  const LD = local.deleted || {}, RD = remote.deleted || {};
  const ids = new Set([...L.keys(), ...R.keys(), ...Object.keys(LD), ...Object.keys(RD)]);
  const items = [], deleted = {}, put = [], remove = [];
  let remoteDiffers = false;
  for (const id of ids) {
    const l = L.get(id), r = R.get(id);
    const newestRow = later(l ? stamp(l) : '', r ? stamp(r) : '');
    const newestDel = later(LD[id], RD[id]);
    if (newestDel && newestDel >= newestRow) {
      // deleted, and not changed since: gone on both sides
      deleted[id] = newestDel;
      if (l) remove.push(id);
      if (r || RD[id] !== newestDel) remoteDiffers = true;
      continue;
    }
    // the row lives: the newer copy, ours on a tie
    const win = l && (!r || stamp(l) >= stamp(r)) ? l : r;
    items.push(win);
    if (win !== l) put.push(win);
    if (!r || stamp(r) !== stamp(win) || RD[id]) remoteDiffers = true;
  }
  return { items, deleted, put, remove, remoteDiffers };
}

/**
 * Settings, one row per key: local, remote = { rows: {key: {value, at}} }.
 * A row without a time (set before sync existed) is the oldest; when the
 * times are equal and the values differ, the one that is not the default
 * wins, so a key entered on one device is not wiped by an empty box on the
 * other, and between two real values the same one is chosen on both devices
 * (the greater as text), so they settle instead of taking turns.
 * Returns the merged rows, the rows to write here, and remoteDiffers.
 */
export function mergeSettings(local, remote, defaults) {
  const L = local.rows || {}, R = remote.rows || {};
  const rows = {}, put = [];
  let remoteDiffers = false;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDefault = (k, v) => k in defaults && same(v, defaults[k]);
  for (const k of new Set([...Object.keys(L), ...Object.keys(R)])) {
    const l = L[k], r = R[k];
    if (!r) { rows[k] = l; remoteDiffers = true; continue; }
    if (!l) { rows[k] = r; put.push({ key: k, ...r }); continue; }
    const la = l.at || '', ra = r.at || '';
    if (ra > la) { rows[k] = r; put.push({ key: k, ...r }); continue; }
    if (la > ra) { rows[k] = l; remoteDiffers = true; continue; }
    if (same(l.value, r.value)) { rows[k] = l; continue; }
    const takeRemote = isDefault(k, l.value) ? !isDefault(k, r.value) : !isDefault(k, r.value) && JSON.stringify(r.value) > JSON.stringify(l.value);
    if (takeRemote) { rows[k] = r; put.push({ key: k, ...r }); continue; }
    rows[k] = l;
    remoteDiffers = true;
  }
  return { rows, put, remoteDiffers };
}

/**
 * One thing that is either there or not, such as the Catechism text:
 * local, remote = { at, present }, where `at` is when it was loaded or
 * removed. Returns 'remote' when the device must take the server's copy,
 * 'local' when the server must take ours, or '' when they agree.
 */
export function mergeSingle(local, remote) {
  const la = local.at || '', ra = remote.at || '';
  if (ra > la) return 'remote';
  if (la > ra) return 'local';
  if (!!local.present === !!remote.present) return '';
  return local.present ? 'local' : 'remote';
}

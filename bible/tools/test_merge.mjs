#!/usr/bin/env node
// Checks the sync merge rules (src/merge.js) without a browser:  node tools/test_merge.mjs
import assert from 'node:assert/strict';
import { mergeCollection, mergeSettings, mergeSingle } from '../src/merge.js';

const opts = { key: r => r.id, stamp: r => r.updated || '' };
const row = (id, updated, text) => ({ id, updated, text: text || id });
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok  ', name); };

test('new rows on either side are kept and the server copy is replaced when ours has more', () => {
  const m = mergeCollection({ items: [row('a', '2026-01-01T00:00:00Z')], deleted: {} }, { items: [row('b', '2026-01-02T00:00:00Z')], deleted: {} }, opts);
  assert.deepEqual(m.items.map(r => r.id).sort(), ['a', 'b']);
  assert.deepEqual(m.put.map(r => r.id), ['b']);
  assert.deepEqual(m.remove, []);
  assert.equal(m.remoteDiffers, true);
});

test('the newer copy of the same row wins, in both directions', () => {
  const m1 = mergeCollection({ items: [row('a', '2026-01-01T00:00:00Z', 'old')], deleted: {} }, { items: [row('a', '2026-01-03T00:00:00Z', 'new')], deleted: {} }, opts);
  assert.equal(m1.items[0].text, 'new');
  assert.equal(m1.put.length, 1);
  assert.equal(m1.remoteDiffers, false);
  const m2 = mergeCollection({ items: [row('a', '2026-01-03T00:00:00Z', 'new')], deleted: {} }, { items: [row('a', '2026-01-01T00:00:00Z', 'old')], deleted: {} }, opts);
  assert.equal(m2.items[0].text, 'new');
  assert.equal(m2.put.length, 0);
  assert.equal(m2.remoteDiffers, true);
});

test('identical copies need nothing', () => {
  const m = mergeCollection({ items: [row('a', '2026-01-01T00:00:00Z')], deleted: {} }, { items: [row('a', '2026-01-01T00:00:00Z')], deleted: {} }, opts);
  assert.equal(m.put.length + m.remove.length, 0);
  assert.equal(m.remoteDiffers, false);
});

test('a deletion on the other device removes the row here', () => {
  const m = mergeCollection({ items: [row('a', '2026-01-01T00:00:00Z')], deleted: {} }, { items: [], deleted: { a: '2026-01-02T00:00:00Z' } }, opts);
  assert.deepEqual(m.items, []);
  assert.deepEqual(m.remove, ['a']);
  assert.equal(m.deleted.a, '2026-01-02T00:00:00Z');
  assert.equal(m.remoteDiffers, false);
});

test('a deletion here is passed on to the server', () => {
  const m = mergeCollection({ items: [], deleted: { a: '2026-01-02T00:00:00Z' } }, { items: [row('a', '2026-01-01T00:00:00Z')], deleted: {} }, opts);
  assert.deepEqual(m.items, []);
  assert.equal(m.remoteDiffers, true);
  assert.equal(m.deleted.a, '2026-01-02T00:00:00Z');
});

test('a row edited after it was deleted elsewhere comes back', () => {
  const m = mergeCollection({ items: [row('a', '2026-01-03T00:00:00Z')], deleted: {} }, { items: [], deleted: { a: '2026-01-02T00:00:00Z' } }, opts);
  assert.equal(m.items.length, 1);
  assert.deepEqual(m.deleted, {});
  assert.equal(m.remoteDiffers, true);
});

test('settings: newer wins, a missing time is the oldest, equal times keep the non-default value', () => {
  const defaults = { name: '', aiKey: '', theme: 'system' };
  const m = mergeSettings(
    { rows: { name: { value: 'Jerome', at: '2026-01-02T00:00:00Z' }, aiKey: { value: '', at: '' }, theme: { value: 'dark', at: '' } } },
    { rows: { name: { value: 'J', at: '2026-01-01T00:00:00Z' }, aiKey: { value: 'sk-ant-x', at: '' }, theme: { value: 'paper', at: '2026-01-01T00:00:00Z' } } },
    defaults);
  assert.equal(m.rows.name.value, 'Jerome');
  assert.equal(m.rows.aiKey.value, 'sk-ant-x');
  assert.equal(m.rows.theme.value, 'paper');
  assert.deepEqual(m.put.map(r => r.key).sort(), ['aiKey', 'theme']);
  assert.equal(m.remoteDiffers, true);
});

test('settings: equal times and two real values settle on the same one from both sides', () => {
  const a = mergeSettings({ rows: { name: { value: 'A', at: '' } } }, { rows: { name: { value: 'B', at: '' } } }, { name: '' });
  const b = mergeSettings({ rows: { name: { value: 'B', at: '' } } }, { rows: { name: { value: 'A', at: '' } } }, { name: '' });
  assert.equal(a.rows.name.value, 'B');
  assert.equal(a.put.length, 1);
  assert.equal(a.remoteDiffers, false);
  assert.equal(b.rows.name.value, 'B');
  assert.equal(b.put.length, 0);
  assert.equal(b.remoteDiffers, true);
});

test('one thing: the later load or removal wins', () => {
  assert.equal(mergeSingle({ at: '', present: false }, { at: '2026-01-01T00:00:00Z', present: true }), 'remote');
  assert.equal(mergeSingle({ at: '2026-01-02T00:00:00Z', present: false }, { at: '2026-01-01T00:00:00Z', present: true }), 'local');
  assert.equal(mergeSingle({ at: '2026-01-01T00:00:00Z', present: true }, { at: '2026-01-01T00:00:00Z', present: true }), '');
  assert.equal(mergeSingle({ at: '', present: false }, { at: '', present: false }), '');
});

console.log(`${n} checks passed`);

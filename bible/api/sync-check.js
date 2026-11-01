/*
 * TEMPORARY, removed again before the merge: drives /api/sync of this very
 * deployment through Vercel's network, the way the browser does, and shows
 * which headers arrive. Under a random id; it tidies up after.
 */
import { randomBytes } from 'node:crypto';
import { list, del } from '@vercel/blob';

const BROWSER = { 'Accept-Encoding': 'gzip, deflate, br, zstd', 'User-Agent': 'Mozilla/5.0 (sync-check)', Accept: '*/*' };

export default async function check(req, res) {
  const base = `https://${process.env.VERCEL_URL}/api/sync`;
  const id = randomBytes(16).toString('hex');
  const q = `id=${id}&part=notes`;
  const steps = [];
  const hit = async (name, want, method, query, headers, body) => {
    try {
      const r = await fetch(`${base}?${query}`, { method, headers: { ...BROWSER, ...(headers || {}) }, body, cache: 'no-store' });
      const buf = Buffer.from(await r.arrayBuffer());
      const row = { name, want, got: r.status, ok: r.status === want, etag: r.headers.get('etag'), xSyncEtag: r.headers.get('x-sync-etag'), encoding: r.headers.get('content-encoding'), type: r.headers.get('content-type'), bytes: buf.length, body: /json/.test(r.headers.get('content-type') || '') ? buf.toString('utf8').slice(0, 160) : '' };
      steps.push(row);
      return row;
    } catch (e) {
      const row = { name, want, got: 'threw', ok: false, body: String(e && e.message || e).slice(0, 300) };
      steps.push(row);
      return row;
    }
  };
  const note = (name, ok, extra) => steps.push({ name, ok, ...extra });
  const blob = randomBytes(2048);
  const jsonEtag = row => { try { return JSON.parse(row.body).etag || ''; } catch { return ''; } };

  // as the copy of the app from before the fix does it: standard headers
  const p1 = await hit('old app: put, create only', 200, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, blob);
  const g1 = await hit('old app: get', 200, 'GET', q);
  note('old app: ETag on the get is the one the put reported', g1.etag === jsonEtag(p1), { put: jsonEtag(p1), getEtag: g1.etag });
  note('old app: the get gives the bytes that were put', g1.bytes === blob.length, { bytes: g1.bytes });
  await hit('old app: put over the copy, ETag from the get', 200, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'If-Match': g1.etag || '-' }, blob);

  // as the fixed app does it: X-Sync-… headers
  const g2 = await hit('new app: get', 200, 'GET', q);
  note('new app: X-Sync-Etag arrives', !!g2.xSyncEtag, { xSyncEtag: g2.xSyncEtag });
  await hit('new app: get unchanged', 304, 'GET', q, { 'X-Sync-If-None-Match': g2.xSyncEtag || '-' });
  const p2 = await hit('new app: put over the copy', 200, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'X-Sync-If-Match': g2.xSyncEtag || '-' }, blob);
  await hit('new app: put over a stale copy', 412, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'X-Sync-If-Match': '"stale"' }, blob);
  await hit('new app: create only on a copy that exists', 409, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'X-Sync-If-None-Match': '*' }, blob);
  const p3 = await hit('new app: put over the copy, etag from the put', 200, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'X-Sync-If-Match': jsonEtag(p2) || '-' }, blob);
  const g3 = await hit('new app: get the newest', 200, 'GET', q);
  note('new app: the get gives the newest copy', !!g3.xSyncEtag && g3.xSyncEtag === jsonEtag(p3), { put: jsonEtag(p3), get: g3.xSyncEtag });
  await hit('delete the copy', 200, 'DELETE', `id=${id}`);
  await hit('get after delete', 410, 'GET', q);
  await hit('new app: fresh start after delete', 200, 'PUT', q, { 'Content-Type': 'application/octet-stream', 'X-Sync-If-None-Match': '*' }, blob);
  await hit('get after the fresh start', 200, 'GET', q);

  let tidied = 0;
  try {
    const r = await list({ prefix: `sync/${id}/` });
    if (r.blobs.length) { await del(r.blobs.map(x => x.url)); tidied = r.blobs.length; }
  } catch (e) { note('tidy up', false, { body: String(e && e.message || e).slice(0, 300) }); }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const newApp = steps.filter(s => !/^old app/.test(s.name));
  res.end(JSON.stringify({ newAppOk: newApp.every(s => s.ok), tidied, steps }, null, 1));
}

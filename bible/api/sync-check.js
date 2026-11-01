/*
 * TEMPORARY, removed again before the merge: runs api/sync.js once against the
 * real Blob store on a preview deployment. It calls the function's own handler
 * through the steps the app uses, under a random id, and tidies up after.
 */
import { randomBytes } from 'node:crypto';
import { list, del } from '@vercel/blob';
import handler from './sync.js';

function call(method, query, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {}, body: '' };
    const req = { method, url: '/api/sync?' + query, headers, body };
    const res = {
      get statusCode() { return out.status; },
      set statusCode(v) { out.status = v; },
      setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
      end(b) { out.body = b ? Buffer.from(b).toString('utf8') : ''; resolve(out); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

export default async function check(req, res) {
  const id = randomBytes(16).toString('hex');
  const q = `id=${id}&part=notes`;
  const steps = [];
  const step = async (name, want, fn) => {
    try {
      const r = await fn();
      steps.push({ name, want, got: r.status, ok: r.status === want, etag: r.headers.etag || '', body: r.body.slice(0, 200) });
      return r;
    } catch (e) {
      steps.push({ name, want, got: 'threw', ok: false, body: String(e && e.message || e).slice(0, 300) });
      return { status: 0, headers: {}, body: '' };
    }
  };
  const same = (name, a, b) => steps.push({ name, ok: a === b, a, b });

  await step('get, nothing there yet', 404, () => call('GET', q));
  const a = await step('put, create only', 200, () => call('PUT', q, { 'if-none-match': '*' }, Buffer.from('one')));
  await step('put, create only again', 409, () => call('PUT', q, { 'if-none-match': '*' }, Buffer.from('two')));
  const g = await step('get', 200, () => call('GET', q));
  same('get gives what was put', g.body, 'one');
  same('etag from put = etag from get', a.headers.etag, g.headers.etag);
  await step('get unchanged, etag from put', 304, () => call('GET', q, { 'if-none-match': a.headers.etag || '-' }));
  await step('get unchanged, etag from get', 304, () => call('GET', q, { 'if-none-match': g.headers.etag || '-' }));
  await step('put over a stale copy', 412, () => call('PUT', q, { 'if-match': '"stale"' }, Buffer.from('three')));
  const b = await step('put over the copy, etag from get', 200, () => call('PUT', q, { 'if-match': g.headers.etag || '-' }, Buffer.from('four')));
  await step('put over the copy, etag from put', 200, () => call('PUT', q, { 'if-match': b.headers.etag || '-' }, Buffer.from('five')));
  const g2 = await step('get the newest', 200, () => call('GET', q));
  same('get gives the newest', g2.body, 'five');
  await step('delete the copy', 200, () => call('DELETE', `id=${id}`));
  await step('get after delete', 410, () => call('GET', q));
  await step('put, fresh start after delete', 200, () => call('PUT', q, { 'if-none-match': '*' }, Buffer.from('six')));
  const g3 = await step('get after fresh start', 200, () => call('GET', q));
  same('get gives the fresh start', g3.body, 'six');

  let tidied = 0;
  try {
    const r = await list({ prefix: `sync/${id}/` });
    if (r.blobs.length) { await del(r.blobs.map(x => x.url)); tidied = r.blobs.length; }
  } catch (e) { steps.push({ name: 'tidy up', ok: false, body: String(e && e.message || e).slice(0, 300) }); }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: steps.every(s => s.ok),
    auth: { storeId: !!process.env.BLOB_STORE_ID, readWriteToken: !!process.env.BLOB_READ_WRITE_TOKEN, oidcHeader: !!(req.headers && req.headers['x-vercel-oidc-token']) },
    tidied,
    steps,
  }, null, 1));
}

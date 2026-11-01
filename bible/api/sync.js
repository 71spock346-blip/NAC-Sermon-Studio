/*
 * The sync server: a locker for the parts that src/sync.js sends.
 *
 * It runs as a Vercel function beside the app (bible/api/ -> /api/sync) and
 * keeps each part as a private blob in Vercel Blob, under
 * sync/<id>/<part>.bin, where <id> is a hash of the person's sync code. The
 * parts are locked (encrypted) on the device before they get here, so this
 * code and the store only ever hold bytes nobody can read without the code.
 *
 *   GET    /api/sync?id=<id>&part=<part>   the part's bytes, with its ETag;
 *                                          If-None-Match -> 304; 404 when none
 *   PUT    /api/sync?id=<id>&part=<part>   stores the bytes; If-Match: <etag>
 *                                          writes only over that copy (else 412),
 *                                          If-None-Match: * only when there is none (else 409)
 *   DELETE /api/sync?id=<id>               removes every part under the id and
 *                                          leaves a marker: a GET for a part now
 *                                          answers 410, so the other devices stop
 *                                          (a PUT with If-None-Match: * clears it)
 *
 * The store is Vercel Blob when a Blob store is connected to the project.
 * Vercel now connects a store by setting BLOB_STORE_ID, and the SDK signs
 * each call with the deployment's own short-lived OIDC token; an older
 * connection sets BLOB_READ_WRITE_TOKEN instead. Either is enough.
 * tools/dev_server.mjs sets SYNC_MEMORY_STORE to keep the parts in memory for
 * local tries. Without any of these the function answers 503
 * {error: 'no-store'} and the app says the storage still has to be switched on.
 */
import { put, get, del, list } from '@vercel/blob';

const ID = /^[0-9a-f]{32}$/;
const PART = /^[a-z]{3,20}$/;
const MAX_BYTES = 4 * 1024 * 1024;

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  if (body === undefined || body === null) { res.end(); return; }
  if (Buffer.isBuffer(body)) { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(body.length)); res.end(body); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** The request body as a Buffer: Vercel has usually read it already (req.body), a plain Node server has not. */
async function readBody(req) {
  const given = req.body;
  if (Buffer.isBuffer(given)) return given;
  if (given instanceof Uint8Array) return Buffer.from(given);
  if (typeof given === 'string') return Buffer.from(given, 'utf8');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES + 1024) throw Object.assign(new Error('too big'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function isConflict(e) {
  const name = e && e.name || '';
  const msg = e && e.message || '';
  return name === 'BlobPreconditionFailedError' || /precondition/i.test(msg) || /already exists/i.test(msg);
}

/* ---- the two stores: Vercel Blob, and memory for a local server ---- */

const blobStore = {
  async get(path, ifNoneMatch) {
    const r = await get(path, { access: 'private', useCache: false, ...(ifNoneMatch ? { ifNoneMatch } : {}) });
    if (!r) return null;
    if (r.statusCode === 304) return { unchanged: true };
    return { etag: r.blob.etag, body: Buffer.from(await new Response(r.stream).arrayBuffer()) };
  },
  async put(path, body, { ifMatch, createOnly }) {
    try {
      const r = await put(path, body, {
        access: 'private', addRandomSuffix: false, contentType: 'application/octet-stream',
        ...(ifMatch ? { ifMatch } : { allowOverwrite: !createOnly }),
      });
      return { etag: r.etag };
    } catch (e) {
      if (isConflict(e)) return { conflict: true };
      throw e;
    }
  },
  async deleteAll(prefix) {
    let cursor, n = 0;
    do {
      const r = await list({ prefix, cursor, limit: 100 });
      if (r.blobs.length) { await del(r.blobs.map(b => b.url)); n += r.blobs.length; }
      cursor = r.cursor;
    } while (cursor);
    return n;
  },
};

const memory = globalThis.__syncMemory || (globalThis.__syncMemory = new Map());
const memoryStore = {
  async get(path, ifNoneMatch) {
    const row = memory.get(path);
    if (!row) return null;
    if (ifNoneMatch && ifNoneMatch === row.etag) return { unchanged: true };
    return { etag: row.etag, body: row.body };
  },
  async put(path, body, { ifMatch, createOnly }) {
    const row = memory.get(path);
    if (ifMatch && (!row || row.etag !== ifMatch)) return { conflict: true };
    if (createOnly && row) return { conflict: true };
    const etag = '"' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)) + '"';
    memory.set(path, { etag, body });
    return { etag };
  },
  async deleteAll(prefix) {
    let n = 0;
    for (const k of [...memory.keys()]) if (k.startsWith(prefix)) { memory.delete(k); n++; }
    return n;
  },
};

function storeFor() {
  if (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  if (process.env.SYNC_MEMORY_STORE) return memoryStore;
  return null;
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  const part = url.searchParams.get('part') || '';
  if (!ID.test(id)) return send(res, 400, { error: 'bad-id' });
  const store = storeFor();
  if (!store) return send(res, 503, { error: 'no-store' });
  const method = (req.method || 'GET').toUpperCase();
  try {
    const prefix = `sync/${id}/`, gone = `${prefix}gone.bin`;
    if (method === 'DELETE' && !part) {
      const n = await store.deleteAll(prefix);
      await store.put(gone, Buffer.from('1'), {});
      return send(res, 200, { deleted: n });
    }
    if (!PART.test(part) || part === 'gone') return send(res, 400, { error: 'bad-part' });
    const path = `${prefix}${part}.bin`;
    if (method === 'GET' || method === 'HEAD') {
      const r = await store.get(path, req.headers['if-none-match'] || '');
      if (!r) return send(res, (await store.get(gone, '')) ? 410 : 404, { error: 'none' });
      if (r.unchanged) return send(res, 304, null);
      return send(res, 200, method === 'HEAD' ? null : r.body, { ETag: r.etag });
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      if (!body.length) return send(res, 400, { error: 'empty' });
      if (body.length > MAX_BYTES) return send(res, 413, { error: 'too-big' });
      const ifMatch = req.headers['if-match'] || '';
      const createOnly = (req.headers['if-none-match'] || '') === '*';
      if (createOnly && await store.get(gone, '')) await store.deleteAll(gone);   // a fresh start under a code that was deleted
      const r = await store.put(path, body, { ifMatch, createOnly });
      if (r.conflict) return send(res, ifMatch ? 412 : 409, { error: 'changed' });
      return send(res, 200, { etag: r.etag }, { ETag: r.etag });
    }
    return send(res, 405, { error: 'method' });
  } catch (e) {
    if (e && e.status === 413) return send(res, 413, { error: 'too-big' });
    console.error('sync', e);
    return send(res, 500, { error: 'server', message: String(e && e.message || e).slice(0, 200) });
  }
}

/*
 * The sync server: a locker for the parts that src/sync.js sends.
 *
 * It runs as a Vercel function beside the app (bible/api/ -> /api/sync) and
 * keeps each part as a private blob in Vercel Blob, under
 * sync/<id>/<part>.bin, where <id> is a hash of the person's sync code. The
 * parts are locked (encrypted) on the device before they get here, so this
 * code and the store only ever hold bytes nobody can read without the code.
 *
 *   GET    /api/sync?id=<id>&part=<part>   the part's bytes, its version in X-Sync-Etag;
 *                                          X-Sync-If-None-Match: <etag> -> 304; 404 when none
 *   PUT    /api/sync?id=<id>&part=<part>   stores the bytes; X-Sync-If-Match: <etag>
 *                                          writes only over that copy (else 412),
 *                                          X-Sync-If-None-Match: * only when there is none (else 409)
 *   DELETE /api/sync?id=<id>               removes every part under the id and
 *                                          leaves a marker: a GET for a part now
 *                                          answers 410, so the other devices stop
 *                                          (a PUT with X-Sync-If-None-Match: * clears it)
 *
 * The version travels in headers of the app's own (X-Sync-…), not in ETag,
 * If-Match and If-None-Match: Vercel's network in front of the function may
 * change a standard ETag on its way to the browser, and a changed ETag sent
 * back in If-Match never matches, so every write from that device was turned
 * away as a conflict. The standard headers are still read, with a weak W/
 * taken off, for a copy of the app from before this change.
 *
 * Reading a blob is tried three times when the store answers with a server
 * error, which it sometimes does when many parts come at once; the SDK's
 * other calls retry on their own.
 *
 * The store is Vercel Blob when a Blob store is connected to the project.
 * Vercel now connects a store by setting BLOB_STORE_ID, and the SDK signs
 * each call with the deployment's own short-lived OIDC token; an older
 * connection sets BLOB_READ_WRITE_TOKEN instead. Either is enough.
 * tools/dev_server.mjs sets SYNC_MEMORY_STORE to keep the parts in memory for
 * local tries. Without any of these the function answers 503
 * {error: 'no-store'} and the app says the storage still has to be switched on.
 */
import { put, get, head, del, list, BlobNotFoundError } from '@vercel/blob';

const ID = /^[0-9a-f]{32}$/;
const PART = /^[a-z]{3,20}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const RETRY_MS = [200, 600];

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  if (body === undefined || body === null) { res.end(); return; }
  if (Buffer.isBuffer(body)) { res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(body.length)); res.end(body); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** The version headers of a reply: the app reads X-Sync-Etag; ETag stays for a copy of the app from before. */
function versionHeaders(etag) { return { 'X-Sync-Etag': etag, ETag: etag }; }

/** An ETag as the store wrote it: a weak W/ that something on the way added is taken off. */
function bare(v) { return String(v || '').trim().replace(/^W\//, ''); }

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

/** A server error from the store or a dropped connection: worth another try. */
function isPassing(e) {
  const msg = String(e && e.message || e || '');
  return /\b5\d\d\b/.test(msg) || /fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated/i.test(msg);
}

async function tryAgain(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= RETRY_MS.length || !isPassing(e)) throw e;
      await new Promise(r => setTimeout(r, RETRY_MS[i]));
    }
  }
}

/* ---- the two stores: Vercel Blob, and memory for a local server ---- */

const blobStore = {
  async get(path, ifNoneMatch) {
    const r = await tryAgain(() => get(path, { access: 'private', useCache: false, ...(ifNoneMatch ? { ifNoneMatch } : {}) }));
    if (!r) return null;
    if (r.statusCode === 304) return { unchanged: true };
    return { etag: bare(r.blob.etag), body: Buffer.from(await new Response(r.stream).arrayBuffer()) };
  },
  async exists(path) {
    try { await head(path); return true; }
    catch (e) {
      if (e instanceof BlobNotFoundError || (e && e.name === 'BlobNotFoundError') || /does not exist|not found/i.test(e && e.message || '')) return false;
      throw e;
    }
  },
  async put(path, body, { ifMatch, createOnly }) {
    try {
      const r = await put(path, body, {
        access: 'private', addRandomSuffix: false, contentType: 'application/octet-stream',
        ...(ifMatch ? { ifMatch } : { allowOverwrite: !createOnly }),
      });
      return { etag: bare(r.etag) };
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
  async exists(path) { return memory.has(path); },
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
  const h = req.headers || {};
  const ifMatch = bare(h['x-sync-if-match'] || h['if-match']);
  const ifNoneMatch = String(h['x-sync-if-none-match'] || h['if-none-match'] || '').trim();
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
      const r = await store.get(path, ifNoneMatch === '*' ? '' : bare(ifNoneMatch));
      if (!r) return send(res, (await store.exists(gone)) ? 410 : 404, { error: 'none' });
      if (r.unchanged) return send(res, 304, null);
      return send(res, 200, method === 'HEAD' ? null : r.body, versionHeaders(r.etag));
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      if (!body.length) return send(res, 400, { error: 'empty' });
      if (body.length > MAX_BYTES) return send(res, 413, { error: 'too-big' });
      const createOnly = !ifMatch && ifNoneMatch === '*';
      if (createOnly && await store.exists(gone)) await store.deleteAll(gone);   // a fresh start under a code that was deleted
      const r = await store.put(path, body, { ifMatch, createOnly });
      if (r.conflict) return send(res, ifMatch ? 412 : 409, { error: 'changed' });
      return send(res, 200, { etag: r.etag }, versionHeaders(r.etag));
    }
    return send(res, 405, { error: 'method' });
  } catch (e) {
    if (e && e.status === 413) return send(res, 413, { error: 'too-big' });
    console.error('sync', e);
    return send(res, 500, { error: 'server', message: String(e && e.message || e).slice(0, 200) });
  }
}

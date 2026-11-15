/*
 * The month plan's calendar feed: a small locker beside the sync server.
 *
 * The app writes the congregation's plan as an iCalendar file here, and
 * Google Calendar (or any calendar app) follows the file's address, so the
 * services and the district's events appear in the rector's calendar and
 * stay right when the plan changes, without a Google account for the app.
 *
 *   GET    /api/plan?id=<id>   the feed, text/calendar; 404 when none
 *   PUT    /api/plan?id=<id>   stores the feed; needs X-Plan-Key: <key>,
 *                              where <id> is the first 32 hex digits of the
 *                              key's SHA-256, else 403
 *   DELETE /api/plan?id=<id>   removes it, with the same header
 *
 * The id is what the calendar fetches by: it says nothing about the key, so
 * knowing the feed's address does not let anyone change it. The feed is
 * public to whoever has the address (a long random id), as a calendar
 * subscription must be: it holds dates, names and the district's notes, no
 * phone numbers and no keys.
 *
 * The store is Vercel Blob when a store is connected to the project
 * (BLOB_STORE_ID with the deployment's token, or BLOB_READ_WRITE_TOKEN), as
 * for api/sync.js; tools/dev_server.mjs sets SYNC_MEMORY_STORE to keep feeds
 * in memory for local tries.
 */
import { createHash } from 'node:crypto';
import { put, get, del, BlobNotFoundError } from '@vercel/blob';

const ID = /^[0-9a-f]{32}$/;
const MAX_BYTES = 1024 * 1024;

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (body === undefined || body === null) { res.end(); return; }
  if (Buffer.isBuffer(body)) {
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

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

const notFound = e => e instanceof BlobNotFoundError || (e && e.name === 'BlobNotFoundError') || /does not exist|not found/i.test(e && e.message || '');

const blobStore = {
  async get(path) {
    try {
      const r = await get(path, { access: 'private', useCache: false });
      return r ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null;
    } catch (e) { if (notFound(e)) return null; throw e; }
  },
  async put(path, body) {
    await put(path, body, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/calendar' });
  },
  async del(path) {
    try { await del(path); } catch (e) { if (!notFound(e)) throw e; }
  },
};

const memory = globalThis.__planMemory || (globalThis.__planMemory = new Map());
const memoryStore = {
  async get(path) { return memory.get(path) || null; },
  async put(path, body) { memory.set(path, body); },
  async del(path) { memory.delete(path); },
};

function storeFor() {
  if (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN) return blobStore;
  if (process.env.SYNC_MEMORY_STORE) return memoryStore;
  return null;
}

/** The id a key gives: the first half of its SHA-256, in hex. The app works it out the same way (plan.js). */
export function idOf(key) {
  return createHash('sha256').update(String(key), 'utf8').digest('hex').slice(0, 32);
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!ID.test(id)) return send(res, 400, { error: 'bad-id' });
  const store = storeFor();
  if (!store) return send(res, 503, { error: 'no-store' });
  const method = (req.method || 'GET').toUpperCase();
  const path = `plan/${id}.ics`;
  try {
    if (method === 'GET' || method === 'HEAD') {
      const body = await store.get(path);
      if (!body) return send(res, 404, { error: 'none' });
      return send(res, 200, method === 'HEAD' ? null : body, 'text/calendar; charset=utf-8');
    }
    if (method === 'PUT' || method === 'DELETE') {
      const key = String((req.headers || {})['x-plan-key'] || '').trim();
      if (!key || idOf(key) !== id) return send(res, 403, { error: 'key' });
      if (method === 'DELETE') { await store.del(path); return send(res, 200, { deleted: true }); }
      const body = await readBody(req);
      if (!body.length) return send(res, 400, { error: 'empty' });
      if (body.length > MAX_BYTES) return send(res, 413, { error: 'too-big' });
      if (!/^BEGIN:VCALENDAR/.test(body.toString('utf8', 0, 20))) return send(res, 400, { error: 'not-a-calendar' });
      await store.put(path, body);
      return send(res, 200, { ok: true, bytes: body.length });
    }
    return send(res, 405, { error: 'method' });
  } catch (e) {
    if (e && e.status === 413) return send(res, 413, { error: 'too-big' });
    console.error('plan', e);
    return send(res, 500, { error: 'server', message: String(e && e.message || e).slice(0, 200) });
  }
}

#!/usr/bin/env node
/*
 * Serves the app from this folder with the sync function, the month plan's
 * calendar feed and the deacons' link page (api/record.js, reached by the
 * rewrites in vercel.json, as on Vercel) alive, for trying them on one
 * machine:  node tools/dev_server.mjs [port]  (from bible/)
 * Open http://localhost:8787 in two browser windows (one private, so they are
 * two "devices"), turn sync on in one and join from the other. The parts are
 * kept in memory and are gone when the server stops; nothing reaches Vercel.
 * Needs `npm install` once in bible/ for the function's dependency.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SYNC_MEMORY_STORE = '1';
const { default: sync } = await import('../api/sync.js');
const { default: plan } = await import('../api/plan.js');
const { default: record } = await import('../api/record.js');
const API = { '/api/sync': sync, '/api/plan': plan, '/api/record': record };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// vercel.json's rewrites, done as Vercel does them: /service-record/:name -> /api/record?lang=en&name=:name
const REWRITES = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || []).map(r => {
  const keys = [];
  const re = new RegExp('^' + r.source.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { re, keys, to: r.destination };
});
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  let url = new URL(req.url, 'http://localhost');
  for (const r of REWRITES) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    let to = r.to;
    r.keys.forEach((k, i) => { to = to.replace(':' + k, m[i + 1]); });
    req.url = to;
    url = new URL(to, 'http://localhost');
    break;
  }
  if (API[url.pathname]) return API[url.pathname](req, res);
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Study Bible with sync at http://localhost:${PORT} (parts kept in memory)`));

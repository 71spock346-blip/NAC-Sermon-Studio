/*
 * Offline support. A minister opens this in the pulpit or on a train, so the
 * app has to load without the network.
 *
 * The shell is fetched network-first: online you always get the build that is
 * deployed. The Bible texts, the Catechism index, the PDF library and the
 * icons are fetched cache-first, since they are large and change rarely; the
 * Settings tab can fetch all of the texts once so the whole Bible is on the
 * device. Requests to API.Bible are not touched here: bible.js keeps those
 * chapters in IndexedDB for 30 days.
 */
var VERSION = 'bible-2026-10-26h';
var SHELL = [
  './',
  'index.html',
  'help.html',
  'manifest.json',
  'styles.css?v=1',
  'src/app.js?v=1',
  'src/ui.js',
  'src/books.js',
  'src/store.js',
  'src/bible.js',
  'src/catechism.js',
  'src/reader.js',
  'src/notes.js',
  'src/prepare.js',
  'src/pdf.js',
  'src/settings.js',
  'vendor/jspdf.umd.min.js?v=1',
  'data/kjv/index.json',
  'data/web/index.json',
  'data/catechism.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];
// Big and slow to change: worth keeping rather than re-fetching.
var CACHE_FIRST = /(vendor\/|icons\/|data\/)/;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === VERSION ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function fromCache(req) {
  return caches.match(req).then(function (hit) {
    return hit || caches.match(req, { ignoreSearch: true });
  });
}
function store(req, res) {
  if (res && res.ok && res.type === 'basic') {
    var copy = res.clone();
    caches.open(VERSION).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (CACHE_FIRST.test(req.url)) {
    e.respondWith(
      fromCache(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { return store(req, res); });
      })
    );
    return;
  }
  e.respondWith(
    fetch(req)
      .then(function (res) { return store(req, res); })
      .catch(function () {
        return fromCache(req).then(function (hit) {
          return hit || (req.mode === 'navigate' ? fromCache('index.html') : Response.error());
        });
      })
  );
});

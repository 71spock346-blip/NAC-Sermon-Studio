/*
 * Offline support. A conductor opens this in a church hall with one bar of
 * signal, so the app has to load without the network.
 *
 * The shell is fetched network-first: online you always get the build that is
 * deployed, which matters because a stale copy of this app is very hard to tell
 * apart from a bug. The library and the artwork are fetched cache-first, since
 * they are large and change only when their name does.
 */
var VERSION = 'choir-2026-09-04i';
var SHELL = [
  './',
  'index.html',
  'help.html',
  'manifest.json',
  'styles.css?v=7',
  'src/hymns.js?v=7',
  'src/library.js?v=7',
  'src/model.js?v=7',
  'src/pdf.js?v=7',
  'src/app.js?v=7',
  'vendor/jspdf.umd.min.js?v=7',
  'icons/emblem-print.png?v=7',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];
// Big and named by their content: worth keeping rather than re-fetching.
var CACHE_FIRST = /(vendor\/|icons\/|src\/hymns\.js)/;

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
          // a navigation with nothing cached for it still opens the app
          return hit || (req.mode === 'navigate' ? fromCache('index.html') : Response.error());
        });
      })
  );
});

/*
 * Offline support. A minister opens this in the pulpit or on a train, so the
 * app has to load without the network.
 *
 * The shell is fetched network-first: online you always get the build that is
 * deployed. The Bible texts, the Catechism index, the PDF library and the
 * icons are fetched cache-first, since they are large and change rarely; the
 * Settings tab can fetch all of the texts once so the whole Bible is on the
 * device. Requests to API.Bible are not touched here: bible.js keeps those
 * chapters in IndexedDB for 30 days. Nor is the app's own sync server
 * (/api/sync): its answers must always be fresh, so the browser goes to the
 * network for them, and offline the sync simply waits.
 */
var VERSION = 'bible-2026-11-03b';
var SHELL = [
  './',
  'index.html',
  'help.html',
  'manifest.json',
  'styles.css?v=39',
  'src/app.js?v=39',
  'src/i18n.js',
  'src/af.js',
  'src/ui.js',
  'src/books.js',
  'src/store.js',
  'src/bible.js',
  'src/catechism.js',
  'src/theology.js',
  'src/reader.js',
  'src/paste.js',
  'src/notes.js',
  'src/prepare.js',
  'src/pdf.js',
  'src/settings.js',
  'src/ai.js',
  'src/guides.js',
  'src/sync.js',
  'src/merge.js',
  'src/reflect.js',
  'src/slides.js',
  'vendor/jspdf.umd.min.js?v=1',
  'vendor/qrcode.mjs',
  'vendor/pptxgen.bundle.js?v=1',
  'vendor/fonts/montserrat-latin-wght-normal.woff2',
  'vendor/fonts/montserrat-latin-wght-italic.woff2',
  // the look-alikes of Cambria and Calibri, for the slides of a reflection evening on a device without them
  'vendor/fonts/caladea-latin-400.woff2',
  'vendor/fonts/caladea-latin-700.woff2',
  'vendor/fonts/caladea-latin-400-italic.woff2',
  'vendor/fonts/caladea-latin-700-italic.woff2',
  'vendor/fonts/carlito-latin-400.woff2',
  'vendor/fonts/carlito-latin-700.woff2',
  'vendor/fonts/carlito-latin-400-italic.woff2',
  'vendor/fonts/carlito-latin-700-italic.woff2',
  'data/kjv/index.json',
  'data/web/index.json',
  'data/catechism.json',
  // the short introduction to every book of the Bible (theology.js), in English and Afrikaans
  'data/theology/en.json',
  'data/theology/af.json',
  'icons/emblem.svg',
  'icons/emblem-line.svg',
  'icons/emblem-white.png',
  'icons/emblem-blue.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
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
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/api\//.test(url.pathname)) return;

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

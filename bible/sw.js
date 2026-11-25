/*
 * Offline support. A minister opens this in the pulpit or on a train, so the
 * app has to load without the network.
 *
 * The shell is fetched network-first: online you always get the build that is
 * deployed. The Bible texts, the Catechism index, the PDF library and the
 * icons are fetched cache-first, since they are large and change rarely; the
 * Settings tab can fetch all of the texts once so the whole Bible is on the
 * device. The books of the two Bibles are kept in a cache of their own
 * (TEXTS), which a new version of the app does not throw away: the search
 * reads the whole Bible, and it should have to be fetched once, not after
 * every update. Requests to API.Bible are not touched here: bible.js keeps those
 * chapters in IndexedDB for 30 days. Nor is the app's own sync server
 * (/api/sync, and the month plan's feed /api/plan): its answers must always be fresh, so the browser goes to the
 * network for them, and offline the sync simply waits.
 *
 * One request is not a page or a file of the app: the POST that the phone's
 * share sheet sends when a file is shared to the installed app (manifest.json
 * share_target), the Guide file another minister sent over WhatsApp. The file
 * is kept in a small cache of its own (SHARED) and the browser is sent on to
 * Church files, which takes it from there (files.js takeShared).
 */
var VERSION = 'bible-2026-11-25e';
var SHELL = [
  './',
  'index.html',
  'help.html',
  'manifest.json',
  'styles.css?v=120',
  'src/app.js?v=120',
  'src/i18n.js',
  'src/af.js',
  'src/ui.js',
  'src/books.js',
  'src/store.js',
  'src/bible.js',
  'src/catechism.js',
  'src/catechism-pdf.js',
  'src/theology.js',
  'src/reader.js',
  'src/search.js',
  'src/search-lib.js',
  'src/paste.js',
  'src/notes.js',
  'src/prepare.js',
  'src/pdf.js',
  'src/cues.js',
  'src/read.js',
  'src/verses.js',
  'src/plain.js',
  'src/settings.js',
  'src/ai.js',
  'src/speech.js',
  'src/listen.js',
  'src/say.js',
  'src/lock.js',
  'src/guides.js',
  'src/sync.js',
  'src/merge.js',
  'src/reflect.js',
  'src/slides.js',
  'src/liturgy.js',
  'src/booklet.js',
  'src/catq.js',
  'src/handbook.js',
  'src/handbooks.js',
  'src/handbook-pdf.js',
  'src/files.js',
  'src/ask.js',
  'src/creed.js',
  'src/update.js',
  'src/more.js',
  'src/tools.js',
  'src/welcome.js',
  'src/join.js',
  'src/hymns.js',
  'src/prepfile.js',
  'src/pack.js',
  'src/sunday.js',
  'src/apostle.js',
  'src/altar.js',
  'src/record.js',
  'src/fill.js',
  'src/record-form.js',
  'src/mis.js',
  'src/seating.js',
  'src/seating-layouts.js',
  'src/seating-editor.js',
  'src/seating-pdf.js',
  'src/choir.js',
  'src/choir-app.js',
  'src/choir-markup.js',
  'src/choir-hymns.js',
  'src/choir-library.js',
  'src/choir-model.js',
  'src/choir-pdf.js',
  'src/reminders.js',
  'src/reminders-lib.js',
  'src/reminders-templates.js',
  'src/reminders-ics.js',
  'src/reminders-sheet.js',
  'src/plan.js',
  'src/plan-lib.js',
  'src/plan-xlsx.js',
  'src/plan-pdf.js',
  // pdf.js (vendor/pdfjs/) is fetched the first time a booklet is loaded and kept from then on (cache-first)
  'vendor/jspdf.umd.min.js?v=1',
  'vendor/qrcode.mjs',
  'vendor/pptxgen.bundle.js?v=1',
  // the spreadsheet libraries are fetched the first time a sheet is made or read, and kept from then on (cache-first)
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
  'icons/emblem.svg?v=2',
  'icons/emblem-line.svg',
  'icons/emblem-white.png',
  'icons/emblem-blue.png',
  'icons/icon-192.png?v=2',
  'icons/icon-512.png?v=2',
  'icons/icon-maskable-512.png?v=2',
  'icons/apple-touch-icon.png?v=2'
];
// Big and slow to change: worth keeping rather than re-fetching.
var CACHE_FIRST = /(vendor\/|icons\/|data\/)/;
// The books of the built-in Bibles (data/kjv/GEN.json ...) stay on the device from one version of the app to the next.
// Give TEXTS a new name whenever one of those files changes: that is what makes the devices fetch the texts again.
var TEXTS = 'bible-texts-1';
var IS_TEXT = /\/data\/(?:kjv|web)\/[A-Z0-9]+\.json$/;
// A file shared to the app waits here for the page (one at a time; files.js takes it out).
var SHARED = 'bible-shared';

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
        var old = keys.filter(function (k) { return k !== VERSION && k !== TEXTS && k !== SHARED; });
        // the books an older version kept in its own cache move to TEXTS before that cache goes
        return Promise.all(old.map(keepTexts)).then(function () {
          return Promise.all(old.map(function (k) { return caches.delete(k); }));
        });
      })
      .then(function () { return self.clients.claim(); })
  );
});

/** Copies the Bible's books from an older cache into TEXTS. A book that cannot be copied is simply fetched again when it is asked for. */
function keepTexts(name) {
  return Promise.all([caches.open(name), caches.open(TEXTS)]).then(function (pair) {
    var from = pair[0], to = pair[1];
    return from.keys().then(function (reqs) {
      return Promise.all(reqs.filter(isText).map(function (req) {
        return from.match(req).then(function (res) { return res ? to.put(req, res) : null; });
      }));
    });
  }).catch(function () {});
}
function isText(req) {
  return IS_TEXT.test(new URL(req.url).pathname);
}

function fromCache(req) {
  return caches.match(req).then(function (hit) {
    return hit || caches.match(req, { ignoreSearch: true });
  });
}
function store(req, res) {
  if (res && res.ok && res.type === 'basic') {
    var copy = res.clone();
    caches.open(isText(req) ? TEXTS : VERSION).then(function (c) { c.put(req, copy); });
  }
  return res;
}

/**
 * A file shared to the installed app: the share sheet POSTs it to ./share.
 * The file goes into SHARED and the browser on to Church files, where it is
 * loaded; without a file, or if the file could not be kept, to Church files
 * all the same, so the person is never left on an empty page.
 */
function keepShared(req) {
  var home = new URL('index.html', self.registration.scope).href;
  return req.formData()
    .then(function (form) {
      var file = form.get('file');
      if (!file || typeof file === 'string') throw new Error('no file');
      var headers = { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || '') };
      return caches.open(SHARED).then(function (c) { return c.put('shared-file', new Response(file, { headers: headers })); });
    })
    .then(function () { return Response.redirect(home + '#files/shared', 303); },
      function () { return Response.redirect(home + '#files', 303); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && /\/share$/.test(url.pathname)) {
    e.respondWith(keepShared(req));
    return;
  }
  if (req.method !== 'GET') return;
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

# NAC Study Bible

A personal study bible for a New Apostolic Church minister: Scripture in several
translations, the person's own notes on verses, an index of where the Catechism of
the New Apostolic Church refers to each verse, and a guided path from a text word to
a divine service with printable sermon notes and a cue card.

Like the other apps in this repository it is a static site: no build step, no
server, no login. It is built from the `bible/` folder as its own Vercel project.
On a phone, open the link and use "Add to Home Screen". The user manual is
`help.html` (the Help button in the app).

## How it works

- **Texts.** Two public-domain translations are bundled as JSON in `data/`: the King
  James Version with the Apocrypha (`data/kjv/`) and the World English Bible with the
  Deuterocanon (`data/web/`). One file per book, `{"chapters": [[verse, ...], ...]}`,
  plus an `index.json` with chapter counts and the copyright line.
- **Licensed translations.** The NKJV and the Afrikaans Bibles are copyrighted and
  are not in the repository. `src/bible.js` reads them live from two services with
  the person's own keys, which live in the app's Settings on the device and are
  never exported: [API.Bible](https://scripture.api.bible) (chapter text with verse
  markers; cached 30 days as its terms allow, with the FUMS beacon and attribution
  they require) and the [YouVersion Platform](https://platform.youversion.com)
  (chapter HTML parsed into verses by `parseYvHtml`; cached 7 days). Without a key
  the reader links to the same chapter on YouVersion and BibleGateway.
- **Catechism.** `data/catechism.json` is an index only: section numbers, titles,
  the id of each section's page at nak.org, and the Bible verses each section quotes.
  The text is read on nak.org.
- **Storage.** Notes, preparations and settings live in IndexedDB on the device
  (`src/store.js`). Settings → Backup exports and merges a JSON file.
- **Offline.** `sw.js` serves the shell network-first and the texts, library and
  icons cache-first. Settings → Offline fetches all texts once.
- **PDF.** `src/pdf.js` draws the sermon notes (A4) and the cue card (A5 landscape)
  with the vendored jsPDF.

## Files

- `index.html`, `styles.css`, `help.html`, `manifest.json`, `sw.js` – the page
- `src/app.js` – start-up and the hash router (`#read/PSA/130/7`, `#notes`,
  `#prepare/<id>`, `#catechism/3.4.1`, `#settings`)
- `src/books.js` – the 80 books, English and Afrikaans names, reference parsing
- `src/store.js` – IndexedDB, in-memory state, backup
- `src/bible.js` – bundled texts, API.Bible client and cache, links out
- `src/catechism.js` – Catechism index and tab
- `src/reader.js`, `src/notes.js`, `src/prepare.js`, `src/settings.js` – the tabs
- `src/pdf.js` – printed outputs
- `src/ui.js` – small DOM helpers (elements, sheets, toasts)
- `vendor/jspdf.umd.min.js` – jsPDF 2.5.2 (MIT)
- `tools/` – the scripts that generate `data/` (see below)

## Rebuilding the data

The scripts need Python 3 and no packages.

```sh
cd bible/tools
# King James Version with Apocrypha, from the SWORD KJVA module as JSON
# (https://github.com/scrollmapper/bible_databases, formats/json/KJVA.json)
python3 build_bible.py kjv /path/to/KJVA.json
# World English Bible with Deuterocanon, USFX from ebible.org
# (https://github.com/seven1m/open-bibles, eng-web.usfx.xml)
python3 build_bible.py web /path/to/eng-web.usfx.xml
# Catechism index: the text of the English Catechism PDF (pdftotext -layout)
# plus the table of contents with nak.org ids
python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt
```

## Releasing a change

Bump `VERSION` in `sw.js` so phones pick up the new build, and the `?v=` on
`styles.css` and `src/app.js` in `index.html` when those change. The Vercel
project for this app has its root directory set to `bible`.

## Licences

- King James Version (1769) with Apocrypha: public domain. Text via the SWORD KJVA
  module (scrollmapper/bible_databases).
- World English Bible with Deuterocanon: public domain, ebible.org. "World English
  Bible" is a trademark of eBible.org.
- Catechism of the New Apostolic Church: © New Apostolic Church International.
  Only section numbers, titles and Bible references are indexed; the text is not
  copied.
- jsPDF: MIT (`vendor/jspdf.LICENSE`).

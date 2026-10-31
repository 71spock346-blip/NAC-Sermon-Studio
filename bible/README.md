# NAC Study Bible

A personal study bible for a New Apostolic Church minister: Scripture in several
translations, the person's own notes on verses, an index of where the Catechism of
the New Apostolic Church refers to each verse, and a guided path from a text word to
a divine service with printable sermon notes and a cue card.

Like the other apps in this repository it is a static site: no build step, no
server, no login. It is built from the `bible/` folder as its own Vercel project.
On a phone, open the link and use "Add to Home Screen". The user manual is
`help.html` (the Help button in the app).

## How it looks

`styles.css` is the whole look: warm paper tones (a plain white and a dark theme swap
the same tokens; Settings → Appearance, or the reader's "Aa" button, choose between
them and the choice is mirrored in localStorage so the page paints in the right
colours before the database is open), Literata as the reading typeface for Scripture
and the Catechism (vendored under `vendor/fonts/`, SIL Open Font License), the system
sans for everything else. Under 760px the tabs are a bar under the thumb and the text
runs full width; from 760px they are a side menu and each screen is a page on the paper.
The emblem in `icons/emblem.svg` is the mark in the header and the app icon.

## Two languages

The interface speaks English or Afrikaans: the EN / AF switch is in the header on a
phone and at the foot of the side menu on a PC, and the same choice is under
Settings → Language and in the reader's "Aa" sheet. `src/i18n.js` is the layer: every
text the app shows goes through `t('English text')` (`tn()` for a count, `data-t`
attributes in `index.html`), with the English as the key, and `src/af.js` maps each
key to its Afrikaans, in the Church's own words from the Afrikaans Divine Service
Guide (godsdiens, Boodskap, Kategismus, preeknotas). A key without an entry falls back
to the English, so a new text never breaks the app; `python3 tools/check_i18n.py`
(from `bible/`) lists the texts without an Afrikaans entry and the entries no longer
used, so run it after adding a text or a line to `af.js`. Switching sets `uiLang` and
with it the book names (`bookLang`) and the language of Claude's suggestions
(`aiLang`), each still changeable on its own in Settings; the choice is mirrored to
localStorage (`sb-lang`) so the page paints in the right language before the database
is open, and `help.html` carries both languages and opens in the app's. The Bible text
stays in whichever translation is chosen; the Catechism's text and index are English.

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
- **Catechism.** `data/catechism.json` is an index: section numbers, titles, the id of
  each section's page at nak.org, and the Bible verses each section quotes. The text
  of the sections is the Church's copyright and is not in the repository or on the
  site: `tools/build_catechism.py --text` writes it to `catechism-text.json`, which the
  person loads under Settings → Catechism into IndexedDB on their own device. With it
  loaded, `src/catechism.js` shows the sections (with the book's own summaries,
  footnotes and the table of the Ten Commandments), searches them by word, and
  `src/pdf.js` prints the sections chosen for a service into the sermon notes.
- **AI helper.** `src/ai.js` calls Claude (Anthropic) straight from the browser with the
  person's own key (Settings → AI helper, on the device only, never exported), streaming
  and with the answer held to a JSON schema. Two jobs: a monthly Divine Service Guide
  (PDF, sent as a document block) comes back as one entry per service, which `src/guides.js`
  keeps in the `guides` store on the device, lists in the Prepare tab and uses to fill a
  preparation; "Break down the article" under step 2 takes that article apart sentence by
  sentence (the Guide's words, the plain words, what it gives the sermon, and a Bible passage or
  Catechism section where one brings depth, each with a Use button, plus a study-sheet PDF);
  "Suggest answers" under step 3 of a preparation returns the context of
  the text, key words, Catechism sections, cross references and sermon thoughts, each with
  a "Use" button; "Suggest the sermon" under step 4 returns the build itself (introduction,
  main points, application, conclusion, illustrations and, where it fits, a lighter moment, each with a line on why it works),
  drawing on the minister's own draft and notes. The main points always come from the Guide: the parts of
  its article, in its order, are main point 1, 2, 3 and so on (`guides.js mainPoints`); a preparation taken from the
  Guide starts with them, `ai.js` gives the model that list as fixed and `alignPoints` holds the answer to it (a point
  the model adds is left out, one it leaves out stays in the Guide's words), and without the article the model is told
  to propose none and to say so, unless the minister wrote the points himself or the service is a funeral or a
  wedding, which the Guide has no article for. Every answer is written in short sentences and everyday words, shaped
  for the people the preparation names (age group, a line about the congregation, its own language) with the humour
  level the person chose (none at a funeral or a service for the departed) and the person's own note on how they preach
  (Settings → AI helper). Any suggestion can first be put into the person's own words in place: a tap on its
  text or its pencil opens its words in growing boxes, the change lives in the saved suggestion itself (so Use,
  "Use all", the study sheet and the next request carry it) and is kept with the preparation; the Guide's own
  words in the breakdown stay as they are. The Catechism sections' text and the Guide's article go along in the
  request when they are on the device; the Guide, like the Catechism, is the Church's text
  and stays out of the repository and the backup.
- **Storage.** Notes, preparations and settings live in IndexedDB on the device
  (`src/store.js`). Settings → Backup exports and merges a JSON file.
- **Offline.** `sw.js` serves the shell network-first and the texts, library and
  icons cache-first. Settings → Offline fetches all texts once.
- **PDF.** `src/pdf.js` draws the sermon notes (A4) and the cue card (A5 landscape)
  with the vendored jsPDF.

## Files

- `index.html`, `styles.css`, `help.html`, `manifest.json`, `sw.js` – the page
- `icons/` – the emblem (SVG and the PNG sizes a phone's home screen wants)
- `src/app.js` – start-up and the hash router (`#read/PSA/130/7`, `#notes`,
  `#prepare/<id>`, `#catechism/3.4.1`, `#settings`)
- `src/books.js` – the 80 books, English and Afrikaans names, reference parsing
- `src/i18n.js`, `src/af.js` – the language of the interface: `t()` and the Afrikaans table
- `src/store.js` – IndexedDB, in-memory state, backup
- `src/bible.js` – bundled texts, API.Bible client and cache, links out
- `src/catechism.js` – Catechism index and tab
- `src/reader.js`, `src/notes.js`, `src/prepare.js`, `src/settings.js` – the tabs
- `src/ai.js` – Claude: the request, the three prompts and their JSON schemas
- `src/guides.js` – the Divine Service Guides read by Claude: the card in Prepare, prefilling a preparation, the article
- `src/pdf.js` – printed outputs
- `src/ui.js` – small DOM helpers (elements, sheets, toasts, the theme, segmented choices, text boxes that grow with their text)
- `vendor/jspdf.umd.min.js` – jsPDF 2.5.2 (MIT)
- `vendor/fonts/` – Literata (SIL OFL 1.1), Latin and Latin-extended subsets
- `tools/` – the scripts that generate `data/` (see below) and `check_i18n.py`, which lists the texts still without Afrikaans

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
pdftotext -layout /path/to/Catechism-of-the-NAC--ENGLISH.pdf /path/to/catechism.txt
python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt
# ... and, with --text, the sections' text as the file to load in the app
# (keep it out of the repository: it is the Church's text, for the person's own device)
python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt --text /path/to/catechism-text.json
```

## Releasing a change

Bump `VERSION` in `sw.js` so phones pick up the new build, and the `?v=` on
`styles.css` and `src/app.js` in `index.html` (and `styles.css` in `help.html`) when
those change. Run `python3 tools/check_i18n.py` so every new text has its Afrikaans. The Vercel
project for this app has its root directory set to `bible`.

## Licences

- King James Version (1769) with Apocrypha: public domain. Text via the SWORD KJVA
  module (scrollmapper/bible_databases).
- World English Bible with Deuterocanon: public domain, ebible.org. "World English
  Bible" is a trademark of eBible.org.
- Catechism of the New Apostolic Church: © New Apostolic Church International.
  Only section numbers, titles and Bible references are in the repository; the text
  file built with `--text` is loaded by the person onto their own device and is not
  published.
- jsPDF: MIT (`vendor/jspdf.LICENSE`).
- Literata: © The Literata Project Authors, SIL Open Font License 1.1 (`vendor/fonts/OFL.txt`).

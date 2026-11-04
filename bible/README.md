# NAC Study Bible

A personal study bible for a New Apostolic Church minister: Scripture in several
translations, the person's own notes on verses, an index of where the Catechism of
the New Apostolic Church refers to each verse, theological background to every book
of the Bible (and, with Claude, to any chapter or passage), and a guided path from a
text word to a divine service with printable sermon notes and a cue card.

Like the other apps in this repository it is a static site: no build step, no
login. It is built from the `bible/` folder as its own Vercel project. The one
piece of server code is `api/sync.js`, a Vercel function that stores the locked
parts of the sync between the person's devices (see "Sync" below).
On a phone, open the link and use "Add to Home Screen". The user manual is
`help.html` (the Help button in the app).

## Seating and communion

The Seating tab is the congregation's seating and communion plan: the floor plan of
the building, with the ministers put into the numbered seats and the hatched serving
stations, and the A4 sheet that comes out of it for WhatsApp. It was the standalone
Seating & Communion Planner and is now part of this app, which is what makes the
difference: the congregations' layouts, the saved plans and the roster of ministers
are rows in the `seating` store, so they travel with the sync and the backup. A layout
traced on a PC is on the phone and on the rector's devices without anyone sending a
file. The plan being worked on is the one thing that stays on its own device, until it
is saved, so two people are never editing each other's half-finished plan.

`seating-layouts.js` (the built-in congregations and the SVG), `seating-editor.js` (drag
the pieces of a layout) and `seating-pdf.js` (the sheet) are the standalone app's own
code, carried over as it was.

## The choir programme

The Choir tab is the conductor's Choir Programme Planner, which was also an app of its
own: the hymn index of 1317 entries, the music programme, the timed before-service
running order, the festive preparation form and the practices, each printed as the
workbook printed it. `choir-app.js` is that app's own code, handed its storage instead
of reaching for localStorage, and `choir-markup.js` is its page, with its six panes
renamed (`choir-tabs`, `choir-pane`, `#choir-<name>`) so they cannot be mistaken for
this app's tabs. Its stylesheet is held inside `#tab-choir`.

Each service is a row of its own in the `choir` store, with the conductor's settings
and hymn edits beside it, so two devices that each write a programme keep both rather
than the last one to save winning.

## Coming from the two standalone apps

Settings has "Bring in a file from the old apps": save a backup in the standalone
Seating or Choir planner and load it here, and the layouts, plans, roster and choir
programmes come across and travel with the sync from then on.

## How it looks

`styles.css` is the whole look, dressed like the Church's slides: the NAC blue
(#0168B5) with the white line emblem for the frame (the header on a phone, the side
menu on a PC), white pages, small spaced capitals over a heading, light-blue cards
and numbers in blue circles. Every letter is Montserrat, as Jerome asked: one variable
font for every weight, vendored under `vendor/fonts/` (SIL Open Font License) so a
phone and a PC look the same offline. The tokens `--display`, `--serif` and `--sans`
all point to `--font`, so one line changes the letters. "White" is that look,
"Paper" keeps the blue with warm cream pages, "Dark" is a deep blue for the night, and
"System" follows the device; they swap the same tokens, and the choice (Settings →
Appearance, or the reader's "Aa" button) is mirrored in localStorage so the page paints
in the right colours before the database is open. "Easy-read" swaps Montserrat for
plain letters (Verdana where the device has it) in the whole app, with more room in the
reading text. Under 760px the tabs are a bar under the thumb and
the text runs full width on white; from 760px they are a side menu and each screen is
a white page on a pale ground, with the small blue emblem in its corner.

`icons/emblem-line.svg` is the official white line emblem, traced from
`icons/emblem-white.png`; the app draws it through a CSS mask (`.emblem`), so it takes
the colour of the text around it. The app icon is the official NAC icon: a square of
the Church blue with the white emblem 89% of its height, centred (`icons/emblem.svg`,
the browser tab; `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`). In
`icon-maskable-512.png` the whole emblem stays inside the central circle (40% radius)
that every Android launcher shape keeps. The icon links carry `?v=2` in `manifest.json`,
`index.html`, `help.html` and `sw.js`; raise it whenever the icons change, so browsers
and installed apps fetch the new ones. The welcome screen in `index.html` (styled as the blue title slide) shows once
each time the app is opened and fades when `app.js` has drawn the first screen.

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
- **Theology.** `src/theology.js` gives background at three levels: a book with its
  writer (`#theology/ROM`), a chapter (`#theology/ROM/8`) and a passage
  (`#theology/ROM/8/28-30`); `#theology` lists the books in the Catechism's groups
  (CNAC 1.2.2.2, 1.2.3, 1.2.4.2), the Apocrypha as "the later writings of the Old
  Testament". Built in, free and offline, is a short introduction to each of the 80
  books in `data/theology/en.json` and `af.json`, written for the app in plain words:
  `title`, `line` (one line on the book), `writer`, `when`, `to` (written for whom),
  `why`, `summary`, `themes`, `parts` (`[from, to, title]` by chapter), `key` verses
  (`"ROM.8.28"`) and `christ` (how it points to Christ). The two files hold the same
  parts and key verses, and `python3 tools/check_theology.py` checks that every book is
  there, every field is filled and every part and key verse exists in the KJV text.
  Beside each level stand the Catechism sections that quote it, counted from the
  index (`catechism.js quoting`), with the Catechism's own "in short" when its text is
  on the device. "Ask Claude" (`ai.js insight`, with the person's own key) adds the
  plain meaning, background, writer, place in the book, parts, key words, themes, what
  the Church teaches (from the Catechism text on the device, cited by section number
  only from the index), up to three readings of other Christians each marked as in
  line with New Apostolic teaching, different or left open, how it points to Christ,
  other passages, Catechism sections and a word for today; the instructions, the Creed
  and the index form a cached opening, so asking again soon costs less. The answer is
  kept in the `theology` store, one row per place and language (`en:ROM.8`,
  `af:ROM.8.28-30`), and goes with the sync and the backup file. Asking again keeps the
  answer it replaces in the row's `earlier` list, shown folded under the new one to read,
  put first again or remove; Remove asks first and takes away one answer, with Undo.
  Under it, "Save all of this" keeps everything the page shows (the verses or the book's introduction, all
  that Claude wrote and the Catechism sections, built once by `theology.js savedPage`)
  as a PDF (`pdf.js theologyPdf`, with `winAnsi` for Greek or Hebrew letters the PDF's
  letters lack) or as a Doctrine note. In the reader,
  "Theology" in the verse bar opens a sheet on the chosen verses and the button beside
  the chapter title opens the chapter. A PC has "Theology" in the side menu; the phone's
  bar keeps its six tabs (a seventh does not fit at 360px), so there it is reached from
  the reader, and Read stays lit.
- **The helper is the minister's own.** `src/lock.js`: under Settings → AI helper the
  minister chooses a password; the app keeps a PBKDF2 hash of it (`settings.helperLock`,
  which travels with the sync and the backup) and remembers an unlocked device in
  `settings.helperOpen` (device only). Where the helper is locked, nothing says it exists:
  Prepare, Notes and Reflection evening show none of Claude's buttons, panels or words,
  the Guide cannot be loaded, the sync code is not shown, Settings has only Theology's key
  box, the help page hides its part for the minister (class `mo`, shown by a small script
  that reads the same settings), and `ai.js` refuses every request but Theology's. The way
  in is five quick taps on the heading "AI helper" in Settings (`settings.js secretTap`),
  which open the password sheet. Theology stays open to anyone, with a key of their own
  (`settings.guestAiKey`, device only); the minister's key never goes out while the helper
  is locked (`ai.js activeKey`). Before a password is chosen, the helper shows wherever the
  minister's key is, as it did before.
- **AI helper.** `src/ai.js` calls Claude (Anthropic) straight from the browser with the
  person's own key (Settings → AI helper, on the device only, never exported), streaming
  and with the answer held to a JSON schema. Two jobs: a monthly Divine Service Guide
  (PDF, sent as a document block) comes back as one entry per service, which `src/guides.js`
  keeps in the `guides` store on the device, lists in the Prepare tab and uses to fill a
  preparation. A month's Guide can be loaded in English and in Afrikaans: `partnerOf` links each
  service to the same service in the other language (same text on the same day), the card switches
  between the two lists, a preparation follows the Guide it was started from and is preached in its
  language, and `switchEdition` moves it to the other one, changing only what still holds the Guide's
  own words; "Break down the article" under step 2 takes that article apart sentence by
  sentence (the Guide's words, the plain words, what it gives the sermon, and a Bible passage or
  Catechism section where one brings depth, each with a Use button, plus a study-sheet PDF);
  "Suggest answers" under step 5 of a preparation returns the context of
  the text, key words, Catechism sections, cross references and sermon thoughts, each with
  a "Use" button; "Suggest the sermon" under step 4 returns the build itself (introduction,
  main points, application, conclusion, illustrations and, where it fits, a lighter moment, each with a line on why it works),
  drawing on the minister's own draft and notes. Under each main point the minister can write his own thought on it
  (`points[i].thought`); before the build, `readThoughts` has Claude read those thoughts and ask, in a sheet, about any
  that is unclear (the questions and answers stay under the point as `talk`, and `read` marks what Claude has seen, so
  only a changed thought is read again), then the outline weaves every thought in and reports where each went
  (`thoughts`). "Weave my thought into this point" under a point asks `weaveThought` for that point alone: its text
  comes back with the thought in it (or a question first, kept in `talk`), waits under the point as `weave` and goes
  in with "Use" (undoable); the rest of the sermon is left alone. `pdf.js sermonTextPdf` prints the sermon itself in reading order, from the preparation's boxes or from
  the outline (each illustration under the point it serves), beside the sermon notes and the cue card.
  The main points always come from the Guide: the parts of
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
- **Notes in English and Afrikaans.** Each note card (`src/notes.js`) has an EN | AF switch. The
  note shows in the app's language when it has it, else as written. Tapping the other language
  has Claude translate it once (`ai.js translateNote`, effort low, Church words as the NAC in
  South Africa says them, quoted Bible verses left as they are); the translation is kept in the
  note as `alt` ({lang, title, body, of, at, model, edited}), so it syncs and backs up with it and
  switching needs no connection. `lang` is the language the note is written in, guessed from
  its short words (`guessLang`) until it is kept. `of` marks the note as translated: when the note
  changes later, the translation says so and offers "Translate again". Edit changes the language
  on the screen; the other stays. "Insert from my notes" in Prepare takes the preparation's language.
- **Theology in English and Afrikaans.** Each of Claude's answers in Theology (`src/theology.js`)
  has the same EN | AF switch. A place shows the language picked on its switch, else the
  language of Claude's answers when there is an answer in it, else the other. Tapping a language
  without an answer has Claude translate the one on the screen (`ai.js translateInsight`: the
  answer's words go piece by piece, `insightPieces`, so numbers, Catechism sections, Bible
  references and the marks on other churches' readings never change). The translation is kept
  as the row of that language (`af:COL.1`), its answer marked `translated` ({from, of}), so it
  syncs and backs up like any answer; `of` marks the answer it came from, and when that one
  changes, the translation says so and offers "Translate again" (the old translation goes under
  the new one, as with Ask again). The list under Theology and a chapter's passages show each
  place once, in the language it opens in.
- **Liturgy.** `src/liturgy.js` is the Church's altar booklet, *Liturgy for Altar Use*
  (English and Afrikaans), one card per rite with the words said at the altar. The
  booklet is the Church's text, so it is not in the repository: the person loads its PDF
  under Liturgy, and `src/booklet.js` reads it on the device with pdf.js
  (`vendor/pdfjs/`, fetched only then): `readPages` takes every piece of text with its
  place, letters and size, and the dotted rules between the rows; `parse` turns the pages
  into cards (`{key, title, rows}`; a row `{label, sub, blocks}`; a block a paragraph, a
  note in italics or small letters, or a list item with its depth), joining a row or a
  card that runs over the page. The cards are kept in the `liturgy` store, one row per
  language (`en`, `af`), travel with the sync and are not in the backup. `#liturgy`
  lists the cards in the app's language (or the other's when only that booklet is
  loaded); `#liturgy/<key>` is one card, with an EN | AF switch when both are loaded, the
  reader's text sizes under "Aa" and a screen wake lock. A PC has Liturgy in the side
  menu; the phone's bar keeps six tabs, so there it sits at the top of Prepare, which
  stays lit. `node tools/test_booklet.mjs booklet.pdf` reads a PDF in Node and prints
  the cards (after `npm install --no-save pdfjs-dist@5.4.624` in `bible/`).
- **Storage.** Notes, preparations, settings and what Claude wrote in Theology live
  in IndexedDB on the device (`src/store.js`). At start the app asks the browser to keep
  that storage when the device runs short of space (`app.js keepData`,
  `navigator.storage.persist`). Settings → Backup exports and merges a JSON file.
- **Sync.** Settings → "Sync between your devices" keeps a PC and a phone the same
  without an account: the first device makes a code of 20 letters (100 bits), the
  other joins by typing it or scanning its QR square (`vendor/qrcode.mjs`, MIT; the
  square carries `#sync/<code>`, which `app.js` turns into the join sheet). The code
  is the whole secret. `src/sync.js` derives a key from it (PBKDF2) and locks each of
  eight parts (notes, preparations, settings, pasted text, the Catechism text, the
  Guides, the theology Claude wrote, the altar booklet) with AES-GCM, gzip first, before sending it to
  `api/sync.js`, which keeps
  the bytes as private blobs in Vercel Blob under `sync/<hash of the code>/<part>.bin`.
  The server and the store never hold anything readable, so the Church's texts and
  the person's keys travel too (the keys only while "Carry my keys" is ticked); the
  look of the app (theme, text size) stays per device. Each part has an ETag: a sync
  asks for each part with `If-None-Match`, merges a changed one with the device's rows
  (`src/merge.js`: the newer row wins, a deletion leaves a dated marker in the `sync`
  store so it is not undone by the other device, settings merge per key) and sends the
  result back with `If-Match`, so two devices writing at once just merge again. It runs
  at start, a few seconds after a change (a minute after a chapter turn), when the app
  comes back to the front, and every five minutes; `sw.js` never caches `/api/`.
  "Delete the copy on the server" leaves a marker that makes the other devices stop
  (410). `node tools/test_merge.mjs` checks the merge rules; `node tools/dev_server.mjs`
  (after `npm install` in `bible/`) serves the app with the function keeping the parts
  in memory, for trying it with two browser windows. On Vercel the function needs a
  Blob store connected to the project: Vercel sets `BLOB_STORE_ID` and the function
  signs in with the deployment's own OIDC token (an older connection sets
  `BLOB_READ_WRITE_TOKEN` instead). Until then it answers 503 and the app says the
  storage still has to be switched on.
- **Offline.** `sw.js` serves the shell network-first and the texts, library and
  icons cache-first. Settings → Offline fetches all texts once.
- **Preparing a service.** `src/prepare.js` walks one divine service in the order of
  the Divine Service Guide's article, so the booklet and the form can be read side by
  side: 1 the text word (the Guide's Bible text), 2 title and message, 3 introduction
  (the Guide's own introduction can be opened beside the person's), 4 main points,
  5 context (the Guide's Context box, with key words, Catechism sections and cross
  references), 6 summary and conclusion (the Guide's Summary, the application, the
  conclusion), then the person's own 7 illustrations and 8 reflection after the
  service, and 9 the slides for the reflection evening. `guides.js prefill` puts each part of the article into its own step;
  `guides.js upgrade` moves the Summary and Context of a preparation made before
  November 2026 out of "Notes from the Guide" into steps 6 and 5 while those notes are
  still the Guide's own words.
- **PDF.** `src/pdf.js` draws the sermon notes (A4, in the order of the steps), the sermon
  itself and the cue cards (A5 landscape: each main point with its main thoughts under it, picked
  by `mainThoughts`, and the minister's own thought in blue; a point never splits over two cards)
  with the vendored jsPDF.
- **Reflection evening.** "Reflection evening" has its own place in the side menu
  (`#reflect`, `prepare.js renderReflect`): load the Church's reflection guide, the
  evenings with slides, and the latest services held. `src/reflect.js` is the screen
  `#reflect/<id>` (the old `#prepare/<id>/reflect` still leads there): the
  slides for the evening when the congregation looks back on a held service, one question
  at a time. What the slides say is kept on the preparation as `s.reflect` (language, date
  of the evening, title, text word, message, questions, closing words, the facilitator's
  own notes), so it syncs and backs up with it; the preparation's own boxes are not changed. "Load the reflection
  guide (PDF)" sends the Church's one-page discussion guide to Claude (`ai.js
  readReflection`), which copies its title, Bible text and questions word for word;
  `prepare.js newFromReflection` finds the service among the preparations or adds it as
  held. "Delete these slides" removes `s.reflect` (with Undo) and leaves the preparation;
  cards with slides show a "Slides" mark in the lists. Each slide carries notes for the
  facilitator (`slides.js notesFor`, English and Afrikaans): the welcome, the text word with
  the Guide's background, the main points with their main thoughts (`pdf.js mainThoughts`),
  how to lead each question (with a tip for each of the Church's four), and the close. The
  minister's own words replace a suggestion (`s.reflect.notes`, questions' notes in the order
  of the questions, moving with them); they go into the PowerPoint as slide notes and print
  with `pdf.js facilitatorPdf`, where they run on over the page (`Writer.flow`: a paragraph of
  up to three lines stays whole, a longer one keeps two lines on either page, a slide's heading,
  question or main point never stands alone at the foot of a page, and a page that goes on
  with a slide says so in its top margin). The main points on the slide are always the headings of the Guide's article
  (`guides.js mainPoints`), in the language of the slides when the Guide is loaded in
  both. `src/slides.js` has no DOM: `deck()` lays every slide out as boxes on a
  13.33 × 7.5 inch page in the standard theme (blue #0168B5 opening and closing slides
  with the white emblem, white slides with pale blue cards, Cambria headings, Calibri
  text), and fits each text with Calibri and Cambria widths; the in-app show draws the
  same boxes in HTML, and `pptx()` writes them with the vendored PptxGenJS as a
  PowerPoint file with two layouts, sections and the theme's colours and fonts.

## Files

- `index.html`, `styles.css`, `help.html`, `manifest.json`, `sw.js` – the page
- `api/sync.js` – the sync server (Vercel function, Vercel Blob); `package.json` holds its one dependency
- `icons/` – the emblem (SVG and the PNG sizes a phone's home screen wants; `emblem-white.png` and `emblem-blue.png` for the slides)
- `src/app.js` – start-up and the hash router (`#read/PSA/130/7`, `#notes`,
  `#prepare/<id>`, `#reflect/<id>`, `#catechism/3.4.1`, `#theology/ROM/8`, `#liturgy/baptism`, `#settings`)
- `src/books.js` – the 80 books, English and Afrikaans names, reference parsing
- `src/i18n.js`, `src/af.js` – the language of the interface: `t()` and the Afrikaans table
- `src/store.js` – IndexedDB, in-memory state, backup, change events and deletion markers for sync
- `src/sync.js`, `src/merge.js` – sync between devices: the code, the locking, the server calls, the merge rules
- `src/bible.js` – bundled texts, API.Bible client and cache, links out
- `src/catechism.js` – Catechism index and tab
- `src/theology.js` – the Theology tab, the book, chapter and passage pages, and the sheet the reader opens
- `data/theology/en.json`, `data/theology/af.json` – the built-in introduction to every book, in English and Afrikaans
- `src/liturgy.js` – the Liturgy tab: the altar booklet's cards, loading and removing a booklet, the EN | AF switch, the screen wake lock
- `src/booklet.js` – reads the altar booklet's PDF into cards (pdf.js on the device, then a pure parse of the pages)
- `src/reader.js`, `src/notes.js`, `src/prepare.js`, `src/settings.js` – the tabs
- `src/ai.js` – Claude: the request, the prompts and their JSON schemas
- `src/guides.js` – the Divine Service Guides read by Claude: the card in Prepare, prefilling a preparation, the article
- `src/pdf.js` – printed outputs
- `src/reflect.js`, `src/slides.js` – the reflection evening: the screen and the show; the slide layout, the facilitator's notes and the PowerPoint file
- `src/ui.js` – small DOM helpers (elements, sheets, toasts, the theme, segmented choices, text boxes that grow with their text)
- `vendor/jspdf.umd.min.js` – jsPDF 2.5.2 (MIT)
- `vendor/pptxgen.bundle.js` – PptxGenJS 4.0.1 with JSZip 3.10.1 inside (MIT), loaded only when a PowerPoint file is made
- `vendor/fonts/` – Montserrat, variable (SIL OFL 1.1), Latin and Latin-extended subsets, the letters of the app; Caladea and Carlito (SIL OFL 1.1), standing in for Cambria and Calibri on the slides of a reflection evening
- `vendor/qrcode.mjs` – QR Code Generator by Kazuhiko Arase (MIT), for the sync code
- `vendor/pdfjs/` – pdf.js 5.4.624 (Apache 2.0; `vendor/pdfjs.LICENSE`), fetched only when an altar booklet is loaded
- `tools/` – the scripts that generate `data/` (see below), `check_i18n.py`, which lists the texts still without Afrikaans, `check_theology.py`, which checks the book introductions, `test_merge.mjs` and `dev_server.mjs` for sync, `test_booklet.mjs` for the altar booklet

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

The book introductions in `data/theology/` are written by hand, not generated: one
book per line, in the order of the books, so a change shows as one line in the diff.
Change the English and the Afrikaans together (the parts and key verses must stay the
same in both), then run `python3 tools/check_theology.py` from `bible/`.

## Releasing a change

Bump `VERSION` in `sw.js` so phones pick up the new build, and the `?v=` on
`styles.css` and `src/app.js` in `index.html` (and `styles.css` in `help.html`) when
those change. Run `python3 tools/check_i18n.py` so every new text has its Afrikaans, and
`python3 tools/check_theology.py` when the book introductions change. The Vercel
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
- Liturgy for Altar Use: © New Apostolic Church Cape. Nothing of it is in the
  repository; the person loads the PDF onto their own device, and it is not published.
- jsPDF: MIT (`vendor/jspdf.LICENSE`).
- pdf.js: Apache License 2.0 (`vendor/pdfjs.LICENSE`).
- PptxGenJS and JSZip: MIT (`vendor/pptxgen.LICENSE`).
- Montserrat: © The Montserrat Project Authors; Caladea: © The Caladea Project Authors; Carlito: © The Carlito Project Authors; all SIL Open Font License 1.1 (`vendor/fonts/OFL-Montserrat.txt`, `vendor/fonts/OFL-Caladea.txt`, `vendor/fonts/OFL-Carlito.txt`).

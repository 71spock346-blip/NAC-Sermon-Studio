# Choir Programme Planner

The conductor's *Choir Programme* workbook as a web app: the same hymn index and the
same printed sheets, on a phone instead of in Excel.

It is a static site — no build step, no server, no login. It lives in `choir/` of this
repository and is self-contained, so Vercel can serve it as its own site with `choir` as
the project's root directory, independently of the seating planner at the repository
root. On a phone, open it and use "Add to Home Screen". The user manual is at `help.html`
(the Help button in the app).

## What it produces

| Sheet | From the workbook tab | Paper |
| --- | --- | --- |
| Music Program | `Music Program 2022` | A4 portrait |
| Before service | `Before service` | A4 landscape |
| Festive Divine Service Preparation | `Preparation` | A4 landscape |
| Choir practice sheet | *new* | A4 portrait |

Each is drawn straight into a PDF with jsPDF, in millimetres, following the layout of the
sheet it comes from: the emblem, the congregation and date band, the blue section
headings and the boxed hymn rows of the Music Program are the sheet's own geometry, taken
from its column widths (an Excel column of *w* characters is 7*w* + 5 pixels).

Every sheet can be saved as a PDF, shared (the share sheet on a phone, so a programme can
go to the choir on WhatsApp) or printed. Printing goes through the finished PDF rather
than the page, so what comes out of the printer is the sheet that would have been shared.

## The hymn index

`src/hymns.js` carries all 1&nbsp;317 entries of the workbook's `Hymn Index` sheet
unchanged: 422 from the hymn book, 580 English (`E 1`–`E 580`) and 315 Afrikaans
(`A 1`–`A 315`). Each record keeps the sheet's own columns:

- **Ability** — Easy, Practice, Tricky, Difficult, New, Unknown. The practice planner
  turns this into a suggested rehearsal time (5, 10, 15, 20, 20, 15 minutes).
- **Organ** — whether the hymn has organ accompaniment.
- **Comment** — *Alto Solo*, *Full Choir*, *New Words*, *Christmas* and the rest.
- **Service points** — the Bs, At, Cu, COM, As and Departed columns, read as before
  service, after the text word, call-up, Holy Communion, after service and for the
  departed. The sheet's `???` is kept as a tentative tag.
- **Seasons** — the Christmas, Easter and Thanksgiving columns.
- **Practice rounds** — the sheet's First/Second/Third columns, kept as they were.

A hymn is named the way the sheet names it: `104`, `E 104`, `A 12`. Typing `e104` or
`104` finds the same hymn.

Edits made in the Hymns tab are stored apart from this file, so "Back to the workbook"
always restores the original line.

## Planning practices

The workbook stopped at the programme. The Practices tab reads the choir, orchestra,
recorder and soloist lines out of the programme, offers the ones a practice does not yet
cover, and gives each the minutes its ability rating suggests. The practice sheet prints
with the whole service programme underneath it and a tick against everything the practice
covers, so the conductor can see at a glance what is still unrehearsed.

## Files

- `index.html`, `styles.css`, `help.html` — the page and the manual
- `src/hymns.js` — the hymn index, generated from the workbook
- `src/library.js` — reference parsing, search and the conductor's edits
- `src/model.js` — the service document: programme, before-service timing, preparation
  form and practices
- `src/pdf.js` — the four printed sheets
- `src/app.js` — state, storage and the user interface
- `icons/icon.svg` — the app icon; the PNGs are rendered from it
- `vendor/jspdf.umd.min.js` — jsPDF 2.5.2 (MIT)

## Storage

Everything is kept in `localStorage` under `nac-choir-planner:v1`: the services, their
practices, the defaults for new services and any changes to the index. Export/Import
backup in the Files tab moves the lot between devices.

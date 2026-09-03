# Seating & Communion Planner

A small web app for planning who sits where and who serves communion in a
New Apostolic Church congregation. It draws the church floor plan, lets you
assign ministers to seats and serving stations, and produces an A4 PDF that
can be shared straight to WhatsApp from a phone.

Live at https://nac-seating-planner.vercel.app (redeploys on every push to the
production branch). It is a static site: no build step, no server, no login.
On a phone, open the link and use "Add to Home Screen".

## Using it

- **Congregation**: pick the layout at the top. Gezina and Sinoville are built
  in; other congregations are added in the Layout tab. Sinoville's sections
  are Left, Right and Foyer, with serving stations in the foyer too.
- **Seats**: tap a numbered square on the plan, then tap a minister (or type a
  name). Tap another seat to swap the two. The Seats tab shows the same
  assignments as a table.
- **Serving stations**: tap a hatched square and choose the seat number of the
  minister who stands there. Steppers in the Communion tab add or remove
  stations per group (up to six each) and cups on the altar (up to eight a
  side).
- **Colours**: in the Roster tab, give each minister the colour of the section
  they serve. The colour follows them to their seat, to the station holding
  their seat number, and to the tables and PDF. Several ministers can share a
  colour. Sections and their colours are defined per layout.
- **Plans**: the app opens with empty seats and stations. Use Save (header)
  or "Save as new plan" (Plans tab) to keep a plan; saved plans load from the
  dropdown. Unsaved changes are restored on the next visit. Roster and
  layouts are saved automatically; Export/Import backup moves everything
  between devices.
- **Save PDF / Share PDF**: builds the A4 sheet (title, plan, legend, seating
  table, communion table, note). On a phone the Share button opens the share
  sheet so you can send it via WhatsApp; on a desktop the PDF downloads.

## Layouts for other congregations

The Layout tab manages layouts:

- **New layout (copy)** duplicates the current layout under a new name.
- **Edit this layout** turns the plan into an editor: drag blocks, seats,
  markers, the altar and station groups; tap one to change its label, size,
  colour, cut corner or direction; add or delete items.
- **Export layout / Import layout or picture** share a layout as a JSON file
  between congregations. Importing a PNG or JPG of a floor plan starts a new
  layout with the picture as a faint tracing background (edit mode only, not
  printed) so you can place blocks, seats and stations over it.
- **Serving sections and colours** define the colour choices offered in the
  Roster tab and the legend on the PDF.

The layout format (see `src/layout.js`, `GEZINA`) is plain JSON with blocks,
an altar, markers, seats, station groups, sections and default cup counts, in
a 1100 x 800 coordinate space.

## Files

- `index.html`, `styles.css` – the page
- `src/layout.js` – layout model, built-in Gezina layout, SVG renderer
- `src/editor.js` – drag-and-edit layout editor
- `src/pdf.js` – A4 sheet builder and PDF export (uses the vendored jsPDF)
- `src/app.js` – state, storage and UI
- `vendor/jspdf.umd.min.js` – jsPDF 2.5.2 (MIT)

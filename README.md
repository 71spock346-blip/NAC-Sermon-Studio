# Seating & Communion Planner

A small web app for planning who sits where and who serves communion at the
Gezina congregation. It draws the church floor plan, lets you assign ministers
to seats and serving stations, and produces an A4 PDF that can be shared
straight to WhatsApp from a phone.

## Using it

The app is deployed on Vercel at https://nac-seating-planner.vercel.app and
redeploys automatically on every push to the production branch. It can also be
opened directly from `index.html` or hosted on any static web host. No build
step, no server and no login.

On a phone, open the link in the browser and use "Add to Home Screen" to keep
it like an app.

- **Assign a seat**: tap a numbered square on the plan, then tap a name in the
  roster chips (or type one). Tap another seat to swap the two.
- **Serving stations**: tap a hatched square and choose the seat number of the
  minister who stands there.
- **Communion table**: edit the "Serves" rows and the "Takes cup / Takes inner"
  pairs in the Communion card. The "Cups on the altar" steppers add or remove
  communion cups on either side of the altar (up to eight a side).
- **Roster**: add or remove ministers in the Roster card. Renaming someone
  updates their seat.
- **Plans**: every service is a plan. "New from current" copies the current
  plan so you only change what differs. Plans are saved in the browser.
- **Save PDF / Share PDF**: builds the A4 sheet (title, plan, seating table,
  communion table, note). On a phone the Share button opens the share sheet so
  you can send it via WhatsApp; on a desktop the PDF downloads.
- **Export / Import backup**: moves your plans and roster between devices.

## Layout

The floor plan geometry lives in `src/layout.js`. Solid-coloured squares are
the ministers' seats (the colour shows which section that seat serves);
hatched squares are the serving stations. The circles on the altar are the
communion cups; their number is stored per plan.

## Files

- `index.html`, `styles.css` – the page
- `src/layout.js` – floor plan data and SVG renderer
- `src/pdf.js` – A4 sheet builder and PDF export (uses the vendored jsPDF)
- `src/app.js` – state, storage and UI
- `vendor/jspdf.umd.min.js` – jsPDF 2.5.2 (MIT)

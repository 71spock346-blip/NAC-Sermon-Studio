/*
 * Floor plan of the Gezina church (top view) and the SVG renderer for it.
 *
 * Coordinates are in a 1100 x 800 viewBox that matches the reference picture.
 * Solid-coloured squares next to the altar are the ministers' seats; hatched
 * squares are the serving stations where ministers stand to serve communion.
 */
(function (global) {
  'use strict';

  var COLORS = {
    yellow: '#FFD966',
    green: '#A9D18E',
    blue: '#9DC3E6',
    white: '#FFFFFF',
    altar: '#B1510F',
    hatch: '#D9B23A',
    line: '#000000',
    selected: '#1565C0'
  };

  // Seat number -> colour group. The colour shows which section the seated
  // minister serves (yellow = centre, green = choir side, blue = right side).
  var SEAT_GROUP = {
    1: 'white', 2: 'yellow', 3: 'yellow', 4: 'yellow',
    5: 'green', 6: 'green',
    7: 'blue', 8: 'blue', 9: 'blue', 10: 'blue', 11: 'blue', 12: 'blue'
  };

  // Minister seats beside the altar. 9 and 12 are drawn blank unless used.
  var MINISTER_SEATS = [
    { id: '4', x: 310, y: 8 }, { id: '1', x: 355, y: 8 },
    { id: '5', x: 310, y: 52 }, { id: '2', x: 355, y: 52 },
    { id: '6', x: 310, y: 98 }, { id: '3', x: 355, y: 98 },
    { id: '7', x: 705, y: 8 }, { id: '10', x: 750, y: 8 },
    { id: '8', x: 705, y: 55 }, { id: '11', x: 750, y: 55 },
    { id: '9', x: 705, y: 100, quiet: true }, { id: '12', x: 750, y: 100, quiet: true }
  ];
  var SEAT_W = 32, SEAT_H = 30;

  // Front row of the centre block.
  var FRONT_ROW_IDS = ['13', '14', '15', '16', '17', '18', '19', '20', '21', '22'];
  var FRONT_ROW = { x: 340, y: 258, cellW: 40.5, cellH: 38 };

  // Serving stations. Each group can hold 0..MAX_STATIONS positions; they are
  // laid out centred on the group's anchor so the row grows evenly both ways.
  var STATION_SIZE = 34, MAX_STATIONS = 6;
  var STATION_GROUPS = {
    front: { cx: 545, cy: 189, dx: 42.5, dy: 0, rot: 0 },   // in front of the altar
    left: { cx: 232, cy: 95, dx: 27, dy: 27, rot: 45 },      // along the choir block's diagonal
    right: { cx: 852, cy: 95, dx: 27, dy: -27, rot: -45 }    // along the members block's diagonal
  };
  var DEFAULT_STATIONS = { front: ['2', '3', '4'], left: ['11', '6', '5'], right: ['7', '8', '10'] };

  function clampStations(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(MAX_STATIONS, n));
  }

  // Positions of every station for the given plan.
  function stationsFor(plan) {
    var st = plan.stations || DEFAULT_STATIONS, out = [];
    Object.keys(STATION_GROUPS).forEach(function (group) {
      var g = STATION_GROUPS[group], arr = st[group] || [];
      var n = clampStations(arr.length);
      for (var i = 0; i < n; i++) {
        var k = i - (n - 1) / 2;
        out.push({ group: group, index: i, cx: g.cx + k * g.dx, cy: g.cy + k * g.dy, rot: g.rot });
      }
    });
    return out;
  }

  var STATION_GROUP_LABELS = { front: 'Front of altar', left: 'Choir side', right: 'Members side' };

  var ALL_SEAT_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].concat(FRONT_ROW_IDS);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function label(x, y, text, size, opts) {
    opts = opts || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' +
      ' text-anchor="middle" dominant-baseline="central"' +
      (opts.bold ? ' font-weight="bold"' : '') +
      (opts.fill ? ' fill="' + opts.fill + '"' : '') +
      (opts.extra || '') + '>' + esc(text) + '</text>';
  }

  function rect(x, y, w, h, fill, sw, extra) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill +
      '" stroke="' + COLORS.line + '" stroke-width="' + (sw == null ? 4 : sw) + '"' + (extra || '') + '/>';
  }

  // Communion cups on the altar, either side of the inner altar box.
  var DEFAULT_CUPS = { left: 3, right: 2 };
  var MAX_CUPS = 8;

  function clampCups(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(MAX_CUPS, n));
  }

  // Positions for `n` cups starting at `edge` and running in `dir` (-1 left,
  // +1 right). Up to four cups fit in one row; more wrap onto a second row.
  var CUPS_PER_ROW = 4, CUP_SPACING = 22;
  function cupRow(n, edge, dir) {
    var out = [];
    if (!n) return out;
    var rows = Math.ceil(n / CUPS_PER_ROW);
    var ys = rows === 1 ? [100] : [89, 111];
    for (var i = 0; i < n; i++) {
      var row = Math.floor(i / CUPS_PER_ROW), col = i % CUPS_PER_ROW;
      out.push({ cx: edge + dir * (CUP_SPACING / 2 + col * CUP_SPACING), cy: ys[row], r: 9 });
    }
    return out;
  }

  function cup(cx, cy, r) {
    r = r || 9;
    var inner = Math.max(2, r * 0.45), sw = r < 7 ? 1.4 : 2;
    return '<g><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#e6e6e6" stroke="#333" stroke-width="' + sw + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + inner + '" fill="none" stroke="#333" stroke-width="1.2"/>' +
      '<line x1="' + (cx - r) + '" y1="' + cy + '" x2="' + (cx + r) + '" y2="' + cy + '" stroke="#333" stroke-width="1.2"/></g>';
  }

  /**
   * Render the plan as an SVG string.
   * @param {object} plan   plan state: { seats: {id: name}, stations: {front:[], left:[], right:[]} }
   * @param {object} opts   { interactive: bool, selected: {type:'seat'|'station', id}, idPrefix }
   */
  function renderPlan(plan, opts) {
    opts = opts || {};
    var interactive = !!opts.interactive;
    var sel = opts.selected || null;
    var pid = opts.idPrefix || 'p';
    var seats = plan.seats || {};
    var stations = plan.stations || { front: [], left: [], right: [] };
    var out = [];

    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 800" width="1100" height="800"' +
      ' font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif" fill="#000">');
    out.push('<defs><pattern id="' + pid + '-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="6" height="6" fill="#FFFFFF"/><line x1="0" y1="0" x2="0" y2="6" stroke="' + COLORS.hatch + '" stroke-width="2.5"/></pattern></defs>');
    out.push('<rect x="0" y="0" width="1100" height="800" fill="#FFFFFF"/>');

    // --- Rooms and blocks -------------------------------------------------
    out.push('<path d="M10 52 H110 L268 210 V325 H10 Z" fill="' + COLORS.green + '" stroke="#000" stroke-width="4"/>');
    out.push(label(139, 222, 'Choir', 30));
    out.push(rect(10, 360, 258, 290, COLORS.green));
    out.push(label(139, 478, 'Choir', 30) + label(139, 512, '&', 30) + label(139, 546, 'Members', 30));
    out.push(rect(10, 660, 258, 135, COLORS.green));
    out.push(label(139, 740, 'Mothers Room', 27));
    out.push(rect(268, 660, 557, 135, COLORS.white));
    out.push(label(546, 730, 'Foyer', 30));
    out.push(rect(825, 660, 265, 135, COLORS.white));
    out.push('<path d="M975 52 H1090 V325 H820 V210 Z" fill="' + COLORS.blue + '" stroke="#000" stroke-width="4"/>');
    out.push(label(972, 195, 'Member', 30));
    out.push(rect(825, 360, 265, 290, COLORS.blue));
    out.push(label(957, 500, 'Members', 30));
    out.push(rect(335, 250, 415, 290, COLORS.yellow));
    out.push(label(546, 420, 'Members', 30));
    out.push(rect(420, 580, 260, 70, COLORS.yellow));
    out.push(label(565, 616, 'Organist', 28));

    // --- Altar and communion cups ----------------------------------------
    out.push(rect(400, 38, 290, 120, COLORS.altar));
    out.push(rect(500, 62, 95, 58, COLORS.altar, 4));
    out.push(label(547, 91, 'Altar', 26, { fill: '#fff' }));
    var cups = plan.cups || DEFAULT_CUPS;
    cupRow(clampCups(cups.left), 496, -1).forEach(function (c) { out.push(cup(c.cx, c.cy, c.r)); });
    cupRow(clampCups(cups.right), 599, 1).forEach(function (c) { out.push(cup(c.cx, c.cy, c.r)); });

    // --- Fixed position markers (choir leader, organist) -------------------
    out.push(rect(345, 382, 30, 30, COLORS.white, 2.5));
    out.push(label(360, 397, 'C', 20, { bold: true }));
    out.push(rect(435, 605, 30, 30, COLORS.white, 2.5));
    out.push(label(450, 620, 'O', 20, { bold: true }));

    // --- Minister seats ----------------------------------------------------
    MINISTER_SEATS.forEach(function (s) {
      var name = seats[s.id] || '';
      var isSel = sel && sel.type === 'seat' && sel.id === s.id;
      var fill = COLORS[SEAT_GROUP[s.id]];
      var showNumber = !s.quiet || name || interactive;
      var attrs = interactive ? ' class="hit seat" data-seat="' + s.id + '" tabindex="0" role="button"' +
        ' aria-label="Seat ' + s.id + (name ? ': ' + esc(name) : ' (empty)') + '"' : '';
      out.push('<g' + attrs + '>');
      if (name) out.push('<title>' + esc('Seat ' + s.id + ': ' + name) + '</title>');
      out.push(rect(s.x, s.y, SEAT_W, SEAT_H, fill, isSel ? 5 : 2.5, isSel ? ' stroke="' + COLORS.selected + '"' : ''));
      if (showNumber) {
        out.push(label(s.x + SEAT_W / 2, s.y + SEAT_H / 2 + 1, s.id, 20,
          { bold: true, fill: (s.quiet && !name) ? '#7a8ea3' : '#000' }));
      }
      if (interactive && name) {
        out.push('<circle cx="' + (s.x + SEAT_W - 3) + '" cy="' + (s.y + 3) + '" r="5" fill="#2e7d32" stroke="#fff" stroke-width="1.5"/>');
      }
      out.push('</g>');
    });

    // --- Front row 13..22 --------------------------------------------------
    FRONT_ROW_IDS.forEach(function (id, i) {
      var x = FRONT_ROW.x + i * FRONT_ROW.cellW;
      var name = seats[id] || '';
      var isSel = sel && sel.type === 'seat' && sel.id === id;
      var attrs = interactive ? ' class="hit seat" data-seat="' + id + '" tabindex="0" role="button"' +
        ' aria-label="Seat ' + id + (name ? ': ' + esc(name) : ' (empty)') + '"' : '';
      out.push('<g' + attrs + '>');
      if (name) out.push('<title>' + esc('Seat ' + id + ': ' + name) + '</title>');
      out.push(rect(x, FRONT_ROW.y, FRONT_ROW.cellW, FRONT_ROW.cellH, COLORS.white, isSel ? 5 : 2.5,
        isSel ? ' stroke="' + COLORS.selected + '"' : ''));
      out.push(label(x + FRONT_ROW.cellW / 2, FRONT_ROW.y + FRONT_ROW.cellH / 2 + 1, id, 19, { bold: true }));
      if (interactive && name) {
        out.push('<circle cx="' + (x + FRONT_ROW.cellW - 4) + '" cy="' + (FRONT_ROW.y + 4) + '" r="5" fill="#2e7d32" stroke="#fff" stroke-width="1.5"/>');
      }
      out.push('</g>');
    });

    // --- Serving stations --------------------------------------------------
    stationsFor(plan).forEach(function (st) {
      var arr = stations[st.group] || [];
      var val = arr[st.index];
      var text = (val == null || val === '') ? '' : String(val);
      var key = st.group + '-' + st.index;
      var isSel = sel && sel.type === 'station' && sel.id === key;
      var half = STATION_SIZE / 2;
      var attrs = interactive ? ' class="hit station" data-station="' + key + '" tabindex="0" role="button"' +
        ' aria-label="Serving station, ' + STATION_GROUP_LABELS[st.group] + ' ' + (st.index + 1) +
        (text ? ': seat ' + text : ' (empty)') + '"' : '';
      out.push('<g transform="rotate(' + st.rot + ' ' + st.cx + ' ' + st.cy + ')"' + attrs + '>');
      out.push('<rect x="' + (st.cx - half) + '" y="' + (st.cy - half) + '" width="' + STATION_SIZE + '" height="' + STATION_SIZE +
        '" fill="url(#' + pid + '-hatch)" stroke="' + (isSel ? COLORS.selected : COLORS.line) + '" stroke-width="' + (isSel ? 5 : 2.5) + '"/>');
      if (text) out.push(label(st.cx, st.cy + 1, text, 20, { bold: true }));
      out.push('</g>');
    });

    out.push('</svg>');
    return out.join('');
  }

  global.Layout = {
    COLORS: COLORS,
    SEAT_GROUP: SEAT_GROUP,
    MINISTER_SEAT_IDS: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    FRONT_ROW_IDS: FRONT_ROW_IDS,
    ALL_SEAT_IDS: ALL_SEAT_IDS,
    STATION_GROUPS: STATION_GROUPS,
    DEFAULT_STATIONS: DEFAULT_STATIONS,
    MAX_STATIONS: MAX_STATIONS,
    clampStations: clampStations,
    stationsFor: stationsFor,
    STATION_GROUP_LABELS: STATION_GROUP_LABELS,
    DEFAULT_CUPS: DEFAULT_CUPS,
    MAX_CUPS: MAX_CUPS,
    clampCups: clampCups,
    renderPlan: renderPlan,
    esc: esc
  };
})(window);

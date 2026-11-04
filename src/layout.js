/*
 * Layout model and SVG renderer.
 *
 * A layout describes one congregation's building in a 1100 x 800 viewBox:
 *   blocks        rooms/seating blocks (rect, optional cut corner, label, fill)
 *   altar         the altar with an inner box; communion cups sit either side
 *   markers       fixed labelled squares that are not assignable (C, O)
 *   seats         assignable minister seats (numbered squares)
 *   stationGroups rows of hatched serving stations, grown from an anchor
 *   sections      the serving sections and their colours (used for ministers)
 */
(function (global) {
  'use strict';

  var W = 1100, H = 800;
  var SELECT = '#1565C0', EDIT = '#D81B60';   // the two colours that carry meaning on screen: the thing selected, the thing being edited

  var GEZINA = {
    id: 'gezina', name: 'Gezina', builtin: true,
    sections: [
      { name: 'Centre', color: '#FFD966' },
      { name: 'Choir side', color: '#A9D18E' },
      { name: 'Members side', color: '#9DC3E6' }
    ],
    blocks: [
      { id: 'b1', label: 'Choir', x: 10, y: 52, w: 258, h: 273, fill: '#A9D18E', cut: 'tr', cutSize: 158 },
      { id: 'b2', label: 'Choir\n&\nMembers', x: 10, y: 360, w: 258, h: 290, fill: '#A9D18E' },
      { id: 'b3', label: 'Mothers Room', x: 10, y: 660, w: 258, h: 135, fill: '#A9D18E', fontSize: 27 },
      { id: 'b4', label: 'Foyer', x: 268, y: 660, w: 557, h: 135, fill: '#FFFFFF' },
      { id: 'b5', label: '', x: 825, y: 660, w: 265, h: 135, fill: '#FFFFFF' },
      { id: 'b6', label: 'Member', x: 820, y: 52, w: 270, h: 273, fill: '#9DC3E6', cut: 'tl', cutSize: 158 },
      { id: 'b7', label: 'Members', x: 825, y: 360, w: 265, h: 290, fill: '#9DC3E6' },
      { id: 'b8', label: 'Members', x: 335, y: 250, w: 415, h: 290, fill: '#FFD966' },
      { id: 'b9', label: 'Organist', x: 420, y: 580, w: 260, h: 70, fill: '#FFD966', fontSize: 28 }
    ],
    altar: { x: 400, y: 38, w: 290, h: 120, inner: { x: 500, y: 62, w: 95, h: 58 }, label: 'Altar', fill: '#B1510F' },
    markers: [{ id: 'C', x: 345, y: 382 }, { id: 'O', x: 435, y: 605 }],
    seats: [
      { id: '6', x: 310, y: 8 }, { id: '3', x: 355, y: 8 }, { id: '5', x: 310, y: 52 }, { id: '2', x: 355, y: 52 },
      { id: '4', x: 310, y: 98 }, { id: '1', x: 355, y: 98 }, { id: '9', x: 705, y: 8 }, { id: '12', x: 750, y: 8 },
      { id: '8', x: 705, y: 55 }, { id: '11', x: 750, y: 55 }, { id: '7', x: 705, y: 100 }, { id: '10', x: 750, y: 100 }
    ].concat(['13', '14', '15', '16', '17', '18', '19', '20', '21', '22'].map(function (id, i) {
      return { id: id, x: 340 + i * 40.5, y: 258, w: 40.5, h: 38 };
    })),
    stationGroups: [
      { id: 'front', label: 'Front of altar', cx: 545, cy: 189, dx: 42.5, dy: 0, rot: 0, defaults: ['2', '3', '6'] },
      { id: 'left', label: 'Choir side', cx: 232, cy: 95, dx: 27, dy: 27, rot: 45, defaults: ['11', '4', '5'] },
      { id: 'right', label: 'Members side', cx: 852, cy: 95, dx: 27, dy: -27, rot: -45, defaults: ['7', '8', '12'] }
    ],
    cups: { left: 3, right: 2 }
  };

  function blankLayout(name) {
    return {
      id: '', name: name, builtin: false,
      sections: clone(GEZINA.sections), blocks: [],
      altar: { x: 400, y: 38, w: 290, h: 120, inner: { x: 500, y: 62, w: 95, h: 58 }, label: 'Altar', fill: '#B1510F' },
      markers: [], seats: [],
      stationGroups: [{ id: 'front', label: 'Front of altar', cx: 545, cy: 189, dx: 42.5, dy: 0, rot: 0, defaults: ['', '', ''] }],
      cups: { left: 3, right: 2 }
    };
  }

  var SINOVILLE = {
    id: 'sinoville', name: 'Sinoville', builtin: true,
    sections: [
      { name: 'Left', color: '#A9D18E' },
      { name: 'Right', color: '#9DC3E6' },
      { name: 'Foyer', color: '#FFD966' }
    ],
    blocks: [
      { id: 'b1', label: 'CONGREGATION', x: 66, y: 228, w: 416, h: 247, fill: '#A9D18E', fontSize: 22, labelDy: 15 },
      { id: 'b2', label: 'Priests', x: 66, y: 228, w: 180, h: 34, fill: '#A9D18E', fontSize: 18 },
      { id: 'b3', label: 'CONGREGATION', x: 573, y: 228, w: 408, h: 247, fill: '#9DC3E6', fontSize: 22, labelDy: 35 },
      { id: 'b4', label: 'Sunday School', x: 573, y: 228, w: 408, h: 34, fill: '#9DC3E6', fontSize: 18 },
      { id: 'b5', label: 'CHOIR', x: 573, y: 262, w: 188, h: 74, fill: '#9DC3E6', fontSize: 18 },
      { id: 'b6', label: 'Foyer', x: 78, y: 543, w: 895, h: 240, fill: '#FFD966', fontSize: 26, labelDy: 40 }
    ],
    altar: { x: 341, y: 12, w: 371, h: 110, inner: { x: 388, y: 46, w: 278, h: 41 }, label: 'ALTAR', fill: '#B1510F' },
    markers: [],
    seats: [
      { id: '6', x: 69, y: 14, w: 40, h: 35 }, { id: '4', x: 156, y: 14, w: 40, h: 35 }, { id: '2', x: 248, y: 14, w: 40, h: 35 },
      { id: '5', x: 69, y: 85, w: 40, h: 35 }, { id: '3', x: 156, y: 85, w: 40, h: 35 }, { id: '1', x: 248, y: 85, w: 40, h: 35 },
      { id: '8', x: 811, y: 14, w: 40, h: 35 }, { id: '10', x: 901, y: 14, w: 40, h: 35 },
      { id: '7', x: 811, y: 85, w: 40, h: 35 }, { id: '9', x: 901, y: 85, w: 40, h: 35 }, { id: '11', x: 979, y: 85, w: 40, h: 35 },
      { id: '12', x: 246, y: 228, w: 47.5, h: 34 }, { id: '13', x: 293.5, y: 228, w: 47.5, h: 34 }, { id: '14', x: 341, y: 228, w: 47.5, h: 34 },
      { id: '15', x: 388.5, y: 228, w: 47.5, h: 34 }, { id: '16', x: 436, y: 228, w: 47.5, h: 34 }
    ],
    stationGroups: [
      { id: 'left', label: 'Left', cx: 340, cy: 174, dx: 47.2, dy: 0, rot: 0, defaults: ['13', '6', '12', '5', '4', '3'] },
      { id: 'right', label: 'Right', cx: 715.5, cy: 174, dx: 47.4, dy: 0, rot: 0, defaults: ['7', '8', '9', '10', '11', '14'] },
      { id: 'foyer', label: 'Foyer', cx: 525, cy: 600, dx: 47.2, dy: 0, rot: 0, defaults: ['', '', ''] }
    ],
    cups: { left: 0, right: 0 }
  };
  var HERCULES = {
    id: 'hercules', name: 'Hercules', builtin: true,
    sections: [
      { name: 'Left', color: '#A9D18E' },
      { name: 'Right', color: '#9DC3E6' },
      { name: 'Balcony', color: '#FFD966' }
    ],
    blocks: [
      { id: 'benchA', label: '', x: 40, y: 86, w: 60, h: 172, fill: '#DCE3EC' },
      { id: 'benchB', label: '', x: 130, y: 86, w: 60, h: 172, fill: '#DCE3EC' },
      { id: 'benchC', label: '', x: 220, y: 86, w: 60, h: 172, fill: '#DCE3EC' },
      { id: 'benchD', label: '', x: 830, y: 86, w: 60, h: 172, fill: '#DCE3EC' },
      { id: 'piano', label: 'PIANO', x: 905, y: 112, w: 150, h: 88, fill: '#FFFFFF', fontSize: 24 },
      { id: 'organ', label: 'ORGAN', x: 905, y: 216, w: 150, h: 46, fill: '#FFFFFF', fontSize: 22 },
      { id: 'left', label: 'LEFT SECTION', x: 40, y: 330, w: 470, h: 190, fill: '#A9D18E', fontSize: 26 },
      { id: 'right', label: 'RIGHT SECTION', x: 590, y: 330, w: 470, h: 190, fill: '#9DC3E6', fontSize: 26 },
      { id: 'balcony', label: 'BALCONY', x: 40, y: 600, w: 1020, h: 175, fill: '#FFD966', fontSize: 26, labelDy: 30 }
    ],
    altar: { x: 395, y: 78, w: 320, h: 130, inner: { x: 470, y: 102, w: 170, h: 66 }, label: 'ALTAR', fill: '#B1510F' },
    markers: [{ id: 'C', x: 602, y: 410 }],
    seats: [
      { id: '12', x: 48, y: 94, w: 44, h: 36 }, { id: '11', x: 48, y: 134, w: 44, h: 36 }, { id: '10', x: 48, y: 174, w: 44, h: 36 }, { id: '9', x: 48, y: 214, w: 44, h: 36 },
      { id: '8', x: 138, y: 94, w: 44, h: 36 }, { id: '7', x: 138, y: 134, w: 44, h: 36 }, { id: '6', x: 138, y: 174, w: 44, h: 36 }, { id: '5', x: 138, y: 214, w: 44, h: 36 },
      { id: '4', x: 228, y: 94, w: 44, h: 36 }, { id: '3', x: 228, y: 134, w: 44, h: 36 }, { id: '2', x: 228, y: 174, w: 44, h: 36 }, { id: '1', x: 228, y: 214, w: 44, h: 36 },
      { id: '16', x: 838, y: 94, w: 44, h: 36 }, { id: '15', x: 838, y: 134, w: 44, h: 36 }, { id: '14', x: 838, y: 174, w: 44, h: 36 }, { id: '13', x: 838, y: 214, w: 44, h: 36 }
    ],
    stationGroups: [
      { id: 'left', label: 'Left', cx: 275, cy: 296, dx: 47, dy: 0, rot: 0, defaults: ['3', '8', ''] },
      { id: 'right', label: 'Right', cx: 825, cy: 296, dx: 47, dy: 0, rot: 0, defaults: ['16', '15', ''] },
      { id: 'balcony', label: 'Balcony', cx: 550, cy: 636, dx: 47, dy: 0, rot: 0, defaults: ['', '', ''] }
    ],
    cups: { left: 2, right: 2 }
  };

  var BUILTIN = [GEZINA, SINOVILLE, HERCULES];

  var SEAT_W = 32, SEAT_H = 30, MARKER = 30, STATION = 34, MAX_STATIONS = 6, MAX_CUPS = 8;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clamp(n, lo, hi) { n = parseInt(n, 10); return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function seatIds(layout) {
    return layout.seats.map(function (s) { return s.id; }).sort(function (a, b) {
      var na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1;
      if (!isNaN(nb)) return 1;
      return a.localeCompare(b);
    });
  }
  function blankStations(layout) {
    var o = {};
    layout.stationGroups.forEach(function (g) { o[g.id] = (g.defaults || []).map(function () { return ''; }); });
    return o;
  }
  function defaultStations(layout) {
    var o = {};
    layout.stationGroups.forEach(function (g) { o[g.id] = (g.defaults || []).slice(); });
    return o;
  }
  function stationsFor(layout, plan) {
    var st = plan.stations || {}, out = [];
    layout.stationGroups.forEach(function (g) {
      var n = clamp((st[g.id] || []).length, 0, MAX_STATIONS);
      for (var i = 0; i < n; i++) {
        var k = i - (n - 1) / 2;
        out.push({ group: g.id, index: i, cx: g.cx + k * g.dx, cy: g.cy + k * g.dy, rot: g.rot || 0 });
      }
    });
    return out;
  }
  function cupRow(n, edge, dir, cy) {
    var out = [], rows = Math.ceil(n / 4), ys = rows === 1 ? [cy] : [cy - 11, cy + 11];
    for (var i = 0; i < n; i++) out.push({ cx: edge + dir * (11 + (i % 4) * 22), cy: ys[Math.floor(i / 4)] });
    return out;
  }

  /* ------------------------------------------------------------ drawing
     The plan is drawn so that it reads the same on a white page, in the
     app's dark theme and on paper. Everything that is the drawing's own -
     outlines, numbers, the hatching of a station, the cups - is drawn in
     the page's ink (currentColor) on the page's paper, so a theme changes
     them together. Only the congregation's own colours are literal: the
     section fills, the altar, and a minister's colour on a seat; the text
     on those is chosen against that fill, not against the theme. */

  function text(x, y, s, size, o) {
    o = o || {};
    var lines = String(s == null ? '' : s).split('\n');
    var attrs = ' font-size="' + size + '" text-anchor="middle" dominant-baseline="central"' +
      ' font-weight="' + (o.bold ? '700' : o.weight || '500') + '"' +
      (o.fill ? ' fill="' + o.fill + '"' : '') + (o.spacing ? ' letter-spacing="' + o.spacing + '"' : '') + (o.extra || '');
    if (lines.length === 1) return '<text x="' + x + '" y="' + y + '"' + attrs + '>' + esc(s) + '</text>';
    var lh = size * 1.15, y0 = y - lh * (lines.length - 1) / 2;
    return '<text x="' + x + '" y="' + y0 + '"' + attrs + '>' + lines.map(function (l, i) {
      return '<tspan x="' + x + '"' + (i ? ' dy="' + lh + '"' : '') + '>' + esc(l) + '</tspan>';
    }).join('') + '</text>';
  }
  function rect(x, y, w, h, fill, sw, stroke, rx) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (rx ? ' rx="' + rx + '"' : '') +
      ' fill="' + fill + '" stroke="' + (stroke || 'currentColor') + '" stroke-width="' + sw + '"/>';
  }
  function blockPath(b) {
    var s = Math.min(b.cutSize || 0, b.w, b.h), x = b.x, y = b.y, w = b.w, h = b.h;
    if (b.cut === 'tr' && s) return 'M' + x + ' ' + y + ' H' + (x + w - s) + ' L' + (x + w) + ' ' + (y + s) + ' V' + (y + h) + ' H' + x + ' Z';
    if (b.cut === 'tl' && s) return 'M' + (x + s) + ' ' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + x + ' V' + (y + s) + ' Z';
    if (b.cut === 'br' && s) return 'M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h - s) + ' L' + (x + w - s) + ' ' + (y + h) + ' H' + x + ' Z';
    if (b.cut === 'bl' && s) return 'M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + (x + s) + ' L' + x + ' ' + (y + h - s) + ' Z';
    return 'M' + x + ' ' + y + ' h' + w + ' v' + h + ' h' + (-w) + ' Z';
  }
  /** A communion cup seen from above: the rim, the bowl, and the foot's edge. */
  function cup(cx, cy, ink) {
    return '<g fill="none" stroke="' + ink + '">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="rgba(255,255,255,.85)" stroke-width="1.6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="5.2" stroke-width="1.2"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="1.6" fill="' + ink + '" stroke="none"/></g>';
  }
  /** Relative luminance, so text can be chosen against a fill. */
  function lum(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 1;
    var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function dark(hex) { return lum(hex) < 0.35; }
  /** Text colour for a literal fill: near-black on a light one, white on a dark one. */
  function onFill(hex) { return dark(hex) ? '#ffffff' : '#111111'; }
  /** A deeper line of the same hue, for a block's own edge. */
  function edgeOf(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'currentColor';
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, k = 0.62;
    return 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
  }

  /**
   * Render a layout (with a plan's assignments) as an SVG string.
   * opts: interactive, selected {type,id}, idPrefix, colorOf(name) -> hex,
   *       edit (bool), editSel {type,id},
   *       paper / seat / ink: the page's colours (default: the theme's, via
   *       CSS variables with white-page fallbacks), font: a family for a
   *       drawing that will not sit in a page (the PDF).
   */
  function render(layout, plan, opts) {
    opts = opts || {};
    plan = plan || {};
    var it = !!opts.interactive, edit = !!opts.edit, sel = opts.selected, esel = opts.editSel;
    var pid = opts.idPrefix || 'p', seats = plan.seats || {}, colorOf = opts.colorOf || function () { return null; };
    var ink = opts.ink || 'currentColor';
    var paper = opts.paper || 'var(--plan-paper, #ffffff)';
    var seatPaper = opts.seat || 'var(--plan-seat, #ffffff)';
    var lineW = { outline: 3, block: 2.25, seat: 1.75, fine: 1.25 };
    var out = [];
    var hit = function (type, id, extra) { return it ? ' class="hit ' + type + '" data-' + type + '="' + esc(id) + '" tabindex="0" role="button"' + (extra || '') : ''; };
    var ehit = function (type, id) { return edit ? ' class="ed" data-edit="' + type + ':' + esc(id) + '"' : ''; };
    var isE = function (type, id) { return edit && esel && esel.type === type && esel.id === id; };
    var estroke = function (type, id, sw) { return isE(type, id) ? ' stroke="' + EDIT + '" stroke-width="' + (sw + 3) + '" stroke-dasharray="8 5"' : ''; };
    var label = esc(layout.name || 'Floor plan');

    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"' +
      ' role="img" aria-label="' + label + '"' +
      (opts.font ? ' font-family="' + esc(opts.font) + '"' : '') +
      ' color="' + (opts.ink || 'currentColor') + '" fill="' + ink + '" stroke-linejoin="round" stroke-linecap="round">');
    // the hatching of a serving station: fine diagonals in the page's ink, so it reads as a mark and not as a fourth section colour
    out.push('<defs><pattern id="' + pid + '-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="7" stroke="' + ink + '" stroke-width="1.6" opacity=".55"/></pattern></defs>');
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + paper + '" stroke="none"' + (edit ? ' data-edit="none:0"' : '') + '/>');
    if (edit && layout.background && layout.background.dataUrl && layout.background.show !== false) {
      out.push('<image href="' + layout.background.dataUrl + '" x="0" y="0" width="' + W + '" height="' + H + '" preserveAspectRatio="xMidYMid meet" opacity="' + (layout.background.opacity || 0.5) + '" data-edit="none:0"/>');
    }

    /* --- the rooms and seating blocks: each edged in a deeper tone of its own fill --- */
    (layout.blocks || []).forEach(function (b) {
      var own = b.fill || '#ffffff', plain = /^#f{6}$/i.test(own);
      var fill = plain ? seatPaper : own, edge = plain ? ink : edgeOf(own);
      out.push('<g' + ehit('block', b.id) + '><path d="' + blockPath(b) + '" fill="' + fill + '" stroke="' + edge + '" stroke-width="' + lineW.block + '"' + estroke('block', b.id, lineW.block) + '/>');
      if (b.label) out.push(text(b.x + b.w / 2 + (b.labelDx || 0), b.y + b.h / 2 + (b.labelDy || 0), b.label, b.fontSize || 30, { fill: plain ? ink : onFill(own), weight: '600' }));
      out.push('</g>');
    });

    /* --- the altar, with its cups --- */
    var a = layout.altar;
    if (a) {
      var af = a.fill || '#B1510F';
      out.push('<g' + ehit('altar', 'altar') + '>' + '<rect x="' + a.x + '" y="' + a.y + '" width="' + a.w + '" height="' + a.h + '" rx="3" fill="' + af + '" stroke="' + edgeOf(af) + '" stroke-width="' + lineW.block + '"' + estroke('altar', 'altar', lineW.block) + '/>');
      var inn = a.inner;
      out.push('<rect x="' + inn.x + '" y="' + inn.y + '" width="' + inn.w + '" height="' + inn.h + '" rx="2" fill="none" stroke="' + onFill(af) + '" stroke-width="' + lineW.fine + '" opacity=".9"/>');
      out.push(text(inn.x + inn.w / 2, inn.y + inn.h / 2, a.label || 'Altar', 24, { fill: onFill(af), weight: '600', spacing: '.5' }));
      var cups = plan.cups || layout.cups || { left: 0, right: 0 }, cy = inn.y + inn.h / 2 + 9, cupInk = onFill(af) === '#ffffff' ? '#3a2410' : '#111111';
      cupRow(clamp(cups.left, 0, MAX_CUPS), inn.x - 4, -1, cy).forEach(function (c) { out.push(cup(c.cx, c.cy, cupInk)); });
      cupRow(clamp(cups.right, 0, MAX_CUPS), inn.x + inn.w + 4, 1, cy).forEach(function (c) { out.push(cup(c.cx, c.cy, cupInk)); });
      out.push('</g>');
    }

    /* --- fixed positions, such as the conductor and the organist --- */
    (layout.markers || []).forEach(function (m) {
      out.push('<g' + ehit('marker', m.id) + '>' + rect(m.x, m.y, MARKER, MARKER, seatPaper, lineW.seat, ink, 4) +
        text(m.x + MARKER / 2, m.y + MARKER / 2 + 1, m.id, 18, { bold: true, fill: ink }) +
        (isE('marker', m.id) ? rect(m.x - 3, m.y - 3, MARKER + 6, MARKER + 6, 'none', 3, EDIT, 6) : '') + '</g>');
    });

    /* --- the ministers' seats --- */
    (layout.seats || []).forEach(function (s) {
      var w = s.w || SEAT_W, h = s.h || SEAT_H, name = seats[s.id] || '', own = name ? (colorOf(name) || '') : '';
      var fill = own || seatPaper, textInk = own ? onFill(own) : ink;
      var isSel = sel && sel.type === 'seat' && sel.id === s.id, show = !s.quiet || name || it;
      out.push('<g' + hit('seat', s.id, ' aria-label="Seat ' + esc(s.id) + (name ? ': ' + esc(name) : ' (empty)') + '"') + ehit('seat', s.id) + '>');
      if (name) out.push('<title>' + esc('Seat ' + s.id + ': ' + name) + '</title>');
      out.push(rect(s.x, s.y, w, h, fill, isSel ? 4 : lineW.seat, isSel ? SELECT : (own ? edgeOf(own) : ink), 4));
      if (show) out.push(text(s.x + w / 2, s.y + h / 2 + 1, s.id, w > 36 ? 18 : 19, { bold: true, fill: textInk, extra: (s.quiet && !name) ? ' opacity=".45"' : '' }));
      if (isE('seat', s.id)) out.push(rect(s.x - 3, s.y - 3, w + 6, h + 6, 'none', 3, EDIT, 7));
      out.push('</g>');
    });

    /* --- the serving stations: the minister's colour under a hatch of ink --- */
    var st = plan.stations || {};
    stationsFor(layout, plan).forEach(function (s) {
      var val = (st[s.group] || [])[s.index], txt = val == null ? '' : String(val), key = s.group + '-' + s.index;
      var occupant = txt ? seats[txt] : '', own = occupant ? (colorOf(occupant) || '') : '';
      var isSel = sel && sel.type === 'station' && sel.id === key, half = STATION / 2;
      out.push('<g transform="rotate(' + s.rot + ' ' + s.cx + ' ' + s.cy + ')"' + hit('station', key, ' aria-label="Serving station ' + esc(key) + (txt ? ': seat ' + esc(txt) : ' (empty)') + '"') + '>');
      out.push(rect(s.cx - half, s.cy - half, STATION, STATION, own || seatPaper, 0, 'none', 4));
      out.push(rect(s.cx - half, s.cy - half, STATION, STATION, 'url(#' + pid + '-hatch)', isSel ? 4 : lineW.seat, isSel ? SELECT : ink, 4));
      if (txt) {
        // a small plate behind the number, so it stays readable over the hatching; turned back upright on an angled station
        out.push('<g transform="rotate(' + (-s.rot) + ' ' + s.cx + ' ' + s.cy + ')">');
        out.push('<rect x="' + (s.cx - 11) + '" y="' + (s.cy - 9) + '" width="22" height="18" rx="3" fill="' + (own || seatPaper) + '" stroke="none"/>');
        out.push(text(s.cx, s.cy + 1, txt, 17, { bold: true, fill: own ? onFill(own) : ink }));
        out.push('</g>');
      }
      out.push('</g>');
    });

    if (edit) {
      layout.stationGroups.forEach(function (g) {
        var r = 26;
        out.push('<g' + ehit('group', g.id) + '><circle cx="' + g.cx + '" cy="' + g.cy + '" r="' + r + '" fill="rgba(216,27,96,0.12)" stroke="' + EDIT + '" stroke-width="' + (isE('group', g.id) ? 4 : 1.5) + '"' + (isE('group', g.id) ? '' : ' stroke-dasharray="4 3"') + '/>' +
          text(g.cx, g.cy - r - 10, g.label, 14, { fill: EDIT, bold: true }) + '</g>');
      });
    }
    out.push('</svg>');
    return out.join('');
  }

  function newId(prefix, list) {
    var n = 1, ids = {};
    (list || []).forEach(function (x) { ids[x.id] = 1; });
    while (ids[prefix + n]) n++;
    return prefix + n;
  }

  global.Layout = {
    W: W, H: H, GEZINA: GEZINA, BUILTIN: BUILTIN, MAX_STATIONS: MAX_STATIONS, MAX_CUPS: MAX_CUPS,
    SEAT_W: SEAT_W, SEAT_H: SEAT_H,
    render: render, esc: esc, clamp: clamp, clone: clone, dark: dark, onFill: onFill,
    seatIds: seatIds, defaultStations: defaultStations, blankStations: blankStations, stationsFor: stationsFor, newId: newId, blankLayout: blankLayout
  };
})(window);

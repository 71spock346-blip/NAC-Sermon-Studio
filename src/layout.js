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
  var INK = '#000', HATCH = '#D9B23A', SELECT = '#1565C0', EDIT = '#D81B60';

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
      { id: '6', x: 310, y: 8 }, { id: '3', x: 355, y: 8 }, { id: '5', x: 310, y: 52 }, { id: '1', x: 355, y: 52 },
      { id: '4', x: 310, y: 98 }, { id: '2', x: 355, y: 98 }, { id: '9', x: 705, y: 8 }, { id: '12', x: 750, y: 8 },
      { id: '8', x: 705, y: 55 }, { id: '11', x: 750, y: 55 }, { id: '7', x: 705, y: 100 }, { id: '10', x: 750, y: 100 }
    ].concat(['13', '14', '15', '16', '17', '18', '19', '20', '21', '22'].map(function (id, i) {
      return { id: id, x: 340 + i * 40.5, y: 258, w: 40.5, h: 38 };
    })),
    stationGroups: [
      { id: 'front', label: 'Front of altar', cx: 545, cy: 189, dx: 42.5, dy: 0, rot: 0, defaults: ['1', '3', '6'] },
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
      { id: '6', x: 69, y: 14, w: 40, h: 35 }, { id: '4', x: 156, y: 14, w: 40, h: 35 }, { id: '1', x: 248, y: 14, w: 40, h: 35 },
      { id: '5', x: 69, y: 85, w: 40, h: 35 }, { id: '3', x: 156, y: 85, w: 40, h: 35 }, { id: '2', x: 248, y: 85, w: 40, h: 35 },
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
      { id: '4', x: 228, y: 94, w: 44, h: 36 }, { id: '3', x: 228, y: 134, w: 44, h: 36 }, { id: '1', x: 228, y: 174, w: 44, h: 36 }, { id: '2', x: 228, y: 214, w: 44, h: 36 },
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

  function text(x, y, s, size, o) {
    o = o || {};
    var lines = String(s == null ? '' : s).split('\n');
    var attrs = ' font-size="' + size + '" text-anchor="middle" dominant-baseline="central"' +
      (o.bold ? ' font-weight="bold"' : '') + (o.fill ? ' fill="' + o.fill + '"' : '') + (o.extra || '');
    if (lines.length === 1) return '<text x="' + x + '" y="' + y + '"' + attrs + '>' + esc(s) + '</text>';
    var lh = size * 1.15, y0 = y - lh * (lines.length - 1) / 2;
    return '<text x="' + x + '" y="' + y0 + '"' + attrs + '>' + lines.map(function (l, i) {
      return '<tspan x="' + x + '"' + (i ? ' dy="' + lh + '"' : '') + '>' + esc(l) + '</tspan>';
    }).join('') + '</text>';
  }
  function rect(x, y, w, h, fill, sw, stroke) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" stroke="' + (stroke || INK) + '" stroke-width="' + sw + '"/>';
  }
  function blockPath(b) {
    var s = Math.min(b.cutSize || 0, b.w, b.h), x = b.x, y = b.y, w = b.w, h = b.h;
    if (b.cut === 'tr' && s) return 'M' + x + ' ' + y + ' H' + (x + w - s) + ' L' + (x + w) + ' ' + (y + s) + ' V' + (y + h) + ' H' + x + ' Z';
    if (b.cut === 'tl' && s) return 'M' + (x + s) + ' ' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + x + ' V' + (y + s) + ' Z';
    if (b.cut === 'br' && s) return 'M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h - s) + ' L' + (x + w - s) + ' ' + (y + h) + ' H' + x + ' Z';
    if (b.cut === 'bl' && s) return 'M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + (x + s) + ' L' + x + ' ' + (y + h - s) + ' Z';
    return 'M' + x + ' ' + y + ' h' + w + ' v' + h + ' h' + (-w) + ' Z';
  }
  function cup(cx, cy) {
    return '<g><circle cx="' + cx + '" cy="' + cy + '" r="9" fill="#e6e6e6" stroke="#333" stroke-width="2"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="none" stroke="#333" stroke-width="1.2"/>' +
      '<line x1="' + (cx - 9) + '" y1="' + cy + '" x2="' + (cx + 9) + '" y2="' + cy + '" stroke="#333" stroke-width="1.2"/></g>';
  }
  function dark(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 < 110;
  }

  /**
   * Render a layout (with a plan's assignments) as an SVG string.
   * opts: interactive, selected {type,id}, idPrefix, colorOf(name) -> hex,
   *       edit (bool), editSel {type,id}
   */
  function render(layout, plan, opts) {
    opts = opts || {};
    plan = plan || {};
    var it = !!opts.interactive, edit = !!opts.edit, sel = opts.selected, esel = opts.editSel;
    var pid = opts.idPrefix || 'p', seats = plan.seats || {}, colorOf = opts.colorOf || function () { return null; };
    var out = [];
    var hit = function (type, id, extra) { return it ? ' class="hit ' + type + '" data-' + type + '="' + esc(id) + '" tabindex="0" role="button"' + (extra || '') : ''; };
    var ehit = function (type, id) { return edit ? ' class="ed" data-edit="' + type + ':' + esc(id) + '"' : ''; };
    var isE = function (type, id) { return edit && esel && esel.type === type && esel.id === id; };
    var estroke = function (type, id, sw) { return isE(type, id) ? ' stroke="' + EDIT + '" stroke-width="' + (sw + 3) + '" stroke-dasharray="8 5"' : ''; };

    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"' +
      ' font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif" fill="#000">');
    out.push('<defs><pattern id="' + pid + '-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="' + HATCH + '" stroke-width="2.5"/></pattern></defs>');
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"' + (edit ? ' data-edit="none:0"' : '') + '/>');
    if (edit && layout.background && layout.background.dataUrl && layout.background.show !== false) {
      out.push('<image href="' + layout.background.dataUrl + '" x="0" y="0" width="' + W + '" height="' + H + '" preserveAspectRatio="xMidYMid meet" opacity="' + (layout.background.opacity || 0.5) + '" data-edit="none:0"/>');
    }

    (layout.blocks || []).forEach(function (b) {
      out.push('<g' + ehit('block', b.id) + '><path d="' + blockPath(b) + '" fill="' + (b.fill || '#fff') + '" stroke="' + INK + '" stroke-width="4"' + estroke('block', b.id, 4) + '/>');
      if (b.label) out.push(text(b.x + b.w / 2 + (b.labelDx || 0), b.y + b.h / 2 + (b.labelDy || 0), b.label, b.fontSize || 30));
      out.push('</g>');
    });

    var a = layout.altar;
    if (a) {
      out.push('<g' + ehit('altar', 'altar') + '>' + '<rect x="' + a.x + '" y="' + a.y + '" width="' + a.w + '" height="' + a.h + '" fill="' + (a.fill || '#B1510F') + '" stroke="' + INK + '" stroke-width="4"' + estroke('altar', 'altar', 4) + '/>');
      var inn = a.inner;
      out.push(rect(inn.x, inn.y, inn.w, inn.h, a.fill || '#B1510F', 4));
      out.push(text(inn.x + inn.w / 2, inn.y + inn.h / 2, a.label || 'Altar', 26, { fill: '#fff' }));
      var cups = plan.cups || layout.cups || { left: 0, right: 0 }, cy = inn.y + inn.h / 2 + 9;
      cupRow(clamp(cups.left, 0, MAX_CUPS), inn.x - 4, -1, cy).forEach(function (c) { out.push(cup(c.cx, c.cy)); });
      cupRow(clamp(cups.right, 0, MAX_CUPS), inn.x + inn.w + 4, 1, cy).forEach(function (c) { out.push(cup(c.cx, c.cy)); });
      out.push('</g>');
    }

    (layout.markers || []).forEach(function (m) {
      out.push('<g' + ehit('marker', m.id) + '>' + rect(m.x, m.y, MARKER, MARKER, '#fff', 2.5) + text(m.x + MARKER / 2, m.y + MARKER / 2 + 1, m.id, 20, { bold: true }) +
        (isE('marker', m.id) ? rect(m.x - 3, m.y - 3, MARKER + 6, MARKER + 6, 'none', 3, EDIT) : '') + '</g>');
    });

    (layout.seats || []).forEach(function (s) {
      var w = s.w || SEAT_W, h = s.h || SEAT_H, name = seats[s.id] || '', col = name ? (colorOf(name) || '#fff') : '#fff';
      var isSel = sel && sel.type === 'seat' && sel.id === s.id, show = !s.quiet || name || it;
      out.push('<g' + hit('seat', s.id, ' aria-label="Seat ' + esc(s.id) + (name ? ': ' + esc(name) : ' (empty)') + '"') + ehit('seat', s.id) + '>');
      if (name) out.push('<title>' + esc('Seat ' + s.id + ': ' + name) + '</title>');
      out.push(rect(s.x, s.y, w, h, col, isSel ? 5 : 2.5, isSel ? SELECT : INK));
      if (show) out.push(text(s.x + w / 2, s.y + h / 2 + 1, s.id, w > 36 ? 19 : 20, { bold: true, fill: dark(col) ? '#fff' : (s.quiet && !name ? '#7a8ea3' : '#000') }));
      if (isE('seat', s.id)) out.push(rect(s.x - 3, s.y - 3, w + 6, h + 6, 'none', 3, EDIT));
      out.push('</g>');
    });

    var st = plan.stations || {};
    stationsFor(layout, plan).forEach(function (s) {
      var val = (st[s.group] || [])[s.index], txt = val == null ? '' : String(val), key = s.group + '-' + s.index;
      var occupant = txt ? seats[txt] : '', col = occupant ? (colorOf(occupant) || '#fff') : '#fff';
      var isSel = sel && sel.type === 'station' && sel.id === key, half = STATION / 2;
      out.push('<g transform="rotate(' + s.rot + ' ' + s.cx + ' ' + s.cy + ')"' + hit('station', key, ' aria-label="Serving station ' + esc(key) + (txt ? ': seat ' + esc(txt) : ' (empty)') + '"') + '>');
      out.push(rect(s.cx - half, s.cy - half, STATION, STATION, col, 0, 'none'));
      out.push(rect(s.cx - half, s.cy - half, STATION, STATION, 'url(#' + pid + '-hatch)', isSel ? 5 : 2.5, isSel ? SELECT : INK));
      if (txt) out.push(text(s.cx, s.cy + 1, txt, 20, { bold: true, fill: dark(col) ? '#fff' : '#000' }));
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
    render: render, esc: esc, clamp: clamp, clone: clone, dark: dark,
    seatIds: seatIds, defaultStations: defaultStations, blankStations: blankStations, stationsFor: stationsFor, newId: newId, blankLayout: blankLayout
  };
})(window);

/*
 * The printable documents. Each one is drawn straight into a PDF with jsPDF,
 * in millimetres, following the layout of the sheet it comes from:
 *
 *   Music Program   the "Music Program 20xx" sheet, A4 portrait
 *   Before service  the "Before service" sheet, A4 landscape
 *   Preparation     the "Preparation" sheet, A4 landscape
 *   Practice sheet  the working sheet for one choir practice, A4 portrait
 *
 * Column widths come from the workbook: an Excel column of w characters is
 * 7w + 5 screen pixels, and a pixel is 25.4/96 mm.
 */
(function (global) {
  'use strict';

  var M = global.Model, H = global.Hymns;
  var BLUE = [0, 112, 192];          // the sheet's heading colour, #0070C0
  var INK = [0, 0, 0];
  var PT = 0.3527777778;             // one point in mm
  function ch(w) { return (7 * w + 5) * 25.4 / 96; }   // Excel column width in mm

  // --------------------------------------------------------------- drawing
  function Pen(doc) { this.doc = doc; }
  Pen.prototype.font = function (size, bold, color, italic) {
    this.doc.setFont('helvetica', bold ? (italic ? 'bolditalic' : 'bold') : (italic ? 'italic' : 'normal'));
    this.doc.setFontSize(size);
    var c = color || INK;
    this.doc.setTextColor(c[0], c[1], c[2]);
    return this;
  };
  Pen.prototype.stroke = function (width, color) {
    var c = color || INK;
    this.doc.setDrawColor(c[0], c[1], c[2]);
    this.doc.setLineWidth(width);
    return this;
  };
  Pen.prototype.rect = function (x, y, w, h, width) {
    this.stroke(width || 0.25).doc.rect(x, y, w, h);
    return this;
  };
  Pen.prototype.line = function (x1, y1, x2, y2, width) {
    this.stroke(width || 0.25).doc.line(x1, y1, x2, y2);
    return this;
  };
  // Text on the vertical centre of a row, clipped to a width: shrink a little
  // first, then cut with an ellipsis, so a long hymn title never runs over the
  // next column.
  Pen.prototype.text = function (s, x, y, h, o) {
    s = String(s == null ? '' : s);
    if (!s) return this;
    o = o || {};
    var size = o.size || 10, min = o.min || Math.max(6, size - 2.5);
    this.font(size, o.bold, o.color, o.italic);
    if (o.width) {
      while (this.doc.getTextWidth(s) > o.width && size > min) {
        size -= 0.25;
        this.font(size, o.bold, o.color, o.italic);
      }
      if (this.doc.getTextWidth(s) > o.width) {
        while (s.length > 1 && this.doc.getTextWidth(s + '…') > o.width) s = s.slice(0, -1);
        s += '…';
      }
    }
    var ty = y + h / 2 + size * PT * 0.36;
    if (o.align === 'center') this.doc.text(s, x, ty, { align: 'center' });
    else if (o.align === 'right') this.doc.text(s, x, ty, { align: 'right' });
    else this.doc.text(s, x, ty);
    return this;
  };
  Pen.prototype.wrap = function (s, x, y, width, o) {
    o = o || {};
    var size = o.size || 9;
    this.font(size, o.bold, o.color);
    var lines = this.doc.splitTextToSize(String(s || ''), width);
    var lead = o.lead || size * PT * 1.35;
    for (var i = 0; i < lines.length; i++) this.doc.text(lines[i], x, y + size * PT * 0.85 + i * lead);
    return y + lines.length * lead;
  };

  /*
   * The church emblem at the head of the music programme. The artwork is on the
   * page as a hidden image; drawEmblem falls back to the shape below only if it
   * has not loaded, so a programme is never printed without one.
   */
  function emblemArt() {
    var img = document.getElementById('emblem-art');
    return (img && img.complete && img.naturalWidth) ? img : null;
  }
  function drawEmblem(doc, cx, top, height) {
    var img = emblemArt();
    if (img) {
      var w = height * img.naturalWidth / img.naturalHeight;
      doc.addImage(img, 'PNG', cx - w / 2, top, w, height);
      return;
    }
    emblem(doc, cx, top, height);
  }
  function emblem(doc, cx, top, size) {
    var s = size, x0 = cx - s / 2, y0 = top, i, a, r;
    var P = function (ux, uy) { return [x0 + ux * s, y0 + uy * s]; };
    doc.setDrawColor(91, 155, 213);
    doc.setFillColor(255, 255, 255);

    // rays fanning out from behind the foot of the cross
    doc.setLineWidth(s * 0.008);
    var ox = x0 + 0.5 * s, oy = y0 + 0.60 * s;
    for (i = 0; i < 6; i++) {
      a = (-52 + i * 17) * Math.PI / 180;
      for (var side = -1; side <= 1; side += 2) {
        var dx = Math.cos(a) * side, dy = Math.sin(a);
        doc.line(ox + dx * s * 0.10, oy + dy * s * 0.10, ox + dx * s * 0.35, oy + dy * s * 0.35);
      }
    }

    // the cross, outlined
    var a2 = 0.052, b = 0.20, t1 = 0.175, t2 = 0.275, tp = 0.03, bt = 0.77, c = 0.5;
    var pts = [[c - a2, tp], [c + a2, tp], [c + a2, t1], [c + b, t1], [c + b, t2], [c + a2, t2],
               [c + a2, bt], [c - a2, bt], [c - a2, t2], [c - b, t2], [c - b, t1], [c - a2, t1]];
    var start = P(pts[0][0], pts[0][1]), rel = [];
    for (i = 1; i < pts.length; i++) {
      rel.push([(pts[i][0] - pts[i - 1][0]) * s, (pts[i][1] - pts[i - 1][1]) * s]);
    }
    rel.push([(pts[0][0] - pts[pts.length - 1][0]) * s, (pts[0][1] - pts[pts.length - 1][1]) * s]);
    doc.setLineWidth(s * 0.014);
    doc.lines(rel, start[0], start[1], [1, 1], 'FD', true);

    // the water
    doc.setLineWidth(s * 0.035);
    doc.setLineCap('round');
    var bars = [[0.845, 0.40], [0.905, 0.29], [0.955, 0.17]];
    for (i = 0; i < bars.length; i++) {
      r = bars[i][1];
      doc.line(x0 + (0.5 - r) * s, y0 + bars[i][0] * s, x0 + (0.5 + r) * s, y0 + bars[i][0] * s);
    }
    doc.setLineCap('butt');
  }

  function newDoc(orientation) {
    var jsPDF = global.jspdf && global.jspdf.jsPDF;
    if (!jsPDF) throw new Error('The PDF library did not load.');
    return new jsPDF({ orientation: orientation, unit: 'mm', format: 'a4', compress: true });
  }

  function refAndTitle(ref) {
    var r = H.normRef(ref);
    return { ref: r, title: r ? H.title(r) : '' };
  }

  // --------------------------------------------------- the music programme
  /*
   * The "Music Program" sheet: emblem, the congregation and date band, then a
   * boxed row for every hymn under a blue section heading, and the conductor
   * and organist at the foot.
   */
  function buildProgram(service) {
    var doc = newDoc('portrait'), p = new Pen(doc);
    var wA = ch(3.71), wB = ch(4.71), wC = ch(20.86), wD = ch(18), wE = ch(47.86);
    var total = wA + wB + wC + wD + wE + ch(4.29);
    var xA = (210 - total) / 2, xB = xA + wA, xC = xB + wB, xD = xC + wC, xE = xD + wD;
    var right = xE + wE, boxW = right - xB;
    var pad = 1.6;

    var hLogo = 44.2, hBand = 9.0, hGap = 4.2, hTitle = 7.9, hRow = 6.9, hSpace = 5.3;
    var sections = (service.program.sections || []).filter(function (s) {
      return (s.rows || []).length || s.label;
    });
    var needed = hLogo + hBand + hGap + hTitle;
    function rowHeight(r, h) { return r.note ? h * 1.5 : h; }
    sections.forEach(function (s) {
      needed += hRow + hSpace;
      (s.rows || []).forEach(function (r) { needed += rowHeight(r, hRow); });
    });
    needed += 2 * hRow;
    var avail = 297 - 19 - 12;
    var k = needed > avail ? Math.max(0.62, avail / needed) : 1;
    if (k < 1) { hLogo *= k; hBand *= k; hGap *= k; hTitle *= k; hRow *= k; hSpace *= k; }
    var fRow = Math.min(10, 10 * Math.max(0.8, k));

    var y = 12;
    drawEmblem(doc, (xB + right) / 2, y, Math.min(hLogo, 42));
    y += hLogo;

    // congregation and date, in one band, meeting at the C/D column boundary
    p.rect(xB, y, boxW, hBand, 0.25);
    var split = xE;
    p.text(service.congregation, split - 3, y, hBand, { size: 13, bold: true, align: 'right', color: BLUE, width: xE - xB - 6 });
    p.text(M.formatDate(service.date), split + 3, y, hBand, { size: 13, bold: true, color: BLUE, width: wE - 6 });
    y += hBand + hGap;

    p.text('Hymn Program', (xB + right) / 2, y, hTitle, { size: 11, bold: true, align: 'center', color: BLUE });
    y += hTitle;

    sections.forEach(function (s) {
      p.text(s.label, xA, y, hRow, { size: 10, bold: true, color: BLUE, width: total });
      y += hRow;
      var rows = s.rows || [];
      rows.forEach(function (r, i) {
        var rt = refAndTitle(r.ref), rh = rowHeight(r, hRow);
        p.rect(xB, y, boxW, rh, 0.25);
        p.line(xC, y, xC, y + rh, 0.25);
        p.line(xD, y, xD, y + rh, 0.25);
        p.line(xE, y, xE, y + rh, 0.25);
        if (i) p.line(xB, y, right, y, 0.1);
        // The congregation's own hymns are the bold ones, as the workbook had
        // them: they are what the congregation looks for on the sheet.
        var bold = /congregation/i.test(r.who || '');
        p.text(String(i + 1), xB + wB / 2, y, hRow, { size: fRow, bold: bold, align: 'center' });
        p.text(r.who || '', xC + pad, y, hRow, { size: fRow, bold: bold, width: wC - 2 * pad });
        p.text(rt.ref, xD + pad, y, hRow, { size: fRow, bold: bold, width: wD - 2 * pad });
        p.text(rt.title, xE + pad, y, hRow, { size: fRow, bold: bold, width: wE - 2 * pad });
        // the note belongs to this hymn, so it sits under its reference rather
        // than at the foot of the section
        if (r.note) {
          p.text(r.note, xD + pad, y + hRow - 0.6, rh - hRow, { size: fRow - 1.5, italic: true, width: wD - 2 * pad });
        }
        y += rh;
      });
      y += hSpace;
    });

    // the conductor and organist, boxed at the foot
    var fy = y;
    p.rect(xB, fy, boxW, 2 * hRow, 0.25);
    p.line(xB, fy + hRow, right, fy + hRow, 0.1);
    p.line(xD, fy, xD, fy + 2 * hRow, 0.1);
    p.text('Choir-conductor:', xB + pad, fy, hRow, { size: 9, bold: true, width: wB + wC - 2 * pad });
    p.text(service.conductor || '', xD + pad, fy, hRow, { size: 9, width: right - xD - 2 * pad });
    p.text('Organist:', xB + pad, fy + hRow, hRow, { size: 9, bold: true, width: wB + wC - 2 * pad });
    p.text(service.organist || '', xD + pad, fy + hRow, hRow, { size: 9, width: right - xD - 2 * pad });

    doc.setProperties({ title: 'Music Program ' + M.yearOf(service.date) + ' – ' + M.serviceTitle(service) });
    return doc;
  }

  // ------------------------------------------------ the before-service list
  /*
   * The "Before service" sheet: the running order timed back from the start of
   * the service, the exit music, who is on duty and the checklist. The columns
   * keep the proportions of the sheet, widened to the printable page.
   */
  function buildBefore(service) {
    var doc = newDoc('landscape'), p = new Pen(doc);
    var raw = [ch(13.14), ch(14.86), ch(32.86), ch(2.43) + ch(18.43), ch(8.71)];
    var sum = raw.reduce(function (a, b) { return a + b; }, 0), k = 235 / sum;
    var w = raw.map(function (v) { return v * k; });
    var total = 235, x0 = (297 - total) / 2, pad = 1.6, hRow = 5.6;
    var xs = [x0], i;
    for (i = 0; i < w.length - 1; i++) xs.push(xs[i] + w[i]);
    var sched = M.beforeSchedule(service);
    var y = 14;

    p.text(service.before.title || M.serviceTitle(service), x0, y, 7, { size: 13, bold: true, width: total });
    y += 9;
    p.text('Before Service Programme', x0, y, 6, { size: 12, bold: true, width: total });
    y += 8;

    function row(cells, o) {
      o = o || {};
      // "skipFirst" leaves the first column alone so the exit rows can sit
      // under one label, the way the sheet merges that cell.
      var left = o.skipFirst ? xs[1] : x0;
      p.rect(left, y, x0 + total - left, hRow, o.heavy ? 0.4 : 0.25);
      for (var j = o.skipFirst ? 2 : 1; j < xs.length; j++) p.line(xs[j], y, xs[j], y + hRow, 0.25);
      cells.forEach(function (c, n) {
        if (c == null || c === '') return;
        var center = n === 0 || n === 4;
        p.text(c, center ? xs[n] + w[n] / 2 : xs[n] + pad, y, hRow,
          { size: 9.5, bold: o.bold, align: center ? 'center' : 'left', width: w[n] - 2 * pad });
      });
      y += hRow;
    }
    function mins(n) { return n ? (n + ' min') : ''; }

    row(['Time', 'Reference', 'Title', 'Discipline', 'Duration'], { bold: true, heavy: true });
    sched.rows.forEach(function (r) {
      if (r.silence) return row([r.time, 'Silence', '', '', mins(r.minutes)], { bold: true });
      var rt = refAndTitle(r.item.ref);
      row([r.time, rt.ref, rt.title || r.item.note || '', r.item.discipline, mins(r.minutes)]);
    });
    p.rect(x0, y, total, hRow * 0.55, 0.4);
    y += hRow * 0.55;

    // the exit music, under one label spanning its rows as on the sheet
    var exit = service.before.exit || [], exitTop = y;
    exit.forEach(function (e) {
      var rt = refAndTitle(e.ref);
      row(['', rt.ref, rt.title || e.note || '', e.discipline, mins(Number(e.minutes) || 0)], { skipFirst: true });
    });
    if (exit.length) {
      p.rect(x0, exitTop, w[0], y - exitTop, 0.25);
      p.text('After Service (Exit)', x0 + w[0] / 2, exitTop, y - exitTop,
        { size: 9.5, bold: true, align: 'center', width: w[0] - 2 * pad });
    }
    y += 9;

    // who is on duty
    var lw = total * 0.30, cw = total * 0.32, bx = x0 + lw + cw + total * 0.04;
    p.text('Main', x0 + lw, y, hRow, { size: 9.5, bold: true });
    p.text('Back-up', bx, y, hRow, { size: 9.5, bold: true });
    y += hRow;
    M.BS_CREW_ROLES.forEach(function (role) {
      var c = (service.before.crew || {})[role] || {};
      p.text(role + ':', x0, y, hRow + 1, { size: 11, bold: true, width: lw - 3 });
      p.text(c.main || '', x0 + lw + 1, y, hRow + 1, { size: 10, width: cw - 4 });
      p.line(x0 + lw, y + hRow + 1, x0 + lw + cw - 3, y + hRow + 1, 0.2);
      p.text(c.backup || '', bx + 1, y, hRow + 1, { size: 10, width: total - lw - cw - total * 0.04 - 2 });
      p.line(bx, y + hRow + 1, x0 + total, y + hRow + 1, 0.2);
      y += hRow + 1.6;
    });
    y += 5;

    p.text('Checklist', x0, y, 4.5, { size: 9.5, bold: true });
    y += 5;
    (service.before.checklist || []).forEach(function (t) {
      y = p.wrap('•   ' + t, x0, y, total, { size: 8 }) + 0.8;
    });

    doc.setProperties({ title: 'Before service – ' + M.serviceTitle(service) });
    return doc;
  }

  // ------------------------------------------------- the preparation form
  /*
   * The "Preparation" sheet: the festive divine service preparation form, with
   * the practice grids, a programme per discipline and the signature lines.
   * Everything flows down the page and carries over to a second one if the
   * programmes have grown too long for the first.
   */
  function buildPrep(service) {
    var doc = newDoc('landscape'), p = new Pen(doc);
    var prep = service.prep || {};
    var total = 235, x0 = (297 - total) / 2, right = x0 + total;
    var halfW = total * 0.46, rightX = x0 + total * 0.54;
    var labW = 42, hRow = 5.4, bottom = 196;
    var y = 12;

    function space(need) {
      if (y + need <= bottom) return;
      doc.addPage();
      y = 14;
    }
    function underlined(x, w, label, value, opts) {
      opts = opts || {};
      var lw = opts.labelWidth == null ? labW : opts.labelWidth;
      if (label) p.text(label, x, y, hRow, { size: 10, bold: true, width: lw - 2 });
      p.text(value || '', x + lw + 1, y, hRow, { size: 10, width: w - lw - 2 });
      p.line(x + lw, y + hRow, x + w, y + hRow, 0.2);
    }

    p.rect(x0, y, total, 10, 0.4);
    p.text('Festive Divine Service Preparation', x0 + total / 2, y, 10, { size: 18, bold: true, align: 'center' });
    y += 15;

    [['Event:', prep.event, 'Invited:', prep.invited],
     ['Date:', M.formatDate(prep.date, true), '', ''],
     ['Venue:', prep.venue, '', ''],
     ['Time:', prep.time, '', ''],
     ['Project Coordinator:', prep.coordinator, 'Contact no.', prep.contact]].forEach(function (r) {
      underlined(x0, halfW, r[0], r[1]);
      if (r[2]) underlined(rightX, halfW, r[2], r[3]);
      y += hRow + 1.6;
    });
    y += 4;

    // who is on duty, main and back-up
    var mainX = x0 + total * 0.32, mainW = total * 0.30, backX = x0 + total * 0.66, backW = total * 0.34;
    p.text('MAIN', mainX, y, hRow, { size: 10, bold: true });
    p.text('BACK-UP', backX, y, hRow, { size: 10, bold: true });
    y += hRow + 1;
    M.CREW_ROLES.forEach(function (role) {
      var c = (prep.crew || {})[role] || {};
      p.text(role + ':', x0, y, hRow, { size: 10, bold: true, width: total * 0.30 });
      p.text(c.main || '', mainX + 1, y, hRow, { size: 10, width: mainW - 4 });
      p.line(mainX, y + hRow, mainX + mainW - 3, y + hRow, 0.2);
      p.text(c.backup || '', backX + 1, y, hRow, { size: 10, width: backW - 3 });
      p.line(backX, y + hRow, right, y + hRow, 0.2);
      y += hRow + 1.6;
    });
    y += 4;

    // the practice grids: seven columns of dates, times and venues
    var gx = x0 + total * 0.28, gw = right - gx, cellW = gw / 7;
    Object.keys(prep.practices || {}).forEach(function (name) {
      var pr = prep.practices[name] || {};
      space(3 * hRow + 4);
      ['dates', 'times', 'venues'].forEach(function (key, i) {
        if (i === 0) p.text(name + ':', x0, y, hRow, { size: 10, bold: true, width: total * 0.18 });
        p.text(['Dates', 'Times', 'Venue'][i], x0 + total * 0.19, y, hRow, { size: 9, width: total * 0.08 });
        for (var c = 0; c < 7; c++) {
          p.rect(gx + c * cellW, y, cellW, hRow, 0.25);
          p.text((pr[key] || [])[c] || '', gx + c * cellW + cellW / 2, y, hRow,
            { size: 8.5, align: 'center', width: cellW - 2 });
        }
        y += hRow;
      });
      y += 2.5;
    });
    y += 2;

    /*
     * The programmes sit in two columns, choir and its companions on the left,
     * orchestra and organ on the right, exactly as the sheet has them.
     */
    function programme(x, title, rows) {
      var out = [{ head: title }];
      rows.forEach(function (r) { out.push(r); });
      return out;
    }
    function drawBlock(x, blocks, startY) {
      var yy = startY;
      blocks.forEach(function (b) {
        if (b.head) {
          p.text(b.head, x, yy, hRow, { size: 10, bold: true, width: halfW });
          yy += hRow + 0.5;
          return;
        }
        if (b.gap) { yy += b.gap; return; }
        var tx = b.slot || b.ref ? x + 34 : x;
        if (b.slot) p.text(b.slot, x, yy, hRow, { size: 9.5, bold: true, width: 14 });
        if (b.ref) p.text(b.ref, x + 15, yy, hRow, { size: 9.5, bold: true, width: 18 });
        p.text(b.text || '', tx, yy, hRow, { size: 9.5, width: halfW - (tx - x) });
        p.line(x, yy + hRow, x + halfW, yy + hRow, 0.2);
        yy += hRow + 1;
      });
      return yy;
    }
    var leftBlocks = programme(x0, 'Choir Programme', (prep.choir || []).map(function (it) {
      var rt = refAndTitle(it.ref);
      return { slot: it.slot, ref: rt.ref, text: rt.title };
    }));
    leftBlocks.push({ gap: 4 });
    leftBlocks = leftBlocks.concat(programme(x0, 'Recorder Programme',
      (prep.recorder || []).map(function (t) { return { text: t }; })));
    leftBlocks.push({ gap: 4 });
    leftBlocks = leftBlocks.concat(programme(x0, 'Sunday School Choir Programme',
      (prep.sundaySchool || []).map(function (t) { return { text: t }; })));

    var rightBlocks = programme(rightX, 'Orchestra Programme',
      (prep.orchestra || []).map(function (t) { return { text: t }; }));
    rightBlocks.push({ gap: 4 });
    rightBlocks = rightBlocks.concat(programme(rightX, 'Organ Programme',
      (prep.organ || []).map(function (t) { return { text: t }; })));

    function blockHeight(blocks) {
      return blocks.reduce(function (a, b) {
        return a + (b.head ? hRow + 0.5 : (b.gap ? b.gap : hRow + 1));
      }, 0);
    }
    space(Math.max(blockHeight(leftBlocks), blockHeight(rightBlocks)) + 4);
    var endLeft = drawBlock(x0, leftBlocks, y);
    var endRight = drawBlock(rightX, rightBlocks, y);
    y = Math.max(endLeft, endRight) + 8;

    space(2 * hRow + 12);
    p.text('Signature of rector / district rector responsible:', x0, y, hRow, { size: 10, bold: true, width: 92 });
    p.line(x0 + 94, y + hRow, x0 + 174, y + hRow, 0.2);
    y += hRow + 7;
    p.text('Signature of Area Music Leader:', x0, y, hRow, { size: 10, bold: true, width: 92 });
    p.line(x0 + 94, y + hRow, x0 + 164, y + hRow, 0.2);
    p.text('Date:', x0 + 172, y, hRow, { size: 10, bold: true });
    p.line(x0 + 186, y + hRow, right, y + hRow, 0.2);

    doc.setProperties({ title: 'Festive Divine Service Preparation – ' + M.serviceTitle(service) });
    return doc;
  }

  // ------------------------------------------------------ the practice sheet
  /*
   * The working sheet for one practice: what to rehearse, for how long and what
   * to listen for, with the pieces the service needs listed underneath so the
   * conductor can see what is still unrehearsed.
   */
  function buildPractice(service, practice) {
    var doc = newDoc('portrait'), p = new Pen(doc);
    var x0 = 15, total = 180, right = x0 + total, hRow = 7, pad = 1.6, y = 16;

    p.text('Choir Practice', x0, y, 8, { size: 16, bold: true, color: BLUE });
    p.text(M.formatDate(practice.date, true) + (practice.start ? '  ·  ' + practice.start : ''), right, y, 8,
      { size: 11, bold: true, align: 'right' });
    y += 9;
    var sub = [practice.venue, service.congregation, 'for ' + M.serviceTitle(service)].filter(Boolean).join('  ·  ');
    p.text(sub, x0, y, 5, { size: 9.5, width: total });
    y += 7;
    if (practice.focus) {
      p.text('Focus: ' + practice.focus, x0, y, 5, { size: 10, bold: true, width: total });
      y += 7;
    }

    var wRef = 22, wAbility = 22, wMin = 18, wFocus = 50, wTitle = total - wRef - wAbility - wMin - wFocus;
    var xTitle = x0 + wRef, xAb = xTitle + wTitle, xMin = xAb + wAbility, xFocus = xMin + wMin;
    function gridRow(cells, bold, fill) {
      if (fill) { doc.setFillColor(238, 242, 248); doc.rect(x0, y, total, hRow, 'F'); }
      p.rect(x0, y, total, hRow, 0.3);
      [xTitle, xAb, xMin, xFocus].forEach(function (x) { p.line(x, y, x, y + hRow, 0.2); });
      var xs = [x0, xTitle, xAb, xMin, xFocus], ws = [wRef, wTitle, wAbility, wMin, wFocus];
      cells.forEach(function (c, i) {
        if (c == null || c === '') return;
        var center = i === 2 || i === 3;
        p.text(c, center ? xs[i] + ws[i] / 2 : xs[i] + pad, y, hRow,
          { size: 9.5, bold: bold, align: center ? 'center' : 'left', width: ws[i] - 2 * pad });
      });
      y += hRow;
    }
    gridRow(['Ref', 'Title', 'Ability', 'Minutes', 'What to work on'], true, true);
    var totalMin = 0;
    (practice.items || []).forEach(function (it) {
      var h = H.get(it.ref), m = Number(it.minutes) || 0;
      totalMin += m;
      gridRow([H.normRef(it.ref), (h && h.title) || '', h ? H.abilityName(h.ability) : '',
               m ? String(m) : '', it.focus || (h && h.comment) || '']);
    });
    if (!(practice.items || []).length) gridRow(['', '', '', '', '']);
    var startMin = M.toMinutes(practice.start);
    var span = startMin == null || !totalMin ? '' :
      practice.start + ' – ' + M.fromMinutes(startMin + totalMin);
    gridRow(['', 'Total', '', totalMin ? String(totalMin) : '', span], true, true);
    y += 9;

    // what the service needs, ticked off against what this practice covers
    var pieces = M.choirPieces(service), planned = {};
    (practice.items || []).forEach(function (i) { planned[H.normRef(i.ref)] = true; });
    p.text('The service programme', x0, y, 6, { size: 11, bold: true, color: BLUE });
    y += 7;
    pieces.forEach(function (pc) {
      var h = H.get(pc.ref), box = 2.8;
      p.rect(x0 + 1, y + 1.4, box, box, 0.25);
      if (planned[pc.ref]) {
        p.line(x0 + 1.6, y + 2.8, x0 + 2.3, y + 3.6, 0.4);
        p.line(x0 + 2.3, y + 3.6, x0 + 3.6, y + 1.9, 0.4);
      }
      p.text(pc.section + ' · ' + pc.who, x0 + 6, y, 5.6, { size: 9, width: 62 });
      p.text(pc.ref, x0 + 70, y, 5.6, { size: 9, bold: true, width: 18 });
      p.text((h && h.title) || '', x0 + 90, y, 5.6, { size: 9, width: total - 90 });
      y += 5.6;
    });
    if (!pieces.length) {
      p.text('No choir items in the programme yet.', x0 + 1, y, 5.6, { size: 9, width: total });
      y += 5.6;
    }

    if (practice.notes) {
      y += 6;
      p.text('Notes', x0, y, 6, { size: 11, bold: true, color: BLUE });
      y += 7;
      y = p.wrap(practice.notes, x0, y, total, { size: 9.5 });
    }

    doc.setProperties({ title: 'Choir practice – ' + M.formatDate(practice.date, true) });
    return doc;
  }

  // ---------------------------------------------------------------- output
  function slug(s) { return String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  var DOCS = {
    program: {
      name: 'Music Program',
      build: buildProgram,
      file: function (s) { return ['Music_Program', M.yearOf(s.date), slug(s.congregation), s.date].filter(Boolean).join('_') + '.pdf'; }
    },
    before: {
      name: 'Before service',
      build: buildBefore,
      file: function (s) { return ['Before_Service', slug(s.congregation), s.date].filter(Boolean).join('_') + '.pdf'; }
    },
    prep: {
      name: 'Preparation',
      build: buildPrep,
      file: function (s) { return ['Preparation', slug(s.congregation), s.date].filter(Boolean).join('_') + '.pdf'; }
    },
    practice: {
      name: 'Practice sheet',
      build: buildPractice,
      file: function (s, pr) { return ['Choir_Practice', slug(s.congregation), (pr && pr.date) || s.date].filter(Boolean).join('_') + '.pdf'; }
    }
  };

  function create(kind, service, extra) {
    var d = DOCS[kind];
    if (!d) throw new Error('Unknown document: ' + kind);
    var doc = d.build(service, extra);
    return { blob: doc.output('blob'), name: d.file(service, extra), doc: doc, title: d.name };
  }
  function dataUrl(kind, service, extra) {
    return DOCS[kind].build(service, extra).output('datauristring');
  }
  function download(kind, service, extra) {
    var r = create(kind, service, extra);
    var url = URL.createObjectURL(r.blob), a = document.createElement('a');
    a.href = url; a.download = r.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return r.name;
  }
  function canShareFiles() {
    try {
      return !!(navigator.share && navigator.canShare &&
        navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
    } catch (e) { return false; }
  }
  function share(kind, service, extra) {
    var r = create(kind, service, extra);
    var file = new File([r.blob], r.name, { type: 'application/pdf' });
    if (canShareFiles() && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: r.title, text: M.serviceTitle(service) })
        .then(function () { return 'shared'; })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          download(kind, service, extra);
          return 'downloaded';
        });
    }
    download(kind, service, extra);
    return Promise.resolve('downloaded');
  }
  // Printing goes through the finished PDF rather than the page, so what comes
  // out of the printer is the same sheet that gets shared.
  function print(kind, service, extra) {
    var r = create(kind, service, extra), url = URL.createObjectURL(r.blob);
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    frame.src = url;
    frame.onload = function () {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(function () { URL.revokeObjectURL(url); frame.remove(); }, 60000);
    };
    document.body.appendChild(frame);
    return r.name;
  }

  global.Sheets = {
    DOCS: DOCS, create: create, dataUrl: dataUrl, download: download,
    share: share, print: print, canShareFiles: canShareFiles, emblem: drawEmblem
  };
})(window);

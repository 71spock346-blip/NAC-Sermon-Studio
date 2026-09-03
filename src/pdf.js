/*
 * Builds the printable A4 sheet (title, plan, legend, seating table, communion
 * table, note) as one SVG, rasterises it and wraps it in a PDF with jsPDF.
 */
(function (global) {
  'use strict';

  var A4_W = 595.28, A4_H = 841.89, MARGIN = 36;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var esc = global.Layout.esc;

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1] : (iso || '');
  }
  function subtitle(plan, layout) {
    return [layout && layout.name, formatDate(plan.date), plan.service].filter(Boolean).join(' – ');
  }
  function text(x, y, s, size, o) {
    o = o || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
      (o.bold ? ' font-weight="bold"' : '') + (o.fill ? ' fill="' + o.fill + '"' : '') + ' dominant-baseline="central">' + esc(s) + '</text>';
  }
  function cell(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" stroke="#000" stroke-width="0.6"/>';
  }
  // rows: [{cells:[...], fills:[...], header}] ; cols: widths
  function table(x, y, cols, rows, title) {
    var rowH = 18, size = 9.5, out = [], cy = y, totalW = cols.reduce(function (a, b) { return a + b; }, 0);
    if (title) { out.push(cell(x, cy, totalW, rowH, '#BFBFBF')); out.push(text(x + 4, cy + rowH / 2, title, size, { bold: true })); cy += rowH; }
    rows.forEach(function (r) {
      var cx = x;
      r.cells.forEach(function (c, i) {
        var fill = r.header ? '#BFBFBF' : ((r.fills && r.fills[i]) || '#FFFFFF');
        out.push(cell(cx, cy, cols[i], rowH, fill));
        if (c != null && c !== '') out.push(text(cx + 4, cy + rowH / 2, c, size, { bold: !!r.header, fill: global.Layout.dark(fill) ? '#fff' : '#000' }));
        cx += cols[i];
      });
      cy += rowH;
    });
    return { svg: out.join(''), bottom: cy };
  }
  function wrap(s, max) {
    var lines = [], cur = '';
    String(s || '').split(/\s+/).forEach(function (w) {
      if (!w) return;
      if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
    });
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  function buildPageSvg(layout, plan, colorOf) {
    var L = global.Layout, out = [], seats = plan.seats || {};
    colorOf = colorOf || function () { return null; };
    var col = function (seatId) { var n = seats[seatId]; return n ? (colorOf(n) || '#fff') : '#fff'; };
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + A4_W + '" height="' + A4_H + '" viewBox="0 0 ' + A4_W + ' ' + A4_H + '" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif" fill="#000">');
    out.push('<rect width="' + A4_W + '" height="' + A4_H + '" fill="#fff"/>');
    out.push(text(MARGIN, MARGIN + 12, 'Seating and Communion Plan', 20, { bold: true }));
    out.push(text(MARGIN, MARGIN + 36, subtitle(plan, layout), 14));

    var planW = A4_W - 2 * MARGIN, planH = planW * L.H / L.W, planY = MARGIN + 54;
    out.push(L.render(layout, plan, { idPrefix: 'pdf', colorOf: colorOf })
      .replace('<svg ', '<svg x="' + MARGIN + '" y="' + planY + '" ').replace('width="' + L.W + '" height="' + L.H + '"', 'width="' + planW + '" height="' + planH + '"'));

    // Legend of sections
    var lx = MARGIN, ly = planY + planH + 10;
    (layout.sections || []).forEach(function (s) {
      out.push(cell(lx, ly - 5, 10, 10, s.color) + text(lx + 14, ly, s.name, 8.5));
      lx += 14 + s.name.length * 4.6 + 14;
    });

    var tY = ly + 12, ids = L.seatIds(layout), half = Math.ceil(ids.length / 2), rows = [];
    for (var i = 0; i < half; i++) {
      var a = ids[i], b = ids[i + half];
      rows.push({ cells: [a, seats[a] || '', b || '', b ? (seats[b] || '') : ''], fills: [col(a), col(a), b ? col(b) : '#eee', b ? col(b) : '#eee'] });
    }
    var seatTable = table(MARGIN, tY, [24, 126, 24, 126], rows, 'Seating Arrangements');
    out.push(seatTable.svg);

    var cX = MARGIN + 300 + 16, cW = A4_W - MARGIN - cX, com = plan.communion || { serves: [], pairs: [] };
    var crows = [{ cells: ['Serves', 'Takes Cup', 'Takes Inner'], header: true }];
    (com.serves || []).forEach(function (s) { crows.push({ cells: [s.seat || '', s.text || '', ''], fills: [col(s.seat), '#fff', '#fff'] }); });
    (com.pairs || []).forEach(function (p) { crows.push({ cells: ['', p[0] || '', p[1] || ''], fills: ['#fff', col(p[0]), col(p[1])] }); });
    while (crows.length < rows.length + 1) crows.push({ cells: ['', '', ''] });
    var c0 = Math.round(cW * 0.2), c1 = Math.round(cW * 0.47);
    var comTable = table(cX, tY, [c0, c1, cW - c0 - c1], crows, 'Communion');
    out.push(comTable.svg);

    var nY = Math.max(seatTable.bottom, comTable.bottom) + 18;
    wrap(plan.note, 100).forEach(function (line, i) { out.push(text(MARGIN, nY + i * 15, line, 11)); });
    out.push('</svg>');
    return out.join('');
  }

  function svgToPng(svg, scale) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = Math.round(A4_W * scale); c.height = Math.round(A4_H * scale);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not render the plan image.')); };
      img.src = url;
    });
  }
  function slug(s) { return String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function fileName(plan, layout) { return ['Seating', slug(layout && layout.name), plan.date, slug(plan.service)].filter(Boolean).join('_') + '.pdf'; }

  function createPdf(layout, plan, colorOf) {
    return svgToPng(buildPageSvg(layout, plan, colorOf), 3).then(function (png) {
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');
      var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
      doc.addImage(png, 'PNG', 0, 0, A4_W, A4_H, undefined, 'FAST');
      doc.setProperties({ title: 'Seating and Communion Plan – ' + subtitle(plan, layout) });
      return { blob: doc.output('blob'), name: fileName(plan, layout) };
    });
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  function canShareFiles() {
    try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); }
    catch (e) { return false; }
  }
  function share(layout, plan, colorOf) {
    return createPdf(layout, plan, colorOf).then(function (r) {
      var file = new File([r.blob], r.name, { type: 'application/pdf' });
      if (canShareFiles() && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Seating and Communion Plan', text: subtitle(plan, layout) })
          .then(function () { return 'shared'; })
          .catch(function (e) { if (e && e.name === 'AbortError') return 'cancelled'; download(r.blob, r.name); return 'downloaded'; });
      }
      download(r.blob, r.name);
      return 'downloaded';
    });
  }

  global.PdfExport = { buildPageSvg: buildPageSvg, createPdf: createPdf, download: download, share: share, canShareFiles: canShareFiles, formatDate: formatDate, subtitle: subtitle };
})(window);

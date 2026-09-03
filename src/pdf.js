/*
 * Builds the printable A4 sheet (title, floor plan, seating table, communion
 * table, note) as one SVG, rasterises it and wraps it in a PDF with jsPDF.
 */
(function (global) {
  'use strict';

  var A4_W = 595.28, A4_H = 841.89, MARGIN = 36;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ROW_FILL = { yellow: '#FFD966', green: '#A8D08D', blue: '#8EAADB', white: '#FFFFFF' };
  var esc = global.Layout.esc;

  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  function subtitle(plan) {
    return [plan.congregation, formatDate(plan.date), plan.service].filter(Boolean).join(' – ');
  }

  function text(x, y, s, size, opts) {
    opts = opts || {};
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' +
      (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') +
      (opts.bold ? ' font-weight="bold"' : '') +
      (opts.fill ? ' fill="' + opts.fill + '"' : '') +
      ' dominant-baseline="central">' + esc(s) + '</text>';
  }

  function cell(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill +
      '" stroke="#000" stroke-width="0.6"/>';
  }

  // Draws a simple grid table. rows: [{cells:[..], fill}] ; cols: widths.
  function table(x, y, cols, rows, opts) {
    opts = opts || {};
    var rowH = opts.rowH || 18, size = opts.size || 9.5, out = [];
    var totalW = cols.reduce(function (a, b) { return a + b; }, 0);
    var cy = y;
    if (opts.title) {
      out.push(cell(x, cy, totalW, rowH, '#BFBFBF'));
      out.push(text(x + 4, cy + rowH / 2, opts.title, size, { bold: true }));
      cy += rowH;
    }
    rows.forEach(function (r) {
      var cx = x;
      r.cells.forEach(function (c, i) {
        out.push(cell(cx, cy, cols[i], rowH, r.header ? '#BFBFBF' : (r.fill || '#FFFFFF')));
        if (c != null && c !== '') out.push(text(cx + 4, cy + rowH / 2, c, size, { bold: !!r.header || !!(r.boldCols && r.boldCols[i]) }));
        cx += cols[i];
      });
      cy += rowH;
    });
    return { svg: out.join(''), bottom: cy };
  }

  function wrap(s, maxChars) {
    var words = String(s || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      if (!w) return;
      if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur.trim()); cur = w; }
      else cur = (cur + ' ' + w);
    });
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  function buildPageSvg(plan) {
    var L = global.Layout;
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + A4_W + '" height="' + A4_H + '" viewBox="0 0 ' + A4_W + ' ' + A4_H + '"' +
      ' font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif" fill="#000">');
    out.push('<rect width="' + A4_W + '" height="' + A4_H + '" fill="#fff"/>');
    out.push(text(MARGIN, MARGIN + 12, 'Seating and Communion Plan', 20, { bold: true }));
    out.push(text(MARGIN, MARGIN + 36, subtitle(plan), 14));

    // Floor plan
    var planW = A4_W - 2 * MARGIN, planH = planW * 800 / 1100, planY = MARGIN + 54;
    var planSvg = L.renderPlan(plan, { interactive: false, idPrefix: 'pdf' })
      .replace('<svg ', '<svg x="' + MARGIN + '" y="' + planY + '" ');
    out.push(planSvg.replace('width="1100" height="800"', 'width="' + planW + '" height="' + planH + '"'));

    // Seating arrangements table (two columns of seats)
    var tY = planY + planH + 14;
    var seats = plan.seats || {};
    var rows = [];
    for (var i = 1; i <= 11; i++) {
      var left = String(i), right = String(i + 11);
      rows.push({ cells: [left, seats[left] || '', right, seats[right] || ''], fill: ROW_FILL[L.SEAT_GROUP[left]] || '#fff' });
    }
    var seatTable = table(MARGIN, tY, [24, 126, 24, 126], rows, { title: 'Seating Arrangements' });
    out.push(seatTable.svg);

    // Communion table
    var cX = MARGIN + 300 + 16, cW = A4_W - MARGIN - cX;
    var com = plan.communion || { serves: [], pairs: [] };
    var crows = [{ cells: ['Serves', 'Takes Cup', 'Takes Inner'], header: true }];
    (com.serves || []).forEach(function (s) { crows.push({ cells: [s.seat || '', s.text || '', ''] }); });
    (com.pairs || []).forEach(function (p) { crows.push({ cells: ['', p[0] || '', p[1] || ''] }); });
    while (crows.length < 12) crows.push({ cells: ['', '', ''] });
    var comTable = table(cX, tY, [Math.round(cW * 0.2), Math.round(cW * 0.47), cW - Math.round(cW * 0.2) - Math.round(cW * 0.47)], crows, { title: 'Communion' });
    out.push(comTable.svg);

    // Note
    var nY = Math.max(seatTable.bottom, comTable.bottom) + 18;
    wrap(plan.note, 100).forEach(function (line, i) { out.push(text(MARGIN, nY + i * 15, line, 11)); });

    out.push('</svg>');
    return out.join('');
  }

  function svgToPng(svgString, scale) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(A4_W * scale);
          canvas.height = Math.round(A4_H * scale);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not render the plan image.')); };
      img.src = url;
    });
  }

  function slug(s) { return String(s || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  function fileName(plan) {
    return ['Seating', plan.date, slug(plan.service)].filter(Boolean).join('_') + '.pdf';
  }

  function createPdf(plan) {
    var svg = buildPageSvg(plan);
    return svgToPng(svg, 3).then(function (png) {
      var jsPDF = global.jspdf && global.jspdf.jsPDF;
      if (!jsPDF) throw new Error('The PDF library did not load.');
      var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
      doc.addImage(png, 'PNG', 0, 0, A4_W, A4_H, undefined, 'FAST');
      doc.setProperties({ title: 'Seating and Communion Plan – ' + subtitle(plan) });
      return { blob: doc.output('blob'), name: fileName(plan) };
    });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function canShareFiles() {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      var f = new File(['x'], 'x.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [f] });
    } catch (e) { return false; }
  }

  // Returns a promise resolving to 'shared', 'downloaded' or 'cancelled'.
  function share(plan) {
    return createPdf(plan).then(function (r) {
      var file = new File([r.blob], r.name, { type: 'application/pdf' });
      if (canShareFiles() && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Seating and Communion Plan', text: subtitle(plan) })
          .then(function () { return 'shared'; })
          .catch(function (e) {
            if (e && e.name === 'AbortError') return 'cancelled';
            download(r.blob, r.name);
            return 'downloaded';
          });
      }
      download(r.blob, r.name);
      return 'downloaded';
    });
  }

  global.PdfExport = {
    buildPageSvg: buildPageSvg,
    createPdf: createPdf,
    download: download,
    share: share,
    canShareFiles: canShareFiles,
    formatDate: formatDate,
    subtitle: subtitle
  };
})(window);

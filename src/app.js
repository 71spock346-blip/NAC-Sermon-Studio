/*
 * Seating & Communion Planner – application logic.
 * State is kept in localStorage; there is no server.
 */
(function (global) {
  'use strict';

  var L = global.Layout;
  var STORAGE_KEY = 'nac-seating-planner:v1';
  var STATION_DEFAULTS = { front: ['2', '3', '4'], left: ['11', '6', '5'], right: ['7', '8', '10'] };
  var RANKS = ['Ap', 'Bi', 'DE', 'DEv', 'Sh', 'Ev', 'Pr.', 'Dn', 'De'];

  var DEFAULT_ROSTER = [
    { rank: 'Ap', name: '' }, { rank: 'De', name: '' },
    { rank: 'Pr.', name: 'Coskey' }, { rank: 'Pr.', name: 'Swart' }, { rank: 'Pr.', name: 'Schlaphoff' },
    { rank: 'Pr.', name: 'Crerar' }, { rank: 'Pr.', name: 'Liddle' }, { rank: 'Pr.', name: 'Boniface' },
    { rank: 'Pr.', name: 'Findlay' }, { rank: 'Pr.', name: 'Wentzel' }
  ];
  var DEFAULT_SEATS = {
    1: 'Ap', 2: 'De', 3: 'Pr. Coskey', 4: 'Pr. Swart', 5: 'Pr. Schlaphoff', 6: 'Pr. Crerar',
    7: 'Pr. Liddle', 8: 'Pr. Boniface', 10: 'Pr. Findlay', 11: 'Pr. Wentzel'
  };
  var DEFAULT_NOTE = 'All Rectors and Priests to be seated in the Sacristy with the Apostle.';

  // ---------------------------------------------------------------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function todayIso() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function personLabel(p) { return ((p.rank || '') + ' ' + (p.name || '')).trim(); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function option(value, text, selected) {
    var o = el('option', { value: value, text: text });
    if (selected) o.selected = true;
    return o;
  }

  var toastTimer;
  function toast(msg, isError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  // ------------------------------------------------------------------ state
  var state, ui = { selected: null };

  function newPlan(base) {
    var p = base ? clone(base) : {
      congregation: 'Gezina', service: 'Divine Service', seats: clone(DEFAULT_SEATS),
      stations: clone(STATION_DEFAULTS),
      cups: clone(L.DEFAULT_CUPS),
      communion: {
        serves: [{ seat: '1', text: 'Serves 2-11' }, { seat: '2', text: 'Serves C & O Cup' }],
        pairs: [['2', ''], ['3', '4'], ['5', '6'], ['7', '10'], ['8', '11']]
      },
      note: DEFAULT_NOTE
    };
    p.id = uid();
    p.date = todayIso();
    p.updated = Date.now();
    return p;
  }

  function defaultState() {
    var plan = newPlan();
    return {
      roster: DEFAULT_ROSTER.map(function (r) { return { id: uid(), rank: r.rank, name: r.name }; }),
      plans: [plan],
      currentId: plan.id
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.plans) && s.plans.length) return s;
      }
    } catch (e) { /* fall through to defaults */ }
    return defaultState();
  }

  function save() {
    current().updated = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save in this browser (storage blocked).', true); }
  }

  function current() {
    var p = state.plans.filter(function (x) { return x.id === state.currentId; })[0];
    if (!p) { p = state.plans[0]; state.currentId = p.id; }
    return p;
  }

  // ---------------------------------------------------------- seat editing
  function seatOf(name) {
    var seats = current().seats;
    return Object.keys(seats).filter(function (k) { return seats[k] === name; })[0] || null;
  }

  function assign(seatId, name) {
    var plan = current(), seats = plan.seats;
    name = (name || '').trim();
    if (!name) { delete seats[seatId]; save(); renderAll(); return; }
    var prev = seatOf(name);
    if (prev && prev !== seatId) {
      delete seats[prev];
      toast(name + ' moved from seat ' + prev + ' to seat ' + seatId + '.');
    }
    seats[seatId] = name;
    save(); renderAll();
  }

  function swapSeats(a, b) {
    var seats = current().seats, va = seats[a], vb = seats[b];
    if (vb) seats[a] = vb; else delete seats[a];
    if (va) seats[b] = va; else delete seats[b];
    save();
    toast('Swapped seats ' + a + ' and ' + b + '.');
  }

  function setStation(key, value) {
    var parts = key.split('-'), plan = current();
    plan.stations[parts[0]] = plan.stations[parts[0]] || [];
    plan.stations[parts[0]][parseInt(parts[1], 10)] = value || '';
    save(); renderAll();
  }

  // -------------------------------------------------------------- rendering
  function renderHeader() {
    var p = current();
    $('#congregation').value = p.congregation || '';
    $('#date').value = p.date || '';
    $('#service').value = p.service || '';
    $('#note').value = p.note || '';
  }

  function renderPlan() {
    $('#plan').innerHTML = L.renderPlan(current(), { interactive: true, selected: ui.selected, idPrefix: 'ui' });
  }

  function renderSelection() {
    var box = $('#selection'), plan = current();
    box.innerHTML = '';
    if (!ui.selected) {
      box.appendChild(el('p', { class: 'muted', text: 'Tap a seat on the plan to assign a minister, then tap another seat to swap them. Tap a hatched square to set who serves at that station.' }));
      return;
    }
    if (ui.selected.type === 'seat') {
      var id = ui.selected.id, name = plan.seats[id] || '';
      box.appendChild(el('h3', { text: 'Seat ' + id }));
      box.appendChild(el('p', { class: name ? 'current' : 'muted', text: name ? name : 'Empty' }));
      var chips = el('div', { class: 'chips' });
      state.roster.forEach(function (person) {
        var label = personLabel(person);
        if (!label) return;
        var where = seatOf(label);
        var chip = el('button', {
          type: 'button', class: 'chip' + (where === id ? ' active' : where ? ' elsewhere' : ''),
          onclick: function () { assign(id, label); }
        }, [label, where && where !== id ? el('span', { class: 'chip-note', text: ' ' + where }) : null]);
        chips.appendChild(chip);
      });
      box.appendChild(chips);
      var input = el('input', { type: 'text', placeholder: 'Or type a name…', 'aria-label': 'Name for seat ' + id });
      var form = el('form', {
        class: 'row', onsubmit: function (e) { e.preventDefault(); if (input.value.trim()) assign(id, input.value); }
      }, [input, el('button', { type: 'submit', class: 'btn small', text: 'Assign' })]);
      box.appendChild(form);
      box.appendChild(el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn small ghost', text: 'Clear seat', onclick: function () { assign(id, ''); } }),
        el('button', { type: 'button', class: 'btn small ghost', text: 'Done', onclick: function () { ui.selected = null; renderPlan(); renderSelection(); } })
      ]));
      box.appendChild(el('p', { class: 'muted small', text: 'Tip: tap another seat on the plan to swap the two.' }));
    } else {
      var key = ui.selected.id, parts = key.split('-');
      var val = (plan.stations[parts[0]] || [])[parseInt(parts[1], 10)] || '';
      box.appendChild(el('h3', { text: 'Serving station' }));
      box.appendChild(el('p', { class: 'muted', text: L.STATION_GROUP_LABELS[parts[0]] + ', position ' + (parseInt(parts[1], 10) + 1) + (val ? ' – seat ' + val + (plan.seats[val] ? ' (' + plan.seats[val] + ')' : '') : ' – empty') }));
      var sc = el('div', { class: 'chips' });
      L.MINISTER_SEAT_IDS.forEach(function (sid) {
        sc.appendChild(el('button', {
          type: 'button', class: 'chip num' + (val === sid ? ' active' : ''),
          title: plan.seats[sid] || 'Seat ' + sid,
          onclick: function () { setStation(key, sid); }
        }, [sid]));
      });
      box.appendChild(sc);
      box.appendChild(el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn small ghost', text: 'Clear station', onclick: function () { setStation(key, ''); } }),
        el('button', { type: 'button', class: 'btn small ghost', text: 'Done', onclick: function () { ui.selected = null; renderPlan(); renderSelection(); } })
      ]));
    }
  }

  function seatSelect(seatId) {
    var plan = current(), value = plan.seats[seatId] || '';
    var sel = el('select', { 'aria-label': 'Seat ' + seatId });
    sel.appendChild(option('', '—', !value));
    var labels = state.roster.map(personLabel).filter(Boolean);
    if (value && labels.indexOf(value) < 0) labels.unshift(value);
    labels.forEach(function (lab) { sel.appendChild(option(lab, lab, lab === value)); });
    sel.appendChild(option('__other__', 'Other…'));
    sel.addEventListener('change', function () {
      if (sel.value === '__other__') {
        var n = prompt('Name for seat ' + seatId + ':', value);
        if (n === null) { renderSeatingTable(); return; }
        assign(seatId, n);
      } else assign(seatId, sel.value);
    });
    return sel;
  }

  function renderSeatingTable() {
    var tb = $('#seating-table tbody');
    tb.innerHTML = '';
    for (var i = 1; i <= 11; i++) {
      var a = String(i), b = String(i + 11);
      var tr = el('tr', { class: 'grp-' + L.SEAT_GROUP[a] }, [
        el('td', { class: 'num', text: a }), el('td', {}, [seatSelect(a)]),
        el('td', { class: 'num', text: b }), el('td', {}, [seatSelect(b)])
      ]);
      tb.appendChild(tr);
    }
  }

  function numSelect(value, onchange, label) {
    var sel = el('select', { 'aria-label': label, onchange: function () { onchange(sel.value); } });
    sel.appendChild(option('', '—', !value));
    L.MINISTER_SEAT_IDS.forEach(function (id) { sel.appendChild(option(id, id, id === value)); });
    return sel;
  }

  function renderCups() {
    var cups = current().cups || (current().cups = clone(L.DEFAULT_CUPS));
    $('#cups-left').value = cups.left;
    $('#cups-right').value = cups.right;
    $$('[data-cups]').forEach(function (b) {
      var side = b.getAttribute('data-cups'), d = parseInt(b.getAttribute('data-delta'), 10);
      b.disabled = (d < 0 && cups[side] <= 0) || (d > 0 && cups[side] >= L.MAX_CUPS);
    });
  }

  function renderCommunion() {
    var plan = current(), com = plan.communion;
    renderCups();
    var sb = $('#serves-rows'); sb.innerHTML = '';
    com.serves.forEach(function (s, i) {
      sb.appendChild(el('tr', {}, [
        el('td', {}, [numSelect(s.seat, function (v) { s.seat = v; save(); }, 'Serving seat')]),
        el('td', {}, [el('input', {
          type: 'text', value: s.text || '', 'aria-label': 'What this seat serves',
          onchange: function (e) { s.text = e.target.value; save(); }
        })]),
        el('td', {}, [el('button', { type: 'button', class: 'icon', title: 'Remove row', text: '×', onclick: function () { com.serves.splice(i, 1); save(); renderCommunion(); } })])
      ]));
    });
    var pb = $('#pairs-rows'); pb.innerHTML = '';
    com.pairs.forEach(function (p, i) {
      pb.appendChild(el('tr', {}, [
        el('td', {}, [numSelect(p[0], function (v) { p[0] = v; save(); }, 'Takes cup')]),
        el('td', {}, [numSelect(p[1], function (v) { p[1] = v; save(); }, 'Takes inner')]),
        el('td', {}, [el('button', { type: 'button', class: 'icon', title: 'Remove row', text: '×', onclick: function () { com.pairs.splice(i, 1); save(); renderCommunion(); } })])
      ]));
    });
  }

  function renderRoster() {
    var list = $('#roster-list'); list.innerHTML = '';
    state.roster.forEach(function (person, i) {
      var rank = el('input', { type: 'text', list: 'ranks', value: person.rank || '', placeholder: 'Rank', 'aria-label': 'Rank', class: 'rank' });
      var name = el('input', { type: 'text', value: person.name || '', placeholder: 'Surname', 'aria-label': 'Name' });
      var update = function () {
        var oldLabel = personLabel(person);
        person.rank = rank.value.trim(); person.name = name.value.trim();
        var newLabel = personLabel(person), seat = oldLabel && seatOf(oldLabel);
        if (seat && newLabel !== oldLabel) current().seats[seat] = newLabel;
        save(); renderPlan(); renderSelection(); renderSeatingTable();
      };
      rank.addEventListener('change', update); name.addEventListener('change', update);
      list.appendChild(el('li', {}, [rank, name,
        el('button', {
          type: 'button', class: 'icon', title: 'Remove from roster', text: '×',
          onclick: function () { state.roster.splice(i, 1); save(); renderRoster(); renderSelection(); renderSeatingTable(); }
        })]));
    });
  }

  function renderPlans() {
    var sel = $('#plans-select'); sel.innerHTML = '';
    state.plans.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.updated || 0) - (a.updated || 0); })
      .forEach(function (p) {
        sel.appendChild(option(p.id, [global.PdfExport.formatDate(p.date), p.service, p.congregation].filter(Boolean).join(' · '), p.id === state.currentId));
      });
  }

  function renderAll() {
    renderPlan(); renderSelection(); renderSeatingTable(); renderCommunion(); renderRoster(); renderPlans();
  }

  // ------------------------------------------------------------- behaviour
  function onPlanClick(e) {
    var seat = e.target.closest('[data-seat]'), station = e.target.closest('[data-station]');
    if (seat) {
      var id = seat.getAttribute('data-seat');
      if (ui.selected && ui.selected.type === 'seat') {
        if (ui.selected.id === id) ui.selected = null;
        else { swapSeats(ui.selected.id, id); ui.selected = { type: 'seat', id: id }; }
      } else ui.selected = { type: 'seat', id: id };
    } else if (station) {
      var key = station.getAttribute('data-station');
      ui.selected = (ui.selected && ui.selected.type === 'station' && ui.selected.id === key) ? null : { type: 'station', id: key };
    } else return;
    renderAll();
  }

  function busy(btn, on) { btn.disabled = on; btn.classList.toggle('busy', on); }

  function exportJson() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    global.PdfExport.download(blob, 'seating-planner-backup.json');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = JSON.parse(reader.result);
        if (!s || !Array.isArray(s.plans) || !Array.isArray(s.roster)) throw new Error('bad');
        state = s; save(); ui.selected = null; renderHeader(); renderAll();
        toast('Backup imported.');
      } catch (e) { toast('That file is not a planner backup.', true); }
    };
    reader.readAsText(file);
  }

  function bind() {
    $('#plan').addEventListener('click', onPlanClick);
    $('#plan').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.hit')) { e.preventDefault(); onPlanClick(e); }
    });
    ['congregation', 'date', 'service'].forEach(function (k) {
      $('#' + k).addEventListener('input', function (e) { current()[k] = e.target.value; save(); renderPlans(); });
    });
    $('#note').addEventListener('input', function (e) { current().note = e.target.value; save(); });

    $('#btn-add-serves').addEventListener('click', function () { current().communion.serves.push({ seat: '', text: '' }); save(); renderCommunion(); });
    $('#btn-add-pair').addEventListener('click', function () { current().communion.pairs.push(['', '']); save(); renderCommunion(); });
    $$('[data-cups]').forEach(function (b) {
      b.addEventListener('click', function () {
        var plan = current(), side = b.getAttribute('data-cups'), d = parseInt(b.getAttribute('data-delta'), 10);
        plan.cups = plan.cups || clone(L.DEFAULT_CUPS);
        plan.cups[side] = L.clampCups((plan.cups[side] || 0) + d);
        save(); renderPlan(); renderCups();
      });
    });
    $('#btn-reset-stations').addEventListener('click', function () { current().stations = clone(STATION_DEFAULTS); save(); renderAll(); toast('Stations reset to the usual positions.'); });

    $('#roster-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var rank = $('#new-rank').value.trim(), name = $('#new-name').value.trim();
      if (!rank && !name) return;
      state.roster.push({ id: uid(), rank: rank, name: name });
      $('#new-name').value = '';
      save(); renderRoster(); renderSelection(); renderSeatingTable();
    });

    $('#plans-select').addEventListener('change', function (e) { state.currentId = e.target.value; ui.selected = null; save(); renderHeader(); renderAll(); });
    $('#btn-new-plan').addEventListener('click', function () {
      var p = newPlan(current()); state.plans.push(p); state.currentId = p.id; ui.selected = null;
      save(); renderHeader(); renderAll(); toast('New plan created from the current one. Set its date and service.');
    });
    $('#btn-blank-plan').addEventListener('click', function () {
      var p = newPlan(); p.congregation = current().congregation; p.seats = {};
      state.plans.push(p); state.currentId = p.id; ui.selected = null;
      save(); renderHeader(); renderAll(); toast('Blank plan created.');
    });
    $('#btn-delete-plan').addEventListener('click', function () {
      if (state.plans.length < 2) { toast('Keep at least one plan. Create another first.', true); return; }
      var p = current();
      if (!confirm('Delete the plan for ' + global.PdfExport.subtitle(p) + '?')) return;
      state.plans = state.plans.filter(function (x) { return x.id !== p.id; });
      state.currentId = state.plans[0].id; ui.selected = null;
      save(); renderHeader(); renderAll();
    });
    $('#btn-export').addEventListener('click', exportJson);
    $('#file-import').addEventListener('change', function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });

    var pdfBtn = $('#btn-pdf'), shareBtn = $('#btn-share');
    pdfBtn.addEventListener('click', function () {
      busy(pdfBtn, true);
      global.PdfExport.createPdf(current()).then(function (r) { global.PdfExport.download(r.blob, r.name); toast('PDF saved: ' + r.name); })
        .catch(function (e) { toast('PDF failed: ' + e.message, true); })
        .then(function () { busy(pdfBtn, false); });
    });
    if (global.PdfExport.canShareFiles()) {
      shareBtn.hidden = false;
      shareBtn.addEventListener('click', function () {
        busy(shareBtn, true);
        global.PdfExport.share(current()).then(function (how) {
          if (how === 'shared') toast('Shared.'); else if (how === 'downloaded') toast('Sharing unavailable, PDF downloaded instead.');
        }).catch(function (e) { toast('Share failed: ' + e.message, true); })
          .then(function () { busy(shareBtn, false); });
      });
    }
    $('#btn-print').addEventListener('click', function () {
      $('#print-sheet').innerHTML = global.PdfExport.buildPageSvg(current());
      window.print();
    });
  }

  var ZOOMS = [100, 150, 200, 300];
  function setZoom(i) {
    ui.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
    $('#plan').style.setProperty('--plan-zoom', ZOOMS[ui.zoom] + '%');
    $('#zoom-out').disabled = ui.zoom === 0;
    $('#zoom-in').disabled = ui.zoom === ZOOMS.length - 1;
  }

  function init() {
    var dl = $('#ranks');
    RANKS.forEach(function (r) { dl.appendChild(option(r, r)); });
    state = load();
    renderHeader(); renderAll(); bind();
    $('#zoom-in').addEventListener('click', function () { setZoom(ui.zoom + 1); });
    $('#zoom-out').addEventListener('click', function () { setZoom(ui.zoom - 1); });
    setZoom(window.innerWidth < 700 ? 1 : 0);
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);

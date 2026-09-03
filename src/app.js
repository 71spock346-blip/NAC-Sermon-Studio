/*
 * Seating & Communion Planner – application logic.
 * State is kept in localStorage; there is no server.
 */
(function (global) {
  'use strict';

  var L = global.Layout, P = global.PdfExport;
  var STORAGE_KEY = 'nac-seating-planner:v1';
  var RANKS = ['Ap', 'Bi', 'DE', 'DEv', 'Sh', 'Ev', 'Pr.', 'Dn', 'De'];
  var DEFAULT_ROSTER = [
    ['Ap', '', '#FFFFFF'], ['De', '', '#FFD966'], ['Pr.', 'Coskey', '#FFD966'], ['Pr.', 'Swart', '#FFD966'],
    ['Pr.', 'Schlaphoff', '#A9D18E'], ['Pr.', 'Crerar', '#A9D18E'], ['Pr.', 'Liddle', '#A9D18E'],
    ['Pr.', 'Boniface', '#9DC3E6'], ['Pr.', 'Findlay', '#9DC3E6'], ['Pr.', 'Wentzel', '#9DC3E6']
  ];
  var DEFAULT_SEATS = { 1: 'Ap', 2: 'De', 3: 'Pr. Coskey', 4: 'Pr. Swart', 5: 'Pr. Schlaphoff', 6: 'Pr. Crerar', 7: 'Pr. Liddle', 8: 'Pr. Boniface', 10: 'Pr. Findlay', 11: 'Pr. Wentzel' };
  var DEFAULT_NOTE = 'All Rectors and Priests to be seated in the Sacristy with the Apostle.';
  var TABS = ['seats', 'communion', 'roster', 'plans', 'layout'];

  // ---------------------------------------------------------------- helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var clone = L.clone;
  function todayIso() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function personLabel(p) { return ((p.rank || '') + ' ' + (p.name || '')).trim(); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'style') e.style.cssText = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function option(value, text, selected) { var o = el('option', { value: value, text: text }); if (selected) o.selected = true; return o; }
  var toastTimer;
  function toast(msg, isError) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function swatchStyle(c) { return 'background:' + (c || '#fff') + ';color:' + (L.dark(c) ? '#fff' : '#111'); }

  // ------------------------------------------------------------------ state
  var state, ui = { selected: null, tab: 'seats', zoom: 0 };

  function layoutById(id) {
    var custom = (state.layouts || []).filter(function (l) { return l.id === id; })[0];
    if (custom) return custom;
    if (id === L.GEZINA.id) return L.GEZINA;
    return null;
  }
  function allLayouts() {
    var list = (state.layouts || []).slice();
    if (!list.some(function (l) { return l.id === L.GEZINA.id; })) list.unshift(L.GEZINA);
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function current() {
    var p = state.plans.filter(function (x) { return x.id === state.currentId; })[0];
    if (!p) { p = state.plans[0]; state.currentId = p.id; }
    if (!layoutById(p.layoutId)) p.layoutId = allLayouts()[0].id;
    return p;
  }
  function currentLayout() { return layoutById(current().layoutId) || L.GEZINA; }
  // Returns a layout object stored in state (forking the built-in one on first edit).
  function editableLayout() {
    var lay = currentLayout();
    if (lay.builtin) {
      lay = clone(lay); lay.builtin = false;
      state.layouts = state.layouts || []; state.layouts.push(lay);
    }
    return lay;
  }
  function colorOf(name) {
    var p = state.roster.filter(function (r) { return personLabel(r) === name; })[0];
    return p ? (p.color || '#FFFFFF') : null;
  }

  function newPlan(base, layout) {
    var p;
    if (base) p = clone(base);
    else {
      p = { layoutId: layout.id, service: 'Divine Service', seats: layout.id === L.GEZINA.id ? clone(DEFAULT_SEATS) : {},
        stations: L.defaultStations(layout), cups: clone(layout.cups || { left: 0, right: 0 }),
        communion: { serves: [{ seat: '1', text: 'Serves 2-11' }, { seat: '2', text: 'Serves C & O Cup' }], pairs: [['2', ''], ['3', '4'], ['5', '6'], ['7', '10'], ['8', '11']] },
        note: DEFAULT_NOTE };
    }
    p.id = uid(); p.date = todayIso(); p.updated = Date.now();
    return p;
  }
  function defaultState() {
    var plan = newPlan(null, L.GEZINA);
    return { version: 2, roster: DEFAULT_ROSTER.map(function (r) { return { id: uid(), rank: r[0], name: r[1], color: r[2] }; }), layouts: [], plans: [plan], currentId: plan.id };
  }
  function migrate(s) {
    if (s.version >= 2) return s;
    s.version = 2; s.layouts = s.layouts || [];
    s.roster.forEach(function (r) {
      if (!r.color) { var d = DEFAULT_ROSTER.filter(function (x) { return x[0] === r.rank && x[1] === r.name; })[0]; r.color = d ? d[2] : '#FFFFFF'; }
    });
    s.plans.forEach(function (p) { p.layoutId = p.layoutId || L.GEZINA.id; delete p.congregation; });
    return s;
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { var s = JSON.parse(raw); if (s && Array.isArray(s.plans) && s.plans.length) return migrate(s); }
    } catch (e) { /* defaults */ }
    return defaultState();
  }
  function save() {
    current().updated = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { toast('Could not save in this browser (storage blocked).', true); }
  }

  // ---------------------------------------------------------- seat editing
  function seatOf(name) { var s = current().seats; return Object.keys(s).filter(function (k) { return s[k] === name; })[0] || null; }
  function assign(seatId, name) {
    var seats = current().seats; name = (name || '').trim();
    if (!name) { delete seats[seatId]; save(); renderAll(); return; }
    var prev = seatOf(name);
    if (prev && prev !== seatId) { delete seats[prev]; toast(name + ' moved from seat ' + prev + ' to seat ' + seatId + '.'); }
    seats[seatId] = name; save(); renderAll();
  }
  function swapSeats(a, b) {
    var s = current().seats, va = s[a], vb = s[b];
    if (vb) s[a] = vb; else delete s[a];
    if (va) s[b] = va; else delete s[b];
    save(); toast('Swapped seats ' + a + ' and ' + b + '.');
  }
  function setStation(key, value) {
    var i = key.lastIndexOf('-'), g = key.slice(0, i), idx = parseInt(key.slice(i + 1), 10), plan = current();
    plan.stations[g] = plan.stations[g] || []; plan.stations[g][idx] = value || ''; save(); renderAll();
  }

  // -------------------------------------------------------------- rendering
  function renderHeader() {
    var p = current(), sel = $('#layout-select'); sel.innerHTML = '';
    allLayouts().forEach(function (l) { sel.appendChild(option(l.id, l.name, l.id === p.layoutId)); });
    $('#date').value = p.date || ''; $('#service').value = p.service || ''; $('#note').value = p.note || '';
  }
  function renderPlan() {
    $('#plan').innerHTML = L.render(currentLayout(), current(), {
      interactive: !global.Editor.active, selected: ui.selected, idPrefix: 'ui', colorOf: colorOf,
      edit: global.Editor.active, editSel: global.Editor.selected
    });
    $('#plan').classList.toggle('editing', global.Editor.active);
  }
  function renderLegend() {
    var box = $('#legend'); box.innerHTML = '';
    (currentLayout().sections || []).forEach(function (s) { box.appendChild(el('span', { style: '--sw:' + s.color, text: s.name })); });
    box.appendChild(el('span', { class: 'hatch', text: 'Serving station' }));
  }
  function closeSelection() { ui.selected = null; renderPlan(); renderSelection(); }
  function renderSelection() {
    var box = $('#selection'), plan = current(), sheet = $('#selection-sheet');
    box.innerHTML = ''; sheet.hidden = !ui.selected;
    if (!ui.selected) return;
    var done = el('button', { type: 'button', class: 'icon close', 'aria-label': 'Close', text: '×', onclick: closeSelection });
    if (ui.selected.type === 'seat') {
      var id = ui.selected.id, name = plan.seats[id] || '';
      box.appendChild(el('div', { class: 'sheet-head' }, [el('h3', { text: 'Seat ' + id }), el('span', { class: 'current', style: name ? swatchStyle(colorOf(name)) : '', text: name || 'Empty' }), done]));
      var chips = el('div', { class: 'chips' });
      state.roster.forEach(function (person) {
        var label = personLabel(person); if (!label) return;
        var where = seatOf(label);
        chips.appendChild(el('button', { type: 'button', class: 'chip' + (where === id ? ' active' : where ? ' elsewhere' : ''), style: swatchStyle(person.color), onclick: function () { assign(id, label); } },
          [label, where && where !== id ? el('span', { class: 'chip-note', text: ' ' + where }) : null]));
      });
      box.appendChild(chips);
      var input = el('input', { type: 'text', placeholder: 'Or type a name…', 'aria-label': 'Name for seat ' + id });
      box.appendChild(el('form', { class: 'row', onsubmit: function (e) { e.preventDefault(); if (input.value.trim()) assign(id, input.value); } }, [input, el('button', { type: 'submit', class: 'btn small', text: 'Assign' })]));
      box.appendChild(el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn small ghost', text: 'Clear seat', onclick: function () { assign(id, ''); } }),
        el('span', { class: 'muted small', text: 'Tap another seat to swap.' })]));
    } else {
      var key = ui.selected.id, i = key.lastIndexOf('-'), g = key.slice(0, i), idx = parseInt(key.slice(i + 1), 10);
      var group = currentLayout().stationGroups.filter(function (x) { return x.id === g; })[0];
      var val = (plan.stations[g] || [])[idx] || '';
      box.appendChild(el('div', { class: 'sheet-head' }, [el('h3', { text: 'Serving station' }), el('span', { class: 'muted', text: (group ? group.label : g) + ', position ' + (idx + 1) + (val ? ' – seat ' + val + (plan.seats[val] ? ' (' + plan.seats[val] + ')' : '') : ' – empty') }), done]));
      var sc = el('div', { class: 'chips' });
      L.seatIds(currentLayout()).forEach(function (sid) {
        var occ = plan.seats[sid];
        sc.appendChild(el('button', { type: 'button', class: 'chip num' + (val === sid ? ' active' : ''), style: occ ? swatchStyle(colorOf(occ)) : '', title: occ || 'Seat ' + sid, onclick: function () { setStation(key, sid); } }, [sid]));
      });
      box.appendChild(sc);
      box.appendChild(el('div', { class: 'row' }, [el('button', { type: 'button', class: 'btn small ghost', text: 'Clear station', onclick: function () { setStation(key, ''); } })]));
    }
  }
  function seatSelect(seatId) {
    var plan = current(), value = plan.seats[seatId] || '', sel = el('select', { 'aria-label': 'Seat ' + seatId, style: value ? swatchStyle(colorOf(value)) : '' });
    sel.appendChild(option('', '—', !value));
    var labels = state.roster.map(personLabel).filter(Boolean);
    if (value && labels.indexOf(value) < 0) labels.unshift(value);
    labels.forEach(function (lab) { sel.appendChild(option(lab, lab, lab === value)); });
    sel.appendChild(option('__other__', 'Other…'));
    sel.addEventListener('change', function () {
      if (sel.value === '__other__') { var n = prompt('Name for seat ' + seatId + ':', value); if (n === null) { renderSeatingTable(); return; } assign(seatId, n); }
      else assign(seatId, sel.value);
    });
    return sel;
  }
  function renderSeatingTable() {
    var tb = $('#seating-table tbody'); tb.innerHTML = '';
    var ids = L.seatIds(currentLayout()), half = Math.ceil(ids.length / 2);
    for (var i = 0; i < half; i++) {
      var a = ids[i], b = ids[i + half];
      tb.appendChild(el('tr', {}, [el('td', { class: 'num', text: a }), el('td', {}, [seatSelect(a)]),
        el('td', { class: 'num', text: b || '' }), el('td', {}, [b ? seatSelect(b) : null])]));
    }
  }
  function numSelect(value, onchange, label) {
    var occ = current().seats[value], sel = el('select', { 'aria-label': label, style: occ ? swatchStyle(colorOf(occ)) : '', onchange: function () { onchange(sel.value); renderCommunion(); } });
    sel.appendChild(option('', '—', !value));
    L.seatIds(currentLayout()).forEach(function (id) { sel.appendChild(option(id, id + (current().seats[id] ? ' · ' + current().seats[id] : ''), id === value)); });
    return sel;
  }
  function stepper(labelText, value, max, onDelta) {
    return el('span', { class: 'stepper', role: 'group', 'aria-label': labelText }, [
      el('span', { class: 'stepper-label', text: labelText }),
      el('button', { type: 'button', class: 'btn small ghost', text: '−', 'aria-label': 'Fewer ' + labelText, disabled: value <= 0 ? '' : null, onclick: function () { onDelta(-1); } }),
      el('output', { text: String(value) }),
      el('button', { type: 'button', class: 'btn small ghost', text: '+', 'aria-label': 'More ' + labelText, disabled: value >= max ? '' : null, onclick: function () { onDelta(1); } })]);
  }
  function renderCommunion() {
    var plan = current(), com = plan.communion, lay = currentLayout();
    var sb = $('#serves-rows'); sb.innerHTML = '';
    com.serves.forEach(function (s, i) {
      sb.appendChild(el('tr', {}, [
        el('td', {}, [numSelect(s.seat, function (v) { s.seat = v; save(); }, 'Serving seat')]),
        el('td', {}, [el('input', { type: 'text', value: s.text || '', 'aria-label': 'What this seat serves', onchange: function (e) { s.text = e.target.value; save(); } })]),
        el('td', {}, [el('button', { type: 'button', class: 'icon', title: 'Remove row', text: '×', onclick: function () { com.serves.splice(i, 1); save(); renderCommunion(); } })])]));
    });
    var pb = $('#pairs-rows'); pb.innerHTML = '';
    com.pairs.forEach(function (p, i) {
      pb.appendChild(el('tr', {}, [
        el('td', {}, [numSelect(p[0], function (v) { p[0] = v; save(); }, 'Takes cup')]),
        el('td', {}, [numSelect(p[1], function (v) { p[1] = v; save(); }, 'Takes inner')]),
        el('td', {}, [el('button', { type: 'button', class: 'icon', title: 'Remove row', text: '×', onclick: function () { com.pairs.splice(i, 1); save(); renderCommunion(); } })])]));
    });
    var st = $('#station-steppers'); st.innerHTML = '';
    lay.stationGroups.forEach(function (g) {
      var arr = plan.stations[g.id] = plan.stations[g.id] || [];
      st.appendChild(stepper(g.label, arr.length, L.MAX_STATIONS, function (d) {
        if (d > 0) arr.push(''); else { arr.pop(); if (ui.selected && ui.selected.type === 'station' && ui.selected.id === g.id + '-' + arr.length) ui.selected = null; }
        save(); renderPlan(); renderSelection(); renderCommunion();
      }));
    });
    var cs = $('#cup-steppers'); cs.innerHTML = '';
    plan.cups = plan.cups || clone(lay.cups || { left: 0, right: 0 });
    ['left', 'right'].forEach(function (side) {
      cs.appendChild(stepper(side === 'left' ? 'Left of altar' : 'Right of altar', plan.cups[side] || 0, L.MAX_CUPS, function (d) {
        plan.cups[side] = L.clamp((plan.cups[side] || 0) + d, 0, L.MAX_CUPS); save(); renderPlan(); renderCommunion();
      }));
    });
  }
  function colorPicker(person) {
    var sections = currentLayout().sections || [], wrap = el('span', { class: 'swatches' });
    var choices = [{ name: 'None', color: '#FFFFFF' }].concat(sections);
    choices.forEach(function (s) {
      wrap.appendChild(el('button', { type: 'button', class: 'swatch' + ((person.color || '#FFFFFF').toUpperCase() === s.color.toUpperCase() ? ' active' : ''), style: 'background:' + s.color, title: s.name, 'aria-label': s.name,
        onclick: function () { person.color = s.color; save(); renderAll(); } }));
    });
    var custom = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(person.color || '') ? person.color : '#ffffff', title: 'Custom colour', 'aria-label': 'Custom colour' });
    custom.addEventListener('input', function () { person.color = custom.value; save(); renderPlan(); renderSeatingTable(); });
    wrap.appendChild(custom);
    return wrap;
  }
  function renderRoster() {
    var list = $('#roster-list'); list.innerHTML = '';
    state.roster.forEach(function (person, i) {
      var rank = el('input', { type: 'text', list: 'ranks', value: person.rank || '', placeholder: 'Rank', 'aria-label': 'Rank', class: 'rank' });
      var name = el('input', { type: 'text', value: person.name || '', placeholder: 'Surname', 'aria-label': 'Name' });
      var update = function () {
        var oldLabel = personLabel(person); person.rank = rank.value.trim(); person.name = name.value.trim();
        var newLabel = personLabel(person), seat = oldLabel && seatOf(oldLabel);
        if (seat && newLabel !== oldLabel) current().seats[seat] = newLabel;
        save(); renderPlan(); renderSelection(); renderSeatingTable();
      };
      rank.addEventListener('change', update); name.addEventListener('change', update);
      list.appendChild(el('li', {}, [rank, name, colorPicker(person),
        el('button', { type: 'button', class: 'icon', title: 'Remove from roster', text: '×', onclick: function () { state.roster.splice(i, 1); save(); renderRoster(); renderSelection(); renderSeatingTable(); } })]));
    });
  }
  function renderPlans() {
    var sel = $('#plans-select'); sel.innerHTML = '';
    state.plans.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.updated || 0) - (a.updated || 0); }).forEach(function (p) {
      var lay = layoutById(p.layoutId);
      sel.appendChild(option(p.id, [P.formatDate(p.date), p.service, lay && lay.name].filter(Boolean).join(' · '), p.id === state.currentId));
    });
  }
  function renderLayoutTab() {
    var lay = currentLayout();
    $('#layout-name').value = lay.name;
    $('#layout-name').disabled = !!lay.builtin;
    $('#btn-layout-delete').disabled = !!lay.builtin || allLayouts().length < 2;
    $('#btn-layout-edit').textContent = global.Editor.active ? 'Finish editing' : 'Edit this layout';
    var sl = $('#sections-list'); sl.innerHTML = '';
    (lay.sections || []).forEach(function (s, i) {
      var name = el('input', { type: 'text', value: s.name, 'aria-label': 'Section name' }), colr = el('input', { type: 'color', value: s.color, 'aria-label': 'Section colour' });
      var upd = function () { var e = editableLayout(); e.sections[i].name = name.value; e.sections[i].color = colr.value; save(); renderLegend(); renderRoster(); renderLayoutTab(); };
      name.addEventListener('change', upd); colr.addEventListener('input', upd);
      sl.appendChild(el('li', {}, [colr, name, el('button', { type: 'button', class: 'icon', title: 'Remove section', text: '×', onclick: function () { editableLayout().sections.splice(i, 1); save(); renderLegend(); renderRoster(); renderLayoutTab(); } })]));
    });
    global.Editor.render();
  }
  function renderTabs() {
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === ui.tab); b.setAttribute('aria-selected', b.getAttribute('data-tab') === ui.tab); });
    TABS.forEach(function (t) { $('#tab-' + t).hidden = t !== ui.tab; });
  }
  function renderAll() { renderPlan(); renderLegend(); renderSelection(); renderSeatingTable(); renderCommunion(); renderRoster(); renderPlans(); renderLayoutTab(); renderTabs(); }

  // ------------------------------------------------------------- behaviour
  function onPlanClick(e) {
    if (global.Editor.active) return;
    var seat = e.target.closest('[data-seat]'), station = e.target.closest('[data-station]');
    if (seat) {
      var id = seat.getAttribute('data-seat');
      if (ui.selected && ui.selected.type === 'seat') { if (ui.selected.id === id) ui.selected = null; else { swapSeats(ui.selected.id, id); ui.selected = { type: 'seat', id: id }; } }
      else ui.selected = { type: 'seat', id: id };
    } else if (station) {
      var key = station.getAttribute('data-station');
      ui.selected = (ui.selected && ui.selected.type === 'station' && ui.selected.id === key) ? null : { type: 'station', id: key };
    } else return;
    renderAll();
  }
  function busy(btn, on) { btn.disabled = on; btn.classList.toggle('busy', on); }
  function downloadJson(obj, name) { P.download(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), name); }
  function readJson(file, cb) { var r = new FileReader(); r.onload = function () { try { cb(JSON.parse(r.result)); } catch (e) { toast('That file is not valid.', true); } }; r.readAsText(file); }
  function validLayout(l) { return l && typeof l.name === 'string' && Array.isArray(l.blocks) && Array.isArray(l.seats) && Array.isArray(l.stationGroups) && l.altar && l.altar.inner; }
  function switchLayout(id) {
    var plan = current(), lay = layoutById(id);
    if (!lay) return;
    plan.layoutId = id; plan.stations = L.defaultStations(lay); plan.cups = clone(lay.cups || { left: 0, right: 0 });
    ui.selected = null; global.Editor.setActive(false); save(); renderHeader(); renderAll();
  }
  var ZOOMS = [100, 150, 200, 300];
  function setZoom(i) {
    ui.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
    $('#plan').style.setProperty('--plan-zoom', ZOOMS[ui.zoom] + '%');
    $('#zoom-out').disabled = ui.zoom === 0; $('#zoom-in').disabled = ui.zoom === ZOOMS.length - 1;
  }

  function bind() {
    $('#plan').addEventListener('click', onPlanClick);
    $('#plan').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.hit')) { e.preventDefault(); onPlanClick(e); } });
    $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { ui.tab = b.getAttribute('data-tab'); renderTabs(); }); });
    $('#zoom-in').addEventListener('click', function () { setZoom(ui.zoom + 1); });
    $('#zoom-out').addEventListener('click', function () { setZoom(ui.zoom - 1); });
    $('#layout-select').addEventListener('change', function (e) { switchLayout(e.target.value); });
    ['date', 'service'].forEach(function (k) { $('#' + k).addEventListener('input', function (e) { current()[k] = e.target.value; save(); renderPlans(); }); });
    $('#note').addEventListener('input', function (e) { current().note = e.target.value; save(); });
    $('#btn-add-serves').addEventListener('click', function () { current().communion.serves.push({ seat: '', text: '' }); save(); renderCommunion(); });
    $('#btn-add-pair').addEventListener('click', function () { current().communion.pairs.push(['', '']); save(); renderCommunion(); });
    $('#btn-reset-stations').addEventListener('click', function () { current().stations = L.defaultStations(currentLayout()); ui.selected = null; save(); renderAll(); toast('Stations reset to the usual positions.'); });
    $('#roster-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var rank = $('#new-rank').value.trim(), name = $('#new-name').value.trim();
      if (!rank && !name) return;
      state.roster.push({ id: uid(), rank: rank, name: name, color: '#FFFFFF' }); $('#new-name').value = '';
      save(); renderRoster(); renderSelection(); renderSeatingTable();
    });
    $('#plans-select').addEventListener('change', function (e) { state.currentId = e.target.value; ui.selected = null; global.Editor.setActive(false); save(); renderHeader(); renderAll(); });
    $('#btn-new-plan').addEventListener('click', function () { var p = newPlan(current()); state.plans.push(p); state.currentId = p.id; ui.selected = null; save(); renderHeader(); renderAll(); toast('New plan created from the current one. Set its date and service.'); });
    $('#btn-blank-plan').addEventListener('click', function () { var p = newPlan(null, currentLayout()); p.seats = {}; state.plans.push(p); state.currentId = p.id; ui.selected = null; save(); renderHeader(); renderAll(); toast('Blank plan created.'); });
    $('#btn-delete-plan').addEventListener('click', function () {
      if (state.plans.length < 2) { toast('Keep at least one plan. Create another first.', true); return; }
      var p = current();
      if (!confirm('Delete the plan for ' + P.subtitle(p, currentLayout()) + '?')) return;
      state.plans = state.plans.filter(function (x) { return x.id !== p.id; }); state.currentId = state.plans[0].id; ui.selected = null;
      save(); renderHeader(); renderAll();
    });
    $('#btn-export').addEventListener('click', function () { downloadJson(state, 'seating-planner-backup.json'); });
    $('#file-import').addEventListener('change', function (e) {
      if (e.target.files[0]) readJson(e.target.files[0], function (s) {
        if (!s || !Array.isArray(s.plans) || !Array.isArray(s.roster)) { toast('That file is not a planner backup.', true); return; }
        state = migrate(s); save(); ui.selected = null; renderHeader(); renderAll(); toast('Backup imported.');
      });
      e.target.value = '';
    });
    // Layout tab
    $('#layout-name').addEventListener('change', function (e) { var lay = currentLayout(); if (!lay.builtin) { lay.name = e.target.value.trim() || lay.name; save(); renderHeader(); renderPlans(); renderLayoutTab(); } });
    $('#btn-layout-new').addEventListener('click', function () {
      var name = prompt('Name of the new congregation / layout:', '');
      if (!name) return;
      var lay = clone(currentLayout()); lay.id = uid(); lay.name = name.trim(); lay.builtin = false;
      state.layouts.push(lay); switchLayout(lay.id); ui.tab = 'layout'; renderTabs(); toast('Layout "' + lay.name + '" created as a copy. Use "Edit this layout" to change it.');
    });
    $('#btn-layout-delete').addEventListener('click', function () {
      var lay = currentLayout();
      if (lay.builtin || !confirm('Delete the layout "' + lay.name + '"? Plans using it will switch to another layout.')) return;
      state.layouts = state.layouts.filter(function (l) { return l.id !== lay.id; });
      var fallback = allLayouts()[0].id;
      state.plans.forEach(function (p) { if (p.layoutId === lay.id) { p.layoutId = fallback; p.stations = L.defaultStations(layoutById(fallback)); } });
      global.Editor.setActive(false); save(); renderHeader(); renderAll();
    });
    $('#btn-layout-export').addEventListener('click', function () { var lay = clone(currentLayout()); delete lay.builtin; downloadJson(lay, 'layout-' + lay.name.replace(/[^A-Za-z0-9]+/g, '_') + '.json'); });
    $('#file-layout-import').addEventListener('change', function (e) {
      if (e.target.files[0]) readJson(e.target.files[0], function (lay) {
        if (!validLayout(lay)) { toast('That file is not a layout.', true); return; }
        lay.id = uid(); lay.builtin = false; state.layouts.push(lay); switchLayout(lay.id); toast('Layout "' + lay.name + '" imported.');
      });
      e.target.value = '';
    });
    $('#btn-layout-edit').addEventListener('click', function () {
      var on = !global.Editor.active;
      if (on) { editableLayout(); ui.selected = null; }
      global.Editor.setActive(on); save(); renderHeader(); renderAll();
      if (on) toast('Editing: drag items on the plan. Tap "Finish editing" when done.');
    });
    $('#btn-add-section').addEventListener('click', function () { editableLayout().sections.push({ name: 'New section', color: '#E0E0E0' }); save(); renderLegend(); renderRoster(); renderLayoutTab(); });

    var pdfBtn = $('#btn-pdf'), shareBtn = $('#btn-share');
    pdfBtn.addEventListener('click', function () {
      busy(pdfBtn, true);
      P.createPdf(currentLayout(), current(), colorOf).then(function (r) { P.download(r.blob, r.name); toast('PDF saved: ' + r.name); })
        .catch(function (e) { toast('PDF failed: ' + e.message, true); }).then(function () { busy(pdfBtn, false); });
    });
    if (P.canShareFiles()) {
      shareBtn.hidden = false;
      shareBtn.addEventListener('click', function () {
        busy(shareBtn, true);
        P.share(currentLayout(), current(), colorOf).then(function (how) { if (how === 'shared') toast('Shared.'); else if (how === 'downloaded') toast('Sharing unavailable, PDF downloaded instead.'); })
          .catch(function (e) { toast('Share failed: ' + e.message, true); }).then(function () { busy(shareBtn, false); });
      });
    }
    $('#btn-print').addEventListener('click', function () { $('#print-sheet').innerHTML = P.buildPageSvg(currentLayout(), current(), colorOf); window.print(); });
  }

  function init() {
    RANKS.forEach(function (r) { $('#ranks').appendChild(option(r, r)); });
    state = load();
    save();
    global.Editor.init(global.App);
    renderHeader(); renderAll(); bind();
    setZoom(window.innerWidth < 700 ? 1 : 0);
  }

  global.App = { current: current, currentLayout: currentLayout, editableLayout: editableLayout, save: save, renderPlan: renderPlan, toast: toast, colorOf: colorOf, getState: function () { return state; } };
  document.addEventListener('DOMContentLoaded', init);
})(window);

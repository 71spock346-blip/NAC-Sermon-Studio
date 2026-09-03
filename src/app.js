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
    return L.BUILTIN.filter(function (l) { return l.id === id; })[0] || null;
  }
  function allLayouts() {
    var list = (state.layouts || []).slice();
    L.BUILTIN.forEach(function (b) { if (!list.some(function (l) { return l.id === b.id; })) list.push(b); });
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function current() {
    var p = state.draft;
    if (!layoutById(p.layoutId)) p.layoutId = allLayouts()[0].id;
    return p;
  }
  // The part of a plan that counts as "content" for unsaved-change tracking.
  function planContent(p) {
    return JSON.stringify({ l: p.layoutId, d: p.date, s: p.service, seats: p.seats, st: p.stations, c: p.cups, com: p.communion, n: p.note });
  }
  function isDirty() { return planContent(state.draft) !== state.draft.savedHash; }
  function markSaved(p) { p.savedHash = planContent(p); }
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
      p = { layoutId: layout.id, service: 'Divine Service', seats: {},
        stations: L.blankStations(layout), cups: clone(layout.cups || { left: 0, right: 0 }),
        communion: layout.id === L.GEZINA.id
          ? { serves: [{ seat: '1', text: 'Serves 2-11' }, { seat: '2', text: 'Serves C & O Cup' }], pairs: [['2', ''], ['3', '4'], ['5', '6'], ['7', '10'], ['8', '11']] }
          : { serves: [], pairs: [] },
        note: DEFAULT_NOTE };
    }
    p.id = uid(); p.date = todayIso(); p.updated = Date.now(); p.savedId = null;
    markSaved(p);
    return p;
  }
  function defaultState() {
    return { version: 3, roster: DEFAULT_ROSTER.map(function (r) { return { id: uid(), rank: r[0], name: r[1], color: r[2] }; }), layouts: [], plans: [], draft: newPlan(null, L.GEZINA), lastLayoutId: L.GEZINA.id };
  }
  function migrate(s) {
    if (!(s.version >= 2)) {
      s.layouts = s.layouts || [];
      s.roster.forEach(function (r) {
        if (!r.color) { var d = DEFAULT_ROSTER.filter(function (x) { return x[0] === r.rank && x[1] === r.name; })[0]; r.color = d ? d[2] : '#FFFFFF'; }
      });
      s.plans.forEach(function (p) { p.layoutId = p.layoutId || L.GEZINA.id; delete p.congregation; });
    }
    if (!(s.version >= 3)) {
      // Earlier versions autosaved one current plan; keep all plans as saved plans and start fresh.
      var cur = s.plans.filter(function (p) { return p.id === s.currentId; })[0];
      s.lastLayoutId = cur ? cur.layoutId : L.GEZINA.id;
      s.plans.forEach(function (p) { p.name = p.name || ''; });
      s.draft = null; delete s.currentId;
    }
    s.version = 3;
    return s;
  }
  var restored = false;
  function load() {
    var s = null;
    try { var raw = localStorage.getItem(STORAGE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { /* defaults */ }
    if (!s || !Array.isArray(s.roster)) return defaultState();
    s = migrate(s);
    s.plans = s.plans || []; s.layouts = s.layouts || [];
    var lay = null;
    if (s.draft && s.draft.savedHash != null && planContent(s.draft) !== s.draft.savedHash) restored = true;
    else {
      lay = (s.layouts.concat(L.BUILTIN)).filter(function (l) { return l.id === s.lastLayoutId; })[0] || L.GEZINA;
      s.draft = newPlan(null, lay);
    }
    return s;
  }
  function save() {
    current().updated = Date.now(); state.lastLayoutId = current().layoutId;
    var badge = $('#unsaved'); if (badge) badge.hidden = !isDirty();
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
  function planTitle(p) { var lay = layoutById(p.layoutId); return [P.formatDate(p.date), p.service, lay && lay.name].filter(Boolean).join(' · '); }
  function renderPlans() {
    var sel = $('#plans-select'); sel.innerHTML = '';
    sel.appendChild(option('', state.plans.length ? '— choose a saved plan —' : '(no saved plans yet)', !current().savedId));
    state.plans.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.updated || 0) - (a.updated || 0); }).forEach(function (p) {
      sel.appendChild(option(p.id, planTitle(p), p.id === current().savedId));
    });
    $('#btn-delete-plan').disabled = !current().savedId;
    $('#unsaved').hidden = !isDirty();
  }
  function renderLayoutTab() {
    var lay = currentLayout();
    $('#layout-name').value = lay.name;
    $('#layout-name').disabled = !!lay.builtin;
    $('#btn-layout-delete').disabled = !!lay.builtin || allLayouts().length < 2;
    $('#btn-layout-edit').textContent = global.Editor.active ? 'Finish editing' : 'Edit this layout';
    var bg = lay.background && lay.background.dataUrl;
    $('#background-tools').hidden = !global.Editor.active;
    $('#btn-background-toggle').hidden = !bg; $('#btn-background-remove').hidden = !bg;
    $('#btn-background-toggle').textContent = (lay.background && lay.background.show === false) ? 'Show picture' : 'Hide picture';
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
  // Reads an image file and returns a data URL, downscaled so it stays small enough for browser storage.
  function imageToDataUrl(file, cb) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var scale = Math.min(1, 1400 / img.width, 1100 / img.height), c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Could not read that picture.', true); };
    img.src = url;
  }
  function validLayout(l) { return l && typeof l.name === 'string' && Array.isArray(l.blocks) && Array.isArray(l.seats) && Array.isArray(l.stationGroups) && l.altar && l.altar.inner; }
  function switchLayout(id) {
    var plan = current(), lay = layoutById(id);
    if (!lay) return;
    plan.layoutId = id; plan.stations = L.blankStations(lay); plan.cups = clone(lay.cups || { left: 0, right: 0 }); state.lastLayoutId = id;
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
    $('#plans-select').addEventListener('change', function (e) {
      var id = e.target.value, saved = state.plans.filter(function (p) { return p.id === id; })[0];
      if (!saved) { renderPlans(); return; }
      if (isDirty() && !confirm('You have unsaved changes. Load "' + planTitle(saved) + '" and discard them?')) { renderPlans(); return; }
      var d = clone(saved); d.savedId = saved.id; markSaved(d); state.draft = d; ui.selected = null; global.Editor.setActive(false);
      save(); renderHeader(); renderAll(); toast('Loaded ' + planTitle(saved) + '.');
    });
    function savePlan(asNew) {
      var d = current(), copy = clone(d); delete copy.savedHash; delete copy.savedId;
      var existing = !asNew && d.savedId && state.plans.filter(function (p) { return p.id === d.savedId; })[0];
      if (existing) { copy.id = existing.id; state.plans[state.plans.indexOf(existing)] = copy; }
      else { copy.id = uid(); state.plans.push(copy); d.savedId = copy.id; }
      markSaved(d); save(); renderPlans(); toast('Plan saved: ' + planTitle(copy) + '.');
    }
    $('#btn-save-plan').addEventListener('click', function () { savePlan(false); });
    $('#btn-save-plan-as').addEventListener('click', function () { savePlan(true); });
    $('#btn-blank-plan').addEventListener('click', function () {
      if (isDirty() && !confirm('You have unsaved changes. Start a blank plan and discard them?')) return;
      state.draft = newPlan(null, currentLayout()); ui.selected = null; save(); renderHeader(); renderAll(); toast('Blank plan started.');
    });
    $('#btn-delete-plan').addEventListener('click', function () {
      var d = current(), saved = state.plans.filter(function (p) { return p.id === d.savedId; })[0];
      if (!saved || !confirm('Delete the saved plan "' + planTitle(saved) + '"?')) return;
      state.plans = state.plans.filter(function (p) { return p.id !== saved.id; }); d.savedId = null;
      save(); renderPlans(); toast('Saved plan deleted. The current plan stays open as unsaved.');
    });
    $('#btn-export').addEventListener('click', function () { downloadJson(state, 'seating-planner-backup.json'); });
    $('#file-import').addEventListener('change', function (e) {
      if (e.target.files[0]) readJson(e.target.files[0], function (s) {
        if (!s || !Array.isArray(s.plans) || !Array.isArray(s.roster)) { toast('That file is not a planner backup.', true); return; }
        state = migrate(s); state.plans = state.plans || []; state.layouts = state.layouts || [];
        if (!state.draft) state.draft = newPlan(null, layoutById(state.lastLayoutId) || L.GEZINA);
        save(); ui.selected = null; renderHeader(); renderAll(); toast('Backup imported.');
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
      state.plans.concat([current()]).forEach(function (p) { if (p.layoutId === lay.id) { p.layoutId = fallback; p.stations = L.blankStations(layoutById(fallback)); } });
      global.Editor.setActive(false); save(); renderHeader(); renderAll();
    });
    $('#btn-layout-export').addEventListener('click', function () { var lay = clone(currentLayout()); delete lay.builtin; downloadJson(lay, 'layout-' + lay.name.replace(/[^A-Za-z0-9]+/g, '_') + '.json'); });
    $('#file-layout-import').addEventListener('change', function (e) {
      var file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (/^image\//.test(file.type)) {
        var name = prompt('Name of the congregation for this picture:', file.name.replace(/\.[^.]+$/, ''));
        if (!name) return;
        imageToDataUrl(file, function (dataUrl) {
          var lay = L.blankLayout(name.trim()); lay.id = uid(); lay.background = { dataUrl: dataUrl, opacity: 0.5, show: true };
          state.layouts.push(lay); switchLayout(lay.id); ui.tab = 'layout'; renderTabs();
          $('#btn-layout-edit').click();
          toast('Picture loaded as a tracing background. Drag the altar into place, then add blocks, seats and stations over the picture.');
        });
        return;
      }
      readJson(file, function (lay) {
        if (!validLayout(lay)) { toast('That file is not a layout.', true); return; }
        lay.id = uid(); lay.builtin = false; state.layouts.push(lay); switchLayout(lay.id); toast('Layout "' + lay.name + '" imported.');
      });
    });
    $('#file-background').addEventListener('change', function (e) {
      var file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      imageToDataUrl(file, function (dataUrl) { editableLayout().background = { dataUrl: dataUrl, opacity: 0.5, show: true }; save(); renderPlan(); renderLayoutTab(); });
    });
    $('#btn-background-toggle').addEventListener('click', function () { var b = editableLayout().background; if (b) { b.show = b.show === false; save(); renderPlan(); renderLayoutTab(); } });
    $('#btn-background-remove').addEventListener('click', function () { delete editableLayout().background; save(); renderPlan(); renderLayoutTab(); });
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
    if (restored) toast('Restored your unsaved changes.');
  }

  global.App = { current: current, currentLayout: currentLayout, editableLayout: editableLayout, save: save, renderPlan: renderPlan, toast: toast, colorOf: colorOf, getState: function () { return state; } };
  document.addEventListener('DOMContentLoaded', init);
})(window);

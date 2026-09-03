/*
 * Layout editor: drag blocks, seats, markers, the altar and station groups
 * on the plan, and edit their properties in a form.
 */
(function (global) {
  'use strict';
  var L = global.Layout, App;
  var E = { active: false, selected: null };

  function $(s, r) { return (r || document).querySelector(s); }
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
  function field(label, input) { return el('label', { class: 'f' }, [label, input]); }
  function num(obj, key, onChange, step) {
    var i = el('input', { type: 'number', value: obj[key] == null ? '' : Math.round(obj[key] * 10) / 10, step: step || 1 });
    i.addEventListener('change', function () { obj[key] = parseFloat(i.value) || 0; onChange(); });
    return i;
  }
  function txt(obj, key, onChange, placeholder) {
    var i = el('input', { type: 'text', value: obj[key] || '', placeholder: placeholder || '' });
    i.addEventListener('change', function () { obj[key] = i.value; onChange(); });
    return i;
  }
  function color(obj, key, onChange) {
    var i = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(obj[key] || '') ? obj[key] : '#ffffff' });
    i.addEventListener('input', function () { obj[key] = i.value; onChange(); });
    return i;
  }
  function select(obj, key, options, onChange) {
    var s = el('select');
    options.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if ((obj[key] || '') === o[0]) op.selected = true; s.appendChild(op); });
    s.addEventListener('change', function () { obj[key] = s.value; onChange(); });
    return s;
  }

  function find(layout, type, id) {
    if (type === 'block') return layout.blocks.filter(function (b) { return b.id === id; })[0];
    if (type === 'seat') return layout.seats.filter(function (s) { return s.id === id; })[0];
    if (type === 'marker') return layout.markers.filter(function (m) { return m.id === id; })[0];
    if (type === 'group') return layout.stationGroups.filter(function (g) { return g.id === id; })[0];
    if (type === 'altar') return layout.altar;
    return null;
  }
  function remove(layout, type, id) {
    var list = { block: layout.blocks, seat: layout.seats, marker: layout.markers, group: layout.stationGroups }[type];
    if (!list) return;
    var i = list.map(function (x) { return x.id; }).indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }

  function changed() { App.save(); App.renderPlan(); }

  function renderPanel() {
    var box = $('#editor');
    if (!box) return;
    box.innerHTML = '';
    if (!E.active) return;
    var layout = App.editableLayout();
    box.appendChild(el('p', { class: 'muted small', text: 'Drag things on the plan to move them. Tap one to edit it below.' }));
    var add = el('div', { class: 'row' }, [
      el('button', { type: 'button', class: 'btn small ghost', text: '+ Block', onclick: function () {
        var b = { id: L.newId('b', layout.blocks), label: 'New block', x: 400, y: 300, w: 200, h: 120, fill: '#FFFFFF' };
        layout.blocks.push(b); E.selected = { type: 'block', id: b.id }; changed(); renderPanel();
      } }),
      el('button', { type: 'button', class: 'btn small ghost', text: '+ Seat', onclick: function () {
        var id = prompt('Seat number or label:', String(layout.seats.length + 1));
        if (!id) return;
        if (find(layout, 'seat', id)) { App.toast('There is already a seat ' + id + '.', true); return; }
        layout.seats.push({ id: id.trim(), x: 530, y: 200 }); E.selected = { type: 'seat', id: id.trim() }; changed(); renderPanel();
      } }),
      el('button', { type: 'button', class: 'btn small ghost', text: '+ Marker', onclick: function () {
        var id = prompt('Marker letter (e.g. C for choir leader):', 'X');
        if (!id) return;
        layout.markers.push({ id: id.trim().slice(0, 2), x: 530, y: 350 }); E.selected = { type: 'marker', id: id.trim().slice(0, 2) }; changed(); renderPanel();
      } }),
      el('button', { type: 'button', class: 'btn small ghost', text: '+ Station group', onclick: function () {
        var g = { id: L.newId('g', layout.stationGroups), label: 'New stations', cx: 545, cy: 230, dx: 42.5, dy: 0, rot: 0, defaults: ['', '', ''] };
        layout.stationGroups.push(g); App.current().stations[g.id] = g.defaults.slice(); E.selected = { type: 'group', id: g.id }; changed(); renderPanel();
      } })
    ]);
    box.appendChild(add);

    var sel = E.selected, obj = sel && find(layout, sel.type, sel.id);
    if (!obj) { box.appendChild(el('p', { class: 'muted', text: 'Nothing selected.' })); return; }
    var form = el('div', { class: 'fields' }), del;
    var reselect = function (type, id) { E.selected = { type: type, id: id }; changed(); renderPanel(); };
    if (sel.type === 'block') {
      form.appendChild(field('Label (use Enter for new lines)', (function () {
        var t = el('textarea', { rows: 2 }); t.value = obj.label || '';
        t.addEventListener('change', function () { obj.label = t.value; changed(); }); return t;
      })()));
      form.appendChild(field('Fill', color(obj, 'fill', changed)));
      form.appendChild(field('Width', num(obj, 'w', changed)));
      form.appendChild(field('Height', num(obj, 'h', changed)));
      form.appendChild(field('Cut corner', select(obj, 'cut', [['', 'None'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']], changed)));
      form.appendChild(field('Cut size', num(obj, 'cutSize', changed)));
      form.appendChild(field('Text size', num(obj, 'fontSize', changed)));
    } else if (sel.type === 'seat') {
      form.appendChild(field('Seat number', (function () {
        var i = el('input', { type: 'text', value: obj.id });
        i.addEventListener('change', function () {
          var nid = i.value.trim();
          if (!nid || (nid !== obj.id && find(layout, 'seat', nid))) { i.value = obj.id; return; }
          var plan = App.current(), old = obj.id;
          if (plan.seats[old] != null) { plan.seats[nid] = plan.seats[old]; delete plan.seats[old]; }
          obj.id = nid; reselect('seat', nid);
        }); return i;
      })()));
      form.appendChild(field('Width', num(obj, 'w', changed)));
      form.appendChild(field('Height', num(obj, 'h', changed)));
      form.appendChild(field('Hide number when empty', select(obj, 'quiet', [['', 'No'], ['1', 'Yes']], function () { obj.quiet = !!obj.quiet; changed(); })));
    } else if (sel.type === 'marker') {
      form.appendChild(field('Letter', txt(obj, 'id', function () { reselect('marker', obj.id); })));
    } else if (sel.type === 'group') {
      form.appendChild(field('Name', txt(obj, 'label', changed)));
      form.appendChild(field('Direction', select(obj, 'dir', [['h', 'Row, left to right'], ['dr', 'Diagonal, down-right'], ['dl', 'Diagonal, down-left'], ['v', 'Column, top to bottom']], function () {
        var d = { h: [42.5, 0, 0], dr: [27, 27, 45], dl: [27, -27, -45], v: [0, 42.5, 0] }[obj.dir] || [42.5, 0, 0];
        obj.dx = d[0]; obj.dy = d[1]; obj.rot = d[2]; changed();
      })));
      form.appendChild(field('Usual seat numbers (comma separated)', (function () {
        var i = el('input', { type: 'text', value: (obj.defaults || []).join(', ') });
        i.addEventListener('change', function () {
          obj.defaults = i.value.split(',').map(function (s) { return s.trim(); }).filter(function (s, k, arr) { return s || k < arr.length; }).slice(0, L.MAX_STATIONS);
          App.current().stations[obj.id] = obj.defaults.slice(); changed();
        }); return i;
      })()));
    } else if (sel.type === 'altar') {
      form.appendChild(field('Width', num(obj, 'w', changed)));
      form.appendChild(field('Height', num(obj, 'h', changed)));
      form.appendChild(field('Label', txt(obj, 'label', changed)));
      form.appendChild(field('Colour', color(obj, 'fill', changed)));
    }
    box.appendChild(el('h3', { class: 'sub', text: ({ block: 'Block', seat: 'Seat ' + sel.id, marker: 'Marker ' + sel.id, group: 'Station group', altar: 'Altar' })[sel.type] }));
    box.appendChild(form);
    if (sel.type !== 'altar') {
      del = el('button', { type: 'button', class: 'btn small danger', text: 'Delete', onclick: function () {
        if (!confirm('Delete this ' + sel.type + '?')) return;
        remove(layout, sel.type, sel.id);
        if (sel.type === 'seat') delete App.current().seats[sel.id];
        if (sel.type === 'group') delete App.current().stations[sel.id];
        E.selected = null; changed(); renderPanel();
      } });
      box.appendChild(el('div', { class: 'row' }, [del]));
    }
  }

  // ---- dragging on the plan ------------------------------------------------
  var drag = null;
  function svgPoint(svg, ev) {
    var r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * L.W / r.width, y: (ev.clientY - r.top) * L.H / r.height };
  }
  function onDown(ev) {
    if (!E.active) return;
    var t = ev.target.closest('[data-edit]');
    if (!t) return;
    var parts = t.getAttribute('data-edit').split(':'), type = parts[0], id = parts[1];
    var svg = ev.currentTarget.querySelector('svg');
    if (type === 'none') { E.selected = null; App.renderPlan(); renderPanel(); return; }
    var layout = App.editableLayout(), obj = find(layout, type, id);
    if (!obj) return;
    ev.preventDefault();
    E.selected = { type: type, id: id };
    var p = svgPoint(svg, ev);
    var base = type === 'group' ? { x: obj.cx, y: obj.cy } : { x: obj.x, y: obj.y };
    var inner = type === 'altar' ? { x: obj.inner.x, y: obj.inner.y } : null;
    drag = { type: type, obj: obj, start: p, base: base, inner: inner, moved: false, pointerId: ev.pointerId };
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    App.renderPlan(); renderPanel();
  }
  function onMove(ev) {
    if (!drag) return;
    var svg = ev.currentTarget.querySelector('svg'), p = svgPoint(svg, ev);
    var dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y);
    if (!dx && !dy) return;
    drag.moved = true;
    if (drag.type === 'group') { drag.obj.cx = drag.base.x + dx; drag.obj.cy = drag.base.y + dy; }
    else {
      drag.obj.x = drag.base.x + dx; drag.obj.y = drag.base.y + dy;
      if (drag.inner) { drag.obj.inner.x = drag.inner.x + dx; drag.obj.inner.y = drag.inner.y + dy; }
    }
    App.renderPlan();
  }
  function onUp() {
    if (!drag) return;
    if (drag.moved) App.save();
    drag = null;
  }

  E.init = function (app) {
    App = app;
    var plan = $('#plan');
    plan.addEventListener('pointerdown', onDown);
    plan.addEventListener('pointermove', onMove);
    plan.addEventListener('pointerup', onUp);
    plan.addEventListener('pointercancel', onUp);
  };
  E.setActive = function (on) { E.active = !!on; if (!on) E.selected = null; renderPanel(); };
  E.render = renderPanel;
  global.Editor = E;
})(window);

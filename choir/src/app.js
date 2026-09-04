/*
 * Choir Programme Planner - application logic.
 * Everything lives in localStorage; there is no server and no login.
 */
(function (global) {
  'use strict';

  var H = global.Hymns, M = global.Model, S = global.Sheets;
  var STORAGE_KEY = 'nac-choir-planner:v1';
  var TABS = ['program', 'before', 'prep', 'practices', 'hymns', 'files'];

  // ---------------------------------------------------------------- helpers
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'value') e.value = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function option(value, text, selected) {
    var o = el('option', { value: value, text: text });
    if (selected) o.selected = true;
    return o;
  }
  function select(values, current, onChange, opts) {
    opts = opts || {};
    var s = el('select', { class: opts.class || '', onchange: function () { onChange(s.value); } });
    if (opts.blank != null) s.appendChild(option('', opts.blank, !current));
    values.forEach(function (v) {
      var val = typeof v === 'string' ? v : v.value, txt = typeof v === 'string' ? v : v.text;
      s.appendChild(option(val, txt, val === current));
    });
    return s;
  }
  function iconBtn(label, title, onClick, cls) {
    return el('button', { class: 'icon ' + (cls || ''), type: 'button', title: title, 'aria-label': title, text: label, onclick: onClick });
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
  var state, ui = { tab: 'program', picker: null, hymnOpen: null };

  // Everything the hymn library reads out of the saved state: the conductor's
  // edits to the index and their own set of ability ratings.
  function adopt() {
    state.settings = state.settings || {};
    if (!state.settings.abilities || !state.settings.abilities.length) {
      state.settings.abilities = H.defaultAbilities();
    }
    state.hymnEdits = state.hymnEdits || {};
    H.setAbilities(state.settings.abilities);
    H.setEdits(state.hymnEdits);
  }

  function blankState() {
    return {
      v: 1,
      settings: { congregation: '', conductor: '', organist: '', time: '10:00', abilities: H.defaultAbilities() },
      services: [], currentId: null, hymnEdits: {}
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.services) return s;
      }
    } catch (e) { /* a broken or blocked store just starts empty */ }
    return blankState();
  }
  var saveTimer;
  function save(now) {
    clearTimeout(saveTimer);
    var write = function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        toast('This browser would not save the changes.', true);
      }
    };
    if (now) write(); else saveTimer = setTimeout(write, 400);
  }
  function current() {
    var s = null;
    (state.services || []).forEach(function (x) { if (x.id === state.currentId) s = x; });
    if (!s) {
      s = state.services[0];
      if (!s) {
        s = M.newService(state.settings);
        state.services.push(s);
      }
      state.currentId = s.id;
    }
    return s;
  }


  // ------------------------------------------------------- the hymn picker
  /*
   * A reference box: type "104", "E 104" or "A 12" and the title appears beside
   * it; "Find" opens the search over the whole index.
   */
  function refField(get, set, opts) {
    opts = opts || {};
    var titleEl = el('span', { class: 'hymn-title' });
    var input = el('input', { class: 'ref', type: 'text', value: get() || '', placeholder: 'No.', autocomplete: 'off' });
    function refresh() {
      var h = H.get(input.value);
      titleEl.textContent = h ? h.title : (input.value.trim() ? 'not in the index' : '');
      titleEl.className = 'hymn-title' + (h ? '' : (input.value.trim() ? ' warn' : ''));
      if (h && h.ability) titleEl.appendChild(abilityPill(h.ability));
      if (h && h.comment) titleEl.appendChild(el('span', { class: 'pill note', text: h.comment }));
    }
    input.addEventListener('input', function () { set(input.value); refresh(); save(); });
    input.addEventListener('blur', function () {
      var n = H.normRef(input.value);
      if (n !== input.value) { input.value = n; set(n); save(); }
    });
    refresh();
    return el('span', { class: 'reffield' }, [
      input,
      el('button', {
        class: 'btn small ghost find', type: 'button', text: 'Find',
        onclick: function () {
          openPicker(opts.slot, function (ref) {
            input.value = ref; set(ref); refresh(); save();
            if (opts.after) opts.after();
          });
        }
      }),
      titleEl
    ]);
  }

  function openPicker(slot, onPick) {
    ui.picker = { slot: slot || '', book: '', onPick: onPick };
    $('#picker').hidden = false;
    $('#picker-q').value = '';
    renderPicker();
    setTimeout(function () { $('#picker-q').focus(); }, 30);
  }
  function closePicker() {
    ui.picker = null;
    $('#picker').hidden = true;
  }
  function renderPicker() {
    if (!ui.picker) return;
    var chips = $('#picker-chips');
    chips.innerHTML = '';
    function chip(label, on, onClick) {
      chips.appendChild(el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), text: label, onclick: onClick }));
    }
    H.BOOKS.forEach(function (b) {
      chip(b.name, ui.picker.book === b.code, function () {
        ui.picker.book = ui.picker.book === b.code ? '' : b.code;
        renderPicker();
      });
    });
    H.SLOTS.forEach(function (s) {
      chip(s.name, ui.picker.slot === s.code, function () {
        ui.picker.slot = ui.picker.slot === s.code ? '' : s.code;
        renderPicker();
      });
    });
    var q = $('#picker-q').value;
    var list = H.search(q, { book: ui.picker.book, slot: ui.picker.slot });
    var box = $('#picker-results');
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('p', { class: 'muted small', text: 'Nothing matches. Try fewer words, or clear the filters.' }));
      return;
    }
    list.slice(0, 200).forEach(function (h) {
      box.appendChild(el('button', {
        type: 'button', class: 'result', onclick: function () {
          var pick = ui.picker.onPick;
          closePicker();
          pick(h.ref);
        }
      }, [
        el('span', { class: 'r-ref', text: h.ref }),
        el('span', { class: 'r-title', text: h.title }),
        hymnPills(h)
      ]));
    });
    if (list.length > 200) {
      box.appendChild(el('p', { class: 'muted small', text: list.length + ' matches; the first 200 are shown.' }));
    }
  }
  function abilityPill(code) {
    var a = H.ability(code);
    return el('span', {
      class: 'pill ability' + (a.missing ? ' missing' : ''),
      'data-code': a.code,
      style: 'border-color:' + a.color + ';color:' + a.color,
      title: a.missing ? 'A rating that is no longer in the list' : a.minutes + ' minutes of practice',
      text: a.name
    });
  }
  function hymnPills(h) {
    var wrap = el('span', { class: 'pills' });
    if (h.ability) wrap.appendChild(abilityPill(h.ability));
    Object.keys(h.slots || {}).forEach(function (k) {
      wrap.appendChild(el('span', { class: 'pill slot', text: H.slotShort(k) + (h.slots[k] === '?' ? '?' : '') }));
    });
    (h.seasons || []).forEach(function (s) {
      if (s) wrap.appendChild(el('span', { class: 'pill season', text: (H.SEASONS.filter(function (x) { return x.code === s; })[0] || {}).name || s }));
    });
    if (h.organ === 'Y') wrap.appendChild(el('span', { class: 'pill organ', text: 'Organ' }));
    if (h.comment) wrap.appendChild(el('span', { class: 'pill note', text: h.comment }));
    return wrap;
  }

  // -------------------------------------------------------- the programme
  function renderProgram() {
    var s = current(), box = $('#program-sections');
    box.innerHTML = '';
    (s.program.sections || []).forEach(function (sec, si) {
      var head = el('div', { class: 'section-head' }, [
        el('input', { class: 'section-label', type: 'text', value: sec.label, oninput: function (e) { sec.label = e.target.value; save(); } }),
        select(H.SLOTS.map(function (x) { return { value: x.code, text: x.name }; }), sec.slot,
          function (v) { sec.slot = v; save(); }, { blank: 'any hymn' }),
        iconBtn('↑', 'Move up', function () {
          if (!si) return;
          s.program.sections.splice(si - 1, 0, s.program.sections.splice(si, 1)[0]);
          save(); renderProgram();
        }),
        iconBtn('↓', 'Move down', function () {
          if (si === s.program.sections.length - 1) return;
          s.program.sections.splice(si + 1, 0, s.program.sections.splice(si, 1)[0]);
          save(); renderProgram();
        }),
        iconBtn('×', 'Remove this section', function () {
          s.program.sections.splice(si, 1); save(); renderProgram();
        }, 'del')
      ]);
      var rows = el('div', { class: 'rows' });
      (sec.rows || []).forEach(function (r, ri) {
        rows.appendChild(el('div', { class: 'prow' }, [
          el('span', { class: 'num', text: String(ri + 1) }),
          select(M.PERFORMERS, r.who, function (v) { r.who = v; save(); }),
          refField(function () { return r.ref; }, function (v) { r.ref = v; }, { slot: sec.slot }),
          el('input', { class: 'note', type: 'text', value: r.note || '', placeholder: 'note, e.g. 2nd verse', oninput: function (e) { r.note = e.target.value; save(); } }),
          iconBtn('×', 'Remove this hymn', function () { sec.rows.splice(ri, 1); save(); renderProgram(); }, 'del')
        ]));
      });
      var add = el('div', { class: 'row' }, [
        el('button', {
          class: 'btn small ghost', type: 'button', text: 'Add hymn', onclick: function () {
            sec.rows.push(M.newRow(sec.rows.length ? 'Choir' : 'Congregation'));
            save(); renderProgram();
          }
        })
      ]);
      box.appendChild(el('div', { class: 'section' }, [head, rows, add]));
    });

    var sel = $('#add-section');
    sel.innerHTML = '';
    M.DEFAULT_SECTIONS.concat(M.EXTRA_SECTIONS).forEach(function (d, i) {
      sel.appendChild(option(String(i), d.label));
    });
    sel.appendChild(option('custom', 'Other…'));
  }

  // ------------------------------------------------------ before service
  function renderBefore() {
    var s = current(), b = s.before;
    bindOnce($('#bs-title'), function () { return b.title; }, function (v) { b.title = v; });
    var silence = $('#bs-silence');
    silence.value = b.silence == null ? 2 : b.silence;
    silence.onchange = silence.oninput = function () { b.silence = Number(silence.value) || 0; save(); renderBeforeItems(); };
    renderBeforeItems();

    var crew = $('#before-crew');
    crew.innerHTML = '';
    M.BS_CREW_ROLES.forEach(function (role) {
      b.crew[role] = b.crew[role] || { main: '', backup: '' };
      crew.appendChild(crewRow(role, b.crew[role]));
    });

    var cl = $('#before-checklist');
    cl.innerHTML = '';
    (b.checklist || []).forEach(function (t, i) {
      cl.appendChild(el('div', { class: 'row line' }, [
        el('input', { type: 'text', value: t, oninput: function (e) { b.checklist[i] = e.target.value; save(); } }),
        iconBtn('×', 'Remove this line', function () { b.checklist.splice(i, 1); save(); renderBefore(); }, 'del')
      ]));
    });
  }
  function bindOnce(input, get, set) {
    input.value = get() == null ? '' : get();
    input.oninput = function () { set(input.value); save(); };
  }
  function crewRow(role, obj) {
    return el('div', { class: 'crow' }, [
      el('span', { class: 'crole', text: role }),
      el('input', { type: 'text', value: obj.main || '', placeholder: 'main', oninput: function (e) { obj.main = e.target.value; save(); } }),
      el('input', { type: 'text', value: obj.backup || '', placeholder: 'back-up', oninput: function (e) { obj.backup = e.target.value; save(); } })
    ]);
  }
  function refreshTimes() {
    var s = current(), sched = M.beforeSchedule(s), stamps = refreshTimes.rows || [];
    sched.rows.forEach(function (r, i) {
      if (r.silence) {
        if (refreshTimes.silence) refreshTimes.silence.textContent = r.time;
      } else if (stamps[i]) {
        stamps[i].el.textContent = r.time;
      }
    });
    $('#bs-summary').textContent = sched.total
      ? 'The music starts at ' + sched.begins + ' and runs for ' + sched.total + ' minutes.'
      : 'Add the items and their durations; the times count back from the start of the service.';
  }
  function renderBeforeItems() {
    var s = current(), b = s.before, box = $('#before-items');
    box.innerHTML = '';
    // The times are written into the row as it is built and refreshed in place
    // afterwards, so changing a duration does not rebuild the list under the
    // cursor.
    var stamps = [];
    (b.items || []).forEach(function (item) {
      var timeEl = el('span', { class: 'time' });
      stamps.push({ item: item, el: timeEl });
      box.appendChild(el('div', { class: 'prow' }, [
        timeEl,
        refField(function () { return item.ref; }, function (v) { item.ref = v; }, { slot: 'bs' }),
        select(M.PERFORMERS, item.discipline, function (v) { item.discipline = v; save(); }),
        el('input', {
          class: 'mins', type: 'number', min: '0', max: '60', value: item.minutes,
          oninput: function (e) { item.minutes = Number(e.target.value) || 0; save(); refreshTimes(); }
        }),
        el('span', { class: 'unit', text: 'min' }),
        iconBtn('×', 'Remove this item', function () {
          b.items.splice(b.items.indexOf(item), 1); save(); renderBeforeItems();
        }, 'del')
      ]));
    });
    var silenceTime = el('span', { class: 'time' });
    box.appendChild(el('div', { class: 'prow silence' }, [
      silenceTime,
      el('span', { class: 'grow', text: 'Silence, then the service begins at ' + (s.time || '—') })
    ]));
    refreshTimes.rows = stamps;
    refreshTimes.silence = silenceTime;
    refreshTimes();

    var ex = $('#before-exit');
    ex.innerHTML = '';
    (b.exit || []).forEach(function (e2, i) {
      ex.appendChild(el('div', { class: 'prow' }, [
        refField(function () { return e2.ref; }, function (v) { e2.ref = v; }, { slot: 'as' }),
        select(M.PERFORMERS, e2.discipline, function (v) { e2.discipline = v; save(); }),
        el('input', { class: 'note', type: 'text', value: e2.note || '', placeholder: 'note', oninput: function (ev) { e2.note = ev.target.value; save(); } }),
        iconBtn('×', 'Remove this item', function () { b.exit.splice(i, 1); save(); renderBeforeItems(); }, 'del')
      ]));
    });
  }

  // --------------------------------------------------------- preparation
  function renderPrep() {
    var s = current(), p = s.prep;
    [['#p-event', 'event'], ['#p-date', 'date'], ['#p-venue', 'venue'], ['#p-time', 'time'],
     ['#p-coordinator', 'coordinator'], ['#p-contact', 'contact'], ['#p-invited', 'invited']].forEach(function (pair) {
      bindOnce($(pair[0]), function () { return p[pair[1]]; }, function (v) { p[pair[1]] = v; });
    });

    var crew = $('#prep-crew');
    crew.innerHTML = '';
    M.CREW_ROLES.forEach(function (role) {
      p.crew[role] = p.crew[role] || { main: '', backup: '' };
      crew.appendChild(crewRow(role, p.crew[role]));
    });

    var pr = $('#prep-practices');
    pr.innerHTML = '';
    Object.keys(p.practices).forEach(function (name) {
      var grid = el('div', { class: 'grid7' });
      ['dates', 'times', 'venues'].forEach(function (key, i) {
        grid.appendChild(el('span', { class: 'glabel', text: ['Dates', 'Times', 'Venue'][i] }));
        for (var c = 0; c < 7; c++) {
          (function (c) {
            grid.appendChild(el('input', {
              type: 'text', value: (p.practices[name][key] || [])[c] || '',
              oninput: function (e) { p.practices[name][key][c] = e.target.value; save(); }
            }));
          })(c);
        }
      });
      pr.appendChild(el('div', { class: 'pblock' }, [el('h4', { text: name }), grid]));
    });

    var pc = $('#prep-choir');
    pc.innerHTML = '';
    (p.choir || []).forEach(function (item, i) {
      pc.appendChild(el('div', { class: 'prow' }, [
        el('input', { class: 'slotlabel', type: 'text', value: item.slot, oninput: function (e) { item.slot = e.target.value; save(); } }),
        refField(function () { return item.ref; }, function (v) { item.ref = v; }),
        iconBtn('×', 'Remove this line', function () { p.choir.splice(i, 1); save(); renderPrep(); }, 'del')
      ]));
    });

    var lists = $('#prep-lists');
    lists.innerHTML = '';
    [['Orchestra programme', 'orchestra'], ['Organ programme', 'organ'],
     ['Recorder programme', 'recorder'], ['Sunday School choir programme', 'sundaySchool']].forEach(function (pair) {
      var box = el('div', {});
      (p[pair[1]] || []).forEach(function (t, i) {
        box.appendChild(el('div', { class: 'row line' }, [
          el('input', { type: 'text', value: t, placeholder: 'piece', oninput: function (e) { p[pair[1]][i] = e.target.value; save(); } }),
          iconBtn('×', 'Remove this line', function () { p[pair[1]].splice(i, 1); save(); renderPrep(); }, 'del')
        ]));
      });
      box.appendChild(el('div', { class: 'row' }, [
        el('button', {
          class: 'btn small ghost', type: 'button', text: 'Add line',
          onclick: function () { p[pair[1]].push(''); save(); renderPrep(); }
        })
      ]));
      lists.appendChild(el('h3', { class: 'sub', text: pair[0] }));
      lists.appendChild(box);
    });
  }

  // ----------------------------------------------------------- practices
  function renderPractices() {
    var s = current(), box = $('#practice-list');
    box.innerHTML = '';
    if (!(s.practices || []).length) {
      box.appendChild(el('p', { class: 'muted', text: 'No practices yet. "New practice" starts one for this service.' }));
      return;
    }
    s.practices.forEach(function (pr, pi) {
      var items = el('div', { class: 'rows' });
      var totalEl = el('span', { class: 'muted small' });
      function refreshTotal() {
        var mins = (pr.items || []).reduce(function (a, i) { return a + (Number(i.minutes) || 0); }, 0);
        totalEl.textContent = mins
          ? mins + ' minutes' + (pr.start ? ', ending ' + M.fromMinutes(M.toMinutes(pr.start) + mins) : '')
          : '';
      }
      (pr.items || []).forEach(function (it, ii) {
        var h = H.get(it.ref);
        items.appendChild(el('div', { class: 'prow' + (it.done ? ' done' : '') }, [
          el('input', {
            type: 'checkbox', class: 'tick', title: 'Rehearsed', checked: it.done ? true : false,
            onchange: function (e) {
              it.done = e.target.checked;
              e.target.parentNode.classList.toggle('done', it.done);
              save();
            }
          }),
          el('span', { class: 'r-ref', text: H.normRef(it.ref) }),
          el('span', { class: 'grow', text: (h && h.title) || 'not in the index' }),
          el('span', { class: 'ability' }, [h && h.ability ? abilityPill(h.ability) : null]),
          el('input', {
            class: 'mins', type: 'number', min: '0', max: '120', value: it.minutes,
            oninput: function (e) { it.minutes = Number(e.target.value) || 0; save(); refreshTotal(); }
          }),
          el('span', { class: 'unit', text: 'min' }),
          el('input', {
            class: 'note', type: 'text', value: it.focus || '', placeholder: 'what to work on',
            oninput: function (e) { it.focus = e.target.value; save(); }
          }),
          iconBtn('×', 'Remove this piece', function () { pr.items.splice(ii, 1); save(); renderPractices(); }, 'del')
        ]));
      });

      var pieces = M.choirPieces(s), have = {};
      (pr.items || []).forEach(function (i) { have[H.normRef(i.ref)] = true; });
      var missing = pieces.filter(function (p2) { return !have[p2.ref]; });

      box.appendChild(el('div', { class: 'section practice' }, [
        el('div', { class: 'section-head' }, [
          el('input', { type: 'date', value: pr.date, oninput: function (e) { pr.date = e.target.value; save(); } }),
          el('input', { type: 'time', value: pr.start, oninput: function (e) { pr.start = e.target.value; save(); } }),
          el('input', { type: 'text', value: pr.venue || '', placeholder: 'venue', oninput: function (e) { pr.venue = e.target.value; save(); } }),
          el('span', { class: 'grow' }),
          el('button', { class: 'btn small', type: 'button', text: 'Save PDF', onclick: function () { doDoc('pdf', 'practice', pr); } }),
          S.canShareFiles() ? el('button', { class: 'btn small ghost', type: 'button', text: 'Share', onclick: function () { doDoc('share', 'practice', pr); } }) : null,
          el('button', { class: 'btn small ghost', type: 'button', text: 'Print', onclick: function () { doDoc('print', 'practice', pr); } }),
          iconBtn('×', 'Delete this practice', function () {
            if (!confirm('Delete this practice?')) return;
            s.practices.splice(pi, 1); save(); renderPractices();
          }, 'del')
        ]),
        el('div', { class: 'row' }, [
          el('input', { type: 'text', class: 'grow', value: pr.focus || '', placeholder: 'focus for the evening', oninput: function (e) { pr.focus = e.target.value; save(); } })
        ]),
        items,
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn small ghost', type: 'button',
            text: missing.length ? 'Add the ' + missing.length + ' piece' + (missing.length === 1 ? '' : 's') + ' still to rehearse' : 'All programme pieces added',
            disabled: !missing.length,
            onclick: function () {
              missing.forEach(function (m) { pr.items.push(M.newPracticeItem(m.ref)); });
              save(); renderPractices();
            }
          }),
          el('button', {
            class: 'btn small ghost', type: 'button', text: 'Add another hymn',
            onclick: function () {
              openPicker('', function (ref) { pr.items.push(M.newPracticeItem(ref)); save(); renderPractices(); });
            }
          }),
          totalEl
        ]),
        el('label', { class: 'f' }, ['Notes', el('textarea', {
          rows: '2', value: pr.notes || '', oninput: function (e) { pr.notes = e.target.value; save(); }
        })])
      ]));
      refreshTotal();
    });
  }

  // --------------------------------------------------------- hymn index
  function renderHymnFilters(force) {
    var book = $('#hymn-book'), ab = $('#hymn-ability'), slot = $('#hymn-slot'), season = $('#hymn-season');
    if (force) {
      // the ratings have changed, so the filter has to be built again
      var keep = ab.value;
      ab.innerHTML = '';
      ab.appendChild(option('', 'Any ability'));
      H.abilities().forEach(function (a) { ab.appendChild(option(a.code, a.name, a.code === keep)); });
      return;
    }
    if (book.options.length) return;
    book.appendChild(option('', 'Every book'));
    H.BOOKS.forEach(function (b) { book.appendChild(option(b.code, b.name)); });
    ab.appendChild(option('', 'Any ability'));
    H.abilities().forEach(function (a) { ab.appendChild(option(a.code, a.name)); });
    slot.appendChild(option('', 'Any point of the service'));
    H.SLOTS.forEach(function (s) { slot.appendChild(option(s.code, s.name)); });
    season.appendChild(option('', 'Any season'));
    H.SEASONS.forEach(function (s) { season.appendChild(option(s.code, s.name)); });
    [book, ab, slot, season].forEach(function (s) { s.onchange = renderHymns; });
    $('#hymn-q').oninput = renderHymns;
  }
  /*
   * The ratings themselves. The workbook's Easy / Practice / Tricky / Difficult
   * / New / Unknown were how one choir at Phumolong read its hymns; another
   * choir renames them, retimes them or keeps a different set entirely. The
   * one-letter code behind each rating never changes, so renaming one re-labels
   * every hymn that carries it without touching the index.
   */
  function renderAbilityEditor() {
    var box = $('#ability-editor');
    box.innerHTML = '';
    if (box.hidden) return;
    var counts = H.abilityCounts();

    box.appendChild(el('p', { class: 'muted small' }, [
      'How this choir rates a hymn, and how many minutes of practice each rating suggests. ',
      'Renaming a rating re-labels every hymn that carries it.'
    ]));

    H.abilities().forEach(function (a, i) {
      var used = counts[a.code] || 0;
      box.appendChild(el('div', { class: 'prow' }, [
        el('input', {
          type: 'color', value: a.color, title: 'Colour',
          oninput: function (e) { a.color = e.target.value; saveAbilities(false); }
        }),
        el('input', {
          type: 'text', class: 'grow', value: a.name, placeholder: 'name of the rating',
          oninput: function (e) { a.name = e.target.value; saveAbilities(false); }
        }),
        el('input', {
          class: 'mins', type: 'number', min: '0', max: '120', value: a.minutes,
          title: 'Minutes of practice this rating suggests',
          oninput: function (e) { a.minutes = Number(e.target.value) || 0; saveAbilities(false); }
        }),
        el('span', { class: 'unit', text: 'min' }),
        el('span', { class: 'muted small count', text: used + ' hymn' + (used === 1 ? '' : 's') }),
        iconBtn('×', 'Remove this rating', function () {
          if (used && !confirm(used + ' hymn' + (used === 1 ? ' is' : 's are') + ' rated "' + a.name +
              '". Removing the rating leaves them showing "' + a.code +
              '" until you re-rate them. Remove it?')) return;
          state.settings.abilities.splice(i, 1);
          saveAbilities(true);
        }, 'del')
      ]));
    });

    box.appendChild(el('div', { class: 'row' }, [
      el('button', {
        class: 'btn small ghost', type: 'button', text: 'Add a rating',
        onclick: function () {
          state.settings.abilities.push({ code: H.freeAbilityCode(), name: '', minutes: 10, color: '#6b7280' });
          saveAbilities(true);
        }
      }),
      el('button', {
        class: 'btn small ghost', type: 'button', text: 'Back to the workbook’s ratings',
        onclick: function () {
          if (!confirm('Put Easy, Practice, Tricky, Difficult, New and Unknown back as they were?')) return;
          state.settings.abilities = H.defaultAbilities();
          saveAbilities(true);
        }
      })
    ]));
  }
  function saveAbilities(redraw) {
    H.setAbilities(state.settings.abilities);
    save();
    renderHymnFilters(true);
    if (redraw) renderHymns();
    else refreshAbilityLabels();
  }
  // Renaming or recolouring touches only the labels, so the row being typed in
  // is left alone.
  function refreshAbilityLabels() {
    $$('#hymn-results .pill.ability').forEach(function (pill) {
      var a = H.ability(pill.dataset.code);
      if (!a) return;
      pill.textContent = a.name;
      pill.style.borderColor = a.color;
      pill.style.color = a.color;
    });
  }

  function renderHymns() {
    renderHymnFilters();
    renderAbilityEditor();
    var list = H.search($('#hymn-q').value, {
      book: $('#hymn-book').value, ability: $('#hymn-ability').value,
      slot: $('#hymn-slot').value, season: $('#hymn-season').value
    });
    $('#hymn-count').textContent = list.length + ' of ' + H.count + ' hymns';
    var box = $('#hymn-results');
    box.innerHTML = '';
    list.slice(0, 300).forEach(function (h) {
      var open = ui.hymnOpen === h.ref;
      var row = el('button', {
        type: 'button', class: 'result' + (open ? ' open' : ''), onclick: function () {
          ui.hymnOpen = open ? null : h.ref;
          renderHymns();
        }
      }, [
        el('span', { class: 'r-ref', text: h.ref }),
        el('span', { class: 'r-title', text: h.title }),
        hymnPills(h)
      ]);
      box.appendChild(row);
      if (open) box.appendChild(hymnEditor(h));
    });
    if (!list.length) box.appendChild(el('p', { class: 'muted small', text: 'Nothing matches.' }));
    if (list.length > 300) box.appendChild(el('p', { class: 'muted small', text: 'The first 300 are shown.' }));
  }
  /*
   * The index ships exactly as the workbook had it; an edit is kept apart, so
   * "Back to the workbook" always restores the original line.
   */
  function hymnEditor(h) {
    function edit() {
      state.hymnEdits[h.ref] = state.hymnEdits[h.ref] || {};
      return state.hymnEdits[h.ref];
    }
    function apply() {
      H.setEdits(state.hymnEdits);
      save();
      renderHymns();
    }
    var slots = el('div', { class: 'row chips' });
    H.SLOTS.forEach(function (s) {
      var on = !!h.slots[s.code];
      slots.appendChild(el('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), text: s.name, onclick: function () {
          var next = {};
          Object.keys(h.slots).forEach(function (k) { next[k] = h.slots[k]; });
          if (on) delete next[s.code]; else next[s.code] = true;
          edit().slots = next;
          apply();
        }
      }));
    });
    var seasons = el('div', { class: 'row chips' });
    H.SEASONS.forEach(function (s) {
      var on = h.seasons.indexOf(s.code) >= 0;
      seasons.appendChild(el('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), text: s.name, onclick: function () {
          var next = h.seasons.filter(function (x) { return x && x !== s.code; });
          if (!on) next.push(s.code);
          edit().seasons = next;
          apply();
        }
      }));
    });
    var roundNames = { '1': 'First', '2': 'Second', '3': 'Third' };
    var rounds = Object.keys(h.rounds || {}).map(function (k) { return roundNames[k] + ' ' + h.rounds[k]; });
    return el('div', { class: 'editor' }, [
      rounds.length ? el('p', { class: 'muted small', text: 'Marked in the workbook’s practice columns: ' + rounds.join(', ') + '.' }) : null,
      el('div', { class: 'row' }, [
        el('label', { class: 'f inline' }, ['Ability', select(H.abilities().map(function (a) { return { value: a.code, text: a.name }; }), h.ability,
          function (v) { edit().ability = v; apply(); }, { blank: 'not rated' })]),
        el('label', { class: 'f inline' }, ['Organ', select([{ value: 'Y', text: 'Yes' }, { value: 'N', text: 'No' }], h.organ,
          function (v) { edit().organ = v; apply(); }, { blank: '—' })])
      ]),
      el('label', { class: 'f' }, ['Comment', el('input', {
        type: 'text', value: h.comment, placeholder: 'e.g. Alto solo',
        oninput: function (e) { edit().comment = e.target.value; H.setEdits(state.hymnEdits); save(); }
      })]),
      el('p', { class: 'muted small', text: 'Suits these points of the service:' }), slots,
      el('p', { class: 'muted small', text: 'Season:' }), seasons,
      el('div', { class: 'row' }, [
        el('button', {
          class: 'btn small ghost', type: 'button', text: 'Use this hymn in the programme',
          onclick: function () {
            var s = current(), sec = s.program.sections[0];
            if (!sec) { toast('Add a section to the programme first.', true); return; }
            sec.rows.push(M.newRow('Choir', h.ref));
            save();
            setTab('program');
            toast(h.ref + ' added to “' + sec.label + '”.');
          }
        }),
        h.edited ? el('button', {
          class: 'btn small ghost', type: 'button', text: 'Back to the workbook',
          onclick: function () { delete state.hymnEdits[h.ref]; apply(); }
        }) : null
      ])
    ]);
  }

  // -------------------------------------------------------------- files
  function renderFiles() {
    var box = $('#service-list');
    box.innerHTML = '';
    (state.services || []).forEach(function (sv) {
      box.appendChild(el('div', { class: 'prow' + (sv.id === state.currentId ? ' on' : '') }, [
        el('span', { class: 'grow', text: M.serviceTitle(sv) }),
        el('button', {
          class: 'btn small ghost', type: 'button', text: sv.id === state.currentId ? 'Open' : 'Open',
          onclick: function () { state.currentId = sv.id; save(); renderAll(); toast('Opened ' + M.serviceTitle(sv)); }
        }),
        el('button', {
          class: 'btn small ghost', type: 'button', text: 'Duplicate',
          onclick: function () {
            var copy = M.clone(sv);
            copy.id = M.uid();
            copy.name = '';
            state.services.push(copy);
            state.currentId = copy.id;
            save(); renderAll();
          }
        }),
        iconBtn('×', 'Delete this service', function () {
          if (!confirm('Delete "' + M.serviceTitle(sv) + '"? This cannot be undone.')) return;
          state.services = state.services.filter(function (x) { return x.id !== sv.id; });
          if (state.currentId === sv.id) state.currentId = (state.services[0] || {}).id || null;
          save(); renderAll();
        }, 'del')
      ]));
    });

    [['#s-congregation', 'congregation'], ['#s-conductor', 'conductor'],
     ['#s-organist', 'organist'], ['#s-time', 'time']].forEach(function (pair) {
      bindOnce($(pair[0]), function () { return state.settings[pair[1]]; }, function (v) { state.settings[pair[1]] = v; });
    });
  }

  // --------------------------------------------------------------- shell
  function renderServiceBar() {
    var s = current(), sel = $('#service-select');
    sel.innerHTML = '';
    state.services.forEach(function (sv) { sel.appendChild(option(sv.id, M.serviceTitle(sv), sv.id === s.id)); });
    sel.onchange = function () { state.currentId = sel.value; save(); renderAll(); };
    [['#f-congregation', 'congregation'], ['#f-date', 'date'], ['#f-time', 'time'],
     ['#f-occasion', 'occasion'], ['#f-conductor', 'conductor'], ['#f-organist', 'organist']].forEach(function (pair) {
      bindOnce($(pair[0]), function () { return s[pair[1]]; }, function (v) {
        var was = s[pair[1]];
        s[pair[1]] = v;
        // the preparation form repeats the date and time, so keep it in step
        // for as long as it has not been given one of its own
        if ((pair[1] === 'date' || pair[1] === 'time') && (!s.prep[pair[1]] || s.prep[pair[1]] === was)) {
          s.prep[pair[1]] = v;
        }
        if (pair[1] === 'time' || pair[1] === 'date') renderBeforeItems();
        renderServiceOptions();
      });
    });
  }
  function renderServiceOptions() {
    var sel = $('#service-select');
    $$('option', sel).forEach(function (o) {
      var sv = state.services.filter(function (x) { return x.id === o.value; })[0];
      if (sv) o.textContent = M.serviceTitle(sv);
    });
  }
  function setTab(name) {
    ui.tab = name;
    TABS.forEach(function (t) { $('#tab-' + t).hidden = t !== name; });
    $$('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    if (name === 'program') renderProgram();
    if (name === 'before') renderBefore();
    if (name === 'prep') renderPrep();
    if (name === 'practices') renderPractices();
    if (name === 'hymns') renderHymns();
    if (name === 'files') renderFiles();
    try { localStorage.setItem(STORAGE_KEY + ':tab', name); } catch (e) { /* not important */ }
  }
  function renderAll() {
    renderServiceBar();
    setTab(ui.tab);
  }

  function doDoc(act, kind, extra) {
    var s = current();
    try {
      if (act === 'pdf') toast('Saved ' + S.download(kind, s, extra));
      else if (act === 'print') { S.print(kind, s, extra); toast('Sending to the printer…'); }
      else {
        S.share(kind, s, extra).then(function (r) {
          if (r === 'downloaded') toast('Sharing is not available here, so the PDF was downloaded.');
        }).catch(function (e) { toast(e.message || 'The PDF could not be shared.', true); });
      }
    } catch (e) {
      toast(e.message || 'The PDF could not be built.', true);
    }
  }

  function exportBackup() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = 'choir-planner-backup-' + M.todayIso() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    toast('Backup saved.');
  }
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = JSON.parse(reader.result);
        if (!s || !s.services) throw new Error('That file is not a planner backup.');
        state = s;
        adopt();
        save(true);
        renderAll();
        toast('Backup loaded: ' + state.services.length + ' service' + (state.services.length === 1 ? '' : 's') + '.');
      } catch (e) {
        toast(e.message || 'That file could not be read.', true);
      }
    };
    reader.readAsText(file);
  }

  function init() {
    state = load();
    adopt();
    if (!state.services.length) state.services.push(M.newService(state.settings));

    $$('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });
    try {
      var t = localStorage.getItem(STORAGE_KEY + ':tab');
      if (TABS.indexOf(t) >= 0) ui.tab = t;
    } catch (e) { /* fall back to the first tab */ }

    $('#btn-new-service').addEventListener('click', function () {
      var s = M.newService(state.settings);
      state.services.push(s);
      state.currentId = s.id;
      save(); renderAll();
      toast('New service started.');
    });
    $('#btn-add-section').addEventListener('click', function () {
      var s = current(), v = $('#add-section').value, all = M.DEFAULT_SECTIONS.concat(M.EXTRA_SECTIONS);
      var def = v === 'custom' ? { label: 'New section', slot: '', rows: ['Congregation'] } : all[Number(v)];
      s.program.sections.push(M.newSection(def));
      save(); renderProgram();
    });
    $('#btn-add-before').addEventListener('click', function () {
      current().before.items.push(M.newBeforeItem('Choir'));
      save(); renderBeforeItems();
    });
    $('#btn-add-exit').addEventListener('click', function () {
      current().before.exit.push({ id: M.uid(), ref: '', discipline: 'Organ', minutes: 0, note: '' });
      save(); renderBeforeItems();
    });
    $('#btn-add-check').addEventListener('click', function () {
      current().before.checklist.push('');
      save(); renderBefore();
    });
    $('#btn-add-prep-choir').addEventListener('click', function () {
      current().prep.choir.push({ id: M.uid(), slot: '', ref: '' });
      save(); renderPrep();
    });
    $('#btn-add-practice').addEventListener('click', function () {
      var s = current();
      s.practices.push(M.newPractice({ date: M.beforeDate(s.date, 7), start: '19:00', venue: s.venue }));
      save(); renderPractices();
    });
    $('#btn-abilities').addEventListener('click', function () {
      var box = $('#ability-editor');
      box.hidden = !box.hidden;
      $('#btn-abilities').classList.toggle('on', !box.hidden);
      renderAbilityEditor();
    });
    $('#btn-export').addEventListener('click', exportBackup);
    $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });

    $$('.docbar[data-doc]').forEach(function (bar) {
      var kind = bar.dataset.doc;
      $$('button[data-act]', bar).forEach(function (b) {
        if (b.dataset.act === 'share') b.hidden = !S.canShareFiles();
        b.addEventListener('click', function () { doDoc(b.dataset.act, kind); });
      });
    });

    $('#picker-close').addEventListener('click', closePicker);
    $('#picker').addEventListener('click', function (e) { if (e.target.id === 'picker') closePicker(); });
    $('#picker-q').addEventListener('input', renderPicker);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.picker) closePicker(); });
    window.addEventListener('beforeunload', function () { save(true); });

    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);

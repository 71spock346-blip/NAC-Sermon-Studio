/*
 * The service document. One record holds everything the workbook kept on its
 * four sheets for a single divine service: the music programme, the timed
 * before-service running order, the festive-service preparation form and the
 * choir practices leading up to it.
 */
(function (global) {
  'use strict';

  var H = global.Hymns;

  // The programme sections of a divine service, in the order the workbook had
  // them. "slot" is the tag in the hymn index that suits the section, so the
  // hymn picker can offer sensible hymns for each one.
  var DEFAULT_SECTIONS = [
    { label: 'Before service', slot: 'bs', rows: ['Congregation', 'Choir'] },
    { label: 'Opening hymn', slot: 'bs', rows: ['Congregation'] },
    { label: 'After Bible word', slot: 'at', rows: ['Congregation', 'Choir'] },
    { label: 'Call-up', slot: 'cu', rows: ['Choir', 'Congregation'] },
    { label: 'Hymn of Repentance', slot: 'com', rows: ['Congregation'] },
    { label: 'Holy Communion', slot: 'com', rows: ['Congregation'] },
    { label: 'After service', slot: 'as', rows: ['Congregation'] }
  ];
  var EXTRA_SECTIONS = [
    { label: 'For the departed', slot: 'dep', rows: ['Congregation'] },
    { label: 'Holy Sealing', slot: 'com', rows: ['Choir'] },
    { label: 'Holy Baptism', slot: '', rows: ['Congregation'] },
    { label: 'Confirmation', slot: '', rows: ['Choir'] },
    { label: 'Ordination', slot: '', rows: ['Choir'] }
  ];
  var PERFORMERS = ['Congregation', 'Choir', 'Organ', 'Orchestra', 'Recorders', 'Sunday School Choir', 'Soloist', 'Silence'];
  var CREW_ROLES = ['Choir Conductor', 'Organist', 'Orchestra Conductor', 'Sunday School Choir', 'Recorder Ensemble'];
  var BS_CREW_ROLES = ['Choir Conductor', 'Organist', 'Orchestra Conductor', 'Sunday School Choir', 'Recorders', 'Time Keeper'];
  var PREP_SLOTS = ['B/S', 'Text', 'C/U', 'Acts', 'A/S'];
  var CHECKLIST = [
    'Dial 1026 to do an exact time check.',
    'Synchronise watches – Timekeeper, Conductor, Organist, Orchestra Leader, Music Leaders, and Sacristy/Altar Clock, Duty Minister (Rector).',
    'Check that the after-text piece is on the altar.',
    'Check that all soloists are present and that they are fine.',
    'Seating for orchestra members to be arranged.',
    'Seating for the children’s choir to be arranged.'
  ];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // When a service normally starts, by the day it falls on: the Sunday and
  // midweek services a congregation holds week in, week out. A blank day has
  // no usual time, so the app leaves that service's time alone.
  var DEFAULT_TIMES = ['09:00', '', '', '19:30', '', '', ''];
  var FALLBACK_TIME = '09:00';
  // The date band of the Music Program sheet is formatted "ddd dd mmm".
  function formatDate(iso, withYear) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return DAYS[d.getDay()] + ' ' + m[3] + ' ' + MONTHS[+m[2] - 1] + (withYear ? ' ' + m[1] : '');
  }
  function weekdayOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getDay() : -1;
  }
  // The time a service on this date usually starts, or '' if that day has none.
  function usualTime(iso, times) {
    var d = weekdayOf(iso);
    if (d < 0) return '';
    return ((times || DEFAULT_TIMES)[d]) || '';
  }
  function yearOf(iso) { var m = /^(\d{4})/.exec(iso || ''); return m ? m[1] : String(new Date().getFullYear()); }
  // The date a given number of days before another, for practices leading up
  // to a service.
  function beforeDate(iso, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return todayIso();
    var d = new Date(+m[1], +m[2] - 1, +m[3] - days);
    var out = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return out < todayIso() ? todayIso() : out;
  }

  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  function fromMinutes(mins) {
    if (mins == null || isNaN(mins)) return '';
    var m = ((mins % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  function newRow(who, ref) { return { id: uid(), who: who || 'Congregation', ref: ref || '', note: '' }; }
  function newSection(def) {
    return {
      id: uid(), label: def.label, slot: def.slot || '',
      rows: (def.rows || []).map(function (w) { return newRow(w); })
    };
  }
  function newBeforeItem(discipline) {
    return { id: uid(), ref: '', discipline: discipline || 'Organ', minutes: 3, note: '' };
  }
  function blankCrew(roles) {
    var c = {};
    roles.forEach(function (r) { c[r] = { main: '', backup: '' }; });
    return c;
  }
  function blankPractice(rows) {
    return { dates: ['', '', '', '', '', '', ''], times: ['', '', '', '', '', '', ''], venues: ['', '', '', '', '', '', ''] };
  }

  function newService(defaults) {
    defaults = defaults || {};
    var date = defaults.date || todayIso();
    var time = usualTime(date, defaults.times) || defaults.time || FALLBACK_TIME;
    return {
      id: uid(),
      name: '',
      congregation: defaults.congregation || '',
      date: date,
      time: time,
      // false until the conductor types a time of their own, so that moving
      // the service to another day can still bring that day's usual time
      timeSet: false,
      occasion: '',
      venue: '',
      conductor: defaults.conductor || '',
      organist: defaults.organist || '',
      program: { sections: DEFAULT_SECTIONS.map(newSection) },
      before: {
        title: '',
        items: [newBeforeItem('Organ'), newBeforeItem('Choir'), newBeforeItem('Organ')],
        silence: 2,
        exit: [{ id: uid(), ref: '', discipline: 'Orchestra', minutes: 0, note: '' },
               { id: uid(), ref: '', discipline: 'Organ', minutes: 0, note: '' }],
        crew: blankCrew(BS_CREW_ROLES),
        checklist: CHECKLIST.slice()
      },
      prep: {
        event: '', date: date, venue: '', time: time,
        coordinator: '', contact: '', invited: '',
        crew: blankCrew(CREW_ROLES),
        practices: {
          'Choir Practice': blankPractice(), 'Orch Practice': blankPractice(),
          'Sun Sch Choir': blankPractice(), 'Rec Ens Prac': blankPractice()
        },
        choir: PREP_SLOTS.map(function (s) { return { id: uid(), slot: s, ref: '' }; }),
        orchestra: ['', '', '', '', '', ''],
        recorder: ['', '', ''],
        organ: ['', '', ''],
        sundaySchool: ['', '']
      },
      practices: []
    };
  }

  function newPractice(defaults) {
    defaults = defaults || {};
    return {
      id: uid(), date: defaults.date || todayIso(), start: defaults.start || '19:00',
      venue: defaults.venue || '', focus: '', items: [], notes: ''
    };
  }
  function newPracticeItem(ref) {
    var h = ref ? H.get(ref) : null;
    return { id: uid(), ref: H.normRef(ref || ''), minutes: h ? H.abilityMinutes(h.ability) : 10, focus: '', done: false };
  }

  // Every choir line in the programme, in service order - the pieces a practice
  // has to cover.
  function choirPieces(service) {
    var out = [];
    (service.program.sections || []).forEach(function (s) {
      (s.rows || []).forEach(function (r) {
        if (!r.ref) return;
        if (!/choir|orchestra|recorder|soloist/i.test(r.who || '')) return;
        out.push({ ref: H.normRef(r.ref), who: r.who, section: s.label, note: r.note });
      });
    });
    (service.before.items || []).forEach(function (i) {
      if (i.ref && /choir|orchestra|recorder|soloist/i.test(i.discipline || '')) {
        out.push({ ref: H.normRef(i.ref), who: i.discipline, section: 'Before service', note: i.note });
      }
    });
    (service.prep.choir || []).forEach(function (i) {
      if (i.ref) out.push({ ref: H.normRef(i.ref), who: 'Choir', section: 'Preparation – ' + i.slot, note: '' });
    });
    var seen = {}, uniq = [];
    out.forEach(function (p) { if (!seen[p.ref]) { seen[p.ref] = 1; uniq.push(p); } });
    return uniq;
  }

  // The before-service list is timed backwards from the start of the service:
  // the closing silence ends as the service begins, and everything before it
  // stacks up in front of that.
  function beforeSchedule(service) {
    var items = (service.before.items || []).slice();
    var silence = Math.max(0, Number(service.before.silence) || 0);
    var total = items.reduce(function (a, i) { return a + (Number(i.minutes) || 0); }, 0) + silence;
    var startMin = toMinutes(service.time);
    var t = startMin == null ? null : startMin - total;
    var out = [];
    items.forEach(function (i) {
      out.push({ item: i, time: t == null ? '' : fromMinutes(t), minutes: Number(i.minutes) || 0 });
      if (t != null) t += Number(i.minutes) || 0;
    });
    out.push({ silence: true, time: t == null ? '' : fromMinutes(t), minutes: silence });
    return { rows: out, total: total, begins: t == null ? '' : fromMinutes(startMin - total) };
  }

  function serviceTitle(service) {
    if (service.name) return service.name;
    return [service.occasion || 'Divine service', service.congregation, formatDate(service.date, true)]
      .filter(Boolean).join(' – ');
  }

  global.Model = {
    DEFAULT_SECTIONS: DEFAULT_SECTIONS, EXTRA_SECTIONS: EXTRA_SECTIONS, PERFORMERS: PERFORMERS,
    CREW_ROLES: CREW_ROLES, BS_CREW_ROLES: BS_CREW_ROLES, PREP_SLOTS: PREP_SLOTS, CHECKLIST: CHECKLIST,
    DAY_NAMES: DAY_NAMES, DAYS: DAYS, DEFAULT_TIMES: DEFAULT_TIMES, FALLBACK_TIME: FALLBACK_TIME,
    uid: uid, clone: clone, todayIso: todayIso, formatDate: formatDate, yearOf: yearOf, beforeDate: beforeDate,
    weekdayOf: weekdayOf, usualTime: usualTime,
    toMinutes: toMinutes, fromMinutes: fromMinutes,
    newService: newService, newSection: newSection, newRow: newRow, newBeforeItem: newBeforeItem,
    newPractice: newPractice, newPracticeItem: newPracticeItem,
    choirPieces: choirPieces, beforeSchedule: beforeSchedule, serviceTitle: serviceTitle
  };
})(window);

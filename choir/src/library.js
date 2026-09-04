/*
 * The hymn library: the workbook's "Hymn Index" sheet turned into something
 * searchable, plus the conductor's own edits layered on top of it.
 */
(function (global) {
  'use strict';

  /*
   * How this choir rates a hymn. These six are the ones the Phumolong workbook
   * used; every conductor can rename them, retime them or keep their own set,
   * so they are only the starting point. The one-letter code is what a hymn
   * record stores, so it stays put while the name changes around it.
   */
  var DEFAULT_ABILITIES = [
    { code: 'E', name: 'Easy', minutes: 5, color: '#1f6b1f' },
    { code: 'P', name: 'Practice', minutes: 10, color: '#8a5a00' },
    { code: 'T', name: 'Tricky', minutes: 15, color: '#9a3d00' },
    { code: 'D', name: 'Difficult', minutes: 20, color: '#a11a1a' },
    { code: 'N', name: 'New', minutes: 20, color: '#5b3fa0' },
    { code: 'U', name: 'Unknown', minutes: 15, color: '#6b7280' }
  ];
  var CODE_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var abilityList = DEFAULT_ABILITIES.map(function (a) { return a; });
  // The service points the sheet tags hymns with, in service order.
  var SLOTS = [
    { code: 'bs', short: 'Bs', name: 'Before service' },
    { code: 'at', short: 'At', name: 'After the text word' },
    { code: 'cu', short: 'Cu', name: 'Call-up' },
    { code: 'com', short: 'COM', name: 'Holy Communion' },
    { code: 'as', short: 'As', name: 'After service' },
    { code: 'dep', short: 'Dep', name: 'For the departed' }
  ];
  var SEASONS = [
    { code: 'c', name: 'Christmas' },
    { code: 'e', name: 'Easter' },
    { code: 't', name: 'Thanksgiving' }
  ];
  var BOOKS = [
    { code: 'H', name: 'Hymn book', prefix: '' },
    { code: 'E', name: 'English', prefix: 'E ' },
    { code: 'A', name: 'Afrikaans', prefix: 'A ' }
  ];

  function byCode(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return null;
  }
  function abilities() { return abilityList; }
  function setAbilities(list) {
    abilityList = (list && list.length) ? list : DEFAULT_ABILITIES.map(function (a) { return a; });
  }
  function defaultAbilities() {
    return DEFAULT_ABILITIES.map(function (a) {
      return { code: a.code, name: a.name, minutes: a.minutes, color: a.color };
    });
  }
  // A rating a hymn still carries after its entry has been deleted is reported
  // under its own code rather than vanishing.
  function ability(code) {
    if (!code) return null;
    return byCode(abilityList, code) || { code: code, name: code, minutes: 10, color: '#6b7280', missing: true };
  }
  function abilityName(code) { var a = ability(code); return a ? a.name : ''; }
  function abilityMinutes(code) { var a = ability(code); return a ? a.minutes : 10; }
  function abilityColor(code) { var a = ability(code); return a ? a.color : '#6b7280'; }
  function freeAbilityCode() {
    for (var i = 0; i < CODE_POOL.length; i++) {
      if (!byCode(abilityList, CODE_POOL.charAt(i))) return CODE_POOL.charAt(i);
    }
    return 'z' + abilityList.length;
  }
  function slotName(code) { var s = byCode(SLOTS, code); return s ? s.name : code; }
  function slotShort(code) { var s = byCode(SLOTS, code); return s ? s.short : code; }
  function bookName(code) { var b = byCode(BOOKS, code); return b ? b.name : code; }

  function bookOf(ref) {
    if (/^E\s/.test(ref)) return 'E';
    if (/^A\s/.test(ref)) return 'A';
    return 'H';
  }
  // "e104", "E  104", " 104 " all name the same hymn as they are written in
  // the sheet: "E 104" and "104".
  function normRef(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var m = /^([EAea])\s*(\d+)$/.exec(s);
    if (m) return m[1].toUpperCase() + ' ' + m[2].replace(/^0+(?=\d)/, '');
    m = /^(\d+)$/.exec(s);
    if (m) return m[1].replace(/^0+(?=\d)/, '');
    return s;
  }
  function refNumber(ref) { var m = /(\d+)$/.exec(ref); return m ? parseInt(m[1], 10) : 0; }

  function parseRounds(s) {
    var out = {};
    String(s || '').split(',').forEach(function (part) {
      var m = /^([123]):(.+)$/.exec(part.trim());
      if (m) out[m[1]] = m[2];
    });
    return out;
  }

  function record(row) {
    var slots = {};
    String(row[5] || '').split(',').forEach(function (t) {
      t = t.trim();
      if (!t) return;
      var tentative = /\?$/.test(t);
      slots[t.replace(/\?$/, '')] = tentative ? '?' : true;
    });
    return {
      ref: row[0],
      title: row[1] || '',
      ability: row[2] || '',
      organ: row[3] || '',
      comment: row[4] || '',
      slots: slots,
      seasons: String(row[6] || '').split(''),
      rounds: parseRounds(row[7]),
      book: bookOf(row[0]),
      num: refNumber(row[0])
    };
  }

  var base = (global.HYMN_DATA || []).map(record);
  var index = {};
  base.forEach(function (h) { index[h.ref] = h; });

  // The conductor's edits live in app storage and are merged in on every read,
  // so the shipped index stays exactly as the workbook had it.
  var edits = {};
  function setEdits(e) { edits = e || {}; }

  function merge(h) {
    var e = edits[h.ref];
    if (!e) return h;
    var out = {}, k;
    for (k in h) if (Object.prototype.hasOwnProperty.call(h, k)) out[k] = h[k];
    if (e.ability !== undefined) out.ability = e.ability;
    if (e.organ !== undefined) out.organ = e.organ;
    if (e.comment !== undefined) out.comment = e.comment;
    if (e.slots !== undefined) out.slots = e.slots;
    if (e.seasons !== undefined) out.seasons = e.seasons;
    if (e.rounds !== undefined) out.rounds = e.rounds;
    if (e.title !== undefined) out.title = e.title;
    out.edited = true;
    return out;
  }

  function get(ref) {
    var h = index[normRef(ref)];
    return h ? merge(h) : null;
  }
  function title(ref) { var h = get(ref); return h ? h.title : ''; }
  function all() { return base.map(merge); }

  function bookRank(code) { return code === 'H' ? 0 : (code === 'E' ? 1 : 2); }

  /*
   * Search. A query that looks like a reference ("104", "e 104") puts exact and
   * prefix matches on the number first; anything else matches words in the
   * title. Filters narrow by book, ability, service slot, season and organ.
   */
  function search(query, filters) {
    filters = filters || {};
    var q = String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var refQ = normRef(q), numQ = /^([EAea]\s*)?\d+$/.test(q) ? refNumber(q) : null;
    var words = q && numQ === null ? q.split(' ') : [];
    var out = [];
    base.forEach(function (raw) {
      var h = merge(raw);
      if (filters.book && h.book !== filters.book) return;
      if (filters.ability && h.ability !== filters.ability) return;
      if (filters.slot && !h.slots[filters.slot]) return;
      if (filters.season && h.seasons.indexOf(filters.season) < 0) return;
      if (filters.organ && h.organ !== filters.organ) return;
      var score = 0;
      if (numQ !== null) {
        var sameBook = /^[EAea]/.test(q) ? h.book === q.charAt(0).toUpperCase() : true;
        if (h.ref === refQ) score = 1000;
        else if (sameBook && h.num === numQ) score = 900;
        else if (sameBook && String(h.num).indexOf(String(numQ)) === 0) score = 500 - String(h.num).length;
        else if (h.title.toLowerCase().indexOf(q) >= 0) score = 100;
        else return;
      } else if (words.length) {
        var hay = (h.title + ' ' + h.comment).toLowerCase();
        for (var i = 0; i < words.length; i++) {
          if (hay.indexOf(words[i]) < 0) return;
        }
        score = h.title.toLowerCase().indexOf(q) === 0 ? 300 : (h.title.toLowerCase().indexOf(q) >= 0 ? 200 : 100);
      } else {
        score = 1;
      }
      out.push({ h: h, score: score });
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.h.book !== b.h.book) return bookRank(a.h.book) - bookRank(b.h.book);
      return a.h.num - b.h.num;
    });
    return out.map(function (r) { return r.h; });
  }

  // How many hymns carry each rating, the conductor's own edits included.
  function abilityCounts() {
    var counts = {};
    all().forEach(function (h) {
      if (h.ability) counts[h.ability] = (counts[h.ability] || 0) + 1;
    });
    return counts;
  }

  function label(ref) {
    var r = normRef(ref);
    if (!r) return '';
    var t = title(r);
    return t ? r + ' – ' + t : r;
  }

  global.Hymns = {
    SLOTS: SLOTS, SEASONS: SEASONS, BOOKS: BOOKS,
    abilities: abilities, setAbilities: setAbilities, defaultAbilities: defaultAbilities,
    ability: ability, abilityColor: abilityColor, freeAbilityCode: freeAbilityCode,
    abilityCounts: abilityCounts,
    all: all, get: get, title: title, search: search, label: label,
    normRef: normRef, bookOf: bookOf, refNumber: refNumber,
    abilityName: abilityName, abilityMinutes: abilityMinutes,
    slotName: slotName, slotShort: slotShort, bookName: bookName,
    setEdits: setEdits,
    count: base.length
  };
})(window);

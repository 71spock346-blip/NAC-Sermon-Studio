/*
 * The slides of a reflection evening: the congregation comes together on a
 * weekday evening, looks back on a divine service that was held, and talks
 * about it, one question at a time (reflect.js is the screen for it).
 *
 * deck(input) turns what the evening needs into a list of slides, in the look
 * the minister chose as the standard (November 2026): a blue opening slide
 * with the emblem in white, white slides with the Church's blue, cards in a
 * pale blue, numbers in blue circles, Cambria for headings and Calibri for
 * the rest. The slides are
 *
 *   1  the opening      the congregation, "Divine Service Reflections" and
 *                       which service the evening looks back on
 *   2  the text word    the title of the sermon and its Bible text
 *   3  what we heard    the message and the main points of the sermon, as
 *                       the Divine Service Guide gives them (left out when
 *                       there are none)
 *   4… one per question
 *   last  the closing   a word of thanks, and the text word to take home
 *
 * Each slide is a list of boxes placed on PowerPoint's widescreen page
 * (13.33 × 7.5 inches): text, a rounded card, a circle with a number, the
 * emblem. The same boxes are drawn on the screen (reflect.js: the show and
 * the small pictures) and written into a PowerPoint file (pptx() below), so
 * the file looks like what was shown. Text is fitted to its box here, with
 * the letter widths of Calibri and Cambria, so nothing runs off a slide in
 * PowerPoint either.
 *
 * Each slide also carries notes for the facilitator, the one who leads the
 * evening: what to say and do at that slide (notesFor below). They are made
 * from the sermon and the Guide, the minister can change them, and they go
 * into the PowerPoint file as its notes, which only the presenter sees.
 *
 * Nothing here touches the page or the app's data: the same file builds a
 * deck in Node, for a test.
 */

export const PAGE = { w: 13.333, h: 7.5 };
const M = 0.75;                                   // the left and right margin

export const COLOURS = {
  blue: '0168B5',       // the Church's blue: the opening and closing slides, headings, numbers
  pale: 'EDF4FB',       // the cards on the white slides
  ink: '3A4B5C',        // running text on white
  muted: '6B7A89',      // the line at the foot of a white slide
  onBlue: 'DCEBF8',     // running text on blue
  labelOnBlue: 'A8D0EE',
  white: 'FFFFFF',
};
export const FONTS = { head: 'Cambria', body: 'Calibri' };
/** The height of a line, in ems, at single spacing: Calibri's is 1.22, Cambria's a little less. */
const LINE = 1.22;

/* ---------------------------------------------------------------- words */

const WORDS = {
  en: {
    heading: 'Divine Service Reflections',
    congregation: n => `${n} congregation`,
    lookBack: (service, date) => `We look back on ${service}, held on ${date}.`,
    evening: 'Reflection evening',
    textWord: 'The text word',
    sermon: 'The sermon',
    inShort: 'The sermon in short',
    heard: 'What we heard',
    message: 'The message',
    question: (n, m) => `Question ${n} of ${m}`,
    takeWith: 'Take with you',
    thanks: 'Thank you for sharing',
    notes: 'Notes for the facilitator',
    opening: 'Opening',
    closing: 'Closing',
    slide: n => `Slide ${n}`,
    questionN: n => `Question ${n}`,
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    date: (d, day, month, y) => `${d}, ${day} ${month} ${y}`,
  },
  af: {
    heading: 'Besinning oor die godsdiens',
    congregation: n => `Gemeente ${n}`,
    lookBack: (service, date) => `Ons kyk terug na ${service}, gehou op ${date}.`,
    evening: 'Besinningsaand',
    textWord: 'Die tekswoord',
    sermon: 'Die preek',
    inShort: 'Die preek kortliks',
    heard: 'Wat ons gehoor het',
    message: 'Die boodskap',
    question: (n, m) => `Vraag ${n} van ${m}`,
    takeWith: 'Neem saam',
    thanks: 'Dankie dat julle gedeel het',
    notes: 'Notas vir die fasiliteerder',
    opening: 'Opening',
    closing: 'Afsluiting',
    slide: n => `Skyfie ${n}`,
    questionN: n => `Vraag ${n}`,
    days: ['Sondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrydag', 'Saterdag'],
    months: ['Januarie', 'Februarie', 'Maart', 'April', 'Mei', 'Junie', 'Julie', 'Augustus', 'September', 'Oktober', 'November', 'Desember'],
    date: (d, day, month, y) => `${d} ${day} ${month} ${y}`,
  },
};

/** The words of the slides in a language: 'af' or else English. */
export function words(lang) { return WORDS[lang === 'af' ? 'af' : 'en']; }

/**
 * The four questions of the Church's discussion guide ("Divine Service
 * Reflections", November 2026), asked after every service. The Afrikaans is
 * ours until the Afrikaans guide is loaded: its own words then come in.
 */
export const QUESTIONS = {
  en: [
    'What touched your heart or stayed with you from the sermon?',
    'Was there a particular message or moment that spoke to you personally?',
    'Is there anything else you would like to share?',
    'What is one small way you could live out this message during the coming week?',
  ],
  af: [
    'Wat het jou hart geraak, of wat het jou bygebly uit die preek?',
    'Was daar ’n besondere boodskap of oomblik wat persoonlik met jou gepraat het?',
    'Is daar nog iets wat jy graag wil deel?',
    'Wat is een klein manier waarop jy hierdie boodskap in die komende week kan uitleef?',
  ],
};

/** "the divine service for the departed": the service as it reads in a sentence, from the occasion of a preparation. */
const SERVICE = {
  en: {
    'Sunday divine service': 'the divine service', 'Midweek divine service': 'the midweek divine service',
    'Divine service for the departed': 'the divine service for the departed', 'Youth service': 'the youth service',
    'Children\'s service': 'the children\'s service', 'Funeral service': 'the funeral service', 'Wedding': 'the wedding service', 'Other': 'the divine service',
  },
  af: {
    'Sunday divine service': 'die godsdiens', 'Midweek divine service': 'die weekdiens',
    'Divine service for the departed': 'die godsdiens vir die ontslapenes', 'Youth service': 'die diens vir jongmense',
    'Children\'s service': 'die kinderdiens', 'Funeral service': 'die begrafnisdiens', 'Wedding': 'die huweliksdiens', 'Other': 'die godsdiens',
  },
};

/**
 * The service as it reads in "We look back on …": from the occasion of the
 * preparation, or from the name a reflection guide prints ("Divine service
 * for the departed" becomes "the divine service for the departed").
 */
export function servicePhrase(occasionOrName, lang) {
  const l = lang === 'af' ? 'af' : 'en';
  const v = String(occasionOrName || '').trim();
  if (SERVICE[l][v]) return SERVICE[l][v];
  if (!v) return SERVICE[l].Other;
  if (/^(the|die)\s/i.test(v)) return v.charAt(0).toLowerCase() + v.slice(1);
  const lower = v === v.toUpperCase() ? v.toLowerCase() : v.charAt(0).toLowerCase() + v.slice(1);
  return `${l === 'af' ? 'die' : 'the'} ${lower}`;
}

/** "Sunday, 1 November 2026" (or "Sondag 1 November 2026") from yyyy-mm-dd; '' when there is no date. */
export function longDate(iso, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return '';
  const w = words(lang);
  return w.date(w.days[d.getDay()], d.getDate(), w.months[d.getMonth()], d.getFullYear());
}

/* ---------------------------------------------------------------- notes for the facilitator */

/*
 * What the one who leads the evening says and does at each slide, in the
 * language of the slides. Each slide's note is a few short paragraphs; the
 * parts that are empty for this sermon (no title, no background) fall away.
 */
const NOTES = {
  en: {
    open: ({ service, date }) => [
      'Welcome everyone warmly. Open with a prayer, and a hymn if you like.',
      `Say why we are together: tonight we look back on ${service}${date ? `, held on ${date},` : ','} and share what it gave us.`,
      'Everyone may share; nobody has to. We listen to one another, without judging or correcting.',
    ],
    text: ({ reference, title, context }) => [
      reference ? `Read the text word aloud, slowly: ${reference}. You can ask someone to read it a second time.` : 'Read the text word aloud, slowly.',
      title ? `The sermon was called “${title}”.` : '',
      context ? `Background: ${context}` : '',
    ],
    points: ({ message, list }) => [
      message ? `The message in one line: ${message}` : '',
      list ? `Go briefly through the main points, a few words each:\n${list}` : '',
      'Then ask: “Which of these do you still remember?” Keep it short: the questions are the heart of the evening.',
    ],
    ask: 'Read the question aloud, and give everyone a moment to think. Silence is fine.',
    askAgain: 'Read the question aloud, and give everyone a moment to think.',
    thank: 'Thank each person who shares. Listen; do not correct or debate.',
    // for the Church's four questions, in their order
    tips: [
      () => 'If it stays quiet, share a short answer of your own first, or ask: “Was it a word, a picture or a moment?”',
      ({ heads }) => heads ? `To help memories along, name the main points again: ${heads}.` : 'To help memories along, read the text word again.',
      () => 'Leave room for experiences and testimonies, and keep an eye on the time.',
      ({ application }) => 'Ask for one small, concrete step for this week, and give an example if it helps.' + (application ? `\n\nThe sermon's application: ${application}` : ''),
    ],
    close: ({ reference }) => [
      'Thank everyone for what they shared. Sum up in a sentence or two what you heard tonight.',
      reference ? `Read the text word once more, as the thought to take home: ${reference}.` : 'Read the text word once more, as the thought to take home.',
      'Close with a prayer.',
    ],
  },
  af: {
    open: ({ service, date }) => [
      'Verwelkom almal hartlik. Begin met ’n gebed, en ’n lied as julle wil.',
      `Sê waarom ons hier is: vanaand kyk ons terug na ${service}${date ? `, gehou op ${date},` : ','} en deel ons wat dit vir ons gegee het.`,
      'Elkeen mag deel; niemand hoef nie. Ons luister na mekaar, sonder om te oordeel of reg te stel.',
    ],
    text: ({ reference, title, context }) => [
      reference ? `Lees die tekswoord stadig hardop: ${reference}. Jy kan iemand vra om dit ’n tweede keer te lees.` : 'Lees die tekswoord stadig hardop.',
      title ? `Die preek se titel was “${title}”.` : '',
      context ? `Agtergrond: ${context}` : '',
    ],
    points: ({ message, list }) => [
      message ? `Die boodskap in een reël: ${message}` : '',
      list ? `Gaan kortliks deur die hoofpunte, ’n paar woorde elk:\n${list}` : '',
      'Vra dan: “Watter van hierdie onthou julle nog?” Hou dit kort: die vrae is die hart van die aand.',
    ],
    ask: 'Lees die vraag hardop, en gee almal ’n oomblik om te dink. Stilte is goed.',
    askAgain: 'Lees die vraag hardop, en gee almal ’n oomblik om te dink.',
    thank: 'Bedank elkeen wat deel. Luister; moenie regstel of daaroor stry nie.',
    tips: [
      () => 'As dit stil bly, deel eers self ’n kort antwoord, of vra: “Was dit ’n woord, ’n beeld of ’n oomblik?”',
      ({ heads }) => heads ? `Om die geheue te help, noem die hoofpunte weer: ${heads}.` : 'Om die geheue te help, lees die tekswoord weer.',
      () => 'Laat ruimte vir ervarings en getuienisse, en hou die tyd dop.',
      ({ application }) => 'Vra vir een klein, konkrete stap vir hierdie week, en gee ’n voorbeeld as dit help.' + (application ? `\n\nDie preek se toepassing: ${application}` : ''),
    ],
    close: ({ reference }) => [
      'Bedank almal vir wat hulle gedeel het. Som in een of twee sinne op wat jy vanaand gehoor het.',
      reference ? `Lees die tekswoord nog een keer, as die gedagte om huis toe te neem: ${reference}.` : 'Lees die tekswoord nog een keer, as die gedagte om huis toe te neem.',
      'Sluit af met ’n gebed.',
    ],
  },
};

const plain = v => String(v || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();

/** Which of the Church's four questions this is (0 to 3), in English or Afrikaans, or -1. */
export function churchQuestion(q) {
  const v = plain(q);
  if (!v) return -1;
  for (const l of ['en', 'af']) {
    const i = QUESTIONS[l].findIndex(x => plain(x) === v);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * The suggested notes for an evening: {open, text, points, q: [...], close},
 * q in the order of input.questions (an empty question has an empty note).
 * `extra` adds what the slides do not show: the Guide's background to the
 * text word (context), the main thoughts under each main point (thoughts, a
 * list per point) and the sermon's application.
 */
export function notesFor(input, extra = {}) {
  const lang = input.lang === 'af' ? 'af' : 'en';
  const N = NOTES[lang];
  const join = parts => parts.map(x => String(x || '').trim()).filter(Boolean).join('\n\n');
  const points = (input.points || []).map(p => String(p || '').trim()).filter(Boolean);
  const thoughts = extra.thoughts || [];
  const list = points.map((p, i) => [`${i + 1}. ${p}`, ...(thoughts[i] || []).filter(Boolean).map(x => `    – ${x}`)].join('\n')).join('\n');
  const heads = points.map((p, i) => `${i + 1}. ${p.replace(/[.:;]+$/, '')}`).join('; ');
  const reference = String(input.reference || '').trim();
  const date = longDate(input.serviceDate, lang);
  return {
    open: join(N.open({ service: input.service || servicePhrase('', lang), date })),
    text: join(N.text({ reference, title: String(input.title || '').trim(), context: String(extra.context || '').trim() })),
    points: join(N.points({ message: String(input.message || '').trim(), list })),
    // the first question says how to lead a question; the others only what is particular to them
    q: (input.questions || []).map((q, k, all) => {
      if (!String(q || '').trim()) return '';
      const first = !all.slice(0, k).some(x => String(x || '').trim());
      const i = churchQuestion(q);
      const tip = i >= 0 ? N.tips[i]({ heads, application: String(extra.application || '').trim() }) : '';
      return join(first ? [N.ask, tip, N.thank] : [N.askAgain, tip]);
    }),
    close: join(N.close({ reference })),
  };
}

/** The name of a slide in a list of notes: "Opening", "The sermon", "What we heard", "Question 2", "Closing". */
export function slideName(sl, lang) {
  const w = words(lang);
  if (sl.kind === 'open') return w.opening;
  if (sl.kind === 'text') return sl.titled ? w.sermon : w.textWord;
  if (sl.kind === 'points') return w.heard;
  if (sl.kind === 'question') return w.questionN(sl.q);
  return w.closing;
}

/* ---------------------------------------------------------------- measuring text */

// Advance widths in thousandths of an em, from Carlito and Caladea, which have the widths of Calibri and Cambria.
const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2022\u0149";
const WIDTHS = {
  body: [226,326,401,498,507,715,682,221,303,303,498,498,250,306,252,386,507,507,507,507,507,507,507,507,507,507,268,268,498,498,498,463,894,579,544,533,615,488,459,631,623,252,319,520,420,855,646,662,517,673,543,459,487,642,567,890,519,487,468,307,386,307,498,498,291,479,525,423,525,498,305,471,525,229,239,455,229,799,525,527,525,525,349,391,335,525,452,715,433,453,395,314,460,314,498,226,326,498,507,498,507,498,498,393,834,402,512,498,500,507,394,339,498,336,334,292,550,586,252,307,246,422,512,636,671,675,463,579,579,579,579,579,579,763,533,488,488,488,488,252,252,252,252,625,646,662,662,662,662,662,498,664,642,642,642,642,487,517,527,479,479,479,479,479,479,773,423,498,498,498,498,229,229,229,229,525,525,527,527,527,527,527,498,529,525,525,525,525,453,525,453,498,905,250,250,418,418,690,498,579],
  bodyBold: [226,326,438,498,507,729,705,233,312,312,498,498,258,306,267,430,507,507,507,507,507,507,507,507,507,507,276,276,498,498,498,463,898,606,561,529,630,488,459,637,631,267,331,547,423,874,659,676,532,686,563,473,495,653,591,906,551,520,478,325,430,325,498,498,300,494,537,418,537,503,316,474,537,246,255,480,246,813,537,538,537,537,355,399,347,537,473,745,459,474,397,344,475,344,498,226,326,498,507,498,507,498,498,415,834,416,539,498,500,507,390,342,498,338,336,301,563,598,268,303,252,435,539,658,691,702,463,606,606,606,606,606,606,775,529,488,488,488,488,267,267,267,267,639,659,676,676,676,676,676,498,681,653,653,653,653,520,532,555,494,494,494,494,494,494,775,418,503,503,503,503,246,246,246,246,537,537,538,538,538,538,538,498,544,537,537,537,537,474,537,474,498,905,258,258,435,435,711,498,622],
  head: [220,286,393,619,506,890,687,237,382,382,427,554,205,329,206,490,517,362,472,461,492,475,470,470,485,478,264,264,554,554,554,422,885,599,579,519,625,540,509,539,696,343,304,630,501,888,693,599,533,599,613,453,557,687,598,889,571,557,507,350,490,350,554,371,151,470,520,421,520,441,313,459,554,277,255,525,271,813,558,480,520,501,396,392,325,546,470,720,483,482,428,387,316,387,712,220,286,441,528,544,609,316,500,261,851,417,491,554,332,851,278,375,554,407,407,151,544,588,106,285,407,428,491,829,867,866,422,599,599,599,599,599,599,866,519,540,540,540,540,343,343,343,343,662,693,599,599,599,599,599,554,653,687,687,687,687,557,574,605,470,470,470,470,470,470,708,421,441,441,441,441,277,277,277,277,530,558,480,480,480,480,480,554,490,546,546,546,546,482,547,482,500,1000,221,221,375,375,752,443,558],
  headBold: [220,335,422,618,543,976,740,251,408,408,453,592,232,311,230,505,533,458,507,508,553,520,538,494,556,534,280,280,592,592,592,452,921,653,634,551,664,559,534,586,719,358,340,680,541,845,686,647,593,647,640,473,587,695,632,959,616,587,554,368,505,368,592,371,184,525,568,450,570,513,335,508,600,308,297,589,311,891,604,530,573,559,454,444,365,609,519,779,525,521,464,393,320,393,592,220,335,469,556,587,604,320,533,294,851,420,531,592,337,851,311,378,592,437,437,183,605,588,140,285,437,436,531,897,904,970,452,653,653,653,653,653,653,880,551,559,559,559,559,358,358,358,358,709,686,647,647,647,647,647,592,695,695,695,695,695,587,617,677,525,525,525,525,525,525,794,450,513,513,513,513,308,308,308,311,572,604,530,530,530,530,530,592,569,609,609,609,609,521,591,521,500,1000,235,235,398,398,772,443,604],
};
const INDEX = new Map([...CHARS].map((c, i) => [c, i]));
const SLACK = 1.04;   // PowerPoint kerns and rounds a little differently: leave room

/** The width of a line of text in inches, in Calibri ('body') or Cambria ('head'), at a size in points. */
export function measure(text, face, bold, size, spacing = 0) {
  const table = WIDTHS[(face === 'head' ? 'head' : 'body') + (bold ? 'Bold' : '')];
  let units = 0;
  for (const c of String(text)) {
    const i = INDEX.get(c);
    units += i === undefined ? 560 : table[i];
  }
  return (units / 1000 * size + [...String(text)].length * spacing) / 72 * SLACK;
}

/** Breaks text into the lines that fit a width (inches); a line break in the text starts a new line. */
export function wrap(text, face, bold, size, width, spacing = 0) {
  const out = [];
  for (const para of String(text || '').split(/\n/)) {
    const wordsIn = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of wordsIn) {
      const tryLine = line ? line + ' ' + word : word;
      if (measure(tryLine, face, bold, size, spacing) <= width) { line = tryLine; continue; }
      if (line) out.push(line);
      // a word wider than the box is broken where it must be
      while (measure(word, face, bold, size, spacing) > width && word.length > 1) {
        let k = word.length - 1;
        while (k > 1 && measure(word.slice(0, k), face, bold, size, spacing) > width) k--;
        out.push(word.slice(0, k));
        word = word.slice(k);
      }
      line = word;
    }
    out.push(line);
  }
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out;
}

/**
 * The largest size from `max` down to `min` at which the text fits the box
 * (width and height in inches), with its lines and its height. At `min` it
 * is returned even when it does not fit (over: true): the caller then gives
 * it more room or another slide.
 */
export function fit(text, { face = 'body', bold = false, max, min, w, h = 99, line = 1, maxLines = 99, spacing = 0 }) {
  for (let size = max; size >= min; size -= 1) {
    const lines = wrap(text, face, bold, size, w, spacing);
    const height = lines.length * size * LINE * line / 72;
    if (lines.length <= maxLines && height <= h) return { size, lines, height };
  }
  const lines = wrap(text, face, bold, min, w, spacing);
  return { size: min, lines, height: lines.length * min * LINE * line / 72, over: true };
}

/* ---------------------------------------------------------------- the slides */

/** A text box; `size` is in points, the rest in inches. */
function text(name, x, y, w, h, value, o) {
  return { t: 'text', name, x, y, w, h, text: value, face: 'body', bold: false, align: 'left', valign: 'top', line: 1, spacing: 0, ...o };
}
const card = (name, x, y, w, h, fill = COLOURS.pale) => ({ t: 'card', name, x, y, w, h, fill });
const circle = (name, x, y, d, value, size) => ({ t: 'circle', name, x, y, w: d, h: d, text: String(value), size, fill: COLOURS.blue, color: COLOURS.white, face: 'head' });
const caps = (v, lang) => String(v || '').toLocaleUpperCase(lang === 'af' ? 'af-ZA' : 'en-ZA');

/** The emblem's place on the two kinds of slide: large on blue, small at the foot of a white slide. */
export const EMBLEM = {
  blue: { key: 'white', x: 9.55, y: 1.75, w: 3.0, h: 3.0 * 948 / 762 },
  white: { key: 'blue', x: PAGE.w - M - 0.5, y: PAGE.h - 0.42 - 0.5 * 373 / 300, w: 0.5, h: 0.5 * 373 / 300 },
};

/** The label above a heading: small capitals, spaced out. */
function label(name, value, x, y, w, color, lang) {
  return text(name, x, y, w, 0.3, caps(value, lang), { bold: true, size: 12, spacing: 3, color, valign: 'bottom' });
}

/**
 * A blue slide: an optional label, a large heading, then the lines under it,
 * placed as one group beside the emblem; the footer at the bottom.
 * `under` is a list of [text, options] drawn one below the other.
 */
function blueSlide(kind, { lang, labelText, heading, under = [], foot }) {
  const w = 8.3, x = M;
  const els = [];
  const head = fit(heading, { face: 'head', bold: true, max: 54, min: 34, w, h: 3.0, line: 0.95, maxLines: 3 });
  const parts = under.filter(([v]) => v && String(v).trim()).map(([v, o]) => {
    const f = fit(v, { face: o.face || 'body', bold: !!o.bold, max: o.max, min: o.min, w, h: o.h || 2.2, line: o.line || 1.15, spacing: o.spacing || 0 });
    return { v, o, f };
  });
  const labelH = labelText ? 0.3 + 0.18 : 0;
  const total = labelH + head.height + parts.reduce((sum, p) => sum + (p.o.gap ?? 0.3) + p.f.height, 0);
  let y = Math.max(0.8, 3.45 - total / 2);
  if (labelText) { els.push(label('Label', labelText, x, y, w, COLOURS.labelOnBlue, lang)); y += labelH; }
  els.push(text('Heading', x, y, w, head.height, heading, { face: 'head', bold: true, size: head.size, color: COLOURS.white, line: 0.95 }));
  y += head.height;
  for (const p of parts) {
    y += p.o.gap ?? 0.3;
    els.push(text(p.o.name, x, y, w, p.f.height, p.o.caps ? caps(p.v, lang) : p.v, { face: p.o.face || 'body', bold: !!p.o.bold, size: p.f.size, color: p.o.color || COLOURS.onBlue, line: p.o.line || 1.15, spacing: p.o.spacing || 0 }));
    y += p.f.height;
  }
  if (foot) els.push(text('Footer', x, 6.55, w, 0.3, foot, { size: 12, color: COLOURS.labelOnBlue }));
  return { kind, bg: 'blue', els };
}

/** A white slide's label and heading at the top; returns the elements and where the content may start. */
function whiteTop({ lang, labelText, heading }) {
  const w = PAGE.w - 2 * M;
  const els = [label('Label', labelText, M, 0.42, w, COLOURS.blue, lang)];
  const head = fit(heading, { face: 'head', bold: true, max: 40, min: 28, w, h: 1.25, line: 0.95, maxLines: 2 });
  els.push(text('Heading', M, 0.82, w, head.height, heading, { face: 'head', bold: true, size: head.size, color: COLOURS.blue, line: 0.95 }));
  return { els, top: 0.82 + head.height + 0.35 };
}

/** The small line at the foot of a white slide: the title of the sermon and its text. */
function footLine(input) {
  const v = [input.title, input.reference].filter(Boolean).join('  ·  ');
  return v ? text('Footer', M, 6.78, PAGE.w - 2 * M - 0.8, 0.3, v, { size: 12, color: COLOURS.muted, valign: 'bottom' }) : null;
}

function textWordSlide(input, w) {
  const { els, top } = whiteTop({ lang: input.lang, labelText: input.title ? w.sermon : w.textWord, heading: input.title || input.reference || w.textWord });
  const width = PAGE.w - 2 * M, pad = 0.55, inner = width - 2 * pad;
  const bottom = 6.25;   // clear of the emblem at the foot
  const ref = input.reference ? 0.3 + 0.25 : 0;
  const room = bottom - top - 2 * pad - ref;
  const verse = fit(input.text, { face: 'head', max: 44, min: 20, w: inner, h: room, line: 1.1 });
  const h = Math.max(2.2, 2 * pad + ref + verse.height);
  const y = top + Math.max(0, (bottom - top - h) / 2);   // the card in the middle of the room under the heading
  els.push(card('Card', M, y, width, h));
  let cy = y + pad;
  if (input.reference) { els.push(label('Reference', input.reference, M + pad, cy, inner, COLOURS.blue, input.lang)); cy += ref; }
  els.push(text('Bible text', M + pad, cy, inner, verse.height, input.text, { face: 'head', size: verse.size, color: COLOURS.ink, line: 1.1 }));
  return { kind: 'text', bg: 'white', els: [...els, footLine({ ...input, reference: '' })].filter(Boolean), over: !!verse.over };
}

function pointsSlide(input, w) {
  const { els, top } = whiteTop({ lang: input.lang, labelText: w.inShort, heading: w.heard });
  const points = input.points;
  const bottom = 6.25, gap = 0.22;
  const width = PAGE.w - 2 * M;
  // the message on the left, like "Pause and consider"; the points as numbered cards on the right
  const left = input.message ? 5.0 : 0;
  if (input.message) {
    const pad = 0.4, inner = left - 2 * pad;
    const f = fit(input.message, { face: 'head', bold: true, max: 26, min: 16, w: inner, h: bottom - top - 2 * pad - 0.5, line: 1.1 });
    const h = 2 * pad + 0.45 + f.height;
    els.push(card('Message card', M, top, left, h));
    els.push(label('Message label', w.message, M + pad, top + pad, inner, COLOURS.blue, input.lang));
    els.push(text('Message', M + pad, top + pad + 0.45, inner, f.height, input.message, { face: 'head', bold: true, size: f.size, color: COLOURS.blue, line: 1.1 }));
  }
  const x0 = M + (left ? left + 0.4 : 0);
  const colW = width - (left ? left + 0.4 : 0);
  const cols = !left && points.length > 4 ? 2 : 1;
  const perCol = Math.ceil(points.length / cols);
  const cw = (colW - (cols - 1) * 0.4) / cols;
  const ch = Math.min(1.2, (bottom - top - (perCol - 1) * gap) / perCol);
  const d = Math.min(0.62, ch - 0.3);
  // one size for every heading, so the cards read as a set
  const tw = cw - 0.3 - d - 0.35 - 0.3;
  let size = 24;
  for (const p of points) size = Math.min(size, fit(p, { face: 'head', bold: true, max: 24, min: 13, w: tw, h: ch - 0.2, line: 1.0 }).size);
  points.forEach((p, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = x0 + col * (cw + 0.4), y = top + row * (ch + gap);
    els.push(card(`Point ${i + 1}`, x, y, cw, ch));
    els.push(circle(`Number ${i + 1}`, x + 0.3, y + (ch - d) / 2, d, i + 1, Math.round(d * 30)));
    els.push(text(`Point ${i + 1} heading`, x + 0.3 + d + 0.35, y + 0.1, tw, ch - 0.2, p, { face: 'head', bold: true, size, color: COLOURS.blue, valign: 'middle', line: 1.0 }));
  });
  return { kind: 'points', bg: 'white', els: [...els, footLine(input)].filter(Boolean) };
}

function questionSlide(input, w, q, n, m) {
  const els = [label('Label', w.question(n, m), M, 0.42, PAGE.w - 2 * M, COLOURS.blue, input.lang)];
  const x = M, y = 1.05, cw = PAGE.w - 2 * M, ch = 5.25;
  const d = 1.25, pad = 0.6;
  const tx = x + pad + d + 0.55, tw = cw - (tx - x) - pad;
  const f = fit(q, { face: 'head', bold: true, max: 44, min: 24, w: tw, h: ch - 2 * pad, line: 1.08 });
  els.push(card('Card', x, y, cw, ch));
  els.push(circle('Number', x + pad, y + (ch - d) / 2, d, n, 44));
  els.push(text('Question', tx, y + pad, tw, ch - 2 * pad, q, { face: 'head', bold: true, size: f.size, color: COLOURS.blue, valign: 'middle', line: 1.08 }));
  return { kind: 'question', bg: 'white', els: [...els, footLine(input)].filter(Boolean), over: !!f.over };
}

/**
 * The slides for an evening, in order. `input`:
 *   lang         'en' or 'af': the language of the slides
 *   congregation the congregation's name, for the label on the blue slides
 *   heading      the heading of the opening slide ("Divine Service Reflections")
 *   service      how the service reads in a sentence ("the divine service for the departed")
 *   serviceDate  yyyy-mm-dd of the service looked back on
 *   evening      yyyy-mm-dd of the evening itself
 *   title        the title of the sermon
 *   text, reference  its Bible text
 *   message      the message of the sermon, as the Guide gives it
 *   points       the headings of the main points, from the Guide
 *   questions    the questions, one slide each
 *   closing      the words of the last slide ("Thank you for sharing")
 *   notes        the facilitator's notes {open, text, points, q: [...], close},
 *                q in the order of `questions` (see notesFor)
 *
 * Each slide has a `key` ('open', 'text', 'points', 'q:<i>' with i the
 * question's place in input.questions, 'close') and its `notes`.
 */
export function deck(input) {
  const lang = input.lang === 'af' ? 'af' : 'en';
  const w = words(lang);
  // an empty question (one just added) makes no slide; the others keep their place, for their notes
  const asked = (input.questions || []).map((q, i) => ({ q: String(q || '').trim(), i })).filter(x => x.q);
  const inp = {
    ...input, lang,
    title: (input.title || '').trim(), text: (input.text || '').trim(), reference: (input.reference || '').trim(),
    message: (input.message || '').trim(),
    points: (input.points || []).map(p => String(p || '').trim()).filter(Boolean),
    questions: asked.map(x => x.q),
  };
  const notes = input.notes || {};
  const congregation = (inp.congregation || '').trim();
  const foot = [w.evening, longDate(inp.evening, lang)].filter(Boolean).join('  ·  ');
  const when = longDate(inp.serviceDate, lang);
  const slides = [];
  const add = (sl, key, note, more) => slides.push(Object.assign(sl, { key, notes: String(note || '').trim() }, more));
  add(blueSlide('open', {
    lang, labelText: congregation ? w.congregation(congregation) : '', heading: (inp.heading || '').trim() || w.heading,
    under: [[when ? w.lookBack(inp.service || servicePhrase('', lang), when) : '', { name: 'Subtitle', max: 24, min: 16, gap: 0.35 }]],
    foot,
  }), 'open', notes.open);
  if (inp.text || inp.title) add(textWordSlide(inp, w), 'text', notes.text, { titled: !!inp.title });
  if (inp.points.length) add(pointsSlide(inp, w), 'points', notes.points);
  asked.forEach((x, k) => add(questionSlide(inp, w, x.q, k + 1, asked.length), 'q:' + x.i, (notes.q || [])[x.i], { q: k + 1, question: x.q }));
  add(blueSlide('close', {
    lang, labelText: congregation ? w.congregation(congregation) : '', heading: (inp.closing || '').trim() || w.thanks,
    under: [
      [inp.text ? w.takeWith : '', { name: 'Take with you', bold: true, max: 12, min: 12, spacing: 3, caps: true, color: COLOURS.labelOnBlue, gap: 0.5, line: 1 }],
      [inp.text, { name: 'Bible text', face: 'head', max: 26, min: 16, gap: 0.12, h: 2.6 }],
      [inp.text ? inp.reference : '', { name: 'Reference', bold: true, max: 16, min: 14, gap: 0.15, color: COLOURS.labelOnBlue }],
    ],
    foot,
  }), 'close', notes.close);
  slides.forEach((s, i) => { s.n = i + 1; for (const e of s.els) if (e.t === 'text' && e.size == null) e.size = 12; });
  return slides;
}

/* ---------------------------------------------------------------- PowerPoint */

const SLOTS = { dk1: COLOURS.ink, lt1: COLOURS.white, dk2: '1F4E8C', lt2: COLOURS.pale, accent1: COLOURS.blue, accent2: COLOURS.labelOnBlue, accent3: COLOURS.onBlue, accent4: COLOURS.ink, accent5: COLOURS.muted, accent6: '1F4E8C', hlink: COLOURS.blue, folHlink: '1F4E8C' };

/** The deck's theme takes the Church's colours, so PowerPoint offers them when something is added by hand. */
export function themeXml(xml, name) {
  const scheme = `<a:clrScheme name="${name}">` + Object.entries(SLOTS).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('') + '</a:clrScheme>';
  return xml.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${name}"`);
}

/**
 * A slide's notes as PowerPoint wants them. PptxGenJS writes a note as one
 * run with its line breaks inside it; here every line becomes a paragraph of
 * its own, an empty line an empty paragraph, and a line that starts with
 * spaces (a thought under a main point) an indented one. The notes are
 * marked as the language of the slides, so PowerPoint checks their spelling
 * in it.
 */
export function notesXml(xml, lang = 'en-ZA') {
  return xml.replace(/<a:p><a:r>(<a:rPr[^>]*\/>)<a:t>([^<]*)<\/a:t><\/a:r>(<a:endParaRPr[^>]*\/>)?<\/a:p>/, (all, rPr0, text, end0) => {
    const rPr = rPr0.replace(/\blang="[^"]*"/, `lang="${lang}"`);
    const end = (end0 || '<a:endParaRPr lang="en-US" dirty="0"/>').replace(/\blang="[^"]*"/, `lang="${lang}"`);
    if (!/[\r\n]/.test(text)) return `<a:p><a:r>${rPr}<a:t>${text}</a:t></a:r>${end}</a:p>`;
    const empty = `<a:p>${end}</a:p>`;
    return text.split(/\r?\n/).map(line => {
      if (!line.trim()) return empty;
      const sub = /^\s+\S/.test(line);
      return `<a:p>${sub ? '<a:pPr marL="342900"/>' : ''}<a:r>${rPr}<a:t>${line.trim()}</a:t></a:r></a:p>`;
    }).join('');
  });
}

/**
 * The slides as a PowerPoint file. PptxGenJS and JSZip are passed in (the
 * browser loads them from vendor/, a test from node_modules); `emblems` holds
 * the two pictures of the emblem as "image/png;base64,…". Resolves to what
 * JSZip makes of `type` ('blob' in the browser, 'nodebuffer' in Node).
 */
export async function pptx(PptxGenJS, JSZip, slides, { emblems, title = '', author = '', lang = 'en', type = 'blob' }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.theme = { headFontFace: FONTS.head, bodyFontFace: FONTS.body };
  pres.title = title;
  pres.author = author;
  pres.company = 'New Apostolic Church';
  pres.lang = lang === 'af' ? 'af-ZA' : 'en-ZA';
  const alt = 'Emblem of the New Apostolic Church';
  pres.defineSlideMaster({ title: 'NAC blue', background: { color: COLOURS.blue }, objects: [{ image: { ...EMBLEM.blue, data: emblems.white, altText: alt } }] });
  pres.defineSlideMaster({ title: 'NAC white', background: { color: COLOURS.white }, objects: [{ image: { ...EMBLEM.white, data: emblems.blue, altText: alt } }] });
  const sections = { open: 'Opening', text: 'The sermon', points: 'The sermon', question: 'Questions', close: 'Closing' };
  let section = '';
  for (const sl of slides) {
    if (sections[sl.kind] !== section) { section = sections[sl.kind]; pres.addSection({ title: section }); }
    const slide = pres.addSlide({ masterName: sl.bg === 'blue' ? 'NAC blue' : 'NAC white', sectionTitle: section });
    for (const e of sl.els) {
      const at = { x: e.x, y: e.y, w: e.w, h: e.h, objectName: e.name };
      if (e.t === 'card') {
        slide.addShape(pres.ShapeType.roundRect, { ...at, fill: { color: e.fill }, line: { type: 'none' }, rectRadius: 0.08 });
      } else if (e.t === 'circle') {
        slide.addText(e.text, { ...at, shape: pres.ShapeType.ellipse, fill: { color: e.fill }, line: { type: 'none' }, color: e.color, fontFace: FONTS.head, bold: true, fontSize: e.size, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
      } else if (e.t === 'text') {
        // a slide's own line breaks stay; the rest wraps in PowerPoint as it did here
        slide.addText(e.text, {
          ...at, margin: 0, isTextBox: true, fit: 'none', wrap: true,
          fontFace: e.face === 'head' ? FONTS.head : FONTS.body, fontSize: e.size, bold: !!e.bold, color: e.color,
          align: e.align, valign: e.valign, charSpacing: e.spacing || undefined, lineSpacingMultiple: e.line,
        });
      }
    }
    if (sl.notes) slide.addNotes(sl.notes);
  }
  const zip = await JSZip.loadAsync(await pres.write({ outputType: 'arraybuffer' }));
  const part = 'ppt/theme/theme1.xml';
  if (zip.file(part)) zip.file(part, themeXml(await zip.file(part).async('string'), 'New Apostolic Church'));
  for (const name of Object.keys(zip.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))) {
    zip.file(name, notesXml(await zip.file(name).async('string'), pres.lang));
  }
  return zip.generateAsync({ type, compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

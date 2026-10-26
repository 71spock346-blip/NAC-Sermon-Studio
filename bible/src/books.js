/*
 * The books of the Bible: ids, names and the spellings people type.
 *
 * The id is the USFM code (GEN, PSA, 1CO ...), which is also what API.Bible
 * and YouVersion use, so one reference addresses every text source. The
 * Apocrypha sit between the testaments in the King James order.
 */
export const BOOKS = [
  // id, English, Afrikaans, group, abbreviations (lower case, no spaces or dots)
  ['GEN', 'Genesis', 'Genesis', 'ot', ['gen', 'ge', 'gn']],
  ['EXO', 'Exodus', 'Eksodus', 'ot', ['exo', 'ex', 'eks']],
  ['LEV', 'Leviticus', 'Levitikus', 'ot', ['lev', 'le', 'lv']],
  ['NUM', 'Numbers', 'Numeri', 'ot', ['num', 'nu', 'nm']],
  ['DEU', 'Deuteronomy', 'Deuteronomium', 'ot', ['deu', 'deut', 'dt', 'de']],
  ['JOS', 'Joshua', 'Josua', 'ot', ['jos', 'josh', 'jsh']],
  ['JDG', 'Judges', 'Rigters', 'ot', ['jdg', 'judg', 'jg', 'rig', 'rigt']],
  ['RUT', 'Ruth', 'Rut', 'ot', ['rut', 'ru', 'rth']],
  ['1SA', '1 Samuel', '1 Samuel', 'ot', ['1sa', '1sam', '1sm', 'isam', 'isamuel']],
  ['2SA', '2 Samuel', '2 Samuel', 'ot', ['2sa', '2sam', '2sm', 'iisam', 'iisamuel']],
  ['1KI', '1 Kings', '1 Konings', 'ot', ['1ki', '1kin', '1kgs', '1kon', 'ikings', '1kings']],
  ['2KI', '2 Kings', '2 Konings', 'ot', ['2ki', '2kin', '2kgs', '2kon', 'iikings', '2kings']],
  ['1CH', '1 Chronicles', '1 Kronieke', 'ot', ['1ch', '1chr', '1chron', '1kron', '1kr']],
  ['2CH', '2 Chronicles', '2 Kronieke', 'ot', ['2ch', '2chr', '2chron', '2kron', '2kr']],
  ['EZR', 'Ezra', 'Esra', 'ot', ['ezr', 'esr']],
  ['NEH', 'Nehemiah', 'Nehemia', 'ot', ['neh', 'ne']],
  ['EST', 'Esther', 'Ester', 'ot', ['est', 'esth', 'es']],
  ['JOB', 'Job', 'Job', 'ot', ['job', 'jb']],
  ['PSA', 'Psalms', 'Psalms', 'ot', ['psa', 'ps', 'psalm', 'pss', 'psm']],
  ['PRO', 'Proverbs', 'Spreuke', 'ot', ['pro', 'prov', 'pr', 'spr', 'spreuk']],
  ['ECC', 'Ecclesiastes', 'Prediker', 'ot', ['ecc', 'eccl', 'ec', 'pred', 'prd']],
  ['SNG', 'Song of Solomon', 'Hooglied', 'ot', ['sng', 'song', 'songofsongs', 'sos', 'ss', 'hoogl', 'hgl', 'canticles']],
  ['ISA', 'Isaiah', 'Jesaja', 'ot', ['isa', 'is', 'jes']],
  ['JER', 'Jeremiah', 'Jeremia', 'ot', ['jer', 'je', 'jr']],
  ['LAM', 'Lamentations', 'Klaagliedere', 'ot', ['lam', 'la', 'klaagl', 'klaag', 'kl']],
  ['EZK', 'Ezekiel', 'Esegiël', 'ot', ['ezk', 'eze', 'ezek', 'eseg', 'esegiel']],
  ['DAN', 'Daniel', 'Daniël', 'ot', ['dan', 'da', 'dn', 'daniel']],
  ['HOS', 'Hosea', 'Hosea', 'ot', ['hos', 'ho']],
  ['JOL', 'Joel', 'Joël', 'ot', ['jol', 'joe', 'jl', 'joel']],
  ['AMO', 'Amos', 'Amos', 'ot', ['amo', 'am']],
  ['OBA', 'Obadiah', 'Obadja', 'ot', ['oba', 'obad', 'ob', 'obadj']],
  ['JON', 'Jonah', 'Jona', 'ot', ['jon', 'jnh', 'jona']],
  ['MIC', 'Micah', 'Miga', 'ot', ['mic', 'mi', 'mig']],
  ['NAM', 'Nahum', 'Nahum', 'ot', ['nam', 'nah', 'na']],
  ['HAB', 'Habakkuk', 'Habakuk', 'ot', ['hab', 'hb']],
  ['ZEP', 'Zephaniah', 'Sefanja', 'ot', ['zep', 'zeph', 'sef', 'sefanja']],
  ['HAG', 'Haggai', 'Haggai', 'ot', ['hag', 'hg']],
  ['ZEC', 'Zechariah', 'Sagaria', 'ot', ['zec', 'zech', 'sag', 'sagaria']],
  ['MAL', 'Malachi', 'Maleagi', 'ot', ['mal', 'ml', 'maleag']],
  ['1ES', '1 Esdras', '1 Esdras', 'ap', ['1es', '1esd', '1esdras']],
  ['2ES', '2 Esdras', '2 Esdras', 'ap', ['2es', '2esd', '2esdras']],
  ['TOB', 'Tobit', 'Tobit', 'ap', ['tob', 'tb']],
  ['JDT', 'Judith', 'Judit', 'ap', ['jdt', 'jdth', 'judit']],
  ['ESG', 'Additions to Esther', 'Toevoegings tot Ester', 'ap', ['esg', 'addesth', 'restofesther', 'greekesther']],
  ['WIS', 'Wisdom of Solomon', 'Wysheid van Salomo', 'ap', ['wis', 'wisd', 'ws', 'wysh', 'wysheid']],
  ['SIR', 'Sirach (Ecclesiasticus)', 'Sirag', 'ap', ['sir', 'sirach', 'ecclus', 'ecclesiasticus', 'sirag', 'jesussirag']],
  ['BAR', 'Baruch', 'Barug', 'ap', ['bar', 'barug']],
  ['S3Y', 'Prayer of Azariah', 'Gebed van Asarja', 'ap', ['s3y', 'prazar', 'azariah', 'songofthree', 'asarja']],
  ['SUS', 'Susanna', 'Susanna', 'ap', ['sus']],
  ['BEL', 'Bel and the Dragon', 'Bel en die Draak', 'ap', ['bel']],
  ['MAN', 'Prayer of Manasseh', 'Gebed van Manasse', 'ap', ['man', 'prman', 'manasseh', 'manasses', 'manasse']],
  ['1MA', '1 Maccabees', '1 Makkabeërs', 'ap', ['1ma', '1mac', '1macc', '1makk', '1mak']],
  ['2MA', '2 Maccabees', '2 Makkabeërs', 'ap', ['2ma', '2mac', '2macc', '2makk', '2mak']],
  ['MAT', 'Matthew', 'Matteus', 'nt', ['mat', 'matt', 'mt', 'matth', 'mattheus']],
  ['MRK', 'Mark', 'Markus', 'nt', ['mrk', 'mk', 'mr', 'mar', 'mark']],
  ['LUK', 'Luke', 'Lukas', 'nt', ['luk', 'lk', 'lu', 'luke']],
  ['JHN', 'John', 'Johannes', 'nt', ['jhn', 'jn', 'joh', 'john', 'jo']],
  ['ACT', 'Acts', 'Handelinge', 'nt', ['act', 'ac', 'acts', 'hand', 'hnd', 'handel']],
  ['ROM', 'Romans', 'Romeine', 'nt', ['rom', 'ro', 'rm', 'romeine']],
  ['1CO', '1 Corinthians', '1 Korintiërs', 'nt', ['1co', '1cor', '1kor', '1korintiers', '1korinthiers', 'icor']],
  ['2CO', '2 Corinthians', '2 Korintiërs', 'nt', ['2co', '2cor', '2kor', '2korintiers', '2korinthiers', 'iicor']],
  ['GAL', 'Galatians', 'Galasiërs', 'nt', ['gal', 'ga', 'galasiers']],
  ['EPH', 'Ephesians', 'Efesiërs', 'nt', ['eph', 'ep', 'ef', 'efes', 'efesiers']],
  ['PHP', 'Philippians', 'Filippense', 'nt', ['php', 'phil', 'php', 'fil', 'filip', 'filippense', 'philippians']],
  ['COL', 'Colossians', 'Kolossense', 'nt', ['col', 'kol', 'kolos']],
  ['1TH', '1 Thessalonians', '1 Tessalonisense', 'nt', ['1th', '1thess', '1thes', '1tess', '1tes']],
  ['2TH', '2 Thessalonians', '2 Tessalonisense', 'nt', ['2th', '2thess', '2thes', '2tess', '2tes']],
  ['1TI', '1 Timothy', '1 Timoteus', 'nt', ['1ti', '1tim', '1timoteus', '1timotheus']],
  ['2TI', '2 Timothy', '2 Timoteus', 'nt', ['2ti', '2tim', '2timoteus', '2timotheus']],
  ['TIT', 'Titus', 'Titus', 'nt', ['tit', 'ti']],
  ['PHM', 'Philemon', 'Filemon', 'nt', ['phm', 'philem', 'phlm', 'filem', 'flm']],
  ['HEB', 'Hebrews', 'Hebreërs', 'nt', ['heb', 'he', 'hebr', 'hebreers']],
  ['JAS', 'James', 'Jakobus', 'nt', ['jas', 'jm', 'jak', 'jms', 'james']],
  ['1PE', '1 Peter', '1 Petrus', 'nt', ['1pe', '1pet', '1pt', '1petr']],
  ['2PE', '2 Peter', '2 Petrus', 'nt', ['2pe', '2pet', '2pt', '2petr']],
  ['1JN', '1 John', '1 Johannes', 'nt', ['1jn', '1joh', '1john', '1jo']],
  ['2JN', '2 John', '2 Johannes', 'nt', ['2jn', '2joh', '2john', '2jo']],
  ['3JN', '3 John', '3 Johannes', 'nt', ['3jn', '3joh', '3john', '3jo']],
  ['JUD', 'Jude', 'Judas', 'nt', ['jud', 'jd', 'judas']],
  ['REV', 'Revelation', 'Openbaring', 'nt', ['rev', 're', 'rv', 'op', 'openb', 'opb', 'openbaring']],
].map(([id, en, af, group, abbr]) => ({ id, en, af, group, abbr }));

export const BY_ID = Object.fromEntries(BOOKS.map(b => [b.id, b]));
export const GROUPS = { ot: 'Old Testament', ap: 'Apocrypha', nt: 'New Testament' };
export const GROUPS_AF = { ot: 'Ou Testament', ap: 'Apokriewe', nt: 'Nuwe Testament' };

const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// every spelling -> id, longest first so "1 john" wins over "john"
const LOOKUP = new Map();
for (const b of BOOKS) {
  for (const t of [b.en, b.af, ...b.abbr]) LOOKUP.set(fold(t), b.id);
}

export function bookName(id, lang) {
  const b = BY_ID[id];
  if (!b) return id;
  return lang === 'af' ? b.af : b.en;
}

/** Find a book from what someone typed: "ps", "Psalm", "1 Kor", "Handelinge" ... */
export function findBook(text) {
  const key = fold(text);
  if (!key) return null;
  if (LOOKUP.has(key)) return BY_ID[LOOKUP.get(key)];
  // a unique prefix of a full name
  const hits = new Set();
  for (const b of BOOKS) {
    if (fold(b.en).startsWith(key) || fold(b.af).startsWith(key)) hits.add(b.id);
  }
  if (hits.size === 1) return BY_ID[[...hits][0]];
  // digit written as a Roman numeral or stuck to the name ("1Kor")
  return null;
}

/**
 * Parse a reference such as "Psalm 130:7", "Ps 130:1-2", "Lukas 8:16",
 * "1 Kor 13", "Psalm 57v10", "John 3:16-18", "Openb 21".
 * Returns {book, chapter, verse, verseEnd} or null.
 */
export function parseRef(text) {
  if (!text) return null;
  let s = text.trim().replace(/\./g, ' ').replace(/\s+/g, ' ');
  const m = s.match(/^([1-3]?\s*[a-zA-ZÀ-ɏ][a-zA-ZÀ-ɏ ]*?)\s*(\d+)?(?:\s*[:v]\s*(\d+)\s*(?:[-–—]\s*(\d+))?)?(?:[,;].*)?$/);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const chapter = m[2] ? parseInt(m[2], 10) : 1;
  const verse = m[3] ? parseInt(m[3], 10) : null;
  let verseEnd = m[4] ? parseInt(m[4], 10) : null;
  if (verseEnd !== null && verse !== null && verseEnd < verse) verseEnd = verse;
  return { book: book.id, chapter, verse, verseEnd: verse ? (verseEnd || verse) : null };
}

/** "Psalm 130:7", "Psalms 130:1–2", "Lukas 8" */
export function formatRef(ref, lang) {
  if (!ref) return '';
  let name = bookName(ref.book, lang);
  if (ref.book === 'PSA' && lang !== 'af') name = 'Psalm';
  let s = `${name} ${ref.chapter}`;
  if (ref.verse) {
    s += `:${ref.verse}`;
    if (ref.verseEnd && ref.verseEnd !== ref.verse) s += `–${ref.verseEnd}`;
  }
  return s;
}

/** Storage key of a verse or chapter: "PSA.130.7", "PSA.130". */
export function refKey(ref) {
  return ref.verse ? `${ref.book}.${ref.chapter}.${ref.verse}` : `${ref.book}.${ref.chapter}`;
}

export function keyToRef(key) {
  const [book, c, v] = key.split('.');
  if (!BY_ID[book]) return null;
  return { book, chapter: parseInt(c, 10), verse: v ? parseInt(v, 10) : null, verseEnd: v ? parseInt(v, 10) : null };
}

/** Does a stored note (first verse + last verse) touch this verse? */
export function covers(note, book, chapter, verse) {
  return note.book === book && note.chapter === chapter &&
    (!note.verse || (verse >= note.verse && verse <= (note.verseEnd || note.verse)));
}

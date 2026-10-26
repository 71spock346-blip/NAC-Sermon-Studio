#!/usr/bin/env python3
"""Build the Catechism cross-reference index for the Study Bible.

  python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt

catechism.txt is the English "Catechism of the New Apostolic Church" (2012)
as plain text from `pdftotext -layout` (one form feed between pages).
catechism-toc.txt is the online edition's table of contents, one line per
section: `number | title | id`, where id opens the section at
https://nak.org/en/abouttheNAC/catechism?id=<id>.

The index records, for every Bible passage the Catechism cites, the sections
that cite it. The sections are found twice over: precisely, from the
references inside each section's own text, and by page, from the book's own
"Index of Bible references" mapped through the page each section starts on.
No Catechism prose is copied; the output holds section numbers, titles,
links and Bible references only.

Output: ../data/catechism.json
  {"sections": [{"n": "9.6.3", "title": "...", "id": "<uuid>", "page": 355}, ...],
   "refs": {"PSA.130.7": ["9.6", ...], "GEN.18": ["3.3.1.1.1"], ...},
   "bySection": {"9.6.3": [["PSA.130.7", "Psalm 130:7"], ...], ...}}
"""
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'data', 'catechism.json'))
URL = 'https://nak.org/en/abouttheNAC/catechism?id='

BOOKS = [  # id, name used by the Catechism, other spellings
    ('GEN', 'Genesis'), ('EXO', 'Exodus'), ('LEV', 'Leviticus'), ('NUM', 'Numbers'), ('DEU', 'Deuteronomy'),
    ('JOS', 'Joshua'), ('JDG', 'Judges'), ('RUT', 'Ruth'), ('1SA', '1 Samuel'), ('2SA', '2 Samuel'),
    ('1KI', '1 Kings'), ('2KI', '2 Kings'), ('1CH', '1 Chronicles'), ('2CH', '2 Chronicles'), ('EZR', 'Ezra'),
    ('NEH', 'Nehemiah'), ('EST', 'Esther'), ('JOB', 'Job'), ('PSA', 'Psalm', 'Psalms'), ('PRO', 'Proverbs'),
    ('ECC', 'Ecclesiastes'), ('SNG', 'Song of Solomon', 'Song of Songs'), ('ISA', 'Isaiah'), ('JER', 'Jeremiah'),
    ('LAM', 'Lamentations'), ('EZK', 'Ezekiel'), ('DAN', 'Daniel'), ('HOS', 'Hosea'), ('JOL', 'Joel'),
    ('AMO', 'Amos'), ('OBA', 'Obadiah'), ('JON', 'Jonah'), ('MIC', 'Micah'), ('NAM', 'Nahum'), ('HAB', 'Habakkuk'),
    ('ZEP', 'Zephaniah'), ('HAG', 'Haggai'), ('ZEC', 'Zechariah'), ('MAL', 'Malachi'),
    ('TOB', 'Tobit'), ('JDT', 'Judith'), ('WIS', 'Wisdom of Solomon', 'Wisdom'), ('SIR', 'Sirach', 'Ecclesiasticus'),
    ('BAR', 'Baruch'), ('1MA', '1 Maccabees'), ('2MA', '2 Maccabees'), ('1ES', '1 Esdras'), ('2ES', '2 Esdras'),
    ('MAT', 'Matthew'), ('MRK', 'Mark'), ('LUK', 'Luke'), ('JHN', 'John'), ('ACT', 'Acts'), ('ROM', 'Romans'),
    ('1CO', '1 Corinthians'), ('2CO', '2 Corinthians'), ('GAL', 'Galatians'), ('EPH', 'Ephesians'),
    ('PHP', 'Philippians'), ('COL', 'Colossians'), ('1TH', '1 Thessalonians'), ('2TH', '2 Thessalonians'),
    ('1TI', '1 Timothy'), ('2TI', '2 Timothy'), ('TIT', 'Titus'), ('PHM', 'Philemon'), ('HEB', 'Hebrews'),
    ('JAS', 'James'), ('1PE', '1 Peter'), ('2PE', '2 Peter'), ('1JN', '1 John'), ('2JN', '2 John'),
    ('3JN', '3 John'), ('JUD', 'Jude'), ('REV', 'Revelation'),
]
NAME_TO_ID = {}
ID_TO_NAME = {}
for row in BOOKS:
    ID_TO_NAME[row[0]] = row[1]
    for name in row[1:]:
        NAME_TO_ID[name] = row[0]
NAMES_RE = '|'.join(re.escape(n) for n in sorted(NAME_TO_ID, key=len, reverse=True))
# "1 Corinthians 15: 3–5, 12; 16: 1" — the body puts a space after the colon.
REF_RE = re.compile(
    r'(?<![A-Za-z])(' + NAMES_RE + r')\s+(\d+)(?:\s*:\s*(\d+)[a-c]?(?:\s*[–-]\s*(\d+)[a-c]?)?)?'
    r'((?:\s*[;,]\s*\d+(?:\s*:\s*\d+[a-c]?(?:\s*[–-]\s*\d+[a-c]?)?|\s*[–-]\s*\d+)?(?:\s*et seq\.)?)*)')
DASH = re.compile(r'[–—-]')


def norm(s):
    s = s.lower().replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    s = DASH.sub(' ', s)
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def load_toc(path):
    toc = []
    intro = 0
    for line in open(path, encoding='utf-8'):
        if '|' not in line:
            continue
        num, title, uid = [p.strip() for p in line.split('|', 2)]
        if num == 'Introduction':
            if title == 'Introduction':
                key, printed = 'Intro', 'Introduction'
            else:
                intro += 1
                key, printed = f'Intro.{intro}', str(intro)
        elif num == 'Appendix':
            key, printed = 'Appendix', 'Appendix'
        else:
            key, printed = num, num
        toc.append({'n': key, 'printed': printed, 'title': title, 'id': uid})
    return toc


def page_numbers(pages):
    """Printed page number for each pdf page: pdftotext prints it as a line of its own."""
    found = {}
    for i, page in enumerate(pages):
        for line in page.split('\n'):
            m = re.fullmatch(r'\s*(\d{1,3})\s*', line)
            if m:
                found[i] = int(m.group(1))
                break
    offsets = defaultdict(int)
    for i, p in found.items():
        offsets[p - i] += 1
    offset = max(offsets, key=offsets.get)
    return [i + offset for i in range(len(pages))]


def title_matches(body, toc_title):
    a, b = norm(body), norm(toc_title)
    if not a or not b:
        return False
    return a.startswith(b) or (len(a) >= 6 and b.startswith(a))


def find_sections(pages, printed, toc):
    """Walk the pages in order; a heading counts when it is the next unseen entry of the contents."""
    pos = -1
    starts = {}
    text_lines = defaultdict(list)       # section n -> body lines
    current = None
    running = {norm(f"{e['printed']} {e['title']}") for e in toc} | {norm(e['title']) for e in toc}
    body_start = None
    for i, page in enumerate(pages):
        lines = page.split('\n')
        for j, raw in enumerate(lines):
            line = raw.rstrip()
            if not line.strip():
                continue
            if re.fullmatch(r'\s*\d{1,3}\s*', line):
                continue                                   # page number
            if ' . . ' in line or '. . .' in line:
                continue                                   # a contents or index line
            cand = None
            m = re.match(r'^(\d+(?:\.\d+)*)\s+(\S.*)$', line)
            if m:
                cand = (m.group(1), m.group(2))
            elif line.strip() in ('Introduction', 'Appendix') and not line.startswith(' '):
                cand = (line.strip(), line.strip())
            matched = False
            if cand:
                for k in range(pos + 1, min(pos + 4, len(toc))):
                    e = toc[k]
                    if e['printed'] == cand[0] and title_matches(cand[1], e['title']):
                        if k > pos + 1:
                            print(f"  note: skipped {[toc[x]['n'] for x in range(pos + 1, k)]} before {e['n']}")
                        pos, current = k, e['n']
                        starts[current] = (i, printed[i])
                        matched = True
                        if body_start is None:
                            body_start = i
                        break
            if matched:
                continue
            if current is None:
                continue
            if norm(line) in running and j < 6:
                continue                                   # running header at the top of a page
            text_lines[current].append(line.strip())
    missing = [e['n'] for e in toc if e['n'] not in starts]
    return starts, text_lines, missing


def expand(book, ch, v1, v2):
    keys = []
    if v1 is None:
        return [f'{book}.{ch}']
    if v2 is None or v2 < v1:
        v2 = v1
    for v in range(v1, min(v2, v1 + 80) + 1):
        keys.append(f'{book}.{ch}.{v}')
    return keys


def label(book, ch, v1, v2):
    name = ID_TO_NAME[book]
    if v1 is None:
        return f'{name} {ch}'
    if v2 and v2 != v1:
        return f'{name} {ch}:{v1}–{v2}'
    return f'{name} {ch}:{v1}'


def parse_refs(text):
    """Yield (book, chapter, v1, v2) for every reference in a stretch of prose."""
    out = []
    for m in REF_RE.finditer(text):
        book = NAME_TO_ID[m.group(1)]
        ch = int(m.group(2))
        v1 = int(m.group(3)) if m.group(3) else None
        v2 = int(m.group(4)) if m.group(4) else None
        out.append((book, ch, v1, v2))
        tail = m.group(5) or ''
        for part in re.finditer(r'([;,])\s*(\d+)(?:\s*:\s*(\d+)[a-c]?(?:\s*[–-]\s*(\d+)[a-c]?)?|\s*[–-]\s*(\d+))?', tail):
            sep, a, b, c, d = part.groups()
            if b is not None:                         # "; 16: 1–3" new chapter and verse
                ch, v1, v2 = int(a), int(b), int(c) if c else None
            elif sep == ',' and v1 is not None:       # ", 12" another verse of the same chapter
                v1, v2 = int(a), int(d) if d else None
            else:                                     # "; 24" another chapter
                ch, v1, v2 = int(a), None, None
                if d:
                    v1, v2 = None, None
            out.append((book, ch, v1, v2))
    return out


def dehyphenate(lines):
    text = ''
    for line in lines:
        if text.endswith('-') and line[:1].islower():
            text = text[:-1] + line
        else:
            text += ' ' + line
    return text


def parse_bible_index(pages, printed):
    """The book's own index: `Book` lines, then `c:v . . . pages`, in two columns."""
    entries = []
    in_index = False
    for i, page in enumerate(pages):
        first = page.strip().split('\n', 1)[0].strip()
        if 'Index of Bible references' in page[:400] and printed[i] >= 480:
            in_index = True
        elif in_index and re.match(r'^\s*Index\s*$', page.strip().split('\n')[0] if page.strip() else ''):
            break
        if not in_index:
            continue
        current = {0: None, 1: None}
        for line in page.split('\n'):
            if not line.strip() or 'Index of Bible references' in line or re.fullmatch(r'\s*\d{1,3}\s*', line):
                continue
            # tokens: a book name, or an entry "c:v–v, v et seq. . . . pages"
            for tok in re.finditer(r'(\d+(?::\s?\d+)?(?:[–-]\d+)?(?:, \d+(?:[–-]\d+)?)*(?: et seq\.)?)\s+\.(?: \.)*\s+([\d, ]+(?:et seq\.)?)|((?:[123] )?[A-Z][A-Za-z]+(?: of [A-Z][a-z]+)?)', line):
                col = 0 if tok.start() < 38 else 1
                if tok.group(3):
                    name = tok.group(3).strip()
                    if name in NAME_TO_ID:
                        current[col] = NAME_TO_ID[name]
                    continue
                book = current[col]
                if not book:
                    continue
                spec, pgs = tok.group(1), tok.group(2)
                pagelist = [int(p) for p in re.findall(r'\d+', pgs)]
                m = re.match(r'(\d+)(?::\s?(\d+))?(?:[–-](\d+))?', spec)
                ch, v1, v2 = int(m.group(1)), (int(m.group(2)) if m.group(2) else None), (int(m.group(3)) if m.group(3) else None)
                refs = [(book, ch, v1, v2)]
                if v1 is not None:
                    for extra in re.finditer(r', (\d+)(?:[–-](\d+))?', spec):
                        refs.append((book, ch, int(extra.group(1)), int(extra.group(2)) if extra.group(2) else None))
                for r in refs:
                    entries.append((r, pagelist))
    return entries


def load_limits():
    """Chapter and verse counts from the bundled King James data, to drop misread references."""
    limits = {}
    base = os.path.normpath(os.path.join(HERE, '..', 'data', 'kjv'))
    if not os.path.isdir(base):
        return limits
    for fn in os.listdir(base):
        if fn.endswith('.json') and fn != 'index.json':
            doc = json.load(open(os.path.join(base, fn), encoding='utf-8'))
            limits[doc['id']] = [len(ch) for ch in doc['chapters']]
    return limits


LIMITS = {}


def valid(book, ch, v1, v2):
    counts = LIMITS.get(book)
    if not counts:
        return True
    if ch < 1 or ch > len(counts):
        return False
    if v1 is not None and (v1 < 1 or v1 > counts[ch - 1]):
        return False
    return True


def main(txt_path, toc_path):
    LIMITS.update(load_limits())
    text = open(txt_path, encoding='utf-8').read()
    pages = text.split('\f')
    printed = page_numbers(pages)
    toc = load_toc(toc_path)
    starts, text_lines, missing = find_sections(pages, printed, toc)
    print(f'{len(starts)} of {len(toc)} sections found; missing: {missing}')

    # precise references from each section's text
    refs = defaultdict(OrderedDict)      # key -> {section: None} (ordered set)
    by_section = defaultdict(OrderedDict)
    body_hits = 0
    for e in toc:
        n = e['n']
        if n not in text_lines:
            continue
        prose = dehyphenate(text_lines[n])
        for book, ch, v1, v2 in parse_refs(prose):
            if not valid(book, ch, v1, v2):
                print(f'  dropped {label(book, ch, v1, v2)} in {n}')
                continue
            body_hits += 1
            for key in expand(book, ch, v1, v2):
                refs[key].setdefault(n)
            by_section[n].setdefault(f'{book}.{ch}' + (f'.{v1}' if v1 else ''), label(book, ch, v1, v2))
    print(f'{body_hits} references read from the section texts')

    # the book's own index, mapped through the pages each section covers
    order = [e['n'] for e in toc if e['n'] in starts]
    span = {}
    for k, n in enumerate(order):
        first = starts[n][1]
        last = starts[order[k + 1]][1] if k + 1 < len(order) else first
        span[n] = (first, last)
    page_sections = defaultdict(list)
    for n, (a, b) in span.items():
        for p in range(a, b + 1):
            page_sections[p].append(n)
    index_entries = parse_bible_index(pages, printed)
    added = 0
    for (book, ch, v1, v2), pagelist in index_entries:
        if not valid(book, ch, v1, v2):
            print(f'  dropped index entry {label(book, ch, v1, v2)}')
            continue
        for p in pagelist:
            cands = [s for s in page_sections.get(p, []) if s not in ('Intro', 'Appendix')]
            keys = expand(book, ch, v1, v2)
            if any(s in refs[k] for k in keys for s in cands):
                continue                                  # the precise pass already has it
            for s in cands:
                for k in keys:
                    refs[k].setdefault(s)
                by_section[s].setdefault(f'{book}.{ch}' + (f'.{v1}' if v1 else ''), label(book, ch, v1, v2))
                added += 1
    print(f'{len(index_entries)} index entries; {added} section links added from the index by page')

    def section_sort(n):
        return [int(x) if x.isdigit() else -1 for x in n.replace('Intro', '0').split('.')]

    sections = []
    for e in toc:
        row = {'n': e['n'], 'title': e['title'], 'id': e['id']}
        if e['n'] in starts:
            row['page'] = starts[e['n']][1]
        sections.append(row)
    out = {
        'source': 'Catechism of the New Apostolic Church (2012). Section numbers and titles from the online edition at nak.org; Bible references read from the English edition.',
        'url': URL,
        'sections': sections,
        'refs': {k: sorted(v, key=section_sort) for k, v in sorted(refs.items())},
        'bySection': {n: [[k, lbl] for k, lbl in by_section[n].items()] for n in order if n in by_section},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out["refs"])} verse/chapter keys, {len(out["bySection"])} sections with references -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

#!/usr/bin/env python3
"""Build the Catechism cross-reference index for the Study Bible, and
optionally the text of its sections as a file the app can load.

  python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt
  python3 build_catechism.py /path/to/catechism.txt catechism-toc.txt --text /path/to/catechism-text.json

catechism.txt is the English "Catechism of the New Apostolic Church" (2012)
as plain text from `pdftotext -layout` (one form feed between pages).
catechism-toc.txt is the online edition's table of contents, one line per
section: `number | title | id`, where id opens the section at
https://nak.org/en/abouttheNAC/catechism?id=<id>.

The index records, for every Bible passage the Catechism cites, the sections
that cite it. The sections are found twice over: precisely, from the
references inside each section's own text, and by page, from the book's own
"Index of Bible references" mapped through the page each section starts on.
The index holds section numbers, titles, links and Bible references only, and
is committed with the app.

Output: ../data/catechism.json
  {"sections": [{"n": "9.6.3", "title": "...", "id": "<uuid>", "page": 355}, ...],
   "refs": {"PSA.130.7": ["9.6", ...], "GEN.18": ["3.3.1.1.1"], ...},
   "bySection": {"9.6.3": [["PSA.130.7", "Psalm 130:7"], ...], ...}}

With --text the script also writes the sections' own text, read from the
same pages: paragraphs, lists, the summaries the book prints at the end of
each group of sections, footnotes, and the table of the Ten Commandments.
That file is the Church's copyrighted text, so it is not committed and not
published with the app: the person loads it into the app on their own
device (Settings > Catechism), where it stays.

Text file:
  {"app": "nac-study-bible-catechism", "version": 1, "edition": "...",
   "sections": [{"n": "4.4.1", "title": "...", "page": 180,
                 "blocks": ["paragraph", {"l": ["item", ...]}, {"h": "sub-heading"},
                            {"v": ["line", ...]}, {"table": {"head": [...], "rows": [[...], ...]}}],
                 "summary": ["...", ...], "notes": [{"n": 1, "t": "..."}]}, ...]}
"""
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict
from datetime import date

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
    """Walk the pages in order; a heading counts when it is the next unseen entry of the contents.

    Returns the page each section starts on, its body lines (stripped, for the
    reference index), the sections not found, and the exact (page, line) of
    each heading for the text pass."""
    pos = -1
    starts = {}
    heads = {}
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
                        heads[current] = (i, j, cand[1])
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
    return starts, text_lines, missing, heads


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


# ------------------------------------------------------------------ the text
#
# `pdftotext -layout` keeps the page's shape in spaces: a paragraph's first
# line is indented a few characters, continuation lines sit at the margin,
# list items are indented further, the "SUMMARY" box at the end of a group
# of sections is indented as a whole, footnotes sit at the foot of the page
# in a smaller type we cannot see here, and right-hand pages carry their
# running header far to the right. The text pass reads those shapes back.

SUP = {'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'}
FOOT_RE = re.compile(r'^\s{1,5}(\d{1,2}) (\S.*)$')
BIBLE_NUM_RE = re.compile(r'^\d (?:Samuel|Kings|Chronicles|Maccabees|Esdras|Corinthians|Thessalonians|Timothy|Peter|John)\b')
MARK_RE = re.compile(r'\s*\(((?:Intro(?:\.\d+)?|\d+(?:\.\d+)*)(?:;\s*(?:Intro(?:\.\d+)?|\d+(?:\.\d+)*))*)\)\s*$')
LABEL_RE = re.compile(r'^(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth) Commandment$')
TABLE_RE = re.compile(r'The Ten Commandments')
END_PUNCT = ('.', '!', '?', '”', '’', ':')


def indent_of(line):
    return len(line) - len(line.lstrip(' '))


class Vocab:
    """Words of the book, to decide whether a hyphen at the end of a line is a real one."""
    def __init__(self, pages):
        self.words = set()
        self.hyphenated = set()
        for page in pages:
            for line in page.split('\n'):
                for w in re.findall(r"[A-Za-z][A-Za-z’']*(?:-[A-Za-z’']+)*", line.rstrip()):
                    if '-' in w:
                        self.hyphenated.add(w.lower())
                    else:
                        self.words.add(w.lower())

    def join(self, text, nxt):
        """Append the next line of a paragraph to the text gathered so far."""
        nxt = nxt.strip()
        if not text:
            return nxt
        if text.endswith(('—', '–')):
            return text + nxt
        if text.endswith('-') and nxt[:1].isalpha():
            head = re.search(r"([A-Za-z’']+)-$", text)
            tail = re.match(r"[A-Za-z’']+", nxt)
            if head and tail:
                a, b = head.group(1), tail.group(0)
                if (a + b).lower() in self.words:
                    return text[:-1] + nxt
                if (a + '-' + b).lower() in self.hyphenated:
                    return text + nxt
            return text[:-1] + nxt
        return text + ' ' + nxt


class Blocks:
    """Gathers the lines of one section into paragraphs, lists and the rest."""
    def __init__(self, vocab):
        self.vocab = vocab
        self.out = []
        self.para = None          # text of the open paragraph
        self.items = None         # the open list: [text, ...]
        self.bullet_open = False  # the open list is a "•" list, whose items wrap onto indented lines
        self.last_line = ''
        self.last_indent = 0

    def close(self):
        if self.para:
            self.out.append(self.para)
        self.para = None
        if self.items:
            self.out.append({'l': self.items})
        self.items = None
        self.bullet_open = False

    def bullet(self, text):
        """A line that starts with a bullet."""
        if self.para or (self.items is not None and not self.bullet_open):
            self.close()
        if self.items is None:
            self.items = []
        self.items.append(text.strip())
        self.bullet_open = True
        self.last_line = text.strip()

    def more(self, line):
        """An indented line under a bullet: the rest of that item."""
        self.items[-1] = self.vocab.join(self.items[-1], line)
        self.last_line = line.strip()

    def paragraph(self, line, new, ind=0):
        """A line of running text; `new` when the page shape says a paragraph starts here."""
        if self.items is not None:
            self.close()
        if new or self.para is None:
            self.close()
            self.para = line.strip()
        else:
            self.para = self.vocab.join(self.para, line)
        self.last_line = line.strip()
        self.last_indent = ind

    def item(self, line, ind=0):
        """An indented line: a list item, or more of the one before it."""
        if self.para or self.bullet_open:
            self.close()
        if self.items is None:
            self.items = []
        prev = self.items[-1] if self.items else None
        line = line.strip()
        cont = prev is not None and (
            len(self.last_line) >= 55 or line[:1].islower() or self.last_line.endswith((',', '-', '—', ';'))
            or prev.count('(') > prev.count(')'))
        if cont:
            self.items[-1] = self.vocab.join(prev, line)
        else:
            self.items.append(line)
        self.last_line = line
        self.last_indent = ind

    def heading(self, text):
        self.close()
        self.out.append({'h': text})

    def verse(self, lines):
        self.close()
        self.out.append({'v': lines})

    def table(self, table):
        self.close()
        last = self.out[-1] if self.out else None
        if isinstance(last, dict) and 'table' in last and last['table']['head'] == table['head']:
            last['table']['rows'].extend(table['rows'])     # the same table carried on to the next page
        else:
            self.out.append({'table': table})

    def finish(self):
        self.close()
        # a short unpunctuated line before a list or an indented block is a run-in heading ("Bishop")
        for k, b in enumerate(self.out[:-1]):
            nxt = self.out[k + 1]
            if isinstance(b, str) and len(b) <= 60 and not b.endswith(('.', '!', '?', '”', ':', ',', ';', ')')) \
                    and isinstance(nxt, dict) and 'l' in nxt:
                self.out[k] = {'h': b}
        return self.out


def page_lines(page, running, keep_lines):
    """The lines of one page without its running header, page number, and the blank lines around them."""
    lines = [l.rstrip() for l in page.split('\n')]
    keep = []
    for j, line in enumerate(lines):
        if line in keep_lines:
            keep.append(line)                              # a section heading, even at the top of the page
            continue
        if re.fullmatch(r'\s*\d{1,3}\s*', line):
            continue                                       # page number
        if j < 6 and line.strip() and norm(line) in running:
            continue                                       # running header
        if j < 6 and line.strip() and indent_of(line) >= 20 and re.match(r'\s*\d+(\.\d+)*\s+\S', line):
            continue                                       # right-hand running header with a title we do not know
        keep.append(line)
    while keep and not keep[0].strip():
        keep.pop(0)
    while keep and not keep[-1].strip():
        keep.pop()
    return keep


def split_footnotes(lines):
    """Footnotes sit at the foot of a page after a blank line: `  1 The term ...`, then lines at the margin.

    Returns the lines above them and [(number, text, [more lines])] from the top down."""
    notes = []
    j = len(lines) - 1
    while j > 0:
        line = lines[j]
        m = FOOT_RE.match(line)
        ok = (m and j >= len(lines) * 0.5 and not lines[j - 1].strip() and int(m.group(1)) <= 9
              and not BIBLE_NUM_RE.match(line.strip())
              and not any(indent_of(l) >= 7 for l in lines[j + 1:] if l.strip()))
        if ok:
            rest = [l.strip() for l in lines[j + 1:] if l.strip()]
            notes.insert(0, (int(m.group(1)), m.group(2), rest))
            lines = lines[:j]
            while lines and not lines[-1].strip():
                lines.pop()
            j = len(lines) - 1
            continue
        j -= 1
    return lines, notes


def mark_footnotes(lines, numbers):
    """Turn the footnote number glued to a word (`Son1,` or `31–341`) into a superscript.

    Returns the lines and {number: index of the line that carries the mark}."""
    out = list(lines)
    where = {}
    for n in numbers:
        for j, line in enumerate(out):
            # after a letter or a closing quote
            m = re.search(r'(?:(?<=[A-Za-z”’)])|(?<=[A-Za-z]\.))' + str(n) + r'(?=[\s.,;:)—]|$)', line)
            if m:
                out[j] = line[:m.start()] + SUP[str(n)] + line[m.end():]
                where[n] = j
                break
            # after a verse number, when the number with the mark would be past the end of the chapter
            hit = None
            for ref in REF_RE.finditer(line):
                book, ch = NAME_TO_ID[ref.group(1)], int(ref.group(2))
                counts = LIMITS.get(book)
                for g in (4, 3):
                    v = ref.group(g)
                    if v and v.endswith(str(n)) and len(v) > 1 and counts and ch <= len(counts) and int(v) > counts[ch - 1]:
                        hit = ref.start(g) + len(v) - 1
                        break
                if hit is not None:
                    break
            if hit is not None:
                out[j] = line[:hit] + SUP[str(n)] + line[hit + 1:]
                where[n] = j
                break
    return out, where


def column_starts(lines, j, count):
    """Where the columns of a table begin on this page: the most common places a run of text starts."""
    seen = defaultdict(int)
    while j < len(lines) and not re.match(r'^\d+(\.\d+)*\s+\S', lines[j]) and lines[j].strip().upper() != 'SUMMARY' and len(TABLE_RE.findall(lines[j])) < 2:
        line = lines[j]
        if line.strip() and not (indent_of(line) <= 5 and LABEL_RE.match(line.strip())):
            for m in re.finditer(r'(?:^|\s{2,})(?=\S)', line):
                if m.end() > 0:
                    seen[m.end()] += 1
        j += 1
    # positions a few characters apart are one column (a squeezed line starts a little early)
    clusters = []
    for pos in sorted(seen):
        if clusters and pos - clusters[-1][-1] <= 3:
            clusters[-1].append(pos)
        else:
            clusters.append([pos])
    best = sorted(clusters, key=lambda c: -sum(seen[x] for x in c))[:count - 1]
    return [0] + sorted(max(c) for c in best)


def parse_table(lines, start, vocab):
    """The Ten Commandments in three wordings (5.3.1.4), laid out in columns over three pages.

    Reads from the header line at `start`; returns the number of lines used and
    {"head": [...], "rows": [[label, cell, cell, cell], ...]}."""
    head = None
    cols = None
    rows = []                      # [label, [(line, cols), ...]]
    cur = None
    j = start
    while j < len(lines):
        line = lines[j]
        if not line.strip():
            j += 1
            continue
        hits = [m.start() for m in TABLE_RE.finditer(line)]
        if len(hits) >= 2:
            sub = lines[j + 1] if j + 1 < len(lines) else ''
            if head is None:
                head = []
                for c, col in enumerate(hits):
                    end = hits[c + 1] if c + 1 < len(hits) else None
                    head.append((line[col:end].strip() + ' ' + sub[col:end].strip()).strip())
            cols = column_starts(lines, j + 2, len(hits))
            j += 2
            continue
        if indent_of(line) <= 5 and LABEL_RE.match(line.strip()):
            cur = [line.strip(), []]
            rows.append(cur)
            j += 1
            continue
        if line.strip().upper() == 'SUMMARY' or re.match(r'^\d+(\.\d+)*\s+\S', line) or cur is None or cols is None:
            break
        cur[1].append((line, cols))
        j += 1

    def clear_split(line, cols):
        """Cells when every column starts where the header says (a space just before each start)."""
        for b in cols[1:]:
            if len(line) > b and line[b - 1] != ' ':
                return None
        return [line[c:(cols[k + 1] if k + 1 < len(cols) else None)].strip() for k, c in enumerate(cols)]

    width = {}
    for _, body in rows:
        for line, cols in body:
            cells = clear_split(line, cols)
            if cells:
                for k, cell in enumerate(cells):
                    width[k] = max(width.get(k, 0), len(cell))

    def split(line, cols):
        cells = clear_split(line, cols)
        if cells:
            return cells
        out = []
        start = cols[0]
        for k, _ in enumerate(cols):
            if k + 1 == len(cols):
                out.append(line[start:].strip())
                break
            end = cols[k + 1] + (start - cols[k])
            if len(line) <= end or line[end - 1] == ' ':
                out.append(line[start:end].strip())
                start = end
                continue
            cut = line.rfind(' ', start, min(len(line), end))
            if cut <= start:
                cut = end
            out.append(line[start:cut].strip())
            start = cut + 1
        return out

    table_rows = []
    for label, body in rows:
        cells = [[], [], []]
        for line, cols in body:
            for k, text in enumerate(split(line, cols)[:3]):
                if text:
                    cells[k].append(text)
        row = [label]
        for k in range(3):
            text, prev = '', ''
            for ln in cells[k]:
                if text and len(prev) < 0.6 * width.get(k, 30) and (ln[:1].isupper() or ln[:1] == '“'):
                    text += '\n' + ln
                else:
                    text = vocab.join(text, ln)
                prev = ln
            row.append(text)
        table_rows.append(row)
    return j - start, {'head': head or [], 'rows': table_rows}


def appendix_blocks(blocks, body, j, line):
    """The appendix (creeds, commandments, the Lord's Prayer) uses blank lines and short headings, not indents.

    Returns how many lines were taken."""
    nxt = body[j + 1].strip() if j + 1 < len(body) else ''
    prev_blank = j == 0 or not body[j - 1].strip()
    short = len(line) <= 60 and not line.endswith(('.', ',', ';', '”', '’'))
    if prev_blank and short and (not nxt or line.endswith(':') or line.startswith('The ')):
        blocks.heading(line.rstrip(':'))
        return 1
    if prev_blank and blocks.para is None:
        run = []
        k = j
        while k < len(body) and body[k].strip() and len(body[k].strip()) <= 70 and not body[k].strip().endswith('-'):
            run.append(body[k].strip())
            k += 1
        if len(run) >= 4 and sum(len(x) for x in run) / len(run) < 45:
            blocks.verse(run)
            return len(run)
    blocks.paragraph(line, blocks.para is None)
    return 1


def extract_text(pages, printed, toc, heads):
    """Read each section's own text from the pages. Returns {n: {blocks, summary, notes}}."""
    running = {norm(f"{e['printed']} {e['title']}") for e in toc} | {'introduction', 'appendix', 'contents'}
    by_n = {e['n']: e for e in toc}
    head_lines = {(i, pages[i].split('\n')[j].rstrip()): n for n, (i, j, _) in heads.items()}
    vocab = Vocab(pages)
    sections = {}
    summaries = defaultdict(list)
    current = None
    blocks = None
    mode = 'body'                 # or 'summary'
    summary_para = []
    first_page = min(i for i, j, _ in heads.values())
    stop_page = next((i for i in range(first_page, len(pages)) if re.search(r'^Glossary\s*$', pages[i], re.M) and 'Explanation' in pages[i]), len(pages))
    odd = []

    def section(n):
        return sections.setdefault(n, {'blocks': None, 'notes': []})

    def flush_summary():
        nonlocal summary_para
        if summary_para:
            text = ''
            for ln in summary_para:
                text = vocab.join(text, ln)
            m = MARK_RE.search(text)
            targets = [t.strip() for t in m.group(1).split(';')] if m else []
            if m and all(t in by_n for t in targets):
                text = text[:m.start()].rstrip()
            else:
                targets = [current]
                odd.append(f'summary without a section mark under {current}: {text[:60]}')
            for t in targets:
                summaries[t].append(text)
        summary_para = []

    for i in range(first_page, stop_page):
        page = pages[i]
        first = next((l.strip() for l in page.split('\n') if l.strip()), '')
        if first == 'Contents' or re.fullmatch(r'Part \d+', first):
            continue                                       # the table of contents and the part title pages
        keep = {line for (pi, line) in head_lines if pi == i}
        body, notes = split_footnotes(page_lines(page, running, keep))
        marks = {}
        if notes:
            body, marks = mark_footnotes(body, [n for n, _, _ in notes])
        note_text = {}
        for n, text, rest in notes:
            t = text
            for ln in rest:
                t = vocab.join(t, ln)
            note_text[n] = t
        pending_notes = dict(note_text)
        at_top = True
        j = 0
        while j < len(body):
            raw = body[j]
            line = raw.strip()
            for n, at in marks.items():
                if at <= j and n in pending_notes and current:
                    section(current)['notes'].append({'n': n, 't': pending_notes.pop(n)})
            if not line:
                if mode == 'summary':
                    flush_summary()
                elif blocks is not None:
                    blocks.close()
                j += 1
                continue
            if ' . . ' in line or '. . .' in line:
                j += 1
                continue                                   # the appendix's own contents list
            n = head_lines.get((i, raw))
            if n is not None:
                if mode == 'summary':
                    flush_summary()
                if blocks is not None:
                    section(current)['blocks'] = blocks.finish()
                current = n
                blocks = Blocks(vocab)
                mode = 'body'
                section(current)
                title, shown = by_n[n]['title'], heads[n][2]
                if len(norm(shown)) < len(norm(title)) and j + 1 < len(body) and body[j + 1].strip():
                    rest = body[j + 1].strip()
                    if norm(title).startswith(norm(shown + ' ' + rest)):
                        j += 1
                    else:
                        odd.append(f'{n}: heading "{shown}" shorter than the title, next line "{rest[:40]}"')
                j += 1
                at_top = False
                continue
            if current is None:
                j += 1
                continue
            ind = indent_of(raw)
            if line.upper() == 'SUMMARY':
                blocks.close()
                mode = 'summary'
                j += 1
                at_top = False
                continue
            if mode == 'summary':                          # until the next heading; a page may lose the indent
                summary_para.append(line)
                if MARK_RE.search(line):
                    flush_summary()
                j += 1
                at_top = False
                continue
            if len(TABLE_RE.findall(raw)) >= 2:
                used, table = parse_table(body, j, vocab)
                blocks.table(table)
                j += used
                at_top = False
                continue
            if current == 'Appendix':
                j += appendix_blocks(blocks, body, j, line)
                at_top = False
                continue
            if line.startswith('•'):
                blocks.bullet(line[1:])
            elif blocks.bullet_open and ind >= 1:
                blocks.more(line)
            elif ind >= 6:
                blocks.item(line, ind)
            elif ind >= 1:
                # an indented line starts a paragraph, unless it wraps the indented line before it
                wraps = ind == blocks.last_indent and blocks.para is not None and (len(blocks.last_line) >= 55 or line[:1].islower())
                blocks.paragraph(line, not wraps, ind)
            else:
                # at the margin: more of the open paragraph, or a new one when the line before ended short
                # (a paragraph at the top of a page is not indented; nor is anything on a page with no text at the margin)
                new = blocks.para is None or (len(blocks.last_line) < 50 and blocks.last_line.endswith(END_PUNCT) and (line[:1].isupper() or line[:1] in '“‘'))
                blocks.paragraph(line, new, 0)
            at_top = False
            j += 1
        for n, t in pending_notes.items():
            if current:
                section(current)['notes'].append({'n': n, 't': t})
                odd.append(f'{current}: footnote {n} on page {printed[i]} has no mark in the text')
    if mode == 'summary':
        flush_summary()
    if blocks is not None and current:
        section(current)['blocks'] = blocks.finish()
    for n, paras in summaries.items():
        section(n)['summary'] = paras
    for line in odd:
        print('  note:', line)
    return sections


def main(txt_path, toc_path, text_out=None):
    LIMITS.update(load_limits())
    text = open(txt_path, encoding='utf-8').read()
    pages = text.split('\f')
    printed = page_numbers(pages)
    toc = load_toc(toc_path)
    starts, text_lines, missing, heads = find_sections(pages, printed, toc)
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

    if text_out:
        write_text(pages, printed, toc, heads, starts, text_out)


def write_text(pages, printed, toc, heads, starts, text_out):
    found = extract_text(pages, printed, toc, heads)
    rows = []
    empty = []
    for e in toc:
        n = e['n']
        got = found.get(n, {})
        row = {'n': n, 'title': e['title']}
        if n in starts:
            row['page'] = starts[n][1]
        row['blocks'] = got.get('blocks') or []
        if got.get('summary'):
            row['summary'] = got['summary']
        if got.get('notes'):
            row['notes'] = got['notes']
        if not row['blocks']:
            empty.append(n)
        rows.append(row)
    out = {
        'app': 'nac-study-bible-catechism',
        'version': 1,
        'edition': 'Catechism of the New Apostolic Church, English edition (2012)',
        'copyright': '© New Apostolic Church International, Zurich. For personal study on this device only.',
        'builtAt': date.today().isoformat(),
        'sections': rows,
    }
    with open(text_out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    words = sum(len(str(b).split()) for r in rows for b in r['blocks'])
    with_summary = sum(1 for r in rows if r.get('summary'))
    notes = sum(len(r.get('notes', [])) for r in rows)
    print(f'text: {len(rows) - len(empty)} sections with text ({words} words), {with_summary} with a summary, {notes} footnotes -> {text_out} ({os.path.getsize(text_out) // 1024} KB)')
    if empty:
        print(f'  sections without their own text (headings only): {empty}')


if __name__ == '__main__':
    args = sys.argv[1:]
    text_out = None
    if '--text' in args:
        k = args.index('--text')
        text_out = args[k + 1] if k + 1 < len(args) else None
        del args[k:k + 2]
    if len(args) != 2 or ('--text' in sys.argv and not text_out):
        sys.exit(__doc__)
    main(args[0], args[1], text_out)

#!/usr/bin/env python3
"""Build the bundled Bible texts for the Study Bible.

The app reads one small JSON file per book, so a chapter opens without the
whole Bible being downloaded. Two public-domain sources are supported:

  python3 build_bible.py kjv /path/to/KJVA.json
      the SWORD "KJVA" module as JSON from scrollmapper/bible_databases
      (King James Version, 1769 text, with the Apocrypha)
  python3 build_bible.py web /path/to/eng-web.usfx.xml
      the World English Bible with Deuterocanon in USFX, from
      seven1m/open-bibles (originally ebible.org)

Output: ../data/<translation>/<BOOK>.json, one per book, shaped as
  {"id": "PSA", "chapters": [[verse 1, verse 2, ...], ...], "titles": {"3": "A Psalm of David..."}}
and ../data/<translation>/index.json with the name, copyright line and the
number of chapters per book. Book ids are the USFM codes that API.Bible
uses as well, so one reference works for every text source.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', 'data'))

# The app's book order: Old Testament, the Apocrypha in King James order, New Testament.
ORDER = [
    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH',
    'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS',
    'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
    '1ES', '2ES', 'TOB', 'JDT', 'ESG', 'WIS', 'SIR', 'BAR', 'S3Y', 'SUS', 'BEL', 'MAN', '1MA', '2MA',
    'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH',
    '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
]

KJVA_NAMES = {
    'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM', 'Deuteronomy': 'DEU',
    'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT', 'I Samuel': '1SA', 'II Samuel': '2SA',
    'I Kings': '1KI', 'II Kings': '2KI', 'I Chronicles': '1CH', 'II Chronicles': '2CH', 'Ezra': 'EZR',
    'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalms': 'PSA', 'Proverbs': 'PRO',
    'Ecclesiastes': 'ECC', 'Song of Solomon': 'SNG', 'Isaiah': 'ISA', 'Jeremiah': 'JER',
    'Lamentations': 'LAM', 'Ezekiel': 'EZK', 'Daniel': 'DAN', 'Hosea': 'HOS', 'Joel': 'JOL',
    'Amos': 'AMO', 'Obadiah': 'OBA', 'Jonah': 'JON', 'Micah': 'MIC', 'Nahum': 'NAM', 'Habakkuk': 'HAB',
    'Zephaniah': 'ZEP', 'Haggai': 'HAG', 'Zechariah': 'ZEC', 'Malachi': 'MAL',
    'I Esdras': '1ES', 'II Esdras': '2ES', 'Tobit': 'TOB', 'Judith': 'JDT', 'Additions to Esther': 'ESG',
    'Wisdom': 'WIS', 'Sirach': 'SIR', 'Baruch': 'BAR', 'Prayer of Azariah': 'S3Y', 'Susanna': 'SUS',
    'Bel and the Dragon': 'BEL', 'Prayer of Manasses': 'MAN', 'I Maccabees': '1MA', 'II Maccabees': '2MA',
    'Matthew': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK', 'John': 'JHN', 'Acts': 'ACT', 'Romans': 'ROM',
    'I Corinthians': '1CO', 'II Corinthians': '2CO', 'Galatians': 'GAL', 'Ephesians': 'EPH',
    'Philippians': 'PHP', 'Colossians': 'COL', 'I Thessalonians': '1TH', 'II Thessalonians': '2TH',
    'I Timothy': '1TI', 'II Timothy': '2TI', 'Titus': 'TIT', 'Philemon': 'PHM', 'Hebrews': 'HEB',
    'James': 'JAS', 'I Peter': '1PE', 'II Peter': '2PE', 'I John': '1JN', 'II John': '2JN',
    'III John': '3JN', 'Jude': 'JUD', 'Revelation of John': 'REV',
}

# USFX elements whose text is not Scripture: footnotes, cross references,
# headings, titles, front matter. Their tail text still belongs to the verse.
USFX_SKIP = {
    'f', 'fe', 'x', 'ef', 'ex', 's', 's1', 's2', 's3', 's4', 'h', 'toc', 'toc1', 'toc2', 'toc3', 'mt', 'mt1',
    'mt2', 'mt3', 'mte', 'id', 'ide', 'rem', 'cl', 'cp', 'ca', 'va', 'vp', 'ms', 'ms1', 'ms2', 'mr', 'r',
    'sr', 'sp', 'periph', 'fig', 'sts', 'usfm', 'rq', 'ib', 'imt', 'imt1', 'is', 'is1', 'ip', 'iot', 'io',
    'io1', 'io2', 'ili', 'ili1', 'ili2', 'iex', 'ie', 'd',
}


def clean(text):
    text = text.replace(' ', ' ')
    text = re.sub(r'[\[\]]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def write_translation(key, meta, books):
    """books: {BOOK: {'chapters': {n: {v: text}}, 'titles': {n: text}}}"""
    out = os.path.join(DATA, key)
    os.makedirs(out, exist_ok=True)
    index = dict(meta)
    index['books'] = {}
    verses = 0
    for book in ORDER:
        if book not in books:
            continue
        chapters = books[book]['chapters']
        n_chapters = max(chapters)
        packed = []
        for c in range(1, n_chapters + 1):
            vv = chapters.get(c, {})
            n_verses = max(vv) if vv else 0
            packed.append([vv.get(v, '') for v in range(1, n_verses + 1)])
            verses += len(vv)
        doc = {'id': book, 'chapters': packed}
        titles = {str(k): v for k, v in books[book].get('titles', {}).items() if v}
        if titles:
            doc['titles'] = titles
        with open(os.path.join(out, book + '.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        index['books'][book] = n_chapters
    with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f'{key}: {len(index["books"])} books, {verses} verses -> {out}')


def build_kjv(path):
    src = json.load(open(path, encoding='utf-8'))
    books = {}
    for b in src['books']:
        book = KJVA_NAMES.get(b['name'])
        if not book:
            print('skipping unknown book', b['name'])
            continue
        chapters = {}
        for ch in b['chapters']:
            chapters[int(ch['chapter'])] = {int(v['verse']): clean(v['text']) for v in ch['verses']}
        books[book] = {'chapters': chapters}
    write_translation('kjv', {
        'id': 'kjv',
        'name': 'King James Version with Apocrypha',
        'short': 'KJV',
        'lang': 'en',
        'copyright': 'King James Version (1769 text) with the Apocrypha. Public domain. Text from the SWORD KJVA module via scrollmapper/bible_databases.',
    }, books)


def build_web(path):
    tree = ET.parse(path)
    books = {}
    for be in tree.getroot().iter('book'):
        book = be.get('id')
        if book == 'LJE':          # the Letter of Jeremiah is Baruch 6 in the King James numbering
            book = 'BAR'
        if book not in ORDER:
            continue
        entry = books.setdefault(book, {'chapters': {}, 'titles': {}})
        state = {'c': 0, 'v': None}
        parts = {}

        def add(text):
            if state['v'] is not None and text:
                parts.setdefault((state['c'], state['v']), []).append(text)

        def walk(el):
            tag = el.tag
            if tag == 'c':
                state['c'] = int(re.sub(r'\D', '', el.get('id') or '0') or 0)
                state['v'] = None
            elif tag == 'v':
                vid = el.get('id') or ''
                m = re.match(r'(\d+)', vid)
                state['v'] = int(m.group(1)) if m else None
            elif tag == 've':
                state['v'] = None
            elif tag == 'd':
                entry['titles'][state['c']] = clean(''.join(el.itertext()))
            if tag in USFX_SKIP:
                add(el.tail)
                return
            add(el.text)
            for child in el:
                walk(child)
            add(el.tail)

        for child in be:
            walk(child)
        for (c, v), texts in parts.items():
            entry['chapters'].setdefault(c, {})[v] = clean(' '.join(texts))
    write_translation('web', {
        'id': 'web',
        'name': 'World English Bible with Deuterocanon',
        'short': 'WEB',
        'lang': 'en',
        'copyright': 'World English Bible (WEB) with the Deuterocanon/Apocrypha. Public domain, ebible.org. "World English Bible" is a trademark of eBible.org.',
    }, books)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('kjv', 'web'):
        sys.exit(__doc__)
    (build_kjv if sys.argv[1] == 'kjv' else build_web)(sys.argv[2])

#!/usr/bin/env python3
"""Checks the built-in book introductions of the Theology screen.

data/theology/en.json and af.json hold one short introduction to every book of
the Bible, the later writings of the Old Testament included (theology.js shows
them). This script checks that:

  - every book of the KJV with the Apocrypha has an introduction, with all its parts filled in;
  - the parts of a book ("chapters 1-11, The beginning") lie within its chapters;
  - every key verse is a real verse (it is looked up in data/kjv);
  - the Afrikaans has the same books, parts and key verses as the English.

Run it after changing either file:

    python3 tools/check_theology.py

It exits with 1 when something is wrong.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
FIELDS = ['title', 'line', 'writer', 'when', 'to', 'why', 'summary', 'christ']
KEY = re.compile(r'^([0-9A-Z]{3})\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$')


def kjv_chapters():
    index = json.loads((DATA / 'kjv' / 'index.json').read_text(encoding='utf-8'))
    return index['books']


_books = {}


def chapter(book, n):
    """The verses of a chapter in the KJV; a verse the KJV does not have is "…" (as Esther 1-9 in the Greek additions)."""
    if book not in _books:
        _books[book] = json.loads((DATA / 'kjv' / f'{book}.json').read_text(encoding='utf-8'))['chapters']
    chapters = _books[book]
    return chapters[n - 1] if 0 < n <= len(chapters) else []


def has_text(book, n, verse=0):
    """Whether a chapter (or one verse of it) has text in the KJV."""
    ch = chapter(book, n)
    real = lambda v: bool(v) and v.strip() != '…'
    if verse:
        return verse <= len(ch) and real(ch[verse - 1])
    return any(real(v) for v in ch)


def check(lang, counts, problems):
    path = DATA / 'theology' / f'{lang}.json'
    d = json.loads(path.read_text(encoding='utf-8'))
    if d.get('lang') != lang:
        problems.append(f'{path.name}: "lang" should be {lang}')
    books = d.get('books') or {}
    for book in counts:
        if book not in books:
            problems.append(f'{path.name}: {book} has no introduction')
    for book, b in books.items():
        where = f'{path.name} {book}'
        if book not in counts:
            problems.append(f'{where}: not a book of the KJV')
            continue
        for f in FIELDS:
            if not isinstance(b.get(f), str) or not b[f].strip():
                problems.append(f'{where}: "{f}" is empty')
        if not isinstance(b.get('themes'), list) or not b['themes']:
            problems.append(f'{where}: no themes')
        for p in b.get('parts', []):
            if len(p) != 3 or not (1 <= p[0] <= p[1] <= counts[book]) or not str(p[2]).strip():
                problems.append(f'{where}: part {p} is not within chapters 1-{counts[book]}')
            elif not has_text(book, p[0]) or not has_text(book, p[1]):
                problems.append(f'{where}: part {p} starts or ends on a chapter without text')
        for k in b.get('key', []):
            m = KEY.match(k)
            if not m or m.group(1) != book:
                problems.append(f'{where}: key verse "{k}" is not written as {book}.chapter.verse')
                continue
            ch, first = int(m.group(2)), int(m.group(3) or 0)
            last = int(m.group(4) or first)
            ok = 1 <= ch <= counts[book] and last >= first and all(has_text(book, ch, v) for v in range(first, last + 1)) if first else has_text(book, ch)
            if not ok:
                problems.append(f'{where}: key verse "{k}" is not in the KJV (the chapter has {len(chapter(book, ch))} verses)')
    return books


def main():
    counts = kjv_chapters()
    problems = []
    en = check('en', counts, problems)
    af = check('af', counts, problems)
    for book in counts:
        a, b = en.get(book), af.get(book)
        if not a or not b:
            continue
        if [p[:2] for p in a.get('parts', [])] != [p[:2] for p in b.get('parts', [])]:
            problems.append(f'{book}: the Afrikaans parts differ from the English')
        if a.get('key') != b.get('key'):
            problems.append(f'{book}: the Afrikaans key verses differ from the English')
    for p in problems:
        print(p)
    print(f'{len(counts)} books; {len(problems)} problems')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()

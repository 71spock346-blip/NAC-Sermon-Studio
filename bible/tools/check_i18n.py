#!/usr/bin/env python3
"""Checks the Afrikaans table (src/af.js) against the texts the app shows.

Every text the app shows goes through t('…') or tn(n, '…', '…') in src/, or
data-t="…" in index.html, with the English as the key. This script lists the
keys that have no Afrikaans entry in src/af.js, and the entries there that no
source uses any more. Run it after adding a text to the app or a line to af.js:

    python3 tools/check_i18n.py

It exits with 1 when something is missing, so it can sit in a check.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

STR = r"'((?:[^'\\]|\\.)*)'"
PATTERNS = [
    re.compile(r"\bt\(\s*" + STR),
    re.compile(r"\btn\(\s*[^,]+,\s*" + STR + r",\s*" + STR),
]
HTML_PATTERNS = [re.compile(r'data-t(?:-aria|-title)?="([^"]*)"')]

# Labels that reach t() through a variable rather than a literal: the choices
# in ui.js (themes, sizes, letters), notes.js (kinds), prepare.js (status,
# occasions, the humour and language choices of a preparation) and ai.js (the
# note on each model, who is listening, humour). Keep this list in step with those.
INDIRECT = [
    'System', 'Paper', 'White', 'Dark', 'Small', 'Normal', 'Large', 'Pulpit', 'Book', 'Easy-read',
    'Thought', 'Experience', 'Doctrine', 'Illustration', 'Sermon idea', 'Question',
    'Draft', 'Ready', 'Held',
    'Sunday divine service', 'Midweek divine service', 'Divine service for the departed',
    'Youth service', "Children's service", 'Funeral service', 'Wedding', 'Other',
    'the most capable; the default', 'quicker and about half the price',
    'All ages together', 'Children', 'Young people (teens)', 'Young adults', 'Families with children', 'Mostly older members',
    'None', 'A little, where it fits', 'A bit more', 'None in this service',
]


def unescape(s):
    return s.replace("\\'", "'").replace('\\n', '\n').replace('\\\\', '\\')


def used_keys():
    keys = {}
    for path in sorted(SRC.glob('*.js')):
        if path.name in ('af.js', 'i18n.js'):
            continue
        text = path.read_text(encoding='utf-8')
        for rx in PATTERNS:
            for m in rx.finditer(text):
                for g in m.groups():
                    keys.setdefault(unescape(g), set()).add(path.name)
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    for rx in HTML_PATTERNS:
        for m in rx.finditer(html):
            keys.setdefault(m.group(1), set()).add('index.html')
    for k in INDIRECT:
        keys.setdefault(k, set()).add('(indirect)')
    return keys


def table():
    text = (SRC / 'af.js').read_text(encoding='utf-8')
    start = text.index('{', text.index('export const AF'))   # the header comment may mention a brace
    body = text[start:text.rindex('}') + 1]
    body = re.sub(r'^\s*//.*$', '', body, flags=re.M)     # comment lines between the entries
    body = re.sub(r',(\s*)}', r'\1}', body)                  # the trailing comma JavaScript allows
    return json.loads(body)


def main():
    used = used_keys()
    af = table()
    missing = sorted(k for k in used if k not in af)
    unused = sorted(k for k in af if k not in used)
    same = sorted(k for k, v in af.items() if k == v and k in used)
    for k in missing:
        print(f"missing: {k!r}  ({', '.join(sorted(used[k]))})")
    for k in unused:
        print(f"unused:  {k!r}")
    print(f"{len(used)} texts used, {len(af)} in af.js, {len(missing)} missing, {len(unused)} unused, {len(same)} left as in English")
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())

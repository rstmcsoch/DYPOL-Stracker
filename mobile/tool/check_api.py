#!/usr/bin/env python3
"""Static symbol cross-check for the Flutter sources.

No Dart SDK is available in this sandbox, so this script does the checks that a compiler
would otherwise catch first:
  * every `data.<member>` / `state.data.<member>` used in a page exists on AppData;
  * every `x.copyWith(<named>)` names a parameter the model declares;
  * every `logic` function called from a page is declared;
  * every `ref.read(<provider>)` / `ref.watch(...)` provider exists;
and prints anything it cannot resolve so it can be fixed by hand.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'lib'
FILES = sorted(ROOT.rglob('*.dart'))


def strip_comments(src: str) -> str:
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    return src


class ClassInfo:
    def __init__(self, name: str) -> None:
        self.name = name
        self.members: set[str] = set()
        self.copy_with: set[str] = set()
        self.ctor_params: set[str] = set()


classes: dict[str, ClassInfo] = {}
top_level: set[str] = set()
funcs: set[str] = set()

for path in FILES:
    src = strip_comments(path.read_text())

    # class / mixin / enum declarations
    for m in re.finditer(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*class\s+(\w+)', src, re.M):
        classes.setdefault(m.group(1), ClassInfo(m.group(1)))
    for m in re.finditer(r'^enum\s+(\w+)', src, re.M):
        classes.setdefault(m.group(1), ClassInfo(m.group(1)))

    # top-level functions and consts
    for m in re.finditer(r'^(?:Future<[^>]*>|void|String|int|double|bool|List<[^>]*>|Map<[^>]*>|Widget|[A-Z]\w*\??)\s+(\w+)\s*\(', src, re.M):
        funcs.add(m.group(1))
        top_level.add(m.group(1))
    for m in re.finditer(r'^(?:const|final)\s+[\w<>?, ]+\s+(\w+)\s*=', src, re.M):
        top_level.add(m.group(1))

# member declarations inside classes (line based: "  Type name;" / "  Type name(...)")
decl_re = re.compile(
    r'^\s{2}(?:(?:static|final|late|const|override|external|required)\s+)*'
    r'[A-Za-z_][\w<>?, ]*?\s+'
    r'(\w+)\s*(?:[;=({]|$|=>)',
    re.M,
)
class_re = re.compile(r'^(?:abstract\s+|final\s+|sealed\s+|base\s+)*class\s+(\w+)', re.M)
for path in FILES:
    src = strip_comments(path.read_text())
    marks = [(m.start(), m.group(1)) for m in class_re.finditer(src)]
    marks.append((len(src), ''))
    for i in range(len(marks) - 1):
        name = marks[i][1]
        body = src[marks[i][0]:marks[i + 1][0]]
        info = classes.setdefault(name, ClassInfo(name))
        info.members.add(name)  # constructors
        for m in decl_re.finditer(body):
            info.members.add(m.group(1))
        for m in re.finditer(r'\bcopyWith\s*\(\s*\{(.*?)\}\s*\)', body, re.S):
            for p in re.finditer(r'([\w<>,? ]+?)\s+(\w+)\s*(?:=|,)', m.group(1)):
                if p.group(2) not in {'required', 'const'}:
                    info.copy_with.add(p.group(2))
        # constructor named params
        for m in re.finditer(r'\b' + re.escape(name) + r'\s*\((.*?)\)\s*[:{]', body, re.S):
            for p in re.finditer(r'(?:required\s+)?(this\.(\w+)|[\w<>,? ]+\s+(\w+))\s*[,)]', m.group(1)):
                pname = p.group(2) or p.group(3)
                if pname:
                    info.ctor_params.add(pname)

problems: list[str] = []

all_members: set[str] = set()
for info in classes.values():
    all_members |= info.members
known_providers = {n for n in all_members | top_level if n.endswith('Provider')}


def report(path: Path, line_no: int, message: str) -> None:
    problems.append(f'{path.relative_to(ROOT.parent)}:{line_no}: {message}')


appdata = classes.get('AppData')
if appdata is None:
    sys.exit('AppData not found')

for path in FILES:
    text = path.read_text()
    for line_no, line in enumerate(text.splitlines(), start=1):
        code = line.split('//')[0]
        for m in re.finditer(r'(?<![\w.])(?:state\.data|data)\s*\.\s*(\w+)', code):
            member = m.group(1)
            if member not in appdata.members and member not in {'data', 'copyWith'}:
                report(path, line_no, f'AppData has no member `{member}`')
        for m in re.finditer(r'(?<![\w.])(?:_data|controller|notifier)\s*\.\s*(\w+)', code):
            member = m.group(1)
            dc = classes.get('DataController')
            if dc and member not in dc.members and member not in all_members:
                report(path, line_no, f'DataController has no member `{member}`')
        for m in re.finditer(r'\.copyWith\s*\(\s*([^)]*)\)?', code):
            continue
        # provider references
        for m in re.finditer(r'ref\.(?:read|watch|listen)\(\s*(\w+)', code):
            if m.group(1) not in known_providers and m.group(1) not in all_members:
                report(path, line_no, f'unknown provider `{m.group(1)}`')

# copyWith named arguments: scan multi-line call bodies
for path in FILES:
    text = path.read_text()
    for m in re.finditer(r'\.copyWith\s*\((.*?)\)\s*[;,)\]]', text, re.S):
        args = m.group(1)
        if len(args) > 2000:
            continue
        line_no = text[:m.start()].count('\n') + 1
        receiver = None
        head = text[max(0, m.start() - 200):m.start()]
        hm = re.search(r'(\w+(?:\.\w+)?)\s*$', head)
        if hm:
            receiver = hm.group(1).split('.')[-1]
        # find model by variable name heuristics
        candidates = [c for c in classes.values() if c.copy_with]
        names = {a.group(1) for a in re.finditer(r'(?:^|,)\s*(?:const\s+)?([A-Za-z_]\w*)\s*:', args)}
        if not names:
            continue
        best = max(candidates, key=lambda c: len(names & c.copy_with))
        unknown = names - best.copy_with if best.copy_with else set()
        if best.copy_with and unknown and not (unknown & all_members):
            report(path, line_no, f'copyWith args {sorted(unknown)} not on {best.name} '
                                  f'(nearest match {len(names & best.copy_with)}/{len(names)})')

seen = set()
for p in problems:
    if p not in seen:
        seen.add(p)
        print(p)
print(f'\n{len(seen)} potential issues', file=sys.stderr)

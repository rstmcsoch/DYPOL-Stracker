#!/usr/bin/env python3
"""Best-effort member check: infers local variable types inside each file and verifies that
`variable.member` actually exists on that class. Complements tool/check_api.py.

False positives are possible (inherited members are merged, but extension methods and
typedefs are not resolved), so read the output as a review list, not a verdict.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'lib'
FILES = sorted(ROOT.rglob('*.dart'))


def strip_comments(src: str) -> str:
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    src = re.sub(r'//[^\n]*', '', src)
    return src


class Info:
    def __init__(self, name: str) -> None:
        self.name = name
        self.members: set[str] = set()
        self.bases: list[str] = []
        self.ctor_params: set[str] = set()


classes: dict[str, Info] = {}

for path in FILES:
    src = strip_comments(path.read_text())
    for m in re.finditer(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*class\s+(\w+)(?:\s+extends\s+(\w+))?', src, re.M):
        info = classes.setdefault(m.group(1), Info(m.group(1)))
        if m.group(2):
            info.bases.append(m.group(2))
    for m in re.finditer(r'^enum\s+(\w+)', src, re.M):
        classes.setdefault(m.group(1), Info(m.group(1)))

for path in FILES:
    src = strip_comments(path.read_text())
    current: Info | None = None
    depth = 0
    for line in src.splitlines():
        head = re.match(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*class\s+(\w+)', line)
        if head:
            current = classes.setdefault(head.group(1), Info(head.group(1)))
        member = re.match(
            r'^\s{2}(?:(?:static|final|late|const|override|external)\s+)*'
            r'[A-Za-z_][\w<>?, ]*?\s+(\w+)\s*(?:[;=({]|$|=>)', line)
        if member and current is not None:
            current.members.add(member.group(1))
        # constructor params
        ctor = re.match(r'^\s{2}(?:const\s+)?' + re.escape(current.name if current else '@@') + r'\s*\(\s*\{(.*)', line) if current else None
        if ctor:
            for p in re.finditer(r'this\.(\w+)', ctor.group(1)):
                current.ctor_params.add(p.group(1))


def resolved_members(name: str, seen: set[str] | None = None) -> set[str]:
    seen = seen or set()
    if name in seen or name not in classes:
        return set()
    seen.add(name)
    members = set(classes[name].members)
    for base in classes[name].bases:
        members |= resolved_members(base, seen)
    return members


TYPE_RE = r'([A-Z][A-Za-z0-9_]*(?:<[^<>]*>)?)\??'

problems: list[str] = []

for path in FILES:
    text = path.read_text()
    src = strip_comments(text)
    types: dict[str, set[str]] = {}
    for m in re.finditer(r'(?:final|const|late final|late|var|required)\s+' + TYPE_RE + r'\s+([a-z_]\w*)', src):
        base = m.group(1).split('<')[0]
        if base in classes:
            types.setdefault(m.group(2), set()).add(base)
    for m in re.finditer(r'(?:^|[\s(,])' + TYPE_RE + r'\s+([a-z_]\w*)\s*(?:=|;|,)', src, re.M):
        base = m.group(1).split('<')[0]
        if base in classes:
            types.setdefault(m.group(2), set()).add(base)
    # lambda / callback params: (Chapter chapter) => or (Chapter a, Chapter b)
    for m in re.finditer(r'\(\s*' + TYPE_RE + r'\s+([a-z_]\w*)\s*[,)]', src):
        base = m.group(1).split('<')[0]
        if base in classes:
            types.setdefault(m.group(2), set()).add(base)
    for m in re.finditer(r'for\s*\(\s*(?:final\s+)?' + TYPE_RE + r'\s+([a-z_]\w*)\s+in', src):
        base = m.group(1).split('<')[0]
        if base in classes:
            types.setdefault(m.group(2), set()).add(base)
    types = {k: next(iter(v)) for k, v in types.items() if len(v) == 1}

    for line_no, line in enumerate(text.splitlines(), start=1):
        code = line.split('//')[0]
        for m in re.finditer(r'(?<![\w.])([a-z_]\w*)\??\s*\.\s*([a-z_]\w*)(?![\w(])', code):
            var, member = m.group(1), m.group(2)
            cls = types.get(var)
            if not cls:
                continue
            known = resolved_members(cls)
            if member not in known:
                problems.append(f'{path.relative_to(ROOT.parent)}:{line_no}: {cls}.{member} '
                                f'(via `{var}`)')

seen: set[str] = set()
for p in problems:
    if p not in seen:
        seen.add(p)
        print(p)
print(f'\n{len(seen)} unresolved member accesses', file=sys.stderr)

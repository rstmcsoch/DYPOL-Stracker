#!/usr/bin/env python3
"""Checks every call to a project-declared function or constructor:
  * all named arguments exist in the declaration;
  * required positional parameters are supplied;
  * arguments stay within the declared positional maximum.
Framework symbols are ignored because they are not declared in lib/.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'lib'
FILES = sorted(ROOT.rglob('*.dart'))


def _blank(match: re.Match) -> str:
    return re.sub(r'[^\n]', ' ', match.group(0))


def strip_comments(src: str) -> str:
    src = re.sub(r'/\*.*?\*/', _blank, src, flags=re.S)
    src = re.sub(r'//[^\n]*', _blank, src)
    return src


def balanced(text: str, start: int) -> tuple[str, int]:
    """Return the parenthesised group starting at `start` (a '(' char) and its end index."""
    depth = 0
    i = start
    quote: str | None = None
    while i < len(text):
        c = text[i]
        if quote:
            if c == '\\':
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i
        i += 1
    return text[start + 1:], len(text)


def split_args(text: str) -> list[str]:
    parts, depth, quote, buf = [], 0, None, ''
    i = 0
    while i < len(text):
        c = text[i]
        if quote:
            buf += c
            if c == '\\':
                buf += text[i + 1:i + 2]
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
            buf += c
        elif c in '([{':
            depth += 1
            buf += c
        elif c in ')]}':
            depth -= 1
            buf += c
        elif c == ',' and depth == 0:
            parts.append(buf)
            buf = ''
        else:
            buf += c
        i += 1
    if buf.strip():
        parts.append(buf)
    return parts


class Sig:
    def __init__(self) -> None:
        self.positional_min = 0
        self.positional_max = 0
        self.named: set[str] = set()
        self.required_named: set[str] = set()


def parse_params(raw: str) -> Sig:
    sig = Sig()
    # split into positional part and named part at the top level '{'
    depth = 0
    quote = None
    cut = None
    for i, c in enumerate(raw):
        if quote:
            if c == '\\':
                continue
            if c == quote:
                quote = None
            continue
        if c in "'\"":
            quote = c
        elif c in '([<{':
            if c == '{' and depth == 0:
                cut = i
                break
            depth += 1
        elif c in ')]>}':
            depth -= 1
    positional = raw if cut is None else raw[:cut]
    named = '' if cut is None else raw[cut + 1:]
    for arg in split_args(positional):
        a = arg.strip()
        if not a or a.startswith('/*'):
            continue
        if '=' in a:
            sig.positional_max += 1
            sig.positional_min += 1  # optional positional after required ones is close enough
        else:
            sig.positional_max += 1
            sig.positional_min += 1
    for arg in split_args(named):
        a = arg.strip()
        if not a:
            continue
        eq = re.search(r'(\w+)\s*=', a)
        if eq:
            name = eq.group(1)
        else:
            words = re.findall(r'\w+', a)
            if not words:
                continue
            name = words[-1]
        if name in {'required', 'this'}:
            continue
        sig.named.add(name)
        if a.startswith('required'):
            sig.required_named.add(name)
    return sig


sigs: dict[str, list[Sig]] = {}
class_names: set[str] = set()
decl_pos: set[tuple[str, int]] = set()

for path in FILES:
    src = strip_comments(path.read_text())
    for m in re.finditer(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*class\s+(\w+)', src, re.M):
        class_names.add(m.group(1))
    # top-level functions with a body
    for m in re.finditer(
        r'^(?:Future<[^>]*>|void|String|int|double|bool|List<[^>]*>|Map<[^>]*>|Set<[^>]*>|Widget|[A-Z]\w*\??|[A-Z]\w*<[^>]*>)\s+(\w+)\s*\(', src, re.M
    ):
        open_idx = src.index('(', m.end() - 1)
        raw, end = balanced(src, open_idx)
        tail = src[end + 1:end + 40].lstrip()
        if tail.startswith('{') or tail.startswith('=>') or tail.startswith('async'):
            sigs.setdefault(m.group(1), []).append(parse_params(raw))
            decl_pos.add((str(path), m.start(1)))
    # constructors
    for name in class_names:
        for m in re.finditer(r'^\s{2}(?:const\s+|factory\s+)?' + re.escape(name) + r'\s*\(', src, re.M):
            open_idx = src.index('(', m.end() - 1)
            raw, _ = balanced(src, open_idx)
            sig = Sig()
            for p in re.finditer(r'this\.(\w+)', raw):
                sig.named.add(p.group(1))
            # positional constructor params: Type name, ...
            positional = raw.split('{')[0]
            for arg in split_args(positional):
                a = arg.strip()
                if not a:
                    continue
                if a.startswith('this.'):
                    sig.positional_max += 1
                    sig.positional_min += 1
                elif not a.startswith('required'):
                    sig.positional_max += 1
                    sig.positional_min += 1
            sigs.setdefault(name, []).append(sig)
            decl_pos.add((str(path), src.index(name, m.start())))
            break

problems: list[str] = []
for path in FILES:
    text = path.read_text()
    src = strip_comments(text)
    for m in re.finditer(r'(?<![\w.$])([A-Za-z_]\w*)\s*\(', src):
        if (str(path), m.start(1)) in decl_pos:
            continue
        name = m.group(1)
        if name not in sigs:
            continue
        # skip declarations themselves
        line_start = src.rfind('\n', 0, m.start()) + 1
        prefix = src[line_start:m.start()]
        if re.search(r'(?:[A-Za-z_][\w<>,? ]*)\s+$', prefix) and not re.search(r'[=!<>+\-*/&|]\s*$', prefix):
            continue
        raw, _ = balanced(src, m.end() - 1)
        args = split_args(raw)
        labels = set()
        positional = 0
        for a in args:
            a = a.strip()
            if not a:
                continue
            lm = re.match(r'([a-zA-Z_]\w*)\s*:(?!:)', a)
            if lm:
                labels.add(lm.group(1))
            else:
                positional += 1
        line_no = src[:m.start()].count('\n') + 1
        best = None
        for sig in sigs[name]:
            if labels <= sig.named and positional <= sig.positional_max:
                best = sig
                break
        if best is None:
            union_named: set[str] = set()
            for sig in sigs[name]:
                union_named |= sig.named
            extra = labels - union_named
            if extra:
                problems.append(f'{path.relative_to(ROOT.parent)}:{line_no}: {name}() has no parameter {sorted(extra)}')
            else:
                maxp = max(s.positional_max for s in sigs[name])
                if positional > maxp:
                    problems.append(f'{path.relative_to(ROOT.parent)}:{line_no}: {name}() called with {positional} positional args, max {maxp}')

seen = set()
for p in problems:
    if p not in seen:
        seen.add(p)
        print(p)
print(f'\n{len(seen)} call-site problems', file=sys.stderr)

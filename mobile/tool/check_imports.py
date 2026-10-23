#!/usr/bin/env python3
"""Approximate 'missing import' check.

For every class/enum/typedef declared in lib/, find files that reference it without
declaring it and without importing a file that declares it (one hop, which is how the
project uses its own files: no re-export barrels). Framework and package symbols are
ignored because they are not project declarations.
"""
import re
from pathlib import Path

ROOT = Path('lib').resolve()
files = sorted(ROOT.rglob('*.dart'))
decl: dict[str, set[Path]] = {}
declared_in: dict[Path, set[str]] = {}
for f in files:
    s = f.read_text()
    names = set()
    for m in re.finditer(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*(?:class|enum|mixin|typedef)\s+(\w+)', s, re.M):
        names.add(m.group(1))
    for m in re.finditer(r'^(?:Future<[^>]*>|void|String|int|double|bool|List<[^>]*>|Map<[^>]*>|Widget)\s+(\w+)\s*\(', s, re.M):
        names.add(m.group(1))
    declared_in[f] = names
    for n in names:
        decl.setdefault(n, set()).add(f)

problems = []
for f in files:
    s = f.read_text()
    imported: set[Path] = set()
    for m in re.finditer(r"^import\s+'([^']+)'", s, re.M):
        u = m.group(1)
        if u.startswith('package:stracker/'):
            imported.add((ROOT / u[len('package:stracker/'):]).resolve())
        elif not u.startswith(('package:', 'dart:')):
            imported.add((f.parent / u).resolve())
    available = set(declared_in[f])
    for imp in imported:
        available |= declared_in.get(imp, set())
    code = re.sub(r'//[^\n]*', '', s)
    for name, owners in decl.items():
        if name in available:
            continue
        if re.search(r'(?<![\w.])' + name + r'(?![\w])', code):
            problems.append(f'{f}: uses {name} (declared in {sorted(str(o) for o in owners)[0]}) without importing it')
for p in sorted(set(problems)):
    print(p)
print(f'\n{len(set(problems))} missing imports')

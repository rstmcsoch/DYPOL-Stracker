import sys
from pathlib import Path

def check(path):
    s = Path(path).read_text()
    i, n = 0, len(s)
    stack = []
    while i < n:
        c = s[i]
        if c == '/' and s.startswith('//', i):
            i = s.find('\n', i)
            if i < 0: break
            continue
        if c == '/' and s.startswith('/*', i):
            i = s.find('*/', i) + 2
            continue
        if c in "'\"":
            triple = s.startswith(c*3, i)
            q = c*3 if triple else c
            i += len(q)
            while i < n:
                if s[i] == '\\':
                    i += 2
                    continue
                if s.startswith(q, i):
                    i += len(q)
                    break
                # interpolation ${...}: skip balanced braces
                if s.startswith('${', i):
                    depth = 0
                    i += 2
                    while i < n:
                        if s[i] == '{': depth += 1
                        elif s[i] == '}':
                            if depth == 0: break
                            depth -= 1
                        i += 1
                    i += 1
                    continue
                i += 1
            continue
        if c in '([{':
            stack.append((c, s[:i].count('\n') + 1))
        elif c in ')]}':
            if not stack:
                return f'{path}: unmatched {c} at line {s[:i].count(chr(10))+1}'
            o, line = stack.pop()
            if '([{'.index(o) != ')]}'.index(c):
                return f'{path}: {o} at line {line} closed by {c} at line {s[:i].count(chr(10))+1}'
        i += 1
    if stack:
        o, line = stack[-1]
        return f'{path}: unclosed {o} from line {line}'
    return None

bad = [r for f in sorted(Path('lib').rglob('*.dart')) + sorted(Path('test').rglob('*.dart')) if (r := check(str(f)))]
print('\n'.join(bad) if bad else 'balanced')

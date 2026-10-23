#!/usr/bin/env python3
"""Parse every Dart file with a real Dart grammar and report syntax errors.

This is the strongest check available without the Flutter SDK: it cannot see types, but a
file that does not parse could never compile, and this catches that in a second.

    pip install tree-sitter tree-sitter-dart
    python3 tool/check_syntax.py            # exits 1 when any file fails to parse

The grammar is `tree-sitter-dart`; a construct it does not know yet would show up as a
parse error, so treat a hit as "look at this line", not as "the compiler will fail here".
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import tree_sitter
    import tree_sitter_dart
except ImportError:  # pragma: no cover - dependency is optional
    sys.exit("install the parser first: pip install tree-sitter tree-sitter-dart")

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    language = tree_sitter.Language(tree_sitter_dart.language())
    parser = tree_sitter.Parser(language)

    files = sorted(ROOT.glob("lib/**/*.dart")) + sorted(ROOT.glob("test/**/*.dart"))
    if not files:
        sys.exit("no Dart files found — run this from the mobile/ project")

    failures = 0
    for path in files:
        source = path.read_bytes()
        tree = parser.parse(source)
        problems: list[tuple[str, tuple[int, int], bytes]] = []

        stack = [tree.root_node]
        while stack:
            node = stack.pop()
            if node.type == "ERROR" or node.is_missing:
                problems.append(
                    (
                        node.type,
                        (node.start_point.row + 1, node.start_point.column + 1),
                        source[node.start_byte : node.end_byte][:120],
                    )
                )
                continue
            stack.extend(node.children)

        if problems:
            failures += 1
            for kind, (line, column), snippet in problems[:5]:
                print(f"{path.relative_to(ROOT)}:{line}:{column}: {kind} {snippet!r}")
            if len(problems) > 5:
                print(f"{path.relative_to(ROOT)}: … {len(problems) - 5} more")

    print(f"{len(files)} files parsed, {failures} with syntax errors")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

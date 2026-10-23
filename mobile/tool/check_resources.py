#!/usr/bin/env python3
"""Check the hand-written Android resources without needing AAPT.

The release build failed in `:app:processReleaseResources` with

    values-v31.xml:8: error: style attribute 'android:attr/postSplashScreenTheme' not found

`postSplashScreenTheme` belongs to androidx.core:core-splashscreen, not to the Android
framework, so `android:postSplashScreenTheme` can never resolve. Flutter only reports that
error after a full Gradle run, which is exactly the slow feedback loop this file removes.

It checks two things, both of which are plain facts about the project:

1. No attribute is written with the `android:` prefix unless it really is a framework
   attribute. Library-only attributes are listed in LIBRARY_ONLY_ATTRIBUTES.
2. Every `@color`, `@drawable`, `@mipmap`, `@style`, `@string`, `@xml` and `@layout`
   reference resolves to a file or a `<... name="...">` definition in res/.

    python3 tool/check_resources.py      # exit 0 clean, 1 problems found
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"
MANIFEST = ROOT / "android/app/src/main/AndroidManifest.xml"

# Attributes that exist only in AndroidX / Material Components. Written with an `android:`
# prefix they compile to nothing and break resource linking. Add to this list rather than
# to a per-file exception.
LIBRARY_ONLY_ATTRIBUTES = {
    "postSplashScreenTheme",
    "splashScreenStyle",
    "windowSplashScreenBrandingImageCompat",
    "colorPrimary",
    "colorPrimaryVariant",
    "colorSecondary",
    "colorSurface",
    "colorOnPrimary",
    "colorOnSurface",
    "shapeAppearanceSmallComponent",
    "shapeAppearanceMediumComponent",
    "shapeAppearanceLargeComponent",
    "materialThemeOverlay",
}

# Matches both `android:name="…"` (an attribute) and `<item name="android:name">`
# (a style entry) — the style-entry form is what actually broke the build.
ATTRIBUTE = re.compile(r"android:([A-Za-z_][A-Za-z0-9_]*)")
REFERENCE = re.compile(r"@(color|drawable|mipmap|style|string|xml|layout|anim|raw)/([A-Za-z0-9_.]+)")
DEFINITION = re.compile(r'<(color|style|string|drawable|bool|integer|dimen)\s+name="([^"]+)"')


def xml_files() -> list[Path]:
    files = [MANIFEST] if MANIFEST.is_file() else []
    files += sorted(RES.rglob("*.xml")) if RES.is_dir() else []
    # files under values/ can carry comments that mention attributes; they are still XML,
    # so the same scan applies.
    return [p for p in files if p.is_file()]


def defined_names() -> dict[str, set[str]]:
    """Names defined in res/values*/ files and the file-based resource types."""
    defined: dict[str, set[str]] = {kind: set() for kind in
                                    ("color", "drawable", "mipmap", "style", "string",
                                     "xml", "layout", "anim", "raw")}
    if not RES.is_dir():
        return defined
    for values in RES.glob("values*/*.xml"):
        for kind, name in DEFINITION.findall(values.read_text(encoding="utf-8")):
            if kind in defined:
                defined[kind].add(name)
    for directory in RES.iterdir():
        if not directory.is_dir():
            continue
        kind = directory.name.split("-")[0]
        if kind in defined:
            for entry in directory.iterdir():
                defined[kind].add(entry.stem)
    return defined


def main() -> int:
    if not RES.is_dir():
        print(f"no resource directory at {RES}; skipping")
        return 0

    problems: list[str] = []
    defined = defined_names()
    files = xml_files()

    for path in files:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)

        for attribute in ATTRIBUTE.findall(text):
            if attribute in LIBRARY_ONLY_ATTRIBUTES:
                problems.append(
                    f"{rel}: `android:{attribute}` is a library attribute, not a framework one. "
                    f"Drop the `android:` prefix (and add the dependency) or remove it."
                )

        for kind, name in REFERENCE.findall(text):
            # @string entries may be referenced from the manifest with a dotted name only
            # when they are defined; anything else is a genuine typo.
            if name not in defined.get(kind, set()):
                problems.append(f"{rel}: @{kind}/{name} is not defined anywhere in res/")

    print(f"scanned {len(files)} XML files, {len(problems)} problem(s)")
    for line in problems:
        print(f"  * {line}")

    if problems:
        print("\nAAPT would fail on these during ':app:processReleaseResources'.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

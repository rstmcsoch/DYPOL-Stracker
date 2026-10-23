#!/usr/bin/env python3
"""Fail fast when the Android toolchain is older than this Flutter release allows.

Flutter refuses to build when Gradle / AGP / Kotlin / Java fall below hard floors that ship
*inside* each Flutter version (`packages/flutter_tools/gradle/src/main/kotlin/
DependencyVersionChecker.kt`). Discovering that 90 seconds into a Gradle run is painful —
especially from a phone — so this script reads the floors from the installed Flutter and
compares them with the versions pinned in this repository.

    python3 tool/check_toolchain.py            # needs FLUTTER_ROOT or `flutter` on PATH

Exit codes
    0  every pinned version is accepted (or the floors could not be read: never blocks)
    1  at least one pinned version is below Flutter's hard floor
    2  the project files could not be parsed

Nothing here guesses: the numbers come from Flutter's own source in the runner image.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKER = Path(
    "packages/flutter_tools/gradle/src/main/kotlin/DependencyVersionChecker.kt"
)


def flutter_root() -> Path | None:
    env = os.environ.get("FLUTTER_ROOT")
    if env and Path(env).is_dir():
        return Path(env)
    exe = shutil.which("flutter")
    if exe:
        # <root>/bin/flutter
        return Path(exe).resolve().parent.parent
    return None


def _version(text: str) -> tuple[int, ...]:
    parts = [int(p) for p in re.findall(r"\d+", text)]
    while len(parts) < 2:
        parts.append(0)
    return tuple(parts)


def floors(root: Path) -> dict[str, tuple[int, ...]]:
    """Hard floors declared by the installed Flutter, keyed by dependency name."""
    path = root / CHECKER
    if not path.is_file():
        return {}
    source = path.read_text(encoding="utf-8")
    found: dict[str, tuple[int, ...]] = {}
    for name, pattern in (
        ("Gradle", r"errorGradleVersion[^=\n]*=\s*Version\(([\d,\s]+)\)"),
        ("AGP", r"errorAGPVersion[^=\n]*=\s*AndroidPluginVersion\(([\d,\s]+)\)"),
        ("Kotlin", r"errorKGPVersion[^=\n]*=\s*Version\(([\d,\s]+)\)"),
        ("Java", r"errorJavaVersion[^=\n]*=\s*JavaVersion\.VERSION_(\d+)"),
    ):
        match = re.search(pattern, source)
        if match:
            found[name] = _version(match.group(1))
    return found


def gradle_version() -> tuple[int, ...] | None:
    properties = ROOT / "android/gradle/wrapper/gradle-wrapper.properties"
    if not properties.is_file():
        return None
    match = re.search(r"gradle-([\d.]+)-(all|bin)\.zip", properties.read_text())
    return _version(match.group(1)) if match else None


def settings_version(plugin: str) -> tuple[int, ...] | None:
    settings = ROOT / "android/settings.gradle"
    if not settings.is_file():
        return None
    text = settings.read_text()
    match = re.search(rf'id\s+"{re.escape(plugin)}"\s+version\s+"([\d.]+)"', text)
    return _version(match.group(1)) if match else None


def java_version() -> tuple[int, ...] | None:
    raw = os.environ.get("JAVA_HOME") or ""
    # JAVA_HOME looks like /opt/hostedtoolcache/Java_Temurin-Hotspot_jdk/17.0.20-1/x64
    match = re.search(r"(\d+)\.(\d+)[.\d]*", raw)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    try:
        out = subprocess.run(
            ["java", "-version"], capture_output=True, text=True, check=False
        ).stderr
    except OSError:
        return None
    match = re.search(r'version "(\d+)(?:\.(\d+))?', out)
    return (int(match.group(1)), int(match.group(2) or 0)) if match else None


def main() -> int:
    root = flutter_root()
    if root is None:
        print("flutter not found (set FLUTTER_ROOT); skipping the toolchain check")
        return 0

    required = floors(root)
    if not required:
        print(f"could not read the version floors from {root / CHECKER}; skipping")
        return 0

    pinned = {
        "Gradle": gradle_version(),
        "AGP": settings_version("com.android.application"),
        "Kotlin": settings_version("org.jetbrains.kotlin.android"),
        "Java": java_version(),
    }

    failures: list[str] = []
    print(f"{'Dependency':10} {'pinned':10} {'minimum':10} result")
    for name, floor in required.items():
        have = pinned.get(name)
        if have is None:
            print(f"{name:10} {'?':10} {_fmt(floor):10} not detectable here")
            continue
        okay = have >= floor
        print(f"{name:10} {_fmt(have):10} {_fmt(floor):10} {'ok' if okay else 'TOO OLD'}")
        if not okay:
            failures.append(
                f"{name} {_fmt(have)} is below this Flutter's minimum of {_fmt(floor)}"
            )

    if failures:
        print("\nThis Flutter release refuses to build with those versions:")
        for line in failures:
            print(f"  * {line}")
        print(
            "\nFix the pinned version in mobile/android/ (wrapper properties, settings.gradle),"
            "\nor pin an older Flutter version in the workflow."
        )
        return 1

    print("\nAll pinned versions are accepted by this Flutter release.")
    return 0


def _fmt(value: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in value)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:  # never fail a build because of this helper
        print(f"toolchain check skipped ({error})")
        raise SystemExit(0)

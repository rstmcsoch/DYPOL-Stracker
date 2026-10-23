# Stracker — release status (2026-10-23, 08:00 UTC)

## Where the code stands

| | |
|---|---|
| `main` | `c30900b` — PRs #80, #81, #82, #83, #84 all merged |
| Working branch | `arena/01430fd5-dypol-stracker`, tree clean, nothing unmerged |
| Sign-in | fixed: the project is compiled into the app (`lib/core/config.dart`), and a `--dart-define` override is ignored unless the build also passes `ALLOW_PROJECT_OVERRIDE=true`, so a stale CI secret can no longer misdirect an APK |
| Project the app talks to | `tkggckwksoatbswrebpu` — the same one the website uses (verified by the build itself, step "Check which Supabase project the APK will talk to") |

## What the build actually reported (not a guess)

Run **39918467643** (commit `6751770`, tag `stracker-v1.1.4`):

| Check | Result |
|---|---|
| `flutter analyze` | **0 warnings, 0 errors** |
| `flutter test` | **65 tests, 0 failures** |
| `flutter build apk --release` | **success**, signed, artifact `stracker-apk` |
| project check | compiled-in ref matches `tkggckwksoatbswrebpu` |
| Android resources | 12 files, 0 problems |

Four earlier runs on this branch also built an APK; the one failure (39913456743) was a single
compile error — `CupertinoPageTransitionsBuilder` — fixed in PR #82.

## What you install

The APK on the Releases page (`stracker-latest`) is **old**: built from `4ef802a`, before the
sign-in fix. Its notes now say so.

Install the new one either way:

1. **Artifact** — Actions → "Stracker Android release" → run **39918467643** → Artifacts →
   `stracker-apk.zip` → extract → install `app-release.apk`.
2. **Releases page** — Actions → "Stracker Android release" → **Run workflow** (branch `main`).
   That rebuilds and publishes `Stracker-release.apk` to the Releases page automatically.

Uninstall the old Stracker before installing, so the two builds cannot collide.

## What is still not verified

Only the phone can confirm how it looks and feels — the bars, the drawer, the transitions,
pull-to-refresh, back gesture, landscape and tablet layout. Everything that can be checked
without a device is green.

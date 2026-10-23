# Release status

## Where the build stands

A signed release APK is built by GitHub Actions from `main` and every check on the way is
green. The numbers below come from the workflow run itself, not from a local guess:

| | |
|---|---|
| Commit | `c30900b` (tag `stracker-v1.2.0`, branch `main`) |
| Workflow run | [39919956057](https://github.com/rstmcsoch/DYPOL-Stracker/actions/runs/39919956057) — *Stracker Android release* |
| Artifact | `stracker-apk` (31,334,363 bytes) → contains `app-release.apk` |
| `flutter analyze` | 0 warnings, 0 errors |
| `flutter test` | 65 tests, 0 failures |
| `flutter build apk --release` | success, signed with the `stracker` key |
| Project check | compiled-in project ref **matches** `tkggckwksoatbswrebpu` — the same project the website uses |
| Android resources | 12 XML files, 0 problems |

The APK is universal: `armeabi-v7a`, `arm64-v8a` and `x86_64` in one file, `minSdk 24`,
package `come.stracker.dypollabs`, label `Stracker`. Signer SHA-256
`84:B1:61:59:73:0E:01:D7:A9:64:25:8B:27:32:5E:C3:6D:0A:6A:09:36:A1:AA:CF:DE:86:29:3D:00:0E:DE:7F`.

## Installing it

**Option 1 — the artifact (works today).** Open the run above on a phone, scroll to
*Artifacts*, download `stracker-apk.zip`, extract it and install `app-release.apk`.
GitHub asks you to be signed in to download artifacts.

**Option 2 — the Releases page.** Open *Actions → Stracker Android release → Run workflow*
(branch `main`). That rebuilds and publishes `Stracker-release.apk` to the
[`stracker-latest`](https://github.com/rstmcsoch/DYPOL-Stracker/releases/tag/stracker-latest)
release automatically. Only a `workflow_dispatch` run publishes, by design, so a tag build
proves the build without overwriting the download page.

Uninstall any older Stracker first: the same signing key is used, but an older install built
before the sign-in fix points at the wrong project and cannot sign anyone in.

## What changed in this build

* **Sign-in works.** The project address and public key are compiled in
  (`lib/core/config.dart`); the workflow verifies them before building and fails on a
  mismatch. A build-time `--dart-define` override is ignored unless the build also passes
  `ALLOW_PROJECT_OVERRIDE=true`, so a stale CI secret can no longer misdirect an APK.
* **No internal wording** in anything a student sees — no product names, project ids,
  package strings or backend messages. Support details stay behind an explicit "details" tap.
* **Website parity**: the About page uses the website's wording, and *Backup → Printable
  report* produces a report with the same sections as the website's PDF export (print to
  save as PDF).
* **Furniture**: painted system bars (no grey strip), adaptive shell (bottom tabs on a phone,
  a rail from 720 dp), drawer search on narrow phones, a 180 ms crossfade between tabs,
  haptic tab switches, press feedback, page transitions, predictive back.

## What is still unverified

Only a phone can confirm how it looks and feels: bars, drawer, transitions, pull-to-refresh,
back gesture, landscape and tablet layout. Everything a build machine can check is green.

## Reproducing the build locally

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
export STRAKER_KEYSTORE=$PWD/dist/keys/stracker-release.p12
export STRAKER_STORE_PASSWORD=$(python3 -c "import json;print(json.load(open('dist/keys/keystore-info.json'))['storePassword'])")
export STRAKER_KEY_ALIAS=stracker
export STRAKER_KEY_PASSWORD=$STRAKER_STORE_PASSWORD
flutter build apk --release --target-platform android-arm,android-arm64,android-x64
```

No `--dart-define` is needed: the project configuration is in the source. The keystore files
are in `dist/keys/`, with fingerprints in `dist/keys/keystore-info.json` and checksums in
`dist/CHECKSUMS.sha256`.

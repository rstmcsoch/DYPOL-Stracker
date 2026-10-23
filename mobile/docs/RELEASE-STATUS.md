# Release artifact status

## A real release APK has been built — by GitHub Actions

| | |
|---|---|
| Release | [`stracker-latest`](https://github.com/rstmcsoch/DYPOL-Stracker/releases/tag/stracker-latest) → *Stracker — latest Android build* |
| Asset | `Stracker-release.apk`, 63,450,148 bytes (+ `.sha256`) |
| Built from | commit `4ef802a` on `main` |
| Workflow run | [39904283761](https://github.com/rstmcsoch/DYPOL-Stracker/actions/runs/39904283761) — every step green, including *Build the universal APK*, *Check the artifact* and *Publish to Releases* |
| Date | 2026-10-23, 05:10–05:17 UTC |

This is the Flutter app, not the older Capacitor build: it comes from
`.github/workflows/android-release.yml`, which runs `flutter build apk --release` for
`android-arm,android-arm64,android-x64` and refuses to publish if the artifact check fails.
Downloading it from the sandbox where this document is written is blocked
(`release-assets.githubusercontent.com`), so its SHA-256 could not be recomputed here —
the `.sha256` asset beside it is the workflow's own record.

**What that build does not contain:** the sign-in diagnostics described in
`TROUBLESHOOTING-AUTH.md` and the obscured-field capitalisation fix, both merged afterwards
(`0e14046`). Any 63,450,148-byte APK predates them.

## The artifact that is not in this folder

**`dist/Stracker-release.apk` is not in this folder.** It could not be produced in the
environment where this source was written, and no placeholder was created.

## Why

| Requirement | State in the authoring environment |
|---|---|
| `flutter` / `dart` | not installed |
| `java` / `keytool` | not installed |
| Android SDK / Gradle | not installed |
| `pub.dev` | unreachable (HTTP 000) |
| `storage.googleapis.com`, `dl.google.com`, `services.gradle.org` | unreachable (HTTP 000) |

Flutter cannot be bootstrapped from the only reachable hosts (Flutter's GitHub releases
publish no binary assets), and without pub.dev no dependency could be resolved. A build
here would therefore have been impossible to verify, and shipping a file that claims to be
a release APK would be worse than shipping none.

## What is present and verified

* `dist/keys/stracker-release-cert.pem` — public certificate (PEM), self-signed.
* `dist/keys/stracker-release-cert.der` — same certificate, DER.
* `dist/keys/stracker-release.p12` — release keystore (PKCS#12, alias `stracker`).
* `dist/keys/stracker-release-key.pem` — encrypted PKCS#8 private key.
* `dist/keys/keystore-info.json` — alias, passwords, serial, validity, SHA-256 and SHA-1
  fingerprints.
* `dist/CHECKSUMS.sha256` — SHA-256 of every source, asset, Android resource and key file.

Certificate: `CN=Rustam Chaturvedi, O=DYPOL LABS, L=Pimpri-Chinchwad, ST=Maharashtra,
C=IN, postalCode=411018`, RSA 4096, SHA-256 self-signed, valid to 2054-03-10.
SHA-256 fingerprint:
`84:B1:61:59:73:0E:01:D7:A9:64:25:8B:27:32:5E:C3:6D:0A:6A:09:36:A1:AA:CF:DE:86:29:3D:00:0E:DE:7F`

## To produce the APK (any machine with the toolchain, or the bundled CI workflow)

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
export STRAKER_KEYSTORE=$PWD/dist/keys/stracker-release.p12
export STRAKER_STORE_PASSWORD=$(python3 -c "import json;print(json.load(open('dist/keys/keystore-info.json'))['storePassword'])")
export STRAKER_KEY_ALIAS=stracker
export STRAKER_KEY_PASSWORD=$STRAKER_STORE_PASSWORD
flutter build apk --release \
  --target-platform android-arm,android-arm64,android-x64 \
  --dart-define=SUPABASE_URL=<project url> \
  --dart-define=SUPABASE_ANON_KEY=<public anon key>
cp build/app/outputs/flutter-apk/app-release.apk dist/Stracker-release.apk
sha256sum dist/Stracker-release.apk > dist/Stracker-release.apk.sha256
apksigner verify --print-certs dist/Stracker-release.apk
```

Expected after that step:
* package `come.stracker.dypollabs`, label `Stracker`, `minSdkVersion 24`;
* native libraries for `armeabi-v7a`, `arm64-v8a` and `x86_64` in the one APK (Flutter's
  engine publishes only these three — see `docs/LIMITATIONS.md` §7);
* signer SHA-256 equal to the fingerprint above.

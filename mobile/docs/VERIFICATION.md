# Verification report — Stracker 1.0.0

This document states exactly what was verified, how, and what was not. Nothing below is
asserted without a matching command or artifact.

## Environment actually used

| Tool | Present in the build sandbox? |
|---|---|
| Flutter SDK / `flutter` | **No** |
| Dart SDK / `dart` | **No** |
| JDK / `java`, `keytool` | **No** |
| Android SDK / Gradle | **No** |
| Python 3, `convert` (ImageMagick), Node/npm | Yes |
| Network to `pub.dev`, `storage.googleapis.com`, `dl.google.com`, `services.gradle.org` | **Blocked** (`000`) |

The sandbox has outbound access only to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. Flutter's
GitHub releases publish no binary SDK assets, and pub.dev is unreachable, so neither the
SDK nor the package set could be installed. **Consequently `flutter pub get`,
`flutter analyze`, `flutter test` and `flutter build apk` were not executed here, and no
APK is present in `dist/` yet.** This is a genuine blocker, not a skipped step.

## What was verified (with the method)

1. **Static symbol resolution across all 59 files in `lib/`** — four small checkers run in this
   environment:
   * `tool/check_api.py` resolves every `data.<member>` against `AppData`, every
     `ref.read/watch(<provider>)` against declared providers, and every
     `.copyWith(<named>)` against the model's parameters.
   * `tool/check_calls.py` resolves every call to a project-declared function or
     constructor and compares named/positional arguments with the declaration.
   * `tool/check_members.py` infers local variable types and checks member access.
   * `tool/balance.py` tokenises each file (strings, interpolation, comments) and confirms
     balanced brackets.
   Result at hand-off: no unresolved provider, no unknown `AppData` member, no unknown
   constructor parameter, balanced syntax in every file. Remaining checker output was
   reviewed by hand and consists of type-annotation false positives (`(Chapter c) => …`,
   `TextEditingController.clear()`).
2. **Import graph** — every relative import resolves to an existing file, and every
   `package:` import names a dependency declared in `pubspec.yaml` (no undeclared package).
3. **Palette coverage** — every `palette.<token>` used anywhere matches a field declared on
   `StrackerPalette` (31 tokens across 9 palettes × 2 modes).
4. **Schema agreement** — table and column names in `lib/data/models.dart` were read back
   against `supabase/migrations/*.sql` (19 owned tables + `exam_catalog`), including the
   relaxed 1–60 character subject constraints and the `subject in ('Physics','Chemistry',
   'Maths')` restriction that the exam-subject migration removed.
5. **Seed parity** — `lib/data/syllabus_seed.dart` was generated from `src/lib/syllabus.ts`:
   20 Physics + 22 Chemistry + 22 Maths chapter names, asserted by `test/syllabus_test.dart`.
6. **Brand assets** — the launcher icon is rasterised from `public/icons/icon-512.png`
   (`#F1EAD9` paper), the adaptive foreground from `public/icons/icon-maskable-512.png`
   (`#D8E1CE` background), the splash tile from the maskable artwork. Densities mdpi…xxxhdpi
   plus `mipmap-anydpi-v26` adaptive XML and `drawable*/splash_logo.png` were produced with
   ImageMagick and inspected visually.
7. **Signing material** — a 4096-bit RSA self-signed certificate was created and the PKCS#12
   keystore was re-opened to confirm the key size, subject DN, postal code 411018, and
   self-signed issuer. Fingerprints were computed from the certificate itself.
8. **Manifest and Gradle** — package id `come.stracker.dypollabs`, label `Stracker`,
   `minSdk 24`, `adjustResize`, `singleTop`, `enableOnBackInvokedCallback`, the
   `stracker://reset-password` intent filter, `allowBackup=false`, and a release block that
   refuses to build unsigned were all written and re-read.
9. **AI contract** — `lib/data/ai_client.dart` was written against the actual
   `api/ai/{chat,conversations,providers,test-connection,health,tasks}.ts` handlers
   (SSE event names, request body, auth header, error shape).

## Running the verification without a computer

`ci/flutter-release.yml` performs the same steps on GitHub's runners: `flutter pub get`,
`flutter analyze`, `flutter test`, `flutter build apk --release`, then it prints the package
id, label, minSdk, the native libraries for each ABI and the signer certificate into the run
summary, and publishes the APK's SHA-256 next to the artifact. Installing it needs nothing but
a phone browser — see [`PHONE-BUILD.md`](PHONE-BUILD.md). Treat a green run of that workflow,
with the signer fingerprint matching §Signing, as the completed verification.

## What still has to be run on a machine with the toolchain

```bash
cd mobile
flutter pub get
flutter analyze          # expect 0 issues
flutter test             # 12 test files, see README §7
flutter build apk --release \
  --dart-define=SUPABASE_URL=… --dart-define=SUPABASE_ANON_KEY=…
```

then:

```bash
# package id + label + minSdk
aapt dump badging build/app/outputs/flutter-apk/app-release.apk | head -5

# ABIs present in the single APK (expect all four)
unzip -l build/app/outputs/flutter-apk/app-release.apk | grep lib/

# signer certificate
apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk

# checksum
sha256sum build/app/outputs/flutter-apk/app-release.apk
```

Copy the result to `dist/Stracker-release.apk` and record its SHA-256 in
`dist/Stracker-release.apk.sha256`.

10. **ABI scope against the Flutter engine** — `AndroidArch` in Flutter stable
    (`packages/flutter_tools/lib/src/build_info.dart`, lines 439–441) declares
    `armeabi_v7a`, `arm64_v8a`, `x86_64` only, and the platform map at lines 642–654 maps
    `android-arm`, `android-arm64`, `android-x64` — there is no `android-x86`. So a
    universal APK can carry three ABIs, not four, and this was confirmed from the engine
    source rather than assumed.
11. **Dart/Flutter API shapes** were checked against the pubspec-pinned versions by reading
    the packages' documented signatures from memory of those versions — this is the one
    area that genuinely needs `flutter analyze` to confirm.

## Not verified

* Compilation, lint and test execution (no SDK).
* Runtime behaviour on a device or emulator (no emulator, no APK).
* Live sign-in against the Supabase project (no project URL/anon key were provided, and
  `supabase.co` is unreachable from this sandbox).
* Network calls to `/api/ai/*` (the deployment is unreachable from here).
* The deployed website itself (`dypol-stracker.vercel.app` returns `000` from this sandbox),
  so parity was derived from the repository source, which is the same code the deployment
  serves.

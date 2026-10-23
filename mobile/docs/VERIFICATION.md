# Verification report — Stracker 1.0.0

This document states exactly what was verified, how, and what was not. Nothing below is
asserted without a matching command or artifact.

## Environment actually used

| Tool | Present in the authoring sandbox? |
|---|---|
| Flutter SDK / `flutter` | **No** |
| Dart SDK / `dart` | **No** |
| JDK / `java`, `keytool` | **No** |
| Android SDK / Gradle | **No** |
| Python 3, `convert` (ImageMagick), Node/npm | Yes |
| Network to `pub.dev`, `storage.googleapis.com`, `dl.google.com`, `services.gradle.org` | **Blocked** (`000`) |

The sandbox has outbound access only to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. Flutter's
GitHub releases publish no binary SDK assets and pub.dev is unreachable, so neither the SDK
nor the package set could be installed. **Consequently `flutter pub get`, `flutter analyze`,
`flutter test` and `flutter build apk` were not executed there, and no APK is present in
`dist/`.** This is a genuine blocker, not a skipped step.

## What was verified (with the method)

0. **Grammar-level parse of all 71 Dart files** (`lib/` + `test/`) — `tool/check_syntax.py`
   parses every file with `tree-sitter-dart`, a real Dart grammar, and walks the tree for
   `ERROR`/missing nodes. Result: **71 files parsed, 0 syntax errors**. This cannot see types,
   but any file that fails to parse could never compile, and none does.
1. **Static symbol resolution across all 59 files in `lib/`** — four small checkers run in
   this environment:
   * `tool/check_api.py` resolves every `data.<member>` against `AppData`, every
     `ref.read/watch(<provider>)` against declared providers, and every `.copyWith(<named>)`
     against the model's parameters.
   * `tool/check_calls.py` resolves every call to a project-declared function or constructor
     and compares named/positional arguments with the declaration.
   * `tool/check_members.py` infers local variable types and checks member access.
   * `tool/check_imports.py` reports a declaration used without an import that provides it.
   * `tool/balance.py` tokenises each file (strings, interpolation, comments) and confirms
     balanced brackets.
   * `tool/check_syntax.py` (see item 0) covers what the others cannot: statement-level
     grammar.
   Result at hand-off: no unresolved provider, no unknown `AppData` member, no unknown
   constructor parameter, every file balanced and parseable. The remaining checker output was reviewed by
   hand and consists of known false positives (type annotations such as `(Chapter c) => …`
   being read as constructor calls, `TextEditingController.clear()`, and a field named
   `chapterStages` sharing a name with a top-level function).
2. **Import graph** — every relative import resolves to an existing file, and every
   `package:` import names a dependency declared in `pubspec.yaml`.
3. **Palette coverage** — every `palette.<token>` used anywhere matches a field declared on
   `StrackerPalette` (31 tokens across 9 palettes × 2 modes).
4. **Schema agreement** — table and column names in `lib/data/models.dart` were read back
   against `supabase/migrations/*.sql` (19 owned tables + `exam_catalog`), including the
   relaxed 1–60 character subject constraints from
   `20261011040444_exam_subjects_onboarding.sql`.
5. **Seed parity** — `lib/data/syllabus_seed.dart` was generated from `src/lib/syllabus.ts`:
   20 Physics + 22 Chemistry + 22 Maths chapter names, asserted by `test/syllabus_test.dart`.
6. **Brand assets** — the launcher icon is rasterised from `public/icons/icon-512.png`
   (paper `#F1EAD9`), the adaptive foreground from `public/icons/icon-maskable-512.png`
   (background `#D8E1CE`), the splash tile from the maskable artwork. Densities mdpi…xxxhdpi
   plus `mipmap-anydpi-v26` adaptive XML and `drawable*/splash_logo.png` were produced with
   ImageMagick and inspected visually.
7. **Signing material** — a 4096-bit RSA self-signed certificate was created and the PKCS#12
   keystore was re-opened to confirm key size, subject DN, postal code 411018 and that
   issuer == subject. Fingerprints were computed from the certificate itself, and the
   base64 copy used as the CI secret was decoded and compared byte-for-byte with the
   original keystore.
8. **Manifest and Gradle** — package id `come.stracker.dypollabs`, label `Stracker`,
   `minSdk 24`, `adjustResize`, `singleTop`, `enableOnBackInvokedCallback`, the
   `stracker://reset-password` intent filter, `allowBackup=false`, and a release block that
   refuses to build unsigned unless `STRAKER_ALLOW_DEBUG_SIGNING=true` was set explicitly.
9. **AI contract** — `lib/data/ai_client.dart` was written against the actual
   `api/ai/{chat,conversations,providers,test-connection,health,tasks}.ts` handlers (SSE
   event names, request body, auth header, error shape).
10. **ABI scope against the Flutter engine** — `AndroidArch` in Flutter stable
    (`packages/flutter_tools/lib/src/build_info.dart`, lines 439–441) declares
    `armeabi_v7a`, `arm64_v8a`, `x86_64` only, and the platform map at lines 642–654 maps
    `android-arm`, `android-arm64`, `android-x64` — there is no `android-x86`. A universal
    APK therefore carries three ABIs, not four; confirmed from the engine source rather than
    assumed.

## How this gets verified without a computer

`ci/flutter-release.yml` performs the same steps on GitHub's runners: `flutter pub get`,
`flutter analyze`, `flutter test`, `flutter build apk --release`. It then prints the package
id, label, minSdk, the native libraries for each ABI and the signer certificate into the run
summary, and publishes the APK's SHA-256 next to the artifact. Installing it needs nothing
but a phone browser — see [`PHONE-BUILD.md`](PHONE-BUILD.md).

Treat a green run of that workflow, with the signer fingerprint matching `SIGNING.md`, as the
completed verification. The analyze/test steps are advisory (they do not block the artifact)
until the first build is green.

## What still has to be run on a machine with the toolchain

```bash
cd mobile
flutter pub get
flutter analyze                      # expect no errors
flutter test                         # 12 files, 57 cases
flutter build apk --release \
  --dart-define=SUPABASE_URL=… --dart-define=SUPABASE_ANON_KEY=…
```

then:

```bash
# package id, label, minSdk
aapt dump badging build/app/outputs/flutter-apk/app-release.apk | head -5

# native libraries: expect armeabi-v7a, arm64-v8a, x86_64
unzip -l build/app/outputs/flutter-apk/app-release.apk | grep lib/

# signer certificate
apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk

sha256sum build/app/outputs/flutter-apk/app-release.apk
```

Copy the result to `dist/Stracker-release.apk` and record its SHA-256 in
`dist/Stracker-release.apk.sha256`.

## Not verified

* Compilation, lint and test execution (no SDK anywhere in this environment).
* Runtime behaviour on a device or emulator (no emulator, no APK).
* Live sign-in against the Supabase project (no project URL/anon key were available, and
  `supabase.co` is unreachable from this sandbox).
* Network calls to `/api/ai/*` (the deployment is unreachable from here).
* The deployed website itself (`dypol-stracker.vercel.app` returns `000` from this sandbox),
  so parity was derived from the repository source — the same code the deployment serves.
* exact Dart/Flutter package API shapes: they were written against the versions pinned in
  `pubspec.yaml`; `flutter analyze` in CI is what confirms them.

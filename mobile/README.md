# Stracker for Android — by DYPOL LABS

The native Android client for [Stracker](https://dypol-stracker.vercel.app). One Flutter
codebase, one backend (the existing Supabase project plus the existing Vercel `/api/ai/*`
functions), the same account you use on the website, the same paper-notebook look.

| | |
|---|---|
| App name | **Stracker** |
| Brand | DYPOL LABS · by Rustam Chaturvedi |
| Application ID | `come.stracker.dypollabs` |
| Version | 1.0.0 (versionCode 1) |
| Minimum Android | 7.0 / API 24 |
| Target / compile SDK | Flutter's current stable defaults (target 35) |
| Output | **one universal APK** — `dist/Stracker-release.apk` (armeabi-v7a, arm64-v8a, x86_64 — see §9.7) |
| Architecture | Flutter (Dart 3) + Riverpod, native Android shell, **no WebView** |

> **No computer?** The APK can be built by GitHub Actions and installed straight from the
> phone's browser. Follow [`docs/PHONE-BUILD.md`](docs/PHONE-BUILD.md) — about 10 minutes of
> tapping, no toolchain, no terminal.

---

## 1. What this app is

A second client for the notebook that already exists on the web. Nothing about the data
model was reinvented: the app reads and writes the same Postgres tables, under the same
row-level-security policies, through the same public anon key. A test logged on the phone
appears on the website, a mistake saved on the website is in the phone's notebook, and the
appearance you pick in either place is stored once in `app_settings`.

* **Accounts** — Supabase Auth (email + password), PKCE, email confirmation, password
  recovery through the custom scheme `stracker://reset-password`.
* **Data** — 19 account-owned tables plus the read-only `exam_catalog`, plain PostgREST
  calls filtered by `user_id`, no RPCs, no service-role key, no policy changes.
* **Images** — the private `mistake-images` bucket, object path `<user uuid>/<file>.webp`,
  signed URLs valid for one hour.
* **AI** — only through the deployed `/api/ai/*` Vercel functions with the user's own
  Supabase access token. Provider keys are posted once and never read back; no AI secret
  exists in the APK.
* **Offline** — the last successful load is cached in SharedPreferences
  (`stracker.cache.<user uuid>`, format version 2). A failed refresh keeps the cached
  notebook and marks the header pill *Offline* instead of blanking the screen.

## 2. Feature parity with the website

| Web route | Android |
|---|---|
| `/` (landing / dashboard) | `AuthFlow` when signed out, `HomePage` when signed in |
| `/login`, `/signup`, `/reset-password` | `AuthFlow` + `ResetPasswordScreen` (deep link) |
| `/syllabus` | Syllabus — 64 JEE chapters, status, priority, importance, notes, stages, PYQ years |
| `/tests` | Test journal — log a test, subject scores, error log, time split, chapter links |
| `/mistakes` | Mistake notebook — typed entries, private question image, retry flags |
| `/retry` | Retry queue |
| `/planner` | Study plan — daily tasks and weekly goals |
| `/revision` | Revisions — R1/R7/R30 ladder, overdue / today / upcoming |
| `/analytics` | Analytics — syllabus, accuracy, trends, subject signals |
| `/weak-areas` | Weak areas — test-driven and practice-driven evidence |
| `/mock-analysis` | Mock analysis — lost marks by category, time per subject, insights |
| `/backlog` | Backlog — active / snoozed / done |
| `/decks` | Formulas & flashcards — R1/R7/R30 card ladder |
| `/focus` | Focus timer — sessions written to `study_sessions` |
| `/study-now` | What should I study now — the deterministic recommendation engine |
| `/practice` | Practice / DPP log |
| `/pyqs` | PYQ tracker across the configured year window |
| `/backup` | Backup & export — JSON + per-table CSV, import with preview |
| `/settings` | Settings — exam, dates, thresholds, weights, gaps, reminders, appearance |
| `/profile` | Profile tab — identity, exam tracks, account actions |
| `/control-panel/*` | **Deliberately web-only**, explained in *Profile → Owner console* (see §9) |
| Stracker AI | `AiChatPage` — streaming chat over `/api/ai/chat` |

## 3. Design system

* **Identity** — the real logo (`public/icons/*`) at every size, Patrick Hand for headings,
  Lexend / Poppins / Sora / Open Sans as reading fonts (original WOFF2 files converted to
  TTF in `assets/fonts/`).
* **Colour** — nine palettes generated from the website's CSS variables
  (`tool/generate_palettes.py` → `lib/core/theme/palettes.dart`), each with a light and a
  night variant. Default paper `#F7F4EC`, ink `#29332D`, accent `#526C9A`.
* **Surfaces** — notebook cards with ruled headers, sticky-note pills, hand-drawn spacing,
  the consistency strip, the paper rings and the 760 px tablet cap.
* **Native feel** — Android back returns to the Home tab from another tab, pops pushed
  sections first, and leaves the app from Home; the keyboard is handled with
  `adjustResize`; safe areas are honoured; layout is responsive from 320 dp phones to
  tablets in landscape; text scaling is honoured between 0.85× and 1.6×.
* **Splash** — the native launch theme (Android 12+ system splash on 31+, `launch_background`
  before that) shows the logo on the paper colour, then the Flutter splash shows the same
  logo, the wordmark, `DYPOL LABS` near the bottom above the system inset, and *no fake
  timer*: the dashboard appears as soon as the session and the cached notebook are ready.

## 4. Project layout

```
lib/
  main.dart                 prefs + Supabase bootstrap, orientation, providers
  app.dart                  MaterialApp, RootGate, SignedInScope, theme sync
  core/
    config.dart             dart-define configuration (Supabase URL/anon key, API base)
    date.dart format.dart errors.dart validators.dart iterables.dart
    theme/                  palettes, ThemeData, appearance controller
    widgets/                notebook, fields, dialogs, charts
  data/
    models.dart             row models mirroring supabase/migrations
    repository.dart         typed PostgREST + storage access
    data_controller.dart    load / cache / every write, one place
    app_data.dart           immutable notebook + derived lookups
    app_data_codec.dart     cache and backup JSON
    syllabus_seed.dart      the 64 JEE chapters, generated from src/lib/syllabus.ts
    ai_client.dart          /api/ai/* client (SSE aware)
  logic/                    analytics, progress, aggregation, revision, mock, cards,
                            recommend, exam, reminders, backup — pure Dart, no Flutter
  features/                 one folder per screen area
android/                    hand-written Gradle project, icons, splash, manifest
test/                       unit + widget tests (see §7)
tool/                       palette generator and static consistency checks
ci/                         ready-to-install GitHub Actions workflow
dist/                       release artifacts (APK, certificate, checksums)
docs/                       build, signing, features, verification, limitations
```

## 5. Configuration

Only two values are needed to build a working app, and both are public:

```bash
flutter build apk --release \
  --dart-define=SUPABASE_URL=https://<project>.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=<public anon/publishable key> \
  [--dart-define=API_BASE_URL=https://dypol-stracker.vercel.app]
```

`--dart-define-from-file=env.json` is supported too; see `env.example.json`.

Never put the service-role key, an AI provider key or `AI_CREDENTIALS_ENCRYPTION_KEY` in
this app. There is no code path that reads them.

In the Supabase dashboard, add `stracker://reset-password` to
*Authentication → URL Configuration → Redirect URLs* so confirmation and recovery links
return to the phone. The website's own URLs stay untouched.

## 6. Signing

Release builds are signed with the project's self-signed certificate. The keystore is a
PKCS#12 file, supplied either by `android/key.properties` (git-ignored) or by the
`STRAKER_KEYSTORE`, `STRAKER_STORE_PASSWORD`, `STRAKER_KEY_ALIAS`, `STRAKER_KEY_PASSWORD`
environment variables. The Gradle build **fails** rather than silently producing a
debug-signed APK.

Certificate details, fingerprint and recovery instructions: [`docs/SIGNING.md`](docs/SIGNING.md).
Release artifact status (why `dist/Stracker-release.apk` is not present yet):
[`docs/RELEASE-STATUS.md`](docs/RELEASE-STATUS.md).

## 7. Build, analyse, test

```bash
flutter pub get
flutter analyze
flutter test
flutter build apk --release --target-platform android-arm,android-arm64,android-x64
```

`flutter build apk` produces one APK containing every ABI the engine publishes
(armeabi-v7a, arm64-v8a, x86_64); there is no `--split-per-abi` step and no ABI filter in
`android/app/build.gradle`. The toolchain's own limitation for 32-bit x86 is documented in
§9.1.

Tests included (`test/`):

| File | Covers |
|---|---|
| `analytics_test.dart` | percentage validity, half marks, full-mock aggregation, mean |
| `revision_test.dart` | revision buckets, ladder from the account gap list |
| `recommend_test.dart` | empty notebook, overdue revision, backlog snooze, determinism |
| `codec_test.dart` | cache/backup round trip, import rejection, CSV escaping |
| `cards_test.dart` | flashcard ladder, due logic, difficulty nudge |
| `syllabus_test.dart` | seeded syllabus counts, weights, progress maths |
| `date_format_test.dart` | date arithmetic, week boundaries, label formatting |
| `exam_mode_test.dart` | 30-day Exam Mode window, manual override, track fallback |
| `aggregation_test.dart` | study minutes, breaks, streaks, consistency strip, practice dedupe |
| `mock_test.dart` | empty mock, category/subject aggregation, mock picker |
| `validators_test.dart` | every input rule used by the forms |
| `widgets_test.dart` | notebook widgets, night theme, clamped text scaling |

**These tests have not been executed in this environment** — see
[`docs/VERIFICATION.md`](docs/VERIFICATION.md) for exactly what was and was not verified,
including the honest reason.

## 8. Building without a computer — and CI

The whole build can run on GitHub's servers and be installed from a phone. The step-by-step
guide is [`docs/PHONE-BUILD.md`](docs/PHONE-BUILD.md); in short:

1. merge this branch;
2. create `.github/workflows/android-release.yml` in the repository and paste the contents of
   [`ci/flutter-release.yml`](ci/flutter-release.yml) (GitHub refuses to let the automation
   account create workflow files, so this single file must be added by the repository owner);
3. add four Action secrets — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `STRAKER_KEYSTORE_BASE64`, `STRAKER_STORE_PASSWORD`;
4. **Actions → Stracker Android release → Run workflow**;
5. install `Stracker-release.apk` from the repository's **Releases** page.

Without the two keystore secrets the same workflow still produces an installable
`Stracker-test-debug-signed.apk` for testing, and says so in the run summary. With them it
builds and signs the real `Stracker-release.apk` and publishes its SHA-256 next to it.

The workflow runs `flutter analyze` and `flutter test` as advisory steps (their result is
reported but does not block the artifact), then builds every ABI into one APK, prints the
package id, label, minSdk, native libraries and signer certificate into the run summary, and
removes the keystore from the runner afterwards.

## 8b. The pinned Android toolchain

`android/settings.gradle` and `android/gradle/wrapper/gradle-wrapper.properties` pin
**AGP 8.11.1, Kotlin 2.2.20, Gradle 8.14.3**, and the release workflow pins **Flutter 3.47.7**.
Those are the versions Flutter 3.47.7 accepts, taken from its own
`packages/flutter_tools/gradle/src/main/kotlin/DependencyVersionChecker.kt`
(Gradle 8.14.0 / AGP 8.11.1 / Kotlin 2.2.20 / Java 17 floors) and cross-checked against the
compatibility ranges in `gradle_utils.dart`.

`python3 tool/check_toolchain.py` performs that comparison in about a second and names the
dependency to change, so a Flutter upgrade fails with a sentence instead of a Gradle stack
trace. The workflow runs it before `flutter build apk`.

`python3 tool/check_resources.py` is the same idea for the hand-written resources: it rejects
`android:`-prefixed attributes that exist only in AndroidX libraries (this caught the
`postSplashScreenTheme` failure that cost a full Gradle run) and any `@color` / `@drawable` /
`@mipmap` / `@style` / `@string` / `@xml` / `@layout` reference that does not resolve, which is
what AAPT reports as `error: style attribute … not found` or `resource … not found`.

## 8c. Which workflow to run

The Actions tab lists four workflows; only **Stracker Android release** builds this app. The
two *"Build … Android APK"* workflows are Capacitor/WebView leftovers from an earlier attempt,
pinned to their own branches, and a stale copy of the release workflow on `apk-debug` shares the
`stracker-latest` tag. Release publishing is now restricted to `main`, so a side branch can only
produce an artifact. See [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) for the map and the 2-minute
cleanup.

## 9. Deliberate limitations

1. **The universal APK carries three ABIs, not four.** Flutter's Android engine ships
   `armeabi-v7a`, `arm64-v8a` and `x86_64` only: `AndroidArch` in Flutter stable
   (`packages/flutter_tools/lib/src/build_info.dart`, lines 439–441) lists exactly those
   three, and the target-platform map at lines 642–654 has no `android-x86`. 32-bit x86 is
   therefore not something this app can include — it is an engine limitation, not an ABI
   filter in this project. `android/app/build.gradle` enables no ABI splits and applies no
   `abiFilters`, so every ABI the engine publishes ends up in the single APK.
2. **Owner console is web-only.** `/control-panel/*` is a service-role administrative
   surface with its own second-factor gate. Reproducing it in an APK would require shipping
   a private key or loosening RLS, both forbidden. The app links to it, explains why, and
   keeps every student feature local.
3. **No background notifications.** The website's reminder emails are server-side. The app
   shows the reminder inside the app after the configured time; it does not schedule
   Android alarms, so it cannot wake the phone by itself.
4. **Offline is read-only.** The last snapshot can be browsed offline; writes require a
   connection (the web app's offline queue is not ported). A failed write is reported and
   the local state is not updated, so the screen never lies about what was saved.
5. **Undo-delete is not ported.** Destructive actions ask for confirmation instead.
6. **First run defaults to JEE.** The account is seeded exactly like the website (JEE
   syllabus only for a JEE notebook), and the exam can be changed in
   *Settings → Exam*. The website's first-run dialog is not reproduced as a modal.
7. **iOS** — the Dart code, data layer and widgets are iOS-ready, but `ios/` is not
   included because the deliverable is an Android APK.

## 10. Licence and ownership

Stracker, its syllabus text, palette and logo are part of the DYPOL LABS project. This
client is distributed for that project's own accounts only.

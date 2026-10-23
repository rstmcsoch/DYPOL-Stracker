# Outstanding limitations

Everything here is a deliberate decision or a verified environmental blocker. None of it is
presented as working functionality anywhere in the app.

## 1. Environment blockers (why no APK is in `dist/`)

1. **No Flutter/Dart/JDK/Android SDK and no package-registry access in the authoring
   environment.** `pub.dev`, `storage.googleapis.com`, `dl.google.com` and
   `services.gradle.org` all return `000` there, and Flutter's GitHub releases carry no SDK
   binaries, so the project could never be compiled in that sandbox. The build runs on
   GitHub Actions instead — see `PHONE-BUILD.md`.
2. **No Supabase credentials were supplied.** `AppConfig` reads
   `--dart-define=SUPABASE_URL` / `SUPABASE_ANON_KEY`. Without them the app deliberately
   shows the configuration screen instead of failing at runtime.
3. **The automation account lacks the GitHub `workflows` permission.** A workflow file cannot
   be pushed from the automation branch, so the finished workflow ships as
   `ci/flutter-release.yml` and the repository owner adds the single `.github/workflows/…`
   file once (copy-paste, described in `PHONE-BUILD.md`).

## 2. What the APK can and cannot contain

4. **32-bit x86 (`android-x86`) is not in the APK.** Flutter's Android engine publishes only
   `armeabi-v7a`, `arm64-v8a` and `x86_64` (`AndroidArch` in Flutter stable's
   `packages/flutter_tools/lib/src/build_info.dart`, lines 439–441; the target-platform map at
   642–654 has no `android-x86`). This project applies no ABI filter — check
   `android/app/build.gradle` — so the universal APK contains every ABI the engine can
   produce. 32-bit x86 devices and very old x86 emulator images therefore cannot run it.
5. **Java/Kotlin shrinking is off by default.** `minifyEnabled`/`shrinkResources` are gated
   behind the `-PstrackerMinify` Gradle property because the R8 + plugin interaction cannot be
   verified without a build. Dart is still AOT-compiled and icons/code are tree-shaken, so the
   result is a real release build, just a few megabytes larger. Enable the flag once a device
   run confirms nothing breaks.
6. **`flutter analyze` / `flutter test` are advisory steps in CI.** They run on every build and
   their output is kept in the log, but they do not block the artifact, because this source has
   never been compiled and a lint-level finding should not deny the owner an installable APK.
   Make them blocking once a build is green.

## 3. Product limitations

7. **Owner console is not in the app.** `/control-panel/*` runs on service-role privileges and
   a second factor. Reimplementing it would need a second backend or weaker security, so
   *Profile → Owner console* explains the console, shows its address and copies it.
8. **No scheduled Android notifications.** The reminder time is honoured inside the app
   (`logic/reminders.dart`); no alarm or push is registered, so the phone is not woken.
9. **Offline is read-only.** Cached notebook browsing works; writes need connectivity. The
   website's offline write queue is not ported.
10. **No undo-delete.** Destructive actions confirm first; the web app's undo toast is not
    reproduced.
11. **First-run setup is silent.** A new account is seeded like the website (profile, settings
    with `onboarding_completed`, four exam tracks, JEE syllabus for a JEE notebook) and lands
    on the dashboard; exam, year and target can be changed in Settings. The website's
    onboarding dialog is not reproduced as a modal.
12. **iOS folder absent.** The Dart layer is platform-neutral, but only Android was built and
    delivered.
13. **Landscape tables** are capped at 760 dp and scroll; wide tablets use the same
    single-column notebook rather than a different information architecture.

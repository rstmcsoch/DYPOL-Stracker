# Outstanding limitations

Everything here is a deliberate decision or a verified environmental blocker. None of it is
presented as working functionality anywhere in the app.

## 1. Environment blockers (why no APK is in `dist/`)

1. **No Flutter/Dart/JDK/Android SDK and no package-registry access in the authoring
   environment.** `pub.dev`, `storage.googleapis.com`, `dl.google.com` and
   `services.gradle.org` all return `000` there, and Flutter's GitHub releases carry no SDK
   binaries, so the project cannot be compiled in that sandbox. The build runs on GitHub
   Actions instead — see `PHONE-BUILD.md`. Two CI runs have now executed the real toolchain
   (see `VERIFICATION.md` §"What the CI runs established").
2. **The project address and public key are now compiled in** (`lib/core/config.dart`), so
   no build-time values are needed. A `--dart-define` override still exists for a staging
   copy; a build made with an override that is not the website's project is caught by the
   release workflow, which fails rather than publishing it.
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
6. **`flutter analyze` / `flutter test` are advisory steps in CI.** They run on every build,
   their error lines are copied into the run summary and raised as annotations, but they do not
   block the artifact: a lint-level finding should not deny the owner an installable APK.
   Make them blocking once a full build has succeeded end to end.

7. **The Android toolchain is pinned, not floating.** `android/settings.gradle` and
   `android/gradle/wrapper/gradle-wrapper.properties` pin AGP 8.11.1, Kotlin 2.2.20 and Gradle
   8.14.3, and the workflow pins Flutter 3.47.7. Those are the versions Flutter 3.47.7 accepts
   (`DependencyVersionChecker.kt`: Gradle 8.14.0, AGP 8.11.1, Kotlin 2.2.20, Java 17 floors).
   A future Flutter release can raise those floors; `tool/check_toolchain.py` runs before the
   build and names the dependency that must change, instead of failing 90 s into Gradle.
   `tool/check_resources.py` does the same job for AAPT: it rejects `android:`-prefixed
   attributes that only exist in AndroidX libraries (the `postSplashScreenTheme` mistake) and
   unresolved `@color`/`@drawable`/`@style` references before Gradle sees them.

## 3. Product limitations

8. **Owner console is not in the app.** `/control-panel/*` runs on service-role privileges and
   a second factor. Reimplementing it would need a second backend or weaker security, so
   *Profile → Owner console* explains the console, shows its address and copies it.
9. **No scheduled Android notifications.** The reminder time is honoured inside the app
   (`logic/reminders.dart`); no alarm or push is registered, so the phone is not woken.
10. **Offline is read-only.** Cached notebook browsing works; writes need connectivity. The
   website's offline write queue is not ported.
11. **No undo-delete.** Destructive actions confirm first; the web app's undo toast is not
    reproduced.
12. **First-run setup is silent.** A new account is seeded like the website (profile, settings
    with `onboarding_completed`, four exam tracks, JEE syllabus for a JEE notebook) and lands
    on the dashboard; exam, year and target can be changed in Settings. The website's
    onboarding dialog is not reproduced as a modal.
13. **iOS folder absent.** The Dart layer is platform-neutral, but only Android was built and
    delivered.
14. **Landscape tables** are capped at 760 dp and scroll; wide tablets use the same
    single-column notebook rather than a different information architecture.

## 4. Features that stay on the web, by design

* **The owner console (`/control-panel/*`)** is not in the app and is no longer advertised
  there. It needs a second verification step and server-side privileges, and a student's
  phone must never hold either. The website keeps it.
* **PDF and DOCX reports.** The website generates real PDF/DOCX with a JavaScript report
  engine. The app produces the same report as a **printable page** (`Build a study report →
  Printable report`): open it, then use the phone's own Print → *Save as PDF*. The content
  (setup, syllabus, tests with subject marks, mistakes by type, study time, weekly goals) is
  the same; the difference is which program does the typesetting.
* **Marketing landing page.** The app opens on the notebook, not on the public sales page;
  "About Stracker" carries the same message in one screen.

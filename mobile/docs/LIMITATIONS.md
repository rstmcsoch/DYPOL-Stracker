# Outstanding limitations

Everything here is a deliberate decision or a verified environmental blocker. None of these
is presented as working functionality anywhere in the app.

## Blockers in this environment

1. **No Flutter/Dart/JDK/Android SDK and no package registry access.** The project could not
   be compiled here. See `VERIFICATION.md`; the release APK still has to be produced on a
   machine (or CI run) with the toolchain.
2. **No Supabase credentials were supplied.** `AppConfig` reads
   `--dart-define=SUPABASE_URL` / `SUPABASE_ANON_KEY`. Without them the app shows the
   configuration screen instead of failing at runtime — by design.
3. **GitHub App lacks the `workflows` permission.** A workflow file cannot be pushed from
   this branch, so the finished workflow is delivered as `ci/flutter-release.yml` with a
   one-line install command in the README.

7. **32-bit x86 (`android-x86`) is not in the APK.** Flutter's Android engine publishes
   only `armeabi-v7a`, `arm64-v8a` and `x86_64` (`AndroidArch` in Flutter stable's
   `packages/flutter_tools/lib/src/build_info.dart`, lines 439–441; the target-platform map
   at 642–654 has no `android-x86`). This project applies no ABI filter — check
   `android/app/build.gradle` — so the universal APK contains every ABI the engine can
   produce. 32-bit x86 Android devices and old x86 emulator images therefore cannot run it.

## Product limitations

4. **Owner console is not in the app.** `/control-panel/*` runs on service-role privileges
   and a second factor. Reimplementing it would need a second backend or weaker security, so
   *Profile → Owner console* explains the console, shows its address and copies it.
5. **No scheduled Android notifications.** The reminder time is honoured inside the app
   (`logic/reminders.dart`); no alarm or push is registered, so the phone is not woken.
6. **Offline is read-only.** Cached notebook browsing works; writes need connectivity. The
   website's offline write queue is not ported.
7. **No undo-delete.** Destructive actions confirm first; the web app's undo toast is not
   reproduced.
8. **First-run setup is silent.** A new account is seeded like the website (profile,
   settings with `onboarding_completed`, four exam tracks, JEE syllabus for a JEE notebook)
   and lands on the dashboard; the exam, year and target can be changed in Settings. The
   website's onboarding modal is not reproduced.
9. **iOS folder absent.** The Dart layer is platform-neutral, but only Android was built and
   delivered.
10. **Landscape tables** are capped at 760 dp and scroll; very wide tablets use the same
    single-column notebook rather than a different information architecture.

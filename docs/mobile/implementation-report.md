# Implementation and testing report — Stracker Android app

Scope: a React Native (Expo SDK 57, TypeScript) Android app in `mobile/`, built alongside the existing website
without changing it. This report states what was built, what was checked and how, and what is still open. Nothing
here is claimed beyond the evidence listed.

## Outcome in one paragraph

The app source is complete for every website route and workflow, and it type-checks, lints, bundles for Android,
and generates a valid Android project whose manifest has the required identity, SDK range, ABIs, and permissions.
A release identity was created and verified locally. **No APK has been built, signed by EAS, or installed.** The
build machine could not reach Expo's build service, and it has no Android SDK, so the APK, its signature, and its
checksum do not exist yet. The path to produce them is in `eas-build.md`.

## What was built

- **Routes and screens:** every website route has a counterpart: Home, Focus, Backlog, Practice, Syllabus, Weak
  areas, PYQs, Tests and mocks, Mock analysis, Mistake notebook, Retry, Analytics, Revisions, Formulas and
  flashcards, Study now, Study plan, Export and backup, Settings, and the AI assistant (added). Sign-in, sign-up,
  password reset, and the landing page are included.
- **Analytics:** all six pinnable charts (marks and subjects, mistake breakdown, study hours, study-day heatmap,
  syllabus progress, mock target), the metric tiles, the example card for new accounts, CSV trend export, and the
  Weekly report and Learning pipeline JEE cards. Charts are drawn with react-native-svg and plain views.
  Pinned charts (up to three) are stored in the Keystore-backed secure store.
- **Settings:** the five tabs (Account, Exam, Appearance, Study rhythm, Data) with per-tab saving, unsaved-change
  markers, validation through the shared schema, the exam-track dates, the daily reminder, the weak-area
  thresholds, password change, sign-out, and the two-step *Reset all study data* that erases the cloud copy and
  this device.
- **AI:** provider management (connect, test, prefer, enable, disable, edit, remove) through the existing
  `/api/ai/*` endpoints, and the assistant with streaming replies, conversation history, confirmation cards for
  saves, retry and stop. Provider keys never reach the app; the app holds only the user's Supabase session.
- **Backup and reports:** JSON notebook backup (cloud photos are fetched and embedded), restore with a
  preview and an explicit merge confirmation, test-history CSV (UTF-8 with byte-order mark), and PDF and DOCX
  study reports. Charts are native vector shapes in the PDF and shaded Word table cells in the DOCX, so no canvas
  is needed. Files leave the device only through the system share sheet.
- **Offline data:** an on-device SQLite cache with queued writes, one queue entry per record (latest update wins),
  transactional pulls, stable seeded IDs (no duplicate syllabus rows across restarts or devices), an 8-second undo
  window for deletes, and a mutex that serialises writes.
- **Identity and resources:** application ID `com.stracker.dypollabs`, display name Stracker, the launcher icon from
  the Stracker mark (adaptive foreground and monochrome), and a launch screen with the logo centred and `DYPOL LABS`
  near the bottom, placed with the bottom inset.
- **Design:** the website's light and dark themes and all nine colour themes, generated from the website's CSS;
  the same fonts (Patrick Hand for identity; Lexend, Poppins, Sora, or Open Sans for reading), bundled in the APK.
- **Navigation:** a bottom dock (Home, Practice, Tests, Revision, More), a quick-action button, an *Ask Stracker*
  launcher, Android back handled by the router, and safe-area handling on every page.

## Verification performed, and the result of each

| Check | Command or method | Result |
| --- | --- | --- |
| Shared modules are byte-identical to the website | `npm run shared:check` | 34 modules match |
| Design tokens match the website stylesheets | `npm run tokens:check` | Match |
| TypeScript, mobile project | `npx tsc --noEmit` | Exit 0 |
| Lint, mobile project | `npx expo lint` | 0 errors, 0 warnings |
| Jest suites | `npx jest` | 5 suites, 27 tests pass: sync engine (9), SQLite store (9), exports and report files (5), account reset (2), AI stream helpers (2) |
| Android bundle | `npx expo export --platform android` | Succeeds: 4,201 modules, Hermes bytecode about 10 MB, 45 assets |
| Android project generation | `npx expo prebuild --platform android` | Succeeds. Manifest and Gradle checked (below). |
| Expo project health | `npx expo-doctor` | 19 of 21 checks pass. The one real problem found (missing `expo-asset` peer for `expo-audio`) was fixed. Two checks need Expo's servers and did not run. |
| Public Expo config | `npx expo config --type public --json` | Identity, permissions, SDK range, ABIs, and backup setting as listed below |
| Website, typecheck | `npm run typecheck` | Exit 0 |
| Website, lint | `npm run lint` | Exit 0 |
| Website, tests | `npm test` | 37 files, 300 tests pass (unchanged baseline) |
| Website, production build | `npm run build` | Exit 0 |
| APK verification script | `scripts/verify-apk.sh` run on a synthetic archive | Logic checked only. It has **not** been run on a real APK. |

**Generated manifest (after prebuild):** package `com.stracker.dypollabs`; application label `@string/app_name` =
Stracker; permissions `INTERNET`, `POST_NOTIFICATIONS` (daily reminder), and `VIBRATE` (a normal install-time permission,
merged in by `expo-haptics`), with the location, camera, microphone, contacts, and storage permissions removed; `SYSTEM_ALERT_WINDOW` removed from the release
manifest (it comes from React Native's debug manifest); `android:allowBackup="false"`; `windowSoftInputMode="adjustResize"`;
custom scheme `stracker`; `minSdkVersion` 24, `compileSdkVersion` and `targetSdkVersion` 36; `reactNativeArchitectures`
`armeabi-v7a,arm64-v8a,x86,x86_64`; launcher resources present as WebP in every density.

**Release identity:** generated, unlocked with its stored password, and its certificate matched the public PEM. The
SHA-256 fingerprint is in `release-signing.md`.

## Quality fixes made during verification

- Lint started at 58 findings. They were fixed by code change, not by suppression, with one deliberate exception:
  a single `react-hooks/set-state-in-effect` suppression on the AI sign-in sync, which is an external network load
  that effects exist to handle. Each one is commented.
- A real device crash was found and removed before it shipped: jsPDF loads `fast-png` at import, which calls
  `TextDecoder('latin1')`, and Expo's fallback decoder is UTF-8 only. Metro now maps `fast-png` to an empty module.
  Stracker never embeds PNG images in reports, so nothing is lost.
- Account reset refuses to run offline, so the cloud copy is never left half-deleted while the device is cleared.
- A production build fails early when its Supabase variables are missing, instead of producing an APK that cannot sign in.

## Not verified — and why

- **No APK was built.** EAS cloud build needs Expo's servers, which this environment cannot reach, and no Expo token
  exists here. Local Gradle builds need the Android SDK and Google's Maven repository, which are also unreachable.
- **No app was run on a device or emulator.** Screens, touch targets, transitions, keyboard behaviour, safe areas, the
  launch screen, and the Android back gesture have been compiled and reviewed in code but not seen running.
- **Live sign-in, email links, and AI calls were not exercised.** The live Vercel deployment failed its TLS handshake from this
  environment (`SSL_ERROR_SYSCALL`). No Supabase project is configured here (there is no `mobile/.env`), so Supabase was not
  contacted. The SSE parser and the UTF-8 chunk decoder were tested with recorded inputs only.
- **Hermes' date handling was not run.** The shared date module formats dates with `Intl.DateTimeFormat` and the
  `Asia/Kolkata` time zone. This must be confirmed on a device, because every "today" in the app depends on it.
- **Two `expo-doctor` checks did not run:** Expo config schema validation and React Native Directory metadata both call
  Expo's servers.
- **R8 minification is off** for release. It stays off until a device build has been run and verified, so a
  shrinking regression cannot ship unnoticed.
- **Reminders:** the daily device notification is scheduled by the operating system with `expo-notifications`.
  Scheduling and permission prompts are implemented but have not been seen on a device.
- **Accessibility** has not been audited with TalkBack.
- **Known behaviour differences from the website:** drag-to-reorder is replaced by *Move up* and *Move down* buttons
  (touch-first); hardware-keyboard shortcuts are not bound; mistake photos use the system picker and the engine's
  pending-upload flow.
- **The keystore** is outside the repository, in the build machine's home directory. Move it to a password manager,
  as `release-signing.md` explains. The build machine is not a secure vault.

## Next steps, in order

1. Run `docs/mobile/eas-build.md` steps 1–4 from a machine that can reach Expo, and build the production APK.
2. Run `npm run verify:apk` on the APK, and record its SHA-256 in the release notes.
3. Install it on a real Android device. Walk the checklist in `eas-build.md` step 3.
4. Add the two redirect URLs in `supabase-redirects.md` and test both email links.
5. Confirm the `Asia/Kolkata` date formatting on device, then re-run the Jest suites.
6. Enable R8 and re-verify the APK once the device run is clean.

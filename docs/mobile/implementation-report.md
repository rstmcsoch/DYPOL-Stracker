# Implementation and testing report: Stracker Android app

Scope: a React Native (Expo SDK 57, TypeScript) Android app in `mobile/`, alongside the existing React website, which
was not changed. This report states what was built, what was checked and how, and what is still open. Nothing here is
claimed beyond the evidence listed.

## Outcome

- The app source covers every website route, and it type-checks, lints, bundles for Android, and generates an Android
  project whose manifest has the required identity, SDK range, ABIs, and permissions.
- **No APK exists.** The sandbox cannot sign in to Expo or reach Expo's build hosts, and it has no Android SDK, so no
  build, signature, or checksum has been produced. `eas-build.md` gives the exact blocker and the owner's steps.
- A new release identity was generated, with the subject requested by the owner. **The previous keystore is lost**, so
  the earlier fingerprint is retired (`release-signing.md`).
- Website checks pass after a fresh install: typecheck, lint, 37 test files and 300 tests, and the production build.

## What changed in this pass

- **Supabase key.** The app reads `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and accepts `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  as an alias (the publishable key wins if both are set). A service-role key is refused in two places: at runtime the
  client is not created, and `app.config.ts` fails the build. The same policy is tested in both copies.
- **Build profile.** The `production` profile now sets `"environment": "production"`, so the EAS variables created for
  that environment reach the build. Without it they would not have reached the build. `credentialsSource` is set to
  `remote` explicitly.
- **Tests.** 31 new tests were added: session storage and token refresh, the AI stream, the key policy, RLS coverage
  in the migrations, route parity with the website, and entry-screen navigation (see the table below).
- **Release identity.** Regenerated (see the identity section). `mobile/scripts/create-release-keystore.py` creates the
  identity and never prints the key or password. The public certificate is committed. `.gitignore` allows only
  `release-signing/*.cert.pem`, and private `*.pem`, `*.p12`, and `*.jks` stay ignored.
- **Documentation.** The release, EAS, and report documents were rewritten from measured results. An earlier draft of
  this report claimed "8 mobile tests" and then "27 tests in 5 suites". Both figures were wrong or outdated. The suite
  now has 58 tests in 11 suites.

## What was built (source level)

- **Routes and screens:** every route in the website's `src/App.tsx` has a screen, checked by a test. The app adds
  `/home` (the notebook home) and `/assistant` (the AI assistant). Guests see the landing page at `/`. Signed-in users go
  to `/home`. A password-recovery session goes to the reset screen. Android back is handled by the router's stack.
- **Screens:** Home, Focus, Backlog, Practice, Syllabus, Weak areas, PYQs, Tests and mocks, Mock analysis, Mistake
  notebook, Retry, Analytics, Revisions, Formulas and flashcards (Decks), Study now, Planner, Export and backup,
  Settings, and the AI assistant. Sign-in, sign-up, password reset, and the landing page are included.
- **Analytics:** the pinnable charts, metric tiles, CSV trend export, and the JEE cards. Charts use react-native-svg and
  plain views.
- **Settings:** the five tabs (Account, Exam, Appearance, Study rhythm, Data) with validation through the shared schema,
  exam-track dates, the daily reminder, weak-area thresholds, password change, sign-out, and the two-step reset of study
  data (cloud and device).
- **AI:** provider management through the website's `/api/ai/*` endpoints, and the assistant with streaming replies,
  history, confirmation cards, retry, and stop. Provider keys never reach the app. The app holds only the user's
  Supabase session and sends its access token to the server.
- **Backup and reports:** JSON backup with a restore preview and an explicit merge, test-history CSV (UTF-8 with
  byte-order mark), and PDF and DOCX reports. Files leave the device only through the system share sheet.
- **Offline data:** an on-device SQLite cache with queued writes (one queue entry per record, latest update wins),
  transactional pulls, stable seeded IDs, an 8-second undo for deletes, and a write mutex.
- **Identity and resources:** application ID `com.stracker.dypollabs` (the earlier `come.` spelling was treated as a
  typo, as instructed), display name Stracker, the launcher icon from the Stracker mark, and the launch screen.
- **Design:** the website's light and dark themes and all nine colour themes, generated from the website's stylesheets
  and checked against them. Fonts are bundled.
- **Supabase client:** the same project and accounts. Sessions are stored in the Android Keystore through
  `expo-secure-store`, split into chunks under SecureStore's 2 KB limit. Auth uses PKCE with `detectSessionInUrl: false`,
  and token refresh runs only while the app is in the foreground.

## Verification performed

| Check | Command or method | Result |
| --- | --- | --- |
| Shared modules match the website byte for byte | `npm run shared:check` | 34 modules match |
| Design tokens match the website stylesheets | `npm run tokens:check` | Match |
| TypeScript, mobile | `npm run typecheck` | Exit 0 |
| Lint, mobile | `npm run lint` (`expo lint`) | Exit 0, no warnings reported |
| Jest, mobile | `npx jest` | 11 suites, 58 tests pass (table below) |
| Mobile gate | `npm run check` | Exit 0 |
| Android bundle | `npx expo export --platform android` | Exit 0. 4,202 modules. Hermes bytecode 10,312,153 bytes. 47 files in the export. |
| Public keys reach the bundle | Export with probe values for `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Both values found in the bytecode. (Only probe values were used. The bytecode also contains the guard's own `sb_secret_` prefix string, which is code, not a key.) |
| Expo config, guard | `npx expo config --type public --json` with and without privileged keys | Normal build passes. Service-role keys fail. Production without settings fails. Production with the alias passes. |
| Android project | `npx expo prebuild --platform android --no-install` | Exit 0. Manifest and Gradle checked (below). `android/` deleted afterwards. |
| Expo project health | `npx expo-doctor` | 19 of 21 checks pass. The two failures call Expo's servers, which this sandbox cannot reach. |
| EAS sign-in and build | `npx eas-cli whoami`; `npx eas-cli build --platform android --profile production --non-interactive` | Blocked. See `eas-build.md`. |
| Release identity | `create-release-keystore.py`, then OpenSSL | Keystore opens with its password. Certificate matches the committed PEM. |
| Website, typecheck | `npm run typecheck` | Exit 0 |
| Website, lint | `npm run lint` | Exit 0 |
| Website, tests | `npm test` | 37 files, 300 tests pass |
| Website, production build | `npm run build` | Exit 0. PWA precache 119 entries. |
| APK verification script | `scripts/verify-apk.sh` on a synthetic archive | Logic checked only. It has not been run on a real APK. |

**Jest suites (58 tests):** sync engine (9), SQLite store (9), exports and report files (5), account reset (2), AI stream
parsing helpers (2), session storage and token refresh (6), Supabase key policy and the `app.config.ts` guard (6), AI
streaming with a mocked `expo/fetch` (6), RLS coverage in the migrations (6), route parity and link integrity (3), and
entry-screen navigation rendered with React Native Testing Library (4).

**Database access (static, from the migrations in `supabase/migrations/`):**

- All 19 tables the app syncs are created by the migrations. Each is in a block that enables row-level security and adds
  an owner policy (`auth.uid() = user_id`) for the `authenticated` role.
- The six AI tables are revoked from `anon` and `authenticated` and granted only to `service_role`. The app never
  queries them, and the server route authenticates the user and filters by user ID.
- No migration disables RLS, and no policy is granted to `anon`.
- The `mistake-images` bucket is private, and storage policies limit each owner to their own folder.

These are reads of the SQL. Nothing was run against the live database, so runtime enforcement is not verified.

**Manifest after prebuild:** package `com.stracker.dypollabs`; label `@string/app_name` (Stracker); permissions
`INTERNET`, `POST_NOTIFICATIONS`, and `VIBRATE`, with location, camera, microphone, contacts, storage, and
`SYSTEM_ALERT_WINDOW` removed by `tools:node="remove"`; `android:allowBackup="false"`; `windowSoftInputMode="adjustResize"`;
custom scheme `stracker`; `compileSdkVersion` and `targetSdkVersion` 36. `gradle.properties`: `minSdkVersion` 24;
`reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`; New Architecture and Hermes enabled.

**Declared dependency minimums (static):** React Native's `ReactAndroid` and Hermes declare minSdk 24 through the version
catalogue. Other modules declare 16 or 24 as defaults, and they resolve to the project's 24. React Native's ABI filter
includes all four ABIs. No Gradle build has run, so these are declarations, not a compiled result.

**Icons and splash (pixel check of the PNGs):**

- `icon.png`: 1024 px, opaque, cream background.
- `android-icon-foreground.png`: transparent corners. The mark lies within the adaptive-icon safe circle (66 dp of 108 dp).
- `android-icon-monochrome.png`: a single-ink solid silhouette of the tile. It is valid for themed icons, but it will look
  like a plain shape. This has not been seen on a device.
- `splash-icon.png` and `splash-icon-dark.png`: the cream tile with transparent margins. The two files are identical. The
  tile stays on dark backgrounds so that the dark outlines remain visible.
- The `DYPOL LABS` line is drawn by the JavaScript splash overlay, with bottom padding of the larger of the bottom inset
  or 12 px, plus 24 px.

**Navigation tests** cover the landing page's sign-up and log-in controls (`router.push('/signup')` and
`router.push('/login')`), and the root redirect for signed-out visitors, signed-in users (to `/home`), and recovery
sessions (to `/reset-password`). The auth state and Expo Router are replaced in those tests. The icon package is stubbed
because it ships untransformed ES modules.

## Quality fixes made during verification

- The launch path refuses to proceed with a privileged Supabase key, both at build time and at runtime.
- The production build fails early when its Supabase variables are missing, instead of producing an APK that cannot sign in.
- `fast-png`, pulled in by jsPDF, is mapped to an empty module in Metro. Its import calls `TextDecoder('latin1')`, and
  Expo's fallback decoder supports only UTF-8. Stracker never embeds PNG images in reports, so nothing is lost.
- Account reset refuses to run offline, so the cloud copy is never left half-deleted while the device is cleared.
- The Expo config loader cannot import TypeScript modules from `src/`, so the `app.config.ts` key policy is a copy of the
  runtime one. Tests check that both copies give the same answer on sample keys.

## Not verified, and why

- **No APK was built, signed, downloaded, or installed.** EAS needs Expo sign-in and network access to Expo's hosts, and
  neither is available here. The local Gradle build also needs the Android SDK and Google's Maven repository, which are
  unreachable.
- **No app was run on a device or emulator.** Screens, touch targets, transitions, keyboard behaviour, safe areas, the
  launch screen, and the Android back gesture have been compiled and reviewed in code, and the render tests cover only
  the entry screens. The launcher and themed icons have not been seen on a launcher.
- **Android 7.0 (API 24) is not claimed as supported.** Configuration and declared dependency minimums are consistent with
  24. No build has compiled, and no APK has run on API 24.
- **Live services were not exercised.** Live sign-in, email links, sync against the real database, RLS at runtime, and
  AI streaming against the deployed `/api/ai/*` were not tested. The production Vercel deployment failed its TLS handshake
  from this sandbox (`SSL_ERROR_SYSCALL`), and no Supabase project is configured here. The streaming code is tested
  against a scripted response.
- **Expo's two servers-only `expo-doctor` checks did not run.**
- **Date handling on Hermes was not run.** The shared date module formats dates with `Intl.DateTimeFormat` for the
  `Asia/Kolkata` time zone. This must be confirmed on a device, because every "today" in the app depends on it.
- **Fonts and glyphs.** The `S` in the mark is outlined from Gelasio Bold, which is metric-compatible with Georgia. The
  website's SVG names Georgia and depends on the system font, so the outline may differ slightly from a browser's rendering.
- **Splash colours.** The splash background (`#f7f4ec`) and the tile (`#f1ead9`) differ slightly. This is meant to be
  subtle, and it has not been seen on a device.
- **Notifications.** The daily reminder is scheduled with `expo-notifications`. Permission prompts and delivery have not
  been seen on a device.
- **Accessibility** has not been audited, and TalkBack has not been tested.
- **Deliberate differences from the website:** drag-to-reorder is replaced by *Move up* and *Move down* buttons; hardware
  keyboard shortcuts are not bound; mistake photos use the system picker.
- **R8 minification is off** for release, because a device run has not yet checked a minified build.
- **The keystore exists only in this sandbox.** It is in `~/.config/stracker-release/`. The owner must copy it out before
  the sandbox is discarded (`release-signing.md`, step 1).

## Next steps, in order

1. Owner: complete `release-signing.md` steps 1 to 2 (copy and check the keystore) from this sandbox.
2. Owner: follow `eas-build.md` steps 1 to 5 from a machine that can reach Expo, and build the production APK.
3. Run `npm run verify:apk -- <apk> <sha256>` on the downloaded file, and record the SHA-256 in the release notes.
4. Install the APK on a real Android device, and walk the checklist in `eas-build.md` step 7, including API 24 if available.
5. Add the two redirect URLs in `supabase-redirects.md`, and test both email links.
6. Confirm the `Asia/Kolkata` date formatting on a device.
7. Enable R8, and re-verify the APK after a clean device run.

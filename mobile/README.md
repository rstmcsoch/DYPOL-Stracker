# Stracker — Android app (React Native + Expo)

The Android companion to the Stracker website. It is a separate Expo project in this folder. It does **not**
replace, host, or embed the website. It talks to the same Supabase project, the same database and RLS, and the
same authenticated `/api/ai/*` endpoints on the Vercel deployment.

- **Identity:** display name *Stracker*, Android application ID `com.stracker.dypollabs`, target and compile API 36,
  minimum API 24 (Android 7.0) *configured but not yet verified*: no Gradle build has run, so dependency minimums are
  unconfirmed. Four native ABIs: `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`.
- **Stack:** Expo SDK 57, React Native 0.86, React 19, TypeScript, expo-router, expo-sqlite (offline cache),
  expo-secure-store (Keystore-backed session), react-native-svg (charts), expo-notifications (daily reminder).
- **Status:** source complete for every website route. Not yet built into an APK in this environment. See
  `../docs/mobile/implementation-report.md` for what has and has not been verified.

## Layout

| Path | What it is |
| --- | --- |
| `src/app/` | Routes only. Each file re-exports a screen. `(app)/` is the signed-in stack. |
| `src/screens/` | Screens: Home, Practice, Tests, Revision, Syllabus, Analytics, Settings, Backup, Assistant, and the rest. |
| `src/components/` | UI primitives (`ui/`), navigation (`nav/`), charts, JEE widgets, AI widgets, brand marks. |
| `src/contexts/` | Auth, data (offline engine), appearance, AI, focus timer, toasts. |
| `src/lib/` | Sync engine and cloud adapter, local SQLite store, AI transport, reports, sharing, reminders. |
| `src/shared/` | **Byte-for-byte copies** of 34 website modules (types, validation, analytics, syllabus, JEE logic). Never edit by hand; run `npm run shared:sync`. |
| `src/theme/` | Design tokens generated from the website CSS (`design-tokens.generated.ts`, never hand-edited) and the font registry. |
| `assets/` | Fonts, brand artwork, launcher and splash images, the completion tone. |
| `__tests__/` | Jest suites: sync engine, SQLite store, account reset, exports and report files. |
| `scripts/` | `sync-shared.mjs`, `generate-design-tokens.mjs`, `generate_brand_assets.py`, `verify-apk.sh`. |
| `release-signing/` | The **public** release certificate only. The private keystore is never in the repository. |

## Commands

```bash
npm ci                      # install exactly the locked versions
npm run check               # shared-copy check, token check, typecheck, lint, Jest (all must pass)
npm run typecheck           # tsc --noEmit
npm run lint                # expo lint
npm test                    # Jest
npx expo export --platform android --output-dir /tmp/stracker-export   # bundle the app
npm run prebuild            # generate android/ (ignored by Git) to inspect the manifest
npm run verify:apk -- path/to/stracker.apk <sha256>   # validate a downloaded release APK
npm run build:apk           # EAS cloud build (needs an Expo login; see docs/mobile/eas-build.md)
```

## Configuration

Public, client-side values only. Anything prefixed `EXPO_PUBLIC_` is compiled into the app.

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Sign-in and sync | The existing Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Sign-in and sync | The project's public anon/publishable key (RLS protects the data) |
| `EXPO_PUBLIC_API_BASE_URL` | AI assistant | Defaults to `https://dypol-stracker.vercel.app` |

Local development reads `.env` (copy `.env.example`). Production builds read **EAS environment variables**. A
production build without the two Supabase values fails on purpose (see `app.config.ts`).

**Never** put the Supabase service-role key, an AI provider key, or a keystore password in this folder, in
`app.config.ts`, in `eas.json`, or in any file that is committed. The app only ever receives a user's own session.

## Documentation

- `../docs/mobile/setup.md`: developer setup and local runs.
- `../docs/mobile/eas-build.md`: the EAS build path, the environment variables, and APK verification.
- `../docs/mobile/release-signing.md`: the release identity, its fingerprint, and keystore recovery.
- `../docs/mobile/supabase-redirects.md`: the redirect URLs the owner must allow in Supabase.
- `../docs/mobile/implementation-report.md`: the implementation and testing report, with limitations.

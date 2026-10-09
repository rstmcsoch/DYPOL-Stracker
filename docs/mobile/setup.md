# Setup

## Prerequisites

- Node.js 22 LTS and npm 10 (the version this project was verified with: Node 22.22.3, npm 10.9.8).
- Git, and access to the repository.
- For running on a phone: an Android device with Developer options, or an emulator. Stracker needs a **development
  build**, not Expo Go, because it uses native modules (SQLite, SecureStore, audio, notifications).
- For local Android builds only: JDK 17, the Android SDK (platform 36, build-tools 36), and the NDK version Expo
  pins in `android/build.gradle`. Cloud builds with EAS need none of this (see `eas-build.md`).

## First run

```bash
cd mobile
npm ci                  # installs the exact versions in package-lock.json
cp .env.example .env    # then fill in the two EXPO_PUBLIC_SUPABASE_* values (public values only)
npm run check           # must pass before you change anything
npx expo start --dev-client
```

`npm run check` runs, in order: the shared-module drift check (the 34 modules copied from the website must match
byte-for-byte), the design-token drift check (the colours and typography must match the website stylesheets),
the TypeScript check, `expo lint`, and the Jest suites.

## Working with shared code

- `src/shared/` is generated. Change the website source, then run `npm run shared:sync`. Never edit those files.
- `src/theme/design-tokens.generated.ts` is generated from `../src/styles/*.css`. Run `npm run tokens:generate`
  after a website style change.
- Fonts and launcher artwork come from `scripts/generate_brand_assets.py` (`npm run icons`). It needs Python
  packages `fonttools`, `brotli`, `resvg-py`, and `pillow`.

## Local data

The app keeps an offline cache in an on-device SQLite database. Signing out clears the account's cache and queued
writes. Settings → Data → *Reset all study data* erases the cloud copy as well, and needs a connection. Nothing in
the local database is shared between accounts on one device.

## Generated folders

`android/` and `ios/` are produced by `npm run prebuild`. They are ignored by Git. Edit `app.config.ts`, never the
generated folders. `ios/` is not produced at this stage; the codebase is kept iOS-ready only.

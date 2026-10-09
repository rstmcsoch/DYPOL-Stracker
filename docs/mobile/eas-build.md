# Building the signed universal APK with EAS

A release is built in Expo's cloud from the committed source, signed with the release identity in
`release-signing.md`, then downloaded and verified. This is the only supported path to a release APK.

## Status on 2026-10-09: not built

No APK, Android signature, or APK checksum exists. The build cannot start from the sandbox that prepared this code:

| Check | Command | Result |
| --- | --- | --- |
| Expo sign-in | `cd mobile && npx eas-cli whoami` | `Not logged in` (exit 1) |
| Production build | `npx eas-cli build --platform android --profile production --non-interactive` | `An Expo user account is required to proceed.` (exit 1). It stops before contacting the build service. |
| Expo network | `curl` to `api.expo.dev`, `expo.dev`, `static.expo.dev` | No response (HTTP 000) |

The owner needs to run the steps below from a machine that can sign in to Expo and reach those three hosts, or give this
sandbox access to them. Nothing in this repository needs to change for the build to start.

## Owner steps

1. **Sign in** (once per machine). Run `cd mobile && npx eas-cli login`. For CI, set `EXPO_TOKEN` in the build
   environment instead. Never paste a token into chat or a file.

2. **Link the project** (once). Run `npx eas-cli init`. It records a project ID under `extra.eas.projectId`. If it
   reports that it cannot write into `app.config.ts`, add the printed ID under `extra.eas` by hand. The ID is public.
   Commit the change.

3. **Create the production environment variables.** Use public values only, from Supabase Dashboard → Project Settings → API:

   ```bash
   npx eas-cli env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project-ref>.supabase.co"
   npx eas-cli env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "<publishable key>"
   ```

   A project that still uses a legacy anon key can set `EXPO_PUBLIC_SUPABASE_ANON_KEY` with the same command instead. If
   both are set, the publishable key is used. The `production` profile in `eas.json` has `"environment": "production"`,
   which is what makes these variables reach the build. `EXPO_PUBLIC_API_BASE_URL` is already set in `eas.json`.

   Never use a service-role key. A key that starts with `sb_secret_`, or a JWT whose role is `service_role`, is refused by
   `app.config.ts` both locally and in the cloud build.

4. **Upload the release identity** so every build is signed with it. Run `npx eas-cli credentials --platform android`,
   choose the production profile, and upload an existing keystore: `stracker-release.p12`, alias `stracker-release`. The
   keystore password is also the key password. If EAS rejects the PKCS#12 file, convert it on a machine with a JDK, then
   upload the result:

   ```bash
   keytool -importkeystore -srckeystore stracker-release.p12 -srcstoretype PKCS12 \
           -destkeystore stracker-release.jks -deststoretype JKS
   ```

   Keep the original `.p12` as well. The file and its password come from `release-signing.md`.

5. **Build** (interactive, so EAS can prompt for anything missing):

   ```bash
   cd mobile
   npm run check                                  # must pass first
   npx eas-cli build --platform android --profile production
   ```

   The `production` profile builds with `buildType: "apk"` and runs `:app:assembleRelease`. That produces one installable
   APK with all four native ABIs (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`). It is not an App Bundle. If the build stops
   with `Production builds need EXPO_PUBLIC_SUPABASE_URL …`, step 3 is incomplete.

6. **Verify the downloaded APK**, using the checksum of that exact file:

   ```bash
   cd mobile
   npm run verify:apk -- /path/to/downloaded.apk <sha256-of-that-file>
   ```

   The script prints the SHA-256 and the native ABIs packed in the archive. All four ABIs must be present. It also prints
   the signature schemes. When the Android build-tools are installed, it additionally prints the package name, the SDK
   range, the permissions, and the signing certificate's SHA-256. That certificate hash must equal
   `9A:77:A2:E1:0E:0E:17:5B:76:FB:8F:F8:15:16:EE:3F:92:BA:6A:A1:DA:83:5E:68:72:7B:82:68:2F:28:18:11`.

7. **Test on a device.** Install the APK and check at least: launch and splash, sign-in, the Home dashboard, a test log, a
   focus session, a JSON backup, a PDF and DOCX report, and the AI assistant once a provider is configured. Also check a
   password-reset email link and a sign-up confirmation link (see `supabase-redirects.md`).

## Acceptance for the build

The APK is accepted only when all of the following are shown by `verify:apk` or by the build itself:

- Application ID `com.stracker.dypollabs`, label `Stracker`.
- `minSdkVersion` 24. Android 7 support is claimed only after a device on API 24 has run this APK.
- Four ABIs: `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`.
- Signing certificate SHA-256 `9A:77:A2:E1:…:28:18:11` (see `release-signing.md`).
- Permissions limited to `INTERNET`, `POST_NOTIFICATIONS`, and `VIBRATE`.

Record the APK's SHA-256 in the release notes. Do not reuse a checksum from another build.

## If the build fails

- `Production builds need EXPO_PUBLIC_SUPABASE_URL …`: the EAS environment variables are missing (step 3).
- `privileged (service role)`: the key set for the build is a service-role key. Replace it with the publishable key.
- Signing errors: the uploaded keystore does not match the alias or the password. Re-upload it (step 4).
- Gradle or native errors: run `npm run prebuild` on a machine with JDK 17 and the Android SDK, read the first failing
  task in the generated `android/` folder, and fix `app.config.ts` or the dependency. Do not edit generated files.
- Network errors: allow `api.expo.dev`, `expo.dev`, and `static.expo.dev`, or run the build from a machine that can reach them.

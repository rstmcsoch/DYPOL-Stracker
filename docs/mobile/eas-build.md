# Building the signed universal APK with EAS

This is the only supported path to a release APK. A release is built in Expo's cloud from the committed source,
signed with the release identity in `release-signing.md`, and downloaded for verification.

## Status in this environment

**Not built yet.** The build machine used for this work could not reach Expo's servers
(`api.expo.dev`, `expo.dev`, `static.expo.dev`). Attempts failed with
`Client network socket disconnected before secure TLS connection was established`, and no Expo access token is
configured. No APK, Android signature, or APK checksum was produced. Everything in this document is the procedure
for an environment that can reach Expo.

## One-time setup

1. Create or sign in to an Expo account that owns the project.
2. Link the project once: `cd mobile && npx eas-cli init`. This writes `extra.eas.projectId` into the Expo config.
   Commit that change; it contains no secret.
3. Set the public Supabase values as **EAS environment variables** for the production environment. Do not
   put them in `eas.json`, and do not use a Supabase service-role key anywhere.

   ```bash
   npx eas-cli env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project-ref>.supabase.co"
   npx eas-cli env:create --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<public anon/publishable key>"
   ```

   `EXPO_PUBLIC_API_BASE_URL` is already set in `eas.json` to the Vercel deployment.
4. Upload the release identity so that every build is signed by it. Run
   `npx eas-cli credentials --platform android`, choose the Android keystore options, then the option to upload an
   existing keystore, and select the keystore described in `release-signing.md`. If EAS rejects the PKCS12 (`.p12`) file, convert it on a machine
   with a JDK first:
   ```bash
   keytool -importkeystore -srckeystore stracker-release.p12 -srcstoretype PKCS12 \
           -destkeystore stracker-release.jks -deststoretype JKS
   ```
   Then upload the `.jks`. The alias is `stracker-release`. Keep the original `.p12` as well.

## Build

```bash
cd mobile
npm run check                                   # must pass first
npx eas-cli build --platform android --profile production
```

The `production` profile (in `eas.json`) builds with `buildType: "apk"` and runs `:app:assembleRelease`. That gives
one installable APK containing all four native ABIs. It is not an App Bundle. The build fails early if the two
Supabase variables are missing, with a message naming them.

## Download and verify

1. Download the APK from the link EAS prints when the build finishes, or from the build's page in the Expo dashboard.
2. Verify it, recording the checksum from the real file:
   ```bash
   npm run verify:apk -- ./stracker-1.0.0.apk <expected-sha256-if-you-have-one>
   ```
   The script reports the SHA-256, the native ABIs in the archive (all four must be present), the signature
   schemes, and, when Android build-tools are installed, the package name, SDK range, permissions, and signing
   certificate SHA-256. Compare the certificate SHA-256 with `release-signing.md`. A mismatch means the build was
   not signed with the release identity.
3. Install on a test device and check at least: launch and splash, sign-in, the Home dashboard, a test log, a
   focus session, a JSON backup, a PDF and DOCX report, and the AI assistant once a provider is configured.

Record the SHA-256 of the APK in the release notes. Do not reuse a checksum from another build.

## If the build fails

- `Production builds need EXPO_PUBLIC_SUPABASE_URL …`: the EAS environment variables are missing (step 3).
- Signing errors: the uploaded keystore does not match the alias or password. Re-upload with
  `npx eas-cli credentials`.
- Gradle or native errors: run `npm run prebuild` locally and read the first failing task in
  `android/` before retrying. Do not edit generated files; change `app.config.ts` instead.

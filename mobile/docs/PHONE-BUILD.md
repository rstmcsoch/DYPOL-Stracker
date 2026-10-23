# Build the APK from your phone (no computer)

You do not need a PC. GitHub builds the app on its own servers, and you install the
finished APK from a link that opens in Chrome on the phone.

Total time: about 10 minutes of tapping, then 6–10 minutes of waiting.
You do all of it once. After that, every new build is one button.

---

## Before you start: two values from Supabase

The app is a client for your existing Supabase project, so it needs the project's public
address and public key. Nothing secret, and both are the same ones the website already uses.

1. Open **https://supabase.com/dashboard** in Chrome and sign in.
2. Tap your Stracker project.
3. Tap **Project Settings** (gear icon) → **API** (older dashboards: **API Keys**).
4. Copy **Project URL** — it looks like `https://abcdefghijk.supabase.co`.
5. Copy **anon / public** key — a long string starting with `eyJ…` or `sb_publishable_…`.

Keep both in a note app; you paste them in step 3 below.

> If you cannot find them, ask the person who deployed the website — they are the same two
> values from the Vercel/Netlify build settings (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

---

## Step 1 — Merge the pull request (1 tap)

1. Open **https://github.com/rstmcsoch/DYPOL-Stracker/pulls**.
2. Open the pull request titled **"Stracker Android client (Flutter) — mobile/"**.
3. Tap **Merge pull request** → **Confirm merge**.

This only adds the `mobile/` folder. It does not touch the website, the API or the database.

---

## Step 2 — Add the build recipe (2 minutes, copy + paste)

GitHub blocks the automated account from creating workflow files, so this one file is the
only thing you have to add yourself.

1. Open
   **https://github.com/rstmcsoch/DYPOL-Stracker/blob/main/mobile/ci/flutter-release.yml**
2. Tap the **copy** icon at the top-right of the file box (it copies the whole file).
   *If you cannot see it:* tap **Raw**, then long-press → select all → copy.
3. Go back to the repository home and tap **Add file** → **Create new file**.
4. In the file-name box type exactly:

   ```
   .github/workflows/android-release.yml
   ```

   The slashes create the folders automatically.
5. Tap inside the big text area and paste.
6. Tap **Commit changes** (leave "Commit directly to the main branch" selected).

---

## Step 3 — Add the four settings (5 minutes)

These are stored encrypted by GitHub; nobody can read them back, and they never appear in
the code.

1. Open **https://github.com/rstmcsoch/DYPOL-Stracker/settings/secrets/actions**
2. Tap **New repository secret** and add these one at a time:

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from above |
| `SUPABASE_ANON_KEY` | the anon/public key from above |
| `STRAKER_KEYSTORE_BASE64` | the contents of `keystore-base64.txt` (Drive → **03 Signing keys (private)**). Open it, select all, copy. It is one very long line — that is correct. |
| `STRAKER_STORE_PASSWORD` | the `storePassword` value from `keystore-info.json` (same Drive folder) |

Optional, only if you want a different alias:
`STRAKER_KEY_ALIAS` → `stracker`, and `STRAKER_KEY_PASSWORD` → same password as above.
The workflow already defaults both.

> Skipping the two `STRAKER_*` secrets is allowed: the build then produces a **test APK
> signed with a throwaway key**, clearly named `Stracker-test-debug-signed.apk`. It installs
> and runs, but it must not be shared, and it cannot be updated to the real release later
> without uninstalling. Add the secrets to get the properly signed `Stracker-release.apk`.

---

## Step 4 — Run the build (1 tap, then wait)

1. Open **https://github.com/rstmcsoch/DYPOL-Stracker/actions**
2. Tap **Stracker Android release** in the left list.
3. Tap **Run workflow** → **Run workflow**.
4. Wait. The list shows a yellow dot while it runs (6–10 minutes the first time, ~3 after).

---

## Step 5 — Install the app

When the run turns green:

1. Open **https://github.com/rstmcsoch/DYPOL-Stracker/releases**
2. Open **Stracker — latest Android build**.
3. Tap **Stracker-release.apk** (or `Stracker-test-debug-signed.apk` if you skipped the
   keystore secrets). Chrome downloads it.
4. Open the downloaded file (Chrome's download bar, or **Files → Downloads**).
5. Android asks to allow installs from Chrome — tap **Settings → Allow from this source**,
   go back, tap **Install**.
6. If Play Protect warns about an unknown developer, tap **More details → Install anyway**.
   That warning appears for every app installed outside the Play Store.

Sign in with the same email and password you use on the website. Your notebook is already
there.

---

## If the run turns red

1. Tap the failed run → tap the red step to open its log.
2. Tap the **⋯** at the top-right of the log → **Copy** (or select the last ~40 lines).
3. Send that text over. Most first-build failures are one of:

| Message you may see | What it means |
|---|---|
| `Release signing is not configured` | the keystore secrets are missing — add them, or accept the test build |
| `The keystore secret did not decode` | the base64 text was truncated on paste — re-copy the whole line |
| `compileSdk … requires AGP …` | the Flutter version moved ahead of the Gradle plugin — a code fix, not something you did |
| `Gradle build failed` + a `.dart` file name | a code error; send me the line and I fix it |
| `Error: Project not found` | the `SUPABASE_URL` secret has a typo |

Nothing about a failed build touches your live website or your data.

---

## After the first install (2 optional settings)

* **Password-reset links.** In Supabase → **Authentication → URL Configuration → Redirect
  URLs**, add `stracker://reset-password`. Without it, the "reset password" email still
  works, but the link opens the website instead of the app.
* **Reminders.** They appear inside the app. The phone is not woken by a notification, because
  scheduled Android alarms are not implemented (see `LIMITATIONS.md`).

---

## Rebuilding later

After any code change, repeat only **Step 4**. The certificate, secrets and workflow stay in
place, so each new APK is signed with the same key and installs straight over the previous
one. Keep the version number honest: bump `version:` in `mobile/pubspec.yaml`
(`1.0.0+1` → `1.0.1+2`) before building a release you intend to keep.

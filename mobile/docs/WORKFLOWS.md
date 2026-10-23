# The workflows in this repository, and which one to use

Your Actions tab lists **four** workflows. Only one of them builds the Flutter app in this
folder. The other three are left over from earlier attempts and are kept (dormant) on their own
branches.

| # | Name in the Actions tab | File / branch it lives on | What it actually builds | Use it? |
|---|---|---|---|---|
| 1 | **Stracker Android release** | `.github/workflows/android-release.yml` | The Flutter app in `mobile/` — **the real Stracker** | **Yes, this one** |
| 2 | **Build Android APK** | `.github/workflows/build-apk.yml` on branch `apk-build` | The *website* wrapped in Capacitor (WebView), `npm ci` + `vite build` | No — old approach |
| 3 | **Build Stracker Android APK** | `.github/workflows/build-stracker-apk.yml` on branch `android-apk` | Same Capacitor/WebView wrapper | No — old approach |
| 4 | **Stracker CI** | `.github/workflows/ci.yml` on `main` | Website lint/build checks; does not build an APK | Leave it alone |

## Why the old ones can look like they conflict

Three ordinary reasons, all avoidable:

1. **Same release tag.** A stale copy of `android-release.yml` also exists on the `apk-debug`
   branch, and it publishes to the same `stracker-latest` release. If that branch ever built
   successfully, it would overwrite the APK on the release page with a build from old code.
   → **Fixed in this workflow:** only `main` publishes now
   (`if: … && github.ref == 'refs/heads/main'`). Every other branch uploads an artifact and
   says so in the run summary.
2. **Same display name.** `apk-debug`'s copy is called *"Stracker Android release"* too, so its
   runs appear in the same list. If you press **Run workflow**, make sure the branch dropdown
   says **main**.
3. **An old APK is currently marked "Latest"** on the Releases page: *"Stracker Android APK
   (updated build)"* from 2026-10-11, built with Capacitor — i.e. the website in a WebView, not
   this app. Our workflow now sets `make_latest: true`, so the first successful run of
   *Stracker Android release* replaces it as the latest release.

None of these can touch your website, database or accounts. They are all about **which APK you
download**.

## The 2-minute cleanup (optional, phone friendly)

Nothing here is required for a successful build — it just removes the chance of picking the
wrong button.

1. **Delete the three dead branches.** Open
   <https://github.com/rstmcsoch/DYPOL-Stracker/branches> and delete `apk-build`,
   `apk-build-current`, `android-apk` and `apk-debug` (the bin icon at the right of each row).
   Their workflows then disappear from the Actions tab. The old APKs stay on the Releases page;
   deleting a branch does not delete releases.
   *`apk-debug` is the one that matters* — it is the stale copy that shares the release tag.
2. **Or disable them instead** (reversible): Actions → pick the workflow on the left →
   **⋯** (top right) → **Disable workflow**. Do **not** do this to
   *Stracker Android release* or *Stracker CI*.
3. **Tidy the old releases** (optional): <https://github.com/rstmcsoch/DYPOL-Stracker/releases>
   → for each *"Stracker Android APK …"* release → **Edit** → tick **Set as a pre-release** and
   save, so nobody downloads a Capacitor build by mistake.

> Why not delete the old releases outright? Because that old APK may be the one currently
> installed on your phone. Keep it until the new build is installed and working.

## Installing over an old build

The Capacitor APKs were signed with a different key from `dist/keys/stracker-release.p12`.
Android refuses to update an app whose signature does not match, so **uninstall the old Stracker
app first**, then install the new `Stracker-release.apk`. Your notebook lives in Supabase, so
uninstalling loses nothing but the offline cache.

## After the first successful run

- The APK appears at <https://github.com/rstmcsoch/DYPOL-Stracker/releases/tag/stracker-latest>
  and is marked **Latest**.
- The run summary prints the package id (`come.stracker.dypollabs`), `minSdk` (24), the three
  native ABIs and the signer fingerprint — compare the fingerprint with `SIGNING.md`.
- Every later run of *Stracker Android release* on `main` replaces the same `stracker-latest`
  release, so the download link never changes.

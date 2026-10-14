# Stracker by DYPOL LABS — Complete Security Audit: Technical & Plain-English Guide

- **Repository:** [`rstmcsoch/DYPOL-Stracker`](https://github.com/rstmcsoch/DYPOL-Stracker)
- **Audited Branch & Commit:** [`main` @ `b062664c2639e7f1a230ec6c43343d515c4ceac5`](https://github.com/rstmcsoch/DYPOL-Stracker/commit/b062664c2639e7f1a230ec6c43343d515c4ceac5)
- **Fixes Branch:** [`security/complete-audit-2026-10-14`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/security/complete-audit-2026-10-14)
- **Pull Request with Fixes:** [PR #63 — Security audit hardening: PII scrubbing, rate-limit IP fix, analytics ingest sanitization & forced RLS](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63)
- **Audit Date:** October 14, 2026

---

## 1. What We Audited & Overall Verdict

### Technical Summary
We performed a full-repository static, architectural, database-migration, and CI/CD security review of **Stracker by DYPOL LABS** at commit [`b062664c2639e7f1a230ec6c43343d515c4ceac5`](https://github.com/rstmcsoch/DYPOL-Stracker/commit/b062664c2639e7f1a230ec6c43343d515c4ceac5) on `main`, plus the mobile packaging branches ([`apk-build-current`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/apk-build-current), [`apk-build`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/apk-build), and [`android-apk`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/android-apk)). While an earlier audit on October 9, 2026 ([`docs/security-audit-report.md`](https://github.com/rstmcsoch/DYPOL-Stracker/blob/b062664c2639e7f1a230ec6c43343d515c4ceac5/docs/security-audit-report.md), [PR #22](https://github.com/rstmcsoch/DYPOL-Stracker/pull/22)) reviewed the app up to commit `d8c370d`, **40+ pull requests (PRs #25–#62)** were merged afterward—adding the **Stracker Control Center (`/control-panel`)**, **Site Content & Appearance CMS**, **Homepage Media Uploads**, **Multi-Exam Catalogue**, and **First-Party Analytics Pipeline**.

We re-verified all 15 findings from the October 9 audit (`STR-01` through `STR-15`) and discovered **8 new security, privacy, and infrastructure issues (`STR-NEW-01` through `STR-NEW-08`)** in the newer subsystems (**0 Critical**, **0 High**, **6 Medium**, **2 Low**). We fixed all code- and SQL-level issues in **[PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63)** along with automated regression tests.

### Simple Non-Technical Explanation (For Normal Users)
Think of Stracker as a digital study building that recently got a major expansion:
- An earlier inspection on October 9 checked the original study rooms (student notebook and AI assistant).
- Since then, five new rooms were built: an **Owner Control Room** (`/control-panel`), a **Website Design Editor**, a **Video/Image Uploader**, a **Multi-Exam Selector** (for JEE, NEET, CA, UPSC, Board exams, etc.), and a **Visitor & Usage Counter** (analytics).
- We inspected the entire building from foundation to roof—including the new rooms and the Android app builders.
- **The good news:** No one can break into another student's study notebook, steal AI keys, or take over the Owner Control Room.
- **What we found and fixed:** We found **8 medium-to-low safety gaps** in the newly added rooms (like a test file that had the owner's personal email written inside it, a visitor counter that could be spammed with fake labels, and a rate-limiter that trusted a visitor's self-reported IP address). We fixed the code for these issues in **[PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63)** and added automatic alarm tests so they can never happen again.

---

## 2. Every Problem Identified & How We Solved It (`STR-NEW-01` to `STR-NEW-08`)

---

### Issue 1 (`STR-NEW-01` — Medium): Owner's Personal Email Address Exposed in Public Test Code

#### What the Problem Was (Technical Details)
- **Where:** `api/control/control-security.test.ts` (lines 148 and 310, introduced in commit `0f036b14`).
- **Problem:** The unit test fixture `world.users[OWNER]` and the self-suspension test hardcoded the operator's real personal `@gmail.com` address instead of a dummy RFC 2606 address (`owner@example.com`). Because the repository is public on GitHub, anyone browsing the code could discover the exact email address used for the privileged Control Center owner account and target it with credential stuffing, password-reset spam, or spear-phishing against Supabase Auth.

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** The Control Center is a private admin room that only the owner can enter. However, inside one of the automated test files stored publicly on GitHub, the owner's real personal Gmail address was written down as an example. While a stranger still wouldn't have the owner's password or 6-digit phone code, knowing the exact login email makes it easier to send fake "reset your password" emails or try guessing passwords on that account.

#### What Solution We Applied (Technical Details)
- **Code Fix in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):**
  1. Replaced the personal `@gmail.com` address on lines 148 and 310 of `api/control/control-security.test.ts` with `owner@example.com`.
  2. Added an automated test in `src/lib/control-isolation.test.ts` that recursively scans every `.ts`, `.tsx`, `.css`, and `.html` file inside `src/` and `api/` and fails the build if any `@gmail.com`, `@yahoo.com`, `@outlook.com`, `@hotmail.com`, or `@icloud.com` email address is ever committed.

#### What Solution We Applied (Simple Non-Technical Explanation)
- **In Plain English:** We erased the real Gmail address from the test file and replaced it with a fake placeholder (`owner@example.com`). Then we added an automatic guard that checks every code file before changes are saved—if anyone accidentally types a personal Gmail, Yahoo, Outlook, Hotmail, or iCloud email into the code in the future, the test suite will immediately block it.

---

### Issue 2 (`STR-NEW-02` — Medium): Analytics Endpoint Could Be Polluted with Junk Event Names & Fake User IDs

#### What the Problem Was (Technical Details)
- **Where:** `api/_lib/control-routes/analytics-ingest.ts` (lines 19–35 and 73–98, introduced in commit `00599d02`).
- **Problem:**
  1. **Database & UI Pollution via `unknown_event`:** `POST /api/control/analytics-ingest` is a public endpoint that accepts up to 25 events per request. Its Zod schema validated `event.name` only as `z.string().min(1).max(60)`. Whenever an event name was not in the allowlist (`EVENTS`), the server passed the raw `event.name` string directly into `admin.rpc('analytics_bump_stat', { p_kind: 'unknown_event', p_detail: name, p_count: count })`. Because `analytics_ingest_stats` uses `(day, kind, detail)` as its primary key, an attacker could send 25 random 60-character strings (including HTML tags `<script>...`, spaces, or control characters) per request × 60 requests/min = **1,500 new database rows per minute**, polluting both the PostgreSQL table and the Control Center's "Tracking Health" screen.
  2. **Unverified `context.user_id` When an `Authorization` Header Is Present:** The endpoint accepted `context.user_id` from the JSON payload without checking whether an `Authorization: Bearer <jwt>` header was valid and matched that `user_id`.

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** Stracker has a public "activity counter box" (`/api/control/analytics-ingest`) that counts how many people visit the homepage or use features. Previously, if someone dropped a note into that box with a made-up activity name (like a random 60-letter scribble or code symbols), the system created a brand-new row in its database to record that exact scribble so the owner could see "unknown events." A prankster could drop 1,500 different scribbles every minute to clutter up the owner's dashboard and database. Also, someone could write a fake student ID on the note even if their login badge was invalid.

#### What Solution We Applied (Technical Details)
- **Code Fix in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):**
  1. Added `sanitizeUnknownEventDetail(rawName)` in `api/_lib/control-routes/analytics-ingest.ts`: only clean identifier strings matching `/^[a-z0-9][a-z0-9_.-]{0,59}$/i` are recorded by name, and at most **5 distinct unknown event names per batch** (`MAX_DISTINCT_UNKNOWN_NAMES_PER_BATCH = 5`) are allowed; any string with spaces, HTML/script tags, control characters, or more than 5 distinct names in a batch is grouped under a single constant key `'malformed_event_name'`.
  2. Added `resolveBearerUserId()` to verify the `Authorization: Bearer` token via `auth.getClaims()` when provided, stripping `context.user_id` to `null` if the token is invalid or belongs to a different user.
  3. Added 3 regression tests in `api/_lib/control-routes/analytics-ingest.test.ts`.

#### What Solution We Applied (Simple Non-Technical Explanation)
- **In Plain English:** Now, before recording any unrecognized activity name, the server checks if it looks like a normal, clean label (only letters, numbers, dots, underscores, or dashes—no spaces or symbols) and limits unknown labels to at most 5 per batch. Anything messy or excessive is tossed into a single counter called `"malformed_event_name"` instead of creating thousands of junk rows. And if someone attaches a fake login token, their claimed user ID is ignored.

---

### Issue 3 (`STR-NEW-03` — Medium): Rate-Limiter Could Be Bypassed Using Fake `X-Forwarded-For` Headers

#### What the Problem Was (Technical Details)
- **Where:** `api/_lib/control.ts` (`clientKeyHash`, lines 61–67).
- **Problem:** `clientKeyHash(req)` computed the per-IP rate-limit hash using `forwarded.split(',')[0]?.trim()`. When an HTTP request passes through a reverse proxy, any `X-Forwarded-For` header sent by the client is kept at the **beginning** (leftmost position) of the comma-separated list while the proxy appends the real IP at the end (`client_spoofed_ip, real_client_ip`). By reading `.split(',')[0]`, the rate limiter trusted the client-controlled leftmost IP. An attacker could send a random `X-Forwarded-For: 1.2.3.4` header on every request to get a brand-new rate-limit bucket every time, bypassing the 60 req/min limit on `/api/control/analytics-ingest` and anonymous `/api/control/*` probes.

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** To stop spammers from hammering the server more than 60 times a minute, Stracker checks the visitor's IP address (like a return address on an envelope). However, when an envelope passes through the post office (the cloud server), the post office stamps the real address at the *end* of the address line. If a spammer wrote a fake address at the *front* of the line before mailing it, Stracker was reading the first address instead of the post office's official stamp—allowing a spammer to pretend to be a new person on every single request.

#### What Solution We Applied (Technical Details)
- **Code Fix in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):**
  1. Updated `clientKeyHash(req)` in `api/_lib/control.ts` to read `req.headers['x-real-ip']` first, then `req.headers['x-vercel-forwarded-for']`, and when falling back to `x-forwarded-for`, to take the **last (rightmost)** IP address (`.split(',').at(-1)`) rather than `.split(',')[0]`.
  2. Added a unit test in `api/control/control-security.test.ts` verifying that changing the leftmost `X-Forwarded-For` IP produces the exact same rate-limit hash.

#### What Solution We Applied (Simple Non-Technical Explanation)
- **In Plain English:** We changed the rate-limiter so it only reads the official stamp placed by the hosting server (`x-real-ip` or the last stamp on the envelope) and completely ignores any fake return address written at the front by the sender.

---

### Issue 4 (`STR-NEW-04` — Medium): Homepage Media Upload URL Minting Was Not Recorded in the Security Audit Log

#### What the Problem Was (Technical Details)
- **Where:** `api/_lib/control-routes/media.ts` (lines 23–42, introduced in commit `a1b36a83`).
- **Problem:** When the owner requests a signed upload URL via `POST /api/control/appearance-media` (`mediaUploadHandler`), the server mints a single-use upload token into the public `homepage-media` Supabase Storage bucket and inserts a metadata row into `public.site_media`. Unlike every other mutating Control Center route (`user-access.ts`, `appearance.ts`, `exams.ts`, `audit.ts`), `mediaUploadHandler` did not call `recordAuditEvent()` to log the upload in `public.control_audit_events`.

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** In the Owner Control Center, there is an unchangeable security logbook (`Audit Log`) that writes down every important action taken by the owner (like changing website text, editing exams, or suspending a user). However, when someone uploaded a new promotional video or image for the public homepage, that action wasn't being written into the security logbook.

#### What Solution We Applied (Technical Details)
- **Code Fix in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):**
  1. Updated `api/_lib/control-routes/media.ts` to call `recordAuditEvent()` with `targetType: 'site_media'`, `targetId: path`, `outcome: 'success'`, and `{ kind, mime, bytes }` summary metadata whenever an upload URL and `site_media` row are created.
  2. Updated `api/_lib/control-routes/media.test.ts` to assert that the audit event is written on every successful upload token request.

#### What Solution We Applied (Simple Non-Technical Explanation)
- **In Plain English:** Every time a new homepage image or video upload is started in the Control Center, the system now automatically writes an entry into the security logbook with the file's path, type (image/video), format, and file size.

---

### Issue 5 (`STR-NEW-05` — Medium): Website Content Tables Lacked `FORCE ROW LEVEL SECURITY` & Pinned `search_path`

#### What the Problem Was (Technical Details)
- **Where:** `supabase/migrations/20261010120000_site_content_publishing.sql` and `supabase/migrations/20261011050608_analytics_foundation.sql`.
- **Problem:**
  1. In `20261010120000_site_content_publishing.sql`, the tables `site_content_draft`, `site_content_published`, and `site_content_versions` had `ENABLE ROW LEVEL SECURITY`, but omitted `FORCE ROW LEVEL SECURITY`.
  2. The `SECURITY DEFINER` functions `site_content_commit`, `analytics_bump_stat`, `analytics_record_error`, and `analytics_rollup_and_prune` set `search_path = public` without prepending `pg_catalog` (`set search_path = pg_catalog, public`).

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** In the database, every table has a security lock called "Row-Level Security" (RLS), plus an extra deadbolt called "Force Row-Level Security." The newer tables that store website drafts and version history had the regular lock turned on, but were missing the extra deadbolt that all the other tables had. Also, a few internal database helper functions needed a stricter lookup setting so they always use the official built-in database commands first.

#### What Solution We Applied (Technical Details)
- **SQL Migration Added in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):**
  - Created `supabase/migrations/20261014080000_security_audit_hardening.sql`, an idempotent migration that runs `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` across `site_content_draft`, `site_content_published`, `site_content_versions`, `site_media`, `exam_catalog`, `control_roles`, `control_audit_events`, `control_rate_events`, and all `analytics_*` tables, and sets `search_path = pg_catalog, public` on `site_content_commit` and the `analytics_*` functions.

#### What Solution We Applied (Simple Non-Technical Explanation)
- **In Plain English:** We created a ready-to-run database upgrade file (`20261014080000_security_audit_hardening.sql`) that puts the extra deadbolt (`FORCE ROW LEVEL SECURITY`) on every website content, admin, and analytics table and locks down the database helper functions.

---

### Issue 6 (`STR-NEW-06` — Medium): Android APK Branches Build Debug APKs (`assembleDebug`) & Publish Them to Public Releases

#### What the Problem Was (Technical Details)
- **Where:** Non-default branches `apk-build-current` (`.github/workflows/build-apk.yml`, lines 71–95), `apk-build`, and `android-apk` (`.github/workflows/build-stracker-apk.yml`, lines 49–58).
- **Problem:**
  1. On `apk-build-current` and `apk-build`, the GitHub Actions workflow runs `./gradlew assembleDebug`, renames `app/build/outputs/apk/debug/app-debug.apk` to `Stracker.apk`, and publishes it to a **public GitHub Release** (`gh release create`). Debug-built Android APKs have `android:debuggable="true"` enabled and are signed with the default Android SDK debug certificate. Anyone with USB debugging (`adb`) access to a user's phone—or certain local apps—can attach a debugger to a debuggable app, inspect the WebView, and extract the user's Supabase session token (`localStorage`).
  2. On the older `android-apk` branch, `capacitor.config.ts` sets `server: { url: 'https://dypol-stracker.vercel.app', cleartext: false }`, exposing the native Capacitor plugin bridge to a remote web origin rather than bundling static assets locally.

#### What the Problem Was (Simple Non-Technical Explanation)
- **In Plain English:** On the side branches used to create the Android phone app (`Stracker.apk`), the automated builder is currently making a "Developer Test Version" (`assembleDebug`) instead of a "Final Consumer Version" (`assembleRelease`), and posting it as a public download on GitHub Releases. A "Developer Test Version" leaves a special inspection door open on the phone so developers can test it—meaning if someone plugs that phone into a computer, they can peek inside the app's memory and read the student's login session.

#### What Solution Is Needed (Action Required on Android Branches)
- **Technical & Non-Technical Action:** Remove any old `Stracker.apk` downloads from the public GitHub "Releases" page if they were built in developer debug mode (`assembleDebug`), and switch `.github/workflows/build-apk.yml` on `apk-build-current` to `./gradlew assembleRelease` (signed with a release keystore in GitHub Secrets) before sharing the Android app with students.

---

### Issue 7 (`STR-NEW-07` — Low): Content Security Policy (CSP) Drift in `netlify.toml`

#### What the Problem Was (Technical Details & Simple Explanation)
- **Technical:** When PR #51 (`f655b394`) added homepage video/image media support, it updated `vercel.json` to include `media-src 'self' https://*.supabase.co;` in the `Content-Security-Policy` header, but did not update `netlify.toml`.
- **Simple Explanation:** Stracker has two hosting config files: one for Vercel (`vercel.json`) and a backup one for Netlify (`netlify.toml`). When homepage video support was added, Vercel's security rules were updated to allow videos from Supabase storage, but Netlify's file was left behind with the older rule.
- **Fix Applied in [PR #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63):** Updated `netlify.toml` to include `media-src 'self' https://*.supabase.co;` so both files match.

---

### Issue 8 (`STR-NEW-08` — Low): Analytics User Hash Secret Fallback Uses `SUPABASE_SERVICE_ROLE_KEY`

#### What the Problem Was (Technical Details & Simple Explanation)
- **Technical:** `analyticsSecret()` in `api/_lib/control-routes/analytics-ingest.ts` hashes user IDs using `ANALYTICS_HASH_SECRET`, or falls back to `sha256('derived:' + SUPABASE_SERVICE_ROLE_KEY)` if `ANALYTICS_HASH_SECRET` is unset.
- **Simple Explanation:** When counting returning students in analytics, Stracker scrambles each student's ID into an anonymous code (`user_ref`) using a secret password (`ANALYTICS_HASH_SECRET`). If you haven't set that secret password in Vercel yet, Stracker temporarily uses your main database master key to scramble the IDs. If you ever change your database master key later without having `ANALYTICS_HASH_SECRET` set, returning students will look like brand-new visitors in your charts.
- **Action Needed:** In **Vercel Dashboard → Project Settings → Environment Variables**, add `ANALYTICS_HASH_SECRET` with a random 32+ character string (e.g. `openssl rand -hex 32`).

---

## 3. All 15 Existing Security Protections We Re-Verified (`STR-01` to `STR-15`)

| Area | Technical Verification (`VERIFIED IN CODE`) | Simple Non-Technical Meaning |
|---|---|---|
| **Student Data Privacy (`STR-09`)** | All 19 student tables enforce PostgreSQL Row-Level Security (`ENABLE` + `FORCE ROW LEVEL SECURITY`) with `auth.uid() = user_id` on `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. | **No student can ever read, edit, or delete another student's chapters, mock tests, mistakes, or study logs.** |
| **AI API Key Encryption (`STR-08`)** | User BYOK API keys (`ai_provider_configs`) are encrypted on the server using **AES-256-GCM** with a random 96-bit IV (`api/_lib/secrets.ts`) and `AI_CREDENTIALS_ENCRYPTION_KEY`. The browser only ever receives a masked hint (last 4 characters). | **When a student saves their Gemini, OpenAI, or Claude API key, it is locked in a digital vault on the server. Even if someone opens the browser network tab, they can never see the key.** |
| **AI Action Confirmation (`STR-10`)** | Mutating AI assistant actions (`ai_pending_actions`) cannot modify student data directly during chat generation; they require an explicit `POST /api/ai/confirm` call from the student and execute on the user-scoped Supabase client (so RLS still applies). | **The AI assistant can never secretly add, edit, or delete a student's test scores or tasks without the student clicking "Confirm."** |
| **Control Center 5-Layer Lock (`Phase 3`)** | Every `/api/control/*` route (`authorizeControl` in `api/_lib/control.ts`) verifies: (1) valid Supabase JWT via `auth.getClaims()`, (2) active `owner` role in `public.control_roles`, (3) atomic rate limit (`control_take_rate_slot`), (4) `aal2` 2FA session, and (5) a fresh 6-digit TOTP verification within the last 15 minutes (`requireRecentMfa`) for sensitive actions. | **Even if someone stole the owner's password, they still could not open the Control Center without the owner's phone authenticator app (2FA). And even if a student knows the `/control-panel` URL, the server blocks them completely.** |
| **SSRF & DNS Rebinding Protection (`STR-06`)** | Custom AI provider URLs (`api/_lib/secure-fetch.ts`) must be `https://` on port 443, block private/loopback/cloud-metadata IPs (`127.0.0.1`, `10.x`, `169.254.169.254`, `192.168.x`, IPv6 local), pin the resolved DNS IP at connection time, and reject HTTP redirects (`redirect: 'error'`). | **A malicious user cannot trick Stracker's AI proxy into scanning internal cloud servers or private networks.** |
| **XSS & Open Redirect Protection (`STR-01`, `STR-03`, `STR-07`)** | Zero `dangerouslySetInnerHTML` or `eval()` calls exist in `src/`. All internal navigation paths pass through `safeAppPath()` (`src/lib/safe-path.ts`), and strict `Content-Security-Policy` (`script-src 'self'`, `frame-ancestors 'none'`) headers are set in `vercel.json` and `netlify.toml`. | **Attackers cannot inject malicious scripts into study notes or AI chat messages, and cannot frame the login page inside a fake website (clickjacking).** |
| **Private Mistake Images (`STR-04`)** | Mistake images live in a private Supabase bucket (`mistake-images`) where storage RLS and `isOwnedStoragePath()` require the folder name to match the logged-in student's UUID (`<userId>/<fileId>.webp`). | **Uploaded photos of exam mistakes are private to the student who uploaded them—nobody else can view or delete them.** |
| **Atomic AI Rate Limiting (`STR-02`)** | `api/ai/chat.ts` (10/min), `api/ai/test-connection.ts` (6/min), and `api/ai/models.ts` (12/min) use the atomic PostgreSQL advisory-locked function `public.ai_take_rate_slot`. | **No user or script can flood the AI endpoints to run up an expensive bill on their connected AI provider.** |

---

## 4. Step-by-Step Checklist: What You Need to Do Next

1. **Merge [Pull Request #63](https://github.com/rstmcsoch/DYPOL-Stracker/pull/63) on GitHub:** Puts all code fixes and regression tests onto `main` and triggers Vercel deployment.
2. **Run `supabase/migrations/20261014080000_security_audit_hardening.sql` in Supabase SQL Editor:** Turns on `FORCE ROW LEVEL SECURITY` on the website content and admin tables and pins `search_path = pg_catalog, public` on `SECURITY DEFINER` RPCs.
3. **Add `ANALYTICS_HASH_SECRET` in Vercel Environment Variables:** Generate a random 64-char hex string (`openssl rand -hex 32`) and save it as `ANALYTICS_HASH_SECRET` in Vercel Project Settings.
4. **Clean Up Debug Android APKs on GitHub Releases (`STR-NEW-06`):** Delete any `Stracker.apk` release assets built with `assembleDebug` and switch `.github/workflows/build-apk.yml` on `apk-build-current` to `assembleRelease`.

# Stracker by DYPOL LABS — Complete Security, Privacy, Infrastructure & Production Verification Audit Report

- **Repository:** [`rstmcsoch/DYPOL-Stracker`](https://github.com/rstmcsoch/DYPOL-Stracker)
- **Audited Default Branch & Commit:** [`main` @ `b062664c2639e7f1a230ec6c43343d515c4ceac5`](https://github.com/rstmcsoch/DYPOL-Stracker/commit/b062664c2639e7f1a230ec6c43343d515c4ceac5)
- **Additional Audited Branches:**
  - [`apk-build-current` @ `4cc7025b7b3c7d238950a16a1d7386c172764818`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/apk-build-current)
  - [`apk-build` @ `75ae682f0a45bfd596afb356080aa2e8c1fc24db`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/apk-build)
  - [`android-apk` @ `b83468bfd31c572d3bc91021b0ce2d3c4b3d1cbf`](https://github.com/rstmcsoch/DYPOL-Stracker/tree/android-apk)
- **Prior Baseline Audit Reviewed:** `docs/security-audit-report.md` (audited through commit `d8c370d`, PR #22)
- **Audit Date:** 2026-10-14

---

## A. Executive Summary

### Overall Security Posture
Stracker is a Multi-Exam Preparation Tracker built with **Vite + React 19 + TypeScript + Tailwind CSS**, backed by **Supabase (PostgreSQL, Auth, Storage, RLS)** and **Vercel Serverless Functions (`api/**`)**. Between commit `d8c370d` (covered by the prior 2026-10-09 security audit in PR #22) and current `main` (`b062664c`, PRs #25–#62), the application expanded with five new subsystems:

1. **Stracker Control Center (`/control-panel` & `/api/control/*`)** — Owner-only administration plane with Supabase AAL2/TOTP MFA enforcement, recent-MFA step-up verification, append-only audit logs, and user suspension/reactivation controls (`0f036b14`, `4f648af7`).
2. **Site Content & Appearance Publishing System** — Draft/published/versioned CMS (`site_content_draft`, `site_content_published`, `site_content_versions`) and public homepage media uploads (`site_media`, `homepage-media` bucket) (`2e2a4661`, `a1b36a83`).
3. **Multi-Exam Catalogue & Per-Exam Subject Architecture** — Admin-managed exam definitions (`exam_catalog`), onboarding exam picker, and per-exam subject scoping across study logs, syllabus, analytics, and AI tools (`7514734a`, `d04ace70`, `b062664c`).
4. **First-Party Product Analytics Pipeline** — Public beacon ingestion (`POST /api/control/analytics-ingest`), daily rollup tables (`analytics_events`, `analytics_daily_rollups`, `analytics_ingest_stats`, `analytics_error_groups`), and a 6-section Analytics console (`00599d02`, `2cd333f6`).
5. **Android Capacitor CI/CD Packaging Branches** — Automated APK build and GitHub Release workflows on `apk-build-current`, `apk-build`, and `android-apk`.

The foundational architecture is strong: all 15 findings from the prior 2026-10-09 audit (`STR-01` through `STR-15`) remain properly remediated in source code, `SUPABASE_SERVICE_ROLE_KEY` and `AI_CREDENTIALS_ENCRYPTION_KEY` are strictly isolated to `api/_lib/*` serverless modules, BYOK API keys are encrypted at rest with AES-256-GCM, custom outbound base URLs are protected against SSRF and DNS rebinding via `fetchCustomProvider`, and student tables enforce `FORCE ROW LEVEL SECURITY` with `auth.uid() = user_id` checks.

### Summary of New Findings (Post-`d8c370d`, PRs #25–#62)
Our full-codebase audit identified **8 new findings** (`STR-NEW-01` through `STR-NEW-08`: **0 Critical**, **0 High**, **6 Medium**, **2 Low**) introduced in the post-2026-10-09 feature additions:

| ID | Severity | Status | Component | Summary |
|---|---|---|---|---|
| **STR-NEW-01** | **Medium** | **FIXED IN PR** | `api/control/control-security.test.ts` | Operator personal Gmail address hardcoded in committed test fixtures, violating repository identity/PII rules. |
| **STR-NEW-02** | **Medium** | **FIXED IN PR** | `api/_lib/control-routes/analytics-ingest.ts` | Unauthenticated `POST /api/control/analytics-ingest` passed unsanitized unknown event names (`z.string().max(60)`) directly into `analytics_ingest_stats.detail` and accepted unverified `context.user_id` even when an invalid `Authorization` header was supplied. |
| **STR-NEW-03** | **Medium** | **FIXED IN PR** | `api/_lib/control.ts` (`clientKeyHash`) | Per-IP rate limiting for anonymous `/api/control/*` and `/api/control/analytics-ingest` extracted the leftmost `X-Forwarded-For` entry before checking `x-real-ip` or rightmost proxy IP, allowing clients to spoof IP hashes via custom `X-Forwarded-For` headers. |
| **STR-NEW-04** | **Medium** | **FIXED IN PR** | `api/_lib/control-routes/media.ts` | Minting signed upload URLs to the public `homepage-media` bucket (`POST /api/control/appearance-media`) wrote no `control_audit_events` entry. |
| **STR-NEW-05** | **Medium** | **FIXED IN PR** | `supabase/migrations/20261010120000_site_content_publishing.sql` | `site_content_draft`, `site_content_published`, and `site_content_versions` lacked `FORCE ROW LEVEL SECURITY`, and `site_content_commit` / `analytics_*` functions lacked `pg_catalog` in `search_path`. |
| **STR-NEW-06** | **Medium** | **ACTION REQUIRED (Branches)** | `.github/workflows/build-apk.yml` (`apk-build-current`, `apk-build`), `android-apk` | Non-default Android branches build debug-signed APKs (`./gradlew assembleDebug`, `android:debuggable="true"`) and publish them as `Stracker.apk` to public GitHub Releases; `android-apk` sets remote `server.url` in Capacitor. |
| **STR-NEW-07** | **Low** | **FIXED IN PR** | `netlify.toml`, repo root | `netlify.toml` CSP lacked `media-src 'self' https://*.supabase.co` (drifting from `vercel.json`), and repo root tracks `/DYPOL-Stracker-security-hardening.zip` and `/videos`. |
| **STR-NEW-08** | **Low** | **OPEN / ENV CONFIG** | `api/_lib/control-routes/analytics-ingest.ts` | When `ANALYTICS_HASH_SECRET` is unset, `analyticsSecret()` derives the pseudonymization key from `SUPABASE_SERVICE_ROLE_KEY`, coupling analytics cohort continuity to service-role key rotation. |

---

## B. Architecture & Attack Surface Map

| Boundary | Components | Security Controls Verified |
|---|---|---|
| **Browser SPA (`src/**`)** | Vite 7, React 19, React Router 7, TanStack Query, Dexie/IndexedDB | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` exposed. Zero `dangerouslySetInnerHTML`/`eval` sinks. `safeAppPath()` blocks open redirects. `isOwnedStoragePath()` validates `<userId>/<fileId>.webp`. Control Center lazy-loaded (`src/control/ControlPanelApp.tsx`). |
| **Stracker AI Proxy (`api/ai/*` — 8 Functions)** | `chat.ts`, `confirm.ts`, `conversations.ts`, `health.ts`, `models.ts`, `providers.ts`, `stop.ts`, `test-connection.ts` | Bearer JWT verified via `authenticateRequest()`. Atomic rate limiting via `ai_take_rate_slot`. AES-256-GCM encryption for BYOK keys (`api/_lib/secrets.ts`). Pinned-DNS SSRF protection (`api/_lib/secure-fetch.ts`) + `redirect: 'error'`. Mutating AI tools require explicit user confirmation (`api/ai/confirm.ts`). |
| **Control Center API (`api/control/*` — 4 Functions)** | `security.ts`, `accounts.ts`, `operations.ts`, `system.ts` dispatching 13 routes in `api/_lib/control-routes/*` | 5-layer gate (`authorizeControl`): Bearer JWT `getClaims()` -> active `owner` row in `control_roles` -> `control_take_rate_slot` -> `aal2` MFA check -> `requireRecentMfa` (15-min TOTP window) for sensitive mutations. Append-only `control_audit_events`. |
| **Supabase Postgres & Storage (`supabase/migrations/*`)** | 19 student tables, 6 AI tables, 6 analytics tables, 4 site-content tables, ` exam_catalog`, `mistake-images` & `homepage-media` buckets | `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` across all tables (`20261009193000_rate_limit_and_rls_force.sql` & `20261014080000_security_audit_hardening.sql`). Student rows restricted to `auth.uid() = user_id`. |

---

## C. Detailed Findings (`STR-NEW-01` through `STR-NEW-08`)

### [STR-NEW-01] Operator Personal Email Address Hardcoded in Committed Test Fixtures (Medium — Fixed)
- **Location:** `api/control/control-security.test.ts` (lines 148 and 310)
- **Evidence:** Hardcoded a real personal `@gmail.com` address as the owner account email in test fixtures.
- **Fix:** Replaced with `owner@example.com` and added a regression test in `src/lib/control-isolation.test.ts` scanning all files in `src/` and `api/` for personal email domains (`@gmail.com`, `@yahoo.com`, `@outlook.com`, `@hotmail.com`, `@icloud.com`).

### [STR-NEW-02] Unsanitized `unknown_event` Detail Keys & Unverified `user_id` Attribution in Analytics Ingest (Medium — Fixed)
- **Location:** `api/_lib/control-routes/analytics-ingest.ts` (lines 28–35, 73–98)
- **Evidence:** Unknown event names (`z.string().min(1).max(60)`) were passed raw into `analytics_bump_stat('unknown_event', name, count)` (`analytics_ingest_stats.detail`), allowing arbitrary characters and up to 25 distinct detail keys per batch. Additionally, `context.user_id` was not cross-checked when an `Authorization` header was supplied.
- **Fix:** Added `sanitizeUnknownEventDetail()` restricting logged unknown event names to `/^[a-z0-9][a-z0-9_.-]{0,59}$/i` (capped at 5 distinct unknown names per batch, bucketing any other input as `'malformed_event_name'`) and verified `Authorization: Bearer` tokens when present.

### [STR-NEW-03] Per-IP Rate Limiter Trusts Spoofable Leftmost `X-Forwarded-For` Value (Medium — Fixed)
- **Location:** `api/_lib/control.ts` (`clientKeyHash`, lines 61–67)
- **Evidence:** `forwarded.split(',')[0]?.trim()` read the leftmost IP in `X-Forwarded-For`, allowing a client to spoof a new IP on every request and bypass `ANONYMOUS_LIMIT` and `INGEST_RATE`.
- **Fix:** Updated `clientKeyHash()` to prefer `x-real-ip` / `x-vercel-forwarded-for` or the rightmost entry of `x-forwarded-for`.

### [STR-NEW-04] Missing Audit Log Event on Homepage Media Upload Minting (Medium — Fixed)
- **Location:** `api/_lib/control-routes/media.ts` (lines 23–42)
- **Evidence:** `mediaUploadHandler` minted signed upload URLs into the public `homepage-media` bucket and inserted into `public.site_media` without calling `recordAuditEvent`.
- **Fix:** Added `recordAuditEvent` recording the `site_media` path, kind, MIME type, and byte size.

### [STR-NEW-05] `site_content_*` Tables Missing `FORCE ROW LEVEL SECURITY` & `search_path` Hardening (Medium — Fixed)
- **Location:** `supabase/migrations/20261010120000_site_content_publishing.sql`, `supabase/migrations/20261011050608_analytics_foundation.sql`
- **Evidence:** `site_content_draft`, `site_content_published`, and `site_content_versions` enabled RLS without `FORCE ROW LEVEL SECURITY`, and `site_content_commit` / `analytics_*` functions omitted `pg_catalog` in `search_path`.
- **Fix:** Added `supabase/migrations/20261014080000_security_audit_hardening.sql`.

### [STR-NEW-06] Android CI Workflows Publish Debug-Signed APKs (`assembleDebug`) to Public GitHub Releases (Medium — Action Required on APK Branches)
- **Location:** `.github/workflows/build-apk.yml` on `apk-build-current` (`4cc7025b`) and `apk-build` (`75ae682f`); `.github/workflows/build-stracker-apk.yml` on `android-apk` (`b83468bf`)
- **Evidence:** `build-apk.yml` runs `./gradlew assembleDebug` (`android:debuggable="true"`), renames `app-debug.apk` to `Stracker.apk`, and publishes it to a public GitHub Release (`gh release create`). `android-apk` configures `server.url: 'https://dypol-stracker.vercel.app'` in `capacitor.config.ts`.
- **Remediation:** Switch `build-apk.yml` on `apk-build-current` to release-signed `./gradlew assembleRelease` (or restrict debug APKs to private workflow artifacts), remove any debug-signed public release assets, and delete stale branches `apk-build` and `android-apk`.

### [STR-NEW-07] CSP `media-src` Drift in `netlify.toml` (Low — Fixed)
- **Location:** `netlify.toml` (line 13)
- **Evidence:** `netlify.toml` lacked `media-src 'self' https://*.supabase.co;` which was added to `vercel.json` in PR #51.
- **Fix:** Synchronized `netlify.toml` CSP with `vercel.json`.

### [STR-NEW-08] Analytics Keyed Hash Fallback Couples `user_ref` to `SUPABASE_SERVICE_ROLE_KEY` (Low — Env Config)
- **Location:** `api/_lib/control-routes/analytics-ingest.ts` (`analyticsSecret`, lines 47–51)
- **Remediation:** Configure a dedicated 32-byte `ANALYTICS_HASH_SECRET` in Vercel environment variables so rotating `SUPABASE_SERVICE_ROLE_KEY` does not alter historical `user_ref` pseudonyms.

---

## D. Production Verification Matrix (`VERIFIED` vs `NOT VERIFIED IN PRODUCTION`)

| Check | Status | Details |
|---|---|---|
| **Serverless Function Count (`<= 12` Vercel Hobby limit)** | **VERIFIED IN REPO** | 12 functions total (`8` in `api/ai/*`, `4` in `api/control/*`). |
| **Control Center Isolation & PII Hygiene** | **VERIFIED IN REPO** | Covered by `src/lib/control-isolation.test.ts`. |
| **SSRF, DNS Pinning & AES-256-GCM Secret Encryption** | **VERIFIED IN REPO** | Covered by `api/_lib/secure-fetch.test.ts` and `api/_lib/secrets.ts`. |
| **Live Production HTTP Headers (`https://dypol-stracker.vercel.app`)** | **NOT VERIFIED IN PRODUCTION** | Verify post-deploy with `curl -sSI https://dypol-stracker.vercel.app`. |
| **Live Hosted Supabase RLS & Migration Application** | **NOT VERIFIED IN PRODUCTION** | Apply `supabase/migrations/20261014080000_security_audit_hardening.sql` in Supabase SQL Editor and run a two-user cross-account query check. |
| **Live Supabase Auth Dashboard Settings & Vercel Env Vars** | **NOT VERIFIED IN PRODUCTION** | Verify HIBP leaked-password protection in Supabase Auth dashboard and set `ANALYTICS_HASH_SECRET` in Vercel. |

---

## E. Final Go / No-Go Recommendation

**CONDITIONAL GO FOR PRODUCTION:** Merge this Pull Request, apply `supabase/migrations/20261014080000_security_audit_hardening.sql` in the production Supabase SQL Editor, configure `ANALYTICS_HASH_SECRET` in Vercel, and unpublish any debug-signed `Stracker.apk` (`assembleDebug`) assets from public GitHub Releases.

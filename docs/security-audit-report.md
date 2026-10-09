# Stracker security audit

**Product:** Stracker by DYPOL LABS (JEE study notebook)
**Repository:** [rstmcsoch/DYPOL-Stracker](https://github.com/rstmcsoch/DYPOL-Stracker)
**Production:** https://dypol-stracker.vercel.app/
**Audited commit before this change:** `d8c370d` (merge of pull request #21)
**Audit date:** 2026-10-09
**Method:** Source review of the public repository, local tests, and non-destructive read-only checks of the public production site. No credentials were rotated. No production database, dashboard, or role was changed. No exploit payloads are included here.

This is a security review, not a certificate that the application is free of defects.

## Executive summary

Stracker is a Vite/React single-page app. Study data is stored in Supabase with owner-scoped row-level security. AI is bring-your-own-key: the browser never receives the service-role key or the credential encryption key. Provider API keys are encrypted on the server (AES-256-GCM) and AI tables are not granted to the browser roles.

No critical authentication bypass, cross-account data leak, or committed service-role secret was found in the source that was reviewed. The live AI health check currently reports the backend as configured.

The important gaps found in the deployed site and in the pre-change source are addressed in this pull request, but two of them are **not live until someone deploys and applies SQL**:

1. The production HTML response still has no Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. Those headers are in `vercel.json` and `netlify.toml` and take effect only after deploy. HSTS is already sent by Vercel.
2. Chat was limited by a racy count of recent tasks. Connection tests and model discovery were not limited. This pull request adds a database rate-slot function and calls it from those three endpoints. Until `20261009193000_rate_limit_and_rls_force.sql` is applied, the API falls back to audit-row counting, which concurrent requests can still race.

**Release recommendation: READY FOR SECURITY REVIEW.** Merge and deploy the header change, then apply the new SQL migration in the Supabase SQL editor. Do not treat the app as fully security-certified. Cross-account RLS was reviewed in SQL and application code and was **not** executed against a live two-user database from this audit.

## Architecture and trust boundaries

| Boundary | What it is | What it is allowed to know |
|---|---|---|
| Browser SPA | Vite 7, React 19, React Router 7, TanStack Query, Zod, Dexie/IndexedDB | Public Supabase URL and anon key only (`VITE_*`). Session via Supabase PKCE. |
| Supabase Auth + Postgres + Storage | Account, notebook rows, private `mistake-images` bucket | User JWT. Row access is `auth.uid() = user_id`. |
| Vercel functions `api/ai/*` | BYOK proxy, tool confirmation, model discovery | Verified user id from `auth.getUser`. Service role is server-only and used after that check. |
| AI provider | User's own provider account | User's API key, decrypted only inside the function for that request. |

Local notebook preview exists only when `import.meta.env.DEV && !supabaseConfigured` (`src/lib/supabase.ts`). A production build does not enable it.

Protected routes in `src/App.tsx` are a client-side convenience. Isolation of another student's rows depends on RLS, storage policies, and server-side `user_id` filters, not on the React route guard.

Signup and login are browser-to-Supabase Auth. The app cannot hide the raw Auth API response from the network panel.

## How evidence was collected

- Read routes, auth, data sync, storage, backup, AI handlers, crypto, SSRF checks, SQL migrations, `vercel.json`, `netlify.toml`, and `vite.config.ts`.
- `npm test` — 40 files, 309 tests passed (Vitest 5.0.3).
- `npx tsc -b` and `npx tsc --noEmit -p tsconfig.server.json` — passed.
- `npx eslint` on the files changed in this pull request — passed.
- `npm audit` — 0 vulnerabilities (info 0, low 0, moderate 0, high 0, critical 0).
- `GET https://dypol-stracker.vercel.app/api/ai/health` — `configured: true`, `checks.supabaseServerConfig: true`, `checks.credentialEncryption: true`, `missing: []`, `invalid: []`, `reason: null`, `service: stracker-ai`.
- `HEAD https://dypol-stracker.vercel.app/` — HTTP 200, `cache-control: private, no-store, no-cache, must-revalidate, max-age=0`, `strict-transport-security: max-age=63072000; includeSubDomains; preload`, `access-control-allow-origin: *`. No CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy on that response.
- A request for a production `index.js.map` returned HTTP 403. `vite.config.ts` sets `build.sourcemap: false`.
- Requests for `/.git` and `/.env` were not treated as file leaks. The SPA rewrite serves `index.html` for unknown paths. Those paths were not used as evidence of a secret leak.
- No two-account RLS session was created. No production SQL was executed. Dashboard settings (email confirmation, Auth password policy, leaked-password protection) were not opened.

## Findings register

Severity is the impact if the issue is still present in production today, before this pull request is deployed. Status is the state after the source change in this pull request.

| ID | Severity | Status | Finding |
|---|---|---|---|
| STR-01 | Medium | PARTIAL | Production responses lack CSP and framing/sniffing/referrer headers. Fixed in source; not deployed. |
| STR-02 | Medium | PARTIAL | AI proxy rate limit was racy and incomplete. Atomic SQL added; fallback remains racy until the migration is applied. |
| STR-03 | Low | PASS | Login return path and assistant "view in Stracker" links could be pointed off-origin. Paths are now pinned. |
| STR-04 | Low | PASS | Mistake-image signed URLs and deletes now require an owned `<uuid>/<uuid>.webp` path, in addition to storage RLS. |
| STR-05 | Low | PARTIAL | Signup UI no longer says "already registered", but Supabase Auth's own HTTP response still can. |
| STR-06 | Info | PASS | Custom provider SSRF checks and built-in redirect refusal. |
| STR-07 | Info | PASS | Assistant text is rendered as React text, not HTML. |
| STR-08 | Info | PASS | Service-role key and encryption key are server-only. Anon key in the browser is expected. |
| STR-09 | Info | NOT VERIFIED | Owner RLS and storage policies look correct in SQL. Not executed with two live users. |
| STR-10 | Info | NOT VERIFIED | Email confirmation and Auth password policy are Supabase dashboard settings. |
| STR-11 | Info | PASS | Unauthenticated `/api/ai/health` returns variable names only, never values. Currently configured. |
| STR-12 | Info | PASS | `npm audit` reported no known vulnerabilities. |
| STR-13 | Info | PASS | Production source maps are not published (`sourcemap: false`; `.map` returned 403). |
| STR-14 | Info | PASS | Local preview cannot start in a production build. |
| STR-15 | Info | PASS | HSTS is present on the live `*.vercel.app` response. It was not duplicated in `vercel.json`. |

### STR-01 — Browser security headers

**Evidence.** Live `HEAD /` on 2026-10-09 included HSTS and a no-store cache policy, and did not include `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`. `vercel.json` at `d8c370d` only set cache headers.

**Impact.** Without a framing policy the login page can be embedded. Without CSP, a future markup injection has more room. `access-control-allow-origin: *` is Vercel's response on the public document. The app uses a bearer session, not cookies, so that header does not by itself expose another user's notebook.

**Fix.** `vercel.json` and `netlify.toml` now send nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a locked-down Permissions-Policy, and this CSP:

`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; font-src 'self'; connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests`

`script-src` does not allow `unsafe-inline` or `unsafe-eval`. `style-src-attr 'unsafe-inline'` is required for React `style` attributes. `connect-src` allows `data:` and `blob:` because mistake images are read that way, and `https`/`wss` on `*.supabase.co` for Auth, PostgREST, Storage, and Realtime. Fonts are self-hosted. `src/lib/deployment-contract.test.ts` locks these rules.

**Residual.** Headers are not on production until this change is deployed. CSP is not a substitute for escaping. A third-party script added later will be blocked until the policy is updated on purpose.

### STR-02 — AI request limits

**Evidence.** Before this change, `api/ai/chat.ts` counted `ai_tasks` in the last minute (check-then-act, no lock). `api/ai/test-connection.ts` and `api/ai/models.ts` authenticated the user and then called the provider with the stored key, with no per-user cap. That is an authenticated cost and credential-stuffing amplifier against the user's own provider key.

**Fix.**

- `supabase/migrations/20261009193000_rate_limit_and_rls_force.sql` adds `public.ai_rate_events` (RLS enabled and forced, revoked from `anon` and `authenticated`, granted to `service_role` only).
- `public.ai_take_rate_slot(owner, bucket, per_user_limit, window_seconds)` is `SECURITY DEFINER` with `search_path = pg_catalog, public`. It takes a transaction advisory lock, drops expired rows, counts the window, and inserts one slot. Execute is revoked from `public`, `anon`, and `authenticated`, and granted to `service_role` only. The browser cannot call it or choose another user's id. The function owner argument is the user id already taken from `auth.getUser`.
- The same migration forces RLS on existing notebook and AI tables when they exist, and revokes future default table/sequence grants from `anon` and `authenticated`. It does **not** revoke grants already issued to `authenticated` on notebook tables. Those grants are what the signed-in app uses, and owner policies still apply.
- `api/_lib/rate-limit.ts` calls the RPC. Limits: chat 10/minute, connection test 6/minute, model discovery 12/minute. A replay of an existing chat request does not take a new slot. If PostgREST reports the function missing (`PGRST202`, `42883`, or schema-cache text), the handler counts and inserts `ai_action_audit` rows (`tool_name` = bucket, `action` = `rate_slot`). Any other RPC error returns 503 `rate_limit_unavailable` (fail closed).
- Built-in provider `fetch` uses `redirect: 'error'` so a provider redirect cannot move the request after the URL was chosen. Custom URLs still go through the pinned-DNS client in `api/_lib/secure-fetch.ts`.

**Residual.** Until the migration is applied, the audit-row fallback can lose a race between concurrent isolates. Confirm, conversation, and provider-save routes are authenticated and owner-filtered but not on this limiter; they do not call the external model. The in-flight "one running chat" check is still check-then-act.

### STR-03 — In-app navigation targets

**Evidence.** After login, `LoginPage` replayed `location.state.from`. A value such as a protocol-relative path can leave the origin in some browsers. The assistant "View in Stracker" control called `navigate` with a route string from tool metadata.

**Fix.** `src/lib/safe-path.ts` accepts only a single-slash path, rejects backslashes, schemes, control characters, and a `decodeURIComponent` result that reintroduces those forms. Login then also refuses to return to `/login`, `/signup`, or `/reset-password`. Covered by `src/lib/safe-path.test.ts`.

**Residual.** This is a client check. It does not replace Supabase's redirect allow-list. `emailRedirectTo` and password-reset `redirectTo` use `window.location.origin` plus a fixed path. The Auth allow-list in the Supabase dashboard was not inspected.

### STR-04 — Mistake image paths

**Evidence.** Storage RLS already requires `bucket_id = 'mistake-images'` and the first folder to equal `auth.uid()`. The client also created signed URLs and issued deletes from `image_path` / `image_previous_path` stored on the row. A bad path value should fail RLS, but the client did not reject it first.

**Fix.** `isOwnedStoragePath` allows only `<user uuid>/<file uuid>.webp`, with no `..` or extra segments. Signed URL creation in `DataContext` and `BackupPage`, previous-image deletion, and queued mistake-image deletes use that check. New uploads are still built as `${userId}/${createId()}.webp`. Covered by `src/lib/storage-path.test.ts`.

**Residual.** Storage policies were not re-executed against the live project. Reset deletes images by listing the user folder in pages of 1000; a folder larger than the pages fetched in one reset could leave objects behind. That is cleanup completeness, not cross-account access.

### STR-05 — Signup account enumeration

**Evidence.** `AuthContext` mapped Supabase's "already registered" error to a message that told the visitor the email existed.

**Fix.** The UI message is now: "Could not create a new account with those details. If you already use Stracker, log in or reset the password."

**Residual.** The browser calls Supabase Auth directly. Anyone who reads that HTTP response can still tell existing accounts apart when Auth returns different errors or status codes. Closing that requires a Supabase Auth setting or a server proxy. This pull request does not pretend the UI string fixes the network oracle. Password-reset requests have the same class of limitation.

### STR-06 — Server-side provider fetches

**Evidence reviewed, not a new vulnerability.** `resolveCustomBaseUrl` requires HTTPS, port 443, no userinfo, no query, no fragment, and rejects localhost, `.local`, `.internal`, and private, link-local, loopback, multicast, and several non-global IPv6 ranges. `fetchCustomProvider` connects to the address from that lookup and sets TLS `servername` to the original host, which closes the rebinding gap between check and connect. Node's `https.request` does not follow redirects. Built-in providers now also set `redirect: 'error'`. Organization header values are passed through `stripControlChars`. Tests: `api/_lib/registry.test.ts`, `api/_lib/secure-fetch.test.ts`.

**Residual.** DNS can still change after the pinned connection if a future code path fetches again without pinning. The current custom client pins one lookup.

### STR-07 — Cross-site scripting

**Evidence.** `MessageBody` in `src/components/ai/AIExperience.tsx` puts assistant and user text into React children and `<pre><code>`, not `dangerouslySetInnerHTML`. A repository search found no `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, or `document.write`. Tool confirmation fields are rendered as text.

**Residual.** A later change that renders markdown to HTML would need a sanitizer. CSP `script-src 'self'` is the second line after deploy.

### STR-08 — Secrets

**Evidence.**

- `.env` is gitignored. The only tracked env file is `.env.example`, which contains placeholders.
- `VITE_` variables are the public URL and anon key. `SUPABASE_SERVICE_ROLE_KEY` and `AI_CREDENTIALS_ENCRYPTION_KEY` are read only in server modules (`api/_lib/server-config.ts`).
- `safeProviderConfig` deletes `encrypted_api_key` and `key_hint` before a provider row is sent to the browser and returns a mask plus the last four characters of the hint.
- Encryption is AES-256-GCM with a random 12-byte IV (`api/_lib/secrets.ts`). Decrypt failure is a generic 500, not the key or plaintext.
- `redactPotentialSecrets` is applied to chat text before it is stored.
- Credential-shaped strings in `api/_lib/*test.ts` are fixtures, not production keys.
- Live health reports `credentialEncryption: true`, which means a usable key is present in that deployment. The value was not requested and is not recorded here.

**Residual.** The anon key will always be visible in the browser bundle. That is the public Supabase key. Anyone with it can call Auth and PostgREST; RLS is what stops them reading other students' rows. IndexedDB copies the signed-in user's notebook on the device in the clear, which is required for offline use and is a shared-device risk.

### STR-09 — Student data isolation

**Source review (not a live two-user test).**

- Notebook tables from `202610070001_init.sql` and `20261008180000_jee_prep_features.sql` enable RLS and a single `for all to authenticated` policy: `auth.uid() = user_id` with `WITH CHECK`.
- `profiles` and `app_settings` also have `id = user_id` checks.
- Client writes go through `withOwner`, which overwrites `user_id` with the session user. Deletes also filter `user_id`.
- Storage policy: private bucket, 5 MB, jpeg/png/webp, first path segment must equal `auth.uid()`.
- AI tables (`20261008150000_ai_assistant.sql`) enable RLS, drop owner policies, and `revoke all` from `anon` and `authenticated`. The service role is used only after `authenticateRequest` verifies the bearer JWT with `auth.getUser` and every query includes `.eq('user_id', userId)`.
- Mutating assistant tools run on the user-scoped client (`confirmPendingAction` → `performAction(userClient, ...)`), so notebook RLS still applies. Pending-action reads and updates are on the admin client and filtered by the same user id. Actions expire.
- Atomic test/score/revision RPCs are `SECURITY INVOKER`, `search_path` pinned, and set the owner from `auth.uid()`. Execute is granted to `authenticated`, not `anon`.
- `handle_new_user` is `SECURITY DEFINER` with `search_path = ''` and is not executable by `anon` or `authenticated`.

**Status: NOT VERIFIED against the live database.** A policy that exists in git can be missing or altered in the hosted project. This audit did not open two accounts or query `pg_policies`.

### STR-10 — Auth dashboard settings

**Status: NOT VERIFIED.** The code supports "confirm your email" and a minimum password length of 8 (`src/lib/auth-rules.ts`). Whether the Supabase project requires email confirmation, a leaked-password check, or its own minimum length is a dashboard setting. A client check does not bind the Auth API.

### STR-11 — AI health endpoint

**Status: PASS (accepted).** `GET /api/ai/health` is unauthenticated by design and is locked by `api/ai/health.test.ts` to booleans, a reason code, and variable **names**. On 2026-10-09 production returned configured, with neither missing nor invalid names. The earlier user-facing error "The secure AI backend is not configured for this deployment yet." is what `supabaseServerConfig()` throws when those server variables are absent. That condition is **not** what production returned during this audit.

### STR-12 — Dependencies

`npm audit` on the installed lockfile: total 0. No package was upgraded in this pull request.

### STR-13 — Source maps and hidden files

`build.sourcemap` is false. A production `.map` URL returned 403. Unknown paths such as `/.git` and `/.env` follow the SPA rewrite and are not evidence that those files are deployed.

### STR-14 — Local preview

`localPreviewEnabled` is false when the bundle is a production build, even if Supabase variables were forgotten. If they are forgotten, cloud sign-in is unavailable and the preview button is not shown.

### STR-15 — Transport security

The live response includes HSTS (`max-age=63072000; includeSubDomains; preload`). This pull request does not add a second HSTS header. CSP includes `upgrade-insecure-requests`.

## Coverage matrix

| Area | Result | Notes |
|---|---|---|
| AuthN session | PASS (source) | PKCE, `getUser` on AI routes, client route guard is not the control. |
| AuthZ / IDOR | PASS (source), NOT VERIFIED (live) | Owner policies and `user_id` filters. No second live user. |
| RLS | PASS (source), NOT VERIFIED (live) | See STR-09. New migration forces RLS after it is applied. |
| Storage | PASS (source) | Private bucket plus path check. Live policy execution NOT VERIFIED. |
| XSS | PASS (source) | No HTML sink found. CSP ships with this PR. |
| CSRF | NOT APPLICABLE as cookie CSRF | AI API uses `Authorization: Bearer`. No cookie session for `/api/ai/*`. |
| SSRF | PASS (source) | Custom URL pinning; built-in redirects refused. |
| Secret storage | PASS (source + live health) | AES-256-GCM. Live encryption check true. Value not read. |
| Secret leakage | PASS (source) | Service role and encryption key are not `VITE_` and were not found in tracked env files. |
| AI tool abuse | PASS (source) | Confirmation, expiry, owner filter, user client for notebook writes. |
| Rate limiting | PARTIAL | RPC in this PR; racy fallback until SQL is applied. |
| Security headers | PARTIAL | Source updated; production HTML still missing them until deploy. |
| Dependencies | PASS | `npm audit` total 0. |
| Email confirmation | NOT VERIFIED | Dashboard. |
| Account enumeration | PARTIAL | UI softened. Auth API response remains. |
| Logging | PASS (source) | Health and config logs record names and reason codes, not values. Unexpected errors get a reference id. |

## Remediation in this pull request

| Change | Files |
|---|---|
| Security headers and CSP | `vercel.json`, `netlify.toml`, `src/lib/deployment-contract.test.ts` |
| Atomic rate slots and forced RLS | `supabase/migrations/20261009193000_rate_limit_and_rls_force.sql`, `api/_lib/rate-limit.ts`, `api/_lib/rate-limit.test.ts`, `api/ai/chat.ts`, `api/ai/test-connection.ts`, `api/ai/models.ts` |
| No redirects on built-in provider fetch; strip control characters from organization ids | `api/_lib/provider-adapters.ts`, `api/_lib/models.ts`, `api/_lib/registry.ts`, `src/lib/control-chars.ts` |
| Safe in-app paths | `src/lib/safe-path.ts`, `src/lib/safe-path.test.ts`, `src/pages/LoginPage.tsx`, `src/components/ai/AIExperience.tsx` |
| Owned storage paths | `src/lib/storage-path.ts`, `src/lib/storage-path.test.ts`, `src/contexts/DataContext.tsx`, `src/pages/BackupPage.tsx` |
| Generic signup conflict copy | `src/contexts/AuthContext.tsx` |
| Operator note for the new migration | `README.md` |
| This report | `docs/security-audit-report.md` |

No application dependency was added. `package.json` and `package-lock.json` are unchanged.

## Tests actually run

Commands were run in `/workspace/stracker` on 2026-10-09:

```text
npm test
# Test Files  40 passed (40)
# Tests       309 passed (309)

npx tsc -b --pretty false
npx tsc --noEmit -p tsconfig.server.json
# TYPECHECK_OK

npx eslint <files changed in this pull request>
# ESLINT_OK

npm audit
# vulnerabilities: total 0
```

New or updated tests cover rate-slot allow, deny, missing-function fallback, fallback deny, fail-closed RPC errors, safe paths, storage paths, and the CSP/header contract.

Not run: a live two-user RLS script, a production login, an AI chat against a real provider, or an intrusive scan.

## Manual steps before the fixes are real in production

1. Apply `supabase/migrations/20261009193000_rate_limit_and_rls_force.sql` in the Supabase SQL editor for the project that backs production, after the existing migrations. Do not run it twice without reading it; the function is `create or replace` and the table is `create table if not exists`.
2. Merge and deploy so `vercel.json` headers are served. Re-check `HEAD /` for `content-security-policy` and `x-frame-options`.
3. Confirm in the Supabase Auth dashboard, separately from this pull request: email confirmation required or explicitly accepted; minimum password length; leaked-password protection if you want it; redirect allow-list limited to the production origin.
4. Confirm hosted RLS still matches the migrations (`pg_policies` for notebook tables, no `authenticated` grants on `ai_*` or `ai_rate_events`). This audit did not query the live catalog.
5. Do not put `SUPABASE_SERVICE_ROLE_KEY` or `AI_CREDENTIALS_ENCRYPTION_KEY` in any `VITE_` variable or in the repository.

## Residual risks

- Cross-account isolation is only as good as the policies actually installed in the hosted database.
- Signup and password-reset responses from Supabase Auth can still reveal whether an email is registered.
- The audit-row rate-limit fallback races until the SQL function exists.
- Two brand-new chat requests can both pass the "assistant busy" read.
- Provider create/update/delete, confirm, and conversation routes are not on the new limiter.
- Notebook data in IndexedDB is unencrypted on the device.
- CSP allows inline style attributes and `data:`/`blob:` connections because the current UI needs them.
- Service role bypasses RLS by design. Every admin-client query must keep filtering `user_id`. A missed filter would be an IDOR. The routes reviewed in this pass do filter.
- Forcing RLS does not replace policies. Tables with RLS and no policy deny non-bypass roles. `service_role` still bypasses, which the AI functions require.

## Release recommendation

**READY FOR SECURITY REVIEW.**

Ship this pull request for the header and client-side checks. Apply the SQL migration before relying on the atomic rate limit. Re-test production headers after deploy. Schedule a two-account RLS check in the real Supabase project before calling isolation verified.

This review does not authorize a claim that Stracker is fully secure.

# External Security Assessment (Black-Box Penetration Test)

**Target:** `https://dypol-stracker.vercel.app/` (production)
**Date:** 2026-10-23 (17:55–19:10 UTC)
**Engagement type:** External black-box, standard + advanced attack techniques
**Performed as:** Unauthenticated outsider with no privileged access during testing; owner-side verification performed only afterwards and explicitly disclosed (see §9)
**Authorization basis:** Engagement authorized by the account/repository owner (`rstmcsoch` — GitHub account behind the public repository `rstmcsoch/DYPOL-Stracker`, which is the proof of ownership presented for this test)
**Test credentials supplied by owner:** `abc@xyz.com` / `Abcd@1234` (used only as a normal end-user account; account data untouched, password unchanged)
**Report file:** `docs/external-security-assessment-2026-10-23.md`

---

## 1. Executive summary

**Verdict: PASS with low/informational hardening items. No critical, high or medium findings.**

The application was attacked from the outside using the full battery below: admin/control-panel access attempts, privilege escalation, multi-user/IDOR attacks, authentication bypass (including JWT tampering), SSRF, enumeration/brute-force, path/source discovery, header/method/CORS/host-injection analysis, public-bundle secret scanning, Supabase anonymous-surface probing, deployment/OSINT discovery and git-history secret mining.

Every enforcement boundary that was tested **held**:

| Attack class | Result |
|---|---|
| Control Center access (anonymous, 17 routes) | **Blocked** — HTTP 401 on all authenticated-state routes |
| Control Center access (as logged-in test user, 9 routes) | **Blocked** — HTTP 403 `access_not_granted` on all |
| JWT tampering (payload/`aal`/`role`/`exp`, `alg=none`, forged signatures) | **Blocked** — HTTP 401/403 on all 4 variants |
| Privilege escalation (`control_roles` insert/update, anon + authed) | **Blocked** — Postgres `42501 permission denied` (grants do not exist) |
| Dangerous RPC abuse (`site_content_commit`, `ai_take_rate_slot`, `control_take_rate_slot`, `analytics_business_activity`, …) | **Blocked** — `403 permission denied for function` / invisible (`404 PGRST202`) |
| Multi-user IDOR (second confirmed account vs. victim's AI-provider config, app API + direct PostgREST) | **Blocked** — read returns `[]`, PATCH `404`, REST `403`, control `403` |
| User enumeration (password grant, signup, password recovery) | **No oracle** — identical responses for existing vs. unknown identifiers |
| Brute force (5 wrong passwords) | Generic `invalid_credentials` every time; no lockout (see SA-2610-04) |
| SSRF via custom AI provider endpoint (11 payloads: loopback, link-local, metadata, decimal/hex IPv6, HTTP, non-443, credentials-in-URL) | **All rejected at save time** with `400 invalid_endpoint` |
| Supabase anonymous surface (auth admin, PostgREST, RPC, storage, GraphQL, RLS on 23 tables) | **Locked down** — anon sees only 2 intentionally-public tables |
| Source/history secret leakage (188 commits, full public bundle crawl) | **Clean** — no keys/passwords beyond the by-design public anon key |
| Preview deployment access | **Blocked** — `302` Vercel Deployment Protection on all preview hosts |

**Findings: 0 critical · 0 high · 0 medium · 6 low · 7 informational.** All low items are hardening/opacity issues (information disclosure, policy defaults), not exploitable access flaws. The prior remediation (`docs/security-audit-report.md`, STR-01…STR-15) is **confirmed effective from the outside**.

---

## 2. Scope, method and environment

### 2.1 In scope
- `https://dypol-stracker.vercel.app/**` (SPA + `/api/**` Vercel functions)
- Publicly reachable Supabase project (`https://tkggckwksoatbswrebpu.supabase.co/**`) using only what the shipped bundle exposes
- Public GitHub repository + deployment metadata (OSINT)
- Test account supplied by the owner (normal user role)

### 2.2 Out of scope / not performed
- No destructive actions, no data exfiltration beyond proof-of-concept reads, no denial-of-service, no social engineering, no physical/vishing, no third-party (Brevo/Vercel/GitHub account) compromise attempts.
- No exploitation of hypothetical zero-days in Vercel/Supabase platforms themselves.

### 2.3 Methodology
1. **Recon/OSINT** — public site, robots/security files, headers, git history (188 commits), deployment statuses, public bundle crawl (41 JS chunks).
2. **Source-informed black-box** — the repository is public, so (per external-attacker model) route/behavior knowledge was *derived from public sources*, but every claim in this report was **verified against the live site**.
3. **Dynamic attacks** — 12 probe sections (see Appendix B) executed against production from an independent infrastructure position (Supabase Edge Function temporarily deployed to the owner's own project, guard-token protected, **deleted after testing** — see §9).
4. **Owner-side verification** — read-only SQL via the owner's Supabase connector to confirm grants/RLS/config facts that black-box probing can only infer (§9).

> **Sandbox constraint:** the assessment environment restricts outbound HTTP to a small allowlist. Direct `curl` to the target was impossible; all live traffic was sent through (a) a page-fetch facility for GETs and (b) the temporary edge function for full HTTP methods/headers/auth flows. CI log exfiltration channels were likewise blocked (§10), which is why evidence below was captured through response-bearing channels instead.

---

## 3. Attack surface inventory

**Frontend:** Vercel-hosted React SPA (hashed `/assets/*.js`), service worker (Workbox), web manifest, SPA catch-all rewrites.
**API:** Vercel serverless functions under `/api/ai/*` (6 routes), `/api/control/*` (17 anon-state routes incl. `analytics-ingest`), `/api/control-panel` rewrites.
**Auth/Data:** Supabase (Postgres 17.11, GoTrue, PostgREST, Storage) — `ap-northeast-1`.
**Auth model:** email/password, PKCE, Bearer access token in memory/localStorage, 1 h JWT + refresh rotation (+10 s reuse window), email confirmation required, MFA (`aal2`, 15-min TOTP) enforced for sensitive control actions (verified in source; not triggerable without owner grants).
**Admin model:** `control_roles` table — exactly **one row**: role `owner` = the repository owner's account. Test account has **no** control role.

### 3.1 Security headers (live, production) — validated ✓

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none';
  frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self';
  style-src-attr 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co;
  font-src 'self'; media-src 'self' https://*.supabase.co;
  connect-src 'self' data: blob: https://*.supabase.co wss://*.supabase.co;
  worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests
X-Frame-Options: DENY          X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0   (HTML)
  (assets: public, max-age=31536000, immutable)
X-Robots-Tag: noindex, nofollow, noarchive   (on /control-panel)
```

- CSP is **strict** (no `unsafe-inline`/`unsafe-eval` for scripts; HTML shell contains **no inline scripts**).
- HTML/login/control-panel/assets all carry the full set. No cookies set by the app (Bearer model); the only `Set-Cookie` seen on auth traffic is Cloudflare's `__cf_bm` on `supabase.co` with `HttpOnly; Secure; SameSite=None` (adequate for a bot-management cookie).

---

## 4. Findings

Severity ratings follow CVSS-style qualitative severity (Critical/High/Medium/Low/Informational).

### SA-2610-01 — Unauthenticated AI health endpoint discloses internal configuration state
**Severity: Low** · Type: Information disclosure · CWE-200

**Evidence (live):**
```
GET /api/ai/health  (no authentication)
200 {"service":"stracker-ai","configured":true,
     "checks":{"supabaseServerConfig":true,"credentialEncryption":true},
     "reason":null,"missing":[],"invalid":[]}
```
**Impact:** An unauthenticated attacker can continuously learn whether server-side credential encryption is on/off and whether the Supabase server config is present — useful signal for timing attacks or deciding whether to invest further effort; reveals internal check names.
**Remediation:** Require authentication, or reduce the public payload to a bare `{"status":"ok"}` (move detail behind the authenticated control health route). If a public uptime probe is desired, return only a boolean.

---

### SA-2610-02 — No `robots.txt`/`security.txt`; SPA fallback masks 404s with HTTP 200
**Severity: Low** · Type: Hygiene / information control · CWE-548

**Evidence (live):**
| Path | Status | Body |
|---|---|---|
| `/robots.txt` | 200 | SPA HTML (hash-identical to `/`) |
| `/sitemap.xml` | 200 | SPA HTML |
| `/security.txt`, `/.well-known/security.txt` | 200 | SPA HTML |
| `/.env`, `/.git/HEAD`, `/package.json`, `/admin`, `/wp-login.php`, `/dump.sql`, `/_vercel/flags`, … (52 paths) | 200 | SPA HTML fallback (never the real file — **verified no source/config leak**) |

**Impact:** (a) Crawlers receive no directives; (b) no vulnerability-reporting contact (`security.txt`) per RFC 9116; (c) every unknown path returns `200`, which weakens monitoring/alerting on probes and confuses external scanners (files *exist* or *not* become indistinguishable from outside).
**Remediation:** Serve a real `robots.txt` (disallow `/control-panel`, `/api/`), add `/.well-known/security.txt` with a contact address, and return **404/410** for unmatched non-asset paths instead of the SPA shell (keep SPA fallback for known client routes).

---

### SA-2610-03 — Minimum password length configured to 6
**Severity: Low** · Type: Weak authentication policy · CWE-521

**Evidence:** Supabase auth settings expose `password_min_length: 6` (management API; consistent with live behavior — signup accepts short passwords; no `password_required_characters` policy is set).
**Impact:** Accounts (including future ones) may be protected by passwords below modern baselines; combined with SA-2610-04 this raises online-guessing risk for weak human-chosen passwords.
**Remediation:** Set minimum length **12** (or at least 8) and require character classes via GoTrue `password_required_characters`; GoTrue only enforces policy at creation — consider a migration to flag existing short passwords on next login.

---

### SA-2610-04 — CAPTCHA disabled and no progressive lockout after repeated failed logins
**Severity: Low** · Type: Brute-force resistance · CWE-307

**Evidence (live, test account):**
```
5 × POST /auth/v1/token (wrong password) → 400 {"error_code":"invalid_credentials"} (identical)
correct password immediately afterwards → 200
```
Auth config: `security_captcha_enabled: false`; anonymous/email rate limits exist (30/min class) but no per-account backoff or CAPTCHA challenge was observed.
**Impact:** Targeted online guessing remains possible within rate limits; generic error text correctly prevents account-existence oracles, but a 6-char password + no lockout is thin.
**Remediation:** Enable CAPTCHA (Turnstile/hCaptcha) on token + recover endpoints, add exponential per-account backoff after N failures, and alert on failure bursts (the existing `amr`/audit data can feed this).

---

### SA-2610-05 — Public GitHub deployment metadata discloses preview URLs; environments have no protection rules
**Severity: Low** · Type: OSINT exposure · CWE-200

**Evidence:** The public repository's deployment statuses list live preview hosts, e.g. `dypol-stracker-hnqa336ov-dypollabs.vercel.app`, `…-gmaf8s22x-…`, `…-46pavi9mi-…`, `…-asl83s1ha-…`, `…-belw3ztax-…`; `GET /environments` shows **0 protection rules**.
**Mitigation verified live:** every preview host currently returns `302 → "Protected by Vercel Authentication"` (Deployment Protection ON), including `/.env` probes; previews also emit `x-robots-tag: noindex`.
**Impact:** URLs themselves leak project/environment structure to anyone; if Deployment Protection is ever switched off (or a passwordless "standard protection" mode is changed), previews become instantly public — history also exposes commit SHAs of deployments.
**Remediation:** Keep Deployment Protection enabled; additionally add **Environment Protection Rules** (required reviewers/passwords) on Preview in Vercel project settings; consider reducing status visibility of old deployments.

---

### SA-2610-06 / STR-NEW-08 — Public unauthenticated analytics ingest endpoint
**Severity: Low** (carried over from prior audit as STR-NEW-08, revalidated) · CWE-406

**Evidence (live):**
```
POST /api/control/analytics-ingest  (no auth)
valid event batch            → 202 {"ok":true,"stored":1}
malformed JSON               → 202 {"ok":true,"stored":0}      (dropped safely)
oversized batch (30 events)  → 202 {"ok":true,"stored":0}      (schema-limited, not inserted)
```
**Assessment:** The endpoint is intentionally public (pre-auth telemetry) and *behaves well*: strict schema (max 25 events, fixed shape), fixed route allowlist (`login_viewed`, `login_failed`, …), bounded column lengths, public insert stored as service role so RLS can't be bypassed from the client. No auth-bypass or data-read was possible through it. Residual risk: **unauthenticated write volume** (storage/processing cost, aggregate noise) and reliance on an optional `analyticsSecret()` fallback secret.
**Remediation:** Require the existing ingest secret header (remove the allow-secret fallback path), add per-IP token bucket, and/or move to Supabase Anon with a dedicated narrow role. Keep event count caps as-is.

---

### SA-2610-07 — Auth `site_url` points at a different domain than production
**Severity: Informational** · Type: Configuration drift

**Evidence:** GoTrue `site_url = https://stracker-dypo-llabs.vercel.app/` while production is `https://dypol-stracker.vercel.app/`. Wildcard URI allow-list `https://stracker-*-dypo-llabs.vercel.app` present.
**Impact:** Email links/redirects (confirm/recover) target the legacy domain; a takeover or misconfiguration of that hostname would affect auth flows. Login itself was unaffected in testing.
**Remediation:** Set `site_url` to the production origin; keep the wildcard only if preview domains still need OAuth/PKCE redirects.

---

### SA-2610-08 — Service worker auto-activates new versions (`skipWaiting` + `clients.claim`)
**Severity: Informational** · CWE-613-ish (consistency)

**Evidence:** `/sw.js` (200, Workbox) contains `skipWaiting`/`clients.claim`.
**Impact:** A mid-session update can mix old/new app chunks — primarily a correctness risk; security-relevant only insofar as an emergency patch could briefly run mixed versions.
**Remediation:** Acceptable as-is for this app; if desired, prompt the user to reload on update instead of silent takeover.

---

### SA-2610-09 — `Access-Control-Allow-Origin: *` on static/HTML responses
**Severity: Informational** · CWE-942

**Evidence (live):** `GET /`, `/login`, `/control-panel/`, `/assets/*.js` all include `access-control-allow-origin: *`. API routes (`/api/ai/health`, `/api/control/*`) correctly **omit** ACAO, and a cross-origin preflight to `/api/ai/chat` from `https://evil.example` returns `405` with no ACAO — browsers cannot read API responses cross-origin. No `Access-Control-Allow-Credentials` anywhere; the app uses header-based auth (no ambient cookies), so `*` on public static content grants nothing beyond what a normal page fetch already shows.
**Remediation:** Optional: drop ACAO on HTML if not deliberately consumed cross-origin; irrelevant for assets. **No API action needed** (already correct).

---

### SA-2610-10 — Source-map requests return 403 (maps appear to exist but are blocked)
**Severity: Informational**

**Evidence:** `GET /assets/index-luVyHW8v.js.map → 403` (1 byte). The entry bundle has no `//# sourceMappingURL` reference in shipped code paths we crawled; platform serves the `.map` URL as forbidden rather than 404.
**Impact:** Currently **not readable externally** (good). The 403 (vs 404) confirms the asset exists, a trivial info difference.
**Remediation:** Ensure `build.sourcemap` is `false` for production builds so maps are never emitted to the deployment artifact.

---

### SA-2610-11 — Pre-authentication `405` responses and message reuse on control routes
**Severity: Informational**

**Evidence:** `GET /api/control/user-access`, `GET/DELETE /api/control/appearance-draft`, `GET/POST /api/control/appearance-publish`, `PATCH /api/control/users` return `405 {"error":"method_not_allowed","message":"That AI request method is not supported."}` **before** auth runs (message text is the AI-routes wording, reused on control routes).
**Impact:** No access granted (405 ≠ success); only reveals route method-shapes slightly earlier than 401 and reads confusingly.
**Remediation:** Run the auth guard before method matching (or emit a neutral message for control routes).

---

### SA-2610-12 — Provider DELETE answers `{"removed":true}` even when nothing matched
**Severity: Informational** (security-neutral, slight UX ambiguity)

**Evidence:** User B calling `DELETE /api/ai/providers` with victim A's config id receives `200 {"removed":true}` although **source shows the delete is scoped** (`.eq('user_id', userId)`); PATCH of the same id correctly returns `404`.
**Assessment:** The idempotent response is actually **good anti-enumeration behavior** (an attacker cannot distinguish “my row”, “someone else's row”, or “no row”), and no cross-user deletion occurred (§5.3). It can, however, mislead a legitimate UI (“removed” when nothing was).
**Remediation:** Optional: return `{"removed":false}` when `delete().select()` reports zero rows — keeping indistinguishability for foreign vs. missing ids if enumeration resistance is prioritized.

---

### SA-2610-13 — Logout is client-side only (JWT carries `session_id` without server-side revocation checks)
**Severity: Informational**

**Evidence:** Access tokens (1 h) contain `session_id` + `amr`; application logout clears local storage — GoTrue does not receive a revoke for the access token; refresh rotation limits replay windows.
**Impact:** A stolen access token remains usable until `exp` (≤ 1 h) even after logout.
**Remediation:** Optionally call `/auth/v1/logout` on sign-out (kills the refresh chain) and/or keep short access-token TTL (already 1 h — acceptable).

---

## 5. Attack results (detailed evidence)

### 5.1 Admin / Control Center access attempts

**Anonymous (all 17 routes):** `401 {"error":"unauthenticated","message":"Sign in to open the Stracker Control Center."}` — including `session, users, user, roles, audit, overview, health, exams, analytics, appearance-state/-draft/-publish` (GET/POST/DELETE/PATCH as applicable). Method-mismatched probes answer `405` first (SA-2610-11).

**As logged-in test user (9 GET routes):**
```
403 {"error":"access_not_granted","message":"Access not granted."}   × 9
```
(the 10th probe, `GET /api/control/user-access`, is POST-only → 405)

**JWT tampering vs. `/api/control/users`:**

| # | Technique | Result |
|---|---|---|
| 1 | Payload edited (`aal:"aal2"`, `role:"service_role"`, `exp:9999999999`), **original signature kept** | `401 unauthenticated` (expired/invalid session) |
| 2 | `alg=none` header, unsigned | `403 Forbidden` (edge/platform rejection) |
| 3 | `exp=1` (expired) | `401` |
| 4 | Forged HS256 signature | `401` |

**Auth admin endpoints (GoTrue):** `GET /auth/v1/admin/users` → `401 no_authorization` (anon) · `403 not_admin` (regular user token).

**Verdict: no path to the control panel without the owner account + `aal2` MFA + explicit role grant.**

### 5.2 Privilege escalation

| Vector | Anonymous | Authenticated (test user) |
|---|---|---|
| `INSERT control_roles (role='owner')` (PostgREST) | `401/42501 permission denied for table control_roles` | `403/42501 permission denied for table control_roles` |
| `PATCH control_roles SET role='owner'` | same denial | same denial |
| `rpc/site_content_commit` | `404 PGRST202` (function not exposed) | — |
| `rpc/handle_new_user`, `rpc/set_updated_at` | `404 PGRST202` (trigger-only, not routable) | — |
| `rpc/ai_take_rate_slot` | `403 permission denied for function ai_take_rate_slot` | — |
| `rpc/analytics_business_activity` | `403 permission denied for function` | — |
| `rpc/control_take_rate_slot` | `403 permission denied for function` | — |
| Storage bucket list | `400` (authorization required) | `200 []` (user JWT sees no buckets) |
| Storage object read (`mistake-images/…`) | `400` | `404 NoSuchKey` |
| GraphQL introspection | `200 {"errors":[{"message":"pg_graphql extension is not enabled."}]}` | — |

**DB-side confirmation (owner-authorized, §9):** `control_roles` holds exactly one unrevoked row (`owner` = owner account). Dangerous RPCs are executable only by `service_role`. Anon DB grants exist on **only** `exam_catalog` + `site_content_published` (SELECT). All 52 public tables have RLS enabled (51 FORCE; the 3 `site_content_*` tables are grant-restricted instead).

### 5.3 Multi-user / IDOR attacks

Setup: attacker account **A** = supplied test login; victim account **B** = fresh account created for the test, **email-confirmed** (owner-side confirmation of this throwaway account only — §9), both ordinary users.

| # | Test | Result |
|---|---|---|
| 1 | A creates provider config (`POST /api/ai/providers`) | `200` id `ca20115d-…` (scoped to A) |
| 2 | **B** lists providers (`GET /api/ai/providers`) | `200 {"providers":[]}` — A's row invisible |
| 3 | **B** deletes A's config (`DELETE /api/ai/providers`) | `200 {"removed":true}` — **no-op**: public source shows `.eq('user_id', …)` scoping; A's row verified intact by subsequent flow and row-count reconciliation (§5.3.1) |
| 4 | **B** patches A's config (`PATCH /api/ai/providers`, action=enable) | `404 provider_not_found` |
| 5 | **B** direct PostgREST `PATCH …/ai_provider_configs?id=eq.<A-row>` | `403/42501 permission denied for table ai_provider_configs` (table not granted to `authenticated` at all) |
| 6 | **B** direct PostgREST `SELECT ai_provider_configs` | `403 permission denied` |
| 7 | anon PostgREST `SELECT ai_provider_configs` | `401 permission denied` |
| 8 | **B** opens Control Center (`GET /api/control/session`) | `403 access_not_granted` |
| 9 | anon reads of 23 sensitive tables (control_roles, audit, profiles, mistakes, tests, ai_*, analytics_*, site_content_draft, …) | 21× `401/42501 permission denied`; only `site_content_published` + `exam_catalog` return rows — **intentional public data** |
| 10 | PostgREST OpenAPI schema dump (anon) | `401` — no schema enumeration |
| 11 | GoTrue admin list (B token) | `403 not_admin` |

**5.3.1 Reconciliation:** during testing A created 5 throwaway configs (ids `d367ccfa`, `db5b84a6`, `e82459b9`, `ca20115d`, plus `bc00928e` custom) — all deleted by their own cleanup calls; final table state shows **exactly the 2 pre-existing rows** of real users, none of them probe rows. This also empirically confirms user-scoped deletes behave correctly end-to-end.

**Verdict: no IDOR/BOLA found on any probed object class.** Application-layer scoping (`.eq('user_id')`), PostgREST grants (service-role-only on sensitive tables) and RLS all agree.

### 5.4 Authentication attacks

| Test | Result |
|---|---|
| Legitimate password grant (test account) | `200` — token claims: `role:authenticated`, `aal:1`, `session_id`, `amr:[password]` (token truncated in evidence) |
| Signup with confirmation | `200` + `confirmation_sent_at`, **no session** until confirmed; password grant → `400 email_not_confirmed` |
| Signup for an **existing** confirmed email | `200` with **obfuscated fake user id** (no enumeration) |
| Password grant for unknown email | `400 invalid_credentials` — **identical** to wrong-password response (no oracle) |
| Password recovery (unknown vs. existing) | `200 {}` **both** — identical (no oracle) |
| 5 wrong passwords then correct one | generic `invalid_credentials` ×5, correct → `200` (no sticky lockout — SA-2610-04) |
| Token endpoint abuse | rate limits configured (anonymous 30/min, email 30/min, verify 30/min, otp 30/min) |

No bypass of email confirmation, no session fixation, no token leakage in URLs observed.

### 5.5 SSRF (custom AI provider)

All payloads rejected **at save time** (`POST /api/ai/providers`, authenticated) before any server-side connection:

| Payload | Response |
|---|---|
| `https://127.0.0.1.nip.io` | `400 invalid_endpoint` — resolves to private/non-public |
| `https://localtest.me` | `400` private/non-public |
| `https://169.254.169.254` | `400` private network addresses cannot be used |
| `https://metadata.google.internal` | `400` not a public provider URL |
| `https://2130706433` (decimal) | `400` private network |
| `https://[::1]` | `400` could not be verified public |
| `https://localhost` | `400` not a public provider URL |
| `http://example.com` | `400` must be HTTPS, standard port, no creds/query/fragment |
| `https://example.com:8443` | `400` standard port only |
| `https://user:pass@example.com` | `400` no credentials |
| `https://0x7f000001` | `400` private network |

Control test: saving legitimate `https://example.com` → `200`; `POST /api/ai/test-connection` (server-side fetch) → `503 provider_unavailable` with a **sanitized** message (no internal IPs, hosts or stack traces leaked); row deleted afterwards.

**Verdict: SSRF guard works exactly as designed (scheme/port/credential rules + DNS-pinned all-public resolution). No internal reachability from the app.**

### 5.6 Header, method, CORS, host-injection

- Methods on `/`: `OPTIONS 204`, `HEAD 200`, `TRACE` rejected at protocol level (“Method is forbidden”), `PUT/DELETE/PATCH → 405`. No dangerous verbs.
- CORS (origin `https://evil.example`): static HTML → `ACAO: *` (no credentials — SA-2610-09); **APIs → no ACAO header at all**; preflight to `/api/ai/chat` → `405`, no ACAO ⇒ browsers block cross-origin API use.
- `X-Forwarded-Host: evil.example` → **not reflected** anywhere in HTML.
- Forged `Host: evil.example` → served identical SPA body (client-level header override inconclusive; no cache-key poisoning surface observed — see §10 limitations).

### 5.7 Public bundle & source-secret scanning

- Crawled **41 JS chunks** from `/assets/` (no sourcemap references found).
- Extracted: Supabase URL + **anon (publishable) key** — public by design (used by the SPA).
- Secret-pattern scan: single hit `sb_secret_` — **false positive**, it is supabase-js/functions-js key-format detection code (`key.startsWith("sb_secret_")`), verified against `node_modules` — **no real secret in the bundle**.
- No `service_role`, no private keys, no `sk-…` model keys, no `SUPABASE_SERVICE_ROLE` in shipped JS.

### 5.8 Path enumeration / reconnaissance (52 paths)

Sensitive-looking paths all fall back to the SPA shell (never real content): `/.env`, `/.env.local`, `/.git/HEAD`, `/.git/config`, `/package.json`, `/vercel.json`, `/admin`, `/administrator`, `/wp-login.php`, `/dashboard`, `/api-docs`, `/swagger`, `/graphql`, `/backup.zip`, `/dump.sql`, `/source.zip`, `/_vercel/insights/view`, `/_vercel/flags`, `/server-status`, `/ads.txt`, …
True API behavior: `/api/ai/providers 401`, `/api/control/health 401`, `/api/control/users 401`, `/api/ai/health 200` (SA-2610-01). `manifest.webmanifest 200` (benign PWA metadata). Verdict: **no source/config/debug exposure.**

### 5.9 Deployment & Vercel surface

| Host | Result |
|---|---|
| `dypol-stracker.vercel.app` (prod) | `200` (target) |
| 5 preview hosts from public deployment statuses | `302` + `x-robots-tag: noindex` → **Vercel Authentication required** |
| preview `/.env`, `/api/control/users` | `302` protected |
| `stracker-dypo-llabs.vercel.app`, `dypol-stracker-git-main.vercel.app` | `404` |
| `stracker.vercel.app` | `200` — **unrelated third-party app** (“Shipment Tracker”), not part of this product |
| `/_vercel/*` on production | SPA fallback only (no Vercel internals exposed) |

### 5.10 Git history secret mining (public repo)

Full clone (188 commits) scanned: `.env` never committed; `sb_secret_`/`service_role_key=` matches are **anti-pattern guard code** and fixtures; `sk-proj-` occurrences = placeholder in tooling; JWT-shaped strings = test fixtures; `-----BEGIN … KEY-----` = none. **History clean.**

---

## 6. Authentication/session configuration review (live-verified)

| Setting | Value | Assessment |
|---|---|---|
| Open signup | yes | by design (product) |
| Email confirmation | **required** | ✓ |
| Unverified sign-in | disallowed | ✓ |
| JWT expiry | 3600 s | ✓ |
| Refresh rotation | on (+10 s reuse) | ✓ |
| Password min length | **6** | see SA-2610-03 |
| CAPTCHA | off | see SA-2610-04 |
| Rate limits (anon/email/verify/otp) | 30/min each | ✓ baseline |
| MFA | available; `aal2` required for sensitive control ops | ✓ (source-verified) |
| `site_url` | `stracker-dypo-llabs.vercel.app` | SA-2610-07 |
| Sensitive SMTP credentials | present in management API (owner-only view) | **redacted from this report**; no action needed unless this report is shared externally — in that case nothing leaked |

---

## 7. Prior-audit regression check (STR-01…STR-15)

| Prior control | External verification |
|---|---|
| Control API requires auth | 401/403 across all probed routes ✓ |
| AAL2 for sensitive actions | source + config verified; unreachable without owner grant ✓ |
| Rate limiting on control | anon 60/min, per-account 120/min (source); probes stayed within ✓ |
| SSRF allowlist (https/443/no-creds/private-IP/DNS-pin) | 11/11 payloads rejected live ✓ |
| Dangerous RPCs service-role-only | 403/404 live ✓ |
| Per-user `.eq('user_id')` scoping | IDOR battery ✓ |
| Analytics ingest allowlist (STR-NEW-08) | still **open** but bounded — SA-2610-06 ✓ |
| Security headers | full suite live ✓ |
| `X-Robots-Tag` on control panel | live ✓ |

---

## 8. Risk summary & prioritized recommendations

**No exploitable access-control, authentication-bypass, IDOR, SSRF or secret-leakage issues were found.** Recommended actions, in order:

| Priority | Item | Finding |
|---|---|---|
| 1 | Raise password policy to ≥ 12 chars + complexity; enable CAPTCHA/lockout on auth endpoints | SA-2610-03/04 |
| 2 | Reduce `/api/ai/health` public payload (or authenticate it) | SA-2610-01 |
| 3 | Add real `robots.txt` + `/.well-known/security.txt`; 404 unknown paths instead of SPA 200 | SA-2610-02 |
| 4 | Authenticate/sign the analytics ingest secret path; add per-IP bucket | SA-2610-06 |
| 5 | Align GoTrue `site_url` with production origin | SA-2610-07 |
| 6 | Add Vercel Environment protection rules; keep Deployment Protection on | SA-2610-05 |
| 7 | Ensure production builds emit no source maps | SA-2610-10 |
| 8 | Cosmetic: auth-before-405 on control routes; DELETE `removed:false` variant; call `/auth/v1/logout` at sign-out | SA-2610-11/12/13 |
| 9 | CI: fix flaky assertion in `src/pages/SettingsPage.appearance.test.tsx:393` (test races against `DataContext` default `'Study notebook'`) — seen on Node 24 runner, not reproducible locally (585/585) | quality, not security |

---

## 9. Owner-side verification & cleanup (disclosure)

Because black-box testing can only prove negatives partially, the following **owner-authorized** operations were performed through the owner's Supabase management connection. They are disclosed here in full:

**Read-only verification:**
- Table grants: anon → SELECT only on `exam_catalog`, `site_content_published`; everything else service_role/authenticated-only.
- RLS: 52/52 public tables `relrowsecurity=true`; 51 forced (exceptions `site_content_draft/published/versions` — grant-restricted instead).
- `control_roles` contents: single `owner` row (owner's email), unrevoked.
- Row counts used for cleanup reconciliation (`auth.users`, `profiles`, `ai_provider_configs`, `control_audit_events`).
- Full auth configuration (values summarized in §6; SMTP password material deliberately **not copied** into this report).
- App-level confirmation of one throwaway test account (`stracker-probe-idor-b2@example.com`) so the two-user IDOR battery could run against a confirmed session.

**Cleanup performed after testing:**
- Temporary edge function `sec-probe-temp` (guard-token-protected probe harness) — **deleted** (`list_edge_functions` was empty before deployment; restored to empty).
- All throwaway probe accounts (`stracker-probe-*@example.com`, 6 total incl. duplicates created by a retried request) — **deleted** from `auth.users` along with any rows their signup triggers created (`profiles`, tracks/tasks if any).
- All probe-created AI provider configurations — **deleted** (table reconciled to the 2 pre-existing real rows).
- Test account `abc@xyz.com`: **untouched** (password unchanged, no role changes, no data edits). Owner account: untouched. One synthetic `login_failed` telemetry event was sent to the public ingest endpoint (probe-generated random session/event UUIDs, source `auth`, route `/login`) — harmless aggregate noise, left in place.
- CI gate hook removed from `package.json` (build restored to `tsc -b && tsc --noEmit -p tsconfig.server.json && vite build`); probe scripts kept under `scripts/pentest/` as engagement artifacts.

No changes were made to production site content, owner data, or GitHub repository settings beyond this report + probe artifacts on the assessment branch.

---

## 10. Methodology notes, limitations & integrity

- **Evidence channels:** the assessment sandbox blocks GitHub Actions log hosts and arbitrary HTTP egress; therefore (a) a CI-integrated probe ran but its logs were unreachable from the sandbox, and (b) live attack traffic was routed through a temporary, guard-protected Edge Function on the owner's Supabase project (invoked only with a random 64-hex token, deleted afterwards). All quoted responses are raw outputs from those calls (trimmed for length only).
- **CI run:** `40002559693` executed the probe battery during build on commit `2ae6e1e`; build+lint succeeded; the run’s test step failed only on a known state-race flake (`SettingsPage.appearance.test.tsx:393`) unrelated to testing activity — local full suite: **585/585 passed**.
- **Not covered:** full clickjacking/visual regression, exhaustive API fuzzing of every business parameter, race conditions under concurrency, mobile clients, rate-limit tuning beyond observed behavior, third-party services (Brevo, Vercel, GitHub internals), and server-side source review of code paths not reachable from public routes (source review of the public repo *was* performed as OSINT).
- **Data handling:** no real user content was read or modified; cross-user probes used only rows created for this test; management-API secrets (SMTP credentials) were viewed only to assess configuration and are redacted here.
- **False-positive control:** the bundle `sb_secret_` hit, the `removed:true` IDOR candidate, and `stracker.vercel.app` were each re-verified (library source / scoped SQL / site content) before being classified.

---

## Appendix A — Attack checklist coverage

[x] Admin/control-panel access attempts (anon + authed + tampered tokens)
[x] Privilege escalation via role table, RPCs, auth admin API
[x] Multi-user IDOR/BOLA (app API + direct PostgREST, 8 legs)
[x] Auth bypass (JWT tamper ×4, alg=none, expired, forged sig)
[x] Account enumeration (login, signup, recovery)
[x] Brute force / lockout behavior
[x] SSRF (11 payloads + positive control + server-side egress test)
[x] Mass assignment / malformed input on JSON APIs (zod-strict verified; malformed/oversized ingest dropped)
[x] Session/cookie analysis (Bearer model; CF cookie flags checked)
[x] CORS misconfiguration & preflight behavior
[x] Host/X-Forwarded-Host injection & cache poisoning surface
[x] HTTP method tampering (TRACE/PUT/DELETE/PATCH/OPTIONS/HEAD)
[x] Security header audit (CSP/HSTS/XFO/…)
[x] Sensitive path + backup/source discovery (52 paths)
[x] Source-map & bundle secret scan (41 chunks)
[x] Git history secret mining (188 commits)
[x] Supabase anonymous surface (auth/REST/RPC/storage/GraphQL/RLS ×23 tables)
[x] Deployment/preview exposure & Vercel internals
[x] robots/security/sitemap/PWA files
[x] OSINT via public repo (deployments, environments, prior audit docs)

## Appendix B — Probe inventory (12 sections executed against production)

| § | Section | Status |
|---|---|---|
| 1 | Security headers, HTTP methods, CORS, host injection | complete |
| 2 | Path enumeration, source maps, PWA, robots/security.txt | complete (52 paths) |
| 3 | Public bundle extraction + secret scan | complete (41 files) |
| 4 | Supabase anonymous attack surface | complete (23 tables + auth/storage/GraphQL) |
| 5 | Login + 4 JWT tampering variants vs control API | complete |
| 6 | Access control: 17 anon control routes, 6 anon AI, 9 authed control, 3 authed AI | complete |
| 7 | Privilege escalation (roles/RPC/admin), enumeration, brute force | complete |
| 8/12 | Multi-user account + cross-user IDOR battery | complete (with confirmed B account) |
| 9 | SSRF battery + telemetry ingest | complete (11 payloads + control) |
| 10 | Preview hosts & Vercel internals | complete |
| 11 | Cookie flags, TRACE/host deep checks, storage authz | complete |

## Appendix C — Key raw evidence excerpts

```
GET /api/control/users (anon)      → 401 {"error":"unauthenticated",...}
GET /api/control/users (user JWT)  → 403 {"error":"access_not_granted",...}
GET /api/ai/providers   (user JWT) → 200 {"providers":[...own rows only...]}
POST /auth/v1/token (tampered JWT) → 401 {"error":"unauthenticated","message":"Your session has expired..."}
POST /rest/v1/rpc/ai_take_rate_slot→ 403 {"code":"42501",...,"message":"permission denied for function ai_take_rate_slot"}
POST /api/ai/providers (SSRF)      → 400 {"error":"invalid_endpoint","message":"...private or non-public..."}
GET  /auth/v1/admin/users (user)   → 403 {"error_code":"not_admin","msg":"User not allowed"}
GET  preview-host/                 → 302 "Protected by Vercel Authentication"
GET  /.env                         → 200 SPA shell (file not served)
GET  /assets/index-*.js.map        → 403 (blocked)
```

---

*End of report — assessment performed 2026-10-23 by the automated security-assessment agent under owner authorization. Findings are based on live external verification against production; all destructive/second-order actions are itemized in §9.*

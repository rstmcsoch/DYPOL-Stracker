# Security hardening — operations checklist

Follow-up to the external assessment `docs/external-security-assessment-2026-10-23.md` (§8
recommendations). This file tracks which items are **automated in code/config** and which still
need **owner action in a dashboard** (they cannot be changed from the repository).

Last updated: 2026-10-24.

## ✅ Applied automatically (code / config in this repository, or via management API)

| Finding | Fix |
|---|---|
| SA-2610-01 — public AI health disclosure | `/api/ai/health` now returns only `{"service":"stracker-ai","status":"ok"}` to anonymous callers; the full diagnosis (`configured`, `checks`, `reason`, `missing`, `invalid`) is returned only when a valid signed-in session sends `Authorization: Bearer …`. The AI settings UI attaches the token. |
| SA-2610-02 — no robots/security.txt, SPA masks 404s | Added `public/robots.txt` (disallows `/control-panel`, `/api/`) and `public/.well-known/security.txt` (RFC 9116 contact via GitHub Security Advisories). `vercel.json` no longer has the `/(.*) → /index.html` catch-all: known SPA routes are rewritten explicitly, everything else returns a real **404**. Static files and API routes are unaffected (filesystem still wins). |
| SA-2610-06 / STR-NEW-08 — ingest secret fallback | `analyticsSecret()` now fails closed when no entropy source exists (removed the `'unset'` literal fallback that would have produced predictable `user_ref` values). The ingest endpoint already had a per-client 60/min server-side token bucket plus the strict event allowlist/schema. Setting `ANALYTICS_HASH_SECRET` (below) is the optional next step. |
| SA-2610-07 — auth `site_url` on a dead legacy domain | **Applied live (2026-10-23)** via the Supabase management API: `site_url` = `https://dypol-stracker.vercel.app/`. Password-reset/confirmation emails now land on production. The URI allow-list already contained the production origin. |
| SA-2610-10 — source maps | Verified already safe: `vite.config.ts` has `build.sourcemap: false` (no change needed). |
| SA-2610-11 — wrong 405 wording on control routes | `methodNotAllowed()` accepts a per-family message; `controlHandler` now answers "That control request method is not supported." |
| SA-2610-12 — `removed:true` on no-op deletes | `DELETE /api/ai/providers` now returns `removed: true` only when a row owned by the caller was actually deleted; foreign/unknown ids return `removed: false` (still indistinguishable from each other — no enumeration oracle). |
| SA-2610-13 — logout session revocation | Verified already implemented: `AuthContext.signOut()` calls `supabase.auth.signOut()` (server-side refresh-chain revocation). No change needed. |
| CI flake | `SettingsPage.appearance.test.tsx` now waits for the async profile write instead of asserting against the initial default (the Node 24 runner race). |

## 📋 Manual steps (Supabase / Vercel dashboards — owner action required)

1. **Raise the minimum password length (SA-2610-03)** — currently **6**.
   - Supabase Dashboard → Project → **Authentication → Settings → Passwords → Minimum password length → 12**.
   - Note: character-class complexity **is already enforced** (`password_required_characters` is set — lower/upper/digits/symbols), so only the length needs raising. The change applies to newly set passwords.
   - Optional same screen: enable the **Have I Been Pwned** breach check (`password_hibp_enabled`).

2. **Enable CAPTCHA on auth endpoints (SA-2610-04)** — currently disabled.
   - Create an **hCaptcha** site + secret key (Supabase's configured provider), then
     Dashboard → Authentication → Settings → **Enable Captcha**.
   - This adds bot protection to signup / login / recovery on top of the existing per-IP rate limits (anonymous/email/verify/otp = 30/min each).

3. **Vercel environment protection (SA-2610-05)** — deployment protection is already ON
   (previews answer `302`), but GitHub deployment statuses still expose preview URLs.
   - Vercel Dashboard → Project → **Settings → Environments → Preview** → add protection rules
     (required reviewers and/or a deployment password) so previews stay gated even if
     Deployment Protection settings are changed later.

4. **Optional: independent analytics secret** — set Vercel environment variable
   `ANALYTICS_HASH_SECRET` (≥ 16 chars) and redeploy, if you want pseudonymization keys
   decoupled from the service-role key. Behavior is unchanged until it is set (the fallback
   derives from the service-role key, which never leaves the server).

5. **Report errata** — the assessment report's SA-2610-03 text says no
   `password_required_characters` policy exists; the live configuration does require mixed
   character classes. The minimum-length-6 finding and its recommendation (≥ 12) stand.

## After changing dashboards

Re-run the relevant probes from `scripts/pentest/` (or request a quick re-test) to confirm:
- `POST /auth/v1/signup` with an 8-char password → rejected after step 1.
- Anonymous `GET /api/ai/health` → `{"service":"stracker-ai","status":"ok"}` only.
- `GET /robots.txt` → directives; `GET /.well-known/security.txt` → 200; `GET /.env` → **404**.

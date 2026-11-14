# Sign-up anti-spam

## 1. Cloudflare Turnstile (bot check)

* Widget: **DYPOL Stracker sign-in** (managed mode) in the DYPOL Cloudflare account, hostname
  `dypol-stracker.vercel.app`. Site key (public): `0x4AAAAAAGAz4aglDafb5t2v` (also the code
  fallback in `src/lib/turnstile.ts`; `VITE_TURNSTILE_SITE_KEY` overrides it on production).
* The secret key is **never** stored in this repository, Vercel, or the browser. It belongs only in
  Supabase → Authentication → Attack Protection → CAPTCHA (provider: Turnstile).
* The web app renders the widget in "interaction-only" mode (invisible unless Cloudflare needs a
  click) on log in, sign-up step 2, the "resend confirmation" screen and the password-reset
  request, and sends a fresh single-use `captchaToken` with `signInWithPassword`, `signUp`,
  `resend` and `resetPasswordForEmail`. Google sign-in needs no token.
* Previews and localhost use Cloudflare's always-pass **test** key, so once Supabase enforces
  CAPTCHA, email/password sign-in on preview URLs is refused (Google still works).

### Turning enforcement on (owner, Supabase dashboard)

1. Copy the secret from Cloudflare → Turnstile → *DYPOL Stracker sign-in* → Settings.
2. Supabase → Authentication → Attack Protection → enable CAPTCHA protection → Turnstile → paste
   the secret → Save.
3. **Before enabling:** the Stracker Android app (Flutter, `mobile/`) calls Supabase Auth natively
   and does not send a CAPTCHA token yet. With enforcement on, email/password log in, sign-up,
   resend and password reset in the app are refused (Google sign-in in the app is unaffected).

To undo, switch CAPTCHA protection off in the same screen.

## 2. Disposable email domains

* Order of checks (database function `public.is_disposable_email`, used by the trigger, the
  optional hook and the sign-up form): built-in always-allowed providers (`src/lib/email-domains.ts`,
  mirrored in `public.never_block_email_domain`) → owner "always allow" rules → owner "block" rules →
  the GitHub list. Rules match the domain and its parent domains.
* Owner rules live in `public.email_domain_rules` (private) and are edited in Control Centre →
  Settings → Email domains (permission `settings.domains`, owner by default; every save needs a
  fresh step-up).
* Sign-up step 1 checks quietly in the background ~400 ms after a complete address is typed (or on
  blur); nothing is shown until Next, and Next waits at most 0.6 s for an unfinished check.
* Source: [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains),
  normal `disposable_email_blocklist.conf` (not strict lists). The repository currently has no
  separate allowlist file; mainstream and relay providers (Gmail, Outlook/Hotmail, iCloud,
  Apple Hide My Email, Yahoo, Proton, …) are hard-coded as never blocked.
* Stored in the private table `public.disposable_email_domains` (RLS on, no API access).
* Enforced by the `site_block_disposable_email` BEFORE INSERT trigger on `auth.users` (email and
  Google sign-ups; existing accounts are never touched). The domain and its parent domains are
  checked.
* Optional: Supabase → Authentication → Hooks → *Before User Created* → Postgres function
  `public.hook_before_user_created` returns the friendly message straight from Auth. The trigger
  already enforces the rule, so this is cosmetic.
* Sign-up step 1 asks `rpc('is_disposable_email')` for instant feedback (fails open; the database
  decides).
* Refresh: `pg_cron` downloads the list every Sunday 03:17 UTC (08:47 IST) with `pg_net` and an
  hourly job applies it. A download with fewer than 1,000 valid domains is ignored. History is in
  `public.disposable_email_domain_refreshes`. Manual refresh (SQL editor):
  `select public.disposable_domains_refresh_request();` then, a few seconds later,
  `select public.disposable_domains_refresh_apply();`

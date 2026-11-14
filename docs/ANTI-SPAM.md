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
* Sources (merged, ~108k domains; normal lists only, never the stricter variants):
  * [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains)
    `disposable_email_blocklist.conf` (~10k, conservative, hand-reviewed);
  * [disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains)
    `domains.txt` (~108k, aggregated and updated daily; added after `pcgamecard.com`, a temp-mail
    domain missing from the first list, got through on 14 Nov 2026);
  * [7c/fakefilter](https://github.com/7c/fakefilter) `txt/data.txt` (~11k, scraped daily from temp-mail sites).
  Also evaluated and not used (Nov 2026): wesbos/burner-email-providers (last update Jul 2026,
  lists duck.com and anonaddy.com), FGRibreau/mailchecker (lists relay services such as
  simplelogin.com and duck.com), amieiro/disposable-email-domains (no licence, lists
  privaterelay.appleid.com and simplelogin.com), groundcat/disposable-email-domain-list (weekly,
  ~19k, mostly covered by the chosen lists), ivolo/disposable-email-domains (stale since 2025).
  Mainstream and relay providers (Gmail, Outlook/Hotmail, iCloud, Apple Hide My Email, Yahoo,
  Proton, …) are hard-coded as never blocked, and the owner's "Always allowed" rules win over
  every list.
* Stored in the private table `public.disposable_email_domains` (RLS on, no API access).
* Enforced by the `site_block_disposable_email` BEFORE INSERT trigger on `auth.users` (email and
  Google sign-ups; existing accounts are never touched). The domain and its parent domains are
  checked.
* Optional: Supabase → Authentication → Hooks → *Before User Created* → Postgres function
  `public.hook_before_user_created` returns the friendly message straight from Auth. The trigger
  already enforces the rule, so this is cosmetic.
* Sign-up step 1 asks `rpc('is_disposable_email')` for instant feedback (fails open; the database
  decides).
* Refresh: `pg_cron` downloads all three lists daily at 03:17 UTC (08:47 IST) with `pg_net`
  and an hourly job applies the batch once every source has answered. Each source must pass a
  floor (1,000 valid domains; 20,000 for `domains.txt`). If every source passes, the table is fully
  synced; if any fails, new domains are only added (nothing removed); if all fail, nothing changes.
  History (one row per source) is in `public.disposable_email_domain_refreshes`. Manual refresh:
`select public.disposable_domains_refresh_request();` then, a few seconds later,
  `select public.disposable_domains_refresh_apply();`

### Why there is no MX check

An MX lookup cannot run inside the database insert (Postgres has no synchronous DNS; `pg_net` is
asynchronous), so it would need an extra Vercel function (the Hobby plan is at its 12-function
limit) and would add latency to every sign-up. It also would not have helped: temp-mail domains
such as `pcgamecard.com` publish real MX records, while legitimate domains often share mail hosts
(Google Workspace, ImprovMX, registrar forwarding), so MX-host matching gives false positives.
Email confirmation and the merged lists cover this better.

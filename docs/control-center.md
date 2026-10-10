# Stracker Control Center

The Control Center is a private administration console for DYPOL Stracker. It is served at
`/control-panel/` from the same Vercel deployment as the app, and it reuses the existing Supabase
Auth accounts. It is not linked from the public site, the student dashboard, or any sitemap, and
every console path is sent with `X-Robots-Tag: noindex, nofollow, noarchive`.

Status of this document: it describes the code in the repository. Items marked **Awaiting
configuration** have not been run against the production Supabase project or the Vercel
deployment.

## Access model

- **Authentication:** the existing Supabase Auth sign-in. The console does not create its own login.
- **Authorization:** a server-controlled `public.control_roles` row. Client metadata, profile fields,
  localStorage, and email matching alone never grant access. The table is readable and writable only
  by the `service_role` key; `anon` and `authenticated` have no grants and no policies.
- **Roles:** `owner`, `administrator`, `support`, `analyst`. Access is denied by default. Only
  `owner` is implemented end to end today; the other three are stored and displayed, but their
  permission sets are not yet wired (see "Not implemented").
- **MFA:** a verified TOTP factor is mandatory. Every data endpoint requires `aal2`. Privileged
  actions (suspension, CSV audit export) also require a TOTP verification within the last 15 minutes,
  so a long-lived session cannot perform them silently.
- **Idle timeout:** 20 minutes of inactivity; a warning appears 2 minutes before expiry.
- **Rate limits:** 120 API calls per account per minute; 60 anonymous calls per hashed IP per
  minute; at most 20 denied-attempt audit rows per account per 10 minutes. Raw IP addresses are
  never stored.
- **Audit:** every privileged action, denial and failure writes a row to `public.control_audit_events`.
  Summaries are sanitized: keys that look like tokens, passwords, codes, cookies, keys, links or
  emails are dropped, and values are limited to short scalars.

## Owner provisioning (one time, operator-run)

The owner is the existing account `dypollabs@gmail.com`. The bootstrap script does not create,
verify, or reset accounts, and it does not touch profile, settings, or study data. It fails if the
account does not exist or if more than one account matches the email.

Required environment, in the operator's shell only (never in the repository or a `VITE_` variable):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role secret, used only by this process |
| `CONTROL_OWNER_EMAIL` | Optional; defaults to `dypollabs@gmail.com` |

```bash
npm run control:provision-owner:dry-run   # verify the target account, no writes
npm run control:provision-owner           # grant, or confirm an existing grant
```

The script is idempotent. Running it again reports the existing grant and writes nothing new.
Apply the migration first (`supabase/migrations/20261009210000_control_center_admin.sql`). A
rollback is provided in `supabase/rollbacks/20261009210000_control_center_admin.down.sql`; it removes
only the admin objects.

**Awaiting configuration:** the migration has been checked only against an in-memory PGlite
Postgres, not the production database.

## First sign-in and TOTP enrollment

1. Open `/control-panel/` and sign in with the owner account through the normal Stracker sign-in.
2. The console shows the enrollment screen. Scan the QR code with an authenticator app, or enter
   the manual key. Confirm with a six-digit code.
3. The console then requires a fresh code on each new sign-in (`aal2`).

## MFA recovery (no recovery codes)

The console deliberately has no recovery-code flow, because a reusable code would be a second
credential to protect. If the owner loses the authenticator:

1. If a second verified factor exists, sign in with it.
2. Otherwise, a person with Supabase project access removes the TOTP factor for that user using
   Supabase's Auth administration tools, then the owner re-enrols at the next sign-in. Confirm the
   exact dashboard path against the current Supabase documentation before relying on it; it has not
   been exercised in this project.
3. Record the recovery in the audit log through a note in your operations log. Do not share the
   owner password in chat or tickets.

## Environment variables for the deployment

Server (Vercel, Production and Preview as appropriate; never `VITE_`):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Browser (existing, unchanged): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

The health endpoint reports the result of each check, plus the deployed commit and environment name that Vercel provides. It never returns key values.

## Operating the console

- **Overview:** counts come from the database for the selected UTC window (today, 7 days, or 30
  days). A window with no data shows zeros, not estimates.
- **Users:** search, filter, and open a detail page. Suspension requires a reason of at least 10
  characters, the target's exact email, and a fresh TOTP. The owner cannot suspend themselves, and
  an active owner or administrator cannot be suspended through the console.
- **Audit log:** filter by outcome, action, or target. CSV export requires a fresh TOTP.
- **Security center:** the MFA status of the current session and recent denied attempts.
- **System health:** database, auth, and configuration checks, with the deployed commit when Vercel
  provides it.

## Not implemented yet

Administrator, Support and Analyst permission sets; feature flags; announcements; exam, subject
and chapter configuration; email and authentication operations; analytics beyond the overview;
settings; global search beyond the account launcher (Ctrl+K). These are intentionally absent from
navigation until they work.

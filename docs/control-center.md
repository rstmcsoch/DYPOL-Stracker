# Stracker Control Center

The Control Center is a private administration console for DYPOL Stracker. It is served at
`/control-panel/` from the same Vercel deployment as the app, and it reuses the existing Supabase
Auth accounts. It is not linked from the public site, the student dashboard, or any sitemap, and
every console path is sent with `X-Robots-Tag: noindex, nofollow, noarchive`.

Status of this document: it describes the code in the repository. Items marked **Awaiting
configuration** have not been run against the production Supabase project or the Vercel
deployment.

## Access model

- **Authentication:** the existing Supabase Auth sign-in. The console has **no login portal of its
  own**. Opening any `/control-panel/*` address without a normal Stracker session (never signed in,
  signed out, idle sign-out, storage cleared, expired session) redirects to the homepage `/`, where
  the person signs in like any student (password or Google). A signed-in account without an active
  role is redirected to its normal dashboard (also `/`) with no message, title or hint that a console
  exists. Only an active role holder reaches the authenticator step. The role is checked by Supabase
  user id, so password and Google sign-ins of the same account (Supabase links identities that share
  a verified email to the same user) are treated identically. These redirects are a convenience: every
  console API route verifies the session, the role and `aal2` on the server regardless.
- **Authorization:** a server-controlled `public.control_roles` row. Client metadata, profile fields,
  localStorage, and email matching alone never grant access. The table is readable and writable only
  by the `service_role` key; `anon` and `authenticated` have no grants and no policies.
- **Roles:** `owner`, `administrator`, `support`, `analyst`. Access is denied by default. Only
  `owner` is implemented end to end today; the other three are stored and displayed, but their
  permission sets are not yet wired (see "Not implemented").
- **MFA:** a verified TOTP factor is mandatory. Every data endpoint requires `aal2`. Privileged
  actions (suspension, CSV audit export) also require a TOTP verification within the last 15 minutes,
  so a long-lived session cannot perform them silently.
- **Idle timeout:** 20 minutes without pointer, keyboard, scroll or touch activity in the console
  signs the operator out. A warning dialog with a live countdown appears 2 minutes before expiry;
  it offers "Stay signed in" (counts as activity) and "Sign out now". Sessions are never extended
  silently: only a real interaction or that explicit choice resets the timer. Sign-out is also
  available at any time from the account menu (the "OW" button, top right; keyboard-operable).
- **Rate limits:** 120 API calls per account per minute; 60 anonymous calls per hashed IP per
  minute; at most 20 denied-attempt audit rows per account per 10 minutes. Raw IP addresses are
  never stored.
- **Audit:** every privileged action, denial and failure writes a row to `public.control_audit_events`.
  Summaries are sanitized: keys that look like tokens, passwords, codes, cookies, keys, links or
  emails are dropped, and values are limited to short scalars. See "Audit events" below for the
  exact catalogue and for what is deliberately *not* in the audit log.

## Audit events

The actor on every row is the server-verified session user; the request body never names the
actor. Outcomes are `success`, `denied` (policy refused the request) and `failed` (the request
was allowed but could not be completed). The catalogue is defined once in
`src/lib/control-audit-catalog.ts` and shared by the API and the console filter.

| Action | Written when | Outcomes |
| --- | --- | --- |
| `owner.provisioned` | The provisioning SQL grants the first owner (written by the migration, not the API). | success |
| `control.access` | **success:** the first granted console request of a session (one row per session, not per request, keyed on the session id). **denied:** a signed-in account was refused for `access_not_granted`, `mfa_required` (no `aal2`) or `reauthentication_required`. Denials are capped at 20 rows per account per 10 minutes. | success, denied |
| `user.viewed` | An operator opened an account detail page. | success |
| `user.suspend` / `user.restore` | A sign-in restriction was applied or lifted. **denied** rows record refused attempts (`owner_protected`, `self_action_blocked`, stale MFA). | success, denied, failed |
| `audit.export` | A CSV export was requested. The summary holds the filters used (never row contents). A refused export (stale MFA) is `denied`; a database failure is `failed`. | success, denied, failed |
| `content.publish` | An owner published the saved Appearance draft to the live site (one row per publish). Summary: version before and after, and the number of changed fields. A refused publish (stale MFA) is `denied`; invalid draft, no changes, or a database failure is `failed`. | success, denied, failed |
| `content.restore` | An owner published an earlier version as a new live version. Summary: restored version, version before and after. | success, denied, failed |
| `student_layout.publish` / `student_layout.restore` | An owner published (or restored) the Student Dashboard Editor layout for all student workspaces. Summary: version before and after and the changed areas (component ids, `navigation`, `tokens`); never student data. Stale MFA is `denied`; an invalid draft, no changes or a database failure is `failed`. | success, denied, failed |

Not in the audit log, by design:

- **Authenticator (TOTP) code checks.** They happen inside Supabase Auth, so pass/fail detail is in
  the Supabase Auth logs. The console records the consequence instead: `control.access` success at
  `aal2`, or a denial for `mfa_required` / `reauthentication_required`.
- **Audit-filter validation failures, rate-limit decisions and backend errors.** These go to the
  structured server log (`api/_lib/diagnostics.ts`; event names `control_audit_filter_invalid`,
  `control_audit_write_failed`, `control_rate_limit_unavailable`, `control_role_lookup_failed`,
  `control_backend_not_configured`) so a malformed request cannot flood the audit log or recurse
  into it. Rate-limited requests get HTTP 429 and no row. They are visible in the Vercel function logs.
- **Anonymous requests.** Unauthenticated calls are rate-limited per hashed IP and rejected with
  401 without an audit row (there is no verified actor to record).
- **Draft saves and discards** in Appearance. Drafts are private, owner-only and replaced on each save; only the publish and restore that makes them live is audited.
- **Successful read-only pages** other than account detail (`Overview`, `Users` list, `Roles`,
  `Security`, `Health`). Reading aggregate counts is covered by the per-session `control.access` row.

## Dates, times and time zones

- **Storage:** every timestamp is stored in UTC (`timestamptz`), and the API always returns ISO-8601
  UTC strings (`…Z`).
- **Windows and date filters:** "Today", "7 days", "30 days" and the audit `From`/`To` dates are
  whole calendar days in the viewer's IANA zone. The browser sends `tz=<IANA zone>`; the server
  validates it (`Intl` zone check, falls back to UTC if missing or invalid) and converts each
  calendar day to exact UTC instants with DST and midnight handled by the Intl calendar, not by
  adding 24 hours. Queries are half-open (`>= start`, `< end`), and the response echoes the
  resolved `firstDay`, `lastDay` and `timezone`, so the label and the query can never disagree.
- **Display:** the console shows times in the viewer's zone by default and names the zone on every
  page (status line, table header, footer, filter summary). A **Local / UTC** switch on the Overview
  and Audit log pages changes the whole console, without storing anything in the browser.
- **Labels:** windows are shown as inclusive day ranges ("Oct 4 – Oct 10"), relative times
  ("5 min ago") carry the full timestamp as a tooltip, and the CSV export has `occurred_at_utc`
  (ISO UTC), `occurred_at_local` and `time_zone` columns, so a row is never ambiguous.

## Owner provisioning

The owner assignment was provisioned in the existing `public.control_roles` table. The browser
cannot grant or revoke a role. Do not run a separate owner bootstrap script or apply a duplicate
`admin_*` schema migration.

## First sign-in and TOTP enrollment

1. Sign in to Stracker normally (homepage → Log in, with password or Google), then open `/control-panel/`.
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

- **Overview:** counts come from the database for the selected window (today, 7 days, or 30 days,
  as calendar days in the display zone). Each figure is labelled with its period: account totals
  are all-time, "Active" means accounts whose last sign-in falls inside the window. The page
  refreshes every 60 seconds while visible and when the tab regains focus, and shows when the data
  was fetched and how long the database took; a failed refresh keeps the last good figures and
  says so. A window with no data shows zeros, not estimates. Account cards link to the matching
  Users view (`?status=verified|unverified|suspended`).
- **Users:** search, filter, and open a detail page. Suspension requires a reason of at least 10
  characters, the target's exact email, and a fresh TOTP. The owner cannot suspend themselves, and
  an active owner or administrator cannot be suspended through the console.
- **Audit log:** filter by action (every catalogued action), target account id, calendar-day range
  and outcome. The URL, the visible filters, the query and the CSV export share one filter model:
  only non-default values are sent, so the first load issues no filter parameters at all. The server
  still rejects anything it cannot validate (HTTP 400 with a `field:<name>` hint, which the page
  shows against that control; it is logged to the server log, not the audit log). "Clear filters"
  resets the controls, the URL and the request together. CSV export requires a fresh TOTP, uses
  exactly the current filters, and is disabled until the current query has succeeded.
- **Sensitive changes** (`user-access`) validate the request body before checking the fresh-MFA
  window, so a malformed request returns 400 rather than prompting for a code.
- **Security center:** the MFA status of the current session and recent denied attempts.
- **System health:** database, auth, and configuration checks, with the deployed commit when Vercel
  provides it.

## Appearance and theme

**Control Center theme.** Light, Dark or System, chosen in the top bar. Dark is the default and matches
the original console. The preference is stored only on this browser (`stracker-control-center-theme`),
is read before the first render, and is not shared with the public website or the notebook, whose
themes are unaffected. System follows the device setting while the console is open.

**Appearance (owner only).** Edits the words shown on the public homepage, header and footer, and the
notebook's menu labels. Sections that are built and working:

- **Overview:** live version, draft status, and links to each editor.
- **Public website:** searchable homepage, header and footer copy. Each field shows its default, the
  live value when it differs, and validation.
- **Navigation & labels:** menu labels only. A label never changes the destination, icon, group, or
  who may open the page.
- **Preview & publishing:** the saved draft in a homepage preview (phone, tablet, landscape, desktop),
  the changes waiting, publish, discard, and version history with restore.

Omitted, because they are not built yet (so they are not shown rather than shown as fake controls):
Global branding, Pages & sections, Cards & components, Images & media, and Theme & design tokens. A
separate Navigation & labels tab is folded into the Appearance section above.

**How it works and what is enforced.**

- Drafts are saved server-side, but only the published copy is ever served to visitors. The draft
  preview is owner-only.
- Publish and restore are atomic (one database function, under a lock). Each creates a new version;
  older versions are kept. A publish with no changes is refused.
- Every write re-validates on the server: unknown keys are refused, markup and control characters are
  refused, text has length limits, and links are limited to listed public pages, homepage sections, or
  `https://` addresses without credentials. No arbitrary HTML or JavaScript can be stored.
- Saving a draft requires an aal2 session. **Publish and restore also require a TOTP code verified in
  the last 15 minutes**, as for other sensitive actions.
- Nothing here changes accounts, roles, study data, calculations, or code. Restoring a version does not
  touch user data.
- If the stored copy is missing or unreadable, the built-in default copy is shown.
- Unsaved edits are guarded when navigating within the console and on reload or tab close.

Storage: `supabase/migrations/20261010120000_site_content_publishing.sql` (`site_content_draft`,
`site_content_published`, `site_content_versions`, and `site_content_commit`). The migration is
additive and must be applied before publishing works; until then the site shows its defaults.

## Settings, roles and permissions

Sidebar → **Settings** (`/control-panel/settings/*`) has horizontal tabs. Each tab only appears with its permission, and the server refuses the matching action without it.

| Tab | Permission | What it does |
| --- | --- | --- |
| Site status | `settings.site` | Maintenance notice (banner) and **site down** (themed maintenance page for visitors and students; log in, `/auth/callback` and the console stay reachable; signed-in role holders keep using the site with a staff banner). |
| Sign-up & sign-in | `settings.access` | Turn new sign-ups and sign-ins off/on. |
| Security | every role holder | Change your own password; sign-in methods; **owner only:** passkeys. |
| Roles & members | `roles.manage` | Give a role by email, change it, remove it. |
| Permissions | owner only | Role × permission matrix and per-person allow/deny overrides. |
| Activity | `audit.view` | Last 50 settings and role changes. |
| Master MCP | Owner only | Issue, inspect and revoke dedicated Master MCP credentials for an external operations agent. The token is shown once. The Master principal cannot create or revoke credentials itself, and it is not an Owner session. See [master-mcp-connection.md](master-mcp-connection.md). |

### Master MCP (Owner only)

Sidebar → **Settings → Master MCP**. Only the Owner can open this tab or call `/api/control/master-mcp`.

The tab shows the Streamable HTTP endpoint (`/api/mcp`, production `https://dypol-stracker.vercel.app/api/mcp`), named credentials, last activity, revocation status and a summary of backend-enforced capabilities. Creating, rotating or revoking a credential requires Owner MFA / step-up. The plaintext token is shown once and is stored only as a hash.

The Master MCP agent authenticates with `Authorization: Bearer <MASTER_MCP_TOKEN>` and has 118 operational tools. It cannot change roles, Owner identity, authentication, sign-up/sign-in switches, or delete user accounts. Full documentation lives in [master-mcp.md](master-mcp.md), [master-mcp-tools.md](master-mcp-tools.md), [master-mcp-connection.md](master-mcp-connection.md), [master-mcp-security.md](master-mcp-security.md) and [master-mcp-migration.md](master-mcp-migration.md).

Roles: Owner, Admin (`administrator`), Moderator (`moderator`), Viewer (`viewer`). Migration `20261114160000` renamed Manager to Moderator and moved the retired Support and old `analyst` keys to Viewer (0 holders were affected in production). Defaults live in `control_role_permissions` (seeded by migration `20261114120000_control_settings_rbac`) and follow least privilege: Viewer reads, Moderator handles messages, account lookup, content drafts and exams, Admin everything except permission editing. **The owner always has every permission** and cannot be changed, demoted or removed by anyone; only the owner can grant Owner/Admin or edit the matrix and overrides.

**Every save needs a fresh confirmation.** The client prompts before each save: an authenticator code for everyone, or (owner only) a passkey. The server (`requireStepUp`) accepts the write only if the session's newest accepted proof (TOTP; or passkey for the owner) is ≤ 120 s old and that verification has not been used before (`control_step_up_uses`, unique per user/session/verification time). Replays get `step_up_used`.

**Granting** a role deletes any existing MFA factors and overrides, so the person must enroll a new authenticator on first console visit. **Removing** a role revokes it at once: overrides, MFA factors and passkeys are deleted and all their sessions are revoked (`control_revoke_user_sessions`). A re-grant needs a fresh enrollment.

### Where things are enforced

| Control | Server / database | UI only |
| --- | --- | --- |
| Console access (role, aal2, per-route permission) | every `/api/control/*` route (`authorizeControl`) | sidebar, command launcher and routes are also hidden |
| Settings writes | permission + step-up on the server; owner protections on the server | prompts |
| Sign-ups off | trigger on `auth.users` (`signups_paused`) — covers email and Google | sign-up page notice |
| Sign-ins off | trigger on `auth.sessions` (`signins_paused`), role holders exempt; existing sessions are kept | log-in page notice |
| Site down | AI chat and contact APIs refuse (`site_down`) | maintenance page. Student data reads through Supabase/RLS are **not** blocked by site-down. |

### Passkeys (owner only)

- **Who:** only the active owner. A database trigger (`control_enforce_owner_only_passkeys`, on `auth.webauthn_credentials` and WebAuthn rows of `auth.mfa_factors`) refuses to store a passkey for anyone else, whatever client is used. Giving someone a non-owner role deletes their passkeys; removing a role deletes them too.
- **Two-step screen:** the owner with a registered passkey sees **Use passkey** next to the six-digit code. It runs Supabase's passkey ceremony (`signInWithPasskey`), which issues a fresh session whose `amr` records `passkey`; the previous session is then signed out. The server (`consoleAssurance`) accepts a passkey as the second step for the owner only. Any other role whose session involved a passkey is refused (`access_not_granted`, audited as `passkey_owner_only`).
- **Step-up:** the owner can confirm a save with the passkey or a code; it must be ≤ 120 s old and single-use (same table, keyed per user and session).
- **Add / remove:** Settings → Security → Passkeys (owner). Adding is preceded by a step-up; removing goes through the server.
- **Supabase setting:** Authentication → Passkeys → *Enable Passkey authentication* (Beta), Relying Party ID `dypol-stracker.vercel.app`, origin `https://dypol-stracker.vercel.app`. When it is off, the console hides the option and explains the toggle.

## Warnings, bans and account deletion

Open **Users → (name)**. Depending on your permissions you see **Warn**, **Ban** / **Lift ban** and
**Delete account**, plus a **Warnings and bans** tab with the full history (who, when, until, and
whether the student has seen it).

| Permission | Owner | Admin | Moderator | Viewer |
| --- | --- | --- | --- | --- |
| `users.warn` | yes | yes | yes | no |
| `users.ban` (ban and lift) | yes | yes | no | no |
| `users.delete` | yes | no (owner can grant) | no | no |

Rules enforced by the server (`api/_lib/control-routes/user-sanction.ts`) on every request,
whatever the browser shows:

- Nobody can act on the owner or on themselves. Otherwise the actor needs a **strictly higher**
  role than the target (owner > admin > moderator > viewer > student). Rank is checked before
  the step-up, so a refused attempt consumes nothing; refusals are audited (bounded).
- Every action needs a fresh, single-use step-up (owner: passkey or authenticator code; others:
  authenticator code; at most 2 minutes old).
- Warnings and bans need a reason (5–500 characters) that the student will see. Deleting needs
  the account email typed exactly.
- Audit rows carry the action, actor role, target account ID, reason and counts — never study
  data or the target's email.

### How a ban is enforced

1. **Supabase Auth native ban** (`updateUserById` with `ban_duration`: `876000h` for permanent,
   the exact number of seconds until the chosen end for temporary; `none` lifts it). Auth then
   refuses password sign-in, Google sign-in and every refresh-token exchange with `user_banned`.
2. **All sessions revoked** at once (`control_revoke_user_sessions`), so no refresh token survives.
3. **Row-level security defence in depth.** Access tokens are stateless JWTs and stay valid for up
   to an hour. A `RESTRICTIVE` policy `account not banned` on every student table and on
   `storage.objects` (`authenticated` role only) calls `public.current_account_banned()`: one
   primary-key lookup on `account_bans`, evaluated once per statement. A banned account's old
   token reads nothing and can write nothing. Public read tables (site content, exam catalog,
   site settings) are left alone. Student AI routes already verify tokens with Auth
   (`getUser`), which refuses banned users; console routes check `account_bans` in the same
   round trip as the role lookup.
4. **Temporary bans expire by themselves**: Auth lifts its ban at `banned_until`, and the RLS check
   compares `banned_until > now()`. The ban row is cleaned up and a "your suspension has ended"
   notice is queued the next time the student opens the dashboard.

If writing the ban record fails after Auth accepted the ban, the route lifts the Auth ban again, so
the two never disagree.

### What the student sees

- **Dashboard (`my_account_notice`)**: the oldest unacknowledged notice as a themed popup —
  warning (reason; dashboard keeps working), ban (reason and end time in IST, plus "anything you
  add or change while banned is discarded"; signs out automatically after "Sign out" or 30
  seconds), lifted or ended ban. Acknowledgement is stored server-side
  (`acknowledge_account_notice`). The check runs on open, right after any sync is refused by the
  server (at most every 10 seconds), on window focus or tab return (at most every 30 seconds) and
  every 3 minutes while the tab is visible — one small RPC each time. If the session is already
  dead (Auth refused the refresh with `user_banned`), the notice is fetched with the device token
  instead. On a ban the browser's copy of the account (study data and the unsynced queue) is
  discarded before signing out, and the sign-in page then shows the banned block. The same RPC
  returns a signed device token (below).
- **Email + password sign-in**: Supabase Auth answers `user_banned` *before* it checks the
  password (it says "banned" even for a wrong password — a Supabase behaviour we cannot change).
  Stracker therefore reveals nothing itself until `account_ban_notice_for_credentials` proves the
  password in the database (bcrypt via `extensions.crypt`, constant work with a dummy hash for
  unknown emails, rate limited to 5 per email per 15 minutes and 600 per minute overall, email
  stored only as a SHA-256 hash in the limiter). Proven: "This account is suspended until … IST
  (or permanently). Reason: …". Not proven: the usual "Email or password is incorrect".
- **Google sign-in**: Supabase returns `error_code=user_banned` with no identity. If this device
  last held the account, its HMAC-signed device token (`<uid>.<expiry>.<hmac>`, 180 days, key in
  the non-exposed `private.account_notice_keys`) lets `account_ban_notice_for_token` show the
  details. Otherwise the page shows a generic "This account is suspended … sign in with email and
  password to see the details, or contact us". Limitation: a Google-only account on a new device
  sees only the generic message.

### Changes made while banned are never synced

Stracker is offline-first, so a banned student can keep editing in an open tab or offline. Those
changes are thrown away for good, even after the ban ends:

- **Server** (`account_sync_cutoffs`, kept in step with `account_bans` by a trigger): the cutoff
  is the ban's end (`infinity` for permanent); lifting a ban early moves it to the moment it was
  lifted. A `BEFORE` trigger `account_sync_cutoff` on the 19 student tables skips (returns NULL)
  any `authenticated` write whose operation time is before the cutoff. While the ban is still
  active it refuses the write instead (`42501`, as row-level security would), so an open
  dashboard learns at once that it is banned and shows the popup. The operation time is the
  moment the change was made, sent by the sync queue as the `x-stracker-op-at` header (older
  bundles without it fall back to the row's `updated_at` with five minutes' grace). Skipped
  writes succeed silently, so the queue drains and the next refresh replaces the browser copy with
  the server's. Service-role and console writes are unaffected; accounts that were never banned
  have no cutoff row.
- **Client**: when the ban is detected, the local tables and the outbox for that account are
  cleared; after the ban, the next sign-in loads the server copy.
- Only changes made after the ban ended reach the database. Edits made before the ban that had
  not synced by the time of the ban are dropped too.

### Sign-in page for a banned account

A refused sign-in shows the ban popup (reason, permanent or "until … IST") and, after it is
dismissed, a themed "Account banned" block directly below the password field with the same
details. Password sign-in reveals the details only when the password is proven correct (rate
limited, see above); a wrong password shows the usual error. Google sign-in shows them on return
to the login page when this device holds the account's token, otherwise a generic banned popup
and block.

### Deleting an account

Files first (while the account still exists, so a failure can be retried): everything under
`mistake-images/<uid>/`, and the attachments of the account's contact messages; then those
contact messages (their foreign key is `ON DELETE SET NULL`); then `auth.admin.deleteUser`, which
removes every study, AI, role, sanction and notice row through `ON DELETE CASCADE`. The audit row
keeps only counts.

## Not implemented yet

Administrator, Support and Analyst permission sets; feature flags; announcements; exam, subject
and chapter configuration; email and authentication operations; analytics beyond the overview;
settings; global search beyond the account launcher (Ctrl+K). These are intentionally absent from
navigation until they work.

Appearance tabs not yet built: Global branding, Pages & sections, Cards & components, Images & media,
and Theme & design tokens. Logos, images, and brand colours are not editable yet.


## Student Dashboard Editor configuration

Storage: `supabase/migrations/20261116190000_student_layout.sql` (`student_layout_draft`,
`student_layout_published`, `student_layout_versions`, `student_layout_commit`), separate from the
public website's `site_content_*`. Draft and history are service-role only; signed-in users can read
the single published row (presentation only). API: `/api/control/student-layout-{state,draft,discard,publish,restore}`
(`appearance.edit` / `appearance.publish`, aal2; publish and restore also need fresh MFA).
The schema, registry and validator live in `src/lib/student-layout/`. Values bound to a student's own
records (dates, marks, scores, names, streaks, counts, timers, progress) are never stored: the validator
rejects them with `data_locked`. With nothing published, the workspace renders exactly the shipped layout.

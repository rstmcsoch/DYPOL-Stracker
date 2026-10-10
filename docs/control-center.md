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

## Not implemented yet

Administrator, Support and Analyst permission sets; feature flags; announcements; exam, subject
and chapter configuration; email and authentication operations; analytics beyond the overview;
settings; global search beyond the account launcher (Ctrl+K). These are intentionally absent from
navigation until they work.

Appearance tabs not yet built: Global branding, Pages & sections, Cards & components, Images & media,
and Theme & design tokens. Logos, images, and brand colours are not editable yet.

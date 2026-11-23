# Master MCP security and permissions

The backend enforces these boundaries. The Settings → Master MCP tab describes the same
capabilities; it is not decorative.

## Permitted

- Operational student-data access, always scoped to an explicit student id, using the
  existing record validators.
- Warn, temporary ban, permanent ban and unban for ordinary student accounts. The Owner
  and active Control Center role holders are protected. The agent cannot sanction itself.
- Public website and Student Dashboard drafts, validation, preview, publish and restore
  through the existing editors and commit RPCs.
- Global Stracker AI providers, model order and limits. Saved keys are returned masked only.
- Analytics reads, supported configuration, error-group and alert updates, and CSV export.
- Contact inbox and media library, with reference protection and confirmation for deletes.
- Maintenance notice and site-down, with an impact preview and confirmation for site-down.

## Forbidden (server-refused)

- Role assignment, removal, permission matrices and member permission overrides.
- Any change to the Owner identity, email, password, passkeys, MFA or Control Center access.
- User-account deletion, including `auth.admin.deleteUser` and the existing deletion sanction.
- Password, passkey, TOTP/MFA, session, Turnstile, captcha and authentication-provider tools.
- Sign-up and sign-in switches, email domain allow/block rules, and security policies.
- Reading deployment secrets, service-role keys, encryption keys or environment variables.
- Arbitrary SQL, JavaScript, shell or infrastructure destruction.
- Creating, rotating or revoking Master MCP credentials.
- Deleting or rewriting historical audit records.
- Reading or changing student BYOK (`ai_provider_configs`).

Alternate tool names and mixed-case aliases are also refused. A Master bearer token is not
Control Center authority and cannot be used on `/api/control/settings`.

## Privacy and secrets

- Student passwords, tokens, OTPs, private notes and marks are not written to Master audit
  summaries.
- Admin AI keys and encrypted envelopes never appear in tool output, logs or audit events.
- Contact-message audits record the message id, not the email or body.
- Attachment links are short-lived signed URLs (five minutes). Permanent unauthorized
  storage URLs and bucket credentials are never returned.
- RLS on student tables is not weakened. Migrations are additive and forward-only.

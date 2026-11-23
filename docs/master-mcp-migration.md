# Master MCP migration notes

## Migration

File: `supabase/migrations/20261123120000_master_mcp.sql`

This migration is additive and forward-only. It creates:

- `master_mcp_credentials` — hashed tokens, hints, status, last-used and revocation metadata
- `master_mcp_confirmation_tokens` — one-use confirmation records
- `master_mcp_audit_events` — Master actor audit trail
- `master_mcp_rate_slots` and `master_mcp_take_rate_slot` — a rate-limit budget separate
  from Control Center and student AI

It does not alter `control_roles`, `control_role_permissions`, `control_member_permissions`,
owner protections, passkey triggers or existing RLS. Anon and authenticated clients cannot
read token hashes or change connection records.

## Production apply (Owner authorization required)

Do **not** apply this to production without explicit Owner authorization.

1. Review the roll-up pull request into `main` and its GitHub CI / Vercel preview results.
2. Merge that pull request only after the Owner authorizes the merge.
3. Apply `20261123120000_master_mcp.sql` to production Supabase project `tkggckwksoatbswrebpu`.
4. No new Vercel environment variables are required for the foundation. Do not change
   production env vars without Owner authorization.
5. The Owner then creates the first credential in Control Center → Settings → Master MCP
   (MFA / step-up) and connects an agent using the guide in `master-mcp-connection.md`.

Preview deployments can run the protocol against a preview database, but production tools
will not have the Master tables until the migration is applied.

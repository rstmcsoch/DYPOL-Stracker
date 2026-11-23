# Master MCP architecture

Stracker Master MCP is a dedicated Streamable HTTP, JSON-RPC 2.0 endpoint for an Owner-issued
AI operations agent. It is a separate principal (`master_mcp`). It is not the Owner, not a
Control Center role, not a student session, and not the student-facing Stracker AI.

## Endpoint and transport

- Public URL: `POST /api/mcp`
- Production: `https://dypol-stracker.vercel.app/api/mcp`
- Transport: Streamable HTTP. Methods: `initialize`, `ping`, `notifications/initialized`,
  `tools/list`, `tools/call`.
- Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`.
- Request body limit: 256 KB.

On Vercel Hobby the project already uses the 12-function cap. `/api/mcp` is rewritten to
`/api/control/system?route=mcp` so Master MCP does not add a thirteenth serverless entry.
Do not add `api/mcp.ts` as a new function.

## Authentication

The agent authenticates with a dedicated bearer token:

```
Authorization: Bearer stmcp_<token>
```

Only a hash of the token is stored (`master_mcp_credentials`). The plaintext is shown once
when the Owner creates the credential in Control Center → Settings → Master MCP, after MFA /
step-up. Student JWTs, Control Center cookies, Owner JWTs and `ADMIN_TOKEN` are rejected.
A revoked credential fails on the next request. The Master principal cannot create, rotate
or revoke its own credentials.

## How tools run

`tools/list` advertises only implemented, authorised tools (118). Forbidden names are
rejected even when they are not in the list. Each `tools/call` is audited under the Master
actor type with the connection id, credential label, tool name, target and outcome. Secret
material (tokens, API keys, passwords, encrypted envelopes) is stripped from audit payloads.

High-impact or destructive tools use a two-stage confirmation: a preview with a one-use
token (10-minute TTL) must be sent back with the same operation, target and arguments
before the mutation runs. Bulk-style previews include counts and a bounded item summary
where multiple records are involved. Account deletion cannot be authorised this way.

## Data and reuse

Master tools call dedicated services that reuse existing validators, RPCs and tables:

- Student study records go to the canonical Supabase tables used by the web app and Android.
- Public site publish/restore uses `site_content_commit_document` only.
- Student dashboard publish/restore uses `student_layout_commit` only.
- Global Stracker AI uses `site_ai_providers`. Student BYOK (`ai_provider_configs`) is never queried.
- Analytics uses the first-party report pipeline (`api/_lib/analytics/reports.ts`).
- Media and contact messages reuse the existing library and inbox rules.

See also:

- [Connection guide](master-mcp-connection.md)
- [Tool reference](master-mcp-tools.md)
- [Security and permissions](master-mcp-security.md)
- [Migration notes](master-mcp-migration.md)
- [Compatibility review](master-mcp-compatibility.md)

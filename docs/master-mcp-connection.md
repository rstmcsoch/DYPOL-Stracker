# Master MCP connection guide

Only the Owner can issue a Master MCP credential. This cannot be done by the Master agent
itself, and it cannot be verified in automated tests without the Owner’s MFA / step-up.

## 1. Create the first credential

1. Sign in to the Control Center at `/control-panel/` as the Owner.
2. Complete MFA (authenticator or, if enabled, the Owner passkey).
3. Open **Settings → Master MCP**.
4. Enter a display name (for example `Owner operations`) and create the connection.
5. Complete the step-up prompt.
6. Copy the token immediately. It is shown once, begins with `stmcp_`, and is never stored
   in the browser or in the database in plaintext. Only a hash and a short hint are kept.

Revoke a connection from the same tab if it is lost or no longer needed. Revocation takes
effect on the next request.

## 2. Endpoint and header

```
POST https://dypol-stracker.vercel.app/api/mcp
Authorization: Bearer <MASTER_MCP_TOKEN>
Content-Type: application/json
```

On a Vercel preview, replace the host with that preview’s alias. The Settings tab also
copies the current origin’s endpoint.

A preview deployment can be used to exercise the protocol, but tools that need the
production database will only work after the Owner applies the Master MCP migration to
production and creates a production credential.

## 3. Handshake

Supported protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`.

Initialize:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "owner-operations-agent", "version": "1.0" }
  }
}
```

Then `notifications/initialized`, `tools/list`, and `tools/call`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_master_permissions",
    "arguments": {}
  }
}
```

Destructive tools first return `{ "needsConfirmation": true, "confirmationToken": "…", "effects": […], … }`.
Repeat the same call with that `confirmationToken` to apply the change. The token is
one-use, expires in 10 minutes, and is bound to the connection, tool, target and arguments.

## 4. What not to send

- Do not send a Supabase student or Owner JWT, a Control Center cookie, or `ADMIN_TOKEN`.
- Do not call `/api/control/settings` or other Control Center routes with the Master token.
  Those routes still require a Control Center session, role, MFA and (for writes) step-up.
- Do not ask the agent to create another Master credential or to change Owner security.

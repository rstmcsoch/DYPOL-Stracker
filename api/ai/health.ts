import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'
import { evaluateServerConfig, type ServerConfigStatus } from '../_lib/server-config.js'
import { authenticateRequest } from '../_lib/supabase.js'
import { logAIEvent } from '../_lib/diagnostics.js'

/**
 * Configuration health check for the Stracker AI backend (SA-2610-01 hardening).
 *
 * Two-tier response:
 *
 *   - Verified signed-in caller (Bearer session):
 *       {"service":"stracker-ai","configured":true,"checks":{...},"reason":null,"missing":[],"invalid":[]}
 *       Booleans, a normalized reason code, and the NAMES of missing or malformed environment
 *       variables — never secret values, user data, or provider credentials. Used by the
 *       AI settings UI to show the administrator exactly what to fix.
 *
 *   - Anonymous caller (no/invalid session):
 *       {"service":"stracker-ai","status":"ok"}
 *       A bare liveness acknowledgment only. The deployment-configuration detail that used to be
 *       public here is now reserved for signed-in users (external finding SA-2610-01).
 *
 * A structured warning naming missing variables (names only, never values) is always written to
 * the server log so the administrator can diagnose the deployment from the Vercel function logs.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  const status: ServerConfigStatus = evaluateServerConfig()
  if (!status.configured) {
    logAIEvent('warn', 'ai_backend_config_check', {
      configured: false,
      reason: status.reason,
      missing: status.missing.join(','),
      invalid: status.invalid.join(',')
    })
  }
  let authenticated = false
  try {
    await authenticateRequest(req)
    authenticated = true
  } catch {
    // Missing/invalid session: fall back to the minimal public payload below.
  }
  sendJson(res, 200, authenticated
    ? { service: 'stracker-ai', ...status }
    : { service: 'stracker-ai', status: 'ok' })
}

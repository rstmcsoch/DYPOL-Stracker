import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'
import { evaluateServerConfig, type ServerConfigStatus } from '../_lib/server-config.js'
import { logAIEvent } from '../_lib/diagnostics.js'

/**
 * Safe configuration health check for the Stracker AI backend.
 *
 * GET /api/ai/health -> {"service":"stracker-ai","configured":true,"checks":{...},"reason":null,"missing":[],"invalid":[]}
 *                   or {"configured":false,"reason":"supabase_server_config_missing","missing":["SUPABASE_SERVICE_ROLE_KEY"],...}
 *
 * This endpoint is intentionally unauthenticated: it reports deployment configuration status
 * only — booleans, a normalized reason code, and the NAMES of missing or malformed environment
 * variables. It never returns secret values, user data, or provider credentials, so the
 * frontend can distinguish these states before the user attempts anything:
 *
 *   - backend deployed and configured        -> configured: true
 *   - backend deployed but server config
 *     incomplete (the exact cause of the
 *     "secure AI backend is not configured"
 *     message)                               -> configured: false + reason + missing names
 *   - /api routes not deployed at all
 *     (SPA fallback serves HTML)             -> the client sees a non-JSON response
 *
 * When the configuration is incomplete, a structured warning naming the missing variables is
 * written to the server log (names only, never values) so the administrator can diagnose the
 * deployment directly from the Vercel function logs.
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
  sendJson(res, 200, { service: 'stracker-ai', ...status })
}

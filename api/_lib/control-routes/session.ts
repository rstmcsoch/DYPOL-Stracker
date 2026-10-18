import type { ApiRequest, ApiResponse } from '../http.js'
import { sendJson } from '../http.js'
import { controlHandler, recordSessionGranted } from '../control.js'
import { CONTROL_IDLE_TIMEOUT_SECONDS, isAal2, isRecentMfa } from '../control-policy.js'

/**
 * GET /api/control/session
 *   401 signed out · 403 access_not_granted (any non-owner) · 403 rate limited
 *   200 {status:'mfa_required'}  owner without an aal2 session: the browser may only run MFA steps
 *   200 {status:'granted'}       owner with aal2: the console may load
 * Returns no personal data and no admin data: only the role and assurance state.
 * The first granted answer per Auth session is recorded as a successful console access.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: false }, async context => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const granted = isAal2(context.aal)
    if (granted) await recordSessionGranted(context)
    sendJson(res, 200, {
      status: granted ? 'granted' : 'mfa_required',
      userId: context.userId,
      role: context.role,
      aal: context.aal,
      recentMfa: isRecentMfa(context.mfaAt, nowSeconds),
      idleTimeoutSeconds: CONTROL_IDLE_TIMEOUT_SECONDS
    })
  })
}

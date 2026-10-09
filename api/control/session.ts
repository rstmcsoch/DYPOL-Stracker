import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import { controlHandler } from '../_lib/control.js'
import { isAal2, isRecentMfa } from '../_lib/control-policy.js'

/**
 * GET /api/control/session
 *   401 signed out · 403 access_not_granted (any non-owner) · 403 rate limited
 *   200 {status:'mfa_required'}  owner without an aal2 session: the browser may only run MFA steps
 *   200 {status:'granted'}       owner with aal2: the console may load
 * Returns no personal data and no admin data: only the role and assurance state.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: false }, async context => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    sendJson(res, 200, {
      status: isAal2(context.aal) ? 'granted' : 'mfa_required',
      userId: context.userId,
      role: context.role,
      aal: context.aal,
      recentMfa: isRecentMfa(context.mfaAt, nowSeconds),
      idleTimeoutSeconds: 20 * 60
    })
  })
}

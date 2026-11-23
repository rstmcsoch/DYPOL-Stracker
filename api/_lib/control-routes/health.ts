import type { ApiRequest, ApiResponse } from '../http.js'
import { sendJson } from '../http.js'
import { controlHandler } from '../control.js'
import { loadSiteHealth } from '../services/site-health.js'

/**
 * GET /api/control/health
 * Bounded, read-only probes: a database round trip, the Supabase Auth health endpoint,
 * and the deployment configuration (variable NAMES only). Email delivery has no probe in
 * this codebase, so it is reported as unknown rather than healthy.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true, permission: 'health.view' }, async context => {
    sendJson(res, 200, await loadSiteHealth(context.admin))
  })
}

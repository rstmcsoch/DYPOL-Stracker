import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import auditHandler from '../_lib/control-routes/audit.js'
import useraccessHandler from '../_lib/control-routes/user-access.js'
import { draftHandler, discardHandler, publishHandler, restoreHandler, stateHandler } from '../_lib/control-routes/appearance.js'
import { mediaUploadHandler } from '../_lib/control-routes/media.js'
import { examsHandler } from '../_lib/control-routes/exams.js'

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>
const handlers: Record<string, Handler> = {
  'audit': auditHandler,
  'user-access': useraccessHandler,
  // Appearance shares this function so the deployment stays within the Hobby plan's
  // 12 serverless-function cap. Public paths are still /api/control/appearance-*.
  state: stateHandler,
  draft: draftHandler,
  discard: discardHandler,
  publish: publishHandler,
  restore: restoreHandler,
  media: mediaUploadHandler,
  exams: examsHandler,
}

/** Dispatch related Control Center endpoints through one Vercel serverless function. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const route = new URL(req.url ?? '/', 'http://localhost').searchParams.get('route') ?? ''
  const selected = handlers[route]
  if (!selected) {
    sendJson(res, 404, { error: 'not_found', message: 'Control route not found.' })
    return
  }
  await selected(req, res)
}

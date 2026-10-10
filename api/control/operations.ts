import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import auditHandler from '../_lib/control-routes/audit.js'
import useraccessHandler from '../_lib/control-routes/user-access.js'

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>
const handlers: Record<string, Handler> = {
  'audit': auditHandler,
  'user-access': useraccessHandler,
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

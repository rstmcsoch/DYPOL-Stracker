import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { sendJson } from '../_lib/http.js'
import sessionHandler from '../_lib/control-routes/session.js'
import rolesHandler from '../_lib/control-routes/roles.js'
import { settingsHandler } from '../_lib/control-routes/settings.js'

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>
const handlers: Record<string, Handler> = {
  'session': sessionHandler,
  'roles': rolesHandler,
  'settings': settingsHandler,
}

/** Dispatch related Control Center endpoints through one Vercel serverless function. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const route = new URL(req.url ?? '/', 'http://localhost').searchParams.get('route') ?? ''
  const selected = Object.prototype.hasOwnProperty.call(handlers, route) ? handlers[route] : undefined
  if (!selected) {
    sendJson(res, 404, { error: 'not_found', message: 'Control route not found.' })
    return
  }
  await selected(req, res)
}

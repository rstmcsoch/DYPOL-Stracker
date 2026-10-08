import type { IncomingMessage, ServerResponse } from 'node:http'
import { describeUnexpectedError, logAIEvent, newReference } from './diagnostics.js'

export interface ApiRequest extends IncomingMessage {
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

export interface ApiResponse extends ServerResponse {
  status?: (code: number) => ApiResponse
  json?: (body: unknown) => void
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Optional safe, normalized reason code (never a secret) exposed to the client. */
  readonly reason?: string
  constructor(status: number, code: string, message: string, options: { reason?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.reason = options.reason
  }
}

export function sendJson(res: ApiResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (typeof res.json === 'function') res.json(body)
  else res.end(JSON.stringify(body))
}

export async function readJson(req: ApiRequest, maxBytes = 32_000): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.byteLength
    if (length > maxBytes) throw new ApiError(413, 'request_too_large', 'That AI request is too large. Shorten it and try again.')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch {
    throw new ApiError(400, 'invalid_json', 'The AI request could not be read. Try again.')
  }
}

export function methodNotAllowed(res: ApiResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '))
  sendJson(res, 405, { error: 'method_not_allowed', message: 'That AI request method is not supported.' })
}

export interface PublicErrorBody { error: string; message: string; reference?: string; code?: string; provider?: string | null; retryable?: boolean; fallbackEligible?: boolean; reason?: string }

export function publicError(error: unknown): { status: number; body: PublicErrorBody } {
  if (error instanceof ApiError) {
    const body: PublicErrorBody = { error: error.code, message: error.message }
    if (error.reason) body.reason = error.reason
    // AI-specific details are added by AIError (see ai-errors.ts) without exposing provider payloads.
    const details = error as unknown as { aiCode?: string; provider?: string | null; retryable?: boolean; fallbackEligible?: boolean }
    if (details.aiCode) Object.assign(body, { code: details.aiCode, provider: details.provider ?? null, retryable: details.retryable ?? false, fallbackEligible: details.fallbackEligible ?? false })
    return { status: error.status, body }
  }
  // Unexpected failure: keep the browser message safe, but give the user a reference that maps to a
  // structured server log entry containing the redacted error class and application frames.
  const reference = newReference('err')
  logAIEvent('error', 'unhandled_server_error', { reference, ...describeUnexpectedError(error) })
  return { status: 500, body: { error: 'internal_error', message: `Stracker AI encountered a server error. Reference ${reference}.`, reference, code: 'INTERNAL_ERROR', retryable: true } }
}

export function parseQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

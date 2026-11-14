import { createHash } from 'node:crypto'
import type { AIProtocol, AIProviderId } from './registry.js'

/**
 * three.dev observability proxy (https://docs.three.dev). Server-side only.
 *
 * When THREE_DEV_API_KEY is set, Stracker AI chat calls to providers three.dev documents as
 * supported are sent through gate.three.dev with the provider key forwarded unchanged (BYOK).
 * Without the key — or for any provider/host three.dev does not forward to — every call is
 * built exactly as before. A three.dev-side failure falls back to the direct provider call.
 */
export const THREE_DEV_GATE = 'https://gate.three.dev'
export const THREE_DEV_USE_CASE = 'stracker-ai-assistant'

export type ThreeDevProvider = 'openai' | 'anthropic' | 'gemini'

/** Per-request context added only to calls that go through three.dev. Never PII or content. */
export interface ThreeDevTrace {
  /** Opaque session id (already hashed); see threeDevSessionId. */
  sessionId?: string
  /** Request-level tags: short ASCII enum values only. */
  tags?: Record<string, string>
}

export interface ThreeDevRouteInput {
  providerId: AIProviderId
  protocol: AIProtocol
  baseUrl: string
  modelId: string
}

export interface ThreeDevRoute {
  provider: ThreeDevProvider
  url: string
  headers: Record<string, string>
}

type Env = Record<string, string | undefined>

const OPENAI_DEFAULT = /^https:\/\/api\.openai\.com\/v1\/?$/
const ANTHROPIC_DEFAULT = /^https:\/\/api\.anthropic\.com\/v1\/?$/
const GEMINI_DEFAULT = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/?$/
const TAG_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TAG_VALUE = /^[A-Za-z0-9._:-]{1,64}$/

export function threeDevKey(env: Env = process.env): string | null {
  const value = env.THREE_DEV_API_KEY?.trim()
  return value && !/[\r\n]/.test(value) ? value : null
}

/** production | preview | development from Vercel, otherwise NODE_ENV, otherwise local. */
export function threeDevEnvironment(env: Env = process.env): string {
  const raw = (env.VERCEL_ENV || env.NODE_ENV || 'local').trim().toLowerCase()
  return /^[a-z0-9-]{1,32}$/.test(raw) ? raw : 'local'
}

/**
 * The session is one Stracker AI conversation. The conversation UUID is hashed so three.dev
 * never receives a database identifier; the same conversation always maps to the same session.
 */
export function threeDevSessionId(conversationId: string): string {
  return createHash('sha256').update(`stracker-ai-session:${conversationId}`).digest('hex').slice(0, 32)
}

/**
 * Which three.dev provider (if any) this exact call can go through, per the three.dev docs:
 * OpenAI Chat Completions on api.openai.com, Anthropic Messages on api.anthropic.com, and Gemini's
 * native generateContent/streamGenerateContent (tool calls included). DeepSeek, Qwen and custom
 * endpoints are hosts three.dev does not forward to, so they always stay direct.
 */
export function threeDevProviderFor(input: ThreeDevRouteInput): ThreeDevProvider | null {
  if (input.providerId === 'openai' && input.protocol === 'openai-compatible' && OPENAI_DEFAULT.test(input.baseUrl)) return 'openai'
  if (input.providerId === 'anthropic' && input.protocol === 'anthropic-compatible' && ANTHROPIC_DEFAULT.test(input.baseUrl)) return 'anthropic'
  if (input.providerId === 'gemini' && input.protocol === 'google' && GEMINI_DEFAULT.test(input.baseUrl)) return 'gemini'
  return null
}

export function threeDevHeaders(key: string, provider: ThreeDevProvider, trace: ThreeDevTrace, env: Env = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Three-Api-Key': key,
    'X-Three-Use-Case': THREE_DEV_USE_CASE,
    'X-Three-AI-Provider': provider,
    'X-Three-Tag-Environment': threeDevEnvironment(env)
  }
  if (trace.sessionId && /^[A-Za-z0-9_-]{1,128}$/.test(trace.sessionId)) headers['X-Three-Session-ID'] = trace.sessionId
  for (const [name, value] of Object.entries(trace.tags ?? {})) {
    if (name === 'environment' || !TAG_KEY.test(name) || !TAG_VALUE.test(value)) continue
    headers[`X-Three-Tag-${name}`] = value
  }
  return headers
}

/**
 * Route one provider call. `directUrl` is the URL the call uses today; the proxy URL keeps the
 * same path and query on gate.three.dev. Returns null (direct call) when the key is unset, the
 * call carries no trace (connectivity checks and model listing stay direct), or the provider/host
 * is not one three.dev supports.
 */
export function threeDevRoute(input: ThreeDevRouteInput, directUrl: string, trace: ThreeDevTrace | undefined, env: Env = process.env): ThreeDevRoute | null {
  if (!trace) return null
  const key = threeDevKey(env)
  if (!key) return null
  const provider = threeDevProviderFor(input)
  if (!provider) return null
  let direct: URL
  try { direct = new URL(directUrl) } catch { return null }
  return { provider, url: `${THREE_DEV_GATE}${direct.pathname}${direct.search}`, headers: threeDevHeaders(key, provider, trace, env) }
}

/**
 * A response that came from three.dev itself (or from in front of it) rather than from the
 * provider: the request should be retried directly. Provider errors pass through the proxy
 * unchanged, carry x-three-request-id and no x-three-error-code, and are handled as before.
 */
export function isThreeDevFailure(response: Response): boolean {
  if (response.ok) return false
  if (response.headers.get('x-three-error-code')) return true
  return response.status >= 500 && !response.headers.get('x-three-request-id')
}

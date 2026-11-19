import { ApiError } from './http.js'
import { logAIEvent } from './diagnostics.js'

/**
 * Server-side Cloudflare Turnstile check for forms that are not protected by Supabase Auth
 * (the public contact form). The secret lives only in the Vercel env var below; it is never
 * logged, returned or sent anywhere except Cloudflare's siteverify endpoint.
 *
 *   Production (VERCEL_ENV=production): TURNSTILE_SECRET_KEY is required; if it is missing the
 *   form fails closed with a friendly 503.
 *   Previews / local: the browser uses Cloudflare's always-pass test site key, so the server uses
 *   the matching documented always-pass test secret unless TURNSTILE_SECRET_KEY is set.
 */
export const TURNSTILE_SECRET_ENV = 'TURNSTILE_SECRET_KEY'
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** Cloudflare's documented "always passes" test secret (public, not a credential). */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'
const DEFAULT_ALLOWED_HOSTNAMES = ['dypol-stracker.vercel.app']
const VERIFY_TIMEOUT_MS = 8_000

type Env = Record<string, string | undefined>
type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export function turnstileSecret(env: Env = process.env): string | null {
  const configured = env[TURNSTILE_SECRET_ENV]?.trim()
  if (configured) return configured
  return env.VERCEL_ENV === 'production' ? null : TURNSTILE_TEST_SECRET
}

const FAILED_MESSAGE = 'We could not confirm you are human. Complete the security check above the Send button and try again.'

/** Throws a friendly ApiError unless Cloudflare confirms the single-use token. */
export async function verifyTurnstile(token: unknown, expectedAction: string, options: { env?: Env; fetcher?: FetchLike } = {}): Promise<void> {
  const env = options.env ?? process.env
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const secret = turnstileSecret(env)
  if (!secret) {
    logAIEvent('error', 'turnstile_secret_missing', { variable: TURNSTILE_SECRET_ENV })
    throw new ApiError(503, 'captcha_unavailable', 'Messages cannot be sent right now. Try again in a few minutes.')
  }
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    throw new ApiError(400, 'captcha_failed', FAILED_MESSAGE)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  let result: { success?: unknown; action?: unknown; hostname?: unknown; 'error-codes'?: unknown }
  try {
    const response = await fetcher(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: controller.signal
    })
    result = await response.json() as typeof result
  } catch {
    logAIEvent('warn', 'turnstile_verify_unreachable', {})
    throw new ApiError(503, 'captcha_unavailable', 'The security check could not be completed right now. Try again in a moment.')
  } finally {
    clearTimeout(timer)
  }
  const isTestSecret = secret === TURNSTILE_TEST_SECRET
  const actionOk = isTestSecret || result.action === expectedAction
  const allowedHostnames = new Set([
    ...DEFAULT_ALLOWED_HOSTNAMES,
    ...(env.VERCEL_PROJECT_PRODUCTION_URL ? [env.VERCEL_PROJECT_PRODUCTION_URL.trim().toLowerCase()] : []),
    ...(env.VERCEL_URL ? [env.VERCEL_URL.trim().toLowerCase()] : [])
  ])
  const hostnameOk = isTestSecret || typeof result.hostname !== 'string' || !result.hostname || allowedHostnames.has(result.hostname.trim().toLowerCase())
  if (result.success !== true || !actionOk || !hostnameOk) {
    const codes = Array.isArray(result['error-codes']) ? result['error-codes'].filter(code => typeof code === 'string').slice(0, 3).join(',') : ''
    logAIEvent('info', 'turnstile_rejected', { codes, action_mismatch: !actionOk, hostname_mismatch: !hostnameOk })
    throw new ApiError(400, 'captcha_failed', FAILED_MESSAGE)
  }
}

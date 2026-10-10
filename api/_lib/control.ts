import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from './http.js'
import { ApiError, methodNotAllowed, publicError, sendJson } from './http.js'
import { supabaseServerConfig } from './server-config.js'
import { logAIEvent, newReference } from './diagnostics.js'
import {
  ANONYMOUS_LIMIT,
  CONTROL_API_LIMIT,
  DENIED_AUDIT_LIMIT,
  isAal2,
  isRecentMfa,
  isUuid,
  latestMfaTimestamp,
  roleGrantsConsole,
  sanitizeAuditSummary,
  cleanText,
  type AuditSummaryValue,
  type ControlRole
} from './control-policy.js'

/**
 * Trusted server-side context for a console request. It is produced only after the bearer
 * JWT has been verified by the Auth server (getClaims), the account has an active owner row
 * in public.control_roles, and (when required) the session is at aal2.
 */
export interface ControlContext {
  userId: string
  role: ControlRole
  aal: string
  /** Unix seconds of the newest TOTP/phone verification in this session, or null. */
  mfaAt: number | null
  requestId: string
  /** Service-role client. Only ever used after the checks above. Never returned to a browser. */
  admin: SupabaseClient
}

export interface AuditEvent {
  requestId: string
  actorId: string | null
  actorRole: string | null
  action: string
  targetType?: string
  targetId?: string
  outcome: 'success' | 'denied' | 'failed'
  severity?: 'info' | 'notice' | 'warning' | 'critical'
  errorCode?: string
  reason?: string
  summary?: Record<string, unknown>
}

const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const

function bearerToken(req: ApiRequest): string | null {
  const authorization = req.headers.authorization
  const match = typeof authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null
  return match?.[1] ?? null
}

/** A one-way fingerprint of the client address for rate limiting. The raw IP is never stored. */
export function clientKeyHash(req: ApiRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined
  const address = first || req.socket?.remoteAddress || 'unknown'
  return createHash('sha256').update(`stracker-control:${address}`).digest('hex').slice(0, 32)
}

function serviceClient(): { url: string; admin: SupabaseClient; anonKey: string } {
  const resolved = supabaseServerConfig()
  if (resolved.ok === false) {
    logAIEvent('warn', 'control_backend_not_configured', { reason: resolved.reason, missing: resolved.missing.join(','), invalid: resolved.invalid.join(',') })
    throw new ApiError(503, 'control_unavailable', 'The control center backend is not configured for this deployment yet.')
  }
  return {
    url: resolved.config.url,
    anonKey: resolved.config.anonKey,
    admin: createClient(resolved.config.url, resolved.config.serviceRoleKey, CLIENT_OPTIONS)
  }
}

/** Atomic database rate slot. Fails closed if the limiter itself is unavailable. */
export async function takeControlRate(admin: SupabaseClient, key: string, rule: { limit: number; windowSeconds: number }, argumentsBucket = 'control-api'): Promise<void> {
  const { data, error } = await admin.rpc('control_take_rate_slot', { actor_key: key, bucket: argumentsBucket, per_limit: rule.limit, window_seconds: rule.windowSeconds })
  if (error) {
    logAIEvent('error', 'control_rate_limit_unavailable', { code: error.code ?? '' })
    throw new ApiError(503, 'rate_limit_unavailable', 'The console could not check the request limit. Try again in a moment.')
  }
  if (data !== true) throw new ApiError(429, 'rate_limited', 'Too many requests. Wait a minute, then try again.')
}

/** Writes one sanitized audit row through the service role. Returns false if the write failed. */
export async function recordAuditEvent(admin: SupabaseClient, event: AuditEvent): Promise<boolean> {
  const sanitized = sanitizeAuditSummary(event.summary) as Record<string, AuditSummaryValue>
  const beforeValue = Object.prototype.hasOwnProperty.call(sanitized, 'before') ? { before: sanitized.before } : null
  const afterValue = Object.fromEntries(Object.entries(sanitized).filter(([key]) => key !== 'before'))
  const { error } = await admin.from('control_audit_events').insert({
    request_id: cleanText(event.requestId, 80) || null,
    actor_id: event.actorId && isUuid(event.actorId) ? event.actorId : null,
    actor_role: event.actorRole ? cleanText(event.actorRole, 30) : null,
    action: event.action,
    target_type: event.targetType ? cleanText(event.targetType, 40) : null,
    target_id: event.targetId ? cleanText(event.targetId, 120) : null,
    result: event.outcome === 'failed' ? 'error' : event.outcome,
    error_category: event.errorCode ? cleanText(event.errorCode, 60) : null,
    reason: event.reason ? cleanText(event.reason, 500) : null,
    before_summary: beforeValue,
    after_summary: Object.keys(afterValue).length ? afterValue : null
  })
  if (error) {
    logAIEvent('error', 'control_audit_write_failed', { action: event.action, code: error.code ?? '' })
    return false
  }
  return true
}

/** Records a denied attempt by an authenticated, non-owner account, bounded per account. */
async function recordDeniedAccess(admin: SupabaseClient, userId: string, requestId: string, errorCode: string): Promise<void> {
  try {
    const { data } = await admin.rpc('control_take_rate_slot', { actor_key: userId, bucket: 'denied-access', per_limit: DENIED_AUDIT_LIMIT.limit, window_seconds: DENIED_AUDIT_LIMIT.windowSeconds })
    if (data !== true) return
    await recordAuditEvent(admin, { requestId, actorId: userId, actorRole: null, action: 'control.access', targetType: 'control_panel', outcome: 'denied', severity: 'notice', errorCode })
  } catch {
    // Denial logging must never change the response the caller receives.
  }
}

export interface AuthorizeOptions {
  /** Require aal2 (a verified second factor in this session). The session route uses false. */
  requireAal2: boolean
}

/**
 * Establishes the trusted control context. Every failure mode is explicit:
 *   401 unauthenticated          no bearer token, or the Auth server rejects it
 *   403 access_not_granted       a valid account without an active owner role
 *   403 mfa_required             an owner whose session is not aal2 (when required)
 *   429 rate_limited             per-account or per-IP limit exceeded
 *   503 control_unavailable      server configuration or the role lookup is unavailable
 */
export async function authorizeControl(req: ApiRequest, options: AuthorizeOptions): Promise<ControlContext> {
  const requestId = newReference('ctl')
  const token = bearerToken(req)
  const { url, anonKey, admin } = serviceClient()

  if (!token) {
    await takeControlRate(admin, `anon:${clientKeyHash(req)}`, ANONYMOUS_LIMIT, 'anonymous')
    throw new ApiError(401, 'unauthenticated', 'Sign in to open the Stracker Control Center.')
  }

  // getClaims verifies the token with the Auth server (or the project's JWKS). A forged,
  // expired or revoked token fails here, before any role or database decision is made.
  const authClient = createClient(url, anonKey, CLIENT_OPTIONS)
  const { data, error } = await authClient.auth.getClaims(token)
  const claims = (data?.claims ?? null) as Record<string, unknown> | null
  if (error || !claims || typeof claims.sub !== 'string' || !isUuid(claims.sub) || claims.role !== 'authenticated') {
    throw new ApiError(401, 'unauthenticated', 'Your session has expired. Sign in again to continue.')
  }
  const userId = claims.sub

  const { data: roleRow, error: roleError } = await admin
    .from('control_roles')
    .select('role, revoked_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (roleError) {
    logAIEvent('error', 'control_role_lookup_failed', { code: roleError.code ?? '' })
    throw new ApiError(503, 'control_unavailable', 'Access could not be verified right now. Try again in a moment.')
  }
  if (!roleGrantsConsole(roleRow?.role, roleRow?.revoked_at)) {
    await recordDeniedAccess(admin, userId, requestId, 'not_owner')
    throw new ApiError(403, 'access_not_granted', 'Access not granted.')
  }

  await takeControlRate(admin, `api:${userId}`, CONTROL_API_LIMIT)

  const aal = typeof claims.aal === 'string' ? claims.aal : 'aal1'
  if (options.requireAal2 && !isAal2(aal)) {
    throw new ApiError(403, 'mfa_required', 'Complete two-step verification to continue.', { reason: 'aal2_required' })
  }

  return {
    userId,
    role: 'owner',
    aal,
    mfaAt: latestMfaTimestamp(claims.amr),
    requestId,
    admin
  }
}

/** Sensitive operations (access changes, exports) need a TOTP verification in the last 15 minutes. */
export function requireRecentMfa(context: ControlContext, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!isRecentMfa(context.mfaAt, nowSeconds)) {
    throw new ApiError(403, 'reauthentication_required', 'Verify your authenticator code again before making this change.', { reason: 'recent_mfa_required' })
  }
}

/**
 * Standard wrapper for console endpoints: method check, no-store and no-index headers,
 * context resolution, and a consistent safe error body.
 */
export async function controlHandler(
  req: ApiRequest,
  res: ApiResponse,
  methods: string[],
  options: AuthorizeOptions,
  run: (context: ControlContext) => Promise<void>
): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  if (!methods.includes(req.method ?? '')) {
    methodNotAllowed(res, methods)
    return
  }
  try {
    const context = await authorizeControl(req, options)
    await run(context)
  } catch (error) {
    const result = publicError(error)
    sendJson(res, result.status, result.body)
  }
}

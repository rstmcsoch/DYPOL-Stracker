import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ApiRequest } from './http.js'
import { ApiError } from './http.js'
import { supabaseServerConfig, type SupabaseServerConfig } from './server-config.js'
import { logAIEvent } from './diagnostics.js'

export interface AuthenticatedRequestContext {
  userId: string
  user: User
  userClient: SupabaseClient
  adminClient: SupabaseClient
}

/**
 * Resolve the server-only Supabase configuration. This fails closed: when any server-only
 * variable is missing or malformed, every AI function answers 503 backend_not_configured with
 * the same safe public message. The precise missing variable NAMES are written to the server
 * log (never values), and /api/ai/health reports the same diagnosis, so the administrator can
 * see exactly what the deployment is missing without guessing.
 */
function supabaseEnvironment(): SupabaseServerConfig {
  const resolved = supabaseServerConfig()
  if (resolved.ok === false) {
    logAIEvent('warn', 'ai_backend_not_configured', {
      reason: resolved.reason,
      missing: resolved.missing.join(','),
      invalid: resolved.invalid.join(',')
    })
    throw new ApiError(503, 'backend_not_configured', 'The secure AI backend is not configured for this deployment yet.', { reason: resolved.reason })
  }
  return resolved.config
}

export async function authenticateRequest(req: ApiRequest): Promise<AuthenticatedRequestContext> {
  const authorization = req.headers.authorization
  const match = typeof authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null
  if (!match?.[1]) throw new ApiError(401, 'unauthenticated', 'Sign in to use Stracker AI.')

  const { url, anonKey, serviceRoleKey } = supabaseEnvironment()
  const token = match[1]
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'unauthenticated', 'Your session has expired. Sign in again to use Stracker AI.')

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  await assertNotBanned(adminClient, data.user.id)
  return { userId: data.user.id, user: data.user, userClient, adminClient }
}

/** True when a public.account_bans row is still in force (null `banned_until` = permanent). */
export function banIsActive(row: { banned_until?: unknown } | null | undefined, now = Date.now()): boolean {
  if (!row) return false
  if (row.banned_until === null || row.banned_until === undefined) return true
  const until = Date.parse(String(row.banned_until))
  return Number.isNaN(until) || until > now
}

/**
 * Defence in depth for the AI endpoints, which use the service-role client for some reads and
 * writes (bypassing the "account not banned" RLS policy). A ban already blocks the account in
 * Supabase Auth and revokes its sessions; this also refuses a still-unexpired access token, the
 * same way the Control Center does. Fails closed, like the rest of the authorisation path.
 */
async function assertNotBanned(admin: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await admin.from('account_bans').select('banned_until').eq('user_id', userId).maybeSingle()
  if (error) {
    logAIEvent('error', 'ai_ban_lookup_failed', { code: error.code ?? '' })
    throw new ApiError(503, 'auth_unavailable', 'Stracker could not verify your account right now. Try again in a moment.')
  }
  if (banIsActive(data as { banned_until?: unknown } | null)) {
    throw new ApiError(403, 'account_restricted', 'This account cannot use Stracker AI right now.')
  }
}

export function verifyOwnerRow<T extends { user_id?: string }>(row: T | null, userId: string): T {
  if (!row || row.user_id !== userId) throw new ApiError(404, 'not_found', 'That Stracker item could not be found in your account.')
  return row
}

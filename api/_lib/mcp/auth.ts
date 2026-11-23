import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest } from '../http.js'
import { ApiError } from '../http.js'
import { logAIEvent, newReference } from '../diagnostics.js'
import { supabaseServerConfig } from '../server-config.js'
import { MASTER_ACTOR_TYPE, MASTER_AUTH_METHOD, MASTER_ANON_LIMIT, MASTER_API_LIMIT, type MasterActor } from './types.js'
import { authenticateCredential, type CredentialStore, SupabaseCredentialStore } from './credentials.js'
import { presentedTokenLooksLikeJwt, isMasterTokenShape } from './token.js'
import { credentialRateKey, masterClientKey, type RateLimiter, SupabaseRateLimiter } from './rate-limit.js'

const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const

export interface MasterRuntimeClients {
  credentials: CredentialStore
  rateLimiter: RateLimiter
  now: () => Date
}

export function masterServiceClient(): SupabaseClient {
  const resolved = supabaseServerConfig()
  if (resolved.ok === false) {
    logAIEvent('warn', 'master_mcp_backend_not_configured', {
      reason: resolved.reason,
      missing: resolved.missing.join(','),
      invalid: resolved.invalid.join(',')
    })
    throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP backend is not configured for this deployment yet.')
  }
  return createClient(resolved.config.url, resolved.config.serviceRoleKey, CLIENT_OPTIONS)
}

export function productionClients(): MasterRuntimeClients {
  const admin = masterServiceClient()
  return {
    credentials: new SupabaseCredentialStore(admin),
    rateLimiter: new SupabaseRateLimiter(admin),
    now: () => new Date()
  }
}

function bearerToken(req: ApiRequest): string | null {
  const authorization = req.headers.authorization
  const match = typeof authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null
  return match?.[1] ?? null
}

const UNAUTHENTICATED = 'A valid Master MCP token is required.'

/** Unauthenticated requests must still return 401 when the Master rate-limit RPC is not migrated yet. */
async function takeAnonymousLimit(clients: MasterRuntimeClients, ipKey: string): Promise<void> {
  try {
    await clients.rateLimiter.take(ipKey, MASTER_ANON_LIMIT)
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'master_mcp_unavailable' || error.code === 'rate_limit_unavailable')) return
    throw error
  }
}

/**
 * Authenticate a Master MCP request. Student JWTs and Control Center sessions are
 * not accepted as Master authority. A revoked credential fails on the next request.
 */
export async function authorizeMaster(req: ApiRequest, clients: MasterRuntimeClients): Promise<MasterActor> {
  const requestId = newReference('mcp')
  const ipKey = masterClientKey(req)
  const token = bearerToken(req)

  if (!token) {
    await takeAnonymousLimit(clients, ipKey)
    throw new ApiError(401, 'unauthenticated', UNAUTHENTICATED)
  }

  // A session JWT is never a Master credential. Reject it before a hash lookup so a
  // student or Control Center bearer cannot be confused with Master authority.
  if (presentedTokenLooksLikeJwt(token) || !isMasterTokenShape(token)) {
    await takeAnonymousLimit(clients, ipKey)
    throw new ApiError(401, 'unauthenticated', UNAUTHENTICATED)
  }

  const record = await authenticateCredential(clients.credentials, token)
  if (!record) {
    await takeAnonymousLimit(clients, ipKey)
    throw new ApiError(401, 'unauthenticated', UNAUTHENTICATED)
  }

  await clients.rateLimiter.take(credentialRateKey(record.id), MASTER_API_LIMIT)
  await clients.rateLimiter.take(ipKey, MASTER_ANON_LIMIT)

  const now = clients.now()
  void clients.credentials.touchLastUsed(record.id, now.toISOString())

  return {
    actorType: MASTER_ACTOR_TYPE,
    connectionId: record.id,
    credentialId: record.id,
    credentialLabel: record.displayName,
    requestId,
    authenticationMethod: MASTER_AUTH_METHOD,
    authenticatedAt: now.toISOString()
  }
}

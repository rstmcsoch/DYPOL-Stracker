import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { logAIEvent } from '../diagnostics.js'
import type { ApiRequest } from '../http.js'
import { MASTER_ANON_LIMIT, MASTER_API_LIMIT } from './types.js'

export interface RateRule {
  bucket: string
  limit: number
  windowSeconds: number
}

export interface RateLimiter {
  take(actorKey: string, rule: RateRule): Promise<void>
}

/**
 * One-way fingerprint of the client address. The raw IP is never stored.
 * Prefers proxy-authoritative headers and the rightmost forwarded entry so a
 * client cannot rotate buckets by prepending X-Forwarded-For.
 */
export function masterClientKey(req: ApiRequest): string {
  const realIp = typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'].trim() : ''
  const vercelForwarded = typeof req.headers['x-vercel-forwarded-for'] === 'string'
    ? req.headers['x-vercel-forwarded-for'].split(',').at(-1)?.trim() ?? ''
    : ''
  const forwarded = req.headers['x-forwarded-for']
  const forwardedRaw = Array.isArray(forwarded) ? forwarded.at(-1) ?? '' : typeof forwarded === 'string' ? forwarded : ''
  const rightmostForwarded = forwardedRaw.split(',').map(part => part.trim()).filter(Boolean).at(-1)
  const address = realIp || vercelForwarded || rightmostForwarded || req.socket?.remoteAddress || 'unknown'
  const digest = createHash('sha256').update(`stracker-master-mcp:${address}`).digest('hex').slice(0, 32)
  return `ip:${digest}`
}

export function credentialRateKey(credentialId: string): string {
  return `cred:${credentialId}`
}

function limited(): ApiError {
  return new ApiError(429, 'rate_limited', 'Too many Master MCP requests. Wait a minute, then try again.')
}

export class MemoryRateLimiter implements RateLimiter {
  readonly events = new Map<string, number[]>()

  async take(actorKey: string, rule: RateRule, now = Date.now()): Promise<void> {
    const key = `${actorKey}:${rule.bucket}`
    const windowStart = now - rule.windowSeconds * 1000
    const stamps = (this.events.get(key) ?? []).filter(stamp => stamp > windowStart)
    if (stamps.length >= rule.limit) {
      this.events.set(key, stamps)
      throw limited()
    }
    stamps.push(now)
    this.events.set(key, stamps)
  }
}

export class SupabaseRateLimiter implements RateLimiter {
  constructor(private readonly admin: SupabaseClient) {}

  async take(actorKey: string, rule: RateRule): Promise<void> {
    const { data, error } = await this.admin.rpc('master_mcp_take_rate_slot', {
      actor_key: actorKey,
      bucket: rule.bucket,
      per_limit: rule.limit,
      window_seconds: rule.windowSeconds
    })
    if (error) {
      logAIEvent('error', 'master_mcp_rate_limit_unavailable', { code: error.code ?? '' })
      throw new ApiError(503, 'rate_limit_unavailable', 'The Master MCP could not check the request limit. Try again in a moment.')
    }
    if (data !== true) throw limited()
  }
}

export { MASTER_ANON_LIMIT, MASTER_API_LIMIT }

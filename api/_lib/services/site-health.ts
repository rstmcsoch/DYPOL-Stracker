import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateServerConfig, supabaseServerConfig } from '../server-config.js'
import { shortCommit } from '../control-policy.js'

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown'

export interface HealthCheck {
  id: string
  label: string
  status: HealthStatus
  latencyMs: number | null
  detail: string
  checkedAt: string
}

const AUTH_PROBE_TIMEOUT_MS = 4_000

/**
 * Bounded, read-only probes. Variable NAMES only; no secret values.
 * Email delivery has no probe in this codebase, so it is reported as unknown.
 */
export async function loadSiteHealth(admin: SupabaseClient, now = () => new Date().toISOString()) {
  const checks: HealthCheck[] = []

  const dbStarted = Date.now()
  const { error: dbError } = await admin.from('control_roles').select('user_id', { head: true, count: 'exact' }).limit(1)
  checks.push({
    id: 'database',
    label: 'Database connectivity',
    status: dbError ? 'unavailable' : 'healthy',
    latencyMs: Date.now() - dbStarted,
    detail: dbError ? 'The control database query failed.' : 'Read round trip to the Stracker database succeeded.',
    checkedAt: now()
  })

  const resolved = supabaseServerConfig()
  const config = evaluateServerConfig()
  checks.push({
    id: 'configuration',
    label: 'Server configuration',
    status: config.configured && resolved.ok ? 'healthy' : 'unavailable',
    latencyMs: null,
    detail: config.configured ? 'All required server variables are present.' : `Missing or malformed variable names: ${[...config.missing, ...config.invalid].join(', ') || 'unknown'}.`,
    checkedAt: now()
  })

  if (resolved.ok) {
    const authStarted = Date.now()
    try {
      const response = await fetch(`${resolved.config.url.replace(/\/+$/, '')}/auth/v1/health`, {
        headers: { apikey: resolved.config.anonKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(AUTH_PROBE_TIMEOUT_MS),
        cache: 'no-store'
      })
      checks.push({
        id: 'auth',
        label: 'Supabase Auth',
        status: response.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - authStarted,
        detail: response.ok ? 'Authentication service responded to its health endpoint.' : `Authentication service answered with HTTP ${response.status}.`,
        checkedAt: now()
      })
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      checks.push({
        id: 'auth',
        label: 'Supabase Auth',
        status: 'unavailable',
        latencyMs: Date.now() - authStarted,
        detail: timedOut ? 'The authentication health check timed out.' : 'The authentication health check could not be completed.',
        checkedAt: now()
      })
    }
  }

  checks.push({
    id: 'email',
    label: 'Email delivery',
    status: 'unknown',
    latencyMs: null,
    detail: 'No email-provider probe is configured in this deployment. Delivery settings are managed in the Supabase Auth dashboard, so this check is not inferred.',
    checkedAt: now()
  })

  const statuses = checks.filter(check => check.status !== 'unknown').map(check => check.status)
  const overall: HealthStatus = statuses.includes('unavailable') ? 'unavailable' : statuses.includes('degraded') ? 'degraded' : 'healthy'

  return {
    overall,
    checks,
    deployment: {
      commit: shortCommit(process.env.VERCEL_GIT_COMMIT_SHA),
      environment: process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development' ? process.env.VERCEL_ENV : 'unknown'
    },
    checkedAt: now()
  }
}

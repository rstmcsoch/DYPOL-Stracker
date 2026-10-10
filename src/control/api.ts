import { supabase } from '../lib/supabase'

export class ControlApiError extends Error {
  readonly status: number
  readonly code: string
  /** Optional safe hint from the server (for example `field:outcome` for an invalid filter). */
  readonly reason: string | null
  constructor(status: number, code: string, message: string, reason: string | null = null) {
    super(message)
    this.name = 'ControlApiError'
    this.status = status
    this.code = code
    this.reason = reason
  }
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new ControlApiError(503, 'not_configured', 'Cloud sign-in is not configured for this deployment.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ControlApiError(401, 'unauthenticated', 'Sign in to open the Stracker Control Center.')
  return token
}

/**
 * Calls a /api/control endpoint with the signed-in session's bearer token. The token is a
 * request header only: nothing is cached in local storage by this module, and the server
 * re-verifies it on every call.
 */
export async function controlFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const token = await accessToken()
  let response: Response
  try {
    response = await fetch(`/api/control/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      credentials: 'omit'
    })
  } catch {
    throw new ControlApiError(0, 'network', 'Could not reach the Control Center service. Check your connection and try again.')
  }
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json') ? await response.json().catch(() => null) as Record<string, unknown> | null : null
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : 'request_failed'
    const message = typeof body?.message === 'string' ? body.message : 'The request could not be completed.'
    throw new ControlApiError(response.status, code, message, typeof body?.reason === 'string' ? body.reason : null)
  }
  if (!body) throw new ControlApiError(response.status, 'unexpected_response', 'The Control Center returned an unexpected response.')
  return body as T
}

/** Export of the audit CSV: same authorization as JSON, returns the file text. */
export async function controlDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = await accessToken()
  const response = await fetch(`/api/control/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string; reason?: string } | null
    throw new ControlApiError(response.status, body?.error ?? 'request_failed', body?.message ?? 'The export could not be produced.', body?.reason ?? null)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'stracker-control-export.csv'
  return { blob: await response.blob(), filename }
}

// ---- response shapes (server contract) ----------------------------------------------

export interface SessionResponse {
  status: 'granted' | 'mfa_required'
  userId: string
  role: 'owner'
  aal: string
  recentMfa: boolean
  idleTimeoutSeconds: number
}

export interface OverviewResponse {
  generatedAt: string
  /** since/until are half-open query instants; firstDay/lastDay are the inclusive calendar days in `timezone`. */
  range: { key: 'today' | '7d' | '30d'; since: string; until: string; firstDay: string; lastDay: string; timezone: string }
  database: { status: 'healthy'; latencyMs: number }
  metrics: {
    totalAccounts: number
    registrations: number
    verifiedAccounts: number
    verifiedRatePercent: number | null
    pendingConfirmation: number
    pendingOver3Days: number
    activeAccounts: number
    suspendedAccounts: number
    testsLogged: number
    accountsWithTests: number
    trackerAdoptionPercent: number | null
  }
  series: Array<{ day: string; registrations: number; verified: number }>
  recentActivity: AuditRow[]
  definitions: Record<string, string>
}

export interface AuditRow {
  id: number | string
  occurred_at: string
  action: string
  outcome: 'success' | 'denied' | 'failed'
  severity: 'info' | 'notice' | 'warning' | 'critical'
  actor_id?: string | null
  actor_role?: string | null
  target_type?: string | null
  target_id?: string | null
  error_code?: string | null
  reason?: string | null
  summary?: Record<string, unknown> | null
  request_id?: string | null
}

export interface AuditResponse {
  events: AuditRow[]
  total: number
  page: number
  pageSize: number
  /** The filters the server actually applied (echo), including the resolved query instants. */
  filters?: { outcome: string | null; action: string | null; target: string | null; from: string | null; to: string | null; timeZone: string; since: string | null; until: string | null }
}

export interface DirectoryUser {
  id: string
  email: string
  displayName: string
  createdAt: string | null
  lastSignInAt: string | null
  emailConfirmedAt: string | null
  suspended: boolean
  testsCount: number
}

export interface UsersResponse {
  users: DirectoryUser[]
  total: number
  page: number
  pageSize: number
}

export interface UserDetailResponse {
  user: {
    id: string
    email: string
    displayName: string
    createdAt: string | null
    lastSignInAt: string | null
    emailConfirmedAt: string | null
    provider: string | null
    suspended: boolean
    bannedUntil: string | null
    adminRole: string | null
  }
  activity: { chapters: number; tests: number; mistakes: number; studySessions: number; lastTestDate: string | null }
  audit: AuditRow[]
}

export interface HealthResponse {
  overall: 'healthy' | 'degraded' | 'unavailable'
  checks: Array<{ id: string; label: string; status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'; latencyMs: number | null; detail: string; checkedAt: string }>
  deployment: { commit: string | null; environment: string }
  checkedAt: string
}

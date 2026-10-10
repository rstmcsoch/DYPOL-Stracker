import { supabase } from '../lib/supabase'

export class ControlApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ControlApiError'
    this.status = status
    this.code = code
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
    throw new ControlApiError(response.status, code, message)
  }
  if (!body) throw new ControlApiError(response.status, 'unexpected_response', 'The Control Center returned an unexpected response.')
  return body as T
}

/** Export of the audit CSV: same authorization as JSON, returns the file text. */
export async function controlDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = await accessToken()
  const response = await fetch(`/api/control/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit' })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new ControlApiError(response.status, body?.error ?? 'request_failed', body?.message ?? 'The export could not be produced.')
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
  range: { key: 'today' | '7d' | '30d'; since: string; until: string; timezone: 'UTC' }
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
  id: number
  occurred_at: string
  action: string
  outcome: 'success' | 'denied' | 'failed'
  severity: 'info' | 'notice' | 'warning' | 'critical'
  actor_id?: string | null
  actor_role?: string | null
  target_type?: string
  target_id?: string
  error_code?: string
  reason?: string
  summary?: Record<string, unknown>
  request_id?: string
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

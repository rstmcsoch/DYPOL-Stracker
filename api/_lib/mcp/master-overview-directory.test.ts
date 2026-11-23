import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'

type Row = Record<string, unknown>
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER = '11111111-1111-4111-8111-111111111111'

const world = vi.hoisted(() => ({
  users: [] as Array<Row>,
  db: {} as Record<string, Row[]>
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'in') return (value as unknown[]).includes(row[column])
      if (op === 'gte') return String(row[column] ?? '') >= String(value)
      if (op === 'lt') return String(row[column] ?? '') < String(value)
      return true
    })
  }
  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'update' = 'select'
    let patch: Row = {}
    let columns = '*'
    let head = false
    let wantCount = false
    let offset = 0
    let limit = 10_000
    const rows = () => (world.db[table] ??= [])
    const filtered = () => rows().filter(row => match(row, filters))
    const run = () => {
      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of filtered()) {
          Object.assign(row, patch)
          updated.push({ ...row })
        }
        return { data: updated, count: updated.length, error: null }
      }
      const selected = filtered().slice(offset, offset + limit)
      return { data: head ? null : selected, count: filtered().length, error: null }
    }
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: (cols?: string, options?: { count?: string; head?: boolean }) => {
        columns = cols ?? '*'
        void columns
        head = options?.head === true
        wantCount = options?.count === 'exact'
        void wantCount
        return chain
      },
      order: () => chain,
      limit: (value: number) => { limit = value; return chain },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return chain },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return chain },
      in: (column: string, value: unknown) => { filters.push(['in', column, value]); return chain },
      gte: (column: string, value: unknown) => { filters.push(['gte', column, value]); return chain },
      lt: (column: string, value: unknown) => { filters.push(['lt', column, value]); return chain },
      update: (value: Row) => { mode = 'update'; patch = value; return chain },
      maybeSingle: async () => {
        const result = run()
        const data = Array.isArray(result.data) ? result.data[0] ?? null : null
        return { data, error: result.error, count: result.count }
      },
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)
    })
    return chain
  }
  const admin = {
    from: (table: string) => builder(table),
    rpc: async (name: string) => {
      if (name === 'control_overview') {
        const now = Date.now()
        const total = world.users.length
        const verified = world.users.filter(user => user.email_confirmed_at).length
        const banned = world.users.filter(user => user.banned_until && Date.parse(String(user.banned_until)) > now).length
        return {
          data: { total_accounts: total, verified_accounts: verified, unverified_accounts: total - verified, new_accounts: total, banned_accounts: banned },
          error: null
        }
      }
      return { data: null, error: { message: 'unknown rpc' } }
    },
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: world.users.slice((page - 1) * perPage, page * perPage) },
          error: null
        }),
        getUserById: async (id: string) => ({
          data: { user: world.users.find(user => user.id === id) ?? null },
          error: world.users.some(user => user.id === id) ? null : new Error('missing')
        })
      }
    }
  }
  return { createClient: () => admin }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

function seed() {
  world.users = [
    {
      id: STUDENT_A,
      email: 'asha@example.org',
      created_at: '2026-11-01T00:00:00.000Z',
      email_confirmed_at: '2026-11-01T01:00:00.000Z',
      last_sign_in_at: '2026-11-22T08:00:00.000Z',
      banned_until: null,
      app_metadata: { provider: 'email' },
      encrypted_password: 'SHOULD-NEVER-APPEAR',
      factors: [{ factor_type: 'totp', secret: 'otp-secret' }],
      identities: [{ identity_data: { sub: 's' } }]
    },
    {
      id: STUDENT_B,
      email: 'bala@example.org',
      created_at: '2026-11-20T00:00:00.000Z',
      email_confirmed_at: null,
      last_sign_in_at: null,
      banned_until: null,
      app_metadata: { provider: 'google' },
      encrypted_password: 'ALSO-SECRET'
    },
    {
      id: OWNER,
      email: 'owner@example.org',
      created_at: '2026-01-01T00:00:00.000Z',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-11-23T00:00:00.000Z',
      banned_until: null,
      app_metadata: { provider: 'email' }
    }
  ]
  world.db = {
    profiles: [
      { user_id: STUDENT_A, display_name: 'Asha', created_at: '2026-11-01T00:00:00.000Z', email: 'asha@example.org' },
      { user_id: STUDENT_B, display_name: 'Bala', created_at: '2026-11-20T00:00:00.000Z', email: 'bala@example.org' },
      { user_id: OWNER, display_name: 'Owner', created_at: '2026-01-01T00:00:00.000Z', email: 'owner@example.org' }
    ],
    control_roles: [{ user_id: OWNER, role: 'owner', revoked_at: null }],
    control_audit_events: [
      { id: 'c1', created_at: '2026-11-22T10:00:00.000Z', action: 'user.viewed', result: 'success', actor_id: OWNER, actor_role: 'owner', target_type: 'user', target_id: STUDENT_A, error_category: null, reason: null, request_id: 'r1', before_summary: null, after_summary: { notes: 'private', ok: true } }
    ],
    master_mcp_audit_events: [
      { id: 'm1', created_at: '2026-11-22T11:00:00.000Z', action: 'mcp.list_students', result: 'success', credential_id: 'cred', credential_label: 'Ops', tool_name: 'list_students', target_type: null, target_id: null, error_category: null, reason: null, request_id: 'r2', before_summary: null, after_summary: { q: 'asha' } }
    ],
    tests: [
      { id: 't1', user_id: STUDENT_A, created_at: '2026-11-22T09:00:00.000Z', test_date: '2026-11-22', marks: 99, notes: 'secret marks' },
      { id: 't2', user_id: STUDENT_B, created_at: '2026-11-21T09:00:00.000Z', test_date: '2026-11-21', marks: 12, notes: 'other student' }
    ],
    chapters: [{ id: 'ch1', user_id: STUDENT_A }],
    mistakes: [{ id: 'ms1', user_id: STUDENT_A, notes: 'private mistake' }],
    study_sessions: [{ id: 'ss1', user_id: STUDENT_A, started_at: '2026-11-22T07:00:00.000Z', ended_at: '2026-11-22T08:00:00.000Z', duration_minutes: 60, notes: 'private session notes' }],
    daily_tasks: [{ id: 'dt1', user_id: STUDENT_A }],
    chapter_revisions: [],
    user_exam_tracks: [
      { id: 'tr1', user_id: STUDENT_A, track: 'main1', label: 'JEE Main', exam_date: '2027-01-15', enabled: true, target_score: 200, notes: 'private exam notes' }
    ],
    account_bans: [],
    account_sanctions: [
      { id: 's1', user_id: STUDENT_A, kind: 'warning', reason: 'Late work', banned_until: null, permanent: false, created_by_role: 'moderator', created_at: '2026-11-10T00:00:00.000Z', acknowledged_at: null }
    ],
    analytics_error_groups: [
      { fingerprint: 'abc', kind: 'app_error', message: 'Something failed', first_seen: '2026-11-20T00:00:00.000Z', last_seen: '2026-11-22T00:00:00.000Z', occurrences: 3, last_route: '/app', status: 'open', note: 'operator note', updated_by: OWNER }
    ],
    test_chapter_links: [],
    test_subject_scores: [],
    test_error_logs: [],
    test_time_entries: [],
    practice_sessions: [],
    pyq_records: [],
    chapter_stages: [],
    backlog_items: [],
    study_cards: [],
    weekly_goals: [],
    app_settings: [{ id: STUDENT_A, user_id: STUDENT_A, owner_name: 'Asha' }]
  }
}

function admin(): SupabaseClient {
  return createClient('https://project.supabase.co', 'service-test-key')
}

function fakeReq(token: string, body: unknown): ApiRequest {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body, url: '/api/mcp' } as ApiRequest
}

function fakeRes(): ApiResponse & { body: unknown } {
  const res = { statusCode: 200, body: undefined as unknown, headersSent: false, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value },
    json(body: unknown) { res.body = body; res.headersSent = true },
    end(data?: unknown) { if (data !== undefined && res.body === undefined) res.body = data; res.headersSent = true } }
  return res as unknown as ApiResponse & { body: unknown }
}

async function runtime() {
  const credentials = new MemoryCredentialStore()
  const issued = await createCredential(credentials, { displayName: 'Operations agent', createdBy: null })
  const audit = new MemoryAuditSink()
  const options = testHandlerOptions(
    { credentials, rateLimiter: new MemoryRateLimiter(), now: () => new Date('2026-11-23T10:00:00.000Z') },
    createMasterToolRegistry(undefined, { admin: admin() }),
    audit
  )
  return { issued, options, audit }
}

async function callTool(token: string, name: string, args: Record<string, unknown>, options: Awaited<ReturnType<typeof runtime>>['options']) {
  const res = fakeRes()
  await handleMasterMcp(fakeReq(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), res, options)
  const payload = (res.body as { result: { isError?: boolean; structuredContent: Record<string, unknown> } }).result
  return { status: res.statusCode, payload }
}

const SECRET = /encrypted_password|otp-secret|SHOULD-NEVER-APPEAR|ALSO-SECRET|passkey|password_hash|token_hash|private exam notes|secret marks|private mistake|private session notes|operator note/

beforeEach(() => {
  seed()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Master MCP overview and diagnostics tools', () => {
  it('returns live overview, account, daily activity and health metrics without fabricating data', async () => {
    const { issued, options } = await runtime()
    const overview = await callTool(issued.token, 'get_master_overview', { range: '30d', timeZone: 'UTC' }, options)
    expect(overview.payload.isError).toBeFalsy()
    const metrics = overview.payload.structuredContent.metrics as { totalAccounts: number; registrations: number }
    expect(metrics.totalAccounts).toBe(3)
    expect(metrics.registrations).toBe(3)
    expect(JSON.stringify(overview.payload)).not.toMatch(SECRET)
    expect((overview.payload.structuredContent as { actor?: { type: string } }).actor?.type).not.toBe('owner')

    const accounts = await callTool(issued.token, 'get_account_overview', { range: '30d', timeZone: 'UTC' }, options)
    expect((accounts.payload.structuredContent as { metrics: { totalAccounts: number } }).metrics.totalAccounts).toBe(3)
    expect(accounts.payload.structuredContent).not.toHaveProperty('series')

    const daily = await callTool(issued.token, 'get_daily_activity', { range: '30d', timeZone: 'UTC' }, options)
    const series = (daily.payload.structuredContent as { series: Array<{ day: string; testsLogged: number }> }).series
    expect(series.some(point => point.testsLogged > 0)).toBe(true)

    const health = await callTool(issued.token, 'get_site_health', {}, options)
    expect((health.payload.structuredContent as { overall: string; checks: Array<{ id: string; status: string }> }).overall).toBeTruthy()
    expect(JSON.stringify(health.payload)).not.toMatch(/service-test-key|anon-test-key/)
  })

  it('lists recent errors and read-only audit events without notes or secrets', async () => {
    const { issued, options } = await runtime()
    const errors = await callTool(issued.token, 'get_recent_errors', { page: 1, pageSize: 25, status: 'open' }, options)
    const groups = (errors.payload.structuredContent as { groups: Array<Record<string, unknown>> }).groups
    expect(groups).toEqual([expect.objectContaining({ fingerprint: 'abc', kind: 'app_error', status: 'open' })])
    expect(JSON.stringify(groups)).not.toContain('operator note')
    expect(JSON.stringify(groups)).not.toContain(OWNER)

    const audit = await callTool(issued.token, 'get_audit_events', { source: 'all', page: 1, pageSize: 20 }, options)
    const events = (audit.payload.structuredContent as { events: Array<Record<string, unknown>>; readOnly: boolean }).events
    expect(events.some(event => event.source === 'control')).toBe(true)
    expect(events.some(event => event.source === 'master_mcp' && event.actorRole === 'master_mcp')).toBe(true)
    expect((audit.payload.structuredContent as { readOnly: boolean }).readOnly).toBe(true)
    expect(JSON.stringify(audit.payload)).not.toContain('private')
  })
})

describe('Master MCP student directory tools', () => {
  it('lists and searches students with bounded pagination and no security fields', async () => {
    const { issued, options } = await runtime()
    const listed = await callTool(issued.token, 'list_students', { page: 1, pageSize: 2, sort: 'created_asc' }, options)
    const body = listed.payload.structuredContent as { users: Array<Record<string, unknown>>; total: number; pageSize: number }
    expect(body.pageSize).toBe(2)
    expect(body.users).toHaveLength(2)
    expect(body.total).toBe(3)
    expect(body.users[0]?.id).toBe(OWNER)
    const serialized = JSON.stringify(listed.payload)
    expect(serialized).not.toMatch(SECRET)
    expect(serialized).not.toMatch(/factors|identities|encrypted_password|passkey|totp/)

    const page2 = await callTool(issued.token, 'list_students', { page: 2, pageSize: 2, sort: 'created_asc' }, options)
    expect((page2.payload.structuredContent as { users: Array<{ id: string }> }).users).toHaveLength(1)

    const tooBig = await callTool(issued.token, 'list_students', { pageSize: 101 }, options)
    expect(tooBig.payload.isError).toBe(true)
    expect(tooBig.payload.structuredContent.error).toBe('invalid_arguments')

    const search = await callTool(issued.token, 'search_students', { q: 'asha' }, options)
    const found = (search.payload.structuredContent as { users: Array<{ id: string; email: string }> }).users
    expect(found.map(user => user.id)).toEqual([STUDENT_A])
    expect(found[0]?.email).toBe('asha@example.org')

    const missingQuery = await callTool(issued.token, 'search_students', {}, options)
    expect(missingQuery.payload.structuredContent.error).toBe('invalid_arguments')
  })

  it('scopes account, activity, study overview and moderation history to the requested student', async () => {
    const { issued, options } = await runtime()
    const account = await callTool(issued.token, 'get_student_account', { studentId: STUDENT_A }, options)
    const student = (account.payload.structuredContent as { student: Record<string, unknown>; examTracks: Array<Record<string, unknown>>; usage: { tests: number } }).student
    expect(student.id).toBe(STUDENT_A)
    expect(student.displayName).toBe('Asha')
    expect(student.emailVerified).toBe(true)
    expect((account.payload.structuredContent as { usage: { tests: number } }).usage.tests).toBe(1)
    expect((account.payload.structuredContent as { examTracks: Array<{ notes?: string; track: string }> }).examTracks).toEqual([
      expect.objectContaining({ track: 'main1', label: 'JEE Main' })
    ])
    const accountJson = JSON.stringify(account.payload)
    expect(accountJson).not.toMatch(SECRET)
    expect(accountJson).not.toContain('private exam notes')
    expect(accountJson).not.toContain(STUDENT_B)
    expect(account.payload.structuredContent).not.toHaveProperty('can')

    const other = await callTool(issued.token, 'get_student_account', { studentId: STUDENT_B }, options)
    expect((other.payload.structuredContent as { student: { id: string }; usage: { tests: number } }).usage.tests).toBe(1)
    expect(JSON.stringify(other.payload)).not.toContain(STUDENT_A)

    const activity = await callTool(issued.token, 'get_student_activity', { studentId: STUDENT_A }, options)
    expect(JSON.stringify(activity.payload)).not.toMatch(SECRET)
    expect((activity.payload.structuredContent as { studentId: string }).studentId).toBe(STUDENT_A)

    const study = await callTool(issued.token, 'get_student_study_overview', { studentId: STUDENT_A }, options)
    const records = (study.payload.structuredContent as { records: Array<{ table: string; count: number }> }).records
    expect(records.find(row => row.table === 'tests')?.count).toBe(1)
    expect(records.find(row => row.table === 'chapters')?.count).toBe(1)
    expect(JSON.stringify(study.payload)).not.toMatch(SECRET)

    const moderation = await callTool(issued.token, 'get_student_moderation_history', { studentId: STUDENT_A }, options)
    expect((moderation.payload.structuredContent as { sanctions: Array<{ kind: string }> }).sanctions[0]?.kind).toBe('warning')
  })

  it('updates only the display name of an ordinary student and refuses Owner or extra identity fields', async () => {
    const { issued, options, audit } = await runtime()
    const updated = await callTool(issued.token, 'update_student_display_profile', { studentId: STUDENT_A, displayName: 'Asha Rao' }, options)
    expect(updated.payload.isError).toBeFalsy()
    expect(updated.payload.structuredContent).toMatchObject({ studentId: STUDENT_A, displayName: 'Asha Rao', previousDisplayName: 'Asha', changedFields: ['displayName'] })
    expect(world.db.profiles!.find(row => row.user_id === STUDENT_A)?.display_name).toBe('Asha Rao')
    expect(world.db.profiles!.find(row => row.user_id === STUDENT_B)?.display_name).toBe('Bala')
    expect(world.users.find(user => user.id === STUDENT_A)?.email).toBe('asha@example.org')
    expect(audit.events.some(event => event.action === 'mcp.update_student_display_profile' && event.targetStudentId === STUDENT_A && event.result === 'success')).toBe(true)

    const owner = await callTool(issued.token, 'update_student_display_profile', { studentId: OWNER, displayName: 'Nope' }, options)
    expect(owner.payload.isError).toBe(true)
    expect(owner.payload.structuredContent.error).toBe('forbidden')
    expect(world.db.profiles!.find(row => row.user_id === OWNER)?.display_name).toBe('Owner')

    const extra = await callTool(issued.token, 'update_student_display_profile', { studentId: STUDENT_A, displayName: 'Asha', email: 'evil@example.org' }, options)
    expect(extra.payload.structuredContent.error).toBe('invalid_arguments')
  })
})

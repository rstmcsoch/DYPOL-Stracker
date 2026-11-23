import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { hashMasterSecret } from './token.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { assertDeletionUnreachable } from '../services/student-moderation.js'
import * as moderation from '../services/student-moderation.js'

type Row = Record<string, unknown>
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const CHAPTER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHAPTER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const TEST_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const TEST_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const MISTAKE_A = '99999999-9999-4999-8999-999999999999'
const SCORE_A = '88888888-8888-4888-8888-888888888888'
const LINK_A = '77777777-7777-4777-8777-777777777777'

const world = vi.hoisted(() => ({
  users: [] as Array<Row>,
  db: {} as Record<string, Row[]>,
  banUpdates: [] as Array<{ id: string; patch: Row }>,
  deleteUserCalls: [] as string[]
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'in') return (value as unknown[]).includes(row[column])
      if (op === 'gte') return String(row[column] ?? '') >= String(value)
      if (op === 'lt') return String(row[column] ?? '') < String(value)
      if (op === 'ilike') {
        const needle = String(value).replace(/%/g, '').toLowerCase()
        return String(row[column] ?? '').toLowerCase().includes(needle)
      }
      return true
    })
  }
  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let mode: 'select' | 'update' | 'insert' | 'delete' | 'upsert' = 'select'
    let patch: Row = {}
    let inserted: Row[] = []
    let columns = '*'
    let head = false
    let wantCount = false
    let offset = 0
    let limit = 10_000
    let orderColumn: string | null = null
    let ascending = true
    const rows = () => (world.db[table] ??= [])
    const filtered = () => {
      const found = rows().filter(row => match(row, filters))
      if (!orderColumn) return found
      const column = orderColumn
      return [...found].sort((a, b) => {
        const left = String(a[column] ?? '')
        const right = String(b[column] ?? '')
        return ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    const run = () => {
      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of filtered()) {
          Object.assign(row, patch)
          updated.push({ ...row })
        }
        return { data: updated, count: updated.length, error: null }
      }
      if (mode === 'insert') return { data: inserted, count: inserted.length, error: null }
      if (mode === 'upsert') return { data: inserted, count: inserted.length, error: null }
      if (mode === 'delete') {
        const removed: Row[] = []
        world.db[table] = rows().filter(row => {
          if (match(row, filters)) {
            removed.push({ ...row })
            return false
          }
          return true
        })
        return { data: removed, count: removed.length, error: null }
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
      order: (column: string, options?: { ascending?: boolean }) => {
        orderColumn = column
        ascending = options?.ascending !== false
        return chain
      },
      limit: (value: number) => { limit = value; return chain },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return chain },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return chain },
      in: (column: string, value: unknown) => { filters.push(['in', column, value]); return chain },
      gte: (column: string, value: unknown) => { filters.push(['gte', column, value]); return chain },
      lt: (column: string, value: unknown) => { filters.push(['lt', column, value]); return chain },
      ilike: (column: string, value: unknown) => { filters.push(['ilike', column, value]); return chain },
      update: (value: Row) => { mode = 'update'; patch = value; return chain },
      insert: (value: Row | Row[]) => {
        mode = 'insert'
        inserted = (Array.isArray(value) ? value : [value]).map(row => ({ ...row }))
        rows().push(...inserted)
        return chain
      },
      upsert: (value: Row, _options?: unknown) => {
        mode = 'upsert'
        void _options
        const incoming = { ...value }
        const existing = rows().find(row => row.user_id === incoming.user_id && incoming.user_id)
        if (existing) Object.assign(existing, incoming)
        else rows().push(incoming)
        inserted = [existing ? { ...existing } : incoming]
        return chain
      },
      delete: () => { mode = 'delete'; return chain },
      maybeSingle: async () => {
        const result = run()
        const data = Array.isArray(result.data) ? result.data[0] ?? null : null
        return { data, error: result.error, count: result.count }
      },
      single: async () => {
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
      if (name === 'control_revoke_user_sessions') return { data: true, error: null }
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
        }),
        updateUserById: async (id: string, patch: Row) => {
          const user = world.users.find(row => row.id === id)
          if (!user) return { data: { user: null }, error: new Error('missing') }
          world.banUpdates.push({ id, patch })
          if (patch.ban_duration === 'none') user.banned_until = null
          else if (typeof patch.ban_duration === 'string') user.banned_until = '2099-01-01T00:00:00.000Z'
          return { data: { user }, error: null }
        },
        deleteUser: async (id: string) => {
          world.deleteUserCalls.push(id)
          throw new Error('Master tests must never call Auth deleteUser')
        }
      }
    }
  }
  return { createClient: () => admin }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

function seed() {
  world.banUpdates = []
  world.deleteUserCalls = []
  world.users = [
    {
      id: STUDENT_A, email: 'asha@example.org', created_at: '2026-11-01T00:00:00.000Z',
      email_confirmed_at: '2026-11-01T01:00:00.000Z', last_sign_in_at: '2026-11-22T08:00:00.000Z',
      banned_until: null, app_metadata: { provider: 'email' }
    },
    {
      id: STUDENT_B, email: 'bala@example.org', created_at: '2026-11-20T00:00:00.000Z',
      email_confirmed_at: null, last_sign_in_at: null, banned_until: null, app_metadata: { provider: 'google' }
    },
    {
      id: OWNER, email: 'owner@example.org', created_at: '2026-01-01T00:00:00.000Z',
      email_confirmed_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: '2026-11-23T00:00:00.000Z',
      banned_until: null, app_metadata: { provider: 'email' }
    },
    {
      id: MODERATOR, email: 'mod@example.org', created_at: '2026-02-01T00:00:00.000Z',
      email_confirmed_at: '2026-02-01T00:00:00.000Z', last_sign_in_at: '2026-11-20T00:00:00.000Z',
      banned_until: null, app_metadata: { provider: 'email' }
    }
  ]
  world.db = {
    profiles: [
      { user_id: STUDENT_A, display_name: 'Asha' },
      { user_id: STUDENT_B, display_name: 'Bala' },
      { user_id: OWNER, display_name: 'Owner' },
      { user_id: MODERATOR, display_name: 'Mod' }
    ],
    control_roles: [
      { user_id: OWNER, role: 'owner', revoked_at: null },
      { user_id: MODERATOR, role: 'moderator', revoked_at: null }
    ],
    account_bans: [],
    account_sanctions: [],
    chapters: [
      { id: CHAPTER_A, user_id: STUDENT_A, subject: 'Physics', name: 'Kinematics', position: 1, status: 'Studying', priority: 'High', importance: 'high', notes: 'private chapter notes', formula_notes: '', created_at: '2026-11-01T00:00:00.000Z' },
      { id: CHAPTER_B, user_id: STUDENT_B, subject: 'Maths', name: 'Calculus', position: 1, status: 'Done', priority: 'Medium', importance: 'medium', notes: 'other student chapter', formula_notes: '', created_at: '2026-11-02T00:00:00.000Z' }
    ],
    tests: [
      {
        id: TEST_A, user_id: STUDENT_A, title: 'Mock 1', test_date: '2026-11-20', test_type: 'Full Mock',
        subject: null, chapter_id: null, marks_obtained: 80, total_marks: 100, correct: 40, wrong: 10, skipped: 0,
        total_questions: 50, negative_marks: 0, time_minutes: 180, percentile: 90, notes: 'private test notes', created_at: '2026-11-20T00:00:00.000Z'
      },
      {
        id: TEST_B, user_id: STUDENT_B, title: 'Bala mock', test_date: '2026-11-21', test_type: 'Chapter Test',
        subject: 'Maths', chapter_id: CHAPTER_B, marks_obtained: 20, total_marks: 100, correct: 5, wrong: 5, skipped: 0,
        total_questions: 10, negative_marks: 0, time_minutes: 30, notes: 'other student test', created_at: '2026-11-21T00:00:00.000Z'
      }
    ],
    test_subject_scores: [
      { id: SCORE_A, user_id: STUDENT_A, test_id: TEST_A, subject: 'Physics', marks_obtained: 30, total_marks: 33, created_at: '2026-11-20T00:00:00.000Z' },
      { id: '88888888-8888-4888-8888-888888888881', user_id: STUDENT_A, test_id: TEST_A, subject: 'Chemistry', marks_obtained: 25, total_marks: 33, created_at: '2026-11-20T00:00:00.000Z' },
      { id: '88888888-8888-8888-8888-888888888882', user_id: STUDENT_A, test_id: TEST_A, subject: 'Maths', marks_obtained: 25, total_marks: 34, created_at: '2026-11-20T00:00:00.000Z' }
    ],
    test_chapter_links: [
      { id: LINK_A, user_id: STUDENT_A, test_id: TEST_A, chapter_id: CHAPTER_A, marks_obtained: 8, total_marks: 10, created_at: '2026-11-20T00:00:00.000Z' }
    ],
    mistakes: [
      { id: MISTAKE_A, user_id: STUDENT_A, chapter_id: CHAPTER_A, test_id: TEST_A, mistake_type: 'Concept', question_note: 'private question note', solution_note: 'private solution', created_at: '2026-11-20T00:00:00.000Z' }
    ],
    chapter_revisions: [],
    study_cards: [],
    daily_tasks: [
      { id: 'task-today', user_id: STUDENT_A, title: 'Revise', is_completed: false, task_date: new Date().toISOString().slice(0, 10), chapter_id: CHAPTER_A },
      { id: 'task-late', user_id: STUDENT_A, title: 'Overdue', is_completed: false, task_date: '2026-01-01', chapter_id: CHAPTER_A }
    ],
    study_sessions: [{ id: 'ss1', user_id: STUDENT_A, started_at: '2026-11-22T07:00:00.000Z', ended_at: '2026-11-22T08:00:00.000Z', duration_minutes: 60 }],
    app_settings: [{
      id: STUDENT_A, user_id: STUDENT_A, owner_name: 'Asha', main_exam_date: '2027-01-15', advanced_exam_date: '',
      target_score: 240, theme: 'dark', weak_threshold: 60, strong_threshold: 80, dropping_threshold: 10,
      revision_gaps: [1, 7, 30], daily_study_goal_minutes: 360, sound_enabled: false, last_backup_at: '2026-11-20T00:00:00.000Z'
    }]
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
  const confirmations = new MemoryConfirmationStore()
  const options = testHandlerOptions(
    { credentials, rateLimiter: new MemoryRateLimiter(), now: () => new Date('2026-11-23T10:00:00.000Z') },
    createMasterToolRegistry(undefined, { admin: admin(), confirmations }),
    audit
  )
  return { issued, options, audit, confirmations }
}

async function callTool(token: string, name: string, args: Record<string, unknown>, options: Awaited<ReturnType<typeof runtime>>['options']) {
  const res = fakeRes()
  await handleMasterMcp(fakeReq(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), res, options)
  const payload = (res.body as { result: { isError?: boolean; structuredContent: Record<string, unknown> } }).result
  return { status: res.statusCode, payload }
}

beforeEach(() => {
  seed()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Master MCP student sanctions (fixture users only)', () => {
  it('previews a warning, then applies it after confirmation, and rejects replay, mismatch and expiry', async () => {
    const { issued, options, confirmations } = await runtime()
    const preview = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Missed a check-in deadline' }, options)
    expect(preview.payload.isError).toBeFalsy()
    const body = preview.payload.structuredContent as { needsConfirmation: boolean; confirmationToken: string; operation: string; targetId: string }
    expect(body.needsConfirmation).toBe(true)
    expect(body.operation).toBe('warn_student')
    expect(body.targetId).toBe(STUDENT_A)
    expect(world.db.account_sanctions!).toHaveLength(0)
    expect(world.deleteUserCalls).toHaveLength(0)

    const confirmed = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Missed a check-in deadline', confirmationToken: body.confirmationToken }, options)
    expect(confirmed.payload.isError).toBeFalsy()
    expect(confirmed.payload.structuredContent).toMatchObject({ ok: true, action: 'warn', studentId: STUDENT_A })
    expect(world.db.account_sanctions!).toHaveLength(1)
    expect(world.db.account_sanctions![0]).toMatchObject({ user_id: STUDENT_A, kind: 'warning', created_by: null, created_by_role: 'master_mcp', reason: 'Missed a check-in deadline' })

    const replay = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Missed a check-in deadline', confirmationToken: body.confirmationToken }, options)
    expect(replay.payload.isError).toBe(true)
    expect(String(replay.payload.structuredContent.message)).toMatch(/already been used/)

    const preview2 = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Second warning after review' }, options)
    const token2 = (preview2.payload.structuredContent as { confirmationToken: string }).confirmationToken
    const mismatch = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'A different reason text here', confirmationToken: token2 }, options)
    expect(mismatch.payload.isError).toBe(true)
    expect(String(mismatch.payload.structuredContent.message)).toMatch(/does not match/)
    expect(world.db.account_sanctions!).toHaveLength(1)

    const preview3 = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Expired confirmation case' }, options)
    const token3 = (preview3.payload.structuredContent as { confirmationToken: string }).confirmationToken
    const record = confirmations.rows.get(hashMasterSecret(token3))
    expect(record).toBeTruthy()
    record!.expiresAt = '2026-11-23T09:00:00.000Z'
    const expired = await callTool(issued.token, 'warn_student', { studentId: STUDENT_A, reason: 'Expired confirmation case', confirmationToken: token3 }, options)
    expect(expired.payload.isError).toBe(true)
    expect(String(expired.payload.structuredContent.message)).toMatch(/expired/)
    expect(world.deleteUserCalls).toHaveLength(0)
  })

  it('bans and unbans a fixture student after confirmation, and refuses Owner or Control Centre holders', async () => {
    const { issued, options } = await runtime()
    const preview = await callTool(issued.token, 'ban_student', { studentId: STUDENT_A, reason: 'Repeated policy breaches today', permanent: true }, options)
    const token = (preview.payload.structuredContent as { confirmationToken: string; needsConfirmation: boolean }).confirmationToken
    expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
    expect(world.db.account_bans!).toHaveLength(0)

    const banned = await callTool(issued.token, 'ban_student', { studentId: STUDENT_A, reason: 'Repeated policy breaches today', permanent: true, confirmationToken: token }, options)
    expect(banned.payload.isError).toBeFalsy()
    expect(banned.payload.structuredContent).toMatchObject({ ok: true, action: 'ban', permanent: true, studentId: STUDENT_A })
    expect(world.banUpdates.some(update => update.id === STUDENT_A && update.patch.ban_duration === '876000h')).toBe(true)
    expect(world.db.account_bans![0]).toMatchObject({ user_id: STUDENT_A, banned_until: null, created_by: null })
    expect(world.db.account_sanctions!.some(row => row.kind === 'ban' && row.created_by_role === 'master_mcp' && row.created_by === null)).toBe(true)
    expect(world.deleteUserCalls).toHaveLength(0)

    const unbanPreview = await callTool(issued.token, 'unban_student', { studentId: STUDENT_A, reason: 'Appeal accepted after review' }, options)
    const unbanToken = (unbanPreview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    const unbanned = await callTool(issued.token, 'unban_student', { studentId: STUDENT_A, reason: 'Appeal accepted after review', confirmationToken: unbanToken }, options)
    expect(unbanned.payload.isError).toBeFalsy()
    expect(world.db.account_bans!).toHaveLength(0)
    expect(world.banUpdates.some(update => update.id === STUDENT_A && update.patch.ban_duration === 'none')).toBe(true)
    expect(world.db.account_sanctions!.some(row => row.kind === 'unban' && row.created_by_role === 'master_mcp')).toBe(true)

    const ownerPreview = await callTool(issued.token, 'ban_student', { studentId: OWNER, reason: 'Should never succeed here', permanent: true }, options)
    expect(ownerPreview.payload.isError).toBe(true)
    expect(ownerPreview.payload.structuredContent.error).toBe('forbidden')
    expect(String(ownerPreview.payload.structuredContent.message)).toMatch(/owner/i)

    const staff = await callTool(issued.token, 'warn_student', { studentId: MODERATOR, reason: 'Should never succeed here' }, options)
    expect(staff.payload.isError).toBe(true)
    expect(staff.payload.structuredContent.error).toBe('forbidden')
    expect(world.deleteUserCalls).toHaveLength(0)
    expect(world.users).toHaveLength(4)
  })

  it('refuses every user-deletion tool name and keeps the deletion sanction unreachable', async () => {
    const { issued, options } = await runtime()
    for (const name of ['delete_student', 'delete_user', 'delete_auth_user', 'permanently_delete_user']) {
      const result = await callTool(issued.token, name, { studentId: STUDENT_A }, options)
      expect(result.payload.isError).toBe(true)
      expect(result.payload.structuredContent.error).toBe('forbidden_tool')
    }
    expect(moderation).not.toHaveProperty('deleteStudent')
    expect(moderation).not.toHaveProperty('deleteUser')
    expect(() => assertDeletionUnreachable()).toThrow(/cannot delete a user account/)
    expect(world.deleteUserCalls).toHaveLength(0)
    expect(world.users.map(user => user.id)).toEqual([STUDENT_A, STUDENT_B, OWNER, MODERATOR])
  })
})

describe('Master MCP study record tools', () => {
  it('creates, lists and updates chapters and tests with shared validation, and refuses cross-student IDs', async () => {
    const { issued, options } = await runtime()
    const created = await callTool(issued.token, 'manage_student_chapters', {
      action: 'create', studentId: STUDENT_A,
      record: { subject: 'Chemistry', name: 'Atomic Structure', status: 'Not Started' }
    }, options)
    expect(created.payload.isError).toBeFalsy()
    const chapter = created.payload.structuredContent as { id: string; user_id: string; name: string }
    expect(chapter.user_id).toBe(STUDENT_A)
    expect(chapter.name).toBe('Atomic Structure')

    const listed = await callTool(issued.token, 'manage_student_chapters', { action: 'search', studentId: STUDENT_A, q: 'Atomic', pageSize: 25 }, options)
    expect((listed.payload.structuredContent as { records: Array<{ name: string }> }).records.some(row => row.name === 'Atomic Structure')).toBe(true)

    const invalid = await callTool(issued.token, 'manage_student_chapters', {
      action: 'create', studentId: STUDENT_A, record: { subject: 'Biology', name: 'Nope' }
    }, options)
    expect(invalid.payload.isError).toBe(true)

    const crossChapter = await callTool(issued.token, 'manage_student_chapters', { action: 'update', studentId: STUDENT_A, id: CHAPTER_B, record: { name: 'Hijack' } }, options)
    expect(crossChapter.payload.structuredContent.error).toBe('forbidden')
    expect(world.db.chapters!.find(row => row.id === CHAPTER_B)?.name).toBe('Calculus')

    const testCreate = await callTool(issued.token, 'manage_student_tests', {
      action: 'create', studentId: STUDENT_A,
      record: {
        title: 'Chapter quiz', test_date: '2026-11-22', test_type: 'Chapter Test',
        marks_obtained: 9, total_marks: 10, correct: 9, wrong: 1, skipped: 0,
        total_questions: 10, negative_marks: 0, time_minutes: 30, notes: ''
      }
    }, options)
    expect(testCreate.payload.isError).toBeFalsy()
    expect((testCreate.payload.structuredContent as { user_id: string }).user_id).toBe(STUDENT_A)

    const badMarks = await callTool(issued.token, 'manage_student_tests', {
      action: 'create', studentId: STUDENT_A,
      record: {
        title: 'Impossible score', test_date: '2026-11-22', test_type: 'Chapter Test',
        marks_obtained: 50, total_marks: 10, correct: 1, wrong: 0, skipped: 0, notes: ''
      }
    }, options)
    expect(badMarks.payload.isError).toBe(true)

    const crossTest = await callTool(issued.token, 'manage_student_tests', {
      action: 'update', studentId: STUDENT_A, id: TEST_B, record: { title: 'Stolen' }
    }, options)
    expect(crossTest.payload.structuredContent.error).toBe('forbidden')
    expect(world.db.tests!.find(row => row.id === TEST_B)?.title).toBe('Bala mock')

    const crossScore = await callTool(issued.token, 'manage_student_subject_scores', {
      action: 'create', studentId: STUDENT_A, testId: TEST_B, subject: 'Maths', marks_obtained: 1, total_marks: 10
    }, options)
    expect(crossScore.payload.structuredContent.error).toBe('forbidden')

    const crossLink = await callTool(issued.token, 'manage_student_test_chapter_links', {
      action: 'create', studentId: STUDENT_A, testId: TEST_A, chapterId: CHAPTER_B, marks_obtained: 1, total_marks: 10
    }, options)
    expect(crossLink.payload.structuredContent.error).toBe('forbidden')

    const crossMistake = await callTool(issued.token, 'manage_student_mistakes', {
      action: 'update', studentId: STUDENT_B, id: MISTAKE_A, record: { mistake_type: 'Silly' }
    }, options)
    expect(crossMistake.payload.structuredContent.error).toBe('forbidden')
  })

  it('requires confirmation before deleting tests, mistakes and chapters, then deletes only the named student record', async () => {
    const { issued, options } = await runtime()
    const testPreview = await callTool(issued.token, 'manage_student_tests', { action: 'delete', studentId: STUDENT_A, id: TEST_A }, options)
    expect(testPreview.payload.structuredContent.needsConfirmation).toBe(true)
    expect((testPreview.payload.structuredContent as { relatedRecords: { mistakes: number } }).relatedRecords.mistakes).toBe(1)
    expect(world.db.tests!.some(row => row.id === TEST_A)).toBe(true)

    const testDeleted = await callTool(issued.token, 'manage_student_tests', {
      action: 'delete', studentId: STUDENT_A, id: TEST_A,
      confirmationToken: (testPreview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(testDeleted.payload.structuredContent).toMatchObject({ ok: true, testId: TEST_A })
    expect(world.db.tests!.some(row => row.id === TEST_A)).toBe(false)
    expect(world.db.tests!.some(row => row.id === TEST_B)).toBe(true)

    const mistakePreview = await callTool(issued.token, 'manage_student_mistakes', { action: 'delete', studentId: STUDENT_A, id: MISTAKE_A }, options)
    expect(mistakePreview.payload.structuredContent.needsConfirmation).toBe(true)
    await callTool(issued.token, 'manage_student_mistakes', {
      action: 'delete', studentId: STUDENT_A, id: MISTAKE_A,
      confirmationToken: (mistakePreview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(world.db.mistakes!.some(row => row.id === MISTAKE_A)).toBe(false)

    const chapterPreview = await callTool(issued.token, 'manage_student_chapters', { action: 'delete', studentId: STUDENT_A, id: CHAPTER_A }, options)
    expect(chapterPreview.payload.structuredContent.needsConfirmation).toBe(true)
    await callTool(issued.token, 'manage_student_chapters', {
      action: 'delete', studentId: STUDENT_A, id: CHAPTER_A,
      confirmationToken: (chapterPreview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(world.db.chapters!.some(row => row.id === CHAPTER_A)).toBe(false)
    expect(world.db.chapters!.some(row => row.id === CHAPTER_B)).toBe(true)
    expect(world.deleteUserCalls).toHaveLength(0)
  })

  it('reads dashboard, settings and analytics from stored records without inventing metrics', async () => {
    const { issued, options } = await runtime()
    const dashboard = await callTool(issued.token, 'get_student_dashboard', { studentId: STUDENT_A }, options)
    const dash = dashboard.payload.structuredContent as { tests: { count: number; meanPercentage: number | null }; tasks: { dueToday: number; overdue: number }; chapters: { total: number } }
    expect(dash.tests.count).toBe(1)
    expect(dash.tests.meanPercentage).toBe(80)
    expect(dash.chapters.total).toBe(1)
    expect(dash.tasks.dueToday).toBe(1)
    expect(dash.tasks.overdue).toBe(1)

    const settings = await callTool(issued.token, 'get_student_settings', { studentId: STUDENT_A }, options)
    const body = settings.payload.structuredContent as { available: boolean; settings: { theme: string; target_score: number } }
    expect(body.available).toBe(true)
    expect(body.settings.theme).toBe('dark')
    expect(body.settings.target_score).toBe(240)

    const analytics = await callTool(issued.token, 'get_student_analytics', { studentId: STUDENT_A }, options)
    const stats = analytics.payload.structuredContent as { tests: { meanPercentage: number }; byType: Record<string, { count: number; meanPercentage: number | null }> }
    expect(stats.tests.meanPercentage).toBe(80)
    expect(stats.byType['Full Mock']?.count).toBe(1)
    expect(stats.byType['Full Mock']?.meanPercentage).toBe(80)

    const other = await callTool(issued.token, 'get_student_dashboard', { studentId: STUDENT_B }, options)
    expect((other.payload.structuredContent as { tests: { meanPercentage: number } }).tests.meanPercentage).toBe(20)
    expect(JSON.stringify(other.payload)).not.toContain('private test notes')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { indiaToday, plusDays } from '../../../src/lib/date.js'

type Row = Record<string, unknown>
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CHAPTER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CHAPTER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const REV_A = 'a1111111-1111-4111-8111-111111111111'
const TASK_A = 'a2111111-1111-4111-8111-111111111111'
const TASK_B = 'a2222222-2222-4222-8222-222222222222'
const GOAL_A = 'a3111111-1111-4111-8111-111111111111'
const SESSION_ACTIVE = 'a4111111-1111-4111-8111-111111111111'
const SESSION_DONE = 'a4222222-2222-4222-8222-222222222222'
const TEST_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const TEST_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const BACKLOG_A = 'a5111111-1111-4111-8111-111111111111'
const CARD_A = 'a6111111-1111-4111-8111-111111111111'
const PYQ_A = 'a7111111-1111-4111-8111-111111111111'
const TRACK_A = 'a8111111-1111-4111-8111-111111111111'
const ERROR_A = 'a9111111-1111-4111-8111-111111111111'

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
    let offset = 0
    let limit = 10_000
    let orderColumn: string | null = null
    let ascending = true
    let head = false
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
        for (const row of filtered()) { Object.assign(row, patch); updated.push({ ...row }) }
        return { data: updated, count: updated.length, error: null }
      }
      if (mode === 'insert' || mode === 'upsert') return { data: inserted, count: inserted.length, error: null }
      if (mode === 'delete') {
        const removed: Row[] = []
        world.db[table] = rows().filter(row => {
          if (match(row, filters)) { removed.push({ ...row }); return false }
          return true
        })
        return { data: removed, count: removed.length, error: null }
      }
      const selected = filtered().slice(offset, offset + limit)
      return { data: head ? null : selected, count: filtered().length, error: null }
    }
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: (_cols?: string, options?: { count?: string; head?: boolean }) => {
        head = options?.head === true
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
      upsert: (value: Row) => {
        mode = 'upsert'
        const incoming = { ...value }
        const existing = rows().find(row => row.id === incoming.id || (row.user_id === incoming.user_id && incoming.user_id))
        if (existing) Object.assign(existing, incoming)
        else rows().push(incoming)
        inserted = [incoming]
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
  return {
    createClient: () => ({
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: { message: 'unknown rpc' } }),
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: world.users.find(user => user.id === id) ?? null },
            error: world.users.some(user => user.id === id) ? null : new Error('missing')
          }),
          listUsers: async () => ({ data: { users: world.users }, error: null })
        }
      }
    })
  }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

function seed() {
  world.users = [
    { id: STUDENT_A, email: 'asha@example.org', created_at: '2026-11-01T00:00:00.000Z', email_confirmed_at: '2026-11-01T01:00:00.000Z', last_sign_in_at: '2026-11-22T08:00:00.000Z', banned_until: null, app_metadata: { provider: 'email' } },
    { id: STUDENT_B, email: 'bala@example.org', created_at: '2026-11-20T00:00:00.000Z', email_confirmed_at: null, last_sign_in_at: null, banned_until: null, app_metadata: { provider: 'google' } }
  ]
  world.db = {
    profiles: [
      { id: STUDENT_A, user_id: STUDENT_A, display_name: 'Asha', email: 'asha@example.org', created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', encrypted_password: 'SHOULD-NEVER-APPEAR' },
      { id: STUDENT_B, user_id: STUDENT_B, display_name: 'Bala', email: 'bala@example.org', created_at: '2026-11-20T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z' }
    ],
    app_settings: [{
      id: STUDENT_A, user_id: STUDENT_A, owner_name: 'Asha', main_exam_date: '2027-01-15', advanced_exam_date: '',
      target_score: 240, theme: 'dark', weak_threshold: 60, strong_threshold: 80, dropping_threshold: 10,
      revision_gaps: [1, 7, 30], daily_study_goal_minutes: 360, sound_enabled: false
    }],
    chapters: [
      { id: CHAPTER_A, user_id: STUDENT_A, subject: 'Physics', name: 'Kinematics', position: 1, status: 'Done', priority: 'High', importance: 'high', notes: 'private chapter notes', formula_notes: '', created_at: '2026-11-01T00:00:00.000Z' },
      { id: CHAPTER_B, user_id: STUDENT_B, subject: 'Maths', name: 'Calculus', position: 1, status: 'Studying', priority: 'Medium', importance: 'medium', notes: '', formula_notes: '', created_at: '2026-11-02T00:00:00.000Z' }
    ],
    chapter_revisions: [
      { id: REV_A, user_id: STUDENT_A, chapter_id: CHAPTER_A, revision_number: 1, due_on: '2026-11-20', completed_at: null, created_at: '2026-11-10T00:00:00.000Z', updated_at: '2026-11-10T00:00:00.000Z' }
    ],
    daily_tasks: [
      { id: TASK_A, user_id: STUDENT_A, title: 'Revise kinematics', subject: 'Physics', chapter_id: CHAPTER_A, estimated_minutes: 45, priority: 'High', is_completed: false, task_date: '2026-11-23', position: 0, created_at: '2026-11-22T00:00:00.000Z' },
      { id: TASK_B, user_id: STUDENT_B, title: 'Bala task', subject: 'Maths', chapter_id: CHAPTER_B, estimated_minutes: 20, priority: 'Low', is_completed: false, task_date: '2026-11-23', position: 0, created_at: '2026-11-22T00:00:00.000Z' }
    ],
    weekly_goals: [
      { id: GOAL_A, user_id: STUDENT_A, goal_type: 'tests', title: 'Two tests', target: 2, progress_value: 0, week_start: '2026-11-23', unit: 'tests', created_at: '2026-11-23T00:00:00.000Z' }
    ],
    study_sessions: [
      { id: SESSION_ACTIVE, user_id: STUDENT_A, subject: 'Physics', chapter_id: CHAPTER_A, started_at: '2026-11-23T10:00:00.000Z', ended_at: null, duration_minutes: 12, completion_state: 'completed', mode: 'Pomodoro', activity: 'Practice', notes: '' },
      { id: SESSION_DONE, user_id: STUDENT_A, subject: 'Physics', chapter_id: CHAPTER_A, started_at: '2026-11-22T07:00:00.000Z', ended_at: '2026-11-22T08:00:00.000Z', duration_minutes: 60, completion_state: 'completed', mode: 'Pomodoro', activity: 'Practice', notes: 'private session notes' }
    ],
    practice_sessions: [],
    pyq_records: [
      { id: PYQ_A, user_id: STUDENT_A, chapter_id: CHAPTER_A, exam: 'Main', year: 2023, status: 'pending', questions_total: 10, questions_done: 2, meta: null, completed_at: null }
    ],
    chapter_stages: [],
    tests: [
      { id: TEST_A, user_id: STUDENT_A, title: 'Mock 1', test_date: '2026-11-20', test_type: 'Chapter Test', chapter_id: CHAPTER_A, marks_obtained: 80, total_marks: 100, notes: 'private test notes' },
      { id: TEST_B, user_id: STUDENT_B, title: 'Bala mock', test_date: '2026-11-21', test_type: 'Chapter Test', chapter_id: CHAPTER_B, marks_obtained: 20, total_marks: 100, notes: 'other student test' }
    ],
    test_chapter_links: [],
    test_subject_scores: [],
    test_error_logs: [
      { id: ERROR_A, user_id: STUDENT_A, test_id: TEST_A, chapter_id: CHAPTER_A, subject: 'Physics', category: 'Concept gap', marks_lost: 4, questions: 2, note: 'private error note' }
    ],
    test_time_entries: [],
    backlog_items: [
      { id: BACKLOG_A, user_id: STUDENT_A, title: 'Missed lecture', type: 'Lecture', subject: 'Physics', chapter_id: CHAPTER_A, priority: 'High', due_on: '2026-11-20', status: 'active', snoozed_until: null, completed_at: null, notes: '' }
    ],
    study_cards: [
      { id: CARD_A, user_id: STUDENT_A, chapter_id: CHAPTER_A, kind: 'formula', front: 'v = ?', back: 'u + at', hint: '', position: 0, difficulty: 'easy', reviews: 0, last_reviewed_at: null, next_review_at: null }
    ],
    user_exam_tracks: [
      { id: TRACK_A, user_id: STUDENT_A, track: 'main1', label: 'JEE Main', exam_date: '2027-01-15', enabled: true, target_score: 200, notes: 'private exam notes' }
    ],
    mistakes: []
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

describe('Master MCP remaining study-record tools', () => {
  it('completes a revision with shared scheduling, snoozes an open one, and refuses already-complete rows', async () => {
    const { issued, options } = await runtime()
    const preview = await callTool(issued.token, 'manage_student_revisions', { action: 'complete', studentId: STUDENT_A, id: REV_A }, options)
    expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
    const confirmed = await callTool(issued.token, 'manage_student_revisions', {
      action: 'complete', studentId: STUDENT_A, id: REV_A,
      confirmationToken: (preview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(confirmed.payload.isError).toBeFalsy()
    expect(world.db.chapter_revisions!.find(row => row.id === REV_A)?.completed_at).toBeTruthy()
    const next = world.db.chapter_revisions!.find(row => row.id !== REV_A && row.chapter_id === CHAPTER_A)
    expect(next).toMatchObject({ revision_number: 2, user_id: STUDENT_A, due_on: plusDays(indiaToday(), 7), completed_at: null })
    expect(world.db.chapters!.find(row => row.id === CHAPTER_A)?.status).toBe('Revised')

    const again = await callTool(issued.token, 'manage_student_revisions', { action: 'complete', studentId: STUDENT_A, id: REV_A }, options)
    expect(again.payload.isError).toBe(true)

    const snoozeTarget = String(next?.id)
    await callTool(issued.token, 'manage_student_revisions', { action: 'snooze', studentId: STUDENT_A, id: snoozeTarget }, options)
    expect(world.db.chapter_revisions!.find(row => row.id === snoozeTarget)?.due_on).toBe(plusDays(indiaToday(), 1))
  })

  it('reorders and completes tasks, refuses cross-student IDs, and snoozes backlog items', async () => {
    const { issued, options } = await runtime()
    const reordered = await callTool(issued.token, 'manage_student_tasks', {
      action: 'reorder', studentId: STUDENT_A, items: [{ id: TASK_A, position: 3 }]
    }, options)
    expect(reordered.payload.isError).toBeFalsy()
    expect(world.db.daily_tasks!.find(row => row.id === TASK_A)?.position).toBe(3)

    const completed = await callTool(issued.token, 'manage_student_tasks', { action: 'complete', studentId: STUDENT_A, id: TASK_A }, options)
    expect(completed.payload.isError).toBeFalsy()
    expect(world.db.daily_tasks!.find(row => row.id === TASK_A)?.is_completed).toBe(true)

    const cross = await callTool(issued.token, 'manage_student_tasks', { action: 'update', studentId: STUDENT_A, id: TASK_B, record: { title: 'Stolen' } }, options)
    expect(cross.payload.structuredContent.error).toBe('forbidden')
    expect(world.db.daily_tasks!.find(row => row.id === TASK_B)?.title).toBe('Bala task')

    const snoozed = await callTool(issued.token, 'manage_student_backlog', { action: 'snooze', studentId: STUDENT_A, id: BACKLOG_A, until: '2026-11-30' }, options)
    expect(snoozed.payload.isError).toBeFalsy()
    expect(world.db.backlog_items!.find(row => row.id === BACKLOG_A)).toMatchObject({ status: 'snoozed', snoozed_until: '2026-11-30' })
  })

  it('creates weekly goals with shared validation and completes progress to the target', async () => {
    const { issued, options } = await runtime()
    const invalid = await callTool(issued.token, 'manage_student_weekly_goals', {
      action: 'create', studentId: STUDENT_A,
      record: { goal_type: 'study_hours', title: 'Too many hours', target: 200, progress_value: 0, week_start: '2026-11-25', unit: 'hours' }
    }, options)
    expect(invalid.payload.isError).toBe(true)

    const created = await callTool(issued.token, 'manage_student_weekly_goals', {
      action: 'create', studentId: STUDENT_A,
      record: { goal_type: 'study_hours', title: 'Study week', target: 10, progress_value: 0, week_start: '2026-11-25', unit: 'hours' }
    }, options)
    expect(created.payload.isError).toBeFalsy()
    expect((created.payload.structuredContent as { week_start: string }).week_start).toBe('2026-11-23')

    const completed = await callTool(issued.token, 'manage_student_weekly_goals', { action: 'complete', studentId: STUDENT_A, id: GOAL_A }, options)
    expect((completed.payload.structuredContent as { progress_value: number }).progress_value).toBe(2)
  })

  it('refuses to edit or delete an active study timer and allows historical sessions', async () => {
    const { issued, options } = await runtime()
    const active = await callTool(issued.token, 'manage_student_study_sessions', {
      action: 'update', studentId: STUDENT_A, id: SESSION_ACTIVE, record: { duration_minutes: 90 }
    }, options)
    expect(active.payload.isError).toBe(true)
    expect(String(active.payload.structuredContent.message)).toMatch(/active study timer/)
    expect(world.db.study_sessions!.find(row => row.id === SESSION_ACTIVE)?.duration_minutes).toBe(12)

    const historical = await callTool(issued.token, 'manage_student_study_sessions', {
      action: 'update', studentId: STUDENT_A, id: SESSION_DONE, record: { duration_minutes: 55, started_at: '2026-11-22T07:00:00.000Z', ended_at: '2026-11-22T08:00:00.000Z' }
    }, options)
    expect(historical.payload.isError).toBeFalsy()
    expect(world.db.study_sessions!.find(row => row.id === SESSION_DONE)?.duration_minutes).toBe(55)

    const openCreate = await callTool(issued.token, 'manage_student_study_sessions', {
      action: 'create', studentId: STUDENT_A,
      record: { started_at: '2026-11-23T11:00:00.000Z', duration_minutes: 5 }
    }, options)
    expect(openCreate.payload.isError).toBe(true)
  })

  it('enforces practice numeric integrity, PYQ uniqueness, and chapter-stage claims without fabricating evidence', async () => {
    const { issued, options } = await runtime()
    const badPractice = await callTool(issued.token, 'manage_student_practice_records', {
      action: 'create', studentId: STUDENT_A,
      record: { chapter_id: CHAPTER_A, practice_date: '2026-11-22', attempted: 5, correct: 4, incorrect: 3, source: 'DPP', time_minutes: 30, notes: '' }
    }, options)
    expect(badPractice.payload.isError).toBe(true)

    const practice = await callTool(issued.token, 'manage_student_practice_records', {
      action: 'create', studentId: STUDENT_A,
      record: { chapter_id: CHAPTER_A, practice_date: '2026-11-22', attempted: 10, correct: 7, incorrect: 2, skipped: 1, source: 'DPP', time_minutes: 30, notes: '' }
    }, options)
    expect(practice.payload.isError).toBeFalsy()

    const crossChapter = await callTool(issued.token, 'manage_student_practice_records', {
      action: 'create', studentId: STUDENT_A,
      record: { chapter_id: CHAPTER_B, practice_date: '2026-11-22', attempted: 5, correct: 1, incorrect: 1, source: 'DPP', time_minutes: 20, notes: '' }
    }, options)
    expect(crossChapter.payload.structuredContent.error).toBe('forbidden')

    const duplicate = await callTool(issued.token, 'manage_student_pyq_records', {
      action: 'create', studentId: STUDENT_A,
      record: { chapter_id: CHAPTER_A, exam: 'Main', year: 2023, status: 'done', questions_total: 10, questions_done: 10, meta: null, completed_at: null }
    }, options)
    expect(duplicate.payload.isError).toBe(true)

    const testsBefore = world.db.tests!.length
    const revisionsBefore = world.db.chapter_revisions!.length
    const pyqBefore = world.db.pyq_records!.length
    const claimed = await callTool(issued.token, 'manage_student_chapter_stages', {
      action: 'update', studentId: STUDENT_A, chapterId: CHAPTER_A, stage: 'theory', done: true
    }, options)
    expect(claimed.payload.isError).toBeFalsy()
    expect(world.db.tests!).toHaveLength(testsBefore)
    expect(world.db.chapter_revisions!).toHaveLength(revisionsBefore)
    expect(world.db.pyq_records!).toHaveLength(pyqBefore)

    const listed = await callTool(issued.token, 'manage_student_chapter_stages', { action: 'list', studentId: STUDENT_A }, options)
    const chapters = (listed.payload.structuredContent as { chapters: Array<{ stages: Array<{ key: string; done: boolean; source: string }> }> }).chapters
    const theory = chapters[0]?.stages.find(stage => stage.key === 'theory')
    const tested = chapters[0]?.stages.find(stage => stage.key === 'tested')
    expect(theory).toMatchObject({ done: true, source: 'manual' })
    expect(tested).toMatchObject({ done: true, source: 'evidence' })
  })

  it('scopes mock analysis and notebook export to one student and strips secrets', async () => {
    const { issued, options } = await runtime()
    const crossLog = await callTool(issued.token, 'manage_student_mock_analysis', {
      action: 'create', studentId: STUDENT_A, kind: 'error_log',
      record: { test_id: TEST_B, chapter_id: CHAPTER_A, subject: 'Physics', category: 'Concept gap', marks_lost: 1, questions: 1, note: '' }
    }, options)
    expect(crossLog.payload.structuredContent.error).toBe('forbidden')

    const listed = await callTool(issued.token, 'manage_student_mock_analysis', { action: 'list', studentId: STUDENT_A, kind: 'error_log' }, options)
    expect((listed.payload.structuredContent as { records: Array<{ id: string }> }).records.map(row => row.id)).toEqual([ERROR_A])

    const exported = await callTool(issued.token, 'export_student_notebook', { studentId: STUDENT_A }, options)
    expect(exported.payload.isError).toBeFalsy()
    const body = exported.payload.structuredContent as { scopedToStudent: boolean; includesSecrets: boolean; backup: { app: string; chapters: Array<{ id: string }>; tasks: Array<{ id: string }>; examTracks: Array<{ notes?: string }> } }
    expect(body.scopedToStudent).toBe(true)
    expect(body.includesSecrets).toBe(false)
    expect(body.backup.app).toBe('Stracker')
    expect(body.backup.chapters.map(row => row.id)).toEqual([CHAPTER_A])
    expect(body.backup.tasks.map(row => row.id)).toEqual([TASK_A])
    const json = JSON.stringify(exported.payload)
    expect(json).not.toContain('SHOULD-NEVER-APPEAR')
    expect(json).not.toContain(STUDENT_B)
    expect(json).not.toContain(TASK_B)
    expect(json).not.toContain('encrypted_password')
  })
})

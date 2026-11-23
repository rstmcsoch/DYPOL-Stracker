import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { encryptCredential, decryptCredential } from '../secrets.js'
import { issueModelApproval } from '../model-approval.js'
import { siteAiAdapters, MASTER_AI_APPROVAL_SUBJECT } from '../services/site-ai.js'

type Row = Record<string, unknown>
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GEMINI_ID = 'b1111111-1111-4111-8111-111111111111'
const TASK_ID = 'b3333333-3333-4333-8333-333333333333'
const PLAINTEXT_KEY = 'sk-test-admin-key-DO-NOT-LEAK-9f3a'
const REPLACEMENT_KEY = 'sk-test-admin-key-REPLACEMENT-7c21'
const ENCRYPTION_KEY = 'ab'.repeat(32)

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

const world = vi.hoisted(() => ({
  users: [] as Array<Row>,
  db: {} as Record<string, Row[]>,
  queried: [] as string[],
  logs: [] as string[]
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'neq') return row[column] !== value
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
    world.queried.push(table)
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
      neq: (column: string, value: unknown) => { filters.push(['neq', column, value]); return chain },
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
        const existing = rows().find(row => row.id === incoming.id)
        if (existing) Object.assign(existing, incoming)
        else rows().push(incoming)
        inserted = [existing ?? incoming]
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
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: new Error('missing') }), listUsers: async () => ({ data: { users: world.users }, error: null }) } }
    })
  }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')
vi.stubEnv('AI_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY)

function seed() {
  world.queried = []
  world.users = [{ id: STUDENT_A, email: 'asha@example.org', created_at: '2026-11-01T00:00:00.000Z' }]
  const envelope = encryptCredential(PLAINTEXT_KEY)
  world.db = {
    exam_catalog: [
      { id: 'jee', name: 'JEE (Main + Advanced)', category: 'Engineering', years: [2026, 2027], sessions: [], boards: ['CBSE'], boards_addon: false, subjects: ['Physics', 'Chemistry', 'Maths'], session_label: '', hidden: false, sort_order: 10, marking_scheme: null, updated_by: null },
      { id: 'neet-ug', name: 'NEET (UG)', category: 'Medical', years: [2026, 2027], sessions: [], boards: ['CBSE'], boards_addon: false, subjects: ['Physics', 'Chemistry', 'Botany', 'Zoology'], session_label: '', hidden: false, sort_order: 20, marking_scheme: null, updated_by: null }
    ],
    app_settings: [{ id: STUDENT_A, user_id: STUDENT_A, exam_id: 'jee', owner_name: 'Asha' }],
    ai_model_preferences: [],
    site_ai_settings: [{ id: 1, enabled: true, per_user_per_minute: 4, per_user_daily: 40, updated_by: null }],
    site_ai_providers: [
      { id: GEMINI_ID, provider_id: 'gemini', display_name: 'Gemini', encrypted_api_key: envelope, key_hint: PLAINTEXT_KEY.slice(-4), model_id: 'gemini-2.5-flash', base_url: null, protocol: 'google', organization_id: null, provider_config: {}, capabilities: {}, enabled: true, is_default: true, connection_status: 'connected', last_checked_at: '2026-11-23T09:00:00.000Z', cooldown_until: null, failure_count: 0, priority: 1, updated_by: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' }
    ],
    ai_rate_events: [
      { id: 1, user_id: STUDENT_A, bucket: 'stracker_day', created_at: new Date().toISOString() },
      { id: 2, user_id: STUDENT_A, bucket: 'stracker_day', created_at: new Date().toISOString() }
    ],
    ai_tasks: [
      { id: TASK_ID, user_id: STUDENT_A, conversation_id: 'c1111111-1111-4111-8111-111111111111', request_id: 'req-active-task-01', provider_id: 'gemini', model_id: 'gemini-2.5-flash', task_type: 'chat', status: 'running', progress: 'Working', metadata: { prompt: 'student secret prompt', apiKey: PLAINTEXT_KEY }, started_at: '2026-11-23T09:30:00.000Z', completed_at: null, updated_at: '2026-11-23T09:30:00.000Z' }
    ],
    ai_provider_configs: [
      { id: 'c9999999-9999-4999-8999-999999999999', user_id: STUDENT_A, provider_id: 'openai', encrypted_api_key: 'student-byok-must-not-be-read', key_hint: 'byok' }
    ]
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
  return { status: res.statusCode, payload, raw: res.body }
}

function assertNoKeyMaterial(...values: unknown[]) {
  const blob = values.map(value => {
    try { return JSON.stringify(value) } catch { return String(value) }
  }).join('\n')
  expect(blob).not.toContain(PLAINTEXT_KEY)
  expect(blob).not.toContain(REPLACEMENT_KEY)
  expect(blob).not.toMatch(/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
}

function assertByokUntouched() {
  expect(world.queried).not.toContain('ai_provider_configs')
}

const scheme = {
  full: { total: 300, perSubject: { Physics: 100, Chemistry: 100, Maths: 100 } },
  other: { total: 100, perSubject: { Physics: 33, Chemistry: 33, Maths: 34 } },
  combine: 'sum_subjects' as const,
  source: 'Test marking source'
}

const originalDiscover = siteAiAdapters.discover
const originalTest = siteAiAdapters.testConnection
const originalCall = siteAiAdapters.callFromConfig

beforeEach(() => {
  vi.stubEnv('AI_CREDENTIALS_ENCRYPTION_KEY', ENCRYPTION_KEY)
  seed()
  world.logs = []
  const capture = (method: 'info' | 'warn' | 'error') => {
    const original = console[method].bind(console)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      world.logs.push(args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '))
      if (!String(args[0] ?? '').includes('stracker-ai')) original(...args)
    })
  }
  capture('info'); capture('warn'); capture('error')
  siteAiAdapters.discover = async () => ({ models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { supportsStreaming: true, supportsTools: true, supportsVision: false, supportsStructuredOutput: false, supportsReasoning: false, supportsCancellation: true }, company: 'Google' }], discoveryAvailable: true })
  siteAiAdapters.testConnection = async () => ({ replied: true })
  siteAiAdapters.callFromConfig = ((...args: unknown[]) => ({ mocked: true, argc: args.length })) as unknown as typeof siteAiAdapters.callFromConfig
})
afterEach(() => {
  siteAiAdapters.discover = originalDiscover
  siteAiAdapters.testConnection = originalTest
  siteAiAdapters.callFromConfig = originalCall
  vi.restoreAllMocks()
})

describe('Master MCP exam catalogue and site AI', () => {
  it('lists and updates exams, hides without physical delete, and keeps in-use students', async () => {
    const { issued, options, audit } = await runtime()
    const listed = await callTool(issued.token, 'list_exam_catalogue', {}, options)
    expect(listed.payload.isError).toBeFalsy()
    expect((listed.payload.structuredContent as { total: number }).total).toBe(2)

    const definition = await callTool(issued.token, 'get_exam_definition', { examId: 'jee' }, options)
    expect((definition.payload.structuredContent as { inUseCount: number }).inUseCount).toBe(1)

    const created = await callTool(issued.token, 'create_exam', {
      id: 'ca-foundation', name: 'CA Foundation', category: 'Commerce', years: [2026], sessions: ['May', 'November'], boards: [], boards_addon: false, subjects: ['Accounting']
    }, options)
    expect(created.payload.isError).toBeFalsy()

    const marking = await callTool(issued.token, 'update_exam_marking_scheme', { examId: 'jee', markingScheme: scheme }, options)
    expect(marking.payload.isError).toBeFalsy()

    const preview = await callTool(issued.token, 'hide_exam', { examId: 'jee' }, options)
    expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
    expect((preview.payload.structuredContent as { relatedRecords: { studentsUsingExam: number } }).relatedRecords.studentsUsingExam).toBe(1)
    const hidden = await callTool(issued.token, 'hide_exam', {
      examId: 'jee',
      confirmationToken: (preview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(hidden.payload.isError).toBeFalsy()
    expect(world.db.exam_catalog!.find(row => row.id === 'jee')).toMatchObject({ hidden: true })
    expect(world.db.exam_catalog!.some(row => row.id === 'jee')).toBe(true)
    expect(world.db.app_settings!.find(row => row.user_id === STUDENT_A)?.exam_id).toBe('jee')
    expect((hidden.payload.structuredContent as { physicallyDeleted: boolean }).physicallyDeleted).toBe(false)

    const restored = await callTool(issued.token, 'restore_exam', { examId: 'jee' }, options)
    expect(world.db.exam_catalog!.find(row => row.id === 'jee')?.hidden).toBe(false)
    expect(restored.payload.isError).toBeFalsy()

    const forbidden = await callTool(issued.token, 'delete_exam', { examId: 'jee' }, options)
    expect(forbidden.payload.structuredContent.error).toBe('forbidden_tool')
    expect(world.db.exam_catalog!.some(row => row.id === 'jee')).toBe(true)

    assertNoKeyMaterial(listed.raw, definition.raw, created.raw, marking.raw, preview.raw, hidden.raw, restored.raw, forbidden.raw, audit.events, world.logs)
  })

  it('masks site AI keys in every tool result, log and audit event, and never reads student BYOK rows', async () => {
    const { issued, options, audit } = await runtime()
    const status = await callTool(issued.token, 'get_site_ai_status', {}, options)
    expect(status.payload.isError).toBeFalsy()
    const statusBody = status.payload.structuredContent as { providers: Array<{ masked_key: string; encrypted_api_key?: string }>; encryption: { configured: boolean } }
    expect(statusBody.encryption.configured).toBe(true)
    expect(statusBody.providers[0]?.masked_key).toBe(`••••••••••••${PLAINTEXT_KEY.slice(-4)}`)
    expect(statusBody.providers[0]?.encrypted_api_key).toBeUndefined()

    const listed = await callTool(issued.token, 'list_site_ai_providers', {}, options)
    expect((listed.payload.structuredContent as { total: number }).total).toBe(1)

    const preview = await callTool(issued.token, 'replace_site_ai_api_key', { id: GEMINI_ID, apiKey: REPLACEMENT_KEY }, options)
    expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
    const previewBody = preview.payload.structuredContent as { proposed: { masked_key: string } }
    expect(previewBody.proposed.masked_key).toBe(`••••••••••••${REPLACEMENT_KEY.slice(-4)}`)
    const replaced = await callTool(issued.token, 'replace_site_ai_api_key', {
      id: GEMINI_ID, apiKey: REPLACEMENT_KEY,
      confirmationToken: (preview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(replaced.payload.isError).toBeFalsy()
    const stored = world.db.site_ai_providers!.find(row => row.id === GEMINI_ID)!
    expect(decryptCredential(String(stored.encrypted_api_key))).toBe(REPLACEMENT_KEY)
    expect(String(stored.encrypted_api_key)).toMatch(/^v1\./)
    expect((replaced.payload.structuredContent as { masked_key: string }).masked_key).toBe(`••••••••••••${REPLACEMENT_KEY.slice(-4)}`)

    assertNoKeyMaterial(status.raw, listed.raw, preview.raw, replaced.raw, audit.events, world.logs)
    assertByokUntouched()
  })

  it('keeps unapproved custom providers disabled and refuses enable or default without approval', async () => {
    const { issued, options, audit } = await runtime()
    const added = await callTool(issued.token, 'add_site_ai_provider', {
      providerId: 'custom', displayName: 'Custom lab', modelId: 'lab-model', apiKey: PLAINTEXT_KEY, baseUrl: 'https://api.example.com/v1', protocol: 'openai-compatible'
    }, options)
    expect(added.payload.isError).toBeFalsy()
    const addedBody = added.payload.structuredContent as { approved: boolean; provider: { id: string; enabled: boolean; is_default: boolean; connection_status: string } }
    expect(addedBody.approved).toBe(false)
    expect(addedBody.provider.enabled).toBe(false)
    expect(addedBody.provider.is_default).toBe(false)
    expect(addedBody.provider.connection_status).toBe('not_tested')
    const customId = addedBody.provider.id

    const enable = await callTool(issued.token, 'enable_site_ai_provider', { id: customId }, options)
    expect(enable.payload.isError).toBe(true)
    expect(world.db.site_ai_providers!.find(row => row.id === customId)?.enabled).toBe(false)

    const makeDefault = await callTool(issued.token, 'set_default_site_ai_provider', { id: customId }, options)
    expect(makeDefault.payload.isError).toBe(true)
    expect(world.db.site_ai_providers!.find(row => row.id === customId)?.is_default).toBe(false)

    const approval = issueModelApproval({
      userId: MASTER_AI_APPROVAL_SUBJECT,
      baseUrl: 'https://api.example.com/v1',
      protocol: 'openai-compatible',
      modelId: 'lab-model',
      apiKey: PLAINTEXT_KEY
    })
    expect(approval).toBeTruthy()
    const approved = await callTool(issued.token, 'update_site_ai_provider', {
      id: customId, providerId: 'custom', displayName: 'Custom lab', modelId: 'lab-model',
      apiKey: PLAINTEXT_KEY, baseUrl: 'https://api.example.com/v1', protocol: 'openai-compatible', approvalToken: approval
    }, options)
    expect((approved.payload.structuredContent as { approved: boolean }).approved).toBe(true)
    const enabled = await callTool(issued.token, 'enable_site_ai_provider', { id: customId }, options)
    expect(enabled.payload.isError).toBeFalsy()
    expect(world.db.site_ai_providers!.find(row => row.id === customId)?.enabled).toBe(true)

    assertNoKeyMaterial(added.raw, enable.raw, makeDefault.raw, approved.raw, enabled.raw, audit.events, world.logs)
    assertByokUntouched()
  })

  it('discovers and tests site providers through mocks, reports usage, and records task cancellation at the next checkpoint', async () => {
    const { issued, options, audit } = await runtime()
    const discovered = await callTool(issued.token, 'discover_site_ai_models', { id: GEMINI_ID }, options)
    expect(discovered.payload.isError).toBeFalsy()
    expect((discovered.payload.structuredContent as { models: Array<{ id: string }> }).models[0]?.id).toBe('gemini-2.5-flash')

    const tested = await callTool(issued.token, 'test_site_ai_provider', { id: GEMINI_ID }, options)
    expect(tested.payload.isError).toBeFalsy()
    expect((tested.payload.structuredContent as { status: string }).status).toBe('connected')

    const usage = await callTool(issued.token, 'get_ai_usage', {}, options)
    expect(usage.payload.structuredContent).toMatchObject({ available: true, timezone: 'Asia/Calcutta', requestsToday: 2, uniqueUsersToday: 1, activeTasks: 1 })

    const health = await callTool(issued.token, 'get_ai_provider_health', {}, options)
    expect((health.payload.structuredContent as { providers: Array<{ runtime_health: string }> }).providers[0]?.runtime_health).toBe('ready')

    const tasks = await callTool(issued.token, 'list_ai_tasks', {}, options)
    const taskList = tasks.payload.structuredContent as { tasks: Array<Record<string, unknown>> }
    expect(taskList.tasks[0]?.metadata).toBeUndefined()
    expect(JSON.stringify(taskList)).not.toContain('student secret prompt')

    const cancelled = await callTool(issued.token, 'cancel_ai_task', { id: TASK_ID }, options)
    expect(cancelled.payload.structuredContent).toMatchObject({ cancelled: true })
    expect(String((cancelled.payload.structuredContent as { observation: string }).observation)).toMatch(/next checkpoint/)
    expect(world.db.ai_tasks!.find(row => row.id === TASK_ID)?.status).toBe('cancelled')

    const limits = await callTool(issued.token, 'update_site_ai_limits', { perUserPerMinute: 6, perUserDaily: 80 }, options)
    expect(limits.payload.structuredContent).toMatchObject({ settings: { perUserPerMinute: 6, perUserDaily: 80, enabled: true } })

    const prefs = await callTool(issued.token, 'update_ai_model_preferences', { preferences: { gemini: ['gemini-2.5-flash'] } }, options)
    expect(prefs.payload.isError).toBeFalsy()

    const preview = await callTool(issued.token, 'remove_site_ai_provider', { id: GEMINI_ID }, options)
    expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
    const removed = await callTool(issued.token, 'remove_site_ai_provider', {
      id: GEMINI_ID,
      confirmationToken: (preview.payload.structuredContent as { confirmationToken: string }).confirmationToken
    }, options)
    expect(removed.payload.isError).toBeFalsy()
    expect(world.db.site_ai_providers!.some(row => row.id === GEMINI_ID)).toBe(false)

    assertNoKeyMaterial(discovered.raw, tested.raw, usage.raw, health.raw, tasks.raw, cancelled.raw, limits.raw, prefs.raw, preview.raw, removed.raw, audit.events, world.logs)
    assertByokUntouched()
  })
})

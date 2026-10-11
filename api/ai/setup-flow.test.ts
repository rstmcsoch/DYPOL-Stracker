import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End-to-end setup flow through the real AI route handlers, with an in-memory Supabase
 * stand-in and a mocked provider network. No real keys, no network, no production data.
 */
type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const USER = '00000000-0000-4000-8000-000000000001'
let rpcAllowed = true

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: 'select' | 'update' | 'upsert' | 'insert' | 'delete' = 'select'
  let payload: Row | Row[] | null = null
  let head = false
  const rows = () => (db[table] ??= [])
  const run = () => {
    const match = rows().filter(row => filters.every(f => f(row)))
    if (op === 'update') { match.forEach(row => Object.assign(row, payload)); return match }
    if (op === 'delete') { db[table] = rows().filter(row => !match.includes(row)); return match }
    if (op === 'upsert' || op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload!]
      return list.map(item => {
        const existing = rows().find(row => item.id && row.id === item.id)
        if (existing) return Object.assign(existing, item)
        const created = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item }
        rows().push(created); return created
      })
    }
    return match
  }
  const api: Record<string, unknown> = {
    select: (_cols?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return api },
    eq: (col: string, value: unknown) => { filters.push(row => row[col] === value); return api },
    neq: (col: string, value: unknown) => { filters.push(row => row[col] !== value); return api },
    in: (col: string, values: unknown[]) => { filters.push(row => values.includes(row[col])); return api },
    gte: () => api, lt: () => api, lte: () => api, gt: () => api, is: () => api, limit: () => api, range: () => api,
    order: () => api,
    update: (value: Row) => { op = 'update'; payload = value; return api },
    upsert: (value: Row) => { op = 'upsert'; payload = value; return api },
    insert: (value: Row) => { op = 'insert'; payload = value; return api },
    delete: () => { op = 'delete'; return api },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => { const data = run()[0]; return { data: data ?? null, error: data ? null : { message: 'no rows' } } },
    then: (resolve: (value: unknown) => void) => { const data = run(); resolve({ data: head ? null : data, count: data.length, error: null }) }
  }
  return api
}
const adminClient = { from: (table: string) => builder(table), rpc: async () => ({ data: rpcAllowed, error: null }) }

vi.mock('../_lib/supabase.js', () => ({
  authenticateRequest: async (req: { headers: Record<string, string> }) => {
    const { ApiError } = await import('../_lib/http.js')
    if (!req.headers.authorization) throw new ApiError(401, 'unauthenticated', 'Sign in to use Stracker AI.')
    return { userId: USER, user: { id: USER }, userClient: adminClient, adminClient }
  }
}))

function request(method: string, body?: unknown, auth = true) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as Record<string, unknown>
  req.method = method
  req.headers = auth ? { authorization: 'Bearer test-token' } : {}
  return req
}
function response() {
  const res = { statusCode: 0, headersSent: false, body: '' as string, setHeader: () => undefined, end(text: string) { this.body = text } }
  return res
}
async function call(handler: (req: never, res: never) => Promise<void>, method: string, body?: unknown, auth = true) {
  const res = response()
  await handler(request(method, body, auth) as never, res as never)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') as Record<string, unknown> }
}

let providerReply: () => Response
beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  rpcAllowed = true
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64)
  providerReply = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"connected"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  vi.stubGlobal('fetch', vi.fn(async () => providerReply()))
})
afterEach(() => vi.unstubAllGlobals())

const providers = async () => (await import('./providers.js')).default
const testConnection = async () => (await import('./test-connection.js')).default

describe('AI setup flow', () => {
  it('rejects unauthenticated setup calls with 401', async () => {
    expect((await call(await providers(), 'GET', undefined, false)).status).toBe(401)
    expect((await call(await testConnection(), 'POST', { configId: crypto.randomUUID() }, false)).status).toBe(401)
  })

  it('save → test → enabled and preferred → listed without the key', async () => {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'AIza-test-key-1234', displayName: '', region: 'international', capabilities: {} })
    expect(saved.status).toBe(200)
    const id = (saved.json.provider as Row).id as string
    expect((saved.json.provider as Row).enabled).toBe(false)
    const tested = await call(await testConnection(), 'POST', { configId: id })
    expect(tested.status).toBe(200)
    const list = await call(await providers(), 'GET')
    const row = (list.json.providers as Row[])[0]!
    expect(row).toMatchObject({ enabled: true, is_default: true, connection_status: 'connected' })
    expect(JSON.stringify(list.json)).not.toContain('AIza-test-key-1234')
  })

  it('a successful re-test after a failed test re-enables the provider (was stuck disabled)', async () => {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'bad-key-0000' })
    const id = (saved.json.provider as Row).id as string
    providerReply = () => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400, headers: { 'content-type': 'application/json' } })
    const failed = await call(await testConnection(), 'POST', { configId: id })
    expect(failed.status).toBeGreaterThanOrEqual(400)
    expect(typeof failed.json.message).toBe('string')
    expect(String(failed.json.message)).not.toContain('bad-key-0000')
    providerReply = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"connected"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    expect((await call(await testConnection(), 'POST', { configId: id })).status).toBe(200)
    expect(db.ai_provider_configs![0]).toMatchObject({ enabled: true, is_default: true, connection_status: 'connected' })
  })

  it('keeps a provider the user disabled after a healthy test disabled', async () => {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'AIza-test-key-1234' })
    const id = (saved.json.provider as Row).id as string
    await call(await testConnection(), 'POST', { configId: id })
    expect((await call(await providers(), 'PATCH', { id, action: 'disable' })).status).toBe(200)
    await call(await testConnection(), 'POST', { configId: id })
    expect(db.ai_provider_configs![0]).toMatchObject({ enabled: false, connection_status: 'connected' })
    expect((await call(await providers(), 'PATCH', { id, action: 'enable' })).status).toBe(200)
  })

  it('validates setup input with friendly messages', async () => {
    const noKey = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash' })
    expect(noKey).toMatchObject({ status: 400, json: { error: 'credential_required' } })
    const noModel = await call(await providers(), 'POST', { providerId: 'gemini', modelId: ' ', apiKey: 'k' })
    expect(noModel.status).toBe(400)
    const untested = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'm', apiKey: 'k' })
    const enable = await call(await providers(), 'PATCH', { id: (untested.json.provider as Row).id, action: 'enable' })
    expect(enable).toMatchObject({ status: 409, json: { error: 'provider_not_tested' } })
  })

  it('reports the rate limit as 429 with a readable message', async () => {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'm', apiKey: 'k' })
    rpcAllowed = false
    const limited = await call(await testConnection(), 'POST', { configId: (saved.json.provider as Row).id })
    expect(limited).toMatchObject({ status: 429, json: { error: 'request_limit' } })
  })

  it('model discovery accepts the client draft shape', async () => {
    providerReply = () => new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    const models = (await import('./models.js')).default
    const result = await call(models, 'POST', { providerId: 'gemini', displayName: '', modelId: 'gemini-2.5-flash', apiKey: 'AIza-k', baseUrl: null, protocol: 'google', region: 'international', capabilities: {} })
    expect(result.status).toBe(200)
    expect(Array.isArray(result.json.models)).toBe(true)
  })
})

describe('AI request path', () => {
  const runInput = (message: string) => ({
    userId: USER, conversationId: crypto.randomUUID(), taskId: crypto.randomUUID(), message, pageContext: null, priorMessages: [],
    userClient: adminClient as never, adminClient: adminClient as never, signal: new AbortController().signal, emit: () => undefined
  })

  it('explains each "no provider" state with the next step', async () => {
    const { runAssistant } = await import('../_lib/agent.js')
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'provider_not_configured' })
    db.ai_provider_configs = [{ id: crypto.randomUUID(), user_id: USER, enabled: false, connection_status: 'not_tested' }]
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'provider_not_ready' })
    db.ai_provider_configs[0]!.connection_status = 'connected'
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'provider_disabled' })
  })

  it('tells the model the student’s exam and subjects (non-JEE)', async () => {
    const { studentExamLine } = await import('../_lib/agent.js')
    db.app_settings = [{ user_id: USER, exam_id: 'neet-ug', exam_year: 2027 }]
    db.exam_catalog = [{ id: 'neet-ug', name: 'NEET UG', subjects: ['Physics', 'Chemistry', 'Biology'] }]
    expect(await studentExamLine(adminClient as never, USER)).toBe('\nThe student is preparing for NEET UG 2027. Their subjects: Physics, Chemistry, Biology.')
    db.app_settings = [{ user_id: USER, exam_id: null, exam_year: null }]
    db.exam_catalog = []
    expect(await studentExamLine(adminClient as never, USER)).toContain('JEE (Main + Advanced). Their subjects: Physics, Chemistry, Maths.')
  })

  it('Full Mock completeness: JEE needs all three, other exams aggregate every complete subject', async () => {
    const { fullMockComplete } = await import('../_lib/tools.js')
    const s = (subject: string, marks: number | null = 10) => ({ subject, marks_obtained: marks, total_marks: 20 })
    expect(fullMockComplete([s('Physics'), s('Chemistry')])).toBe(false)
    expect(fullMockComplete([s('Physics'), s('Chemistry'), s('Maths')])).toBe(true)
    expect(fullMockComplete([s('Physics'), s('Chemistry'), s('Biology')])).toBe(true)
    expect(fullMockComplete([s('Accounting'), s('Economics', null)])).toBe(false)
    expect(fullMockComplete([s('Economics'), s('Economics')])).toBe(false)
  })
})

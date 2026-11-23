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
let dailyAllowed = true
const rpcCalls: Array<{ name: string; args: Row }> = []

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
const adminClient = { from: (table: string) => builder(table), rpc: async (name: string, args: Row) => { rpcCalls.push({ name, args }); return { data: rpcAllowed && (name !== 'ai_take_daily_slot' || dailyAllowed), error: null } } }

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
  rpcCalls.length = 0
  dailyAllowed = true
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

  it('save \u2192 test \u2192 enabled and preferred \u2192 listed without the key', async () => {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'AIza-test-key-1234', displayName: '', region: 'international', capabilities: {} })
    expect(saved.status).toBe(200)
    const id = (saved.json.provider as Row).id as string
    expect((saved.json.provider as Row).enabled).toBe(false)
    const tested = await call(await testConnection(), 'POST', { configId: id })
    expect(tested.status).toBe(200)
    const list = await call(await providers(), 'GET')
    const row = (list.json.providers as Row[])[0]!
    expect(row).toMatchObject({ enabled: true, is_default: true, connection_status: 'connected', model_label: 'Google Gemini' })
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
    // No own provider and no Stracker AI (Default) configured: the friendly default warning.
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_unavailable' })
    db.ai_provider_configs = [{ id: crypto.randomUUID(), user_id: USER, enabled: false, connection_status: 'not_tested' }]
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'provider_not_ready' })
    db.ai_provider_configs[0]!.connection_status = 'connected'
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'provider_disabled' })
  })

  it('tells the model the student\u2019s exam and subjects (non-JEE)', async () => {
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

describe('chat reliability', () => {
  const sse = (text: string) => new Response(`data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(text)}}]}}]}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  async function connectedProvider() {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'AIza-test-key-1234' })
    await call(await testConnection(), 'POST', { configId: (saved.json.provider as Row).id })
  }
  const input = (message: string) => ({
    userId: USER, conversationId: crypto.randomUUID(), taskId: crypto.randomUUID(), message, pageContext: null, priorMessages: [],
    userClient: adminClient as never, adminClient: adminClient as never, signal: new AbortController().signal, emit: () => undefined
  })

  it('a model that rejects tool declarations still answers (retried without tools)', async () => {
    await connectedProvider()
    const bodies: string[] = []
    let callNo = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body)); callNo += 1
      return callNo === 1
        ? new Response(JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "additionalProperties"', status: 'INVALID_ARGUMENT' } }), { status: 400, headers: { 'content-type': 'application/json' } })
        : sse('Your average is not available yet.')
    }))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('What is my average score?'))
    expect(result.status).toBe('completed')
    expect(bodies[0]).toContain('functionDeclarations')
    expect(bodies[0]).not.toContain('additionalProperties')
    expect(bodies[1]).not.toContain('functionDeclarations')
    expect(db.ai_provider_configs![0]).toMatchObject({ enabled: true })
  })

  it('a plain greeting still gets every tool (no intent filtering) and a short thinking budget', async () => {
    await connectedProvider()
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(String(init.body)); return sse('Hello!') }))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('Hello'))
    expect(result).toMatchObject({ status: 'completed', content: 'Hello!' })
    expect(bodies[0]).toContain('functionDeclarations')
    expect(bodies[0]).toContain('"create_test"')
    expect(JSON.parse(bodies[0]!).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('a long personal note gets the full catalog too, with the larger answer budget', async () => {
    await connectedProvider()
    const essay = 'sometimes i think maybe change stream but they already paid fees and bought books so no. just need some real method that works for someone like me who gets low always and confidence is gone. '.repeat(12)
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(String(init.body)); return sse('Start with one chapter a day and review it the next morning.') }))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input(essay))
    expect(result.status).toBe('completed')
    expect(result.content).toContain('one chapter')
    expect(bodies[0]).toContain('functionDeclarations')
    expect(bodies[0]).toContain('4096')
  })
})

/**
 * t160: the exact three.dev transcripts (NEET student: Physics, Chemistry, Botany, Zoology).
 * Mocked provider and in-memory database only: nothing is written for any real student, and
 * every write stops at a pending confirm card.
 */
describe('Stracker AI never refuses supported work (three.dev transcripts)', () => {
  const NEET = ['Physics', 'Chemistry', 'Botany', 'Zoology']
  const DETAILS = 'Weekly mock test 17 it was today  and it was full test I got 150 out of 180. Correct are 30, wrong are 13 and remaining skipped out of 45 questions due to time management. It takes around 90min'
  const TRANSCRIPT: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: 'Add a test' },
    { role: 'assistant', content: 'Sure! To add your test, please share:\n\n- **Title** (e.g., "Cell Biology Chapter Test")\n- **Date**\n- **Test type** (Chapter Test, Subject Test, Full Mock, or PYQ Practice)\n- **Subject** (Physics, Chemistry, Botany, or Zoology)\n- **Total marks**\n- **Your score** (marks obtained, or correct/wrong/skipped)\n\nOptional: time taken, chapter, negative marks, or notes — leave those out if you\'d like.' },
    { role: 'user', content: DETAILS },
    { role: 'assistant', content: 'For a Full Mock, Stracker needs the subject-wise breakdown. Could you tell me your marks in each subject (out of that subject\'s total)?' },
    { role: 'user', content: '40, 50, 35, 25' },
    { role: 'assistant', content: 'Thanks! Those four numbers (40, 50, 35, 25) sum to 150, matching your total. To save the Full Mock correctly, I need the **maximum marks for each subject**.' },
    { role: 'user', content: '45 for each' },
    { role: 'assistant', content: 'I notice Chemistry shows **50/45**, which isn\'t possible if each subject is out of 45. Could you confirm the Chemistry score?' }
  ]
  // The model's real call from request 01a1de68-a34c: invented tool name, string numbers, other keys.
  const ADD_TEST_ARGS = {
    title: 'Weekly mock test 17', date: '2026-11-15', test_type: 'Full Mock', marks_obtained: '150', total_marks: '180',
    subject_breakdown: '[{"subject": "Physics", "marks": 40, "total": 45}, {"subject": "Chemistry", "marks": 45, "total": 45}, {"subject": "Botany", "marks": 35, "total": 45}, {"subject": "Zoology", "marks": 30, "total": 45}]',
    time_taken_minutes: '90', correct_count: '30', wrong_count: '13', skipped_count: '2', notes: 'Time management issues - 2 questions skipped'
  }
  const sse = (text: string) => new Response(`data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(text)}}]}}]}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const toolCall = (name: string, args: Record<string, unknown>) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  async function neetStudent() {
    const saved = await call(await providers(), 'POST', { providerId: 'gemini', modelId: 'gemini-2.5-flash', apiKey: 'AIza-test-key-1234' })
    await call(await testConnection(), 'POST', { configId: (saved.json.provider as Row).id })
    db.app_settings = [{ user_id: USER, exam_id: 'neet', exam_year: 2027 }]
    db.exam_catalog = [{ id: 'neet', name: 'NEET UG', subjects: NEET }]
  }
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const input = (message: string, priorMessages = TRANSCRIPT) => ({
    userId: USER, conversationId: crypto.randomUUID(), taskId: crypto.randomUUID(), message, pageContext: null, priorMessages,
    userClient: adminClient as never, adminClient: adminClient as never, signal: new AbortController().signal,
    emit: (event: string, data: Record<string, unknown>) => { events.push({ event, data }) }
  })
  const replies = (...list: Array<() => Response>) => {
    const bodies: string[] = []
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(String(init.body)); const next = list[Math.min(index, list.length - 1)]!; index += 1; return next() }))
    return bodies
  }
  const declared = (body: string) => (JSON.parse(body).tools?.[0]?.functionDeclarations ?? []) as Array<{ name: string; parameters: Record<string, unknown> }>
  beforeEach(() => { events.length = 0 })

  it('"Sorry, 40, 45, 35, 30" ends in a prepared create_test confirm card (add_test call, string numbers, other keys)', async () => {
    await neetStudent()
    const bodies = replies(() => toolCall('add_test', ADD_TEST_ARGS))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('Sorry, 40, 45, 35, 30'))
    // Every tool was offered on a turn that has no write words in it.
    const names = declared(bodies[0]!).map(tool => tool.name)
    expect(names).toHaveLength(30)
    for (const name of ['create_test', 'update_test', 'create_task', 'create_mistake', 'update_settings']) expect(names).toContain(name)
    expect(result.status).toBe('waiting')
    expect(result.action?.toolName).toBe('create_test')
    const fields = Object.fromEntries((result.action?.fields ?? []).map(field => [field.label, field.value]))
    expect(fields).toMatchObject({ Test: 'Weekly mock test 17', 'Test type': 'Full Mock', Score: '150 / 180', 'Physics score': '40 / 45', 'Chemistry score': '45 / 45', 'Botany score': '35 / 45', 'Zoology score': '30 / 45', Correct: '30', Wrong: '13', Skipped: '2', Time: '90 minutes' })
    expect(events.some(item => item.event === 'confirmation')).toBe(true)
    const pending = db.ai_pending_actions![0]!
    expect(pending).toMatchObject({ tool_name: 'create_test' })
    expect(pending.input).toMatchObject({ marks_obtained: 150, total_marks: 180, test_type: 'Full Mock', correct: 30, wrong: 13, skipped: 2, time_minutes: 90 })
    expect((pending.input as Row).subject_scores).toHaveLength(4)
    // Nothing was saved: the write waits for the student's confirmation.
    expect(rpcCalls.some(item => item.name === 'ai_create_test_with_scores')).toBe(false)
  })

  it('the details turn: a Full Mock with only the overall score is prepared at once (no subject-split questions)', async () => {
    await neetStudent()
    const bodies = replies(() => toolCall('create_test', { title: 'Weekly mock test 17', test_date: '2026-11-15', test_type: 'Full Mock', subject: null, marks_obtained: 150, total_marks: 180, correct: 30, wrong: 13, skipped: 2, time_minutes: 90 }))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input(DETAILS, TRANSCRIPT.slice(0, 2)))
    expect(bodies).toHaveLength(1)
    expect(result.status).toBe('waiting')
    const fields = Object.fromEntries((result.action?.fields ?? []).map(field => [field.label, field.value]))
    expect(fields).toMatchObject({ 'Test type': 'Full Mock', Score: '150 / 180', 'Total marks': '180' })
  })

  it('a split that does not add up to the overall score is sent back to the model, never saved', async () => {
    await neetStudent()
    const bodies = replies(
      () => toolCall('create_test', { title: 'Mock 18', test_date: '2026-11-15', test_type: 'Full Mock', marks_obtained: 140, total_marks: 180, subject_scores: [{ subject: 'Physics', marks_obtained: 40, total_marks: 45 }, { subject: 'Chemistry', marks_obtained: 45, total_marks: 45 }, { subject: 'Botany', marks_obtained: 35, total_marks: 45 }, { subject: 'Zoology', marks_obtained: 30, total_marks: 45 }] }),
      () => sse('Your subjects add up to 150, not 140. Which is right?')
    )
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('Mock 18 today: 140/180, Physics 40/45, Chemistry 45/45, Botany 35/45, Zoology 30/45', []))
    expect(bodies[1]).toContain('add up to 150/180')
    expect(result.status).toBe('completed')
    expect(db.ai_pending_actions ?? []).toHaveLength(0)
  })

  it('gives the model the exam subjects and rejects an invented one before any card', async () => {
    await neetStudent()
    const bodies = replies(
      () => toolCall('create_test', { title: 'Bio test', test_date: '2026-11-15', test_type: 'Subject Test', subject: 'Biology', marks_obtained: 60, total_marks: 90 }),
      () => sse('Was that Botany or Zoology?')
    )
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('I got 60/90 in my bio test today, add it', []))
    const createTest = declared(bodies[0]!).find(tool => tool.name === 'create_test')!
    expect(JSON.stringify(createTest.parameters)).toContain('"enum":["Physics","Chemistry","Botany","Zoology"]')
    expect(JSON.parse(bodies[0]!).systemInstruction.parts[0].text).toContain('Their subjects: Physics, Chemistry, Botany, Zoology.')
    expect(bodies[1]).toContain('is not one of the student')
    expect(result).toMatchObject({ status: 'completed', content: 'Was that Botany or Zoology?' })
    expect(db.ai_pending_actions ?? []).toHaveLength(0)
  })

  it('a reply that declines supported work gets one corrective round and then prepares the card', async () => {
    await neetStudent()
    const bodies = replies(
      () => sse('I can\'t do that here yet — you can add it from the Tests tab.'),
      () => toolCall('create_test', { title: 'Weekly mock test 17', test_date: '2026-11-15', test_type: 'Full Mock', subject: null, marks_obtained: 150, total_marks: 180 })
    )
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('Sorry, 40, 45, 35, 30'))
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toContain('Stracker note: you can do this')
    expect(events.some(item => item.event === 'reset')).toBe(true)
    expect(result.status).toBe('waiting')
    expect(result.action?.toolName).toBe('create_test')
  })

  it('never shows "can\'t do that here" for supported work, even if the model insists', async () => {
    await neetStudent()
    replies(() => sse('I can\'t do that here yet — you can add it from the Tests tab.'))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('Sorry, 40, 45, 35, 30'))
    expect(result.status).toBe('completed')
    expect(result.content).not.toMatch(/can't do that/)
    expect(result.content.length).toBeGreaterThan(10)
  })

  it('an empty reply is retried once with more room, then answered', async () => {
    await neetStudent()
    const bodies = replies(() => sse(''), () => sse('Here is your plan for today.'))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('What should I study today?', []))
    expect(bodies).toHaveLength(2)
    expect(JSON.parse(bodies[1]!).generationConfig.maxOutputTokens).toBeGreaterThan(JSON.parse(bodies[0]!).generationConfig.maxOutputTokens)
    expect(result).toMatchObject({ status: 'completed', content: 'Here is your plan for today.' })
  })

  it('two empty replies end in a short clear message, never a blank bubble', async () => {
    await neetStudent()
    const bodies = replies(() => sse(''))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(input('What should I study today?', []))
    expect(bodies).toHaveLength(2)
    expect(result.status).toBe('completed')
    expect(result.content).toMatch(/didn’t get a reply/)
  })

  it('a bare "Add a test" replies instantly with the checklist and never calls the model', async () => {
    await neetStudent()
    const bodies = replies(() => sse('should not be called'))
    const { runAssistant } = await import('../_lib/agent.js')
    const started = performance.now()
    const result = await runAssistant(input('Add a test', []))
    const elapsed = performance.now() - started
    expect(bodies).toHaveLength(0)
    expect(result.status).toBe('completed')
    for (const part of ['**Title**', '**Date**', '**Type**', 'Full Mock', '**Subject** (Physics, Chemistry, Botany or Zoology)', 'full test', '**Marks obtained**', '**total marks**']) expect(result.content).toContain(part)
    expect(elapsed).toBeLessThan(250)
    // Stored like any assistant reply and does not use a daily Stracker AI slot.
    expect((db.ai_messages ?? []).some(row => row.role === 'assistant' && String(row.content).includes('**Title**'))).toBe(true)
    expect(rpcCalls.some(item => item.name === 'ai_take_daily_slot')).toBe(false)
  })
})

const STRACKER_UNAVAILABLE_TEXT = 'Stracker AI\u2019s default models are not responding right now. Add your own AI model in the Stracker AI window (Add your own model) or in Settings \u2192 AI Assistant to keep going.'

describe('Stracker AI (Default)', () => {
  const SITE_KEY = 'sk-site-secret-key-9876'
  const SITE_URL = 'https://hidden-vendor.example.com/v1'
  const runInput = (message: string, emit: (event: string, data: unknown) => void = () => undefined) => ({
    userId: USER, conversationId: crypto.randomUUID(), taskId: crypto.randomUUID(), message, pageContext: null, priorMessages: [],
    userClient: adminClient as never, adminClient: adminClient as never, signal: new AbortController().signal, emit: emit as never
  })
  const siteRow = async (overrides: Row = {}) => {
    const { encryptCredential } = await import('../_lib/secrets.js')
    return { id: crypto.randomUUID(), provider_id: 'gemini', display_name: 'Owner Gemini', encrypted_api_key: encryptCredential(SITE_KEY), key_hint: '9876', model_id: 'models/gemini-3.6-flash', base_url: null, protocol: 'google', organization_id: null, provider_config: {}, capabilities: {}, enabled: true, is_default: true, connection_status: 'connected', last_checked_at: null, cooldown_until: null, failure_count: 0, updated_by: '00000000-0000-4000-8000-0000000000aa', ...overrides }
  }
  const ownRow = async () => {
    const { encryptCredential } = await import('../_lib/secrets.js')
    return { id: crypto.randomUUID(), user_id: USER, provider_id: 'gemini', display_name: 'My Gemini', encrypted_api_key: encryptCredential('AIza-own-key'), key_hint: '-key', model_id: 'gemini-2.5-flash', base_url: null, protocol: 'google', organization_id: null, provider_config: {}, capabilities: {}, enabled: true, is_default: true, connection_status: 'connected', last_checked_at: null, cooldown_until: null, failure_count: 0 }
  }

  it('public provider payload never contains the key, key hint, base URL, vendor or owner', async () => {
    db.site_ai_providers = [await siteRow({ provider_id: 'custom', base_url: SITE_URL, protocol: 'openai-compatible', model_id: 'openai/gpt-oss-20b' })]
    const list = await call(await providers(), 'GET')
    expect(list.status).toBe(200)
    const stracker = list.json.stracker as Row
    expect(Object.keys(stracker).sort()).toEqual(['dailyLimit', 'model', 'name', 'preferred', 'status', 'usedToday'])
    expect(stracker).toMatchObject({ name: 'Stracker AI (Default)', model: 'OpenAI ChatGPT', status: 'ready', preferred: true })
    const text = JSON.stringify(list.json)
    for (const secret of ['gpt-oss-20b', SITE_KEY, '9876', SITE_URL, 'hidden-vendor', 'Owner Gemini', 'encrypted', 'base_url', 'key_hint', 'baseUrl', 'apiKey', '0000000000aa']) expect(text).not.toContain(secret)
    expect(list.json.preference).toBe('stracker')
  })

  it('publicStrackerStatus only copies safe fields and reports unavailable when switched off', async () => {
    const { publicStrackerStatus, DEFAULT_SITE_AI_SETTINGS } = await import('../_lib/stracker-default.js')
    const row = await siteRow({ base_url: SITE_URL })
    const ready = publicStrackerStatus({ settings: DEFAULT_SITE_AI_SETTINGS, rows: [row as never], preference: 'own', usedToday: 3 })
    expect(ready).toEqual({ name: 'Stracker AI (Default)', model: 'Google Gemini', status: 'ready', preferred: false, dailyLimit: DEFAULT_SITE_AI_SETTINGS.perUserDaily, usedToday: 3 })
    const off = publicStrackerStatus({ settings: { ...DEFAULT_SITE_AI_SETTINGS, enabled: false }, rows: [row as never], preference: 'stracker', usedToday: 0 })
    expect(off).toMatchObject({ status: 'unavailable', model: null })
    expect(JSON.stringify(off)).not.toContain(SITE_URL)
  })

  it('a brand-new student with no key chats through Stracker AI, recorded as "stracker"', async () => {
    db.site_ai_providers = [await siteRow()]
    providerReply = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hi there"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const events: Array<[string, unknown]> = []
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(runInput('hello', (event, data) => events.push([event, data])))
    expect(result).toMatchObject({ status: 'completed', providerId: 'stracker' })
    expect(db.ai_messages![0]).toMatchObject({ provider_id: 'stracker' })
    const emitted = JSON.stringify(events)
    expect(emitted).toContain('Stracker AI (Default)')
    expect(emitted).not.toContain('Owner Gemini')
    expect(emitted).not.toContain('"gemini"')
  })

  it('a failing default shows the friendly warning without vendor details', async () => {
    db.site_ai_providers = [await siteRow()]
    providerReply = () => new Response(JSON.stringify({ error: { code: 500, message: 'internal', status: 'INTERNAL' } }), { status: 500, headers: { 'content-type': 'application/json' } })
    const { runAssistant } = await import('../_lib/agent.js')
    const error = await runAssistant(runInput('hello')).catch(failure => failure as { code: string; message: string })
    expect(error).toMatchObject({ code: 'stracker_ai_unavailable' })
    expect((error as { message: string }).message).toBe(STRACKER_UNAVAILABLE_TEXT)
    expect((error as { message: string }).message).toMatch(/Stracker AI window/)
    expect((error as { message: string }).message).toMatch(/Settings \u2192 AI Assistant/)
  })

  it('falls back to the student\u2019s own provider when the default fails', async () => {
    db.site_ai_providers = [await siteRow()]
    db.ai_provider_configs = [await ownRow()]
    db.ai_user_preferences = [{ user_id: USER, preferred: 'stracker' }]
    let calls = 0
    providerReply = () => (++calls === 1
      ? new Response(JSON.stringify({ error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } })
      : new Response('data: {"candidates":[{"content":{"parts":[{"text":"From yours"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(runInput('hello'))
    expect(result).toMatchObject({ status: 'completed', providerId: 'gemini', fallbackFrom: 'stracker' })
    // A temporary vendor problem never switches the shared default off for everyone.
    expect(db.site_ai_providers[0]).toMatchObject({ enabled: true })
  })

  it('admin models come first by default; an explicit own preference still wins', async () => {
    db.site_ai_providers = [await siteRow()]
    db.ai_provider_configs = [await ownRow()]
    const { runAssistant } = await import('../_lib/agent.js')
    expect(await runAssistant(runInput('hello'))).toMatchObject({ providerId: 'stracker' })
    expect((await call(await providers(), 'GET')).json.preference).toBe('stracker')
    const id = db.ai_provider_configs[0]!.id as string
    expect((await call(await providers(), 'PATCH', { id, action: 'default' })).json.preference).toBe('own')
    expect(await runAssistant(runInput('hello'))).toMatchObject({ providerId: 'gemini' })
  })

  it('walks the owner-ordered chain: #1 fails, #2 fails, #3 answers, and nothing secret is emitted', async () => {
    const first = await siteRow({ display_name: 'Owner One', priority: 1, is_default: true })
    const second = await siteRow({ display_name: 'Owner Two', model_id: 'models/gemini-second', priority: 2, is_default: false })
    const third = await siteRow({ display_name: 'Owner Three', model_id: 'models/gemini-third', priority: 3, is_default: false })
    db.site_ai_providers = [first, second, third]
    db.ai_provider_configs = [await ownRow()]
    const urls: string[] = []
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url)); calls += 1
      if (calls === 1) return new Response(JSON.stringify({ error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } })
      if (calls === 2) return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429, headers: { 'content-type': 'application/json' } })
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"From number three"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }))
    const events: Array<[string, unknown]> = []
    const { runAssistant } = await import('../_lib/agent.js')
    const result = await runAssistant(runInput('hello', (event, data) => events.push([event, data])))
    expect(result).toMatchObject({ status: 'completed', providerId: 'stracker', modelId: 'Google Gemini', content: 'From number three' })
    expect(calls).toBe(3)
    // One input = exactly one daily slot, however many admin models were tried.
    expect(rpcCalls.filter(call => call.name === 'ai_take_daily_slot')).toHaveLength(1)
    expect(urls[0]).toContain('gemini-3.6-flash')
    expect(urls[1]).toContain('gemini-second')
    expect(urls[2]).toContain('gemini-third')
    const emitted = JSON.stringify(events)
    for (const secret of [SITE_KEY, SITE_URL, 'hidden-vendor', 'Owner One', 'Owner Two', 'Owner Three', '"gemini"', '"custom"', 'gemini-third', 'gemini-second', 'gemini-3.6-flash']) expect(emitted).not.toContain(secret)
    const stored = JSON.stringify([db.ai_messages, db.ai_tasks])
    for (const modelId of ['gemini-third', 'gemini-second', 'gemini-3.6-flash']) expect(stored).not.toContain(modelId)
  })

  it('after every admin model fails, the student\u2019s own model answers', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 }), await siteRow({ priority: 2, is_default: false, display_name: 'Owner B' })]
    db.ai_provider_configs = [await ownRow()]
    let calls = 0
    providerReply = () => (++calls <= 2
      ? new Response(JSON.stringify({ error: { code: 500, message: 'internal', status: 'INTERNAL' } }), { status: 500, headers: { 'content-type': 'application/json' } })
      : new Response('data: {"candidates":[{"content":{"parts":[{"text":"Own model"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const { runAssistant } = await import('../_lib/agent.js')
    expect(await runAssistant(runInput('hello'))).toMatchObject({ status: 'completed', providerId: 'gemini', modelId: 'Google Gemini', content: 'Own model' })
    expect(calls).toBe(3)
    // Routed to the defaults first, so the input counts once, even though the own model answered.
    expect(rpcCalls.filter(call => call.name === 'ai_take_daily_slot')).toHaveLength(1)
    expect(JSON.stringify([db.ai_messages, db.ai_tasks])).not.toContain('gemini-2.5-flash')
  })

  it('when every admin model fails and the student has none, the message points to the AI window and Settings without leaking details', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 }), await siteRow({ provider_id: 'custom', base_url: SITE_URL, protocol: 'openai-compatible', model_id: 'vendor/x', priority: 2, is_default: false })]
    providerReply = () => new Response(JSON.stringify({ error: { code: 401, message: `bad key ${SITE_KEY} at ${SITE_URL}`, status: 'UNAUTHENTICATED' } }), { status: 401, headers: { 'content-type': 'application/json' } })
    const { runAssistant } = await import('../_lib/agent.js')
    const error = await runAssistant(runInput('hello')).catch(failure => failure as { code: string; message: string })
    expect(error).toMatchObject({ code: 'stracker_ai_unavailable', message: STRACKER_UNAVAILABLE_TEXT })
    expect(JSON.stringify(error)).not.toContain(SITE_KEY)
    expect(JSON.stringify(error)).not.toContain('hidden-vendor')
  })

  it('the daily limit is one account-level counter: same bucket and owner limit for every admin model and after reordering', async () => {
    db.site_ai_settings = [{ id: 1, enabled: true, per_user_per_minute: 10, per_user_daily: 40 }]
    const first = await siteRow({ priority: 1 }); const second = await siteRow({ priority: 2, is_default: false, model_id: 'models/gemini-second' })
    db.site_ai_providers = [first, second]
    let calls = 0
    providerReply = () => (++calls % 2 === 1
      ? new Response(JSON.stringify({ error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }), { status: 503, headers: { 'content-type': 'application/json' } })
      : new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const { runAssistant } = await import('../_lib/agent.js')
    await runAssistant(runInput('hello'))
    db.site_ai_providers = [{ ...second, priority: 1, cooldown_until: null, failure_count: 0, connection_status: 'connected' }, { ...first, priority: 2, cooldown_until: null, failure_count: 0, connection_status: 'connected' }]
    await runAssistant(runInput('hello again'))
    const daily = rpcCalls.filter(call => call.name === 'ai_take_daily_slot').map(call => call.args)
    expect(daily).toEqual([{ owner: USER, bucket: 'stracker_day', per_user_limit: 40 }, { owner: USER, bucket: 'stracker_day', per_user_limit: 40 }])
  })

  it('own model answers never count and are never blocked by the default limit', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 })]
    db.ai_provider_configs = [await ownRow()]
    db.ai_user_preferences = [{ user_id: USER, preferred: 'own' }]
    providerReply = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"Own"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const { runAssistant } = await import('../_lib/agent.js')
    expect(await runAssistant(runInput('hello'))).toMatchObject({ status: 'completed', providerId: 'gemini' })
    expect(rpcCalls.filter(call => call.name === 'ai_take_daily_slot')).toHaveLength(0)
  })

  it('when today\u2019s default limit is used up, chat goes straight on with the student\u2019s own model', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 })]
    db.ai_provider_configs = [await ownRow()]
    dailyAllowed = false
    providerReply = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"Own model"}]}}]}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const { runAssistant } = await import('../_lib/agent.js')
    expect(await runAssistant(runInput('hello'))).toMatchObject({ status: 'completed', providerId: 'gemini', content: 'Own model' })
  })

  it('with no own model, an exhausted limit says try again after midnight; with a broken own model it says check Settings', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 })]
    dailyAllowed = false
    const { runAssistant } = await import('../_lib/agent.js')
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_daily_limit', message: expect.stringContaining('Add your own AI model') })
    db.ai_provider_configs = [{ ...(await ownRow()), connection_status: 'authentication_failed' }]
    const failure = await runAssistant(runInput('hello')).then(() => ({ code: '', message: '' }), error => error as { code: string; message: string })
    expect(failure.message).not.toContain('Add your own')
  })

  it('an input still counts once when every default model errors, and a retry is a new input', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 }), await siteRow({ priority: 2, is_default: false, model_id: 'models/gemini-second' })]
    providerReply = () => new Response(JSON.stringify({ error: { code: 500, message: 'internal', status: 'INTERNAL' } }), { status: 500, headers: { 'content-type': 'application/json' } })
    const { runAssistant } = await import('../_lib/agent.js')
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_unavailable' })
    const daily = () => rpcCalls.filter(call => call.name === 'ai_take_daily_slot')
    expect(daily()).toHaveLength(1)
    expect(daily()[0]!.args).toMatchObject({ owner: USER, bucket: 'stracker_day', per_user_limit: 40 })
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_unavailable' })
    expect(daily()).toHaveLength(2)
  })

  it('owner reorder rewrites priorities 1..n and the chain follows the new order', async () => {
    const a = await siteRow({ display_name: 'A', priority: 1 })
    const b = await siteRow({ display_name: 'B', priority: 2, is_default: false })
    const c = await siteRow({ display_name: 'C', priority: 3, is_default: false })
    db.site_ai_providers = [a, b, c]
    const { reorderSiteProviders, readSiteProviders } = await import('../_lib/stracker-default.js')
    expect(await reorderSiteProviders(adminClient as never, c.id, 'up')).toEqual({ order: [a.id, c.id, b.id], position: 2 })
    expect(db.site_ai_providers.map(row => [row.id, row.priority])).toEqual([[a.id, 1], [b.id, 3], [c.id, 2]])
    expect(await reorderSiteProviders(adminClient as never, a.id, 'up')).toEqual({ order: [a.id, c.id, b.id], position: 1 })
    expect(await reorderSiteProviders(adminClient as never, crypto.randomUUID(), 'down')).toBe('not_found')
    expect((await readSiteProviders(adminClient as never)).length).toBe(3)
  })

  it('students cannot reorder the owner\u2019s models', async () => {
    db.site_ai_providers = [await siteRow({ priority: 1 })]
    const res = await call(await providers(), 'PATCH', { id: db.site_ai_providers[0]!.id, action: 'move_up' })
    expect(res.status).toBe(400)
    expect(db.site_ai_providers[0]!.priority).toBe(1)
  })

  it('enforces the per-student Stracker AI limit with a clear message', async () => {
    db.site_ai_providers = [await siteRow()]
    rpcAllowed = false
    const { runAssistant } = await import('../_lib/agent.js')
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_limit', status: 429 })
  })

  it('the owner switch turns the default off for students', async () => {
    db.site_ai_providers = [await siteRow()]
    db.site_ai_settings = [{ id: 1, enabled: false, per_user_per_minute: 4, per_user_daily: 40 }]
    const { runAssistant } = await import('../_lib/agent.js')
    await expect(runAssistant(runInput('hello'))).rejects.toMatchObject({ code: 'stracker_ai_unavailable' })
    expect(((await call(await providers(), 'GET')).json.stracker as Row).status).toBe('unavailable')
  })

  it('students cannot reach the owner settings route', async () => {
    const res = await call(await providers(), 'PUT', { settings: { enabled: false, perUserPerMinute: 1, perUserDaily: 1 } })
    expect(res.status).toBe(405)
  })
})

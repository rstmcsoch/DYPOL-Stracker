import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const state = vi.hoisted(() => ({ writes: [] as unknown[], audits: [] as Array<Record<string, unknown>>, mfaChecked: [] as string[], options: [] as unknown[], draft: null as unknown, rpc: [] as unknown[] }))

vi.mock('../control.js', () => ({
  recordAuditEvent: async (_admin: unknown, event: Record<string, unknown>) => { state.audits.push(event); return true },
  requireRecentMfa: async (_context: unknown, attempted: { action: string }) => { state.mfaChecked.push(attempted.action) },
  controlHandler: async (_req: unknown, res: { statusCode?: number; body?: unknown }, _methods: string[], options: unknown, run: (context: unknown) => Promise<void>) => {
    state.options.push(options)
    const query = (rows: unknown) => {
      const chain: Record<string, unknown> = {}
      Object.assign(chain, { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: rows, error: null }) })
      return chain
    }
    const admin = {
      from: (table: string) => ({
        ...query(table === 'student_layout_draft' ? state.draft : null),
        upsert: async (row: unknown) => { state.writes.push({ table, row }); return { error: null } },
        delete: () => ({ eq: async () => { state.writes.push({ table, delete: true }); return { error: null } } })
      }),
      rpc: async (name: string, args: unknown) => { state.rpc.push({ name, args }); return { data: 1, error: null } }
    }
    try { await run({ userId: 'owner-1', role: 'owner', requestId: 'req-1', admin }) } catch (error) {
      if (error instanceof ApiError) { res.statusCode = error.status; res.body = { error: error.code } } else throw error
    }
  }
}))
vi.mock('../http.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../http.js')>()
  return { ...actual, readJson: async (req: { body: unknown }) => req.body, sendJson: (res: { statusCode?: number; body?: unknown }, status: number, body: unknown) => { res.statusCode = status; res.body = body } }
})

const { studentLayoutDraftHandler, studentLayoutPublishHandler, studentLayoutStateHandler, changedAreas, checkLayoutForWrite } = await import('./student-layout.js')

type Res = { statusCode?: number; body?: Record<string, unknown> }
const call = async (handler: (req: never, res: never) => Promise<void>, body: unknown): Promise<Res> => {
  const res: Res = {}
  await handler({ method: 'PUT', body } as never, res as never)
  return res
}

beforeEach(() => { state.writes = []; state.audits = []; state.mfaChecked = []; state.options = []; state.draft = null; state.rpc = [] })

describe('student layout API', () => {
  it('requires aal2 and the appearance permissions', async () => {
    await call(studentLayoutStateHandler, undefined)
    await call(studentLayoutDraftHandler, { document: { schemaVersion: 1 } })
    await call(studentLayoutPublishHandler, {})
    expect(state.options).toEqual([
      { requireAal2: true, permission: 'appearance.edit' },
      { requireAal2: true, permission: 'appearance.edit' },
      { requireAal2: true, permission: 'appearance.publish' }
    ])
  })

  it('rejects data overrides with data_locked and writes nothing', async () => {
    const res = await call(studentLayoutDraftHandler, { document: { schemaVersion: 1, components: { 'home.streak': { text: { current: '100' } } } } })
    expect(res.statusCode).toBe(422)
    expect(res.body?.error).toBe('data_locked')
    expect(state.writes).toEqual([])
  })

  it('saves a valid presentation draft', async () => {
    const res = await call(studentLayoutDraftHandler, { document: { schemaVersion: 1, components: { 'home.tip': { hidden: true } } } })
    expect(res.statusCode).toBe(200)
    expect(state.writes).toHaveLength(1)
  })

  it('publish needs fresh MFA and refuses a draft that no longer validates', async () => {
    state.draft = { document: { schemaVersion: 1, components: { 'home.today-plan': { hidden: true } } } }
    const res = await call(studentLayoutPublishHandler, {})
    expect(state.mfaChecked).toEqual(['student_layout.publish'])
    expect(res.statusCode).toBe(422)
    expect(state.rpc).toEqual([])
  })

  it('publishes a valid draft through the commit function and audits it', async () => {
    state.draft = { document: { schemaVersion: 1, components: { 'home.tip': { hidden: true } } } }
    const res = await call(studentLayoutPublishHandler, { note: 'Hide tip' })
    expect(res.statusCode).toBe(200)
    expect(state.rpc).toHaveLength(1)
    expect(state.audits.at(-1)).toMatchObject({ action: 'student_layout.publish', outcome: 'success' })
  })

  it('summarises changed areas', () => {
    expect(changedAreas(null, { schemaVersion: 1, components: { 'home.tip': { hidden: true } }, tokens: { radius: '10px' } })).toEqual(['home', 'tokens'])
    expect(checkLayoutForWrite({ schemaVersion: 1, marks: 1 }).ok).toBe(false)
  })
})

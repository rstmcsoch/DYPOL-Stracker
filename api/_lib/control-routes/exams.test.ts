import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: unknown; patch: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  upsertError: null as unknown
}))

function builder() {
  let filterId: unknown
  let single = false
  let limit = 0
  let descending = false
  const api = {
    select: () => api,
    order: (_column: string, options?: { ascending?: boolean }) => { if (options?.ascending === false) descending = true; return api },
    limit: (count: number) => { limit = count; return api },
    eq: (_column: string, value: unknown) => { filterId = value; return api },
    maybeSingle: () => { single = true; return api },
    upsert: async (row: Record<string, unknown>) => { state.upserts.push(row); return { error: state.upsertError } },
    update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => { state.updates.push({ id, patch }); return { error: null } } }),
    then: (resolve: (value: unknown) => void) => {
      let rows = filterId === undefined ? [...state.rows] : state.rows.filter(row => row.id === filterId)
      rows.sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      if (descending) rows.reverse()
      if (limit) rows = rows.slice(0, limit)
      resolve({ data: single ? rows[0] ?? null : rows, error: null })
    }
  }
  return api
}

vi.mock('../control.js', () => ({
  recordAuditEvent: async (_admin: unknown, event: Record<string, unknown>) => { state.audits.push(event); return true },
  controlHandler: async (_req: unknown, res: { statusCode?: number; body?: unknown }, _methods: string[], _options: unknown, run: (context: unknown) => Promise<void>) => {
    try {
      await run({ userId: '00000000-0000-4000-8000-000000000001', role: 'owner', requestId: 'r1', admin: { from: () => builder() } })
    } catch (error) {
      if (error instanceof ApiError) { res.statusCode = error.status; res.body = { error: error.code } } else throw error
    }
  }
}))

import { examsHandler } from './exams.js'

function call(method: string, body?: Record<string, unknown>) {
  const res: { statusCode?: number; body?: unknown; setHeader: () => void; end: (text: string) => void } = {
    setHeader: () => undefined,
    end(text: string) { this.body = JSON.parse(text) }
  }
  return examsHandler({ method, body } as never, res as never).then(() => res)
}

const exam = (overrides: Record<string, unknown> = {}) => ({ id: 'neet-pg', name: 'NEET PG', category: 'Medical', years: [], sessions: [], boards: [], boards_addon: false, hidden: false, ...overrides })

beforeEach(() => {
  state.rows = [{ id: 'jee', name: 'JEE', category: 'Engineering', sort_order: 10, hidden: false }, { id: 'cat', name: 'CAT', category: 'Postgraduate', sort_order: 20, hidden: true }]
  state.upserts = []; state.updates = []; state.audits = []; state.upsertError = null
})

describe('owner exam catalogue', () => {
  it('lists every exam including hidden ones', async () => {
    const res = await call('GET')
    expect((res.body as { exams: Array<{ id: string }> }).exams.map(item => item.id)).toEqual(['jee', 'cat'])
  })

  it('adds a new exam at the end and audits it', async () => {
    const res = await call('PUT', { exam: exam({ years: [2028, 2027, 2028] }) })
    expect(res.statusCode).toBe(200)
    expect(state.upserts[0]).toMatchObject({ id: 'neet-pg', sort_order: 30, years: [2027, 2028] })
    expect(state.audits[0]).toMatchObject({ action: 'exam.create', targetId: 'neet-pg', outcome: 'success' })
  })

  it('records hiding as a soft delete', async () => {
    await call('PUT', { exam: exam({ id: 'jee', name: 'JEE', category: 'Engineering', hidden: true }) })
    expect(state.upserts[0]).toMatchObject({ id: 'jee', hidden: true, sort_order: 10 })
    expect(state.audits[0]).toMatchObject({ action: 'exam.hide' })
  })

  it('rejects bad input without writing', async () => {
    expect((await call('PUT', { exam: exam({ id: 'Bad Id' }) })).statusCode).toBe(400)
    expect((await call('PUT', { exam: exam({ years: [1999] }) })).statusCode).toBe(400)
    expect((await call('PUT', { exam: { ...exam(), extra: 1 } })).statusCode).toBe(400)
    expect(state.upserts).toEqual([])
  })

  it('reorders known exams only', async () => {
    expect((await call('POST', { order: ['cat', 'jee'] })).statusCode).toBe(200)
    expect(state.updates.map(item => [item.id, item.patch.sort_order])).toEqual([['cat', 10], ['jee', 20]])
    expect(state.audits.at(-1)).toMatchObject({ action: 'exam.reorder' })
    expect((await call('POST', { order: ['nope'] })).statusCode).toBe(400)
  })
})

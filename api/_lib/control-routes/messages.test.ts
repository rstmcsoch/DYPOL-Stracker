import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const state = vi.hoisted(() => ({
  ops: [] as string[][],
  row: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: 0,
  audits: [] as Array<Record<string, unknown>>,
  listError: null as unknown,
  removeError: null as unknown,
  removed: [] as string[][],
  signed: [] as Array<{ path: string; seconds: number }>
}))

function chain() {
  const ops: string[] = []
  state.ops.push(ops)
  const api: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'neq', 'in', 'or', 'order', 'range', 'lt', 'limit']) api[name] = (...args: unknown[]) => { ops.push(`${name}:${JSON.stringify(args)}`); return api }
  api.update = (patch: Record<string, unknown>) => { state.updates.push(patch); return api }
  api.delete = () => { state.deletes += 1; return api }
  api.maybeSingle = async () => ({ data: state.row, error: null })
  api.then = (resolve: (value: unknown) => void) => resolve({ data: state.rows, error: null, count: state.rows.length })
  return api
}

const admin = {
  from: () => chain(),
  storage: {
    from: () => ({
      list: async () => ({ data: state.listError ? null : [{ name: '1-a.pdf' }], error: state.listError }),
      remove: async (paths: string[]) => { state.removed.push(paths); return { error: state.removeError } },
      createSignedUrl: async (path: string, seconds: number) => { state.signed.push({ path, seconds }); return { data: { signedUrl: `https://signed/${path}` }, error: null } }
    })
  }
}

vi.mock('../control.js', () => ({
  recordAuditEvent: async (_admin: unknown, event: Record<string, unknown>) => { state.audits.push(event); return true },
  controlHandler: async (_req: unknown, res: { statusCode?: number; body?: unknown }, _methods: string[], options: { requireAal2: boolean }, run: (context: unknown) => Promise<void>) => {
    expect(options.requireAal2).toBe(true)
    try {
      await run({ userId: '00000000-0000-4000-8000-000000000001', role: 'owner', requestId: 'r1', admin })
    } catch (error) {
      if (error instanceof ApiError) { res.statusCode = error.status; res.body = { error: error.code, message: error.message } } else throw error
    }
  }
}))

import { messagesHandler, searchTerm } from './messages.js'

const id = '11111111-1111-4111-8111-111111111111'
function call(method: string, url: string, body?: Record<string, unknown>) {
  const res: { statusCode?: number; body?: Record<string, unknown>; headersSent: boolean; setHeader: () => void; end: (text: string) => void } = {
    headersSent: false, setHeader: () => undefined, end(text: string) { this.body = JSON.parse(text) }
  }
  return messagesHandler({ method, url, body, headers: {} } as never, res as never).then(() => res)
}

beforeEach(() => {
  Object.assign(state, { ops: [], row: null, rows: [], updates: [], deletes: 0, audits: [], listError: null, removeError: null, removed: [], signed: [] })
})

describe('owner messages inbox', () => {
  it('lists messages without pending uploads, with filters and a safe search', async () => {
    state.rows = [{ id, created_at: '2026-11-14T04:00:00Z', name: 'Asha', email: 'a@b.co', reason: 'bug_report', subject: null, message: 'x'.repeat(300), status: 'new', read_at: null, attachments: [{}], links: [] }]
    const res = await call('GET', '/api/control/messages?status=new&reason=bug_report&q=planner,(x)&page=1')
    expect(res.statusCode).toBe(200)
    const list = res.body!.messages as Array<Record<string, unknown>>
    expect(list[0]).toMatchObject({ id, fileCount: 1, linkCount: 0 })
    expect((list[0]!.preview as string).length).toBeLessThanOrEqual(160)
    expect(list[0]).not.toHaveProperty('message')
    const query = state.ops[0]!.join(' ')
    expect(query).toContain('neq:["status","pending"]')
    expect(query).toContain('eq:["status","new"]')
    expect(query).toContain('eq:["reason","bug_report"]')
    expect(query).toContain('name.ilike.*planner x*')
    expect(searchTerm('a,b)(c%_d')).toBe('a b c _d')
  })

  it('rejects unknown filters', async () => {
    expect((await call('GET', '/api/control/messages?status=pending')).statusCode).toBe(400)
    expect((await call('GET', '/api/control/messages?reason=spam')).statusCode).toBe(400)
  })

  it('returns one message with short-lived signed file URLs and never the storage path', async () => {
    state.row = { id, created_at: 'x', name: 'Asha', email: 'a@b.co', reason: 'bug_report', subject: 'Planner', message: 'Broken', details: { area: 'Planner' }, links: ['https://a.example/'], attachments: [{ path: `${id}/1-a.pdf`, name: 'a.pdf', size: 10, type: 'application/pdf' }], status: 'new', read_at: null, user_id: null }
    const res = await call('GET', `/api/control/messages?id=${id}`)
    const message = res.body!.message as Record<string, unknown>
    expect(message.files).toEqual([{ name: 'a.pdf', size: 10, type: 'application/pdf', viewUrl: `https://signed/${id}/1-a.pdf`, downloadUrl: `https://signed/${id}/1-a.pdf` }])
    expect(state.signed.every(entry => entry.seconds === 300)).toBe(true)
    expect(JSON.stringify(message)).not.toContain('"path"')
    expect(message).not.toHaveProperty('user_id')
  })

  it('marks read/unread/archived and audits by id only', async () => {
    state.row = { id, status: 'new' }
    const res = await call('POST', '/api/control/messages', { action: 'status', id, status: 'read' })
    expect(res.statusCode).toBe(200)
    expect(state.updates[0]).toMatchObject({ status: 'read' })
    expect(state.updates[0]!.read_at).toBeTruthy()
    expect(state.audits[0]).toMatchObject({ action: 'message.status', targetType: 'contact_message', targetId: id, outcome: 'success' })
    await call('POST', '/api/control/messages', { action: 'status', id, status: 'new' })
    expect(state.updates[1]).toMatchObject({ status: 'new', read_at: null })
    expect((await call('POST', '/api/control/messages', { action: 'status', id, status: 'pending' })).statusCode).toBe(400)
  })

  it('deletes the files first, then the message; keeps the message if files cannot be removed', async () => {
    state.row = { id, status: 'read' }
    expect((await call('POST', '/api/control/messages', { action: 'delete', id })).statusCode).toBe(200)
    expect(state.removed).toEqual([[`${id}/1-a.pdf`]])
    expect(state.deletes).toBe(1)
    state.removeError = { message: 'boom' }
    const res = await call('POST', '/api/control/messages', { action: 'delete', id })
    expect(res.statusCode).toBe(503)
    expect(state.deletes).toBe(1)
    expect(state.audits.at(-1)).toMatchObject({ action: 'message.delete', outcome: 'failed' })
  })

  it('404s a missing or pending message', async () => {
    state.row = null
    expect((await call('POST', '/api/control/messages', { action: 'delete', id })).statusCode).toBe(404)
    expect((await call('GET', `/api/control/messages?id=${id}`)).statusCode).toBe(404)
  })
})

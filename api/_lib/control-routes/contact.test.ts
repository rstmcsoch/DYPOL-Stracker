import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  rateAllowed: true as boolean,
  rateError: null as unknown,
  rpcCalls: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: 0,
  row: null as Record<string, unknown> | null,
  objects: [] as Array<{ name: string; metadata: { size: number; mimetype: string } }>,
  removed: [] as string[][],
  heads: new Map<string, Uint8Array>()
}))

function chain(table: string) {
  const ops: string[] = []
  const api: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'neq', 'lt', 'limit', 'in', 'or', 'order', 'range']) api[name] = () => { ops.push(name); return api }
  api.insert = async (row: Record<string, unknown>) => { state.inserts.push({ table, ...row }); return { error: null } }
  api.update = (patch: Record<string, unknown>) => { state.updates.push(patch); return api }
  api.delete = () => { state.deletes += 1; return api }
  api.maybeSingle = async () => ({ data: state.row, error: null })
  api.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
  return api
}

const admin = {
  rpc: async (_name: string, args: Record<string, unknown>) => { state.rpcCalls.push(args); return { data: state.rateAllowed, error: state.rateError } },
  from: (table: string) => chain(table),
  storage: {
    from: () => ({
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/contact-attachments/${path}?token=t`, token: 't', path }, error: null }),
      list: async () => ({ data: state.objects, error: null }),
      remove: async (paths: string[]) => { state.removed.push(paths); return { error: null } },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null })
    })
  }
}

vi.mock('../control.js', () => ({
  serviceClient: () => ({ url: 'https://x.supabase.co', anonKey: 'anon', admin }),
  clientKeyHash: () => 'a'.repeat(32)
}))

import { CONTACT_BURST_RATE, contactHandler, hashToken, parseStart, uploadProblem } from './contact.js'

const MB = 1024 * 1024
const valid = (overrides: Record<string, unknown> = {}) => ({ action: 'start', name: 'Asha', email: 'asha@example.com', reason: 'general_query', subject: '', message: 'How do I export my tests?', ...overrides })

function call(body: Record<string, unknown>, method = 'POST') {
  const res: { statusCode?: number; body?: Record<string, unknown>; headers: Record<string, string>; headersSent: boolean; setHeader: (k: string, v: string) => void; end: (text: string) => void } = {
    headers: {}, headersSent: false,
    setHeader(key, value) { this.headers[key] = value },
    end(text) { this.body = JSON.parse(text) }
  }
  return contactHandler({ method, body, headers: {} } as never, res as never).then(() => res)
}

beforeEach(() => {
  Object.assign(state, { rateAllowed: true, rateError: null, rpcCalls: [], inserts: [], updates: [], deletes: 0, row: null, objects: [], removed: [], heads: new Map() })
  vi.stubGlobal('fetch', async (url: string) => {
    const path = url.replace('https://signed/', '')
    const head = state.heads.get(path) ?? new Uint8Array()
    return new Response(head as unknown as BodyInit, { status: 206 })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/contact validation', () => {
  it('rejects bad lengths, emails, reasons and unknown fields with per-field messages', async () => {
    const res = await call(valid({ name: '', email: 'nope', reason: 'spam', message: 'hi' }))
    expect(res.statusCode).toBe(400)
    expect(Object.keys(res.body!.fields as object).sort()).toEqual(['email', 'message', 'name', 'reason'])
    expect((await call(valid({ unexpected: 1 }))).statusCode).toBe(400)
    expect((await call(valid({ reason: 'bug_report', details: { area: 'Planner', secret: 'x' } }))).statusCode).toBe(400)
    expect((await call(valid({ links: ['javascript:alert(1)'] }))).statusCode).toBe(400)
    expect(state.inserts).toEqual([])
  })

  it('rejects disallowed or oversized files before anything is stored', async () => {
    expect((await call(valid({ files: [{ name: 'a.exe', size: 10, type: 'application/octet-stream' }] }))).body!.fields).toMatchObject({ files: expect.stringMatching(/PDF, JPG or PNG/) })
    expect((await call(valid({ files: [{ name: 'a.pdf', size: 11 * MB, type: 'application/pdf' }] }))).statusCode).toBe(400)
    expect((await call(valid({ files: [{ name: 'a.pdf', size: 8 * MB, type: 'application/pdf' }, { name: 'b.png', size: 8 * MB, type: 'image/png' }] }))).statusCode).toBe(400)
    expect(state.inserts).toEqual([])
  })

  it('only accepts POST', async () => {
    expect((await call({}, 'GET')).statusCode).toBe(405)
  })

  it('stores whitelisted details and normalised links only', () => {
    const parsed = parseStart(valid({ reason: 'sponsorship', details: { organisation: ' Acme ', website: 'https://acme.example' }, links: ['https://a.example', ''] }))
    expect(parsed.row.details).toEqual({ organisation: 'Acme', website: 'https://acme.example/' })
    expect(parsed.row.links).toEqual(['https://a.example/'])
  })
})

describe('POST /api/contact storage, honeypot and rate limits', () => {
  it('stores a message without files as new, with the hashed client key and no raw address', async () => {
    const res = await call(valid())
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, finalised: true })
    expect(state.inserts[0]).toMatchObject({ table: 'contact_messages', status: 'new', client_hash: 'a'.repeat(32), upload_token_hash: null })
  })

  it('treats a filled honeypot as success without storing anything or spending a rate slot', async () => {
    const res = await call(valid({ website: 'https://spam.example' }))
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, id: null })
    expect(state.inserts).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('uses per-network burst and daily buckets and answers 429 when either is spent', async () => {
    await call(valid())
    expect(state.rpcCalls.map(args => args.bucket)).toEqual(['contact-burst', 'contact-day'])
    expect(state.rpcCalls[0]).toMatchObject({ actor_key: `contact:${'a'.repeat(32)}`, per_limit: CONTACT_BURST_RATE.limit })
    state.rateAllowed = false
    const res = await call(valid())
    expect(res.statusCode).toBe(429)
    state.rateAllowed = true
    state.rateError = { code: 'x' }
    expect((await call(valid())).statusCode).toBe(503)
  })

  it('creates a pending message with one signed upload URL per declared file', async () => {
    const res = await call(valid({ files: [{ name: 'shot.png', size: 1000, type: 'image/png' }, { name: 'doc.pdf', size: 2000, type: 'application/pdf' }] }))
    expect(res.statusCode).toBe(200)
    expect(state.inserts[0]).toMatchObject({ status: 'pending' })
    expect((state.inserts[0]!.upload_token_hash as string)).toHaveLength(64)
    const uploads = res.body!.uploads as Array<{ path: string; signedUrl: string }>
    expect(uploads.map(upload => upload.path)).toEqual([`${res.body!.id}/1-shot.png`, `${res.body!.id}/2-doc.pdf`])
    expect(res.body!.token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('finalising uploads', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const token = 'b'.repeat(64)
  const planned = [{ path: `${id}/1-shot.png`, name: 'shot.png', size: 8, type: 'image/png' }]
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('publishes the message only after size, MIME and magic bytes match', async () => {
    state.row = { id, status: 'pending', attachments: planned, upload_token_hash: hashToken(token), reason: 'bug_report', user_id: null }
    state.objects = [{ name: '1-shot.png', metadata: { size: 8, mimetype: 'image/png' } }]
    state.heads.set(`${id}/1-shot.png`, png)
    const res = await call({ action: 'finalize', id, token })
    expect(res.statusCode).toBe(200)
    expect(state.updates[0]).toMatchObject({ status: 'new', upload_token_hash: null })
    expect(state.removed).toEqual([])
  })

  it('deletes the message and its files when a file is not what it claims', async () => {
    state.row = { id, status: 'pending', attachments: planned, upload_token_hash: hashToken(token), reason: 'bug_report', user_id: null }
    state.objects = [{ name: '1-shot.png', metadata: { size: 8, mimetype: 'image/png' } }]
    state.heads.set(`${id}/1-shot.png`, new TextEncoder().encode('<html>..'))
    const res = await call({ action: 'finalize', id, token })
    expect(res.statusCode).toBe(400)
    expect(res.body!.message).toMatch(/does not look like a real PNG/)
    expect(state.removed).toEqual([[`${id}/1-shot.png`]])
    expect(state.deletes).toBe(1)
    expect(state.updates).toEqual([])
  })

  it('refuses a wrong token or a message that is no longer pending', async () => {
    state.row = { id, status: 'pending', attachments: planned, upload_token_hash: hashToken('c'.repeat(64)) }
    expect((await call({ action: 'finalize', id, token })).statusCode).toBe(404)
    state.row = { id, status: 'new', attachments: planned, upload_token_hash: hashToken(token) }
    expect((await call({ action: 'cancel', id, token })).statusCode).toBe(404)
    expect(state.deletes).toBe(0)
  })

  it('uploadProblem catches missing, extra, resized, retyped and oversized files', () => {
    const heads = new Map([[`${id}/1-shot.png`, png]])
    const ok = [{ name: '1-shot.png', size: 8, mimetype: 'image/png' }]
    expect(uploadProblem(planned as never, ok, heads, id)).toBeNull()
    expect(uploadProblem(planned as never, [], heads, id)).toMatch(/did not finish/)
    expect(uploadProblem(planned as never, [...ok, { name: 'x.png', size: 1, mimetype: 'image/png' }], heads, id)).toMatch(/Unexpected/)
    expect(uploadProblem(planned as never, [{ ...ok[0]!, size: 9 }], heads, id)).toMatch(/size/)
    expect(uploadProblem(planned as never, [{ ...ok[0]!, mimetype: 'text/html' }], heads, id)).toMatch(/not a PDF/)
    const big = [{ path: `${id}/1-a.pdf`, name: 'a.pdf', size: 11 * MB, type: 'application/pdf' }]
    expect(uploadProblem(big as never, [{ name: '1-a.pdf', size: 11 * MB, mimetype: 'application/pdf' }], new Map([[`${id}/1-a.pdf`, new TextEncoder().encode('%PDF-')]]), id)).toMatch(/10 MB/)
  })
})

describe('contact data boundary', () => {
  const root = join(__dirname, '..', '..', '..')
  const migration = readFileSync(join(root, 'supabase/migrations/20261114100000_contact_messages.sql'), 'utf8')

  it('locks contact_messages to the server: RLS forced, no policies, no anon/authenticated grants', () => {
    expect(migration).toMatch(/alter table public\.contact_messages enable row level security/)
    expect(migration).toMatch(/alter table public\.contact_messages force row level security/)
    expect(migration).toMatch(/revoke all on table public\.contact_messages from public, anon, authenticated/)
    expect(migration).not.toMatch(/create policy/i)
    expect(migration).not.toMatch(/grant [^;]* to (anon|authenticated)/i)
  })

  it('creates a private attachment bucket limited to PDF, JPEG and PNG at 10 MB', () => {
    expect(migration).toMatch(/'contact-attachments', 'contact-attachments', false, 10485760, array\['application\/pdf', 'image\/jpeg', 'image\/png'\]/)
    expect(migration).not.toMatch(/drop |truncate |delete from/i)
  })

  it('the contact page and inbox never touch the service-role key in browser code', () => {
    for (const file of ['src/pages/ContactPage.tsx', 'src/lib/contact/submit.ts', 'src/lib/contact/reasons.ts', 'src/control/messages/MessagesPage.tsx', 'src/components/contact/ReasonSelect.tsx']) {
      expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/SERVICE_ROLE|service_role|serviceRole/)
    }
  })
})

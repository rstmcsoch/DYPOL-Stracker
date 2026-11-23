import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'

type Row = Record<string, unknown>
const PUBLISHED = {
  schemaVersion: 1,
  pages: { home: { blocks: [{ id: 'home-hero', type: 'stracker.hero' }, { id: 'home-final', type: 'stracker.final' }] } }
}

const world = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  directPublishedMutations: [] as Array<{ table: string; mode: string }>
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'neq') return row[column] !== value
      if (op === 'in') return (value as unknown[]).includes(row[column])
      if (op === 'gte') return String(row[column] ?? '') >= String(value)
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
    const trackPublishedWrite = () => {
      if ((table === 'site_content_published' || table === 'student_layout_published') && mode !== 'select') {
        world.directPublishedMutations.push({ table, mode })
      }
    }
    const run = () => {
      if (mode !== 'select') trackPublishedWrite()
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
      select: (_cols?: string, options?: { count?: string; head?: boolean }) => { head = options?.head === true; return chain },
      order: (column: string, options?: { ascending?: boolean }) => { orderColumn = column; ascending = options?.ascending !== false; return chain },
      limit: (value: number) => { limit = value; return chain },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return chain },
      eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return chain },
      neq: (column: string, value: unknown) => { filters.push(['neq', column, value]); return chain },
      in: (column: string, value: unknown) => { filters.push(['in', column, value]); return chain },
      gte: (column: string, value: unknown) => { filters.push(['gte', column, value]); return chain },
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

  function commitSite(args: Row) {
    const published = (world.db.site_content_published ??= [])
    const current = published[0]
    if (current && JSON.stringify(current.content) === JSON.stringify(args.p_content) && JSON.stringify(current.document) === JSON.stringify(args.p_document)) {
      return { data: null, error: { message: 'no_changes' } }
    }
    const versions = (world.db.site_content_versions ??= [])
    const next = Math.max(0, ...versions.map(row => Number(row.version) || 0)) + 1
    versions.push({ version: next, content: args.p_content, document: args.p_document, schema_version: args.p_schema_version, action: args.p_action, restored_from: args.p_restored_from, note: args.p_note, created_at: '2026-11-23T11:50:00.000Z', created_by: args.p_actor })
    const row = { id: 1, content: args.p_content, document: args.p_document, schema_version: args.p_schema_version, version: next, published_at: '2026-11-23T11:50:00.000Z', published_by: args.p_actor }
    if (current) Object.assign(current, row)
    else published.push(row)
    world.db.site_content_draft = (world.db.site_content_draft ?? []).filter(item => item.id !== 1)
    return { data: next, error: null }
  }

  function commitLayout(args: Row) {
    const published = (world.db.student_layout_published ??= [])
    const current = published[0]
    if (current && JSON.stringify(current.document) === JSON.stringify(args.p_document)) {
      return { data: null, error: { message: 'no_changes' } }
    }
    const versions = (world.db.student_layout_versions ??= [])
    const next = Math.max(0, ...versions.map(row => Number(row.version) || 0)) + 1
    versions.push({ version: next, document: args.p_document, schema_version: args.p_schema_version, action: args.p_action, restored_from: args.p_restored_from, note: args.p_note, created_at: '2026-11-23T11:50:00.000Z', created_by: args.p_actor })
    const row = { id: 1, document: args.p_document, schema_version: args.p_schema_version, version: next, published_at: '2026-11-23T11:50:00.000Z', published_by: args.p_actor }
    if (current) Object.assign(current, row)
    else published.push(row)
    if (args.p_action === 'publish') world.db.student_layout_draft = (world.db.student_layout_draft ?? []).filter(item => item.id !== 1)
    return { data: next, error: null }
  }

  return {
    createClient: () => ({
      from: (table: string) => builder(table),
      rpc: async (name: string, args: Row) => {
        world.rpcCalls.push({ name, args })
        if (name === 'site_content_commit_document') return commitSite(args)
        if (name === 'student_layout_commit') return commitLayout(args)
        return { data: null, error: { message: 'unknown rpc' } }
      },
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: new Error('missing') }), listUsers: async () => ({ data: { users: [] }, error: null }) } }
    })
  }
})

vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co')
vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key')
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key')

function seed() {
  world.rpcCalls = []
  world.directPublishedMutations = []
  world.db = {
    site_content_published: [{
      id: 1, content: {}, document: PUBLISHED, schema_version: 1, version: 1,
      published_at: '2026-11-20T00:00:00.000Z', published_by: null
    }],
    site_content_draft: [],
    site_content_versions: [{
      version: 1, content: {}, document: PUBLISHED, schema_version: 1, action: 'publish',
      restored_from: null, note: 'initial', created_at: '2026-11-20T00:00:00.000Z', created_by: null
    }],
    student_layout_published: [{
      id: 1, document: { schemaVersion: 1 }, schema_version: 1, version: 1,
      published_at: '2026-11-20T00:00:00.000Z', published_by: null
    }],
    student_layout_draft: [],
    student_layout_versions: [{
      version: 1, document: { schemaVersion: 1 }, schema_version: 1, action: 'publish',
      restored_from: null, note: 'initial', created_at: '2026-11-20T00:00:00.000Z', created_by: null
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
  return { issued, options, audit }
}

async function callTool(token: string, name: string, args: Record<string, unknown>, options: Awaited<ReturnType<typeof runtime>>['options']) {
  const res = fakeRes()
  await handleMasterMcp(fakeReq(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), res, options)
  const payload = (res.body as { result: { isError?: boolean; structuredContent: Record<string, unknown> } }).result
  return { status: res.statusCode, payload }
}

async function confirm(token: string, name: string, args: Record<string, unknown>, options: Awaited<ReturnType<typeof runtime>>['options']) {
  const preview = await callTool(token, name, args, options)
  expect(preview.payload.structuredContent.needsConfirmation).toBe(true)
  return callTool(token, name, { ...args, confirmationToken: (preview.payload.structuredContent as { confirmationToken: string }).confirmationToken }, options)
}

beforeEach(() => seed())
afterEach(() => { vi.restoreAllMocks() })

describe('Master MCP public site and student layout editors', () => {
  it('updates a validated site draft, rejects invalid documents, and publishes only through the commit RPC', async () => {
    const { issued, options } = await runtime()
    const current = await callTool(issued.token, 'get_site_published_version', {}, options)
    expect(current.payload.structuredContent).toMatchObject({ version: 1 })

    const labels = await callTool(issued.token, 'update_site_navigation_labels', { labels: { 'public.header.login.label': 'Sign In' } }, options)
    expect(labels.payload.structuredContent).toMatchObject({ ok: true })
    expect(world.db.site_content_draft![0]?.content).toMatchObject({ 'public.header.login.label': 'Sign In' })
    expect(world.db.site_content_published![0]?.version).toBe(1)

    const tokens = await callTool(issued.token, 'update_site_design_tokens', { tokens: { 'light:paper': '#ffffff' } }, options)
    expect(tokens.payload.structuredContent).toMatchObject({ ok: true })

    const invalid = await callTool(issued.token, 'update_site_blocks', {
      page: 'home',
      blocks: [{ id: 'x3', type: 'script', props: {} }]
    }, options)
    expect(invalid.payload.structuredContent).toMatchObject({ ok: false, error: 'invalid_document' })
    expect(world.db.site_content_published![0]?.version).toBe(1)

    const validated = await callTool(issued.token, 'validate_site_content', {}, options)
    expect((validated.payload.structuredContent as { valid: boolean }).valid).toBe(true)

    const preview = await callTool(issued.token, 'preview_site_content', { page: 'home' }, options)
    expect(preview.payload.structuredContent).toMatchObject({ valid: true, page: 'home' })
    expect(String((preview.payload.structuredContent as { css: string }).css)).toMatch(/--/)

    const published = await confirm(issued.token, 'publish_site_content', { note: 'Master draft' }, options)
    expect(published.payload.isError).toBeFalsy()
    expect(published.payload.structuredContent).toMatchObject({ ok: true, version: 2 })
    expect(world.rpcCalls.some(call => call.name === 'site_content_commit_document' && call.args.p_action === 'publish' && call.args.p_actor === null)).toBe(true)
    expect(world.directPublishedMutations).toEqual([])
    expect(world.db.site_content_published![0]).toMatchObject({ version: 2, published_by: null })
    expect(world.db.site_content_draft).toEqual([])
    expect(world.db.site_content_versions!.some(row => row.version === 2 && row.action === 'publish')).toBe(true)

    const restored = await confirm(issued.token, 'restore_site_content_version', { version: 1 }, options)
    expect(restored.payload.structuredContent).toMatchObject({ ok: true, restored: 1, version: 3 })
    expect(world.rpcCalls.some(call => call.name === 'site_content_commit_document' && call.args.p_action === 'restore')).toBe(true)
    expect(world.directPublishedMutations).toEqual([])
  })

  it('rejects required-component hides and data-bound values, and publishes layouts only through student_layout_commit', async () => {
    const { issued, options } = await runtime()
    const required = await callTool(issued.token, 'update_student_dashboard_component', { id: 'home.countdown', hidden: true }, options)
    expect(required.payload.structuredContent).toMatchObject({ ok: false, error: 'invalid_layout' })
    expect(world.db.student_layout_draft).toEqual([])

    const locked = await callTool(issued.token, 'update_student_dashboard_component', { id: 'home.streak', text: { current: '100' } }, options)
    expect(locked.payload.structuredContent).toMatchObject({ ok: false, error: 'data_locked' })
    expect(world.db.student_layout_draft).toEqual([])

    const allowed = await callTool(issued.token, 'update_student_dashboard_component', { id: 'home.tip', hidden: true }, options)
    expect(allowed.payload.structuredContent).toMatchObject({ ok: true })
    expect((world.db.student_layout_draft![0]?.document as { components: Record<string, { hidden: boolean }> }).components['home.tip']?.hidden).toBe(true)
    expect(world.db.student_layout_published![0]?.version).toBe(1)

    const reordered = await callTool(issued.token, 'reorder_student_dashboard_components', { containerId: 'home.hero', order: ['home.streak', 'home.countdown'] }, options)
    expect(reordered.payload.structuredContent).toMatchObject({ ok: true })

    const invalidOrder = await callTool(issued.token, 'reorder_student_dashboard_components', { containerId: 'home.hero', order: ['home.streak'] }, options)
    expect(invalidOrder.payload.structuredContent).toMatchObject({ ok: false, error: 'invalid_layout' })

    const report = await callTool(issued.token, 'validate_student_dashboard_layout', {}, options)
    expect(report.payload.structuredContent).toMatchObject({ valid: true })

    const published = await confirm(issued.token, 'publish_student_dashboard_layout', { note: 'Hide tip' }, options)
    expect(published.payload.structuredContent).toMatchObject({ ok: true, version: 2 })
    expect(world.rpcCalls.some(call => call.name === 'student_layout_commit' && call.args.p_action === 'publish' && call.args.p_actor === null)).toBe(true)
    expect(world.directPublishedMutations).toEqual([])
    expect(world.db.student_layout_published![0]?.version).toBe(2)
    expect(world.db.student_layout_draft).toEqual([])
    expect((world.db.student_layout_published![0]?.document as { components: Record<string, { hidden: boolean }> }).components['home.tip']?.hidden).toBe(true)
  })
})

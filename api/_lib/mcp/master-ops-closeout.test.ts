import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMasterToolRegistry } from './registry.js'
import { MemoryAuditSink } from './audit.js'
import { MemoryCredentialStore, createCredential } from './credentials.js'
import { MemoryConfirmationStore } from './confirmations.js'
import { testHandlerOptions, handleMasterMcp } from './handler.js'
import { MemoryRateLimiter } from './rate-limit.js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { resolveReportingTimeZone } from '../services/master-analytics.js'
import { MEDIA_BUCKET } from '../../../src/lib/site-content/media.js'
import { CONTACT_BUCKET } from '../control-routes/contact.js'

type Row = Record<string, unknown>

const USED = 'site/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
const UNUSED = 'site/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'
const MESSAGE_ID = '11111111-1111-4111-8111-111111111111'
const ALERT_ID = '22222222-2222-4222-8222-222222222222'

const world = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  stored: {} as Record<string, Array<{ name: string }>>,
  removed: [] as string[],
  uploaded: [] as Array<{ bucket: string; path: string; contentType?: string }>,
  writes: [] as Array<{ table: string; mode: string; patch?: Row }>
}))

vi.mock('@supabase/supabase-js', () => {
  function match(row: Row, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'neq') return row[column] !== value
      if (op === 'in') return (value as unknown[]).includes(row[column])
      if (op === 'gte') return String(row[column] ?? '') >= String(value)
      if (op === 'ilike') {
        const term = String(value).replace(/\*/g, '').toLowerCase()
        return String(row[column] ?? '').toLowerCase().includes(term)
      }
      if (op === 'or') {
        const expr = String(value)
        const parts = expr.split(',')
        return parts.some(part => {
          const [left, pattern] = part.split('.ilike.')
          if (!left || pattern == null) return false
          return String(row[left] ?? '').toLowerCase().includes(pattern.replace(/\*/g, '').toLowerCase())
        })
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
      if (mode !== 'select') world.writes.push({ table, mode, patch: mode === 'delete' ? undefined : { ...patch } })
      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of filtered()) { Object.assign(row, patch); updated.push({ ...row }) }
        return { data: updated, count: updated.length, error: null }
      }
      if (mode === 'insert' || mode === 'upsert') {
        if (mode === 'upsert') {
          const incoming = inserted[0] ?? patch
          const key = 'key' in incoming ? 'key' : 'id'
          const existing = rows().find(row => row[key] === incoming[key])
          if (existing) Object.assign(existing, incoming)
          else rows().push(incoming)
          inserted = [existing ?? incoming]
        }
        return { data: inserted, count: inserted.length, error: null }
      }
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
      gt: (column: string, value: unknown) => { filters.push(['gte', column, value]); return chain },
      lt: () => chain,
      lte: () => chain,
      is: () => chain,
      not: () => chain,
      or: (value: string) => { filters.push(['or', '', value]); return chain },
      update: (value: Row) => { mode = 'update'; patch = value; return chain },
      insert: (value: Row | Row[]) => {
        mode = 'insert'
        inserted = (Array.isArray(value) ? value : [value]).map(row => ({ ...row }))
        rows().push(...inserted)
        return chain
      },
      upsert: (value: Row) => { mode = 'upsert'; inserted = [{ ...value }]; patch = value; return chain },
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
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'not implemented in fixture' } }),
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string) => ({ data: world.stored[`${bucket}/${folder}`] ?? [], error: null }),
          createSignedUploadUrl: async (path: string) => ({ data: { token: 'signed-upload-token', path }, error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://media.example/${path}` } }),
          remove: async (paths: string[]) => { world.removed.push(...paths.map(path => `${bucket}:${path}`)); return { error: null } },
          upload: async (path: string, _body: unknown, options?: { contentType?: string }) => {
            world.uploaded.push({ bucket, path, contentType: options?.contentType })
            const folder = path.split('/').slice(0, -1).join('/')
            const name = path.split('/').at(-1) as string
            const key = `${bucket}/${folder}`
            world.stored[key] = [...(world.stored[key] ?? []), { name }]
            return { error: null }
          },
          createSignedUrl: async (path: string, _seconds: number, options?: { download?: string }) => ({
            data: { signedUrl: `https://signed.example/${path}?exp=300${options?.download ? `&dl=${options.download}` : ''}` }
          })
        })
      }
    })
  }
})

function seed() {
  world.writes = []
  world.removed = []
  world.uploaded = []
  world.stored = {
    [`${MEDIA_BUCKET}/site/image`]: [
      { name: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg' },
      { name: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg' }
    ],
    [`${CONTACT_BUCKET}/${MESSAGE_ID}`]: [{ name: 'shot.png' }]
  }
  world.db = {
    site_media: [
      { path: USED, kind: 'image', mime: 'image/jpeg', bytes: 1200, created_at: '2026-11-20T00:00:00.000Z', name: 'Hero', alt: 'Hero photo' },
      { path: UNUSED, kind: 'image', mime: 'image/png', bytes: 800, created_at: '2026-11-21T00:00:00.000Z', name: 'Spare', alt: 'Unused asset' }
    ],
    site_content_draft: [{ content: { hero: `https://media.example/${USED}` }, document: { image: USED } }],
    site_content_published: [{ content: { hero: USED }, document: {} }],
    site_content_versions: [{ content: { hero: USED }, document: {} }],
    contact_messages: [{
      id: MESSAGE_ID, created_at: '2026-11-22T08:00:00.000Z', updated_at: '2026-11-22T08:00:00.000Z',
      name: 'Asha', email: 'asha@example.com', reason: 'general_query', subject: 'Syllabus question',
      message: 'How do I start the notebook?', details: null, links: [],
      attachments: [{ name: 'shot.png', size: 12, type: 'image/png', path: `${MESSAGE_ID}/shot.png` }],
      status: 'new', read_at: null, user_id: null
    }],
    analytics_error_groups: [{ fingerprint: 'abc123', status: 'open', note: '', last_seen: '2026-11-22T00:00:00.000Z' }],
    analytics_alert_events: [{ id: ALERT_ID, status: 'open', rule_id: 'error-spike' }],
    analytics_owner_config: [],
    site_settings: [{
      id: 1, maintenance_enabled: false, maintenance_message: '', site_down: false,
      signup_enabled: false, signin_enabled: false, updated_at: '2026-11-20T00:00:00.000Z'
    }]
  }
}

function admin(): SupabaseClient {
  return createClient('https://project.supabase.co', 'service-test-key')
}

function fakeReq(token: string, body: unknown, url = '/api/mcp'): ApiRequest {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` }, body, url } as ApiRequest
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
  expect(Array.isArray(preview.payload.structuredContent.effects)).toBe(true)
  return { preview, confirmed: await callTool(token, name, { ...args, confirmationToken: preview.payload.structuredContent.confirmationToken as string }, options) }
}

beforeEach(() => seed())
afterEach(() => { vi.restoreAllMocks() })

describe('Master MCP media, messages, analytics and operational settings', () => {
  it('lists, searches and protects referenced media, and only deletes unused files after confirmation', async () => {
    const { issued, options } = await runtime()
    const listed = await callTool(issued.token, 'list_site_media', { q: 'spare', usage: 'unused' }, options)
    expect(listed.payload.isError).toBeFalsy()
    expect(listed.payload.structuredContent).toMatchObject({ total: 1 })
    const assets = listed.payload.structuredContent.assets as Array<{ path: string; used: boolean }>
    expect(assets).toEqual([expect.objectContaining({ path: UNUSED, used: false })])

    const used = await callTool(issued.token, 'get_media_usage', { path: USED }, options)
    expect(used.payload.structuredContent).toMatchObject({ used: true, usedInDraft: true, usedLive: true, usedInVersions: true })

    const blocked = await callTool(issued.token, 'delete_site_media', { path: USED }, options)
    expect(blocked.payload.isError).toBe(true)
    expect(blocked.payload.structuredContent.message).toMatch(/used in/i)
    expect(world.db.site_media).toHaveLength(2)

    const executable = await callTool(issued.token, 'upload_site_media', { mime: 'application/javascript', bytes: 20, name: 'evil' }, options)
    expect(executable.payload.isError).toBe(true)

    const uploaded = await callTool(issued.token, 'upload_site_media', {
      mime: 'image/png',
      name: 'Tiny',
      contentBase64: Buffer.from('tiny-png').toString('base64')
    }, options)
    expect(uploaded.payload.isError).toBeFalsy()
    expect(uploaded.payload.structuredContent).toMatchObject({ ok: true, upload: 'inline' })
    expect(String(uploaded.payload.structuredContent.publicUrl)).toMatch(/^https:\/\/media\.example\//)
    expect(JSON.stringify(uploaded.payload.structuredContent)).not.toMatch(/service-test-key|signed-upload-token/)
    expect(world.db.site_media!.at(-1)).toMatchObject({ created_by: null, mime: 'image/png' })

    const renamed = await callTool(issued.token, 'update_site_media', { path: UNUSED, alt: 'Spare image' }, options)
    expect(renamed.payload.structuredContent).toMatchObject({ ok: true, fields: ['alt'] })

    const deleted = await confirm(issued.token, 'delete_site_media', { path: UNUSED }, options)
    expect(deleted.preview.payload.structuredContent.relatedRecords).toMatchObject({ references: 0 })
    expect(deleted.confirmed.payload.structuredContent).toMatchObject({ ok: true, deleted: true, path: UNUSED })
    expect(world.removed).toContain(`${MEDIA_BUCKET}:${UNUSED}`)
    expect(world.db.site_media!.some(row => row.path === UNUSED)).toBe(false)
  })

  it('searches contact messages, uses short-lived signed file URLs, and deletes only after confirmation', async () => {
    const { issued, options } = await runtime()
    const listed = await callTool(issued.token, 'list_contact_messages', { q: 'Syllabus', status: 'active' }, options)
    expect(listed.payload.structuredContent).toMatchObject({ total: 1, unread: 1, emailSending: false })
    expect(String(listed.payload.structuredContent.emailSendingNote)).toMatch(/does not send email/i)

    const opened = await callTool(issued.token, 'get_contact_message', { id: MESSAGE_ID }, options)
    const message = opened.payload.structuredContent.message as { files: Array<{ viewUrl: string }>; linkExpiresInSeconds: number }
    expect(message.linkExpiresInSeconds).toBe(300)
    expect(message.files[0]?.viewUrl).toContain('https://signed.example/')
    expect(JSON.stringify(opened.payload.structuredContent)).not.toMatch(/service-test-key|permanent/)

    const archived = await callTool(issued.token, 'archive_contact_message', { id: MESSAGE_ID }, options)
    expect(archived.payload.structuredContent).toMatchObject({ ok: true, status: 'archived' })

    const read = await callTool(issued.token, 'update_contact_message_status', { id: MESSAGE_ID, status: 'read' }, options)
    expect(read.payload.structuredContent).toMatchObject({ ok: true, status: 'read' })

    const deleted = await confirm(issued.token, 'delete_contact_message', { id: MESSAGE_ID }, options)
    expect(deleted.preview.payload.structuredContent.relatedRecords).toMatchObject({ attachments: 1 })
    expect(deleted.confirmed.payload.structuredContent).toMatchObject({ ok: true, deleted: true })
    expect(world.db.contact_messages).toEqual([])
    expect(world.removed.some(item => item.startsWith(`${CONTACT_BUCKET}:`))).toBe(true)
  })

  it('reports analytics in Asia/Kolkata, labels missing data, and never rewrites audit history', async () => {
    expect(resolveReportingTimeZone(undefined)).toBe('Asia/Kolkata')
    expect(resolveReportingTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(['Asia/Calcutta', 'Asia/Kolkata']).toContain(resolveReportingTimeZone('Asia/Calcutta'))
    expect(() => resolveReportingTimeZone('Not/AZone')).toThrow(/Asia\/Kolkata/)

    const { issued, options } = await runtime()
    const overview = await callTool(issued.token, 'get_analytics_overview', { timeZone: 'Asia/Kolkata', preset: '7d' }, options)
    expect(overview.payload.isError).toBeFalsy()
    const period = overview.payload.structuredContent.period as { timeZone: string }
    expect(period.timeZone).toBe('Asia/Kolkata')
    expect(overview.payload.structuredContent.availability).toBeTruthy()

    const report = await callTool(issued.token, 'get_analytics_report', { report: 'student', tz: 'Asia/Calcutta' }, options)
    expect(report.payload.isError).toBeFalsy()
    expect((report.payload.structuredContent.period as { timeZone: string }).timeZone).toMatch(/Asia\/(Kolkata|Calcutta)/)

    const exported = await callTool(issued.token, 'export_analytics_report', { report: 'overview', timeZone: 'Asia/Kolkata' }, options)
    expect(exported.payload.structuredContent).toMatchObject({ ok: true, report: 'overview', timeZone: 'Asia/Kolkata' })
    expect(String(exported.payload.structuredContent.filename)).toMatch(/stracker-analytics-overview-.*\.csv/)

    const group = await callTool(issued.token, 'update_error_group', { fingerprint: 'abc123', status: 'resolved', note: 'Acknowledged from Master MCP' }, options)
    expect(group.payload.structuredContent).toMatchObject({ ok: true, status: 'resolved' })
    expect(world.db.analytics_error_groups![0]).toMatchObject({ status: 'resolved', updated_by: null })

    const alert = await callTool(issued.token, 'update_analytics_alert', { id: ALERT_ID, status: 'acknowledged' }, options)
    expect(alert.payload.structuredContent).toMatchObject({ ok: true, status: 'acknowledged' })

    const config = await callTool(issued.token, 'update_analytics_configuration', { key: 'overview.widgets', value: ['kpi_visitors', 'kpi_sessions'] }, options)
    expect(config.payload.structuredContent).toMatchObject({ ok: true, key: 'overview.widgets' })
    expect(world.writes.every(write => write.table !== 'control_audit_events' && write.table !== 'master_mcp_audit_events' && write.mode !== 'delete' || write.table === 'contact_messages' || write.table === 'site_media')).toBe(true)
    expect(world.writes.filter(write => write.table.startsWith('analytics_')).every(write => write.mode !== 'delete')).toBe(true)
  })

  it('exposes only maintenance settings, previews site-down impact, and never returns sign-up or sign-in switches', async () => {
    const { issued, options } = await runtime()
    const settings = await callTool(issued.token, 'get_operational_settings', {}, options)
    const site = settings.payload.structuredContent.site as Record<string, unknown>
    expect(site).toMatchObject({ status: 'live', siteDown: false })
    expect(site).not.toHaveProperty('signupEnabled')
    expect(site).not.toHaveProperty('signinEnabled')
    expect(site).not.toHaveProperty('signup_enabled')
    expect(site).not.toHaveProperty('signin_enabled')

    const forbidden = await callTool(issued.token, 'update_operational_settings', { signupEnabled: true } as Record<string, unknown>, options)
    expect(forbidden.payload.isError).toBe(true)
    expect(forbidden.payload.structuredContent.message).toMatch(/owner-controlled|Sign-up/i)
    expect(world.db.site_settings![0]).toMatchObject({ signup_enabled: false, site_down: false })

    const notice = await callTool(issued.token, 'update_operational_settings', { maintenanceEnabled: true, maintenanceMessage: 'Back at 6 PM IST' }, options)
    expect(notice.payload.structuredContent).toMatchObject({ ok: true, site: { maintenanceEnabled: true, status: 'notice' } })

    const down = await confirm(issued.token, 'set_maintenance_mode', { siteDown: true, maintenanceMessage: 'Back at 6 PM IST' }, options)
    expect(down.preview.payload.structuredContent.effects as string[]).toEqual(expect.arrayContaining([
      expect.stringMatching(/hidden from every student/i)
    ]))
    expect(JSON.stringify(down.preview.payload.structuredContent.effects)).toMatch(/does not change sign-up or sign-in/i)
    expect(down.confirmed.payload.structuredContent).toMatchObject({ ok: true, site: { siteDown: true, status: 'down' } })
    expect(world.db.site_settings![0]).toMatchObject({ site_down: true, signup_enabled: false, signin_enabled: false, updated_by: null })

    const status = await callTool(issued.token, 'get_operational_status', {}, options)
    expect(status.payload.structuredContent).toMatchObject({ status: 'down', siteDown: true })
    expect(JSON.stringify(status.payload.structuredContent)).not.toMatch(/signupEnabled|signinEnabled/)
  })
})

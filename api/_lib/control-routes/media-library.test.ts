import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const A = 'site/image/0f8fad5b-d9cb-469f-a165-70867728950e.webp'
const B = 'site/image/1f8fad5b-d9cb-469f-a165-70867728950e.png'
const GHOST = 'site/video/2f8fad5b-d9cb-469f-a165-70867728950e.mp4'

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  stored: [] as string[],
  draft: '' as string, published: '' as string, versions: '' as string,
  removed: [] as string[], updates: [] as Array<Record<string, unknown>>, deletes: [] as string[], audits: [] as Array<Record<string, unknown>>
}))

const URL_BASE = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/'

vi.mock('../control.js', () => ({
  recordAuditEvent: async (_admin: unknown, event: Record<string, unknown>) => { state.audits.push(event); return true },
  controlHandler: async (req: { method: string }, res: { statusCode?: number; body?: unknown }, methods: string[], options: { requireAal2?: boolean; permission?: string }, run: (context: unknown) => Promise<void>) => {
    expect(methods).toContain(req.method)
    expect(options).toMatchObject({ requireAal2: true, permission: 'appearance.edit' })
    const table = (name: string) => {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (name === 'site_media') return { data: state.rows, error: null }
        const text = name === 'site_content_draft' ? state.draft : name === 'site_content_published' ? state.published : state.versions
        return { data: text ? [{ content: { x: text }, document: null }] : [], error: null }
      }
      Object.assign(chain, {
        select: () => chain, order: () => chain, limit: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => void) => resolve(result()),
        update: (patch: Record<string, unknown>) => ({ eq: (_c: string, path: string) => ({ select: async () => { state.updates.push({ path, ...patch }); return { data: state.rows.some(row => row.path === path) ? [{ path }] : [], error: null } } }) }),
        delete: () => ({ eq: async (_c: string, path: string) => { state.deletes.push(path); return { error: null } } })
      })
      return chain
    }
    const context = {
      userId: 'owner-1', role: 'owner', requestId: 'req-1',
      admin: {
        from: table,
        storage: { from: () => ({
          list: async (folder: string) => ({ data: state.stored.filter(path => path.startsWith(`${folder}/`)).map(path => ({ name: path.slice(folder.length + 1) })), error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: URL_BASE + path } }),
          remove: async (paths: string[]) => { state.removed.push(...paths); return { error: null } }
        }) }
      }
    }
    try { await run(context) } catch (error) {
      if (error instanceof ApiError) { res.statusCode = error.status; res.body = { error: error.code, message: error.message } } else throw error
    }
  }
}))

import { mediaUploadHandler } from './media.js'

function call(method: string, body?: Record<string, unknown>) {
  const res: { statusCode?: number; body?: unknown; setHeader: () => void; end: (text: string) => void } = {
    setHeader: () => undefined,
    end(text: string) { this.body = JSON.parse(text) }
  }
  return mediaUploadHandler({ method, body: body ?? {}, url: '/api/control/operations?route=media' } as never, res as never).then(() => res)
}

beforeEach(() => {
  const row = (path: string, kind: string, mime: string) => ({ path, kind, mime, bytes: 1000, created_at: '2026-11-16T10:00:00Z', name: '', alt: '' })
  state.rows = [row(A, 'image', 'image/webp'), row(B, 'image', 'image/png'), row(GHOST, 'video', 'video/mp4')]
  state.stored = [A, B]
  state.draft = ''; state.published = URL_BASE + A; state.versions = ''
  state.removed = []; state.updates = []; state.deletes = []; state.audits = []
})

describe('media library API', () => {
  it('lists only files that exist, with where each is used', async () => {
    const res = await call('GET')
    const assets = (res.body as { assets: Array<{ path: string; usedLive: boolean; url: string }> }).assets
    expect(assets.map(asset => asset.path)).toEqual([A, B])
    expect(assets[0]).toMatchObject({ usedLive: true, url: URL_BASE + A })
    expect(assets[1]).toMatchObject({ usedLive: false })
  })

  it('updates name and alt as plain text only', async () => {
    expect((await call('PATCH', { path: B, alt: 'A student’s planner', name: 'Planner' })).statusCode).toBe(200)
    expect(state.updates[0]).toMatchObject({ path: B, alt: 'A student’s planner', name: 'Planner' })
    expect(state.audits[0]).toMatchObject({ action: 'appearance.media_update', targetId: B })
    expect((await call('PATCH', { path: B, alt: '<img onerror=x>' })).statusCode).toBe(400)
    expect((await call('PATCH', { path: '../../etc', alt: 'x' })).statusCode).toBe(400)
    expect((await call('PATCH', { path: B, alt: 'x', extra: 1 })).statusCode).toBe(400)
  })

  it('refuses to delete a file used live, in the draft or in a saved version', async () => {
    const live = await call('DELETE', { path: A })
    expect(live.statusCode).toBe(409)
    state.published = ''; state.versions = JSON.stringify({ old: URL_BASE + A })
    expect((await call('DELETE', { path: A })).statusCode).toBe(409)
    state.versions = ''; state.draft = URL_BASE + A
    expect((await call('DELETE', { path: A })).statusCode).toBe(409)
    expect(state.removed).toEqual([])
  })

  it('deletes an unused file from storage and the library, with an audit entry', async () => {
    const res = await call('DELETE', { path: B })
    expect(res.statusCode).toBe(200)
    expect(state.removed).toEqual([B])
    expect(state.deletes).toEqual([B])
    expect(state.audits.at(-1)).toMatchObject({ action: 'appearance.media_delete', targetId: B })
  })
})

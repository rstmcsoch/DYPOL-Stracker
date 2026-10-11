import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const state = vi.hoisted(() => ({
  signed: { data: { token: 'tok', signedUrl: 'https://x' } as unknown, error: null as unknown },
  insertError: null as unknown,
  inserts: [] as Array<Record<string, unknown>>,
  signedPaths: [] as string[]
}))

vi.mock('../control.js', () => ({
  controlHandler: async (_req: unknown, res: { statusCode?: number; body?: unknown }, _methods: string[], _options: unknown, run: (context: unknown) => Promise<void>) => {
    const context = {
      userId: 'owner-1',
      admin: {
        storage: {
          from: () => ({
            createSignedUploadUrl: async (path: string) => { state.signedPaths.push(path); return state.signed },
            getPublicUrl: (path: string) => ({ data: { publicUrl: `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/${path}` } })
          })
        },
        from: () => ({ insert: async (row: Record<string, unknown>) => { state.inserts.push(row); return { error: state.insertError } } })
      }
    }
    try {
      await run(context)
    } catch (error) {
      if (error instanceof ApiError) { res.statusCode = error.status; res.body = { error: error.code } } else throw error
    }
  }
}))

import { mediaUploadHandler } from './media.js'
import { isUploadedMediaUrl } from '../../../src/lib/site-content/media.js'

function call(body: Record<string, unknown>) {
  const res: { statusCode?: number; body?: unknown; headersSent?: boolean; setHeader: () => void; end: (text: string) => void } = {
    setHeader: () => undefined,
    end(text: string) { this.body = JSON.parse(text) }
  }
  return mediaUploadHandler({ body } as never, res as never).then(() => res)
}

beforeEach(() => {
  state.signed = { data: { token: 'tok', signedUrl: 'https://x' }, error: null }
  state.insertError = null
  state.inserts = []
  state.signedPaths = []
})

describe('owner media upload URLs', () => {
  it('mints a fresh path, records it and returns a URL the content rules accept', async () => {
    const res = await call({ kind: 'video', mime: 'video/mp4', bytes: 2_000_000 })
    expect(res.statusCode).toBe(200)
    const body = res.body as { path: string; token: string; publicUrl: string }
    expect(body.path).toMatch(/^site\/video\/[0-9a-f-]{36}\.mp4$/)
    expect(state.inserts[0]).toMatchObject({ path: body.path, kind: 'video', mime: 'video/mp4', created_by: 'owner-1' })
    expect(isUploadedMediaUrl('video', body.publicUrl)).toBe(true)
  })

  it('rejects wrong types, oversize files and unknown fields without minting', async () => {
    expect((await call({ kind: 'video', mime: 'image/png', bytes: 10 })).statusCode).toBe(415)
    expect((await call({ kind: 'image', mime: 'image/png', bytes: 6 * 1_048_576 })).statusCode).toBe(413)
    expect((await call({ kind: 'image', mime: 'image/png', bytes: 10, path: '../x' })).statusCode).toBe(400)
    expect(state.signedPaths).toEqual([])
  })

  it('answers 503 when storage is not provisioned yet', async () => {
    state.signed = { data: null, error: new Error('Bucket not found') }
    expect((await call({ kind: 'image', mime: 'image/webp', bytes: 10 })).statusCode).toBe(503)
    expect(state.inserts).toEqual([])
  })
})

describe('uploaded media URL rule', () => {
  it('accepts only our bucket paths', () => {
    const ok = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/homepage-media/site/image/0f8fad5b-d9cb-469f-a165-70867728950e.webp'
    expect(isUploadedMediaUrl('image', ok)).toBe(true)
    expect(isUploadedMediaUrl('video', ok)).toBe(false)
    expect(isUploadedMediaUrl('image', ok.replace('homepage-media', 'mistake-images'))).toBe(false)
    expect(isUploadedMediaUrl('image', 'https://evil.example/x.webp')).toBe(false)
  })
})

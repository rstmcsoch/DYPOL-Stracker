// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } }
}))

import { controlFetch, ControlApiError } from './api'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('controlFetch', () => {
  it('gives up on a hung request instead of leaving the caller pending forever', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })))
    const promise = controlFetch('exams')
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(25_000)
    await assertion
    await expect(promise).rejects.toBeInstanceOf(ControlApiError)
  })
})

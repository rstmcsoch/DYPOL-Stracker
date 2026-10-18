import { describe, expect, it, vi } from 'vitest'
import { takeRateSlot, type RateBucket } from './rate-limit'

const bucket: RateBucket = { bucket: 'connection_test', limit: 2, windowSeconds: 60 }

function admin(rpcResult: { data: unknown; error: { message: string; code?: string } | null }, auditCount = 0) {
  const insert = vi.fn(async () => ({ error: null }))
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    then: undefined as unknown,
    insert
  }
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            gte: async () => ({ count: auditCount, error: null })
          })
        })
      })
    }),
    insert
  }))
  return {
    client: { rpc: vi.fn(async () => rpcResult), from } as never,
    insert,
    from
  }
}

describe('AI rate slots', () => {
  it('allows a request when the database slot function accepts it', async () => {
    const { client, from } = admin({ data: true, error: null })
    await expect(takeRateSlot(client, 'user-1', bucket)).resolves.toBeUndefined()
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects when the database slot function reports the limit', async () => {
    const { client } = admin({ data: false, error: null })
    await expect(takeRateSlot(client, 'user-1', bucket)).rejects.toMatchObject({ status: 429, code: 'request_limit' })
  })

  it('falls back to audit rows when the slot function is not migrated yet', async () => {
    const { client, insert } = admin({ data: null, error: { message: 'Could not find the function public.ai_take_rate_slot', code: 'PGRST202' } }, 0)
    await expect(takeRateSlot(client, 'user-1', bucket)).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalled()
  })

  it('falls back closed when recent audit rows already reach the limit', async () => {
    const { client, insert } = admin({ data: null, error: { message: 'ai_take_rate_slot missing', code: 'PGRST202' } }, 2)
    await expect(takeRateSlot(client, 'user-1', bucket)).rejects.toMatchObject({ status: 429, code: 'request_limit' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('fails closed when the slot function errors for another reason', async () => {
    const { client } = admin({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(takeRateSlot(client, 'user-1', bucket)).rejects.toMatchObject({ status: 503, code: 'rate_limit_unavailable' })
  })
})

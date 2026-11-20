// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TURNSTILE_BREAK_MS,
  TURNSTILE_CLEARANCE_ENDPOINT,
  TURNSTILE_CLEARANCE_HEADER,
  clearLocalTurnstileClearance,
  grantTurnstileClearance,
  isTurnstileClearedLocally,
  subscribeTurnstileClearance,
  turnstileBreakRemainingMs,
  verifyTurnstileClearance
} from './turnstile-clearance'

describe('Turnstile 15-minute break client manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T05:00:00.000Z'))
    clearLocalTurnstileClearance()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    clearLocalTurnstileClearance()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stores clearance strictly in JS memory (never localStorage or sessionStorage) and expires after 15 minutes', async () => {
    const nonce = 'a'.repeat(64)
    const now = Date.now()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      cleared: true,
      nonce,
      issuedAt: now,
      expiresAt: now + TURNSTILE_BREAK_MS,
      remainingMs: TURNSTILE_BREAK_MS
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const events: boolean[] = []
    const unsub = subscribeTurnstileClearance(value => events.push(value))

    expect(isTurnstileClearedLocally()).toBe(false)
    expect(await grantTurnstileClearance('login')).toBe(true)
    expect(isTurnstileClearedLocally()).toBe(true)
    expect(turnstileBreakRemainingMs()).toBe(TURNSTILE_BREAK_MS)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)

    // Calling grant again inside the 15-minute window does NOT re-call the server or extend expiry.
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(await grantTurnstileClearance('passkey')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(turnstileBreakRemainingMs()).toBe(10 * 60 * 1000)

    // After the remaining 10 minutes (total 15 minutes), clearance automatically expires.
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(isTurnstileClearedLocally()).toBe(false)
    expect(turnstileBreakRemainingMs()).toBe(0)
    expect(events).toEqual([true, false])
    unsub()
  })

  it('immediately drops clearance if the server reports cookies/cache were deleted', async () => {
    const nonce = 'b'.repeat(64)
    const now = Date.now()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        cleared: true,
        nonce,
        issuedAt: now,
        expiresAt: now + TURNSTILE_BREAK_MS
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        cleared: false,
        reason: 'cookie_missing'
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await grantTurnstileClearance('login')
    expect(isTurnstileClearedLocally()).toBe(true)

    const stillCleared = await verifyTurnstileClearance()
    expect(stillCleared).toBe(false)
    expect(isTurnstileClearedLocally()).toBe(false)
    expect(fetchMock).toHaveBeenLastCalledWith(
      TURNSTILE_CLEARANCE_ENDPOINT,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: expect.objectContaining({ [TURNSTILE_CLEARANCE_HEADER]: nonce })
      })
    )
  })
})

// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TURNSTILE_BREAK_MS,
  TURNSTILE_CLEARANCE_ENDPOINT,
  TURNSTILE_CLEARANCE_HEADER,
  clearLocalTurnstileClearance,
  grantTurnstileClearance,
  isTurnstileClearedLocally,
  planTurnstileTokenRequest,
  resolveTurnstileToken,
  shouldPrewarmSilentTurnstile,
  subscribeTurnstileClearance,
  turnstileBreakRemainingMs,
  verifyTurnstileClearance
} from './turnstile-clearance'

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

describe('Turnstile 15-minute break client manager', () => {
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

describe('Turnstile skip-within-grace (passkey click path)', () => {
  async function grantBreak(nonce = 'c'.repeat(64)) {
    const now = Date.now()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      cleared: true,
      nonce,
      issuedAt: now,
      expiresAt: now + TURNSTILE_BREAK_MS
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await grantTurnstileClearance('passkey')).toBe(true)
    return fetchMock
  }

  it('returns a pre-warmed token immediately during the 15-minute break without execute or clearance fetch', async () => {
    const fetchMock = await grantBreak()

    const verifyClearance = vi.fn(async () => true)
    const execute = vi.fn()
    const reset = vi.fn()
    const onClearanceLost = vi.fn()

    expect(planTurnstileTokenRequest({
      mode: 'cleared',
      locallyCleared: true,
      token: 'prewarmed-token'
    })).toEqual({ action: 'return', token: 'prewarmed-token' })
    expect(shouldPrewarmSilentTurnstile('cleared')).toBe(true)
    expect(shouldPrewarmSilentTurnstile('visible')).toBe(false)

    const result = await resolveTurnstileToken({
      mode: 'cleared',
      token: 'prewarmed-token',
      failed: false,
      executeStarted: false,
      verifyClearance,
      execute,
      reset,
      onClearanceLost
    })

    expect(result).toEqual({ token: 'prewarmed-token', wait: false })
    expect(verifyClearance).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    expect(onClearanceLost).not.toHaveBeenCalled()
    // No extra clearance GET on the click path — only the grant() above.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-checks the server clearance and silently executes only when the break is active but no token is ready yet', async () => {
    await grantBreak('d'.repeat(64))

    const verifyClearance = vi.fn(async () => true)
    const execute = vi.fn()
    const result = await resolveTurnstileToken({
      mode: 'cleared',
      token: null,
      failed: false,
      executeStarted: false,
      verifyClearance,
      execute,
      reset: vi.fn(),
      onClearanceLost: vi.fn()
    })
    expect(result).toEqual({ wait: true })
    expect(verifyClearance).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not start a second silent execute when one is already in flight', async () => {
    await grantBreak('e'.repeat(64))

    const execute = vi.fn()
    const result = await resolveTurnstileToken({
      mode: 'cleared',
      token: null,
      failed: false,
      executeStarted: true,
      verifyClearance: vi.fn(async () => true),
      execute,
      reset: vi.fn(),
      onClearanceLost: vi.fn()
    })
    expect(result).toEqual({ wait: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reopens the visible widget when the server says the 15-minute break has ended', async () => {
    const onClearanceLost = vi.fn()
    const execute = vi.fn()
    const result = await resolveTurnstileToken({
      mode: 'cleared',
      token: null,
      failed: false,
      executeStarted: false,
      verifyClearance: vi.fn(async () => false),
      execute,
      reset: vi.fn(),
      onClearanceLost
    })
    expect(result).toEqual({ wait: true })
    expect(onClearanceLost).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves the visible sign-in / sign-up / reset path unchanged', async () => {
    expect(planTurnstileTokenRequest({
      mode: 'visible',
      locallyCleared: false,
      token: 'visible-token'
    })).toEqual({ action: 'return', token: 'visible-token' })
    expect(planTurnstileTokenRequest({
      mode: 'visible',
      locallyCleared: false,
      token: null
    })).toEqual({ action: 'challenge' })

    const verifyClearance = vi.fn(async () => true)
    const execute = vi.fn()
    const reset = vi.fn()
    const ready = await resolveTurnstileToken({
      mode: 'visible',
      token: 'visible-token',
      failed: false,
      executeStarted: false,
      verifyClearance,
      execute,
      reset,
      onClearanceLost: vi.fn()
    })
    expect(ready).toEqual({ token: 'visible-token', wait: false })
    expect(verifyClearance).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()

    const pending = await resolveTurnstileToken({
      mode: 'visible',
      token: null,
      failed: true,
      executeStarted: false,
      verifyClearance,
      execute,
      reset,
      onClearanceLost: vi.fn()
    })
    expect(pending).toEqual({ wait: true })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(verifyClearance).not.toHaveBeenCalled()
  })
})

describe('Turnstile widget uses the grace-window fast path', () => {
  it('pre-warms a silent token in cleared mode and resolves clicks through resolveTurnstileToken', () => {
    const source = readFileSync('src/components/TurnstileWidget.tsx', 'utf8')
    expect(source).toContain('resolveTurnstileToken')
    expect(source).toContain('shouldPrewarmSilentTurnstile')
    expect(source).toContain('current.executeStarted = true')
    expect(source).toContain('api.execute(current.id)')
  })
})

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  controlFetch: vi.fn()
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      onAuthStateChange: mocks.onAuthStateChange
    }
  }
}))

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    controlFetch: mocks.controlFetch
  }
})

import { ControlApiError } from './api'
import { CONTROL_SESSION_MAX_AGE_MS, ControlSessionProvider, useControlSession, type ControlPhase } from './ControlSession'

let latestPhase: ControlPhase | null = null

function PhaseProbe() {
  const { phase } = useControlSession()
  latestPhase = phase
  return <div data-phase={phase.kind}>{phase.kind === 'signed_out' ? phase.notice ?? '' : ''}</div>
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve()
  }
}

describe('ControlSessionProvider 6-hour absolute session limit', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    latestPhase = null
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    mocks.signOut.mockReset().mockResolvedValue({ error: null })
    mocks.onAuthStateChange.mockReset().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } }
    })
    mocks.controlFetch.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  it('automatically logs out after 6 hours even with continuous user activity', async () => {
    const startSec = Math.floor(Date.now() / 1000)
    const maxSec = CONTROL_SESSION_MAX_AGE_MS / 1000
    mocks.controlFetch.mockResolvedValue({
      status: 'granted',
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'administrator',
      permissions: [],
      aal: 'aal2',
      method: 'totp',
      passkey: false,
      recentMfa: true,
      idleTimeoutSeconds: 1200,
      sessionStartedAt: startSec,
      sessionExpiresAt: startSec + maxSec,
      maxSessionSeconds: maxSec
    })

    await act(async () => {
      root.render(
        <ControlSessionProvider>
          <PhaseProbe />
        </ControlSessionProvider>
      )
      await flushMicrotasks()
    })

    expect(latestPhase?.kind).toBe('granted')

    // Keep resetting the 20-minute idle timer every 10 minutes up to 5h 50m.
    for (let step = 0; step < 35; step += 1) {
      await act(async () => {
        window.dispatchEvent(new Event('pointerdown'))
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      })
    }

    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(latestPhase?.kind).toBe('granted')

    // Crossing the 6-hour mark forces logout regardless of recent activity.
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'))
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await flushMicrotasks()
    })

    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(latestPhase).toEqual({
      kind: 'signed_out',
      notice: 'Your 6-hour Control Centre session has ended. Sign in again to continue.'
    })
  })

  it('clears the local session and shows notice when /api/control/session returns 401 session_expired', async () => {
    mocks.controlFetch.mockRejectedValue(
      new ControlApiError(401, 'session_expired', 'Your 6-hour Control Centre session has ended. Sign in again to continue.')
    )

    await act(async () => {
      root.render(
        <ControlSessionProvider>
          <PhaseProbe />
        </ControlSessionProvider>
      )
      await flushMicrotasks()
    })

    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(latestPhase).toEqual({
      kind: 'signed_out',
      notice: 'Your 6-hour Control Centre session has ended. Sign in again to continue.'
    })
  })
})

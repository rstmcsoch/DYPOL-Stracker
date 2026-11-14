// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const auth = vi.hoisted(() => ({
  signInError: null as null | { message: string; code?: string },
  rpcResult: null as unknown,
  rpcError: null as unknown,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ error: auth.signInError })
    },
    rpc: async (name: string, args: Record<string, unknown>) => { auth.rpcCalls.push({ name, args }); return { data: auth.rpcResult, error: auth.rpcError } }
  },
  supabaseConfigured: true,
  localPreviewEnabled: false
}))
vi.mock('../lib/telemetry/client', () => ({ track: vi.fn(), loginFailureReason: () => 'other' }))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { signIn, error, suspension } = useAuth()
  return <>
    <button onClick={() => { void signIn('Banned@Example.com ', 'secret-pass').catch(() => undefined) }}>go</button>
    <output>{suspension ? `BANNED|${suspension.permanent ? 'permanent' : suspension.until}|${suspension.reason}` : error ?? 'none'}</output>
  </>
}

async function attempt() {
  render(<AuthProvider><Probe /></AuthProvider>)
  fireEvent.click(screen.getByText('go'))
  return screen.findByText(text => text !== 'none' && text.length > 0, { selector: 'output' })
}

beforeEach(() => {
  auth.signInError = { message: 'User is banned', code: 'user_banned' }
  auth.rpcResult = null
  auth.rpcError = null
  auth.rpcCalls = []
})
afterEach(() => cleanup())

describe('sign-in refusal for a banned account', () => {
  it('shows the end time (IST) and reason once the database proves the password', async () => {
    auth.rpcResult = { kind: 'ban', reason: 'Repeated spam', until: '2026-11-20T10:30:00Z', permanent: false }
    const out = await attempt()
    expect(out.textContent).toBe('BANNED|2026-11-20T10:30:00Z|Repeated spam')
    expect(auth.rpcCalls).toEqual([{ name: 'account_ban_notice_for_credentials', args: { email: 'Banned@Example.com', password: 'secret-pass' } }])
  })

  it('says permanently for a permanent ban', async () => {
    auth.rpcResult = { kind: 'ban', reason: 'Fraud', until: null, permanent: true }
    expect((await attempt()).textContent).toBe('BANNED|permanent|Fraud')
  })

  it('reveals nothing when the password is not proven (same text as a wrong password)', async () => {
    auth.rpcResult = null
    expect((await attempt()).textContent).toBe('Email or password is incorrect. Please try again.')
  })

  it('asks to wait when the check is rate limited, and stays vague if it is unavailable', async () => {
    auth.rpcResult = { limited: true }
    expect((await attempt()).textContent).toMatch(/Too many attempts/)
    cleanup()
    auth.rpcResult = null
    auth.rpcError = { message: 'down' }
    expect((await attempt()).textContent).toBe('We could not complete that sign-in. Please try again.')
  })

  it('does not call the ban check for an ordinary wrong password', async () => {
    auth.signInError = { message: 'Invalid login credentials', code: 'invalid_credentials' }
    expect((await attempt()).textContent).toBe('Email or password is incorrect. Please try again.')
    expect(auth.rpcCalls).toEqual([])
  })
})

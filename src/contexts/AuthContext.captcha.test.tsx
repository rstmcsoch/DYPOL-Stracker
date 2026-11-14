// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const auth = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  signUpError: null as null | { message: string }
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async (...args: unknown[]) => { auth.calls.push({ method: 'signInWithPassword', args }); return { error: null } },
      signUp: async (...args: unknown[]) => { auth.calls.push({ method: 'signUp', args }); return { data: { session: null }, error: auth.signUpError } },
      resend: async (...args: unknown[]) => { auth.calls.push({ method: 'resend', args }); return { error: null } },
      resetPasswordForEmail: async (...args: unknown[]) => { auth.calls.push({ method: 'resetPasswordForEmail', args }); return { error: null } }
    },
    rpc: async () => ({ data: false, error: null })
  },
  supabaseConfigured: true,
  localPreviewEnabled: false
}))
vi.mock('../lib/telemetry/client', () => ({ track: vi.fn(), loginFailureReason: () => 'other' }))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { signIn, signUp, resendConfirmation, sendPasswordReset, error } = useAuth()
  return <>
    <button onClick={() => { void signIn('ada@example.org', 'pw-123456', 'tok-login').catch(() => undefined) }}>login</button>
    <button onClick={() => { void signUp('ada@example.org', 'pw-123456', 'Ada', 'tok-signup').catch(() => undefined) }}>signup</button>
    <button onClick={() => { void resendConfirmation('ada@example.org', 'tok-resend').catch(() => undefined) }}>resend</button>
    <button onClick={() => { void sendPasswordReset('ada@example.org', 'tok-reset').catch(() => undefined) }}>reset</button>
    <output>{error ?? 'none'}</output>
  </>
}

beforeEach(() => { auth.calls = []; auth.signUpError = null })
afterEach(() => cleanup())

async function press(name: string) {
  render(<AuthProvider><Probe /></AuthProvider>)
  fireEvent.click(screen.getByText(name))
  await vi.waitFor(() => expect(auth.calls.length).toBeGreaterThan(0))
  return auth.calls[0]!
}

describe('Turnstile tokens reach Supabase Auth', () => {
  it('password sign-in', async () => {
    const call = await press('login')
    expect(call.args[0]).toMatchObject({ email: 'ada@example.org', options: { captchaToken: 'tok-login' } })
  })
  it('sign-up', async () => {
    const call = await press('signup')
    expect(call.args[0]).toMatchObject({ options: { captchaToken: 'tok-signup', data: { display_name: 'Ada' } } })
  })
  it('resend confirmation', async () => {
    const call = await press('resend')
    expect(call.args[0]).toMatchObject({ type: 'signup', options: { captchaToken: 'tok-resend' } })
  })
  it('password reset', async () => {
    const call = await press('reset')
    expect(call.args[1]).toMatchObject({ captchaToken: 'tok-reset' })
  })
})

describe('server refusals', () => {
  it('explains the disposable-email refusal from the database', async () => {
    auth.signUpError = { message: 'disposable_email_not_allowed' }
    await press('signup')
    expect((await screen.findByText(/disposable/)).textContent).toBe('Temporary or disposable email addresses aren\'t allowed. Please use your regular email.')
  })
  it('explains a failed bot check', async () => {
    auth.signUpError = { message: 'captcha protection: request disallowed (invalid-input-response)' }
    await press('signup')
    expect((await screen.findByText(/human/)).textContent).toBe('We could not confirm you are human. Please try again.')
  })
})

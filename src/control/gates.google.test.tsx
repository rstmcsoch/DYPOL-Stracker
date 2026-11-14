// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }))
const listFactors = vi.fn(async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }], all: [] }, error: null }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithOAuth, mfa: { listFactors } } }, supabaseConfigured: true, localPreviewEnabled: false }))
vi.mock('./ControlSession', () => ({ useControlSession: () => ({ refresh: vi.fn(), signOut: vi.fn() }) }))
vi.mock('./MfaPanels', () => ({ MfaChallengeForm: () => <p>Authenticator code form</p>, MfaEnrollment: () => <p>Enrollment</p> }))

const { SignInGate, MfaGate } = await import('./gates')
const { resetGoogleAuthCache, OAUTH_NEXT_KEY } = await import('../lib/google-auth')

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ external: { google: true } }) }) as Response))
  resetGoogleAuthCache()
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Control Center with Google sign-in', () => {
  it('offers Google on the sign-in gate and returns to the console afterwards', async () => {
    render(<MemoryRouter><SignInGate /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled())
    expect(sessionStorage.getItem(OAUTH_NEXT_KEY)).toBe('/control-panel')
    // The password form is still there.
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })

  it('still requires the authenticator step after any sign-in method', async () => {
    render(<MemoryRouter><MfaGate /></MemoryRouter>)
    expect(screen.getByText('Signed in')).toBeTruthy()
    expect(await screen.findByText('Authenticator code form')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /skip|bypass/i })).toBeNull()
  })
})

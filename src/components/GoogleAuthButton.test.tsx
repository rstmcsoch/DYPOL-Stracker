// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const signInWithOAuth = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signInWithOAuth } }, supabaseConfigured: true, localPreviewEnabled: false }))

const { GoogleAuthButton } = await import('./GoogleAuthButton')
const { resetGoogleAuthCache, OAUTH_NEXT_KEY, GOOGLE_UNAVAILABLE_MESSAGE } = await import('../lib/google-auth')

let googleEnabled = true
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ external: { email: true, google: googleEnabled } }) }) as Response)

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example-ref.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
  vi.stubEnv('VITE_GOOGLE_AUTH_FORCE_VISIBLE', '')
  vi.stubGlobal('fetch', fetchMock)
  resetGoogleAuthCache()
  googleEnabled = true
  signInWithOAuth.mockReset()
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://example-ref.supabase.co/auth/v1/authorize' }, error: null })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); fetchMock.mockClear() })

const renderButton = (props: Partial<Parameters<typeof GoogleAuthButton>[0]> = {}) => render(<MemoryRouter><GoogleAuthButton intent="signin" {...props} /></MemoryRouter>)

describe('GoogleAuthButton visibility', () => {
  it('stays hidden while the Supabase Google provider is disabled', async () => {
    googleEnabled = false
    const { container } = renderButton()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('.google-button')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('appears with the "or" divider once the provider is enabled', async () => {
    renderButton()
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'or use your email' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy')
    const legal = screen.getByRole('link', { name: 'Terms' }).closest('p')
    expect(legal?.textContent).toBe('By continuing with Google, you agree to Stracker’s Terms and Privacy Policy.')
  })

  it('uses "Sign up with Google" on the registration page', async () => {
    renderButton({ intent: 'signup', dividerLabel: 'or sign up with email' })
    expect(await screen.findByRole('button', { name: 'Sign up with Google' })).toBeTruthy()
  })

  it('can be forced visible for a local design build', () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_FORCE_VISIBLE', '1')
    googleEnabled = false
    renderButton()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
  })
})

describe('GoogleAuthButton sign-in', () => {
  it('starts Supabase OAuth for Google with the PKCE callback route and remembers where to go next', async () => {
    renderButton({ next: '/planner' })
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1))
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } }
    })
    // No extra Google scopes are requested: openid, email and profile are Supabase's defaults.
    expect(JSON.stringify(signInWithOAuth.mock.calls[0])).not.toContain('scopes')
    expect(sessionStorage.getItem(OAUTH_NEXT_KEY)).toBe('/planner')
    expect(await screen.findByRole('button', { name: 'Opening Google…' })).toBeTruthy()
  })

  it('re-checks the provider before leaving and shows the friendly message when it was turned off', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH_FORCE_VISIBLE', '1')
    googleEnabled = false
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect((await screen.findByRole('alert')).textContent).toBe(GOOGLE_UNAVAILABLE_MESSAGE)
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Continue with Google' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows a friendly error when Supabase refuses to start the flow', async () => {
    signInWithOAuth.mockResolvedValue({ data: null, error: { message: 'Unsupported provider: provider is not enabled' } })
    renderButton()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect((await screen.findByRole('alert')).textContent).toBe(GOOGLE_UNAVAILABLE_MESSAGE)
  })
})

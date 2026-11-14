// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  suspension: null as unknown,
  error: null as string | null,
  deviceNotice: null as unknown,
  discarded: [] as unknown[]
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    signIn: async () => { throw new Error('refused') }, startLocalPreview: () => undefined,
    error: auth.error, clearError: () => undefined, loading: false,
    suspension: auth.suspension, clearSuspension: () => undefined
  })
}))
vi.mock('../components/site/SiteStatusContext', () => ({ useSiteStatus: () => ({ status: { signinEnabled: true, signupEnabled: true } }) }))
vi.mock('../components/GoogleAuthButton', () => ({ GoogleAuthButton: () => <button type="button">Continue with Google</button> }))
vi.mock('../components/public/AuthScaffold', () => ({ AuthScaffold: ({ children }: { children: unknown }) => <main>{children as never}</main> }))
vi.mock('../lib/supabase', () => ({ supabase: null, supabaseConfigured: true, localPreviewEnabled: false }))
vi.mock('../lib/head', () => ({ usePageMeta: () => undefined }))
vi.mock('../lib/account-notices-client', () => ({
  banNoticeForDevice: async () => auth.deviceNotice,
  discardLocalAccountData: async (id: unknown) => { auth.discarded.push(id) }
}))

const { default: LoginPage } = await import('./LoginPage')
const BAN = { kind: 'ban', reason: 'Repeated spam', until: '2026-11-20T10:30:00Z', permanent: false }

function renderLogin(state?: unknown) {
  return render(<MemoryRouter initialEntries={[{ pathname: '/login', state }]}><Routes><Route path="/login" element={<LoginPage />} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  auth.suspension = null; auth.error = null; auth.deviceNotice = null; auth.discarded = []
  localStorage.clear()
})
afterEach(() => cleanup())

describe('sign-in page for a banned account', () => {
  it('password proven: popup with reason and IST end, and the block directly below the password field after closing it', async () => {
    auth.suspension = BAN
    renderLogin()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Account banned')
    expect(dialog.textContent).toContain('until 20 Nov 2026, 4:00 pm IST')
    expect(dialog.textContent).toContain('Repeated spam')
    fireEvent.click(screen.getByText('OK'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const block = screen.getByRole('alert')
    expect(block.className).toContain('auth-banned-block')
    expect(block.textContent).toContain('Account banned')
    expect(block.textContent).toContain('Banned until 20 Nov 2026, 4:00 pm IST.')
    expect(block.textContent).toContain('Reason: Repeated spam')
    // Directly below the password field.
    const passwordField = screen.getByLabelText('Password').closest('label')
    expect(passwordField?.nextElementSibling).toBe(block)
  })

  it('permanent bans say so', async () => {
    auth.suspension = { ...BAN, permanent: true, until: null }
    renderLogin()
    expect((await screen.findByRole('dialog')).textContent).toContain('banned permanently')
  })

  it('wrong password: only the ordinary error, no ban details', async () => {
    auth.error = 'Email or password is incorrect. Please try again.'
    renderLogin()
    expect(screen.getByText('Email or password is incorrect. Please try again.')).toBeTruthy()
    expect(screen.queryByText('Account banned')).toBeNull()
  })

  it('Google refusal on a device that held the account: popup and block with the reason; local data discarded', async () => {
    localStorage.setItem('stracker.account-notice', 'a0000000-0000-4000-8000-00000000b001.9999999999.' + 'f'.repeat(64))
    auth.deviceNotice = BAN
    renderLogin({ suspended: 'google' })
    expect((await screen.findByRole('dialog')).textContent).toContain('Repeated spam')
    expect(screen.getAllByText(/Account banned/).length).toBeGreaterThan(1)
    expect(auth.discarded).toEqual(['a0000000-0000-4000-8000-00000000b001'])
  })

  it('Google refusal on a new device: generic popup and block, no reason', async () => {
    renderLogin({ suspended: 'google' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/sign in with your email and password/i)
    expect(dialog.textContent).not.toContain('Reason')
  })

  it('after the dashboard signed a banned user out: block only (the popup was already shown)', async () => {
    localStorage.setItem('stracker.account-notice', 'a0000000-0000-4000-8000-00000000b001.9999999999.' + 'f'.repeat(64))
    auth.deviceNotice = BAN
    renderLogin({ suspended: 'app' })
    expect(await screen.findByText('Reason:')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

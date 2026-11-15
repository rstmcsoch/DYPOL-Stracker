// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const getSession = vi.fn()
const exchangeCodeForSession = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession, exchangeCodeForSession } }, supabaseConfigured: true, localPreviewEnabled: false }))
vi.mock('../components/public/PublicHeader', () => ({ PublicBrand: () => <span>Stracker</span>, PublicThemeToggle: () => null }))

const { default: AuthCallbackPage } = await import('./AuthCallbackPage')
const { OAUTH_NEXT_KEY } = await import('../lib/google-auth')

function visit(url: string) {
  window.history.replaceState(null, '', url)
  return render(<MemoryRouter initialEntries={['/auth/callback']}>
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/planner" element={<h1>Planner page</h1>} />
      <Route path="/" element={<h1>Notebook home</h1>} />
    </Routes>
  </MemoryRouter>)
}

beforeEach(() => { getSession.mockReset(); exchangeCodeForSession.mockReset(); sessionStorage.clear() })
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })

describe('/auth/callback', () => {
  it('opens the remembered destination once the PKCE code has become a session', async () => {
    sessionStorage.setItem(OAUTH_NEXT_KEY, '/planner')
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    visit('/auth/callback?code=abc')
    expect(await screen.findByRole('heading', { name: 'Planner page' })).toBeTruthy()
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('exchanges the code itself if the client had not done it yet', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    visit('/auth/callback?code=abc')
    expect(await screen.findByRole('heading', { name: 'Notebook home' })).toBeTruthy()
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
  })

  it('explains a cancelled Google consent without contacting Supabase', async () => {
    visit('/auth/callback?error=access_denied&error_description=The+user+denied')
    expect((await screen.findByRole('alert')).textContent).toMatch(/cancelled/)
    expect(getSession).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Back to log in' }).getAttribute('href')).toBe('/login')
    expect(window.location.search).toBe('')
  })

  it('shows the "use email" message when the provider is disabled', async () => {
    visit('/auth/callback?error=bad_request&error_description=Unsupported+provider%3A+provider+is+not+enabled')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Google sign-in isn’t available right now/)
  })

  it('reports an expired or reused code', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid flow state' } })
    visit('/auth/callback?code=used')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired or was already used/))
  })
})

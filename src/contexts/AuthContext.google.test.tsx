// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// A first Google sign-in: Supabase puts the Google profile in user_metadata (full_name, name,
// avatar_url) and the provider list in app_metadata. Stracker's own display_name is absent.
const googleUser = {
  id: 'g-user-1',
  email: 'student@example.com',
  email_confirmed_at: '2026-11-14T06:00:00Z',
  user_metadata: { full_name: 'Asha Rao', name: 'Asha Rao', avatar_url: 'https://lh3.googleusercontent.com/a/x', email_verified: true },
  app_metadata: { provider: 'google', providers: ['google'] }
}
vi.mock('../lib/supabase', () => ({
  supabase: { auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    getSession: async () => ({ data: { session: { user: googleUser } }, error: null })
  } },
  supabaseConfigured: true,
  localPreviewEnabled: false
}))
vi.mock('../lib/telemetry/client', () => ({ track: vi.fn(), loginFailureReason: () => 'other' }))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { user } = useAuth()
  return <output>{user ? `${user.displayName}|${user.providers?.join(',')}|${user.email}` : 'none'}</output>
}

afterEach(() => cleanup())

describe('AuthContext with a Google (OAuth) session', () => {
  it('uses the Google full name as the display name and records the google provider', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('Asha Rao|google|student@example.com')).toBeTruthy()
  })
})

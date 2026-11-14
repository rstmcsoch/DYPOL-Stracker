// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ControlPhase } from './ControlSession'

const auth = { user: null as null | { id: string }, loading: false }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

const session = { phase: { kind: 'loading' } as ControlPhase }
vi.mock('./ControlSession', () => ({
  ControlSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useControlSession: () => ({ phase: session.phase, idle: 'active', refresh: vi.fn(), signOut: vi.fn(), markActive: vi.fn(), lastActivity: () => Date.now() })
}))
vi.mock('./gates', () => ({ MfaGate: () => <p>Authenticator step</p>, GateError: ({ message }: { message: string }) => <p>{message}</p> }))
vi.mock('./ControlLayout', () => ({ ControlLayout: ({ children }: { children: React.ReactNode }) => <div>Console layout{children}</div> }))
vi.mock('./reauth', () => ({ ReauthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./pages/OverviewPage', () => ({ default: () => <p>Overview</p> }))

const { ControlEntry } = await import('../App')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Stracker home or dashboard</p>} />
        <Route path="/control-panel/*" element={<ControlEntry />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  auth.user = null
  auth.loading = false
  session.phase = { kind: 'loading' }
  document.title = 'Stracker'
})
afterEach(() => { cleanup() })

describe('/control-panel gatekeeping', () => {
  it.each(['/control-panel', '/control-panel/', '/control-panel/users', '/control-panel/settings/roles', '/control-panel/login'])(
    'sends a visitor with no Stracker session from %s to the homepage',
    async path => {
      renderAt(path)
      expect(await screen.findByText('Stracker home or dashboard')).toBeTruthy()
      expect(screen.queryByText(/control center|console/i)).toBeNull()
    }
  )

  it('waits without any console branding while the session is restored', () => {
    auth.loading = true
    renderAt('/control-panel')
    expect(screen.getByText('Just a moment…')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/control|console/i)
  })

  it('sends a signed-in account without a role to its normal dashboard, with no hint and no console title', async () => {
    auth.user = { id: 'student' }
    session.phase = { kind: 'denied' }
    renderAt('/control-panel/users')
    expect(await screen.findByText('Stracker home or dashboard')).toBeTruthy()
    expect(document.title).not.toMatch(/control/i)
  })

  it('sends an expired or signed-out console session back to the normal sign-in (homepage)', async () => {
    auth.user = { id: 'owner' }
    session.phase = { kind: 'signed_out', notice: 'expired' }
    renderAt('/control-panel')
    expect(await screen.findByText('Stracker home or dashboard')).toBeTruthy()
  })

  it('shows the authenticator step to a signed-in role holder before anything else', async () => {
    auth.user = { id: 'owner' }
    session.phase = { kind: 'mfa' }
    renderAt('/control-panel/users')
    expect(await screen.findByText('Authenticator step')).toBeTruthy()
    expect(screen.queryByText('Console layout')).toBeNull()
  })

  it('opens the console only when the server reports granted', async () => {
    auth.user = { id: 'owner' }
    session.phase = { kind: 'granted', session: { status: 'granted', userId: 'owner', role: 'owner', aal: 'aal2', recentMfa: true, idleTimeoutSeconds: 1200 } as never }
    renderAt('/control-panel')
    expect(await screen.findByText('Overview')).toBeTruthy()
  })
})

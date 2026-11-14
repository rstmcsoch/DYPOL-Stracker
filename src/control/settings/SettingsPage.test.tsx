// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SettingsResponse } from './SettingsPage'

const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = []
let settings: SettingsResponse
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, controlFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => { calls.push({ path, init }); return init?.method === 'POST' ? { ok: true } : settings }) }
})
vi.mock('../MfaPanels', () => ({ MfaChallengeForm: ({ onVerified }: { onVerified: () => void }) => <button type="button" onClick={onVerified}>Mock verify code</button> }))
vi.mock('../ControlSession', () => ({ useControlSession: () => ({ phase: { kind: 'granted', session: { userId: 'owner-id' } } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { identities: [{ provider: 'email' }, { provider: 'google' }] } } }) } } }))
const { ReauthProvider } = await import('../reauth')
const { TimeZoneProvider } = await import('../time')
const { default: SettingsPage } = await import('./SettingsPage')

function base(role: 'owner' | 'administrator', permissions: string[]): SettingsResponse {
  return {
    me: { userId: 'owner-id', role, permissions: permissions as never, assignableRoles: role === 'owner' ? ['owner', 'administrator', 'manager', 'support', 'analyst'] : [] },
    site: { maintenanceEnabled: false, maintenanceMessage: '', siteDown: false, signupEnabled: true, signinEnabled: true, updatedAt: null },
    members: role === 'owner' ? [{ userId: 'owner-id', email: 'owner@example.org', role: 'owner', grantedAt: '2026-10-01T00:00:00Z', revokedAt: null, active: true, mfaEnrolled: true, overrides: {} }, { userId: 'm1', email: 'helper@example.org', role: 'support', grantedAt: '2026-11-01T00:00:00Z', revokedAt: null, active: true, mfaEnrolled: false, overrides: {} }] : null,
    matrix: role === 'owner' ? { administrator: {}, manager: {}, support: {}, analyst: {} } as never : null,
    activity: role === 'owner' ? [] : null,
    passkeys: role === 'owner' ? { available: true, items: [] } : null
  }
}

function renderAt(path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><TimeZoneProvider><ReauthProvider>
      <Routes><Route path="/control-panel/settings/*" element={<SettingsPage />} /></Routes>
    </ReauthProvider></TimeZoneProvider></MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => { calls.length = 0; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ passkeys_enabled: false }) }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Settings', () => {
  it('shows the owner every tab as horizontal tabs', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt('/control-panel/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Site status', 'Sign-up & sign-in', 'Security', 'Roles & members', 'Permissions', 'Activity'])
  })

  it('hides tabs outside the role (an admin without roles.manage sees no Roles or Permissions)', async () => {
    settings = base('administrator', ['settings.site'])
    renderAt('/control-panel/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Site status', 'Security'])
  })

  it('asks for the authenticator code BEFORE sending a save, and sends nothing when cancelled', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt('/control-panel/settings/access')
    fireEvent.click(await screen.findByLabelText(/Allow new sign-ups/))
    fireEvent.click(screen.getByRole('button', { name: /Save switches/ }))
    expect(await screen.findByText('Confirm with your authenticator')).toBeTruthy()
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Cancelled. Nothing was saved.')).toBeTruthy()
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Save switches/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(1))
    expect(calls.find(call => call.init?.method === 'POST')?.init?.body).toEqual({ action: 'access.update', signupEnabled: false, signinEnabled: true })
  })

  it('removing a role asks for confirmation, then the code, then sends role.remove', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt('/control-panel/settings/roles')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove role' }))
    const dialogButtons = await screen.findAllByRole('button', { name: 'Remove role' })
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(calls.find(call => call.init?.method === 'POST')?.init?.body).toEqual({ action: 'role.remove', userId: 'm1' }))
  })

  it('shows passkeys only to the owner and explains when Supabase has them switched off', async () => {
    settings = base('owner', [])
    renderAt('/control-panel/settings/security')
    expect(await screen.findByText('Passkeys (owner)')).toBeTruthy()
    expect(await screen.findByText(/Passkeys are switched off for this Supabase project/)).toBeTruthy()
    cleanup()
    settings = base('administrator', [])
    renderAt('/control-panel/settings/security')
    expect(await screen.findByText('Change your password')).toBeTruthy()
    expect(screen.queryByText('Passkeys (owner)')).toBeNull()
  })
})

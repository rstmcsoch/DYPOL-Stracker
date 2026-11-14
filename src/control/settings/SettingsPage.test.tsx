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
vi.mock('../passkey', () => ({ verifyWithOwnerPasskey: vi.fn(async () => ({ ok: true })) }))
const { ReauthProvider } = await import('../reauth')
const { TimeZoneProvider } = await import('../time')
const { default: SettingsPage } = await import('./SettingsPage')

function base(role: 'owner' | 'administrator', permissions: string[]): SettingsResponse {
  return {
    me: { userId: 'owner-id', role, permissions: permissions as never, assignableRoles: role === 'owner' ? ['owner', 'administrator', 'moderator', 'viewer'] : [] },
    site: { maintenanceEnabled: false, maintenanceMessage: '', siteDown: false, signupEnabled: true, signinEnabled: true, updatedAt: null },
    members: role === 'owner' ? [{ userId: 'owner-id', email: 'owner@example.org', role: 'owner', grantedAt: '2026-10-01T00:00:00Z', revokedAt: null, active: true, mfaEnrolled: true, overrides: {} }, { userId: 'm1', email: 'helper@example.org', role: 'viewer', grantedAt: '2026-11-01T00:00:00Z', revokedAt: null, active: true, mfaEnrolled: false, overrides: {} }] : null,
    matrix: role === 'owner' ? { administrator: {}, moderator: {}, viewer: {} } as never : null,
    activity: role === 'owner' ? [] : null,
    passkeys: role === 'owner' ? { available: true, items: [] } : null
  }
}

function renderAt(path: string, passkey = false) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><TimeZoneProvider><ReauthProvider passkey={passkey}>
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

  it('permissions use toggle switches (role="switch"), and a toggle change is what gets saved', async () => {
    settings = base('owner', ['roles.manage'])
    settings.matrix = { administrator: { 'users.view': true }, moderator: {}, viewer: {} } as never
    renderAt('/control-panel/settings/permissions')
    const toggle = await screen.findByRole('switch', { name: 'Admin: View users' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /Save Admin permissions/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(calls.find(call => call.init?.method === 'POST')?.init?.body).toEqual({ action: 'permissions.role', role: 'administrator', permissions: { 'users.view': false } }))
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Admin', 'Moderator', 'Viewer'])
  })

  it('owner with a passkey can confirm a save with it; others only see the code', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt('/control-panel/settings/access', true)
    fireEvent.click(await screen.findByLabelText(/Allow new sign-ups/))
    fireEvent.click(screen.getByRole('button', { name: /Save switches/ }))
    expect(await screen.findByText('Confirm with your passkey or authenticator')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passkey' }))
    await waitFor(() => expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(1))
    cleanup()
    calls.length = 0
    settings = base('administrator', ['settings.access'])
    renderAt('/control-panel/settings/access', false)
    fireEvent.click(await screen.findByLabelText(/Allow new sign-ups/))
    fireEvent.click(screen.getByRole('button', { name: /Save switches/ }))
    expect(await screen.findByText('Confirm with your authenticator')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull()
  })

  it.each([
    ['site', 'Site status'], ['access', 'Sign-up & sign-in'], ['security', 'Security'],
    ['roles', 'Roles & members'], ['permissions', 'Permissions'], ['activity', 'Activity']
  ])('marks exactly one tab as current for /control-panel/settings/%s (deep link or reload)', async (path, label) => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt(`/control-panel/settings/${path}`)
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    const current = [...nav.querySelectorAll('a[aria-current="page"]')]
    expect(current.map(a => a.textContent)).toEqual([label])
    expect(current[0]!.className).toContain('is-active')
    expect(nav.querySelectorAll('a.is-active')).toHaveLength(1)
  })

  it('moves the current-tab mark when another tab is clicked, and the bare /settings URL opens the first tab marked', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
    renderAt('/control-panel/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    await waitFor(() => expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('Site status'))
    fireEvent.click(screen.getByRole('link', { name: 'Permissions' }))
    await waitFor(() => expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('Permissions'))
    expect(screen.getByRole('link', { name: 'Site status' }).getAttribute('aria-current')).toBeNull()
  })

  it('Email domains: built-in and custom lists, GitHub link (not the full list), validated input, step-up save', async () => {
    settings = base('owner', ['settings.site', 'settings.access', 'settings.domains', 'roles.manage', 'audit.view'])
    settings.emailDomains = {
      builtIn: ['gmail.com', 'outlook.com'],
      allowed: [{ domain: 'college.edu.in', createdAt: '2026-11-14T10:00:00Z' }],
      blocked: [{ domain: 'spam-mail.example', createdAt: '2026-11-14T10:00:00Z' }],
      list: { count: 10181, refreshedAt: '2026-11-14T14:15:00Z' }
    }
    renderAt('/control-panel/settings/domains')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).toContain('Email domains')
    expect(await screen.findByText('Always allowed')).toBeTruthy()
    expect(screen.getByText('gmail.com')).toBeTruthy()
    expect(screen.getByText('college.edu.in')).toBeTruthy()
    expect(screen.getByText('spam-mail.example')).toBeTruthy()
    expect(screen.getByText(/10,181 domains/)).toBeTruthy()
    const link = screen.getByRole('link', { name: /^disposable-email-domains/ })
    expect(link.getAttribute('href')).toBe('https://github.com/disposable-email-domains/disposable-email-domains/blob/main/disposable_email_blocklist.conf')
    expect(screen.getByRole('link', { name: /disposable\/disposable-email-domains/ }).getAttribute('href')).toBe('https://github.com/disposable/disposable-email-domains')
    expect(screen.getByRole('link', { name: /7c\/fakefilter/ }).getAttribute('href')).toBe('https://github.com/7c/fakefilter')

    fireEvent.change(screen.getByLabelText(/Block a domain/), { target: { value: 'user@bad.example' } })
    fireEvent.click(screen.getByRole('button', { name: /^Block$/ }))
    expect(await screen.findByText(/without @/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Block a domain/), { target: { value: 'gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^Block$/ }))
    expect(await screen.findByText(/cannot be blocked/)).toBeTruthy()
    expect(calls.filter(call => call.init?.method === 'POST')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(/Block a domain/), { target: { value: ' Temp-Inbox.Example. ' } })
    fireEvent.click(screen.getByRole('button', { name: /^Block$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(calls.find(call => call.init?.method === 'POST')?.init?.body).toEqual({ action: 'domains.add', domain: 'temp-inbox.example', kind: 'block' }))
  })

  it('Email domains tab is hidden without the settings.domains permission', async () => {
    settings = base('administrator', ['settings.site'])
    renderAt('/control-panel/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).not.toContain('Email domains')
  })
})


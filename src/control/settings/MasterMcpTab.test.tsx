// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SettingsResponse } from './SettingsPage'
import type { MasterMcpMutationResult, MasterMcpStatus } from '../api'

const MASTER_TOKEN = 'stmcp_TESTTOKENVALUEONCEONLY'
const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = []
const writeText = vi.fn(async () => undefined)

let settings: SettingsResponse
let master: MasterMcpStatus

function connection(overrides: Partial<MasterMcpStatus['connections'][number]> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    displayName: 'Owner operations',
    tokenHint: 'ONLY',
    status: 'active' as const,
    createdAt: '2026-11-23T10:30:00.000Z',
    createdBy: 'owner-id',
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
    ...overrides
  }
}

function defaultMaster(): MasterMcpStatus {
  return {
    endpointUrl: 'https://stracker-git-feat-master-mcp-dypollabs.vercel.app/api/mcp',
    transport: 'Streamable HTTP (JSON-RPC)',
    connections: [],
    implementedTools: ['get_master_permissions'],
    authorizedCatalogue: ['get_master_permissions'],
    capabilities: { studentData: 'Inspect platform health and recent operational activity.' },
    restricted: { rolesAndPermissions: 'Cannot change roles or the Owner account.' },
    forbiddenToolNames: ['execute_sql'],
    rateLimits: { authenticatedPerMinute: 120, anonymousPerMinute: 60, recentRateLimited: 0 },
    lastUsedAt: null,
    toolUsage: [],
    recentActions: [],
    recentFailures: [],
    securityNotes: ['Master MCP credentials are separate from the Owner account. They never inherit Owner identity or Control Centre roles.']
  }
}

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    controlFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, init })
      if (path === 'master-mcp') {
        if (init?.method === 'POST') {
          const body = (init.body ?? {}) as { action?: string; displayName?: string; id?: string }
          if (body.action === 'create') {
            const row = connection({ displayName: body.displayName || 'Named' })
            master = { ...master, connections: [row, ...master.connections.filter(item => item.id !== row.id)] }
            return { ok: true, token: MASTER_TOKEN, tokenHint: 'ONLY', connection: row } satisfies MasterMcpMutationResult
          }
          if (body.action === 'revoke' && body.id) {
            master = {
              ...master,
              connections: master.connections.map(item => item.id === body.id
                ? { ...item, status: 'revoked', revokedAt: '2026-11-23T10:40:00.000Z', revokedBy: 'owner-id' }
                : item)
            }
            const row = master.connections.find(item => item.id === body.id)!
            return { ok: true, connection: row } satisfies MasterMcpMutationResult
          }
          return { ok: true }
        }
        return master
      }
      return init?.method === 'POST' ? { ok: true } : settings
    })
  }
})
vi.mock('../MfaPanels', () => ({ MfaChallengeForm: ({ onVerified }: { onVerified: () => void }) => <button type="button" onClick={onVerified}>Mock verify code</button> }))
vi.mock('../ControlSession', () => ({ useControlSession: () => ({ phase: { kind: 'granted', session: { userId: 'owner-id' } } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { identities: [] } } }) } } }))
vi.mock('../passkey', () => ({ verifyWithOwnerPasskey: vi.fn(async () => ({ ok: true })) }))

const { ReauthProvider } = await import('../reauth')
const { TimeZoneProvider } = await import('../time')
const { default: SettingsPage } = await import('./SettingsPage')

function base(role: 'owner' | 'administrator', permissions: string[], ownerReadOnly = false): SettingsResponse {
  return {
    me: { userId: 'owner-id', role, permissions: permissions as never, assignableRoles: role === 'owner' ? ['owner', 'administrator', 'moderator', 'viewer'] : [], ownerReadOnly },
    site: { maintenanceEnabled: false, maintenanceMessage: '', siteDown: false, signupEnabled: true, signinEnabled: true, updatedAt: null },
    members: null,
    removals: role === 'owner' ? [] : null,
    matrix: null,
    activity: null,
    passkeys: role === 'owner' ? { available: true, items: [] } : null
  }
}

function renderAt(path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><TimeZoneProvider><ReauthProvider passkey={false}>
      <Routes><Route path="/control-panel/settings/*" element={<SettingsPage />} /></Routes>
    </ReauthProvider></TimeZoneProvider></MemoryRouter>
  </QueryClientProvider>)
}

beforeEach(() => {
  calls.length = 0
  writeText.mockClear()
  settings = base('owner', ['settings.site', 'settings.access', 'roles.manage', 'audit.view'])
  master = defaultMaster()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ passkeys_enabled: false }) })))
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Settings → Master MCP', () => {
  it('is hidden from a non-owner', async () => {
    settings = base('administrator', ['settings.site'])
    renderAt('/control-panel/settings')
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' })
    expect([...nav.querySelectorAll('a')].map(a => a.textContent)).toEqual(['Site status', 'Security'])
    expect(screen.queryByRole('link', { name: 'Master MCP' })).toBeNull()
  })

  it('shows the endpoint, capabilities, and a create form to the owner', async () => {
    renderAt('/control-panel/settings/master-mcp')
    expect(await screen.findByText('https://stracker-git-feat-master-mcp-dypollabs.vercel.app/api/mcp')).toBeTruthy()
    expect(screen.getByText('Streamable HTTP (JSON-RPC)')).toBeTruthy()
    expect(screen.getByText('get_master_permissions')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create connection/ })).toBeTruthy()
    expect(screen.getByText(/separate from the Owner account/)).toBeTruthy()
    expect(calls.some(call => call.path === 'master-mcp' && !call.init?.method)).toBe(true)
  })

  it('shows a newly issued token once, copies it, and does not persist it after remount', async () => {
    renderAt('/control-panel/settings/master-mcp')
    fireEvent.change(await screen.findByLabelText(/Connection name/), { target: { value: 'Laptop Claude' } })
    fireEvent.click(screen.getByRole('button', { name: /Create connection/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(screen.getByText(MASTER_TOKEN)).toBeTruthy())
    const posted = calls.find(call => call.path === 'master-mcp' && call.init?.method === 'POST')
    expect(posted?.init?.body).toEqual({ action: 'create', displayName: 'Laptop Claude' })
    fireEvent.click(screen.getByRole('button', { name: /Copy token/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MASTER_TOKEN))
    const gets = calls.filter(call => call.path === 'master-mcp' && call.init?.method !== 'POST')
    expect(JSON.stringify(gets)).not.toContain(MASTER_TOKEN)
    expect(JSON.stringify(master)).not.toContain(MASTER_TOKEN)
    expect(JSON.stringify(master)).not.toMatch(/tokenHash|token_hash/)

    cleanup()
    renderAt('/control-panel/settings/master-mcp')
    await screen.findByText('Laptop Claude')
    expect(screen.queryByText(MASTER_TOKEN)).toBeNull()
    expect(screen.getByText('…ONLY')).toBeTruthy()
  })

  it('asks for confirmation before revoking a connection', async () => {
    master = { ...defaultMaster(), connections: [connection()] }
    renderAt('/control-panel/settings/master-mcp')
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(await screen.findByRole('heading', { name: 'Revoke this connection?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke connection' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Mock verify code' }))
    await waitFor(() => expect(calls.find(call => call.path === 'master-mcp' && call.init?.method === 'POST')?.init?.body).toEqual({
      action: 'revoke',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    }))
    expect(await screen.findByText('Revoked')).toBeTruthy()
  })

  it('disables mutations while the Owner account is in read-only removal countdown', async () => {
    settings = base('owner', ['settings.site', 'roles.manage', 'audit.view'], true)
    master = { ...defaultMaster(), connections: [connection()] }
    renderAt('/control-panel/settings/master-mcp')
    expect(await screen.findByText(/Connection changes are disabled/)).toBeTruthy()
    expect((screen.getByLabelText(/Connection name/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Create connection/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Revoke' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Rotate/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NORMAL_SITE_STATUS, type SiteStatus } from '../../lib/site-status'

const state = { status: NORMAL_SITE_STATUS as SiteStatus, teamMember: false, user: null as null | { id: string; isLocal?: boolean } }
vi.mock('./SiteStatusContext', () => ({ useSiteStatus: () => ({ status: state.status, ready: true, teamMember: state.teamMember, refresh: () => undefined }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, signOut: vi.fn() }) }))
const { SiteGate } = await import('./SiteGate')

afterEach(() => { cleanup(); state.status = NORMAL_SITE_STATUS; state.teamMember = false; state.user = null })

describe('SiteGate', () => {
  it('shows the themed maintenance page with the owner message to visitors while the site is down', () => {
    state.status = { ...NORMAL_SITE_STATUS, siteDown: true, maintenanceMessage: 'Back at 6 PM IST' }
    render(<SiteGate kind="public"><p>Homepage</p></SiteGate>)
    expect(screen.getByRole('heading', { name: 'We’ll be right back.' })).toBeTruthy()
    expect(screen.getByText('Back at 6 PM IST')).toBeTruthy()
    expect(screen.queryByText('Homepage')).toBeNull()
    expect(document.body.textContent).not.toMatch(/control/i)
  })
  it('lets a signed-in team member through with a staff banner, and shows students the maintenance page', () => {
    state.status = { ...NORMAL_SITE_STATUS, siteDown: true }
    state.user = { id: 'u1' }
    state.teamMember = true
    render(<SiteGate kind="app"><p>Notebook</p></SiteGate>)
    expect(screen.getByText('Notebook')).toBeTruthy()
    expect(screen.getByText('Site is down for visitors.')).toBeTruthy()
    cleanup()
    state.teamMember = false
    render(<SiteGate kind="app"><p>Notebook</p></SiteGate>)
    expect(screen.queryByText('Notebook')).toBeNull()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy()
  })
  it('keeps log in reachable during an outage', () => {
    state.status = { ...NORMAL_SITE_STATUS, siteDown: true }
    render(<SiteGate kind="auth"><p>Log in form</p></SiteGate>)
    expect(screen.getByText('Log in form')).toBeTruthy()
  })
  it('adds only a banner for a maintenance notice', () => {
    state.status = { ...NORMAL_SITE_STATUS, maintenanceEnabled: true, maintenanceMessage: 'Short update tonight' }
    render(<SiteGate kind="public"><p>Homepage</p></SiteGate>)
    expect(screen.getByText('Homepage')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Short update tonight')
  })
})

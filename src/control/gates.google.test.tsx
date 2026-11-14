// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const listFactors = vi.fn(async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }], all: [] }, error: null }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { mfa: { listFactors } } }, supabaseConfigured: true, localPreviewEnabled: false }))
const session = { phase: { kind: 'mfa', passkey: false, owner: false } as Record<string, unknown>, refresh: vi.fn(async () => undefined) }
vi.mock('./ControlSession', () => ({ useControlSession: () => ({ refresh: session.refresh, signOut: vi.fn(), phase: session.phase }) }))
vi.mock('./MfaPanels', () => ({ MfaChallengeForm: () => <p>Authenticator code form</p>, MfaEnrollment: () => <p>Enrollment</p> }))
const verifyWithOwnerPasskey = vi.fn(async () => ({ ok: true as const }))
vi.mock('./passkey', () => ({ verifyWithOwnerPasskey: () => verifyWithOwnerPasskey() }))

const gates = await import('./gates')

afterEach(() => { cleanup(); session.phase = { kind: 'mfa', passkey: false, owner: false }; verifyWithOwnerPasskey.mockClear(); session.refresh.mockClear() })

describe('Control Centre gates', () => {
  it('has no console sign-in portal: sign-in happens only through the normal Stracker login', () => {
    expect('SignInGate' in gates).toBe(false)
    expect('AccessDenied' in gates).toBe(false)
  })

  it('still requires the authenticator step after any sign-in method (password or Google)', async () => {
    render(<MemoryRouter><gates.MfaGate /></MemoryRouter>)
    expect(screen.getByText('Signed in')).toBeTruthy()
    expect(await screen.findByText('Authenticator code form')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /skip|bypass/i })).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('never offers a passkey to a non-owner, and gives them the plain recovery line', async () => {
    render(<MemoryRouter><gates.MfaGate /></MemoryRouter>)
    await screen.findByText('Authenticator code form')
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull()
    expect(screen.getByText('Lost your authenticator? Ask the owner to reset it.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/docs\/control-center|Stracker Control Cent/i)
  })

  it('offers the owner "Use passkey" next to the code, and re-checks the session after it', async () => {
    session.phase = { kind: 'mfa', passkey: true, owner: true }
    render(<MemoryRouter><gates.MfaGate /></MemoryRouter>)
    expect(await screen.findByText('Authenticator code form')).toBeTruthy()
    expect(screen.getByText('Lost your authenticator? Recover through Supabase.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use passkey' }))
    await waitFor(() => expect(session.refresh).toHaveBeenCalledTimes(1))
    expect(verifyWithOwnerPasskey).toHaveBeenCalledTimes(1)
  })

  it('owner without a registered passkey sees only the code', async () => {
    session.phase = { kind: 'mfa', passkey: false, owner: true }
    render(<MemoryRouter><gates.MfaGate /></MemoryRouter>)
    await screen.findByText('Authenticator code form')
    expect(screen.queryByRole('button', { name: /passkey/i })).toBeNull()
  })

  it('shows a failed passkey check without opening anything', async () => {
    session.phase = { kind: 'mfa', passkey: true, owner: true }
    verifyWithOwnerPasskey.mockResolvedValueOnce({ ok: false, message: 'The passkey prompt was closed.' } as never)
    render(<MemoryRouter><gates.MfaGate /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Use passkey' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The passkey prompt was closed.')
    expect(session.refresh).not.toHaveBeenCalled()
  })
})

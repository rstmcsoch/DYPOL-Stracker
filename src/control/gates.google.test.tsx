// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const listFactors = vi.fn(async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }], all: [] }, error: null }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { mfa: { listFactors } } }, supabaseConfigured: true, localPreviewEnabled: false }))
vi.mock('./ControlSession', () => ({ useControlSession: () => ({ refresh: vi.fn(), signOut: vi.fn() }) }))
vi.mock('./MfaPanels', () => ({ MfaChallengeForm: () => <p>Authenticator code form</p>, MfaEnrollment: () => <p>Enrollment</p> }))

const gates = await import('./gates')

afterEach(() => { cleanup() })

describe('Control Center gates', () => {
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
})

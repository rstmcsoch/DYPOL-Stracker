// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const listFactors = vi.fn()
const challengeAndVerify = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { auth: { mfa: { listFactors, challengeAndVerify } } } }))

const { MfaChallengeForm } = await import('./MfaPanels')
const { mfaErrorMessage } = await import('./mfa-errors')

beforeEach(() => {
  listFactors.mockResolvedValue({ data: { totp: [{ id: 'old', status: 'unverified' }, { id: 'f1', status: 'verified' }], all: [] }, error: null })
  challengeAndVerify.mockReset()
})
afterEach(() => cleanup())

async function enter(code: string) {
  const input = await screen.findByLabelText('Six-digit code')
  fireEvent.change(input, { target: { value: code } })
  return input
}

describe('MfaChallengeForm', () => {
  it('creates a fresh challenge for each attempt against the verified factor', async () => {
    const onVerified = vi.fn()
    challengeAndVerify.mockResolvedValueOnce({ data: null, error: { code: 'mfa_verification_failed', status: 422 } })
    challengeAndVerify.mockResolvedValueOnce({ data: {}, error: null })
    render(<MfaChallengeForm onVerified={onVerified} />)
    await enter('111111')
    fireEvent.submit(screen.getByRole('button', { name: 'Verify and continue' }).closest('form')!)
    expect(await screen.findByText(/phone's clock is probably off/)).toBeTruthy()
    expect(onVerified).not.toHaveBeenCalled()
    await enter('222222')
    fireEvent.submit(screen.getByRole('button', { name: 'Verify and continue' }).closest('form')!)
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(challengeAndVerify).toHaveBeenCalledTimes(2)
    expect(challengeAndVerify).toHaveBeenNthCalledWith(1, { factorId: 'f1', code: '111111' })
    expect(challengeAndVerify).toHaveBeenNthCalledWith(2, { factorId: 'f1', code: '222222' })
  })

  it('never sends the same code twice when submitted twice quickly', async () => {
    let resolve: (value: unknown) => void = () => undefined
    challengeAndVerify.mockReturnValue(new Promise(r => { resolve = r }))
    const onVerified = vi.fn()
    render(<MfaChallengeForm onVerified={onVerified} />)
    await enter('123456')
    const form = screen.getByRole('button', { name: 'Verify and continue' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    resolve({ data: {}, error: null })
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(challengeAndVerify).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed codes without calling Supabase', async () => {
    render(<MfaChallengeForm onVerified={vi.fn()} />)
    await enter('12a45')
    fireEvent.submit(screen.getByLabelText('Six-digit code').closest('form')!)
    expect(challengeAndVerify).not.toHaveBeenCalled()
  })
})

describe('mfaErrorMessage', () => {
  it('explains each failure without exposing details', () => {
    expect(mfaErrorMessage({ code: 'mfa_verification_failed', status: 422 })).toMatch(/clock/)
    expect(mfaErrorMessage({ code: 'mfa_challenge_expired', status: 422 })).toMatch(/expired/)
    expect(mfaErrorMessage({ status: 429 })).toMatch(/Too many attempts/)
    expect(mfaErrorMessage({ code: 'session_not_found', status: 403 })).toMatch(/session ended/)
    expect(mfaErrorMessage({})).toMatch(/connection/)
  })
})

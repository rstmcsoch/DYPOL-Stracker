// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const state = vi.hoisted(() => ({
  notice: null as unknown,
  acks: [] as string[],
  signOuts: [] as unknown[]
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: async (opts: unknown) => { state.signOuts.push(opts); return { error: null } } } } }))
vi.mock('../lib/account-notices-client', () => ({
  fetchMyNotice: async () => state.notice,
  acknowledgeNotice: async (id: string) => { state.acks.push(id) }
}))

const { AccountNoticeGate } = await import('./AccountNoticeGate')

function LoginProbe() {
  const location = useLocation()
  return <p>login page {JSON.stringify(location.state)}</p>
}

function renderGate() {
  return render(<MemoryRouter initialEntries={['/']}><Routes>
    <Route path="/" element={<><AccountNoticeGate /><p>dashboard</p></>} />
    <Route path="/login" element={<LoginProbe />} />
  </Routes></MemoryRouter>)
}

beforeEach(() => { state.notice = null; state.acks = []; state.signOuts = [] })
afterEach(() => cleanup())

describe('one-time account notices', () => {
  it('shows nothing when there is no pending notice', async () => {
    renderGate()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('dashboard')).toBeTruthy()
  })

  it('shows a warning once, stores the acknowledgement, and leaves the dashboard working', async () => {
    state.notice = { id: 'n-1', kind: 'warning', reason: 'Please keep it respectful', until: null, permanent: false }
    renderGate()
    expect(await screen.findByText('You have received a warning')).toBeTruthy()
    expect(screen.getByText('Please keep it respectful')).toBeTruthy()
    fireEvent.click(screen.getByText('I understand'))
    await waitFor(() => expect(state.acks).toEqual(['n-1']))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('dashboard')).toBeTruthy()
    expect(state.signOuts).toEqual([])
  })

  it('shows a ban with its IST end time, then signs out locally and opens the sign-in page', async () => {
    state.notice = { id: 'n-2', kind: 'ban', reason: 'Spam', until: '2026-11-20T10:30:00Z', permanent: false }
    renderGate()
    expect(await screen.findByText('Your account is suspended')).toBeTruthy()
    expect(screen.getByText(/until 20 Nov 2026, 4:00 pm IST/)).toBeTruthy()
    fireEvent.click(screen.getByText('Sign out'))
    expect(await screen.findByText(/login page/)).toBeTruthy()
    expect(screen.getByText(/"suspended":true/)).toBeTruthy()
    expect(state.acks).toEqual(['n-2'])
    expect(state.signOuts).toEqual([{ scope: 'local' }])
  })
})

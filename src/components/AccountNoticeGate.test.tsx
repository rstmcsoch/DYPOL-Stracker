// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SYNC_REFUSED_EVENT } from '../lib/account-notices'

const state = vi.hoisted(() => ({
  notice: null as unknown,
  fetches: 0,
  acks: [] as string[],
  signOuts: [] as unknown[],
  discarded: [] as string[]
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: async (opts: unknown) => { state.signOuts.push(opts); return { error: null } } } } }))
vi.mock('../lib/account-notices-client', () => ({
  fetchMyNotice: async () => { state.fetches += 1; return state.notice },
  acknowledgeNotice: async (id: string) => { state.acks.push(id) },
  discardLocalAccountData: async (id: string) => { state.discarded.push(id) }
}))

const { AccountNoticeGate } = await import('./AccountNoticeGate')

function LoginProbe() {
  const location = useLocation()
  return <p>login page {JSON.stringify(location.state)}</p>
}

function renderGate() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/']}><Routes>
    <Route path="/" element={<><AccountNoticeGate userId="u-1" /><p>dashboard</p></>} />
    <Route path="/login" element={<LoginProbe />} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => { state.notice = null; state.fetches = 0; state.acks = []; state.signOuts = []; state.discarded = [] })
afterEach(() => cleanup())

describe('account notices on the dashboard', () => {
  it('shows nothing when there is no pending notice', async () => {
    renderGate()
    await waitFor(() => expect(state.fetches).toBe(1))
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
    expect(state.signOuts).toEqual([])
    expect(state.discarded).toEqual([])
  })

  it('a ban while already signed in: a refused sync triggers the check, the popup shows, local data is discarded and the user is signed out', async () => {
    renderGate()
    await waitFor(() => expect(state.fetches).toBe(1))
    // The account is banned after the dashboard opened; the next cloud write is refused.
    state.notice = { id: 'n-2', kind: 'ban', reason: 'Spam', until: '2026-11-20T10:30:00Z', permanent: false }
    await act(async () => { window.dispatchEvent(new CustomEvent(SYNC_REFUSED_EVENT)) })
    expect(await screen.findByText('Your account is banned')).toBeTruthy()
    expect(screen.getByText(/until 20 Nov 2026, 4:00 pm IST/)).toBeTruthy()
    expect(screen.getByText(/discarded and will not be synced/)).toBeTruthy()
    fireEvent.click(screen.getByText('Sign out'))
    expect(await screen.findByText(/login page/)).toBeTruthy()
    expect(screen.getByText(/"suspended":"app"/)).toBeTruthy()
    expect(state.acks).toEqual(['n-2'])
    expect(state.discarded).toEqual(['u-1'])
    expect(state.signOuts).toEqual([{ scope: 'local' }])
  })

  it('checks once per burst of refused syncs', async () => {
    renderGate()
    await waitFor(() => expect(state.fetches).toBe(1))
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SYNC_REFUSED_EVENT))
      window.dispatchEvent(new CustomEvent(SYNC_REFUSED_EVENT))
    })
    await waitFor(() => expect(state.fetches).toBe(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(state.fetches).toBe(2)
  })
})

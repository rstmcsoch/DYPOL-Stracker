// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDb } from '../lib/database'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import type { AppSettings } from '../types'

const USER = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const CLOUD_USER = { id: USER, email: 'master@example.com', displayName: 'Master', isLocal: false }

const cloudMock = vi.hoisted(() => ({
  upserts: [] as Array<{ table: string; rows: unknown }>,
  failSettingsUpsert: true,
  remoteSettings: null as AppSettings | null
}))

vi.mock('../lib/supabase', () => {
  const rowsForTable = (table: string) => {
    if (table === 'app_settings') return cloudMock.remoteSettings ? [cloudMock.remoteSettings] : []
    if (table === 'profiles') {
      return [{
        id: USER, user_id: USER, display_name: 'Master', email: 'master@example.com',
        created_at: '2026-11-19T00:00:00.000Z', updated_at: '2026-11-19T00:00:00.000Z'
      }]
    }
    if (table === 'user_exam_tracks') return defaultExamTracks(USER)
    return []
  }

  const from = (table: string) => ({
    select: () => ({
      eq: () => {
        const result = Promise.resolve({ data: rowsForTable(table), error: null })
        return Object.assign(result, {
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: rowsForTable(table)[0] ?? null, error: null })
          })
        })
      }
    }),
    upsert: (rows: unknown) => {
      cloudMock.upserts.push({ table, rows })
      const result = table === 'app_settings' && cloudMock.failSettingsUpsert
        ? Promise.resolve({ error: { message: 'Cloud write refused for app_settings' } })
        : Promise.resolve({ error: null })
      return Object.assign(result, { setHeader: () => result })
    }
  })
  return {
    supabaseConfigured: true,
    supabase: { from }
  }
})

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: CLOUD_USER })
}))

vi.mock('./SiteContentContext', () => ({
  fetchPublishedOverrides: vi.fn(async () => ({}))
}))

import { DataProvider, useData } from './DataContext'
import { ToastProvider } from './ToastContext'

function Probe() {
  const { data, profileLoaded, syncState, syncError, pendingCount, updateSettings, refresh } = useData()
  return (
    <div>
      <span data-testid="loaded">{String(profileLoaded)}</span>
      <span data-testid="theme">{data.settings.theme}</span>
      <span data-testid="font">{data.settings.interface_font}</span>
      <span data-testid="target">{data.settings.target_score}</span>
      <span data-testid="sync-state">{syncState}</span>
      <span data-testid="sync-error">{syncError ?? ''}</span>
      <span data-testid="pending">{pendingCount}</span>
      <button type="button" onClick={() => void updateSettings(current => ({ ...current, theme: 'dark' }))}>
        Switch dark
      </button>
      <button type="button" onClick={() => void updateSettings(current => ({ ...current, interface_font: 'sora' }))}>
        Switch font
      </button>
      <button type="button" onClick={() => void refresh()}>
        Refresh
      </button>
    </div>
  )
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DataProvider>
          <Probe />
        </DataProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  cloudMock.upserts = []
  cloudMock.failSettingsUpsert = true
  cloudMock.remoteSettings = {
    ...defaultSettings(USER, 'Master'),
    theme: 'light',
    exam_id: 'cuet-ug',
    onboarding_completed: true
  }
})

afterEach(async () => {
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 25))
  await Promise.all(localDb.tables.map(table => table.clear()))
})

describe('DataProvider local-only theme switching', () => {
  it('saves Light/Night mode locally without touching Supabase, sync_queue, or showing sync errors', async () => {
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'))
    expect(screen.getByTestId('sync-state').textContent).toBe('synced')
    cloudMock.upserts = []

    fireEvent.click(screen.getByRole('button', { name: 'Switch dark' }))

    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })

    expect((await localDb.app_settings.get(USER))?.theme).toBe('dark')
    expect(cloudMock.upserts).toEqual([])
    expect(await localDb.sync_queue.where('user_id').equals(USER).count()).toBe(0)
    expect(screen.getByTestId('pending').textContent).toBe('0')
    expect(screen.getByTestId('sync-state').textContent).toBe('synced')
    expect(screen.getByTestId('sync-error').textContent).toBe('')
    expect(screen.queryByText(/cloud sync failed/i)).toBeNull()
  })

  it('preserves the local Light/Night mode across a cloud refresh while still pulling other cloud settings', async () => {
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'))

    fireEvent.click(screen.getByRole('button', { name: 'Switch dark' }))
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'))

    cloudMock.remoteSettings = { ...cloudMock.remoteSettings!, theme: 'light', target_score: 285 }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(screen.getByTestId('target').textContent).toBe('285'))
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect((await localDb.app_settings.get(USER))?.theme).toBe('dark')
  })

  it('continues syncing non-theme settings to Supabase normally', async () => {
    cloudMock.failSettingsUpsert = false
    renderHarness()
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'))
    cloudMock.upserts = []

    fireEvent.click(screen.getByRole('button', { name: 'Switch font' }))

    await waitFor(() => expect(screen.getByTestId('font').textContent).toBe('sora'))
    await waitFor(() => expect(cloudMock.upserts.some(call => call.table === 'app_settings')).toBe(true))
    await waitFor(async () => expect(await localDb.sync_queue.where('user_id').equals(USER).count()).toBe(0))
  })
})

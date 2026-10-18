// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/defaults'
import type { AppSettings } from '../types'

const mocks = vi.hoisted(() => ({ useData: vi.fn(), notify: vi.fn(), useAuth: vi.fn() }))

vi.mock('../contexts/DataContext', () => ({ useData: mocks.useData }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: mocks.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: mocks.useAuth }))
vi.mock('../components/ai/AISettingsSection', () => ({ AISettingsSection: () => null }))
vi.mock('../components/jee/SettingsSections', () => ({ ExamTracksSection: () => null, ReminderSettingsSection: () => null }))

import { AppearanceProvider } from '../contexts/AppearanceContext'
import SettingsPage from './SettingsPage'

function tree(client: QueryClient) {
  return <QueryClientProvider client={client}><MemoryRouter><AppearanceProvider><SettingsPage /></AppearanceProvider></MemoryRouter></QueryClientProvider>
}

function mountSettings(startSettings: AppSettings = defaultSettings('reader-one')) {
  let savedSettings = startSettings
  let setSettingsState: Dispatch<SetStateAction<AppSettings>> = () => {}
  const upsert = vi.fn(async (_table: string, record: AppSettings) => {
    savedSettings = record
    setSettingsState(record)
  })
  // Settings saves now go through the single settings writer: a mutator built from the latest row.
  const updateSettings = vi.fn(async (mutate: (current: AppSettings) => AppSettings) => {
    savedSettings = mutate(savedSettings)
    setSettingsState(savedSettings)
    return savedSettings
  })
  mocks.useAuth.mockReturnValue({ user: { id: savedSettings.user_id, email: 'reader@example.com' }, signOut: vi.fn() })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Harness() {
    const [settings, setSettings] = useState(startSettings)
    setSettingsState = setSettings
    mocks.useData.mockReturnValue({ data: { settings, profile: null }, upsert, updateSettings })
    return tree(client)
  }
  const view = render(<Harness />)
  return {
    ...view,
    client,
    upsert,
    updateSettings,
    getSavedSettings: () => savedSettings,
    openAppearance: () => fireEvent.click(screen.getByRole('tab', { name: /Appearance/ }))
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  mocks.useData.mockReset()
  mocks.notify.mockReset()
  mocks.useAuth.mockReset()
})

afterEach(() => cleanup())

describe('Reading font draft and save flow', () => {
  it('previews a selected option immediately without saving or disabling Appearance controls', () => {
    const page = mountSettings()
    page.openAppearance()

    const preview = screen.getByRole('heading', { name: 'A clearer study session' }).closest('.typography-live-preview')
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute('style')).toContain("'Lexend'")

    fireEvent.click(screen.getByRole('radio', { name: /Poppins/ }))
    expect(preview?.getAttribute('style')).toContain("'Poppins'")
    expect(preview?.getAttribute('style')).toContain('0.95')
    expect(page.updateSettings).not.toHaveBeenCalled()
    expect(page.upsert).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Save appearance settings' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('radio', { name: /Warm paper/ }) as HTMLInputElement).disabled).toBe(false)
  })

  it('persists only the final selection on Save and clears the dirty state', async () => {
    const page = mountSettings()
    page.openAppearance()

    fireEvent.click(screen.getByRole('radio', { name: /Poppins/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Sora/ }))
    expect(page.updateSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save appearance settings' }))
    await waitFor(() => expect(page.updateSettings).toHaveBeenCalledTimes(1))
    expect(page.getSavedSettings()).toEqual(expect.objectContaining({
      user_id: 'reader-one',
      interface_font: 'sora'
    }))
    expect(page.upsert).not.toHaveBeenCalledWith('app_settings', expect.anything())
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save appearance settings' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('discards a draft back to the prior saved font without writing it', () => {
    const page = mountSettings({ ...defaultSettings('reader-one'), interface_font: 'open-sans' })
    page.openAppearance()

    fireEvent.click(screen.getByRole('radio', { name: /Sora/ }))
    const preview = screen.getByRole('heading', { name: 'A clearer study session' }).closest('.typography-live-preview')
    expect(preview?.getAttribute('style')).toContain("'Sora'")

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(preview?.getAttribute('style')).toContain("'Open Sans'")
    expect((screen.getByRole('radio', { name: /Open Sans/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: 'Save appearance settings' }) as HTMLButtonElement).disabled).toBe(true)
    expect(page.updateSettings).not.toHaveBeenCalled()
  })

  it('does not save when Settings is left with an unsaved font draft', () => {
    const page = mountSettings()
    page.openAppearance()
    fireEvent.click(screen.getByRole('radio', { name: /Sora/ }))
    page.unmount()
    expect(page.updateSettings).not.toHaveBeenCalled()
  })

  it('restores the saved Reading font when the Settings screen is mounted again', async () => {
    const page = mountSettings()
    page.openAppearance()
    fireEvent.click(screen.getByRole('radio', { name: /Open Sans/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save appearance settings' }))
    await waitFor(() => expect(page.getSavedSettings().interface_font).toBe('open-sans'))
    const stored = page.getSavedSettings()
    page.unmount()

    const refreshed = mountSettings(stored)
    refreshed.openAppearance()
    expect((screen.getByRole('radio', { name: /Open Sans/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('heading', { name: 'A clearer study session' }).closest('.typography-live-preview')?.getAttribute('style'))
      .toContain("'Open Sans'")
  })
})

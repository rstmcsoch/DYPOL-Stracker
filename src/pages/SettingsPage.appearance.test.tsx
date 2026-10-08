// @vitest-environment jsdom
// Integration tests for the Settings → Appearance draft. They mount the real DataProvider,
// AppearanceProvider and SettingsPage over fake IndexedDB, so the assertions observe the same
// draft → preview → Save → persistence → reload path a student uses.
import 'fake-indexeddb/auto'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDb } from '../lib/database'
import { defaultSettings } from '../lib/defaults'
import { INTERFACE_FONT_OPTIONS } from '../lib/fonts'
import type { AppSettings, InterfaceFont, ThemeMode } from '../types'

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; displayName: string; isLocal: boolean },
  signOut: vi.fn(async () => undefined)
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, signOut: auth.signOut, updatePassword: vi.fn(async () => undefined) })
}))
// Both sections need their own providers and are outside the appearance flow under test.
vi.mock('../components/ai/AISettingsSection', () => ({ AISettingsSection: () => null }))
vi.mock('../components/jee/SettingsSections', () => ({ ExamTracksSection: () => null, ReminderSettingsSection: () => null }))

import { AppearanceProvider } from '../contexts/AppearanceContext'
import { DataProvider } from '../contexts/DataContext'
import { ToastProvider } from '../contexts/ToastContext'
import { ThemeToggle } from '../components/ThemeToggle'
import SettingsPage from './SettingsPage'

const USER = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const OTHER_USER = 'b3f147d2-b7cf-53bd-a461-0d3cfed00002'
const LOCAL_USER = { id: USER, email: '', displayName: 'Study notebook', isLocal: true }
const OTHER_LOCAL_USER = { id: OTHER_USER, email: '', displayName: 'Second notebook', isLocal: true }

const stackOf = (font: InterfaceFont) => INTERFACE_FONT_OPTIONS.find(option => option.value === font)!.stack
const rootFont = () => document.documentElement.style.getPropertyValue('--app-font-family')
const rootTheme = () => document.documentElement.dataset.theme

/** Mirrors the signed-in shell: data and appearance providers, the Settings route and the header switch. */
function renderNotebook(user: typeof LOCAL_USER, { header = false } = {}) {
  auth.user = user
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const shell = (settingsVisible: boolean): ReactNode => <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <DataProvider key={user.id}>
          <AppearanceProvider>
            {header && <ThemeToggle />}
            {settingsVisible && <SettingsPage />}
          </AppearanceProvider>
        </DataProvider>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>
  const view = render(<>{shell(true)}</>)
  return {
    leaveSettings: () => view.rerender(<>{shell(false)}</>),
    returnToSettings: () => view.rerender(<>{shell(true)}</>),
    unmount: view.unmount
  }
}

async function seedSettings(overrides: Partial<AppSettings> = {}, userId = USER) {
  await localDb.app_settings.put({ ...defaultSettings(userId), ...overrides })
}

/** What a reload would read: the persisted row, straight from IndexedDB. */
async function persisted(userId = USER) {
  const row = await localDb.app_settings.get(userId)
  return { interface_font: row?.interface_font, theme: row?.theme, owner_name: row?.owner_name, updated_at: row?.updated_at, revision_gaps: row?.revision_gaps, target_score: row?.target_score }
}

/**
 * Every settings write goes through DataContext's upsertMany, which calls bulkPut on the table handle
 * returned by localDb.table(). That handle is a different object from localDb.app_settings, so the
 * spy must be attached to it, or the assertions would pass without observing anything.
 */
const watchSettingsWrites = () => vi.spyOn(localDb.table('app_settings'), 'bulkPut')

async function waitForRootFont(font: InterfaceFont) {
  await waitFor(() => expect(rootFont()).toBe(stackOf(font)), { timeout: 3000 })
}

/** Give any in-flight persistence a chance to land, so a stray write would be observed. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)) })

const tabButton = (tab: string) => document.getElementById(`settings-tab-${tab}`) as HTMLButtonElement
const panel = (tab: string) => document.getElementById(`settings-panel-${tab}`) as HTMLElement
const openTab = (tab: string) => fireEvent.click(tabButton(tab))
const fontRadio = (font: InterfaceFont) => document.querySelector<HTMLInputElement>(`input[name="interface_font"][value="${font}"]`)!
const themeRadio = (theme: ThemeMode) => document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`)!
const chooseFont = (font: InterfaceFont) => fireEvent.click(fontRadio(font))
const chooseTheme = (theme: ThemeMode) => fireEvent.click(themeRadio(theme))
const saveButton = (tab: string) => within(panel(tab)).getByRole('button', { name: /^Save / }) as HTMLButtonElement
const discardButton = (tab: string) => within(panel(tab)).getByRole('button', { name: 'Discard changes' })
const isDirty = (tab: string) => tabButton(tab).querySelector('.settings-tab-dot') !== null
const saveStateText = (tab: string) => panel(tab).querySelector('.settings-save-state')?.textContent?.trim()
const appearanceFieldset = () => panel('appearance').querySelector('fieldset') as HTMLFieldSetElement

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn()
    }))
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  // Let the unmounted providers finish any background read before the store is cleared.
  await new Promise(resolve => setTimeout(resolve, 20))
  await Promise.all(localDb.tables.map(table => table.clear()))
  document.documentElement.style.removeProperty('--app-font-family')
  document.documentElement.removeAttribute('data-theme')
  auth.signOut.mockClear()
})

describe('Settings → Appearance: draft, preview and Save', () => {
  it('previews a selected font globally, but persists nothing and keeps the controls and Save enabled', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    const before = await persisted()
    const writes = watchSettingsWrites()

    chooseFont('sora')
    await settle()

    expect(rootFont()).toBe(stackOf('sora'))
    expect(fontRadio('sora').checked).toBe(true)
    expect(fontRadio('sora').disabled).toBe(false)
    expect(appearanceFieldset().disabled).toBe(false)
    expect(saveButton('appearance').disabled).toBe(false)
    expect(isDirty('appearance')).toBe(true)
    expect(writes).not.toHaveBeenCalled()
    expect(await persisted()).toEqual(before)
  })

  it('Save persists the chosen font, clears the dirty state and keeps the font applied', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')

    chooseFont('sora')
    expect(isDirty('appearance')).toBe(true)
    expect(saveButton('appearance').disabled).toBe(false)
    expect((await persisted()).interface_font).toBe('open-sans')

    fireEvent.click(saveButton('appearance'))

    await waitFor(async () => expect((await persisted()).interface_font).toBe('sora'))
    await waitFor(() => expect(isDirty('appearance')).toBe(false))
    expect(saveButton('appearance').disabled).toBe(true)
    expect(saveStateText('appearance')).toMatch(/^(Saved|All changes in this tab are saved)$/)
    expect(rootFont()).toBe(stackOf('sora'))
    expect(fontRadio('sora').checked).toBe(true)
  })

  it('repeated font changes persist only the final choice, in a single write', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    const writes = watchSettingsWrites()

    chooseFont('poppins')
    chooseFont('default')
    chooseFont('sora')
    chooseFont('poppins')
    chooseFont('sora')
    await settle()

    expect(writes).not.toHaveBeenCalled()
    expect(rootFont()).toBe(stackOf('sora'))
    fireEvent.click(saveButton('appearance'))
    await waitFor(async () => expect((await persisted()).interface_font).toBe('sora'))

    expect(writes).toHaveBeenCalledTimes(1)
    const [rows] = writes.mock.calls[0] as unknown as [AppSettings[]]
    expect(rows.map(row => row.interface_font)).toEqual(['sora'])
  })

  it('Discard restores the saved font, the saved theme and the global font, and clears the dirty state', async () => {
    await seedSettings({ interface_font: 'open-sans', theme: 'light' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')

    chooseFont('sora')
    chooseTheme('dark')
    expect(rootFont()).toBe(stackOf('sora'))
    expect(rootTheme()).toBe('light')

    fireEvent.click(discardButton('appearance'))

    await waitFor(() => expect(rootFont()).toBe(stackOf('open-sans')))
    expect(fontRadio('open-sans').checked).toBe(true)
    expect(themeRadio('light').checked).toBe(true)
    expect(isDirty('appearance')).toBe(false)
    expect(saveButton('appearance').disabled).toBe(true)
    expect(await persisted()).toMatchObject({ interface_font: 'open-sans', theme: 'light' })
  })

  it('theme edits stay in the draft until they are saved', async () => {
    await seedSettings({ interface_font: 'open-sans', theme: 'light' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')

    chooseTheme('dark')
    expect(rootTheme()).toBe('light')
    expect(isDirty('appearance')).toBe(true)

    fireEvent.click(saveButton('appearance'))

    await waitFor(() => expect(rootTheme()).toBe('dark'))
    expect(await persisted()).toMatchObject({ theme: 'dark', interface_font: 'open-sans' })
  })

  it('leaving Settings without saving persists nothing and reverts the preview', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    const view = renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    const before = await persisted()
    const writes = watchSettingsWrites()

    chooseFont('sora')
    expect(rootFont()).toBe(stackOf('sora'))
    view.leaveSettings()

    await waitFor(() => expect(rootFont()).toBe(stackOf('open-sans')))
    await settle()
    expect(writes).not.toHaveBeenCalled()
    expect(await persisted()).toEqual(before)

    view.returnToSettings()
    openTab('appearance')
    expect(fontRadio('open-sans').checked).toBe(true)
    expect(isDirty('appearance')).toBe(false)
  })

  it('a reload restores the saved font and theme, and the next visit starts with a clean draft', async () => {
    await seedSettings({ interface_font: 'open-sans', theme: 'light' })
    const first = renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')
    chooseTheme('dark')
    fireEvent.click(saveButton('appearance'))
    await waitFor(async () => expect(await persisted()).toMatchObject({ interface_font: 'sora', theme: 'dark' }))
    first.unmount()

    renderNotebook(LOCAL_USER)
    await waitForRootFont('sora')
    await waitFor(() => expect(rootTheme()).toBe('dark'))
    openTab('appearance')

    expect(fontRadio('sora').checked).toBe(true)
    expect(themeRadio('dark').checked).toBe(true)
    expect(isDirty('appearance')).toBe(false)
  })
})

describe('Settings → Appearance: other writers and other tabs', () => {
  it('the header theme switch neither persists nor disturbs the font draft', async () => {
    await seedSettings({ interface_font: 'open-sans', theme: 'light' })
    renderNotebook(LOCAL_USER, { header: true })
    await waitForRootFont('open-sans')
    openTab('appearance')

    chooseFont('sora')
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(rootTheme()).toBe('dark'))
    await waitFor(async () => expect((await persisted()).theme).toBe('dark'))
    expect((await persisted()).interface_font).toBe('open-sans')
    expect(fontRadio('sora').checked).toBe(true)
    expect(rootFont()).toBe(stackOf('sora'))
    expect(isDirty('appearance')).toBe(true)
    // The theme was not part of the draft, so it follows the header switch.
    expect(themeRadio('dark').checked).toBe(true)

    fireEvent.click(saveButton('appearance'))
    await waitFor(async () => expect(await persisted()).toMatchObject({ theme: 'dark', interface_font: 'sora' }))
    expect(isDirty('appearance')).toBe(false)
  })

  it('a header switch pressed before the saved settings load keeps every saved field', async () => {
    await seedSettings({ interface_font: 'sora', theme: 'light', target_score: 300 })
    renderNotebook(LOCAL_USER, { header: true })
    // Pressed before IndexedDB has answered. A writer that starts from defaults here would replace the saved row.
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(async () => expect((await persisted()).theme).toBe('dark'))
    expect(await persisted()).toMatchObject({ interface_font: 'sora', target_score: 300 })
    await waitForRootFont('sora')
  })

  it('a header theme switch and a Save pressed together both survive', async () => {
    await seedSettings({ interface_font: 'open-sans', theme: 'light' })
    renderNotebook(LOCAL_USER, { header: true })
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(saveButton('appearance'))

    await waitFor(async () => expect(await persisted()).toMatchObject({ theme: 'dark', interface_font: 'sora' }))
  })

  it('saving another tab does not persist the appearance draft, and the draft survives switching tabs', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')

    openTab('exam')
    fireEvent.change(within(panel('exam')).getByLabelText(/Target score/), { target: { value: '300' } })
    fireEvent.click(saveButton('exam'))
    await waitFor(async () => expect((await persisted()).target_score).toBe(300))

    expect((await persisted()).interface_font).toBe('open-sans')
    openTab('appearance')
    expect(fontRadio('sora').checked).toBe(true)
    expect(isDirty('appearance')).toBe(true)
    expect(rootFont()).toBe(stackOf('sora'))
    expect(saveButton('appearance').disabled).toBe(false)
  })

  it('a Study rhythm save writes only its own fields, normalised, and leaves the font draft alone', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')

    openTab('rhythm')
    fireEvent.change(within(panel('rhythm')).getByDisplayValue('1, 7, 30'), { target: { value: '30, 1, 7' } })
    fireEvent.click(saveButton('rhythm'))

    await waitFor(async () => expect((await persisted()).revision_gaps).toEqual([1, 7, 30]))
    expect((await persisted()).interface_font).toBe('open-sans')
    expect(within(panel('rhythm')).getByDisplayValue('1, 7, 30')).toBeTruthy()
    openTab('appearance')
    expect(fontRadio('sora').checked).toBe(true)
    expect(isDirty('appearance')).toBe(true)
  })

  it('a blocked save shows the field error and writes nothing', async () => {
    await seedSettings({ interface_font: 'open-sans' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('rhythm')
    const writes = watchSettingsWrites()

    // The weak threshold must stay below the strong threshold (80 by default).
    fireEvent.change(within(panel('rhythm')).getByLabelText(/Weak below/), { target: { value: '95' } })
    fireEvent.click(saveButton('rhythm'))

    expect(await screen.findByText('Please correct the highlighted fields.')).toBeTruthy()
    expect(screen.getByText('Strong above must be greater than Weak below.')).toBeTruthy()
    expect(writes).not.toHaveBeenCalled()
  })

  it('an Account save updates the notebook name and profile, and leaves the font draft alone', async () => {
    await seedSettings({ interface_font: 'open-sans', owner_name: 'Old name' })
    renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')

    openTab('account')
    fireEvent.change(within(panel('account')).getByLabelText(/Name in your notebook/), { target: { value: 'Aarav' } })
    fireEvent.click(saveButton('account'))

    await waitFor(async () => expect((await persisted()).owner_name).toBe('Aarav'))
    expect((await localDb.profiles.get(USER))?.display_name).toBe('Aarav')
    expect((await persisted()).interface_font).toBe('open-sans')
    openTab('appearance')
    expect(fontRadio('sora').checked).toBe(true)
    expect(isDirty('appearance')).toBe(true)
  })

  it('signing out discards the unsaved font, and the next account starts from its own saved font', async () => {
    await seedSettings({ interface_font: 'open-sans' }, USER)
    await seedSettings({ interface_font: 'poppins' }, OTHER_USER)
    const first = renderNotebook(LOCAL_USER)
    await waitForRootFont('open-sans')
    openTab('appearance')
    chooseFont('sora')
    expect(rootFont()).toBe(stackOf('sora'))

    // Signing out unmounts the signed-in shell, including the draft.
    first.unmount()
    expect(rootFont()).toBe(stackOf('default'))

    renderNotebook(OTHER_LOCAL_USER)
    await waitForRootFont('poppins')
    openTab('appearance')

    expect(fontRadio('poppins').checked).toBe(true)
    expect(fontRadio('sora').checked).toBe(false)
    expect(isDirty('appearance')).toBe(false)
    expect((await persisted(USER)).interface_font).toBe('open-sans')
  })
})

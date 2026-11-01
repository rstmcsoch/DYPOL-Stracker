// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppData, AppSettings } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  updateSettings: vi.fn(),
  upsert: vi.fn(async () => undefined),
  notify: vi.fn()
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), updateSettings: harness.updateSettings, refresh: vi.fn(), syncState: 'local' })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', isLocal: true, email: '' }, signOut: vi.fn(), updatePassword: vi.fn() }) }))
vi.mock('../contexts/AppearanceContext', () => ({ useAppearancePreview: () => undefined, useReadingFontPreview: () => undefined }))
vi.mock('../components/ai/AISettingsSection', () => ({ AISettingsSection: () => null }))

const USER = '00000000-0000-4000-8000-000000000001'
const baseData = (settings: Partial<AppSettings> = {}): AppData => ({
  chapters: [], studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
  practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
  examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), user_id: USER, owner_name: 'Asha', ...settings }, profile: null
})
const renderSettings = async () => {
  const { default: SettingsPage } = await import('./SettingsPage')
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/settings']}><SettingsPage /></MemoryRouter></QueryClientProvider>)
}
const panel = (tab: string) => document.getElementById(`settings-panel-${tab}`) as HTMLElement
const openTab = (tab: string) => fireEvent.click(document.getElementById(`settings-tab-${tab}`) as HTMLElement)
const save = (tab: string) => fireEvent.click(within(panel(tab)).getByRole('button', { name: /^Save [\w ]*settings$/ }))

beforeEach(() => {
  harness.updateSettings.mockImplementation(async (updater: (current: AppSettings) => AppSettings) => updater(harness.data.settings))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })) })
})
afterEach(() => { cleanup(); harness.updateSettings.mockReset(); harness.upsert.mockClear(); harness.notify.mockClear() })

describe('Settings: student-POV phase 1', () => {
  it('item 11: an empty display name shows an inline error and is not saved', async () => {
    harness.data = baseData()
    await renderSettings()
    openTab('account')
    fireEvent.change(within(panel('account')).getByLabelText(/Display name/), { target: { value: '   ' } })
    save('account')
    expect(await within(panel('account')).findByText('Enter a display name.')).toBeTruthy()
    expect(harness.updateSettings).not.toHaveBeenCalled()
  })

  it('item 10: the daily goal must be at least 1 minute', async () => {
    harness.data = baseData()
    await renderSettings()
    openTab('rhythm')
    fireEvent.change(within(panel('rhythm')).getByLabelText(/Daily study goal/), { target: { value: '0' } })
    save('rhythm')
    expect(await within(panel('rhythm')).findByText('Set a daily goal of at least 1 minute.')).toBeTruthy()
    expect(harness.updateSettings).not.toHaveBeenCalled()
  })

  it('item 1: the exam date can be cleared, and extra exams can be added and saved', async () => {
    harness.data = baseData({ main_exam_date: '2027-01-22' })
    await renderSettings()
    openTab('exam')
    const exam = panel('exam')
    const clears = within(exam).getAllByRole('button', { name: /^Clear / })
    fireEvent.click(clears[0]!)
    fireEvent.click(within(exam).getByRole('button', { name: '+ Add exam' }))
    fireEvent.change(within(exam).getByLabelText('Exam 2 name'), { target: { value: 'BITSAT' } })
    fireEvent.change(within(exam).getByLabelText('BITSAT date'), { target: { value: '2027-05-20' } })
    save('exam')
    await vi.waitFor(() => expect(harness.updateSettings).toHaveBeenCalled())
    const updater = harness.updateSettings.mock.calls[0]![0] as (current: AppSettings) => AppSettings
    const next = updater(harness.data.settings)
    expect(next.extra_exams).toEqual([expect.objectContaining({ label: 'BITSAT', exam_date: '2027-05-20' })])
    expect(next.main_exam_date === null || next.main_exam_date === '').toBe(true)
  })

  it('item 1: an extra exam without a name is rejected inline', async () => {
    harness.data = baseData()
    await renderSettings()
    openTab('exam')
    fireEvent.click(within(panel('exam')).getByRole('button', { name: '+ Add exam' }))
    save('exam')
    expect(await within(panel('exam')).findByRole('alert')).toBeTruthy()
    expect(harness.updateSettings).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AppData, StudySession } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'

const USER = '00000000-0000-4000-8000-000000000001'
const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn<(table: string, record: unknown) => Promise<undefined>>(async () => undefined),
  notify: vi.fn()
}))

vi.mock('../contexts/DataContext', () => ({ useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(), remove: vi.fn() }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: USER } }) }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../lib/exams/fetch-catalog', () => ({ fetchExamCatalog: vi.fn(async () => undefined) }))

function baseData(): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
    practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), user_id: USER, sound_enabled: false }, profile: null
  }
}

const T0 = new Date('2026-10-24T10:00:00.000Z').getTime()

async function mount(route = '/focus') {
  const { FocusProvider } = await import('../contexts/FocusContext')
  const { default: FocusPage } = await import('./FocusPage')
  const { FocusIndicator } = await import('../components/jee/FocusIndicator')
  return render(<MemoryRouter initialEntries={[route]}><FocusProvider><Routes>
    <Route path="/focus" element={<FocusPage />} />
    <Route path="/" element={<div><p>Home page</p><FocusIndicator /></div>} />
  </Routes></FocusProvider></MemoryRouter>)
}

const sessionsWritten = () => harness.upsert.mock.calls.filter(call => call[0] === 'study_sessions').map(call => call[1] as StudySession)
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
const click = async (name: RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(T0)
  sessionStorage.clear()
  harness.data = baseData()
})
afterEach(() => { cleanup(); vi.useRealTimers(); harness.upsert.mockClear(); harness.notify.mockClear() })

describe('Focus End / Exit flow', () => {
  it('shows live elapsed and remaining time that keeps counting across pause and resume', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(5 * 60_000)
    await click(/^Pause/)
    await advance(10 * 60_000) // paused time is not study time
    expect(screen.getByText('05:00', { selector: '.focus-elapsed-line strong' })).toBeTruthy()
    await click(/Resume focus/)
    await advance(3 * 60_000 + 42_000)
    const line = document.querySelector('.focus-elapsed-line')!.textContent
    expect(line).toContain('Elapsed 08:42')
    expect(line).toContain('Remaining 16:18')
    expect(sessionsWritten()).toHaveLength(0) // pause never ends the session
  })

  it('End → Save logs one interrupted session with the real elapsed minutes, even if pressed twice', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(18 * 60_000)
    await click(/End focus block/)
    expect(screen.getByRole('dialog', { name: /Save 18 min of study time\?/ })).toBeTruthy()
    await click(/Save & end/)
    await act(async () => { await Promise.resolve() })
    const written = sessionsWritten()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ duration_minutes: 18, mode: 'Pomodoro', activity: 'Practice' })
    expect(written[0]?.completion_state).toBe('interrupted')
    // The block is gone; End is no longer offered and nothing else is written.
    expect(screen.queryByRole('button', { name: /End focus block/ })).toBeNull()
    await advance(30 * 60_000)
    expect(sessionsWritten()).toHaveLength(1)
  })

  it('Discard & exit records nothing and leaves focus', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(7 * 60_000)
    await click(/Exit focus/)
    await click(/Discard & exit/)
    expect(screen.getByText('Home page')).toBeTruthy()
    expect(sessionsWritten()).toHaveLength(0)
    expect(document.querySelector('.home-focus-indicator')).toBeNull()
  })

  it('Keep studying closes the dialog and the timer keeps running; Esc opens the same single dialog', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(2 * 60_000)
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Escape' }) }) // Esc inside the dialog = keep studying
    await advance(300)
    expect(screen.queryAllByRole('dialog')).toHaveLength(0)
    expect(screen.getByText('Focus')).toBeTruthy()
    await advance(60_000)
    expect(document.querySelector('.focus-elapsed-line')!.textContent).toContain('Elapsed 03:')
    expect(sessionsWritten()).toHaveLength(0)
  })

  it('Save & exit lands on Home with no indicator; natural completion logs exactly once', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(25 * 60_000 + 500)
    const written = sessionsWritten()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ completion_state: 'completed', duration_minutes: 25 })
    // A finished block has nothing to save: Exit navigates straight away, no dialog, no second log.
    await click(/Exit focus/)
    expect(screen.getByText('Home page')).toBeTruthy()
    expect(sessionsWritten()).toHaveLength(1)
  })

  it('Home shows the active block while away and offers Resume', async () => {
    const view = await mount()
    await click(/Begin focus/)
    await advance(4 * 60_000)
    await click(/^Pause/)
    view.unmount()
    await mount('/')
    const indicator = screen.getByRole('status', { name: /Focus paused · 4 min/ })
    expect(indicator.textContent).toContain('Resume')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume' })) })
    expect(document.querySelector('.focus-elapsed-line')!.textContent).toContain('Elapsed 04:00')
  })

  it('switching mode with unsaved time asks first instead of silently saving', async () => {
    await mount()
    await click(/Begin focus/)
    await advance(6 * 60_000)
    await click(/^Pause/)
    await click(/Short break/)
    expect(screen.getByRole('dialog', { name: /Save 6 min/ })).toBeTruthy()
    expect(sessionsWritten()).toHaveLength(0)
    await click(/Save & end/)
    expect(sessionsWritten()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Short break/ }).getAttribute('aria-pressed')).toBe('true')
  })
})

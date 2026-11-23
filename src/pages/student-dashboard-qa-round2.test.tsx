// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, Chapter, Mistake, StudySession } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { indiaToday, plusDays } from '../lib/date'
import { hoursViewKey, loadHoursView, saveHoursView } from '../lib/analytics-prefs'
import { retryQueue } from '../lib/mistake-cause'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn(async () => undefined),
  notify: vi.fn(),
  userId: 'user-qa-2'
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: harness.userId, isLocal: true } }) }))

const USER = '00000000-0000-4000-8000-000000000001'
const PHY = '00000000-0000-4000-8000-0000000000a1'
const NOW = '2026-10-08T06:00:00.000Z'
const TODAY = indiaToday()
const chapter = (id: string, name: string, subject = 'Physics'): Chapter => ({
  id, user_id: USER, subject, name, position: 0, status: 'Studying', priority: 'Medium',
  importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW
})
const mistake = (overrides: Partial<Mistake> = {}): Mistake => ({
  id: '00000000-0000-4000-8000-0000000000c9', user_id: USER, chapter_id: PHY, test_id: null,
  mistake_type: 'Concept', question_note: 'Sign of work done', solution_note: '', image_path: null,
  retry_later: true, retry_status: 'pending', created_at: NOW, updated_at: NOW, ...overrides
})
const session = (overrides: Partial<StudySession> = {}): StudySession => ({
  id: 's1', user_id: USER, subject: 'Physics', chapter_id: PHY, started_at: `${TODAY}T04:00:00.000Z`,
  ended_at: `${TODAY}T05:00:00.000Z`, duration_minutes: 60, completion_state: 'completed', mode: 'Custom',
  activity: 'Practice', created_at: NOW, updated_at: NOW, ...overrides
})
const baseData = (overrides: Partial<AppData> = {}): AppData => ({
  chapters: [chapter(PHY, 'Probability', 'Maths')],
  studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
  tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
  backlogItems: [], testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER),
  settings: defaultSettings(USER), profile: null, ...overrides
})
const renderAt = (ui: React.ReactElement, route = '/') => render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)

afterEach(() => {
  cleanup()
  harness.upsert.mockClear()
  harness.notify.mockClear()
  localStorage.clear()
})

describe('Retry list includes every Retry later note', () => {
  const four = [
    mistake({ id: 'due-concept', question_note: 'Due concept', mistake_type: 'Concept', retry_due_on: TODAY }),
    mistake({ id: 'future-guess', question_note: 'Future guess', mistake_type: 'Guess', retry_due_on: plusDays(TODAY, 7) }),
    mistake({ id: 'due-guess', question_note: 'Due guess', mistake_type: 'Guess', retry_due_on: TODAY }),
    mistake({ id: 'future-silly', question_note: 'Future silly', mistake_type: 'Silly', retry_due_on: plusDays(TODAY, 14) })
  ]

  it('shares one source for the count and the list, including not-yet-due Guess notes', async () => {
    expect(retryQueue(four)).toHaveLength(4)
    harness.data = baseData({ mistakes: four })
    const { default: MistakesPage } = await import('./MistakesPage')
    renderAt(<MistakesPage />, '/mistakes?tab=retry')
    const tab = screen.getByRole('tab', { name: /Retry list/ })
    expect(tab.textContent).toMatch(/4/)
    expect(screen.getByRole('heading', { name: /4 questions on your retry list/i })).toBeTruthy()
    expect(screen.getByText('Due concept')).toBeTruthy()
    expect(screen.getByText('Future guess')).toBeTruthy()
    expect(screen.getByText('Due guess')).toBeTruthy()
    expect(screen.getByText('Future silly')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter mistake type'), { target: { value: 'Guess' } })
    expect(screen.getByText('Future guess')).toBeTruthy()
    expect(screen.getByText('Due guess')).toBeTruthy()
    expect(screen.queryByText('Due concept')).toBeNull()
    expect(screen.queryByText('Future silly')).toBeNull()
  })
})

describe('Add-task date chips', () => {
  it('sets Today, Tomorrow and +1 week from quick chips and still has a date picker', async () => {
    harness.data = baseData()
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner')
    fireEvent.click(screen.getAllByRole('button', { name: /Add task/ })[0]!)
    const dialog = screen.getByRole('dialog')
    const picker = within(dialog).getByLabelText(/^Date/) as HTMLInputElement
    expect(picker.type).toBe('date')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tomorrow' }))
    expect(picker.value).toBe(plusDays(TODAY, 1))
    fireEvent.click(within(dialog).getByRole('button', { name: '+1 week' }))
    expect(picker.value).toBe(plusDays(TODAY, 7))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Today' }))
    expect(picker.value).toBe(TODAY)
  })
})

describe('Analytics hours grouping and pinning', () => {
  it('persists Day/Week/Month grouping the same way as the range', () => {
    saveHoursView('user-qa-2', 'week')
    expect(localStorage.getItem(hoursViewKey('user-qa-2'))).toBe('week')
    expect(loadHoursView('user-qa-2')).toBe('week')
    expect(loadHoursView('someone-else')).toBe('day')
  })

  it('keeps the chosen grouping after a remount and does not duplicate a pinned chart', async () => {
    Element.prototype.scrollIntoView = () => {}
    harness.data = baseData({ sessions: [session()] })
    const { default: AnalyticsPage } = await import('./AnalyticsPage')
    const first = renderAt(<AnalyticsPage />, '/analytics')
    fireEvent.click(screen.getByRole('button', { name: 'week' }))
    expect(loadHoursView('user-qa-2')).toBe('week')
    first.unmount()
    renderAt(<AnalyticsPage />, '/analytics')
    expect(screen.getByRole('button', { name: 'week' }).className).toContain('active')
    const studyPins = screen.getAllByRole('button', { name: /Pin Study hours/i })
    expect(studyPins).toHaveLength(1)
    fireEvent.click(studyPins[0]!)
    // Favourites holds the only copy; the lower grid no longer repeats it.
    expect(screen.getAllByRole('heading', { name: 'Study hours' })).toHaveLength(1)
    expect(screen.getByLabelText('Favourite charts')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Unpin Study hours/i })).toBeTruthy()
  })
})

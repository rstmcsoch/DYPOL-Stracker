// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { AppData, Chapter, TestRecord } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { indiaToday, plusDays } from '../lib/date'
import { hasChapterNote } from '../lib/syllabus'
import { HomeSnapshot } from '../components/jee/HomeSnapshot'
import { buildWeeklyReport, weekPractice } from '../lib/jee/weekly-report'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn(async () => undefined),
  upsertMany: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  notify: vi.fn()
}))

vi.mock('../contexts/DataContext', () => ({
  useData: () => ({
    data: harness.data, upsert: harness.upsert, upsertMany: harness.upsertMany, remove: harness.remove,
    refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false,
    undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn(),
    updateSettings: vi.fn(async () => undefined)
  })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', isLocal: true, email: '' }, signOut: vi.fn() }) }))
vi.mock('../contexts/AppearanceContext', () => ({ useAppearancePreview: () => undefined, useReadingFontPreview: () => undefined }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-11-23T06:00:00.000Z'
const TODAY = indiaToday()

const chapter = (id: string, name: string, overrides: Partial<Chapter> = {}): Chapter => ({
  id, user_id: USER, subject: 'Maths', name, position: 0, status: 'Not Started', priority: 'Medium',
  importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null,
  created_at: NOW, updated_at: NOW, ...overrides
})

const test = (id: string, overrides: Partial<TestRecord> = {}): TestRecord => ({
  id, user_id: USER, title: `Test ${id}`, test_date: TODAY, test_type: 'Subject Test', subject: 'Maths',
  chapter_id: 'calc', marks_obtained: 62, total_marks: 100, correct: null, wrong: null, skipped: null,
  negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW, ...overrides
} as TestRecord)

function baseData(overrides: Partial<AppData> = {}): AppData {
  return {
    chapters: [chapter('calc', 'Calculus'), chapter('alg', 'Algebra')],
    revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [],
    goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [],
    studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER),
    settings: { ...defaultSettings(USER), user_id: USER, owner_name: 'Asha' }, profile: null, ...overrides
  }
}

afterEach(() => {
  cleanup()
  harness.upsert.mockClear(); harness.upsertMany.mockClear(); harness.remove.mockClear(); harness.notify.mockClear()
})

describe('Home latest-test empty state', () => {
  it('shows the most recent test instead of “No tests yet.” when older tests exist', async () => {
    harness.data = baseData({
      tests: Array.from({ length: 10 }, (_, index) => test(`t${index + 1}`, {
        test_date: plusDays(TODAY, -(index + 1)),
        title: index === 0 ? 'Maths subject test' : `Older test ${index + 1}`,
        created_at: `2026-11-0${Math.min(9, index + 1)}T06:00:00.000Z`,
        updated_at: `2026-11-0${Math.min(9, index + 1)}T06:00:00.000Z`
      }))
    })
    const { default: HomePage } = await import('./HomePage')
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <HomePage /> }], { initialEntries: ['/'] })} />)
    expect(screen.queryByText('No tests yet.')).toBeNull()
    const card = document.querySelector('.quick-test-card') as HTMLElement
    expect(within(card).getByText('Maths subject test')).toBeTruthy()
    expect(within(card).getByText('LATEST TEST')).toBeTruthy()
  })
})

describe('Home this-week questions share Analytics’ source', () => {
  it('ignores last-week practice so Home and Analytics both show 0 this week', () => {
    const data = baseData({
      practiceSessions: [{
        id: 'p-old', user_id: USER, chapter_id: 'calc', practice_date: plusDays(TODAY, -14),
        attempted: 75, correct: 50, incorrect: 25, source: 'DPP', time_minutes: 60, notes: '',
        created_at: NOW, updated_at: NOW
      }]
    })
    expect(weekPractice(data, TODAY).attempted).toBe(0)
    expect(buildWeeklyReport(data, TODAY).questionsAttempted).toBe(0)
    harness.data = data
    render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <HomeSnapshot /> }], { initialEntries: ['/'] })} />)
    const list = screen.getByRole('list')
    const questions = within(list).getAllByRole('listitem').find(item => item.textContent?.includes('Questions'))
    expect(questions?.querySelector('strong')?.textContent).toBe('0')
  })
})

describe('Subject tests need a chapter', () => {
  it('blocks saving a Subject Test with no chapter and explains why', async () => {
    harness.data = baseData()
    const { default: TestsPage } = await import('./TestsPage')
    render(<RouterProvider router={createMemoryRouter([{ path: '/tests', element: <TestsPage /> }], { initialEntries: ['/tests?add=1'] })} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Test title/), { target: { value: 'Maths subject test' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Test type/ }), { target: { value: 'Subject Test' } })
    fireEvent.change(within(dialog).getByLabelText(/Marks obtained/), { target: { value: '62' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save test' }))
    expect(await within(dialog).findByText('Choose a chapter so this result can appear in Weak areas.')).toBeTruthy()
    expect(harness.upsert).not.toHaveBeenCalled()
    expect(harness.notify).not.toHaveBeenCalled()
  })

  it('still lists an existing Subject Test that has no chapter', async () => {
    harness.data = baseData({ tests: [test('legacy', { chapter_id: null, title: 'Legacy subject test' })] })
    const { default: TestsPage } = await import('./TestsPage')
    render(<RouterProvider router={createMemoryRouter([{ path: '/tests', element: <TestsPage /> }], { initialEntries: ['/tests'] })} />)
    expect(screen.getByRole('button', { name: /^Legacy subject test/ })).toBeTruthy()
  })
})

describe('test detail URL', () => {
  it('keeps ?view= in the URL, survives a remount, and closes on back', async () => {
    harness.data = baseData({ tests: [test('t9', { title: 'Waves sprint' })] })
    const { default: TestsPage } = await import('./TestsPage')
    const router = createMemoryRouter(
      [{ path: '/tests', element: <TestsPage /> }],
      { initialEntries: ['/tests', '/tests?view=t9'], initialIndex: 1 }
    )
    const { unmount } = render(<RouterProvider router={router} />)
    expect(await screen.findByRole('dialog', { name: /Waves sprint/ })).toBeTruthy()
    expect(router.state.location.search).toBe('?view=t9')

    unmount()
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('dialog', { name: /Waves sprint/ })).toBeTruthy()
    expect(router.state.location.search).toBe('?view=t9')

    await router.navigate(-1)
    expect(router.state.location.search).toBe('')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Waves sprint/ })).toBeNull())
  })
})

describe('Syllabus search, studying tile and note mark', () => {
  it('treats an emptied search field as a cleared filter', async () => {
    harness.data = baseData()
    const { default: SyllabusPage } = await import('./SyllabusPage')
    render(<RouterProvider router={createMemoryRouter([{ path: '/syllabus', element: <SyllabusPage /> }], { initialEntries: ['/syllabus'] })} />)
    const input = screen.getByLabelText('Search chapters and notes')
    fireEvent.change(input, { target: { value: 'Calculus' } })
    expect(screen.queryByText('Algebra')).toBeNull()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Calculus')).toBeTruthy()
    expect(screen.getByText('Algebra')).toBeTruthy()
  })

  it('counts Studying chapters on the subject tile and marks rows that have a note', async () => {
    expect(hasChapterNote({ notes: '  ', formula_notes: '' })).toBe(false)
    expect(hasChapterNote({ notes: 'Integration by parts', formula_notes: '' })).toBe(true)
    harness.data = baseData({
      chapters: [
        chapter('calc', 'Calculus', { status: 'Studying', notes: 'Integration by parts' }),
        chapter('alg', 'Algebra', { status: 'Not Started' })
      ]
    })
    const { default: SyllabusPage } = await import('./SyllabusPage')
    render(<RouterProvider router={createMemoryRouter([{ path: '/syllabus', element: <SyllabusPage /> }], { initialEntries: ['/syllabus'] })} />)
    expect(screen.getByText(/1 studying/)).toBeTruthy()
    const calcRow = document.getElementById('chapter-row-calc') as HTMLElement
    expect(within(calcRow).getByLabelText('Has a note')).toBeTruthy()
    const algRow = document.getElementById('chapter-row-alg') as HTMLElement
    expect(within(algRow).queryByLabelText('Has a note')).toBeNull()
  })
})

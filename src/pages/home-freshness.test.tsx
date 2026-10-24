// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { AppData, Chapter, TestRecord } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { indiaToday } from '../lib/date'
import { countUntestedChapters, latestTestOn } from '../lib/analytics'
import { recommendStudyNow } from '../lib/jee/recommend'

const harness = vi.hoisted(() => ({ data: null as unknown as AppData }))

vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: vi.fn(async () => undefined), upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-24T08:00:00.000Z'
const chapter = (id: string): Chapter => ({ id, user_id: USER, subject: 'Physics', name: `Chapter ${id}`, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const test = (id: string, overrides: Partial<TestRecord> = {}): TestRecord => ({
  id, user_id: USER, title: `Test ${id}`, test_date: indiaToday(), test_type: 'Chapter Test', subject: 'Physics', chapter_id: null,
  marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '',
  created_at: NOW, updated_at: NOW, ...overrides
} as TestRecord)

function baseData(overrides: Partial<AppData> = {}): AppData {
  return {
    chapters: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(chapter), revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), main_exam_date: '2027-01-20' }, profile: null, ...overrides
  }
}

function Where() { const location = useLocation(); return <output data-testid="where">{location.pathname}{location.search}</output> }

async function renderHome() {
  const { default: HomePage } = await import('./HomePage')
  const tree = () => <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomePage />} /><Route path="/tests" element={<Where />} /></Routes></MemoryRouter>
  const view = render(tree())
  return { ...view, rerenderHome: () => view.rerender(tree()) }
}

afterEach(cleanup)

describe('Home reflects a newly saved test', () => {
  it('a test without a score still counts its chapter as tested', () => {
    const before = baseData()
    expect(countUntestedChapters(before)).toBe(6)
    expect(countUntestedChapters({ ...before, tests: [test('t1', { chapter_id: 'c1' })] })).toBe(5)
    expect(countUntestedChapters({ ...before, testChapterLinks: [{ id: 'l1', user_id: USER, test_id: 't1', chapter_id: 'c2', marks_obtained: null, total_marks: null, created_at: NOW, updated_at: NOW } as AppData['testChapterLinks'][number]] })).toBe(5)
  })

  it('updates the untested tip and turns the checkpoint into today’s test after a save', async () => {
    harness.data = baseData()
    const { rerenderHome, container } = await renderHome()
    expect(screen.getByText(/You have 6 untested chapters/)).toBeTruthy()
    expect(screen.getByText('How did the practice go?')).toBeTruthy()

    harness.data = baseData({ tests: [test('t1', { title: 'Kinematics quiz', chapter_id: 'c1', marks_obtained: 36, total_marks: 50 })] })
    rerenderHome()
    expect(screen.getByText(/You have 5 untested chapters/)).toBeTruthy()
    const card = container.querySelector('.quick-test-card') as HTMLElement
    expect(within(card).getByText('Kinematics quiz')).toBeTruthy()
    expect(within(card).getByText(/36 \/ 50 · 72%/)).toBeTruthy()
    expect(within(card).getByText(/TODAY’S CHECKPOINT/)).toBeTruthy()
    expect(within(card).getByRole('button', { name: /Add another test/ })).toBeTruthy()
    within(card).getByRole('button', { name: /View it/ }).click()
    expect((await screen.findByTestId('where')).textContent).toBe('/tests?view=t1')
  })

  it('says the score is unknown instead of inventing one, and ignores tests from other days', async () => {
    harness.data = baseData({ tests: [test('old', { test_date: '2020-01-01', title: 'Old mock', created_at: '2026-10-24T09:00:00.000Z', updated_at: '2026-10-24T09:00:00.000Z' }), test('t2', { title: 'Optics drill' })] })
    const { container } = await renderHome()
    const card = container.querySelector('.quick-test-card') as HTMLElement
    expect(within(card).getByText('Optics drill')).toBeTruthy()
    expect(within(card).getByText(/Score not recorded/)).toBeTruthy()
    expect(latestTestOn(harness.data, '2020-01-01')?.id).toBe('old')
  })

  it('the empty recommendation acknowledges a test logged today', () => {
    const data = baseData({ chapters: [], tests: [test('t1')] })
    data.chapters = [chapter('c1')]
    expect(recommendStudyNow(data, indiaToday()).emptyReason).toMatch(/Today’s test is logged/)
    expect(recommendStudyNow({ ...data, tests: [] }, indiaToday()).emptyReason).toMatch(/Log a practice block or a test/)
  })
})

describe('Test rows show the skipped count honestly', () => {
  it('shows a recorded 0 as 0 and an unknown value as a dash', async () => {
    harness.data = baseData({ tests: [
      test('zero', { title: 'Zero skipped', correct: 20, wrong: 5, skipped: 0 }),
      test('unknown', { title: 'Unknown skipped', correct: 18, wrong: 2, skipped: null })
    ] })
    const { default: TestsPage } = await import('./TestsPage')
    render(<MemoryRouter initialEntries={['/tests']}><TestsPage /></MemoryRouter>)
    const zeroRow = screen.getByRole('button', { name: /^Zero skipped/ }).closest('tr') as HTMLElement
    const unknownRow = screen.getByRole('button', { name: /^Unknown skipped/ }).closest('tr') as HTMLElement
    expect(within(zeroRow).getByText('20 correct · 5 wrong · 0 skipped')).toBeTruthy()
    expect(within(unknownRow).getByText('18 correct · 2 wrong · — skipped')).toBeTruthy()
  })

  it('opens a test straight from ?view=', async () => {
    harness.data = baseData({ tests: [test('t9', { title: 'Waves sprint', skipped: 3 })] })
    const { default: TestsPage } = await import('./TestsPage')
    render(<MemoryRouter initialEntries={['/tests?view=t9']}><TestsPage /></MemoryRouter>)
    expect(await screen.findByRole('dialog', { name: /Waves sprint/ })).toBeTruthy()
  })
})

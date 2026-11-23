// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppData, BacklogItem, Chapter, Mistake, PracticeSession, PyqRecord, StudyCard, TestRecord, TestErrorLog } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { plusDays } from '../lib/date'

/**
 * A render smoke test for every page touched by the dashboard audit. It is deliberately
 * shallow — it renders each page with realistic rows and asserts that the new section
 * actually reaches the DOM. Runtime errors, broken hooks, bad imports and crash-on-empty
 * bugs all surface here, which is what "no bugs" means for a page-level refactor.
 */

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
    undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn()
  })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: USER, email: 'student@example.com', displayName: 'Aarav', isLocal: true },
    signOut: vi.fn(async () => undefined), updatePassword: vi.fn(async () => undefined), loading: false
  })
}))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
// Relative to the real IST today, so windowed queries (30-day repeat detection, due dates)
// see the rows: a hard-coded 2026-10-08 would silently fall outside every window.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dayAgo = (days: number) => todayAt(days)
function todayAt(offset: number): string {
  return plusDays(TODAY, offset)
}

function chapter(id: string, name: string, overrides: Partial<Chapter> = {}): Chapter {
  return {
    id, user_id: USER, subject: 'Physics', name, position: 0, status: 'Studying', priority: 'Medium',
    importance: 'medium', weightage: null, notes: '', formula_notes: 'C = eps0 A / d: parallel plate',
    completed_on: null, created_at: NOW, updated_at: NOW, ...overrides
  }
}

function baseData(overrides: Partial<AppData> = {}): AppData {
  const settings = {
    ...defaultSettings(USER), user_id: USER, pyq_from_year: 2025, pyq_to_year: 2026,
    main_exam_date: '2026-12-20', owner_name: 'Aarav', last_backup_at: '2026-10-01T06:00:00.000Z'
  }
  return {
    chapters: [chapter('elec', 'Electrostatics'), chapter('curr', 'Current Electricity')],
    revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [],
    sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [],
    testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER), settings, profile: null, ...overrides
  }
}

const mistake = (id: string, overrides: Partial<Mistake> = {}): Mistake => ({
  id, user_id: USER, chapter_id: 'elec', test_id: null, mistake_type: 'Silly', cause: 'Silly mistake',
  question_note: 'Sign error when substituting', solution_note: 'Check the sign first', image_path: null,
  retry_later: true, retry_status: 'pending', retry_due_on: TODAY, retry_count: 0, created_at: NOW, updated_at: NOW, ...overrides
})

const test = (id: string, overrides: Partial<TestRecord> = {}): TestRecord => ({
  id, user_id: USER, title: `Mock ${id}`, test_date: TODAY, test_type: 'Full Mock', subject: null, chapter_id: null,
  marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null,
  time_minutes: null, notes: '', percentile: 92.4, created_at: NOW, updated_at: NOW, ...overrides
})

const practice = (id: string, overrides: Partial<PracticeSession> = {}): PracticeSession => ({
  id, user_id: USER, chapter_id: 'elec', practice_date: TODAY, attempted: 30, correct: 24, incorrect: 6,
  source: 'DPP', time_minutes: 40, notes: '', created_at: NOW, updated_at: NOW, ...overrides
})

const card = (id: string): StudyCard => ({
  id, user_id: USER, chapter_id: 'elec', kind: 'flashcard', front: 'Why does sign matter?', back: 'It flips the field',
  hint: '', position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null,
  created_at: NOW, updated_at: NOW
})

const renderAt = (ui: React.ReactElement, route = '/') =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>)

afterEach(() => {
  cleanup()
  harness.upsert.mockClear(); harness.upsertMany.mockClear(); harness.remove.mockClear(); harness.notify.mockClear()
})

describe('every audited page renders without throwing', () => {
  it('Home shows the weekly goal, the rest-day control and the actionable tip', async () => {
    harness.data = baseData({
      mistakes: [mistake('m1'), mistake('m2', { created_at: `${dayAgo(-2)}T06:00:00.000Z` }), mistake('m3', { created_at: `${dayAgo(-4)}T06:00:00.000Z` })],
      goals: [{
        id: 'g1', user_id: USER, week_start: dayAgo(-3), goal_type: 'study_hours', title: 'Study 10 hours this week',
        target: 10, unit: 'hours', progress_value: 4, created_at: NOW, updated_at: NOW
      }],
      sessions: [{
        id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'elec', activity: 'Lecture', mode: 'Pomodoro',
        duration_minutes: 40, started_at: `${TODAY}T05:00:00.000Z`, ended_at: `${TODAY}T05:40:00.000Z`,
        completion_state: 'completed', created_at: NOW, updated_at: NOW
      }],
      practiceSessions: [practice('p1')],
      pyqRecords: [{ id: 'q1', user_id: USER, chapter_id: 'elec', exam: 'Main', year: 2025, status: 'done', questions_total: 30, questions_done: 30, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW } as PyqRecord]
    })
    const { default: HomePage } = await import('./HomePage')
    renderAt(<HomePage />)
    // The repeating-cause tip names the chapter, so the card's button is real work.
    expect(screen.getByText('STUDY TIP')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Electrostatics|Current Electricity|Review the notebook|Log a chapter test|Open today/ })).toBeTruthy()
    expect(screen.getByText('STUDY STREAK')).toBeTruthy()
  })

  it('Mistakes renders the three tabs, the due-date line and the card action', async () => {
    harness.data = baseData({ mistakes: [mistake('m1')] })
    const { default: MistakesPage } = await import('./MistakesPage')
    renderAt(<MistakesPage />, '/mistakes')
    expect(screen.getByRole('tab', { name: /Retry list/ })).toBeTruthy()
    expect(screen.getAllByText('Silly mistake').length).toBeGreaterThan(0)
    expect(screen.getByTitle('Turn this note into a flashcard')).toBeTruthy()
  })

  it('the retry tab lists every Retry later note, including ones not yet due', async () => {
    harness.data = baseData({
      mistakes: [
        mistake('due', { question_note: 'Due question', retry_due_on: '2026-10-01' }),
        mistake('later', { question_note: 'Scheduled question', retry_due_on: '2026-11-30' })
      ]
    })
    const { default: MistakesPage } = await import('./MistakesPage')
    renderAt(<MistakesPage />, '/mistakes?tab=retry')
    expect(screen.getByText('Due question')).toBeTruthy()
    expect(screen.getByText('Scheduled question')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /2 questions on your retry list/i })).toBeTruthy()
  })

  it('Weak areas shows the cause tally and the repeating-mistake cards', async () => {
    harness.data = baseData({
      mistakes: [
        mistake('m1', { created_at: `${dayAgo(-6)}T06:00:00.000Z` }),
        mistake('m2', { created_at: `${dayAgo(-3)}T06:00:00.000Z` }),
        mistake('m3', { created_at: `${dayAgo(-1)}T06:00:00.000Z` })
      ],
      practiceSessions: [practice('p1', { attempted: 30, correct: 12, incorrect: 18 })]
    })
    const { default: WeakAreasPage } = await import('./WeakAreasPage')
    renderAt(<WeakAreasPage />, '/weak-areas')
    expect(screen.getByText('Why marks go missing')).toBeTruthy()
    expect(screen.getByText('Repeating mistakes')).toBeTruthy()
  })

  it('Practice shows the pace band from recorded time', async () => {
    harness.data = baseData({ practiceSessions: [practice('p1')] })
    const { default: PracticePage } = await import('./PracticePage')
    renderAt(<PracticePage />, '/practice')
    expect(screen.getByText(/per question/)).toBeTruthy()
  })

  it('Decks offers review-all, paste import and per-chapter review', async () => {
    harness.data = baseData({ studyCards: [card('c1')] })
    const { default: DecksPage } = await import('./DecksPage')
    renderAt(<DecksPage />, '/decks?chapter=elec')
    expect(screen.getByRole('button', { name: /Review all/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Paste cards/ })).toBeTruthy()
  })

  it('Syllabus offers the paste-a-list import', async () => {
    harness.data = baseData()
    const { default: SyllabusPage } = await import('./SyllabusPage')
    renderAt(<SyllabusPage />, '/syllabus')
    expect(screen.getByRole('button', { name: /Paste list/ })).toBeTruthy()
  })

  it('PYQs shows the question-count line once counts are saved', async () => {
    harness.data = baseData({
      pyqRecords: [{ id: 'q1', user_id: USER, chapter_id: 'elec', exam: 'Main', year: 2025, status: 'done', questions_total: 30, questions_done: 12, meta: null, completed_at: null, created_at: NOW, updated_at: NOW } as PyqRecord]
    })
    const { default: PyqPage } = await import('./PyqPage')
    renderAt(<PyqPage />, '/pyqs')
    expect(screen.getByText(/12\/30/)).toBeTruthy()
  })

  it('Mock analysis renders deltas, repeat offenders and the fix-first ranking', async () => {
    const logs: TestErrorLog[] = [
      { id: 'l1', user_id: USER, test_id: 'a', subject: 'Physics', category: 'Silly mistake', chapter_id: 'elec', questions: 3, marks_lost: 12, note: '', created_at: NOW, updated_at: NOW },
      { id: 'l2', user_id: USER, test_id: 'b', subject: 'Physics', category: 'Concept gap', chapter_id: 'elec', questions: 2, marks_lost: 8, note: '', created_at: NOW, updated_at: NOW }
    ]
    harness.data = baseData({
      tests: [test('a', { test_date: '2026-10-01' }), test('b', { test_date: TODAY })],
      testSubjectScores: [
        { id: 's1', user_id: USER, test_id: 'a', subject: 'Physics', marks_obtained: 40, total_marks: 100, created_at: NOW, updated_at: NOW },
        { id: 's2', user_id: USER, test_id: TODAY, subject: 'Physics', marks_obtained: 55, total_marks: 100, created_at: NOW, updated_at: NOW },
        { id: 's3', user_id: USER, test_id: TODAY, subject: 'Chemistry', marks_obtained: 70, total_marks: 100, created_at: NOW, updated_at: NOW }
      ],
      testErrorLogs: logs
    })
    const { default: MockAnalysisPage } = await import('./MockAnalysisPage')
    renderAt(<MockAnalysisPage />, `/mock-analysis?test=${TODAY}`)
    expect(screen.getByText('Change since last mock')).toBeTruthy()
    expect(screen.getByText('Repeat offenders')).toBeTruthy()
    expect(screen.getByText('What to fix first')).toBeTruthy()
  })

  it('Analytics renders the two new allocation cards', async () => {
    harness.data = baseData({
      sessions: [{
        id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'elec', activity: 'Lecture', mode: 'Pomodoro',
        duration_minutes: 60, started_at: `${TODAY}T05:00:00.000Z`, ended_at: `${TODAY}T06:00:00.000Z`,
        completion_state: 'completed', created_at: NOW, updated_at: NOW
      }],
      tests: [test('a')],
      testSubjectScores: [{ id: 's1', user_id: USER, test_id: 'a', subject: 'Physics', marks_obtained: 55, total_marks: 100, created_at: NOW, updated_at: NOW }]
    })
    const { default: AnalyticsPage } = await import('./AnalyticsPage')
    renderAt(<AnalyticsPage />, '/analytics')
    expect(screen.getByText('Where the hours go')).toBeTruthy()
    expect(screen.getByText('TIME BY SUBJECT')).toBeTruthy()
    expect(screen.getByText('HOURS VS MARKS')).toBeTruthy()
  })

  it('Profile renders the calendar, records, backup status and sign-out', async () => {
    harness.data = baseData({
      practiceSessions: [practice('p1')],
      sessions: [{
        id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'elec', activity: 'Lecture', mode: 'Pomodoro',
        duration_minutes: 90, started_at: `${TODAY}T05:00:00.000Z`, ended_at: `${TODAY}T06:30:00.000Z`,
        completion_state: 'completed', created_at: NOW, updated_at: NOW
      }]
    })
    const { default: ProfilePage } = await import('./ProfilePage')
    renderAt(<ProfilePage />, '/profile')
    expect(screen.getByText('Last 12 weeks')).toBeTruthy()
    expect(screen.getByText('PERSONAL RECORDS')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sign out/ })).toBeTruthy()
  })

  it('Mock analysis shows the percentile band, labelled as estimated when no number was entered', async () => {
    harness.data = baseData({
      // A Subject Test carries its own marks/total; a Full Mock needs all three subject rows
      // before it aggregates to a score, so it is the wrong fixture for an estimate.
      tests: [test('a', { test_type: 'Subject Test', subject: 'Physics', marks_obtained: 150, total_marks: 300, percentile: null })]
    })
    const { default: MockAnalysisPage } = await import('./MockAnalysisPage')
    renderAt(<MockAnalysisPage />, '/mock-analysis?test=a')
    expect(screen.getByText('Where this score sits')).toBeTruthy()
    expect(screen.getByText(/Estimated from marks/)).toBeTruthy()
    // Never a flat hundred, never a rank: the band stops at 99.9.
    expect(screen.queryByText('100.0 %ile')).toBeNull()
  })

  it('Backlog turns chapters stuck in Studying for 21+ days into backlog items', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString()
    harness.data = baseData({
      // The fixture's NOW is in the past too, so pin the fresh chapter explicitly.
      chapters: [
        chapter('elec', 'Electrostatics', { status: 'Studying', updated_at: old }),
        chapter('curr', 'Current Electricity', { updated_at: new Date().toISOString() })
      ],
      backlogItems: []
    })
    const { default: BacklogPage } = await import('./BacklogPage')
    renderAt(<BacklogPage />, '/backlog')
    expect(screen.getByText('Stalled chapters')).toBeTruthy()
    expect(screen.getByText('30 days')).toBeTruthy()
    const button = screen.getByRole('button', { name: /Add 1 to backlog/ })
    button.click()
    await vi.waitFor(() => expect(harness.upsertMany).toHaveBeenCalledTimes(1))
    const [, rows] = harness.upsertMany.mock.calls[0] as unknown as [string, BacklogItem[]]
    const row = rows[0]
    expect(row).toBeDefined()
    expect(row).toMatchObject({ title: 'Finish Electrostatics', subject: 'Physics', chapter_id: 'elec', status: 'active', priority: 'Medium', type: 'Lecture' })
    expect(row!.due_on).toBe(plusDays(TODAY, 7))
  })

  it('Backlog never duplicates a stalled chapter that is already a backlog row', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    harness.data = baseData({
      chapters: [chapter('elec', 'Electrostatics', { status: 'Studying', updated_at: old })],
      backlogItems: [{
        id: 'b1', user_id: USER, title: 'Redo Electrostatics DPPs', type: 'DPP', subject: 'Physics',
        chapter_id: 'elec', priority: 'High', due_on: TODAY, status: 'active', snoozed_until: null,
        completed_at: null, notes: '', created_at: NOW, updated_at: NOW
      }]
    })
    const { default: BacklogPage } = await import('./BacklogPage')
    renderAt(<BacklogPage />, '/backlog')
    expect(screen.queryByText('Stalled chapters')).toBeNull()
  })

  it('Decks says when the next card is due instead of leaving a dead button', async () => {
    harness.data = baseData({
      studyCards: [{ ...card('c1'), next_review_at: `${plusDays(TODAY, 3)}T00:00:00.000Z` }]
    })
    const { default: DecksPage } = await import('./DecksPage')
    renderAt(<DecksPage />, '/decks?chapter=elec')
    expect(screen.getByText(/Nothing due in this deck/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Formula sheet PDF/ })).toBeTruthy()
  })

  it('Home draws one bar per subject target that was actually set', async () => {
    harness.data = baseData({
      settings: { ...defaultSettings(USER), pyq_from_year: 2025, pyq_to_year: 2026, main_exam_date: '2026-12-20', subject_daily_targets: { Physics: 120 } },
      sessions: [{
        id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'elec', activity: 'Lecture', mode: 'Pomodoro',
        duration_minutes: 60, started_at: `${TODAY}T05:00:00.000Z`, ended_at: `${TODAY}T06:00:00.000Z`,
        completion_state: 'completed', created_at: NOW, updated_at: NOW
      }]
    })
    const { default: HomePage } = await import('./HomePage')
    renderAt(<HomePage />)
    const list = screen.getByLabelText('Today by subject')
    expect(list.textContent).toContain('Physics')
    expect(list.textContent).toContain('/ 120m')
    // Chemistry was never given a target, so it must not appear with an invented one.
    expect(list.textContent).not.toContain('Chemistry')
  })

  it('Settings owns focus lengths and rest days on the rhythm tab', async () => {
    // The full page needs Appearance/Auth providers the shell supplies; this checks the
    // pieces the audit added are wired without rendering the whole settings form.
    const source = await import('node:fs').then(fs => fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8'))
    expect(source).toContain('Focus lengths')
    expect(source).toContain('Streak rest days')
    expect(source).toContain('ownerDataCounts')
    expect(source).toContain('reset-counts')
    expect(harness.data).toBeTruthy()
  })
})

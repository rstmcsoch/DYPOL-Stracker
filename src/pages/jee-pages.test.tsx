// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, Chapter, PyqRecord, StudyCard, BacklogItem, TestErrorLog, TestRecord, PracticeSession } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { pyqRecordId } from '../lib/jee/ids'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn(async () => undefined),
  upsertMany: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  notify: vi.fn()
}))

vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: harness.upsertMany, remove: harness.remove, refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const TODAY = '2026-10-08'

function chapter(id: string, name: string, overrides: Partial<Chapter> = {}): Chapter {
  return { id, user_id: USER, subject: 'Physics', name, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: 'C = eps0 A / d: parallel plate', completed_on: null, created_at: NOW, updated_at: NOW, ...overrides }
}

function baseData(overrides: Partial<AppData> = {}): AppData {
  const settings = { ...defaultSettings(USER), user_id: USER, pyq_from_year: 2025, pyq_to_year: 2026, main_exam_date: '2026-10-20' }
  return {
    chapters: [chapter('elec', 'Electrostatics'), chapter('curr', 'Current Electricity', { subject: 'Physics' })],
    revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
    practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER), settings, profile: null, ...overrides
  }
}

function renderPage(ui: React.ReactElement, route = '/') {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)
}

afterEach(() => {
  cleanup()
  harness.upsert.mockClear(); harness.upsertMany.mockClear(); harness.remove.mockClear(); harness.notify.mockClear()
})

describe('Practice log page', () => {
  it('logs a DPP block with the spec example numbers and mirrors minutes into study time', async () => {
    harness.data = baseData()
    const { default: PracticePage } = await import('./PracticePage')
    renderPage(<PracticePage />, '/practice?add=1')
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Chapter/ }), { target: { value: 'elec' } })
    fireEvent.change(within(dialog).getByLabelText(/^Attempted/), { target: { value: '120' } })
    fireEvent.change(within(dialog).getByLabelText(/^Correct/), { target: { value: '92' } })
    fireEvent.change(within(dialog).getByLabelText(/^Incorrect/), { target: { value: '28' } })
    fireEvent.change(within(dialog).getByLabelText(/Time spent/), { target: { value: '45' } })
    expect(within(dialog).getByText('76.7%')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Log practice/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledTimes(2))
    expect(harness.upsert).toHaveBeenNthCalledWith(1, 'practice_sessions', expect.objectContaining({ chapter_id: 'elec', attempted: 120, correct: 92, incorrect: 28, source: 'DPP', time_minutes: 45 }))
    expect(harness.upsert).toHaveBeenNthCalledWith(2, 'study_sessions', expect.objectContaining({ activity: 'Practice', duration_minutes: 45, chapter_id: 'elec' }))
  })

  it('refuses to save when correct + incorrect exceed attempted', async () => {
    harness.data = baseData()
    const { default: PracticePage } = await import('./PracticePage')
    renderPage(<PracticePage />, '/practice?add=1')
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Chapter/ }), { target: { value: 'elec' } })
    fireEvent.change(within(dialog).getByLabelText(/^Attempted/), { target: { value: '10' } })
    fireEvent.change(within(dialog).getByLabelText(/^Correct/), { target: { value: '8' } })
    fireEvent.change(within(dialog).getByLabelText(/^Incorrect/), { target: { value: '5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Log practice/ }))
    expect(await within(dialog).findByText(/cannot add up to more than attempted/)).toBeTruthy()
    expect(within(dialog).getAllByText(/cannot add up to more than attempted/)).toHaveLength(1)
    expect(harness.upsert).not.toHaveBeenCalled()
  })

  it('shows per-chapter accuracy and flags weak practice once there are enough questions', async () => {
    const sessions: PracticeSession[] = [{
      id: 'p1', user_id: USER, chapter_id: 'elec', practice_date: TODAY, attempted: 120, correct: 70, incorrect: 50,
      source: 'DPP', time_minutes: null, notes: '', created_at: NOW, updated_at: NOW
    }]
    harness.data = baseData({ practiceSessions: sessions })
    const { default: PracticePage } = await import('./PracticePage')
    renderPage(<PracticePage />)
    expect(screen.getAllByText('Practice weak').length).toBeGreaterThan(0)
    expect(screen.getAllByText('58%').length).toBeGreaterThan(0)
  })
})

describe('PYQ tracker page', () => {
  it('toggles a year with a deterministic record ID so repeat taps never duplicate rows', async () => {
    harness.data = baseData()
    const { default: PyqPage } = await import('./PyqPage')
    renderPage(<PyqPage />, '/pyqs')
    const chip = screen.getAllByRole('button', { name: /2025 pending/ })[0]!
    fireEvent.click(chip)
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledTimes(1))
    const [table, record] = harness.upsert.mock.calls[0] as unknown as [string, PyqRecord]
    expect(table).toBe('pyq_records')
    expect(record).toMatchObject({ chapter_id: 'elec', exam: 'Main', year: 2025, status: 'done' })
    expect(record.id).toBe(pyqRecordId(USER, 'elec', 'Main', 2025))
  })

  it('reports completion per exam from stored records', async () => {
    const records: PyqRecord[] = [2026, 2025].map(year => ({
      id: `r${year}`, user_id: USER, chapter_id: 'elec', exam: 'Main', year, status: 'done', questions_total: null,
      questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW
    }))
    harness.data = baseData({ pyqRecords: records })
    const { default: PyqPage } = await import('./PyqPage')
    renderPage(<PyqPage />, '/pyqs')
    expect(document.body.textContent).toContain('JEE Main PYQs: 2/2 complete')
  })
})

describe('Backlog page', () => {
  it('lists a skipped lecture as due and clears it on Mark done', async () => {
    const item: BacklogItem = {
      id: 'b1', user_id: USER, title: 'Physics — EMI Lecture 8', type: 'Lecture', subject: 'Physics', chapter_id: null, priority: 'High',
      due_on: '2026-10-01', status: 'active', snoozed_until: null, completed_at: null, notes: '', created_at: NOW, updated_at: NOW
    }
    harness.data = baseData({ backlogItems: [item] })
    const { default: BacklogPage } = await import('./BacklogPage')
    renderPage(<BacklogPage />, '/backlog')
    expect(screen.getAllByText('Physics — EMI Lecture 8').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Overdue/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Physics — EMI Lecture 8 done' }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('backlog_items', expect.objectContaining({ id: 'b1', status: 'done', completed_at: expect.any(String) }))
  })
})

describe('Formula & flashcard decks', () => {
  it('reviews a due card: reveal, then Known schedules it on the R1 ladder', async () => {
    const card: StudyCard = {
      id: 'c1', user_id: USER, chapter_id: 'elec', kind: 'formula', front: 'Capacitance', back: 'C = eps0 A / d', hint: '',
      position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW
    }
    harness.data = baseData({ studyCards: [card] })
    const { default: DecksPage } = await import('./DecksPage')
    renderPage(<DecksPage />, '/decks?chapter=elec')
    fireEvent.click(screen.getByRole('button', { name: /Review 1 due/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Reveal answer/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Known/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('study_cards', expect.objectContaining({ id: 'c1', reviews: 1, difficulty: 'known', next_review_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/) }))
  })
})

describe('Mock analysis page', () => {
  it('derives a "what to fix" insight from classified losses, labelled as derived', async () => {
    const test: TestRecord = {
      id: 'mock1', user_id: USER, title: 'Full Mock 3', test_date: TODAY, test_type: 'Full Mock', subject: null, chapter_id: null,
      marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
      notes: '', created_at: NOW, updated_at: NOW
    }
    const logs: TestErrorLog[] = [{ id: 'e', user_id: USER, test_id: 'mock1', chapter_id: null, subject: 'Maths', category: 'Time pressure', marks_lost: 21, questions: 7, note: '', created_at: NOW, updated_at: NOW }]
    harness.data = baseData({ tests: [test], testErrorLogs: logs })
    const { default: MockAnalysisPage } = await import('./MockAnalysisPage')
    renderPage(<MockAnalysisPage />, '/mock-analysis?test=mock1')
    expect(screen.getByText(/Maths lost 21 marks; 100% of that came from time pressure/)).toBeTruthy()
    expect(screen.getByText('Derived')).toBeTruthy()
  })

  it('does not invent time when none was recorded', async () => {
    const test: TestRecord = {
      id: 'mock2', user_id: USER, title: 'Mock 4', test_date: TODAY, test_type: 'Full Mock', subject: null, chapter_id: null,
      marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
      notes: '', created_at: NOW, updated_at: NOW
    }
    harness.data = baseData({ tests: [test] })
    const { default: MockAnalysisPage } = await import('./MockAnalysisPage')
    renderPage(<MockAnalysisPage />, '/mock-analysis?test=mock2')
    expect(screen.getByText(/No time or attempt data recorded/)).toBeTruthy()
  })
})

describe('What should I study now', () => {
  it('shows the top recommendation with its explanation', async () => {
    harness.data = baseData({
      chapters: [chapter('elec', 'Electrostatics', { priority: 'High', importance: 'high' })],
      revisions: [{ id: 'r', user_id: USER, chapter_id: 'elec', revision_number: 1, due_on: '2026-10-03', completed_at: null, created_at: NOW, updated_at: NOW }]
    })
    const { StudyNowCard } = await import('../components/jee/StudyNowCard')
    renderPage(<StudyNowCard />)
    expect(screen.getByText(/Study Electrostatics — revision is overdue by \d+ days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Why this\?/ }))
    expect(screen.getByText('Ranked highest because:')).toBeTruthy()
  })
})

describe('Dashboard snapshot', () => {
  it('shows raw and weighted completion side by side and the streak rule', async () => {
    harness.data = baseData({ chapters: [chapter('a', 'A', { status: 'Done', importance: 'high' }), chapter('b', 'B', { importance: 'low' })] })
    const { HomeSnapshot } = await import('../components/jee/HomeSnapshot')
    renderPage(<HomeSnapshot />)
    expect(screen.getByText('Raw completion')).toBeTruthy()
    expect(screen.getByText('Weighted completion')).toBeTruthy()
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
    expect(screen.getByText('80%')).toBeTruthy()
  })
})

describe('Weekly report', () => {
  it('says plainly when there is not enough history to compare', async () => {
    harness.data = baseData()
    const { WeeklyReportCard } = await import('../components/jee/WeeklyReportCard')
    renderPage(<WeeklyReportCard />)
    expect(screen.getByText(/Not enough history to compare/)).toBeTruthy()
  })
})

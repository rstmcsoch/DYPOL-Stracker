// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, parseISO, startOfWeek } from 'date-fns'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppData, Chapter, DailyTask, PyqRecord, TestErrorLog, TestRecord, TestSubjectScore, WeeklyGoal } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { DateInput, TimeInput } from '../components/DateTimeInputs'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn<(table: string, record: unknown) => Promise<undefined>>(async () => undefined),
  upsertMany: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  notify: vi.fn()
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: harness.upsertMany, remove: harness.remove, refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), saveImage: vi.fn(), updateSettings: vi.fn(async () => undefined) })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', isLocal: true, email: '' }, signOut: vi.fn() }) }))
vi.mock('../lib/report', () => ({ createPdfReport: vi.fn(), createDocxReport: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: null }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const chapter = (id: string, name: string, subject = 'Physics'): Chapter => ({ id, user_id: USER, subject, name, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const baseData = (overrides: Partial<AppData> = {}): AppData => ({
  chapters: [chapter('elec', 'Electrostatics')],
  studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
  practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
  examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), user_id: USER, owner_name: 'Asha' }, profile: null, ...overrides
})
const renderAt = (ui: React.ReactElement, route = '/') => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>)
const paste = (element: Element, text: string) => fireEvent.paste(element, { clipboardData: { getData: () => text } })

afterEach(() => { cleanup(); harness.upsert.mockClear(); harness.upsertMany.mockClear(); harness.remove.mockClear(); harness.notify.mockClear() })

describe('item 1: DateInput', () => {
  it('Clear empties the date', () => {
    const onChange = vi.fn()
    render(<DateInput label="Exam date" value="2027-01-22" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Exam date' }))
    expect(onChange).toHaveBeenCalledWith('')
  })
  it('accepts a pasted date and rejects a corrupted year inline', () => {
    const onChange = vi.fn()
    render(<DateInput label="Exam date" value="" onChange={onChange} />)
    const input = screen.getByLabelText('Exam date')
    expect(input.getAttribute('max')).toBe('2100-12-31')
    paste(input, '15/06/2025')
    expect(onChange).toHaveBeenLastCalledWith('2025-06-15')
    onChange.mockClear()
    paste(input, '50615-02-02')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/1900/)
  })
})

describe('item 2: TimeInput', () => {
  it('accepts typed and pasted times, and ArrowUp moves later', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TimeInput label="Reminder time" value="08:30" onChange={onChange} />)
    const input = screen.getByLabelText('Reminder time')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('08:35')
    rerender(<TimeInput label="Reminder time" value="08:35" onChange={onChange} />)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('08:30')
    paste(input, '8:30 pm')
    expect(onChange).toHaveBeenLastCalledWith('20:30')
    fireEvent.change(input, { target: { value: '7:05' } })
    expect(onChange).toHaveBeenLastCalledWith('07:05')
    fireEvent.change(input, { target: { value: 'soon' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toMatch(/08:30/)
  })
})

const task = (id: string, title: string, date: string): DailyTask => ({ id, user_id: USER, title, subject: null, chapter_id: null, estimated_minutes: 30, priority: 'Medium', is_completed: false, task_date: date, position: 0, created_at: NOW, updated_at: NOW })

describe('item 3: Planner date jump and Cmd+K task deep link', () => {
  it('opens a far-future task’s week and highlights the task with its edit and delete actions', async () => {
    harness.data = baseData({ tasks: [task('t1', 'Final revision', '2030-12-31')] })
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner?date=2030-12-31&task=t1')
    const row = document.getElementById('planner-task-t1') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.className).toContain('task-highlight')
    expect(within(row).getByText('Final revision')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Edit or reschedule task' })).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'Delete task' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it('jumps to any date from the week header', async () => {
    harness.data = baseData({ tasks: [task('t2', 'Mock prep', '2027-03-15')] })
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner')
    expect(screen.queryByText('Mock prep')).toBeNull()
    fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2027-03-15' } })
    expect(screen.getByText('Mock prep')).toBeTruthy()
  })
})

describe('item 4: Planner custom goal +', () => {
  it('the decorative doodle never intercepts clicks, and + saves progress', async () => {
    const css = readFileSync(resolve(__dirname, '../styles/base.css'), 'utf8')
    expect(css).toMatch(/\.goal-doodle\s*\{[^}]*pointer-events:\s*none/)
    const { indiaToday } = await import('../lib/date')
    const weekStart = format(startOfWeek(parseISO(`${indiaToday()}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const goal: WeeklyGoal = { id: 'g1', user_id: USER, goal_type: 'custom', title: 'Custom goal', target: 5, progress_value: 1, week_start: weekStart, unit: 'steps', created_at: NOW, updated_at: NOW } as WeeklyGoal
    harness.data = baseData({ goals: [goal] })
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Custom goal progress' }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledWith('weekly_goals', expect.objectContaining({ id: 'g1', progress_value: 2 })))
  })
})

describe('items 6 and 7: Tests form', () => {
  it('a Chapter Test cannot be saved without a chapter', async () => {
    harness.data = baseData()
    const { default: TestsPage } = await import('./TestsPage')
    renderAt(<TestsPage />, '/tests?add=1')
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Test title/), { target: { value: 'Unit test' } })
    fireEvent.change(within(dialog).getByLabelText(/Marks obtained/), { target: { value: '40' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save test' }))
    expect(await within(dialog).findByText('Choose the chapter this test covered.')).toBeTruthy()
    expect(harness.upsert).not.toHaveBeenCalled()
  })
  it('a Full Mock with full marks in every entered subject is complete; blank subjects are skipped', async () => {
    harness.data = baseData({ settings: { ...baseData().settings, exam_id: 'neet-ug' } })
    const { default: TestsPage } = await import('./TestsPage')
    renderAt(<TestsPage />, '/tests?add=1')
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Test title/), { target: { value: 'NEET mock' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Test type/ }), { target: { value: 'Full Mock' } })
    for (const subject of ['Physics', 'Chemistry', 'Botany']) {
      fireEvent.change(within(dialog).getByLabelText(`${subject} total marks`), { target: { value: '180' } })
      fireEvent.change(within(dialog).getByLabelText(`${subject} marks`), { target: { value: '180' } })
    }
    // Zoology is left blank, with its prefilled total untouched.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save test' }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledWith('tests', expect.objectContaining({ test_type: 'Full Mock', marks_obtained: 540, total_marks: 540 })))
    const scores = (harness.upsertMany.mock.calls as unknown as unknown[][]).find(call => call[0] === 'test_subject_scores')?.[1] as TestSubjectScore[]
    expect(scores.map(score => score.subject).sort()).toEqual(['Botany', 'Chemistry', 'Physics'])
    expect(scores.every(score => score.marks_obtained === 180 && score.total_marks === 180)).toBe(true)
  })
})

describe('item 5: Classify lost marks', () => {
  it('shows an inline error when classified marks exceed what the subject lost', async () => {
    const mock: TestRecord = { id: 'm1', user_id: USER, title: 'Mock 1', test_date: '2026-10-05', test_type: 'Full Mock', subject: null, chapter_id: null, marks_obtained: 150, total_marks: 200, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW }
    const scores: TestSubjectScore[] = [
      { id: 's1', user_id: USER, test_id: 'm1', subject: 'Physics', marks_obtained: 90, total_marks: 100, created_at: NOW, updated_at: NOW },
      { id: 's2', user_id: USER, test_id: 'm1', subject: 'Biology', marks_obtained: 60, total_marks: 100, created_at: NOW, updated_at: NOW }
    ]
    harness.data = baseData({ tests: [mock], testSubjectScores: scores, testErrorLogs: [] as TestErrorLog[] })
    const { default: MockAnalysisPage } = await import('./MockAnalysisPage')
    renderAt(<MockAnalysisPage />, '/mock-analysis?test=m1')
    fireEvent.click(screen.getByRole('button', { name: /Classify/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Subject/ }), { target: { value: 'Physics' } })
    expect(within(dialog).getByText(/10 marks left to classify in Physics/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Marks lost/), { target: { value: '80' } })
    expect(within(dialog).getByText(/Only 10 marks were lost in Physics/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Add classification/ }))
    expect(harness.upsert).not.toHaveBeenCalled()
  })
})

const pyq = (chapterId: string, year: number): PyqRecord => ({ id: `${chapterId}-${year}`, user_id: USER, chapter_id: chapterId, exam: 'Main', year, status: 'done', questions_total: null, questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW })

describe('item 8: a PYQ year marked done shows up', () => {
  it('on Home for a non-JEE exam and in the Analytics PYQs row', async () => {
    harness.data = baseData({ settings: { ...baseData().settings, exam_id: 'neet-ug', pyq_from_year: 2024, pyq_to_year: 2026 }, pyqRecords: [pyq('elec', 2025)] })
    const { HomeSnapshot } = await import('../components/jee/HomeSnapshot')
    renderAt(<HomeSnapshot />)
    expect(screen.getByText('PYQ chapter-years done').previousElementSibling?.textContent).toBe('1')
    expect(screen.getByText('PYQ years covered')).toBeTruthy()
    cleanup()
    const { LearningPipelineCard } = await import('../components/jee/LearningPipelineCard')
    renderAt(<LearningPipelineCard />)
    expect(screen.getByText('1 year done · 1 chapter started')).toBeTruthy()
  })
})

describe('item 12: Backup explains tests outside the report range', () => {
  it('says how many tests are skipped and why', async () => {
    const make = (id: string, date: string): TestRecord => ({ id, user_id: USER, title: id, test_date: date, test_type: 'Chapter Test', subject: 'Physics', chapter_id: 'elec', marks_obtained: 10, total_marks: 20, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW })
    harness.data = baseData({ tests: [make('a', '2026-01-10'), make('b', '2099-12-31')] })
    const { default: BackupPage } = await import('./BackupPage')
    renderAt(<BackupPage />, '/backup')
    expect(screen.getByText('2 test records in this notebook')).toBeTruthy()
    expect(screen.getAllByText(/1 of 2 tests fall in this range · 1 dated after \d{4}-\d{2}-\d{2} is skipped\./).length).toBeGreaterThan(0)
  })
})

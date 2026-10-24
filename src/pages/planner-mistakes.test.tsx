// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, Chapter, Mistake } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { taskInputSchema } from '../lib/task-validation'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn<(table: string, record: unknown) => Promise<undefined>>(async () => undefined),
  notify: vi.fn()
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', isLocal: true } }) }))

const USER = '00000000-0000-4000-8000-000000000001'
const PHY = '00000000-0000-4000-8000-0000000000a1'
const CHEM = '00000000-0000-4000-8000-0000000000b1'
const NOW = '2026-10-08T06:00:00.000Z'
const chapter = (id: string, name: string, subject: string): Chapter => ({ id, user_id: USER, subject, name, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const mistake = (overrides: Partial<Mistake> = {}): Mistake => ({ id: '00000000-0000-4000-8000-0000000000c9', user_id: USER, chapter_id: PHY, test_id: null, mistake_type: 'Concept', question_note: 'Sign of work done', solution_note: '', image_path: null, retry_later: true, retry_status: 'pending', created_at: NOW, updated_at: NOW, ...overrides })
const baseData = (overrides: Partial<AppData> = {}): AppData => ({
  chapters: [chapter(PHY, 'Electrostatics', 'Physics'), chapter(CHEM, 'Mole Concept', 'Chemistry')],
  studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
  practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
  examTracks: defaultExamTracks(USER), settings: defaultSettings(USER), profile: null, ...overrides
})
const renderAt = (ui: React.ReactElement, route = '/') => render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)

afterEach(() => { cleanup(); harness.upsert.mockClear(); harness.notify.mockClear() })

describe('Planner topic / subtopic', () => {
  it('saves an optional topic and shows it on the task row', async () => {
    harness.data = baseData()
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner')
    fireEvent.click(screen.getAllByRole('button', { name: /Add task/ })[0]!)
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText(/Practice 15 integration/), { target: { value: 'Revise field lines' } })
    fireEvent.change(within(dialog).getByLabelText(/Topic \/ subtopic/), { target: { value: '  Gauss’s law ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Save|Add|Plan/i, hidden: false }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('daily_tasks', expect.objectContaining({ title: 'Revise field lines', topic: 'Gauss’s law' }))
  })

  it('keeps tasks without a topic valid and caps its length', () => {
    expect(taskInputSchema.safeParse({ title: 'Old task', estimated_minutes: 30, task_date: '2026-10-08' }).success).toBe(true)
    expect(taskInputSchema.safeParse({ title: 'T', topic: null, estimated_minutes: 30, task_date: '2026-10-08' }).success).toBe(true)
    expect(taskInputSchema.safeParse({ title: 'T', topic: 'x'.repeat(121), estimated_minutes: 30, task_date: '2026-10-08' }).success).toBe(false)
  })
})

describe('Mistake dialog Subject → Chapter', () => {
  it('only lists chapters of the chosen subject and resets the chapter when the subject changes', async () => {
    harness.data = baseData()
    const { default: MistakesPage } = await import('./MistakesPage')
    renderAt(<MistakesPage />, '/mistakes')
    fireEvent.click(screen.getByRole('button', { name: /Add a mistake/ }))
    const dialog = screen.getByRole('dialog')
    const subject = within(dialog).getByLabelText(/^Subject/) as HTMLSelectElement
    const chapterSelect = within(dialog).getByLabelText(/^Chapter/) as HTMLSelectElement
    expect(chapterSelect.disabled).toBe(true)
    fireEvent.change(subject, { target: { value: 'Physics' } })
    expect(within(chapterSelect).queryByText('Mole Concept')).toBeNull()
    fireEvent.change(chapterSelect, { target: { value: PHY } })
    fireEvent.change(subject, { target: { value: 'Chemistry' } })
    expect(chapterSelect.value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to notebook/ }))
    expect(await within(dialog).findByText(/Choose a chapter from the selected subject/)).toBeTruthy()
    expect(harness.upsert).not.toHaveBeenCalled()
  })
})

describe('Retry list “Reveal my note”', () => {
  it('explains when no note was saved instead of hiding the control', async () => {
    harness.data = baseData({ mistakes: [mistake()] })
    const { default: RetryPage } = await import('./RetryPage')
    renderAt(<RetryPage />, '/retry')
    fireEvent.click(screen.getByText('Reveal my note'))
    expect(screen.getByText(/No note saved for this one yet/)).toBeTruthy()
  })

  it('shows the saved note when there is one', async () => {
    harness.data = baseData({ mistakes: [mistake({ solution_note: 'W = −ΔU' })] })
    const { default: RetryPage } = await import('./RetryPage')
    renderAt(<RetryPage />, '/retry')
    expect(screen.getByText('W = −ΔU')).toBeTruthy()
    expect(screen.queryByText(/No note saved/)).toBeNull()
  })
})

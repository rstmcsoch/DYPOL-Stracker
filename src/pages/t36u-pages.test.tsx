// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, Chapter, BacklogItem, TestRecord, PracticeSession } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'

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

import { indiaToday, plusDays } from '../lib/date'
import { FULL_MOCK_SCOPE_HINT } from '../lib/test-form'

void TODAY
const mathsChapter = chapter('quad', 'Quadratic Equations', { subject: 'Maths' })

describe('Practice dialog', () => {
  it('labels every chapter with its subject and saves Skipped separately', async () => {
    harness.data = baseData({ chapters: [chapter('elec', 'Electrostatics'), mathsChapter] })
    const { default: PracticePage } = await import('./PracticePage')
    renderPage(<PracticePage />, '/practice?add=1')
    const dialog = screen.getByRole('dialog')
    const select = within(dialog).getByRole('combobox', { name: /^Chapter/ })
    expect(within(select).getByRole('option', { name: 'Physics · Electrostatics' })).toBeTruthy()
    expect(within(select).getByRole('option', { name: 'Maths · Quadratic Equations' })).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Subject filter/ }), { target: { value: 'Maths' } })
    const filtered = within(dialog).getByRole('combobox', { name: /^Chapter/ })
    expect(within(filtered).queryByRole('option', { name: /Electrostatics/ })).toBeNull()
    fireEvent.change(filtered, { target: { value: 'quad' } })
    fireEvent.change(within(dialog).getByLabelText(/^Attempted/), { target: { value: '20' } })
    fireEvent.change(within(dialog).getByLabelText(/^Correct/), { target: { value: '15' } })
    fireEvent.change(within(dialog).getByLabelText(/^Skipped/), { target: { value: '4' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Log practice/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('practice_sessions', expect.objectContaining({ chapter_id: 'quad', attempted: 20, correct: 15, incorrect: 5, skipped: 4 }))
  })

  it('shows 0 skipped for older blocks saved without the field', async () => {
    const old = { id: 'p1', user_id: USER, chapter_id: 'elec', practice_date: indiaToday(), attempted: 10, correct: 7, incorrect: 3, source: 'DPP', time_minutes: null, notes: '', created_at: NOW, updated_at: NOW } as PracticeSession
    harness.data = baseData({ practiceSessions: [old] })
    const { default: PracticePage } = await import('./PracticePage')
    renderPage(<PracticePage />, '/practice')
    expect(screen.getByText('skipped', { exact: false })).toBeTruthy()
  })
})

describe('Backlog quick snooze and subject default', () => {
  const item: BacklogItem = {
    id: 'b1', user_id: USER, title: 'EMI Lecture 8', type: 'Lecture', subject: 'Physics', chapter_id: null, priority: 'High',
    due_on: '2026-10-01', status: 'active', snoozed_until: null, completed_at: null, notes: '', created_at: NOW, updated_at: NOW
  }
  it('snoozes until tomorrow from the row, once per burst of clicks', async () => {
    let release: () => void = () => undefined
    harness.upsert.mockImplementationOnce(() => new Promise<undefined>(resolve => { release = () => resolve(undefined) }))
    harness.data = baseData({ backlogItems: [item, { ...item, id: 'b2', title: 'Done one', status: 'done', completed_at: NOW }] })
    const { default: BacklogPage } = await import('./BacklogPage')
    renderPage(<BacklogPage />, '/backlog')
    const button = screen.getByRole('button', { name: 'Snooze EMI Lecture 8 until tomorrow' })
    expect(screen.queryByRole('button', { name: 'Snooze Done one until tomorrow' })).toBeNull()
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button)
    release()
    await vi.waitFor(() => expect(harness.notify).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledTimes(1)
    expect(harness.upsert).toHaveBeenCalledWith('backlog_items', expect.objectContaining({ id: 'b1', status: 'snoozed', snoozed_until: plusDays(indiaToday(), 1) }))
  })

  it('offers an optional subject, saves null when unselected, and a chapter brings its subject', async () => {
    harness.data = baseData({ chapters: [chapter('elec', 'Electrostatics'), mathsChapter] })
    const { default: BacklogPage } = await import('./BacklogPage')
    renderPage(<BacklogPage />, '/backlog?add=1')
    const dialog = screen.getByRole('dialog')
    const subject = within(dialog).getByRole('combobox', { name: /^Subject/ }) as HTMLSelectElement
    expect(subject.value).toBe('')
    expect(within(subject).getByRole('option', { name: 'Choose subject (optional)' })).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/What is it/), { target: { value: 'Revise roots' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Linked chapter/ }), { target: { value: 'quad' } })
    expect(subject.value).toBe('Maths')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Linked chapter/ }), { target: { value: '' } })
    fireEvent.change(subject, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Add to backlog/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('backlog_items', expect.objectContaining({ title: 'Revise roots', subject: null, chapter_id: null }))
  })
})

describe('Home due tomorrow', () => {
  it('shows due now and due tomorrow separately', async () => {
    const today = indiaToday()
    const make = (id: string, overrides: Partial<BacklogItem>): BacklogItem => ({ id, user_id: USER, title: id, type: 'Lecture', subject: null, chapter_id: null, priority: 'Medium', due_on: null, status: 'active', snoozed_until: null, completed_at: null, notes: '', created_at: NOW, updated_at: NOW, ...overrides })
    harness.data = baseData({ backlogItems: [
      make('now', { due_on: today }), make('old', { due_on: plusDays(today, -3) }),
      make('t1', { due_on: plusDays(today, 1) }), make('t-done', { due_on: plusDays(today, 1), status: 'done', completed_at: NOW }),
      make('t-snoozed-late', { due_on: plusDays(today, 1), status: 'snoozed', snoozed_until: plusDays(today, 3) })
    ] })
    const { HomeSnapshot } = await import('../components/jee/HomeSnapshot')
    renderPage(<HomeSnapshot />)
    expect(screen.getByRole('button', { name: /Backlog due now: 2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Due tomorrow: 1/ })).toBeTruthy()
  })
})

describe('Full Mock form', () => {
  it('hides subject and chapter, keeps typed scores, and saves without subject, chapter or link', async () => {
    const existing: TestRecord = {
      id: 't1', user_id: USER, title: 'Weekly', test_date: '2026-10-05', test_type: 'Chapter Test', subject: 'Physics', chapter_id: 'elec',
      marks_obtained: 40, total_marks: 100, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW
    } as TestRecord
    const link = { id: 'l1', user_id: USER, test_id: 't1', chapter_id: 'elec', marks_obtained: 40, total_marks: 100, created_at: NOW, updated_at: NOW }
    harness.data = baseData({ tests: [existing], testChapterLinks: [link] as AppData['testChapterLinks'] })
    const { default: TestsPage } = await import('./TestsPage')
    renderPage(<TestsPage />, '/tests')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Weekly' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Test type/ }), { target: { value: 'Full Mock' } })
    expect(within(dialog).queryByRole('combobox', { name: /^Subject/ })).toBeNull()
    expect(within(dialog).queryByRole('combobox', { name: /^Chapter/ })).toBeNull()
    expect(within(dialog).getByText(FULL_MOCK_SCOPE_HINT)).toBeTruthy()
    const physics = within(dialog).getByLabelText('Physics marks') as HTMLInputElement
    fireEvent.change(physics, { target: { value: '55' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Test type/ }), { target: { value: 'Subject Test' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Test type/ }), { target: { value: 'Full Mock' } })
    expect((within(dialog).getByLabelText('Physics marks') as HTMLInputElement).value).toBe('55')
    fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('tests', expect.objectContaining({ id: 't1', test_type: 'Full Mock', subject: null, chapter_id: null }))
    expect(harness.upsert).not.toHaveBeenCalledWith('test_chapter_links', expect.anything())
    await vi.waitFor(() => expect(harness.remove).toHaveBeenCalledWith('test_chapter_links', expect.objectContaining({ id: 'l1' }), { undo: false }))
  })
})

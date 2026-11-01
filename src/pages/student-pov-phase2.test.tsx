// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppData, Chapter, Revision, TestRecord } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { indiaToday, plusDays } from '../lib/date'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn<(table: string, record: unknown) => Promise<undefined>>(async () => undefined),
  notify: vi.fn()
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), saveImage: vi.fn(), updateSettings: vi.fn(async () => undefined) })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-phase2', isLocal: true, email: '' }, signOut: vi.fn() }) }))
vi.mock('../lib/supabase', () => ({ supabase: null }))

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const chapter = (id: string, name: string, subject = 'Physics', position = 0, status: Chapter['status'] = 'Studying'): Chapter => ({ id, user_id: USER, subject, name, position, status, priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const baseData = (overrides: Partial<AppData> = {}): AppData => ({
  chapters: [chapter('elec', 'Electrostatics')],
  studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
  practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
  examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), user_id: USER, owner_name: 'Asha' }, profile: null, ...overrides
} as AppData)
const renderAt = (ui: React.ReactElement, route = '/') => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>)
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }

afterEach(() => { cleanup(); harness.upsert.mockClear(); harness.notify.mockClear(); localStorage.clear() })

describe('item 15 + 16: Planner task form', () => {
  it('General lists chapters under subject groups and the topic counter updates live', async () => {
    harness.data = baseData({ chapters: [chapter('p1', 'Electrostatics'), chapter('c1', 'Mole Concept', 'Chemistry'), chapter('m1', 'Limits', 'Maths')] })
    const { default: PlannerPage } = await import('./PlannerPage')
    renderAt(<PlannerPage />, '/planner')
    fireEvent.click(screen.getByRole('button', { name: /Add task/ }))
    const dialog = screen.getByRole('dialog')
    const chapterSelect = within(dialog).getByLabelText(/^Chapter/) as HTMLSelectElement
    const groups = [...chapterSelect.querySelectorAll('optgroup')].map(group => group.label)
    expect(groups).toEqual(expect.arrayContaining(['Physics', 'Chemistry', 'Maths']))
    expect(chapterSelect.querySelector('optgroup[label="Chemistry"] option')?.textContent).toBe('Chemistry · Mole Concept')
    const counter = within(dialog).getByTestId('topic-counter')
    expect(counter.textContent).toBe('0/120 characters')
    expect(counter.getAttribute('aria-live')).toBe('polite')
    fireEvent.change(within(dialog).getByLabelText(/Topic \/ subtopic/), { target: { value: 'x'.repeat(105) } })
    expect(counter.textContent).toMatch(/105\/120 characters — nearly at the limit/)
    expect(counter.className).toContain('is-near')
  })
})

describe('item 17: Revisions', () => {
  it('shows each row’s real interval and labels the snooze action', async () => {
    const today = indiaToday()
    const revision = (id: string, n: number): Revision => ({ id, user_id: USER, chapter_id: 'elec', revision_number: n, due_on: today, completed_at: null, created_at: NOW, updated_at: NOW } as Revision)
    harness.data = baseData({ revisions: [revision('r1', 1), revision('r2', 2), revision('r3', 3)] })
    const { default: RevisionPage } = await import('./RevisionPage')
    renderAt(<RevisionPage />, '/revision')
    const labels = [...document.querySelectorAll('.revision-interval')].map(node => node.textContent)
    expect(labels).toEqual(expect.arrayContaining(['R1 · 1d', 'R2 · 7d', 'R3 · 30d']))
    const snoozes = screen.getAllByRole('button', { name: /Snooze R\d by one day/ })
    expect(snoozes.length).toBe(3)
    expect(snoozes[0]?.textContent).toContain('Snooze +1d')
    expect(screen.queryByRole('button', { name: /^\+1d$/ })).toBeNull()
  })
})

describe('item 19: Mistake form subjects', () => {
  it('offers the exam’s own subjects (NEET → Botany and Zoology), not only Physics/Chemistry/Maths', async () => {
    harness.data = baseData({ settings: { ...baseData().settings, exam_id: 'neet-ug' } })
    const { default: MistakesPage } = await import('./MistakesPage')
    renderAt(<MistakesPage />, '/mistakes')
    fireEvent.click(screen.getByRole('button', { name: /Add a mistake/ }))
    const dialog = screen.getByRole('dialog')
    const subject = within(dialog).getByLabelText(/^Subject/) as HTMLSelectElement
    const options = [...subject.options].map(option => option.value)
    expect(options).toEqual(expect.arrayContaining(['Physics', 'Chemistry', 'Botany', 'Zoology']))
    fireEvent.change(subject, { target: { value: 'Botany' } })
    expect(within(dialog).getByText(/Add Botany chapters in Syllabus first/)).toBeTruthy()
  })
})

describe('item 20 + 21: Weak areas deep link and stable Syllabus order', () => {
  it('Weak areas chapter opens /syllabus?chapter=<id>', async () => {
    const test = (id: string, pct: number): TestRecord => ({ id, user_id: USER, title: id, test_date: indiaToday(), test_type: 'Chapter Test', subject: 'Physics', chapter_id: 'elec', marks_obtained: pct, total_marks: 100, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW } as TestRecord)
    harness.data = baseData({ tests: [test('t1', 30), test('t2', 35)] })
    const { default: WeakAreasPage } = await import('./WeakAreasPage')
    renderAt(<><WeakAreasPage /><LocationProbe /></>, '/weak-areas')
    fireEvent.click(screen.getAllByRole('button', { name: /Electrostatics/ })[0] as HTMLElement)
    expect(screen.getByTestId('location').textContent).toBe('/syllabus?chapter=elec')
  })
  it('Syllabus highlights and focuses the linked chapter, and keeps per-subject order on status change', async () => {
    harness.data = baseData({ chapters: [chapter('c1', 'Mole Concept', 'Chemistry', 0, 'Done'), chapter('p2', 'Optics', 'Physics', 1), chapter('m1', 'Limits', 'Maths', 0), chapter('p1', 'Kinematics', 'Physics', 0, 'Not Started')] })
    const { default: SyllabusPage } = await import('./SyllabusPage')
    const view = renderAt(<><SyllabusPage /><LocationProbe /></>, '/syllabus?chapter=p2')
    const row = await vi.waitFor(() => { const element = document.getElementById('chapter-row-p2'); if (!element?.className.includes('chapter-highlight')) throw new Error('not yet'); return element })
    expect(row.getAttribute('aria-current')).toBe('true')
    await vi.waitFor(() => expect(document.activeElement).toBe(row))
    expect(screen.getByTestId('location').textContent).toBe('/syllabus')
    const order = () => [...document.querySelectorAll('[data-chapter-row]')].map(node => node.getAttribute('data-chapter-row'))
    const before = order()
    expect(before.indexOf('p1')).toBeLessThan(before.indexOf('p2'))
    harness.data = { ...harness.data, chapters: harness.data.chapters.map(item => item.id === 'p1' ? { ...item, status: 'Done' as const } : item) }
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/syllabus']}><SyllabusPage /></MemoryRouter></QueryClientProvider>)
    expect(order()).toEqual(before)
  })
})

describe('item 22: Analytics legend toggles and remembered range', () => {
  it('hides a series from its legend button and keeps the chosen range across a remount', async () => {
    const test = (id: string, date: string, marks: number): TestRecord => ({ id, user_id: USER, title: id, test_date: date, test_type: 'Full Mock', subject: null, chapter_id: null, marks_obtained: marks, total_marks: 100, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW } as TestRecord)
    harness.data = baseData({ tests: [test('a', plusDays(indiaToday(), -10), 50), test('b', plusDays(indiaToday(), -2), 60)] })
    const { default: AnalyticsPage } = await import('./AnalyticsPage')
    renderAt(<AnalyticsPage />, '/analytics')
    const legend = screen.getByRole('group', { name: 'Show or hide trend series' })
    const overall = within(legend).getByRole('button', { name: /Overall/ })
    expect(overall.getAttribute('aria-pressed')).toBe('true')
    const others = within(legend).getAllByRole('button').filter(button => button !== overall)
    if (others.length) {
      fireEvent.click(overall)
      expect(overall.getAttribute('aria-pressed')).toBe('false')
      expect(overall.className).toContain('is-off')
      fireEvent.click(overall)
      expect(overall.getAttribute('aria-pressed')).toBe('true')
    } else {
      // The last visible series can never be hidden.
      fireEvent.click(overall)
      expect(overall.getAttribute('aria-pressed')).toBe('true')
    }
    fireEvent.change(screen.getByLabelText('Choose marks trend range'), { target: { value: '180' } })
    expect(localStorage.getItem('stracker-analytics-range:u-phase2')).toBe('180')
    cleanup()
    renderAt(<AnalyticsPage />, '/analytics')
    expect((screen.getByLabelText('Choose marks trend range') as HTMLSelectElement).value).toBe('180')
  })
})

describe('item 23: Home “Why this?” closes on Esc', () => {
  it('collapses the explanation and returns focus to its button', async () => {
    const overdue: Revision = { id: 'r-old', user_id: USER, chapter_id: 'elec', revision_number: 1, due_on: plusDays(indiaToday(), -3), completed_at: null, created_at: NOW, updated_at: NOW } as Revision
    harness.data = baseData({ revisions: [overdue] })
    const { StudyNowCard } = await import('../components/jee/StudyNowCard')
    renderAt(<StudyNowCard />, '/')
    const toggle = screen.getByRole('button', { name: /Why this\?/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })
})

describe('item 24: in-app 404', () => {
  it('unknown addresses and bad record ids show a styled not-found view with a Home link', async () => {
    const { default: NotFoundPage } = await import('./NotFoundPage')
    renderAt(<Routes><Route path="/" element={<LocationProbe />} /><Route path="*" element={<NotFoundPage />} /></Routes>, '/mistakes/abc')
    expect(screen.getByRole('heading', { name: /isn’t in your notebook/ })).toBeTruthy()
    expect(screen.getByText('/mistakes/abc')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /Back to Home/ }))
    expect(screen.getByTestId('location').textContent).toBe('/')
  })
  it('signed-out visitors get the same view with homepage and log-in links', async () => {
    const { default: NotFoundPage } = await import('./NotFoundPage')
    renderAt(<NotFoundPage signedIn={false} />, '/does-not-exist')
    expect(screen.getByRole('link', { name: /Go to the homepage/ }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
  })
})

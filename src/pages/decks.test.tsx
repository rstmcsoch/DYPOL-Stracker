// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData, Chapter, StudyCard } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'

const harness = vi.hoisted(() => ({
  data: null as unknown as AppData,
  upsert: vi.fn<(table: string, record: unknown) => Promise<undefined>>(async () => undefined),
  notify: vi.fn()
}))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: harness.upsert, upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const chapter = (id: string, name: string, subject: string): Chapter => ({ id, user_id: USER, subject, name, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const card = (id: string, chapterId: string, front: string, overrides: Partial<StudyCard> = {}): StudyCard => ({ id, user_id: USER, chapter_id: chapterId, kind: 'formula', front, back: 'answer', hint: '', position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW, ...overrides })

function data(): AppData {
  return {
    chapters: [chapter('phy', 'Electrostatics', 'Physics'), chapter('chem', 'Mole Concept', 'Chemistry'), chapter('chem2', 'Thermodynamics', 'Chemistry')],
    studyCards: [card('k1', 'phy', 'Coulomb law'), card('k2', 'chem', 'Avogadro number'), card('k3', 'chem2', 'First law', { next_review_at: '2099-01-01T00:00:00.000Z' })],
    revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
    practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), revision_gaps: [1, 7, 30] }, profile: null
  }
}

async function renderDecks(route = '/decks?chapter=phy') {
  const { default: DecksPage } = await import('./DecksPage')
  return render(<MemoryRouter initialEntries={[route]}><DecksPage /></MemoryRouter>)
}
const subjectFilter = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement

afterEach(() => { cleanup(); harness.upsert.mockClear(); harness.notify.mockClear() })

describe('Decks subject filter', () => {
  it('switches the deck to the chosen subject using each card’s chapter', async () => {
    harness.data = data()
    await renderDecks()
    expect(screen.getByText('Coulomb law')).toBeTruthy()
    fireEvent.change(subjectFilter(), { target: { value: 'Chemistry' } })
    expect(screen.queryByText('Coulomb law')).toBeNull()
    expect(screen.getByText('Avogadro number')).toBeTruthy()
    // Due overall now counts only Chemistry cards (k2 due, k3 scheduled later).
    const due = screen.getByText('Due overall').closest('.jee-stat') as HTMLElement
    expect(within(due).getByText('1')).toBeTruthy()
    expect(within(due).getByText('across Chemistry')).toBeTruthy()
    fireEvent.change(subjectFilter(), { target: { value: 'all' } })
    expect(within(screen.getByText('Due overall').closest('.jee-stat') as HTMLElement).getByText('2')).toBeTruthy()
  })
})

describe('New card dialog', () => {
  it('requires a subject and a chapter from it, then saves to the chosen chapter', async () => {
    harness.data = data()
    await renderDecks()
    fireEvent.click(screen.getByRole('button', { name: /New card/ }))
    const dialog = screen.getByRole('dialog', { name: /New card/ })
    const [subject, chapterSelect] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[]
    expect(subject!.value).toBe('Physics')
    expect(chapterSelect!.value).toBe('phy')
    fireEvent.change(subject!, { target: { value: 'Chemistry' } })
    expect(chapterSelect!.value).toBe('')
    fireEvent.change(within(dialog).getByPlaceholderText(/Capacitance of parallel plates/), { target: { value: 'Ideal gas' } })
    fireEvent.change(within(dialog).getByPlaceholderText(/C = ε₀A \/ d/), { target: { value: 'PV = nRT' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Add card/ }))
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Choose a chapter from the selected subject/)
    expect(harness.upsert).not.toHaveBeenCalled()
    fireEvent.change(chapterSelect!, { target: { value: 'chem2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Add card/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalledTimes(1))
    expect(harness.upsert).toHaveBeenCalledWith('study_cards', expect.objectContaining({ chapter_id: 'chem2', front: 'Ideal gas', back: 'PV = nRT', position: 1, last_rating: null }))
  })
})

describe('Four-button review', () => {
  it('offers Again, Hard, Good and Easy with their intervals and saves the rating', async () => {
    harness.data = data()
    await renderDecks()
    fireEvent.click(screen.getByRole('button', { name: /Review 1 due/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Reveal answer/ }))
    const group = within(dialog).getByRole('group', { name: 'Rate this card' })
    expect(within(group).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Again — next review today', 'Hard — next review 1 day', 'Good — next review 1 day', 'Easy — next review 7 days'
    ])
    fireEvent.click(within(group).getByRole('button', { name: /^Easy/ }))
    await vi.waitFor(() => expect(harness.upsert).toHaveBeenCalled())
    expect(harness.upsert).toHaveBeenCalledWith('study_cards', expect.objectContaining({ id: 'k1', last_rating: 'easy', difficulty: 'easy', reviews: 2 }))
  })
})

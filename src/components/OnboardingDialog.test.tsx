// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultSettings, needsOnboarding, shouldSeedJeeSyllabus } from '../lib/defaults'
import type { AppSettings } from '../types'

const upsert = vi.fn(async () => undefined)
const upsertMany = vi.fn(async () => undefined)
let settings: AppSettings = defaultSettings('u1', '')
let chapters: unknown[] = []
vi.mock('../contexts/DataContext', () => ({ useData: () => ({ data: { settings, chapters, profile: null }, upsert, upsertMany }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c', displayName: 'Asha', isLocal: false } }) }))
vi.mock('../lib/exams/fetch-catalog', () => ({ fetchExamCatalog: vi.fn(async () => { throw new Error('offline') }) }))

const { OnboardingDialog } = await import('./OnboardingDialog')

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><OnboardingDialog /></QueryClientProvider>)
}

afterEach(() => { cleanup(); upsert.mockClear(); upsertMany.mockClear(); settings = defaultSettings('u1', ''); chapters = [] })

describe('first-run setup', () => {
  it('is needed only until completed or an exam is chosen', () => {
    expect(needsOnboarding(defaultSettings('u'))).toBe(true)
    expect(needsOnboarding({ ...defaultSettings('u'), onboarding_completed: true })).toBe(false)
    expect(needsOnboarding({ ...defaultSettings('u'), exam_id: 'neet-ug' })).toBe(false)
  })

  it('waits for the exam before seeding the JEE syllabus for new accounts', () => {
    expect(shouldSeedJeeSyllabus({ exam_id: null, onboarding_completed: false })).toBe(false)
    expect(shouldSeedJeeSyllabus({ exam_id: null, onboarding_completed: true })).toBe(true)
    expect(shouldSeedJeeSyllabus({ exam_id: 'jee', onboarding_completed: false })).toBe(true)
    expect(shouldSeedJeeSyllabus({ exam_id: 'neet-ug', onboarding_completed: true })).toBe(false)
  })

  it('has no close control and ignores Escape', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Set up your notebook' })).toBeTruthy()
  })

  it('requires every choice, then saves and seeds nothing for NEET', async () => {
    renderDialog()
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe('Asha')
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(screen.getByRole('alert').textContent).toMatch(/exam/i)
    fireEvent.change(screen.getByLabelText(/^Exam/), { target: { value: 'neet-ug' } })
    const year = screen.getByLabelText(/Target year/) as HTMLSelectElement
    fireEvent.change(year, { target: { value: year.options[1]!.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(screen.getByRole('alert').textContent).toMatch(/light or dark/i)
    expect(screen.getByText(/Subjects: Physics, Chemistry, Botany, Zoology/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Dark/))
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsert.mock.calls[0]).toEqual(['app_settings', expect.objectContaining({ owner_name: 'Asha', exam_id: 'neet-ug', theme: 'dark', onboarding_completed: true })])
    expect(upsertMany).not.toHaveBeenCalled()
  })

  it('seeds the JEE syllabus for a new JEE student and requires a board when boards are added', async () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText(/^Exam/), { target: { value: 'jee' } })
    const year = screen.getByLabelText(/Target year/) as HTMLSelectElement
    fireEvent.change(year, { target: { value: year.options[1]!.value } })
    fireEvent.click(screen.getByLabelText(/Also track my Class 12 boards/))
    fireEvent.click(screen.getByLabelText(/Light/))
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(screen.getByRole('alert').textContent).toMatch(/board/i)
    fireEvent.change(screen.getByLabelText(/^Class 12 board/), { target: { value: 'CBSE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsertMany).toHaveBeenCalledWith('chapters', expect.any(Array))
    expect(upsert.mock.calls[0]).toEqual(['app_settings', expect.objectContaining({ exam_id: 'jee', boards_addon: true, exam_board: 'CBSE', theme: 'light' })])
  })
})

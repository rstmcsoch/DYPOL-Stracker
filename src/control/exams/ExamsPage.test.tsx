// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamDefinition } from '../../lib/exams/catalog'
import { DEFAULT_MODEL_PREFERENCES } from '../../lib/ai/model-ranking'

const mocks = vi.hoisted(() => ({ controlFetch: vi.fn() }))
vi.mock('../api', () => ({ controlFetch: mocks.controlFetch }))

import ExamsPage from './ExamsPage'

const exam = (id: string, name: string, sort_order: number, hidden = false): ExamDefinition => ({
  id, name, category: 'Engineering', years: [2027], sessions: [], boards: [], boards_addon: false,
  subjects: ['Physics'], session_label: '', hidden, sort_order, marking_scheme: null
} as ExamDefinition)

const EXAMS = [exam('alpha', 'Alpha Exam', 10), exam('beta', 'Beta Exam', 20), exam('gamma', 'Gamma Exam', 30)]

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ExamsPage /></QueryClientProvider>)
}

const rows = () => [...document.querySelectorAll('.cc-exam-list > li')]

beforeEach(() => {
  mocks.controlFetch.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
  mocks.controlFetch.mockImplementation((_path: string, init?: { method?: string }) => {
    if (!init?.method) return Promise.resolve({ ok: true, exams: EXAMS, aiModelPreferences: DEFAULT_MODEL_PREFERENCES })
    return Promise.resolve({ ok: true })
  })
})

afterEach(() => cleanup())

describe('Exams section interactions', () => {
  it('a slow Remove disables only its own button; Edit and the other rows keep working', async () => {
    const pending = deferred<unknown>()
    mocks.controlFetch.mockImplementation((_path: string, init?: { method?: string }) => {
      if (!init?.method) return Promise.resolve({ ok: true, exams: EXAMS, aiModelPreferences: DEFAULT_MODEL_PREFERENCES })
      if (init.method === 'PUT') return pending.promise
      return Promise.resolve({ ok: true })
    })
    mount()
    await screen.findByText('Alpha Exam')

    fireEvent.click(within(rows()[0] as HTMLElement).getByRole('button', { name: 'Remove' }))
    // The clicked row flips optimistically and only its button shows the pending state.
    await waitFor(() => expect(rows()[0]?.className).toContain('is-hidden'))
    const alphaRow = within(rows()[0] as HTMLElement)
    expect((alphaRow.getByRole('button', { name: /Saving/ }) as HTMLButtonElement).disabled).toBe(true)

    // Edit on another exam still opens the editor while the write is in flight.
    const betaRow = within(rows()[1] as HTMLElement)
    const edit = betaRow.getByRole('button', { name: /Edit/ }) as HTMLButtonElement
    expect(edit.disabled).toBe(false)
    fireEvent.click(edit)
    expect(await screen.findByText('Edit Beta Exam')).toBeTruthy()

    pending.resolve({ ok: true })
  })

  it('reorder moves the row immediately (optimistic) before the server answers', async () => {
    const pending = deferred<unknown>()
    mocks.controlFetch.mockImplementation((_path: string, init?: { method?: string }) => {
      if (!init?.method) return Promise.resolve({ ok: true, exams: EXAMS, aiModelPreferences: DEFAULT_MODEL_PREFERENCES })
      if (init.method === 'POST') return pending.promise
      return Promise.resolve({ ok: true })
    })
    mount()
    await screen.findByText('Alpha Exam')
    expect(rows().map(row => row.textContent)).toSatisfy((texts: string[]) => Boolean(texts[0]?.includes('Alpha Exam') && texts[1]?.includes('Beta Exam')))

    fireEvent.click(screen.getByRole('button', { name: 'Move Alpha Exam down' }))

    await waitFor(() => expect(rows()[0]?.textContent).toContain('Beta Exam'))
    expect(rows()[1]?.textContent).toContain('Alpha Exam')
    // Only the moved exam's arrows are busy; another row's Edit is untouched.
    expect((screen.getByRole('button', { name: 'Move Alpha Exam down' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(rows()[0] as HTMLElement).getByRole('button', { name: /Edit/ }) as HTMLButtonElement).disabled).toBe(false)

    pending.resolve({ ok: true })
  })

  it('opens the editor for editing and Cancel closes it without any write', async () => {
    mount()
    await screen.findByText('Gamma Exam')
    fireEvent.click(within(rows()[2] as HTMLElement).getByRole('button', { name: /Edit/ }))
    expect(await screen.findByText('Edit Gamma Exam')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Edit Gamma Exam')).toBeNull())
    expect(mocks.controlFetch.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method)).toEqual([])
  })
})

describe('Exams editor styling and target years', () => {
  it('renders the editor with admin field styling and a chip-based year editor', async () => {
    mount()
    await screen.findByText('Alpha Exam')
    fireEvent.click(within(rows()[0] as HTMLElement).getByRole('button', { name: /Edit/ }))
    expect(await screen.findByText('Edit Alpha Exam')).toBeTruthy()

    // Every text control carries the shared admin input styling; no raw comma years field.
    const panel = document.querySelector('.cc-exam-form') as HTMLElement
    const controls = [...panel.querySelectorAll('input, textarea, select')].filter(el => (el as HTMLInputElement).type !== 'checkbox')
    expect(controls.length).toBeGreaterThan(5)
    expect(controls.every(el => el.classList.contains('cc-input'))).toBe(true)
    expect(screen.queryByPlaceholderText('blank = automatic')).toBeNull()

    // Years are chips: Alpha is seeded with 2027.
    expect(panel.querySelector('.cc-year-chip')?.textContent).toContain('2027')
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove year 2027' }))
    expect(panel.querySelector('.cc-year-chip')).toBeNull()
    expect(within(panel).getByText(/Automatic/)).toBeTruthy()

    // Adding validates and sorts; duplicates are rejected with an inline error.
    const yearInput = within(panel).getByLabelText('Year to add')
    fireEvent.change(yearInput, { target: { value: '2031' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add year' }))
    expect(panel.querySelector('.cc-year-chip')?.textContent).toContain('2031')
    fireEvent.change(yearInput, { target: { value: '2031' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add year' }))
    expect(within(panel).getByText('2031 is already in the list.')).toBeTruthy()
    fireEvent.change(yearInput, { target: { value: '1999' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Add year' }))
    expect(within(panel).getByText('Enter a whole year between 2020 and 2100.')).toBeTruthy()
  })

  it('exam rows use the admin card styling hooks', async () => {
    mount()
    await screen.findByText('Alpha Exam')
    const row = rows()[0] as HTMLElement
    expect(row.querySelector('.cc-exam-main strong')?.textContent).toBe('Alpha Exam')
    expect(row.querySelector('.cc-exam-meta')).toBeTruthy()
    const css = readFileSync(`${process.cwd()}/src/control/control.css`, 'utf8')
    expect(css).toContain('.cc-exam-list > li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 12px 14px; border: 1px solid var(--cc-border); border-radius: var(--cc-radius); background: var(--cc-surface); }')
    expect(css).toContain('.cc-year-chip')
  })
})

describe('Control sidebar', () => {
  it('has no X/close button next to the sidebar title', () => {
    const layout = readFileSync(`${process.cwd()}/src/control/ControlLayout.tsx`, 'utf8')
    const css = readFileSync(`${process.cwd()}/src/control/control.css`, 'utf8')
    expect(layout).not.toContain('cc-sidebar__close')
    expect(css).not.toContain('cc-sidebar__close')
  })
})

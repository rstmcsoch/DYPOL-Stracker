// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultSettings, normalizeSettings } from '../../lib/defaults'
import { settingsSchema } from '../../lib/settings-validation'
import type { AppSettings } from '../../types'

const upsert = vi.fn(async () => undefined)
let settings: AppSettings = defaultSettings('u1', 'Asha')
vi.mock('../../contexts/DataContext', () => ({ useData: () => ({ data: { settings }, upsert }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('../../lib/exams/fetch-catalog', () => ({ fetchExamCatalog: vi.fn(async () => { throw new Error('offline') }) }))

const { ExamSelectionSection } = await import('./ExamSelectionSection')

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ExamSelectionSection /></QueryClientProvider>)
}

afterEach(() => { cleanup(); upsert.mockClear(); settings = defaultSettings('u1', 'Asha') })

describe('exam selection', () => {
  it('shows existing students as JEE without writing anything', () => {
    renderSection()
    expect((screen.getByLabelText('Exam') as HTMLSelectElement).value).toBe('jee')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('saves exam, year, CA attempt month', async () => {
    renderSection()
    fireEvent.change(screen.getByLabelText('Exam'), { target: { value: 'ca-intermediate' } })
    fireEvent.change(screen.getByLabelText('Target year'), { target: { value: String(new Date().getFullYear() + 1) } })
    fireEvent.change(screen.getByLabelText('Attempt / session'), { target: { value: 'September' } })
    fireEvent.click(screen.getByRole('button', { name: /Save exam/ }))
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    expect(upsert).toHaveBeenCalledWith('app_settings', expect.objectContaining({ exam_id: 'ca-intermediate', exam_year: new Date().getFullYear() + 1, exam_session: 'September', boards_addon: false, exam_board: null }))
  })

  it('offers the Class 12 boards add-on with a board choice', async () => {
    renderSection()
    fireEvent.change(screen.getByLabelText('Exam'), { target: { value: 'neet-ug' } })
    fireEvent.click(screen.getByLabelText(/Also track my Class 12 boards/))
    fireEvent.change(screen.getByLabelText('Class 12 board'), { target: { value: 'CBSE' } })
    fireEvent.click(screen.getByRole('button', { name: /Save exam/ }))
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    expect(upsert).toHaveBeenCalledWith('app_settings', expect.objectContaining({ exam_id: 'neet-ug', boards_addon: true, exam_board: 'CBSE' }))
  })

  it('keeps a student on an exam that is no longer listed', () => {
    settings = { ...settings, exam_id: 'retired-exam' }
    renderSection()
    expect((screen.getByLabelText('Exam') as HTMLSelectElement).value).toBe('retired-exam')
    expect(screen.getByRole('option', { name: /no longer listed/ })).toBeTruthy()
  })
})

describe('exam settings fields', () => {
  it('normalizes legacy and invalid rows safely', () => {
    const legacy = normalizeSettings({ id: 'u1', user_id: 'u1' }, 'u1')
    expect(legacy.exam_id).toBeNull()
    expect(legacy.boards_addon).toBe(false)
    const bad = normalizeSettings({ id: 'u1', exam_id: 'Bad Id', exam_year: 1900 }, 'u1')
    expect(bad.exam_id).toBeNull()
    expect(bad.exam_year).toBeNull()
  })

  it('validates exported settings with and without exam fields', () => {
    const base = defaultSettings('u1', 'Asha')
    const legacy: Record<string, unknown> = { ...base }
    for (const key of ['exam_id', 'exam_year', 'exam_session', 'exam_board', 'boards_addon']) delete legacy[key]
    expect(settingsSchema.safeParse(legacy).success).toBe(true)
    expect(settingsSchema.safeParse({ ...base, exam_id: 'neet-ug', exam_year: 2028 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...base, exam_id: 'NEET!' }).success).toBe(false)
  })
})

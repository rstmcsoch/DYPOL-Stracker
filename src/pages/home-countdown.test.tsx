// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'

const harness = vi.hoisted(() => ({ data: null as unknown as AppData }))

vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: vi.fn(async () => undefined), upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

const USER = '00000000-0000-4000-8000-000000000001'
function baseData(settings: Partial<ReturnType<typeof defaultSettings>> = {}): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER),
    settings: { ...defaultSettings(USER), ...settings },
    profile: null
  }
}

async function renderHome() {
  const { default: HomePage } = await import('./HomePage')
  return render(<MemoryRouter initialEntries={['/']}><HomePage /></MemoryRouter>)
}

afterEach(cleanup)

describe('Home big-day countdown selection', () => {
  it('prefers JEE Advanced when its date is set', async () => {
    harness.data = baseData({ advanced_exam_date: '2027-05-20', main_exam_date: '2027-01-20' })
    const { container } = await renderHome()
    const main = container.querySelector('.countdown-copy strong')
    expect(main?.textContent).toBe('JEE Advanced')
  })

  it('promotes JEE Main to the big countdown when Advanced is unset', async () => {
    harness.data = baseData({ advanced_exam_date: '', main_exam_date: '2027-01-20' })
    const { container } = await renderHome()
    const main = container.querySelector('.countdown-copy strong')
    expect(main?.textContent).toBe('JEE Main')
    expect(container.querySelector('.countdown-number')).not.toBeNull()
  })

  it('keeps an honest empty state when neither date exists', async () => {
    harness.data = baseData({ advanced_exam_date: '', main_exam_date: '' })
    const { container } = await renderHome()
    expect(container.querySelector('.countdown-unset')).not.toBeNull()
    expect(container.querySelector('.countdown-number')).toBeNull()
  })

  it('shows streak statistics exactly once on the dashboard', async () => {
    harness.data = baseData({ main_exam_date: '2027-01-20' })
    const { container } = await renderHome()
    expect(screen.getAllByText('longest')).toHaveLength(1)
    expect(screen.getAllByText(/current study streak/)).toHaveLength(1)
    // The snapshot strip no longer repeats the hero countdown number.
    expect(container.querySelector('.jee-countdown')).toBeNull()
  })
})

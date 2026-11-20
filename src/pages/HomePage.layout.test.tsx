// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppData } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { StudentLayoutProvider } from '../contexts/StudentLayoutContext'
import { sanitizeStudentLayout, type StudentLayoutDocument } from '../lib/student-layout/validate'

const harness = vi.hoisted(() => ({ data: null as unknown as AppData }))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: vi.fn(async () => undefined), upsertMany: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), mergeImportedData: vi.fn(), saveImage: vi.fn() })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: vi.fn() }) }))

const USER = '00000000-0000-4000-8000-000000000001'
function data(): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(USER),
    settings: { ...defaultSettings(USER), main_exam_date: '2027-01-20', advanced_exam_date: '2027-05-20' },
    profile: null
  }
}

async function renderHome(document?: StudentLayoutDocument | null, editing = false) {
  const { default: HomePage } = await import('./HomePage')
  const page = <MemoryRouter initialEntries={['/']}><HomePage /></MemoryRouter>
  return render(document === undefined ? page : <StudentLayoutProvider document={document} editing={editing}>{page}</StudentLayoutProvider>)
}

afterEach(cleanup)

describe('Home with a published student layout', () => {
  it('renders the shipped DOM when nothing is published', async () => {
    harness.data = data()
    const plain = (await renderHome()).container.innerHTML
    cleanup()
    const withNull = (await renderHome(null)).container.innerHTML
    expect(withNull).toBe(plain)
    expect(plain).not.toContain('data-sl')
  })

  it('applies visibility, order, labels and options but never data values', async () => {
    harness.data = data()
    const layout = sanitizeStudentLayout({
      schemaVersion: 1,
      components: { 'home.streak': { text: { subtitle: 'days in a row' } }, 'home.tip': { hidden: true }, 'home.countdown': { text: { kicker: 'EXAM DAY' } } },
      order: { 'home.hero': ['home.streak', 'home.countdown'], home: ['home.header', 'home.focus', 'home.hero', 'home.exam-mode', 'home.study-now', 'home.grid', 'home.bottom', 'home.snapshot'] }
    })
    const { container } = await renderHome(layout)
    const hero = container.querySelector('.hero-row')
    expect(hero?.firstElementChild?.className).toContain('streak-card')
    expect(container.querySelector('.streak-subtitle')?.textContent).toBe('days in a row')
    expect(container.querySelector('.pencil-underline')?.textContent).toBe('EXAM DAY')
    expect(container.querySelector('.smart-tip-card')).toBeNull()
    expect(container.querySelector('.streak-number')?.textContent).toBe('0days')
    const page = container.querySelector('.dashboard-page')!
    expect(page.lastElementChild?.className).toContain('jee-snapshot')
    expect(container.querySelector('[data-sl="home.streak"]')).not.toBeNull()
  })

  it('a layout carrying data overrides cannot change what the student sees', async () => {
    harness.data = data()
    const layout = sanitizeStudentLayout({ schemaVersion: 1, components: { 'home.streak': { text: { current: '365', subtitle: 'streak' } }, 'home.countdown': { text: { daysLeft: '1' } } } })
    const { container } = await renderHome(layout)
    expect(container.querySelector('.streak-number')?.textContent).toBe('0days')
    expect(container.querySelector('.countdown-number')?.textContent).not.toBe('1days')
  })

  it('marks editable labels and locked data only in the editor canvas', async () => {
    harness.data = data()
    const layout = sanitizeStudentLayout({ schemaVersion: 1, components: { 'home.tip': { hidden: true } } })
    const { container } = await renderHome(layout, true)
    expect(container.querySelector('[data-sl-text="home.streak:subtitle"]')).not.toBeNull()
    expect(container.querySelector('[data-sl-data="home.streak:current"]')).not.toBeNull()
    expect(container.querySelector('[data-sl-data="home.streak:current"]')?.hasAttribute('data-sl-text')).toBe(false)
    expect(container.querySelector('[data-sl="home.tip"][data-sl-hidden]')).not.toBeNull()
  })
})

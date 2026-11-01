// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppData, Chapter, Mistake, StudySession, TestRecord } from '../types'
import { defaultExamTracks, defaultSettings } from '../lib/defaults'
import { indiaToday } from '../lib/date'
import { createBackup } from '../lib/backup'
import { backupCountLabel, backupRecordCount, csvCountLabel, reportCountLabel, reportFileName, scopedReportData } from '../lib/export-counts'
import { wrapIndex } from '../lib/shortcuts'
import { elapsedSeconds, formatElapsed, progressAfterDelta, RESTART_PROGRESS, WRITING_PROGRESS } from '../lib/ai/task-progress'
import { fieldDefinition, SITE_CONTENT_DEFAULTS } from '../lib/site-content/registry'
import { validateFieldValue } from '../lib/site-content/content'
import { contactLinkKind } from '../lib/site-content/contact-link'
import { SiteContentProvider } from '../contexts/SiteContentContext'

const harness = vi.hoisted(() => ({ data: null as unknown as AppData, notify: vi.fn() }))
vi.mock('../contexts/DataContext', () => ({
  useData: () => ({ data: harness.data, upsert: vi.fn(), upsertMany: vi.fn(), remove: vi.fn(), refresh: vi.fn(), syncState: 'local', pendingCount: 0, syncError: null, undoAvailable: false, undoDelete: vi.fn(), dismissUndo: vi.fn(), saveImage: vi.fn(), updateSettings: vi.fn(async () => undefined) })
}))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ notify: harness.notify }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', isLocal: true, email: '' }, signOut: vi.fn() }) }))
vi.mock('../lib/report', () => ({ createPdfReport: vi.fn(), createDocxReport: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: null }))

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'
const chapter = (id: string, name: string): Chapter => ({ id, user_id: USER, subject: 'Physics', name, position: 0, status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW })
const test = (id: string, date: string): TestRecord => ({ id, user_id: USER, title: id, test_date: date, test_type: 'Chapter Test', subject: 'Physics', chapter_id: 'elec', marks_obtained: 10, total_marks: 20, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW })
const mistake = (id: string, createdAt: string) => ({ id, created_at: createdAt }) as unknown as Mistake
const session = (id: string, startedAt: string) => ({ id, started_at: startedAt }) as unknown as StudySession
const baseData = (overrides: Partial<AppData> = {}): AppData => ({
  chapters: [chapter('elec', 'Electrostatics')],
  studyCards: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
  practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], testErrorLogs: [], testTimeEntries: [],
  examTracks: defaultExamTracks(USER), settings: { ...defaultSettings(USER), user_id: USER, owner_name: 'Asha' }, profile: null, ...overrides
})
const renderAt = (ui: React.ReactElement, route = '/') => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>)

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('item 25: export record counts and dated report names', () => {
  it('PDF and DOCX names carry the date like the JSON and CSV exports', () => {
    expect(reportFileName('pdf', '2026-11-01')).toBe('stracker-study-report-2026-11-01.pdf')
    expect(reportFileName('docx', '2026-11-01')).toBe('stracker-study-report-2026-11-01.docx')
    expect(reportFileName('pdf')).toBe(`stracker-study-report-${indiaToday()}.pdf`)
  })

  it('counts every list in a backup and labels counts with correct plurals', () => {
    const data = baseData({ tests: [test('a', '2026-01-10'), test('b', '2026-02-10')] })
    // chapters (1) + tests (2) + default exam tracks
    expect(backupRecordCount(createBackup(data))).toBe(3 + data.examTracks.length)
    expect(backupRecordCount({ settings: {}, a: [1], b: [] })).toBe(1)
    expect(backupCountLabel(1)).toBe('1 record in this backup')
    expect(backupCountLabel(12)).toBe('12 records in this backup')
    expect(csvCountLabel(0)).toBe('0 tests in this export')
  })

  it('report counts use the same range filter as the report itself', () => {
    const data = baseData({
      tests: [test('a', '2026-01-10'), test('b', '2026-03-01')],
      mistakes: [mistake('m1', '2026-01-12T05:00:00.000Z'), mistake('m2', '2025-12-01T05:00:00.000Z')],
      sessions: [session('s1', '2026-01-11T05:00:00.000Z')]
    })
    const scoped = scopedReportData(data, '2026-01-01', '2026-01-31')
    expect([scoped.tests.length, scoped.mistakes.length, scoped.sessions.length]).toEqual([1, 1, 1])
    expect(reportCountLabel(data, '2026-01-01', '2026-01-31')).toBe('Covers 1 test, 1 mistake and 1 study session in this range.')
    expect(reportCountLabel(data, '', '')).toBe('Covers 2 tests, 2 mistakes and 1 study session in this range.')
  })

  it('Backup shows a count beside the JSON, CSV and PDF/DOCX exports', async () => {
    harness.data = baseData({ tests: [test('a', '2026-01-10'), test('b', '2099-12-31')] })
    const { default: BackupPage } = await import('./BackupPage')
    renderAt(<BackupPage />, '/backup')
    expect(screen.getByTestId('json-record-count').textContent).toBe(`${3 + harness.data.examTracks.length} records in this backup`)
    expect(screen.getByTestId('csv-record-count').textContent).toBe('1 test in this export')
    expect(screen.getByTestId('report-record-count').textContent).toBe('Covers 1 test, 0 mistakes and 0 study sessions in this range.')
  })
})

describe('item 26: Ask Stracker live progress', () => {
  it('moves from Thinking to Writing once text streams, but not after it stops running', () => {
    expect(progressAfterDelta('running', 'Thinking…')).toBe(WRITING_PROGRESS)
    expect(progressAfterDelta('fallback', 'Switching…')).toBe(WRITING_PROGRESS)
    expect(progressAfterDelta('waiting', 'Waiting for your confirmation.')).toBe('Waiting for your confirmation.')
    expect(progressAfterDelta('completed', 'Completed.')).toBe('Completed.')
    expect(RESTART_PROGRESS).toMatch(/again/)
  })

  it('formats elapsed time safely', () => {
    expect(elapsedSeconds('2026-11-01T00:00:00.000Z', Date.parse('2026-11-01T00:00:07.900Z'))).toBe(7)
    expect(elapsedSeconds('not a date', Date.now())).toBe(0)
    expect(elapsedSeconds('2026-11-01T00:00:10.000Z', Date.parse('2026-11-01T00:00:00.000Z'))).toBe(0)
    expect(formatElapsed(7)).toBe('7s')
    expect(formatElapsed(65)).toBe('1m 05s')
    expect(formatElapsed(Number.NaN)).toBe('0s')
  })

  it('the elapsed counter ticks every second while a request runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T00:00:03.000Z'))
    const { AITaskElapsed } = await import('../components/ai/AITaskElapsed')
    render(<AITaskElapsed startedAt="2026-11-01T00:00:00.000Z" />)
    expect(screen.getByTestId('ai-task-elapsed').textContent).toBe('3s')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByTestId('ai-task-elapsed').textContent).toBe('5s')
    expect(screen.getByTestId('ai-task-elapsed').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('item 27: Cmd+K arrow keys wrap', () => {
  it('wrapIndex wraps at both ends and is safe for empty lists', () => {
    expect(wrapIndex(2, 1, 3)).toBe(0)
    expect(wrapIndex(0, -1, 3)).toBe(2)
    expect(wrapIndex(1, 1, 3)).toBe(2)
    expect(wrapIndex(0, 1, 0)).toBe(0)
  })

  it('Up on the first result selects the last, Down on the last returns to the first', async () => {
    const data = baseData({ chapters: [chapter('a', 'Wave Optics'), chapter('b', 'Wave Motion'), chapter('c', 'Waves on Strings')] })
    const { GlobalSearch } = await import('../components/AppShell')
    renderAt(<GlobalSearch data={data} onClose={vi.fn()} />)
    const input = screen.getByLabelText('Search notebook')
    fireEvent.change(input, { target: { value: 'wave' } })
    const selectedLabel = () => document.querySelector('.search-result.selected strong')?.textContent
    expect(selectedLabel()).toBe('Wave Optics')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selectedLabel()).toBe('Waves on Strings')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedLabel()).toBe('Wave Optics')
    expect(document.querySelector('.search-result.selected')?.getAttribute('aria-current')).toBe('true')
  })
})

describe('item 28: optional footer Contact link', () => {
  const href = fieldDefinition('public.footer.contact.href')!

  it('ships with no contact address, so nothing is invented', () => {
    expect(SITE_CONTENT_DEFAULTS['public.footer.contact.href']).toBe('')
    expect(SITE_CONTENT_DEFAULTS['public.footer.contact.label']).toBe('Contact')
    expect(href.type).toBe('link')
    expect(href.optional).toBe(true)
  })

  it('accepts empty, one mailto address or an https page; rejects anything else', () => {
    expect(validateFieldValue(href, '')).toEqual({ ok: true, value: '' })
    expect(validateFieldValue(href, 'mailto:hello@example.com')).toEqual({ ok: true, value: 'mailto:hello@example.com' })
    expect(validateFieldValue(href, 'https://example.com/contact').ok).toBe(true)
    expect(validateFieldValue(href, 'mailto:a@example.com?subject=hi').ok).toBe(false)
    expect(validateFieldValue(href, 'mailto:a@example.com,b@example.com').ok).toBe(false)
    expect(validateFieldValue(href, 'http://example.com').ok).toBe(false)
    expect(validateFieldValue(href, 'javascript:alert(1)').ok).toBe(false)
  })

  it('other link fields still require a value and do not take mailto', () => {
    const other = { ...href, key: 'x', optional: undefined }
    expect(validateFieldValue(other, '').ok).toBe(false)
    expect(validateFieldValue(other, 'mailto:hello@example.com').ok).toBe(false)
  })

  it('classifies link kinds', () => {
    expect(contactLinkKind('')).toBe('none')
    expect(contactLinkKind('mailto:a@b.co')).toBe('email')
    expect(contactLinkKind('https://x.dev')).toBe('external')
    expect(contactLinkKind('/login')).toBe('route')
    expect(contactLinkKind('#privacy')).toBe('anchor')
  })

  it('the public footer hides Contact by default and shows it once the owner sets an address', async () => {
    const { PublicFooter } = await import('../components/public/PublicFooter')
    renderAt(<SiteContentProvider overrides={{}}><PublicFooter /></SiteContentProvider>)
    expect(screen.queryByRole('link', { name: 'Contact' })).toBeNull()
    cleanup()
    renderAt(<SiteContentProvider overrides={{ 'public.footer.contact.href': 'mailto:hello@example.com' }}><PublicFooter /></SiteContentProvider>)
    expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe('mailto:hello@example.com')
  })

  it('the notebook footer only ever links an email or https page', async () => {
    const { ContactLink } = await import('../components/public/ContactLink')
    renderAt(<SiteContentProvider overrides={{ 'public.footer.contact.href': '#privacy' }}><ContactLink addressOnly /></SiteContentProvider>)
    expect(screen.queryByRole('link', { name: 'Contact' })).toBeNull()
    cleanup()
    renderAt(<SiteContentProvider overrides={{ 'public.footer.contact.href': 'https://example.com/contact' }}><ContactLink addressOnly /></SiteContentProvider>)
    const link = screen.getByRole('link', { name: 'Contact' })
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('item 27 (text): Cmd+K result text wraps like the page lists', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8')
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return css.match(new RegExp(`${escaped} \\{([^}]*)\\}`))?.[1] ?? ''
  }

  it('titles wrap over up to three lines instead of a one-line ellipsis', () => {
    const strong = rule('.search-result-text strong')
    expect(strong).not.toMatch(/nowrap/)
    expect(strong).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(strong).toMatch(/white-space:\s*normal/)
    expect(strong).toMatch(/overflow-wrap:\s*anywhere/)
    expect(strong).toMatch(/-webkit-line-clamp:\s*3/)
    expect(rule('.search-result-text small')).toMatch(/overflow-wrap:\s*anywhere/)
    // The text column may shrink and the type label keeps its width, so the row layout holds on phones.
    expect(rule('.search-result-text')).toMatch(/min-width:\s*0/)
    expect(rule('.search-result-type')).toMatch(/flex:\s*none/)
  })

  it('a long title is rendered in full and also available as a tooltip', async () => {
    const long = 'A very long mistake note about the sign convention for spherical mirrors when the object sits between the focus and the pole and the image is virtual'
    const data = baseData({ chapters: [chapter('a', long)] })
    const { GlobalSearch } = await import('../components/AppShell')
    renderAt(<GlobalSearch data={data} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Search notebook'), { target: { value: 'spherical' } })
    const title = document.querySelector('.search-result-text strong')!
    expect(title.textContent).toBe(long)
    expect(title.getAttribute('title')).toBe(long)
  })
})

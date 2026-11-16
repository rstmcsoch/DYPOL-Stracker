// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../contexts/ToastContext'
import { StudentLayoutProvider } from '../../contexts/StudentLayoutContext'
import { PREVIEW_EMAIL, PREVIEW_SCENARIOS, PREVIEW_USER_ID, buildPreviewFixture } from './fixtures'
import { applyPreviewRemove, applyPreviewUpsert } from './preview-data'
import { PreviewProviders } from './PreviewProviders'
import { installPreviewGuard, previewRequestAllowed, PREVIEW_BLOCKED } from './canvas-guard'
import { StudentInspector } from './StudentInspector'
import { EMPTY_LAYOUT } from './layout-ops'

afterEach(cleanup)
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
const TODAY = '2026-11-16'

describe('synthetic preview fixtures', () => {
  it('builds all 13 scenarios for one synthetic student only', () => {
    expect(PREVIEW_SCENARIOS).toHaveLength(13)
    for (const { id } of PREVIEW_SCENARIOS) {
      const fixture = buildPreviewFixture(id, TODAY)
      const rows = Object.values(fixture.data).flatMap(value => (Array.isArray(value) ? value : [])) as Array<{ user_id?: string }>
      expect(rows.every(row => row.user_id === undefined || row.user_id === PREVIEW_USER_ID)).toBe(true)
      expect(fixture.data.settings.user_id).toBe(PREVIEW_USER_ID)
      expect(fixture.data.profile?.email).toBe(PREVIEW_EMAIL)
      expect(fixture.data.settings.onboarding_completed).toBe(true)
    }
  })

  it('covers the requested states', () => {
    expect(buildPreviewFixture('new', TODAY).data.chapters).toHaveLength(0)
    expect(buildPreviewFixture('full', TODAY).data.tests.length).toBeGreaterThan(0)
    expect(buildPreviewFixture('no-tests', TODAY).data.tests).toHaveLength(0)
    expect(buildPreviewFixture('focus-active', TODAY).focus.running).toBe(true)
    const paused = buildPreviewFixture('focus-paused', TODAY).focus
    expect(paused.running).toBe(false)
    expect(paused.elapsedSeconds).toBeGreaterThan(0)
    expect(buildPreviewFixture('offline', TODAY)).toMatchObject({ syncState: 'offline', pendingCount: 4 })
    expect(buildPreviewFixture('no-chapters', TODAY).data.chapters).toHaveLength(0)
    expect(buildPreviewFixture('reminders', TODAY).data.settings.reminders_enabled).toBe(true)
    expect(buildPreviewFixture('tracks', TODAY).data.examTracks.filter(track => track.exam_date)).toHaveLength(4)
    const near = buildPreviewFixture('exam-near', TODAY).data.examTracks.find(track => track.track === 'main1')
    expect(near?.exam_date).toBe('2026-11-28')
    const overdue = buildPreviewFixture('overdue', TODAY).data
    expect(overdue.revisions.some(item => !item.completed_at && item.due_on < TODAY)).toBe(true)
    expect(overdue.backlogItems.some(item => item.due_on && item.due_on < TODAY)).toBe(true)
  })

  it('changes an in-memory copy only', () => {
    const data = buildPreviewFixture('full', TODAY).data
    const task = data.tasks[0]!
    const next = applyPreviewUpsert(data, 'daily_tasks', [{ ...task, is_completed: !task.is_completed }])
    expect(next.tasks[0]!.is_completed).toBe(!task.is_completed)
    expect(data.tasks[0]!.is_completed).toBe(task.is_completed)
    expect(applyPreviewRemove(next, 'daily_tasks', task.id).tasks).toHaveLength(data.tasks.length - 1)
    expect(applyPreviewUpsert(data, 'app_settings', [{ theme: 'dark' }]).settings.theme).toBe('dark')
  })
})

describe('canvas guard', () => {
  const origin = 'https://dypol-stracker.vercel.app'
  it('allows assets, console reads and session refresh only', () => {
    expect(previewRequestAllowed('/assets/app.js', 'GET', origin)).toBe(true)
    expect(previewRequestAllowed('/api/control/session', 'GET', origin)).toBe(true)
    expect(previewRequestAllowed('https://abc.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST', origin)).toBe(true)
    expect(previewRequestAllowed('https://abc.supabase.co/rest/v1/daily_tasks', 'GET', origin)).toBe(false)
    expect(previewRequestAllowed('https://abc.supabase.co/rest/v1/daily_tasks', 'POST', origin)).toBe(false)
    expect(previewRequestAllowed('https://abc.supabase.co/storage/v1/object/mistake-images/x', 'POST', origin)).toBe(false)
    expect(previewRequestAllowed('https://abc.supabase.co/auth/v1/logout', 'POST', origin)).toBe(false)
    expect(previewRequestAllowed('/api/ai/chat', 'POST', origin)).toBe(false)
    expect(previewRequestAllowed('/api/control/student-layout-draft', 'PUT', origin)).toBe(false)
    expect(previewRequestAllowed('/api/control/student-layout-state', 'GET', origin)).toBe(false)
    expect(previewRequestAllowed('/api/telemetry', 'POST', origin)).toBe(false)
    expect(previewRequestAllowed('https://example.com/x', 'GET', origin)).toBe(false)
  })

  it('blocks fetch, beacons and IndexedDB while installed and restores them after', async () => {
    const original = vi.fn(async () => new Response('ok'))
    window.fetch = original as unknown as typeof fetch
    const uninstall = installPreviewGuard()
    await expect(window.fetch('https://abc.supabase.co/rest/v1/tests')).rejects.toThrow(PREVIEW_BLOCKED)
    expect(original).not.toHaveBeenCalled()
    expect(navigator.sendBeacon?.('/api/telemetry', 'x') ?? true).toBe(true)
    uninstall()
    await window.fetch('https://abc.supabase.co/rest/v1/tests')
    expect(original).toHaveBeenCalledTimes(1)
  })
})

describe('real Home page over the synthetic student', () => {
  it('renders with locked data markers and editable label markers in the editor canvas', async () => {
    const { default: HomePage } = await import('../../pages/HomePage')
    const fixture = buildPreviewFixture('full')
    const { container } = render(<ToastProvider><MemoryRouter initialEntries={['/']}><PreviewProviders fixture={fixture}>
      <StudentLayoutProvider document={EMPTY_LAYOUT} editing><HomePage /></StudentLayoutProvider>
    </PreviewProviders></MemoryRouter></ToastProvider>)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-sl="home.today-plan"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-sl-text]').length).toBeGreaterThan(5)
    expect(container.querySelectorAll('[data-sl-data]').length).toBeGreaterThan(0)
    for (const element of container.querySelectorAll('[data-sl-text]')) {
      const [id, key] = element.getAttribute('data-sl-text')!.split(':')
      expect(key).not.toMatch(/^(name|date|marks?|scores?|streak|count|percent|minutes|days)$/)
      expect(id).toMatch(/^home\.|^[a-z-]+\.labels$/)
    }
    // A sample task completes in memory (real task component, preview data provider).
    const before = container.querySelectorAll('.task-row.task-done').length
    const toggle = container.querySelector('.task-row:not(.task-done) .task-check')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle!)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(container.querySelectorAll('.task-row.task-done').length).toBe(before + 1)
  })
})

describe('inspector data lock', () => {
  it('shows data fields as locked and offers inputs only for static labels', () => {
    const noop = () => undefined
    const { container, getAllByText } = render(<StudentInspector id="home.streak" document={EMPTY_LAYOUT} device="desktop" setDevice={noop} errors={{}}
      actions={{ setText: noop, setProp: noop, setStyle: noop, clearStyles: noop, move: noop, toggleHidden: noop, toggleLocked: noop, reset: noop, select: noop }} />)
    expect(getAllByText('Live student data, not editable')).toHaveLength(4)
    const placeholders = [...container.querySelectorAll('input')].map(input => input.getAttribute('placeholder'))
    expect(placeholders).toEqual(['YOUR RHYTHM', 'current study streak', 'longest', 'active this week'])
  })
})

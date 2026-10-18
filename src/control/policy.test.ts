import { describe, expect, it } from 'vitest'
import { activeNavItem, ALL_NAV_ITEMS, breadcrumbsFor, idleState, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, NAV_GROUPS, secondsUntilIdle, shortId } from './policy'

describe('console navigation', () => {
  it('lists every implemented section exactly once, as a relative segment under /control-panel', () => {
    const segments = ALL_NAV_ITEMS.map(item => item.to)
    expect(new Set(segments).size).toBe(segments.length)
    for (const segment of segments) expect(segment).not.toMatch(/^\/|\s/)
    expect(NAV_GROUPS.length).toBeGreaterThan(0)
    expect(ALL_NAV_ITEMS[0]?.to).toBe('')
  })

  it('resolves the active item for nested pages, and no item for unknown paths', () => {
    expect(activeNavItem('/control-panel/users/abc')?.to).toBe('users')
    expect(activeNavItem('/control-panel')?.to).toBe('')
    expect(activeNavItem('/control-panel/not-a-section')).toBeNull()
  })

  it('builds breadcrumbs that end on the current page', () => {
    const crumbs = breadcrumbsFor('/control-panel/users/abc', 'Ada')
    expect(crumbs.at(-1)?.label).toBe('Ada')
    expect(breadcrumbsFor('/control-panel/audit').some(crumb => crumb.label.toLowerCase().includes('audit'))).toBe(true)
  })
})

describe('idle policy', () => {
  const start = 1_000_000_000_000

  it('is active until the warning window, warns, then expires at the timeout', () => {
    expect(idleState(start, start + 1000)).toBe('active')
    expect(idleState(start, start + IDLE_TIMEOUT_MS - IDLE_WARNING_MS + 1)).toBe('warning')
    expect(idleState(start, start + IDLE_TIMEOUT_MS)).toBe('expired')
  })

  it('reports whole seconds remaining and never a negative value', () => {
    expect(secondsUntilIdle(start, start)).toBe(IDLE_TIMEOUT_MS / 1000)
    expect(secondsUntilIdle(start, start + IDLE_TIMEOUT_MS + 5000)).toBe(0)
  })
})

describe('display helpers', () => {
  it('shortens identifiers without exposing the whole value in the label', () => {
    const id = '11111111-2222-4333-8444-555555555555'
    expect(shortId(id)).not.toBe(id)
    expect(shortId(id).length).toBeLessThan(id.length)
  })
})

describe('document titles', () => {
  it('names the page first and the console second, and follows client-side navigation', async () => {
    const { documentTitleFor, CONSOLE_NAME } = await import('./policy')
    expect(CONSOLE_NAME).toBe('Stracker Control Center')
    expect(documentTitleFor('/control-panel')).toBe('Overview · Stracker Control Center')
    expect(documentTitleFor('/control-panel/')).toBe('Overview · Stracker Control Center')
    expect(documentTitleFor('/control-panel/audit')).toBe('Audit log · Stracker Control Center')
    expect(documentTitleFor('/control-panel/about')).toBe('Help & About · Stracker Control Center')
    expect(documentTitleFor('/control-panel/users/abc', 'Ada')).toBe('Ada · Users · Stracker Control Center')
    expect(documentTitleFor('/control-panel/not-a-section')).toBe('Stracker Control Center')
  })
})

describe('time formatting', () => {
  it('labels a reporting window as an inclusive range of calendar days', async () => {
    const { formatDayRange } = await import('./policy')
    const now = new Date('2026-10-10T12:00:00Z')
    expect(formatDayRange('2026-10-04', '2026-10-10', now)).toBe('Oct 4 – Oct 10')
    expect(formatDayRange('2026-10-10', '2026-10-10', now)).toBe('Oct 10')
    expect(formatDayRange('2025-12-28', '2026-01-03', now)).toMatch(/Dec 28, 2025 – Jan 3, 2026/)
    expect(formatDayRange('bad', '2026-01-03', now)).toBe('—')
  })

  it('renders an instant in the requested zone and never silently falls back to a different one', async () => {
    const { formatDateTime, formatDateTimeFull, zoneShortLabel } = await import('./policy')
    const instant = '2026-10-09T23:30:00Z'
    expect(formatDateTime(instant, 'UTC')).toMatch(/Oct 9/)
    expect(formatDateTime(instant, 'Asia/Kolkata')).toMatch(/Oct 10/)
    expect(formatDateTimeFull(instant, 'UTC')).toMatch(/UTC/)
    expect(zoneShortLabel('UTC')).toBe('UTC')
    expect(zoneShortLabel('Asia/Kolkata', new Date(instant))).toMatch(/GMT\+5:30|IST/)
    expect(formatDateTime(null, 'UTC')).toBe('—')
  })

  it('formats relative times and countdowns consistently', async () => {
    const { formatRelative, formatCountdown } = await import('./policy')
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(formatRelative('2026-10-10T11:59:50Z', now)).toBe('Just now')
    expect(formatRelative('2026-10-10T11:55:00Z', now)).toBe('5 min ago')
    expect(formatRelative('2026-10-10T09:00:00Z', now)).toBe('3 h ago')
    expect(formatRelative(null, now)).toBe('Never')
    expect(formatCountdown(125)).toBe('2:05')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-3)).toBe('0:00')
  })
})

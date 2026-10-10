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

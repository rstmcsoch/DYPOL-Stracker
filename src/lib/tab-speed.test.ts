import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { cachedDateFormat, indiaDate } from './date'
import { fmtNumber } from './format'
import { makeStudyBars, makeStudyHeatmap } from './study-aggregation'
import { isPlainClick, navMatches, setPendingNav } from './nav-pending'
import type { StudySession } from '../types'

const viaIntl = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const part = (type: string) => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

describe('fast India dates', () => {
  it('matches the Intl Asia/Kolkata calendar date for many instants, including the 18:30 UTC rollover', () => {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let index = 0; index < 2000; index += 1) {
      const instant = new Date(Date.UTC(1950, 0, 1) + Math.floor(rnd() * 120 * 365 * 86_400_000))
      expect(indiaDate(instant)).toBe(viaIntl(instant))
      expect(indiaDate(instant.toISOString())).toBe(viaIntl(instant))
    }
    expect(indiaDate('2026-03-31T18:29:59.999Z')).toBe('2026-03-31')
    expect(indiaDate('2026-03-31T18:30:00.000Z')).toBe('2026-04-01')
    expect(indiaDate('2024-02-28T18:30:00Z')).toBe('2024-02-29')
  })

  it('keeps the old fallbacks for invalid and pre-1946 values', () => {
    expect(indiaDate('not a date')).toBe('not a date')
    expect(indiaDate(new Date(Number.NaN))).toBe('')
    const old = new Date(Date.UTC(1940, 5, 1, 20))
    expect(indiaDate(old)).toBe(viaIntl(old))
  })

  it('reuses Intl formatters instead of constructing one per call', () => {
    expect(cachedDateFormat('en-IN', { day: 'numeric', month: 'short' })).toBe(cachedDateFormat('en-IN', { day: 'numeric', month: 'short' }))
    const spy = vi.spyOn(Intl, 'NumberFormat')
    fmtNumber(1234.5, 1); fmtNumber(99, 1); fmtNumber(12345, 1)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
    expect(fmtNumber(123456)).toBe('1,23,456')
    spy.mockRestore()
  })
})

describe('study aggregation over a year of sessions', () => {
  const asOf = '2026-11-15'
  const sessions = Array.from({ length: 1500 }, (_, index) => {
    const start = new Date(Date.UTC(2026, 10, 15, 4) - Math.floor(index / 4) * 86_400_000 - (index % 4) * 3_600_000)
    return { id: `s${index}`, started_at: start.toISOString(), duration_minutes: 30 + (index % 3) * 10 } as StudySession
  })
  const intlDates = sessions.map(session => viaIntl(new Date(session.started_at)))
  const slowMinutes = (start: string, end: string) => sessions.reduce((sum, session, index) => {
    const date = intlDates[index]!
    return date >= start && date <= end ? sum + session.duration_minutes : sum
  }, 0)

  it('returns the same heatmap and bars as a per-cell scan, quickly', () => {
    const started = performance.now()
    const heatmap = makeStudyHeatmap(sessions, 240, asOf)
    const day = makeStudyBars(sessions, 'day', asOf)
    const week = makeStudyBars(sessions, 'week', asOf)
    const month = makeStudyBars(sessions, 'month', asOf)
    expect(performance.now() - started).toBeLessThan(250)
    for (const cell of heatmap.cells) expect(cell.minutes).toBe(cell.future ? 0 : slowMinutes(cell.date, cell.date))
    for (const bar of day) expect(bar.hours).toBe(Math.round(slowMinutes(bar.date, bar.date) / 60 * 10) / 10)
    expect(week).toHaveLength(8)
    expect(month).toHaveLength(6)
    expect(month.at(-1)!.hours).toBe(Math.round(slowMinutes('2026-11-01', asOf) / 60 * 10) / 10)
  })
})

describe('tab taps', () => {
  it('matches routes like NavLink', () => {
    expect(navMatches('/', '/')).toBe(true)
    expect(navMatches('/', '/tests')).toBe(false)
    expect(navMatches('/tests', '/tests')).toBe(true)
    expect(navMatches('/tests', '/tests/abc')).toBe(true)
    expect(navMatches('/tests', '/tests/abc', true)).toBe(false)
    expect(navMatches('/test', '/tests')).toBe(false)
  })

  it('only treats a plain primary click as an in-tab navigation', () => {
    const base = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false }
    expect(isPlainClick(base)).toBe(true)
    expect(isPlainClick({ ...base, metaKey: true })).toBe(false)
    expect(isPlainClick({ ...base, button: 1 })).toBe(false)
    expect(isPlainClick({ ...base, defaultPrevented: true })).toBe(false)
    setPendingNav(null)
  })

  it('routes share memoised chunk loaders with the prefetcher, and the shell warms them', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/const AnalyticsPage = lazy\(routeLoaders\['\/analytics'\]\)/)
    expect(app).toMatch(/const TestsPage = lazy\(routeLoaders\['\/tests'\]\)/)
    const shell = readFileSync('src/components/AppShell.tsx', 'utf8')
    expect(shell).toContain('preloadAppRoutesWhenIdle()')
    expect(shell).toContain('onPointerDown: warm')
    expect(shell).toContain('setPendingNav(null)')
  })
})

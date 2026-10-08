import { describe, expect, it } from 'vitest'
import { indiaDate, plusDays } from './date'

describe('calendar and India-local dates', () => {
  it('formats UTC instants using the India calendar date, including midnight rollover', () => {
    expect(indiaDate('2026-10-07T20:00:00.000Z')).toBe('2026-10-08')
    expect(indiaDate('2026-10-08T00:00:00.000Z')).toBe('2026-10-08')
  })

  it('adds whole days across month and leap-day boundaries', () => {
    expect(plusDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(plusDays('2024-02-28', 1)).toBe('2024-02-29')
  })
})

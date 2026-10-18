import { describe, expect, it } from 'vitest'
import {
  dayKeyInZone,
  dayRangeInZone,
  inclusiveLastDay,
  isValidTimeZone,
  parseTimeZone,
  reportingWindow,
  shiftDayKey,
  startOfDayInZone,
  zoneOffsetMs
} from './time-window'

const HOUR = 60 * 60 * 1000

describe('time zone validation', () => {
  it('accepts real IANA zones and UTC', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true)
  })

  it('rejects injection-shaped, oversized and unknown values and falls back to UTC', () => {
    expect(isValidTimeZone("Asia/Kolkata' OR 1=1")).toBe(false)
    expect(isValidTimeZone('Not/A_Zone')).toBe(false)
    expect(isValidTimeZone('a'.repeat(80))).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
    expect(parseTimeZone('Mars/Olympus')).toBe('UTC')
    expect(parseTimeZone(null)).toBe('UTC')
    expect(parseTimeZone('Europe/London')).toBe('Europe/London')
  })
})

describe('day boundaries in a zone', () => {
  it('starts a UTC day at midnight Z', () => {
    expect(startOfDayInZone('2026-10-04', 'UTC').toISOString()).toBe('2026-10-04T00:00:00.000Z')
  })

  it('starts an Asia/Kolkata day at 18:30 Z the previous evening', () => {
    expect(startOfDayInZone('2026-10-04', 'Asia/Kolkata').toISOString()).toBe('2026-10-03T18:30:00.000Z')
    expect(zoneOffsetMs(Date.UTC(2026, 9, 4), 'Asia/Kolkata')).toBe(5.5 * HOUR)
  })

  it('classifies instants either side of a local midnight into the right day', () => {
    expect(dayKeyInZone(Date.parse('2026-10-03T18:29:59.999Z'), 'Asia/Kolkata')).toBe('2026-10-03')
    expect(dayKeyInZone(Date.parse('2026-10-03T18:30:00.000Z'), 'Asia/Kolkata')).toBe('2026-10-04')
    expect(dayKeyInZone(Date.parse('2026-10-04T03:59:59.000Z'), 'America/New_York')).toBe('2026-10-03')
    expect(dayKeyInZone(Date.parse('2026-10-04T04:00:00.000Z'), 'America/New_York')).toBe('2026-10-04')
  })

  it('handles the spring-forward transition (Europe/London, 29 March 2026)', () => {
    // 29 March 2026 is 23 hours long in London: clocks move 01:00 -> 02:00 UTC.
    const start = startOfDayInZone('2026-03-29', 'Europe/London')
    const next = startOfDayInZone('2026-03-30', 'Europe/London')
    expect(start.toISOString()).toBe('2026-03-29T00:00:00.000Z')
    expect(next.toISOString()).toBe('2026-03-29T23:00:00.000Z')
    expect(next.getTime() - start.getTime()).toBe(23 * HOUR)
  })

  it('handles the fall-back transition (America/New_York, 1 November 2026)', () => {
    // 1 November 2026 is 25 hours long in New York.
    const start = startOfDayInZone('2026-11-01', 'America/New_York')
    const next = startOfDayInZone('2026-11-02', 'America/New_York')
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(next.toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(next.getTime() - start.getTime()).toBe(25 * HOUR)
  })

  it('returns the first existing instant when midnight falls into a DST gap (America/Santiago)', () => {
    // Chile moves clocks forward at 24:00 on the first Saturday of September: 00:00 does not exist.
    const start = startOfDayInZone('2026-09-06', 'America/Santiago')
    expect(dayKeyInZone(start, 'America/Santiago')).toBe('2026-09-06')
    expect(dayKeyInZone(start.getTime() - 1, 'America/Santiago')).toBe('2026-09-05')
  })

  it('shifts day keys across month and year ends', () => {
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDayKey('2028-03-01', -1)).toBe('2028-02-29')
  })
})

describe('reporting windows', () => {
  it('builds the last seven calendar days ending today in the zone, with an exclusive end', () => {
    const now = new Date('2026-10-10T02:30:00.000Z') // 08:00 in Kolkata, still 9 October in New York
    const kolkata = reportingWindow('7d', now, 'Asia/Kolkata')
    expect(kolkata.firstDay).toBe('2026-10-04')
    expect(kolkata.lastDay).toBe('2026-10-10')
    expect(kolkata.days).toHaveLength(7)
    expect(kolkata.since.toISOString()).toBe('2026-10-03T18:30:00.000Z')
    expect(kolkata.until.toISOString()).toBe('2026-10-10T18:30:00.000Z')

    const newYork = reportingWindow('7d', now, 'America/New_York')
    expect(newYork.lastDay).toBe('2026-10-09')
    expect(newYork.firstDay).toBe('2026-10-03')
  })

  it('reports the inclusive last day for a stored exclusive end', () => {
    expect(inclusiveLastDay('2026-10-11T00:00:00.000Z', 'UTC')).toBe('2026-10-10')
    expect(inclusiveLastDay('2026-10-10T18:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-10')
  })

  it('turns an inclusive from/to day pair into a half-open instant range', () => {
    const range = dayRangeInZone('2026-10-04', '2026-10-10', 'UTC')
    expect(range.from?.toISOString()).toBe('2026-10-04T00:00:00.000Z')
    expect(range.to?.toISOString()).toBe('2026-10-11T00:00:00.000Z')
    expect(dayRangeInZone(null, null, 'UTC')).toEqual({ from: null, to: null })
  })
})

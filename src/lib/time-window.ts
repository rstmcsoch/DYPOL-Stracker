/**
 * Calendar-day arithmetic for the Stracker Control Center.
 *
 * Time-zone policy (documented in docs/control-center.md):
 *   - Timestamps are stored and transported in UTC (ISO 8601 with a Z suffix).
 *   - Reporting windows and date filters are whole calendar days in one explicit IANA zone.
 *     The browser sends the zone it displays in (`tz`), the server validates it, and both
 *     sides compute identical boundaries with the helpers below.
 *   - Window boundaries are half-open: [start of first day, start of the day after the last day).
 *     Humans see the inclusive form ("Oct 4 – Oct 10"); the exclusive end stays in the query.
 *
 * This module is pure (no network, no globals except Intl) so it runs identically in the Vercel
 * function and in the browser, and can be unit-tested across DST transitions.
 */

export const UTC_ZONE = 'UTC'
const DAY_MS = 24 * 60 * 60 * 1000
const ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]{0,30}(?:\/[A-Za-z0-9_+-]{1,30}){0,2}$/
const formatterCache = new Map<string, Intl.DateTimeFormat>()

/** Accepts only a syntactically bounded IANA zone that this runtime's Intl data knows. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !ZONE_PATTERN.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** Validated zone or UTC. Never throws, so an unexpected client value cannot break a request. */
export function parseTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : UTC_ZONE
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

export interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock reading of an instant in a zone. */
export function wallClock(instant: Date | number, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(typeof instant === 'number' ? new Date(instant) : instant)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? '0')
  // Some engines report midnight as hour 24 under h23 for certain zones; normalize.
  const hour = read('hour') % 24
  return { year: read('year'), month: read('month'), day: read('day'), hour, minute: read('minute'), second: read('second') }
}

/** Offset of a zone from UTC at an instant, in milliseconds (positive east of Greenwich). */
export function zoneOffsetMs(instant: Date | number, timeZone: string): number {
  const ms = typeof instant === 'number' ? instant : instant.getTime()
  const clock = wallClock(ms, timeZone)
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** YYYY-MM-DD for an instant as seen in a zone. */
export function dayKeyInZone(instant: Date | number, timeZone: string): string {
  const clock = wallClock(instant, timeZone)
  return `${String(clock.year).padStart(4, '0')}-${String(clock.month).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/**
 * The instant at which the calendar day `YYYY-MM-DD` begins in a zone.
 * Correct across daylight-saving changes: the offset is resolved twice so a guess made with
 * the wrong side of a transition is corrected. If midnight itself does not exist (a DST gap
 * at 00:00), the first instant that does exist on that day is returned.
 */
export function startOfDayInZone(dayKey: string, timeZone: string): Date {
  if (!isDayKey(dayKey)) throw new RangeError('startOfDayInZone expects YYYY-MM-DD')
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  const wall = Date.UTC(year, month - 1, day)
  const first = wall - zoneOffsetMs(wall, timeZone)
  const second = wall - zoneOffsetMs(first, timeZone)
  const candidate = dayKeyInZone(second, timeZone) === dayKey ? second : Math.max(first, second)
  // Verify the candidate really lands on the requested day; otherwise walk forward out of a gap.
  let instant = candidate
  for (let step = 0; step < 4 && dayKeyInZone(instant, timeZone) < dayKey; step += 1) instant += 15 * 60 * 1000
  return new Date(instant)
}

/** The day key `days` calendar days after `dayKey` (negative moves backwards). */
export function shiftDayKey(dayKey: string, days: number): string {
  if (!isDayKey(dayKey)) throw new RangeError('shiftDayKey expects YYYY-MM-DD')
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Half-open instant range covering the inclusive day span [fromDay, toDay] in a zone. */
export function dayRangeInZone(fromDay: string | null, toDay: string | null, timeZone: string): { from: Date | null; to: Date | null } {
  return {
    from: fromDay ? startOfDayInZone(fromDay, timeZone) : null,
    to: toDay ? startOfDayInZone(shiftDayKey(toDay, 1), timeZone) : null
  }
}

export const REPORTING_RANGES = { today: 1, '7d': 7, '30d': 30 } as const
export type ReportingRangeKey = keyof typeof REPORTING_RANGES

export function parseReportingRange(value: unknown): ReportingRangeKey {
  return value === 'today' || value === '7d' || value === '30d' ? value : '7d'
}

export interface ReportingWindow {
  key: ReportingRangeKey
  timeZone: string
  /** Inclusive first calendar day. */
  firstDay: string
  /** Inclusive last calendar day (today in the zone). */
  lastDay: string
  /** Half-open instants used by queries. */
  since: Date
  until: Date
  /** Every calendar day in the window, oldest first. */
  days: string[]
}

/** The last N calendar days ending today, in the given zone. */
export function reportingWindow(key: ReportingRangeKey, now: Date, timeZone: string): ReportingWindow {
  const length = REPORTING_RANGES[key]
  const lastDay = dayKeyInZone(now, timeZone)
  const firstDay = shiftDayKey(lastDay, -(length - 1))
  const days = Array.from({ length }, (_, index) => shiftDayKey(firstDay, index))
  return {
    key,
    timeZone,
    firstDay,
    lastDay,
    since: startOfDayInZone(firstDay, timeZone),
    until: startOfDayInZone(shiftDayKey(lastDay, 1), timeZone),
    days
  }
}

/** Last calendar day covered by a half-open window whose `until` is a start-of-day instant. */
export function inclusiveLastDay(untilExclusive: Date | string, timeZone: string): string {
  const until = typeof untilExclusive === 'string' ? Date.parse(untilExclusive) : untilExclusive.getTime()
  // One millisecond before the exclusive end is always inside the last day.
  return dayKeyInZone(until - 1, timeZone)
}

export { DAY_MS }

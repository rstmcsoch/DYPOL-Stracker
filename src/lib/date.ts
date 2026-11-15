import { addDays, format, parseISO } from 'date-fns'

export const INDIA_TIME_ZONE = 'Asia/Kolkata'

/** Constructing Intl formatters is slow (tens of µs each); reuse one per locale + options. */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
export function cachedDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = dateFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    dateFormatterCache.set(key, formatter)
  }
  return formatter
}

/** India Standard Time has been a fixed UTC+05:30 with no daylight saving since 1945. */
const IST_OFFSET_MS = 330 * 60_000
const IST_FIXED_FROM = Date.UTC(1946, 0, 1)
const IST_FIXED_UNTIL = Date.UTC(9999, 0, 1)

export function indiaDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (Number.isNaN(time)) return typeof value === 'string' ? value.slice(0, 10) : ''
  if (time >= IST_FIXED_FROM && time < IST_FIXED_UNTIL) return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 10)
  const parts = cachedDateFormat('en-GB', { timeZone: INDIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function indiaToday(): string {
  return indiaDate(new Date())
}

export function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10)
  return format(value, 'yyyy-MM-dd')
}

export function plusDays(date: string, days: number): string {
  return format(addDays(parseISO(`${date}T12:00:00`), days), 'yyyy-MM-dd')
}

export function prettyDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return cachedDateFormat('en-IN', options ?? { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const target = new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
  const today = new Date(`${indiaToday()}T00:00:00Z`).getTime()
  return Math.ceil((target - today) / 86_400_000)
}

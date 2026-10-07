import { addDays, format, parseISO } from 'date-fns'

export const INDIA_TIME_ZONE = 'Asia/Kolkata'

export function indiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
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
  return new Intl.DateTimeFormat('en-IN', options ?? { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const target = new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
  const today = new Date(`${indiaToday()}T00:00:00Z`).getTime()
  return Math.ceil((target - today) / 86_400_000)
}

/**
 * Typed-date and typed-time helpers shared by Settings, the Planner and any other form
 * that lets a student type, paste or step through a date/time instead of only picking it.
 */

export const MIN_INPUT_YEAR = 1900
export const MAX_INPUT_YEAR = 2100
export const MIN_INPUT_DATE = `${MIN_INPUT_YEAR}-01-01`
export const MAX_INPUT_DATE = `${MAX_INPUT_YEAR}-12-31`
export const DATE_RANGE_MESSAGE = `Enter a real date with a year between ${MIN_INPUT_YEAR} and ${MAX_INPUT_YEAR}.`

function buildIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < MIN_INPUT_YEAR || year > MAX_INPUT_YEAR || month < 1 || month > 12 || day < 1) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True for a real calendar date written as YYYY-MM-DD with a four-digit year in range. */
export function isValidInputDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return Boolean(match && buildIso(Number(match[1]), Number(match[2]), Number(match[3])) === value)
}

/**
 * Parse a typed or pasted date. Accepts 2025-06-15, 2025/6/15, 15/06/2025, 15-06-2025 and
 * 15.06.2025 (day first, as written in India). Returns YYYY-MM-DD, or null when the text is
 * not a real date or the year is outside 1900–2100 — never a corrupted five-digit year.
 */
export function parseDateText(text: string): string | null {
  const value = text.trim()
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value)
  if (match) return buildIso(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value)
  if (match) return buildIso(Number(match[3]), Number(match[2]), Number(match[1]))
  return null
}

/** Normalise "8:30", "0830", "830", "8", "8:30 pm", "8pm" or "20.30" to HH:MM (24-hour). */
export function parseTimeText(text: string): string | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ')
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)?$/.exec(value)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = match[2] === undefined ? 0 : Number(match[2])
  const meridiem = match[3]?.startsWith('p') ? 'pm' : match[3]?.startsWith('a') ? 'am' : null
  if (minutes > 59) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    if (meridiem === 'am') hours = hours === 12 ? 0 : hours
    else hours = hours === 12 ? 12 : hours + 12
  }
  if (hours > 23) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * Step a HH:MM time by a number of minutes, wrapping around midnight. Positive steps move
 * later (ArrowUp), negative steps earlier (ArrowDown). Steps snap to the step size first so
 * 08:03 + 5 becomes 08:05, not 08:08.
 */
export function stepTime(value: string, deltaMinutes: number): string {
  const parsed = parseTimeText(value) ?? '08:00'
  const [hours, minutes] = parsed.split(':').map(Number) as [number, number]
  const step = Math.abs(deltaMinutes) || 1
  const total = hours * 60 + minutes
  const snapped = deltaMinutes > 0 ? Math.floor(total / step) * step + step : Math.ceil(total / step) * step - step
  const wrapped = ((snapped % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

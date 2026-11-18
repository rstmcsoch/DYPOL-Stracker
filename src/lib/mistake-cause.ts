import type { ErrorCategory, MistakeType } from '../types/index.js'
import { ERROR_CATEGORIES } from '../types/index.js'

/**
 * One vocabulary for "why did I lose this mark".
 *
 * The app used to keep two: the mistake notebook's short `MistakeType`
 * (Concept / Silly / Calculation / Time / Guess) and the mock deep-dive's
 * `ErrorCategory` (Silly mistake / Concept gap / Calculation error / Time pressure /
 * Misread question / Guess / Unattempted). The same slip got a different label depending
 * on which page it was captured on, so the two could never be added up.
 *
 * `cause` is the richer category and is the one all new analysis reads. The short type is
 * still stored on every mistake (the database check constraint requires it), derived from
 * the cause, so old rows, exports and the AI tools keep working unchanged.
 */

/** The short notebook label each detailed cause collapses to. Derived, never stored twice. */
export const CAUSE_TO_TYPE: Record<ErrorCategory, MistakeType> = {
  'Concept gap': 'Concept',
  'Silly mistake': 'Silly',
  'Calculation error': 'Calculation',
  'Misread question': 'Silly',
  'Time pressure': 'Time',
  'Guess / bad attempt': 'Guess',
  Unattempted: 'Guess'
}

/** Notebook types have no finer detail, so each maps to its most honest cause. */
export const TYPE_TO_CAUSE: Record<MistakeType, ErrorCategory> = {
  Concept: 'Concept gap',
  Silly: 'Silly mistake',
  Calculation: 'Calculation error',
  Time: 'Time pressure',
  Guess: 'Guess / bad attempt'
}

/** Causes offered in the notebook dialog, in the order a student is likely to scan them. */
export const MISTAKE_CAUSES: readonly ErrorCategory[] = ERROR_CATEGORIES

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === 'string' && (ERROR_CATEGORIES as readonly string[]).includes(value)
}

/** The stored type for a chosen cause, so the two can never drift apart. */
export function typeForCause(cause: ErrorCategory): MistakeType {
  return CAUSE_TO_TYPE[cause]
}

/**
 * The cause to display for a mistake. Rows saved before `cause` existed fall back to the
 * cause their `mistake_type` implies; an unknown stored cause is ignored rather than shown.
 */
export function causeOf(mistake: { cause?: ErrorCategory | null; mistake_type: MistakeType }): ErrorCategory {
  return isErrorCategory(mistake.cause) ? mistake.cause : TYPE_TO_CAUSE[mistake.mistake_type] ?? 'Concept gap'
}

export interface CauseCount {
  cause: ErrorCategory
  mistakes: number
  logs: number
  total: number
}

/**
 * One combined tally across the mistake notebook and every mock's lost-mark classifications,
 * so "Silly 42%, Concept 31%" means the same thing everywhere.
 */
export function causeTotals(
  mistakes: ReadonlyArray<{ cause?: ErrorCategory | null; mistake_type: MistakeType }>,
  logs: ReadonlyArray<{ category: ErrorCategory }>
): CauseCount[] {
  const counts = new Map<ErrorCategory, CauseCount>()
  for (const mistake of mistakes) {
    const cause = causeOf(mistake)
    const row = counts.get(cause) ?? { cause, mistakes: 0, logs: 0, total: 0 }
    row.mistakes += 1
    counts.set(cause, row)
  }
  for (const log of logs) {
    if (!isErrorCategory(log.category)) continue
    const row = counts.get(log.category) ?? { cause: log.category, mistakes: 0, logs: 0, total: 0 }
    row.logs += 1
    counts.set(log.category, row)
  }
  for (const row of counts.values()) row.total = row.mistakes + row.logs
  return [...counts.values()].sort((a, b) => b.total - a.total || MISTAKE_CAUSES.indexOf(a.cause) - MISTAKE_CAUSES.indexOf(b.cause))
}

/** Days between the first attempt and the first spaced retry, then the second. */
export const RETRY_GAP_DAYS = [7, 21] as const

/**
 * IST-safe date maths, so a retry never lands on the wrong calendar day.
 * The input may be a date (`yyyy-mm-dd`) or a full timestamp; a timestamp is converted to its
 * IST calendar date first, because a 23:30 IST study note is stored as the previous UTC day.
 */
function addDays(value: string, days: number): string {
  const istDate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  const date = new Date(`${istDate}T12:00:00+05:30`)
  date.setUTCDate(date.getUTCDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/**
 * Where a note's next retry belongs.
 *
 * Rows saved before `retry_due_on` existed fall back to `created_at`, so opening an old
 * notebook does not put every note in "due today" at once. After a second retry the note
 * stops being scheduled — at that point the student either knows it or needs a different fix.
 */
export function retryDueOn(mistake: { retry_due_on?: string | null; retry_count?: number; created_at: string }): string | null {
  if (mistake.retry_due_on) return mistake.retry_due_on
  const count = mistake.retry_count ?? 0
  if (count >= RETRY_GAP_DAYS.length) return null
  return addDays(mistake.created_at, RETRY_GAP_DAYS[count] ?? RETRY_GAP_DAYS[0])
}

/** True when a note in the retry list is due now (or was due earlier). */
export function retryIsDue(mistake: Parameters<typeof retryDueOn>[0], today: string): boolean {
  const due = retryDueOn(mistake)
  return due !== null && due <= today
}

/** The patch applied when a retry is completed: next gap, or off the list after the last one. */
export function advanceRetry(today: string, count: number): { retry_count: number; retry_due_on: string | null; retry_status: 'pending' | 'retried'; retry_later: boolean } {
  const next = count + 1
  if (next >= RETRY_GAP_DAYS.length) return { retry_count: next, retry_due_on: null, retry_status: 'retried', retry_later: false }
  return { retry_count: next, retry_due_on: addDays(today, RETRY_GAP_DAYS[next]!), retry_status: 'pending', retry_later: true }
}

/** A note joining the retry list for the first time gets its first due date immediately. */
export function startRetry(today: string, count: number): { retry_due_on: string; retry_count: number } {
  return { retry_due_on: addDays(today, RETRY_GAP_DAYS[count] ?? RETRY_GAP_DAYS[0]), retry_count: count }
}

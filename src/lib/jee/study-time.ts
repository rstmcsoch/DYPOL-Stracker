import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import { indiaDate } from '../date.js'
import type { AppData, StudyActivity } from '../../types/index.js'

/** The three categories shown prominently; the others are tracked but grouped under "Other". */
export const PRIMARY_ACTIVITIES: StudyActivity[] = ['Lecture', 'Practice', 'Revision']

export interface ActivityMinutes {
  Lecture: number
  Practice: number
  Revision: number
  'Mock/Test': number
  'PYQ practice': number
  total: number
}

const emptyMinutes = (): ActivityMinutes => ({ Lecture: 0, Practice: 0, Revision: 0, 'Mock/Test': 0, 'PYQ practice': 0, total: 0 })

function activityOf(value: string | undefined): StudyActivity {
  return (value ?? 'Practice') as StudyActivity
}

/**
 * Minutes per activity between two inclusive IST dates. Only recorded study sessions
 * count; legacy sessions without an activity are treated as Practice (their default).
 */
export function studyMinutesByActivity(data: AppData, from: string, to: string): ActivityMinutes {
  const totals = emptyMinutes()
  for (const session of data.sessions) {
    const day = indiaDate(session.started_at)
    if (day < from || day > to) continue
    const activity = activityOf(session.activity)
    totals[activity] += session.duration_minutes
    totals.total += session.duration_minutes
  }
  return totals
}

export function weekRange(today: string): { start: string; end: string } {
  const monday = startOfWeek(parseISO(`${today}T12:00:00`), { weekStartsOn: 1 })
  return { start: format(monday, 'yyyy-MM-dd'), end: today }
}

export function previousWeekRange(today: string): { start: string; end: string } {
  const current = weekRange(today)
  const prevEnd = format(addDays(parseISO(`${current.start}T12:00:00`), -1), 'yyyy-MM-dd')
  const prevStart = format(addDays(parseISO(`${prevEnd}T12:00:00`), -6), 'yyyy-MM-dd')
  return { start: prevStart, end: prevEnd }
}

/* ------------------------------------------------------------------ */
/* Streaks — a day counts only when the app recorded meaningful study   */
/* ------------------------------------------------------------------ */

/** Minimum recorded study minutes in a day for it to count toward a streak. */
export const STREAK_MIN_MINUTES = 15

/**
 * Activity rule, documented for the UI:
 *  - at least 15 minutes of recorded study (focus, practice time), or
 *  - a practice log with at least one question attempted, or
 *  - a revision marked complete, or
 *  - a test/mock logged that day.
 * Opening pages, viewing data, or planning never counts.
 */
export function qualifyingDays(data: AppData): Set<string> {
  const minutesByDay = new Map<string, number>()
  for (const session of data.sessions) {
    const day = indiaDate(session.started_at)
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + session.duration_minutes)
  }
  const days = new Set<string>()
  for (const [day, minutes] of minutesByDay) if (minutes >= STREAK_MIN_MINUTES) days.add(day)
  for (const practice of data.practiceSessions) if (practice.attempted > 0) days.add(practice.practice_date)
  for (const revision of data.revisions) if (revision.completed_at) days.add(indiaDate(revision.completed_at))
  for (const test of data.tests) days.add(test.test_date)
  return days
}

export interface StreakSummary {
  current: number
  longest: number
  /** Days with qualifying activity in the last 7 IST days, including today. */
  weeklyConsistency: number
  qualifyingToday: boolean
  rule: string
}

export const STREAK_RULE_TEXT = `A day counts after ${STREAK_MIN_MINUTES}+ minutes of recorded study, a practice log with questions attempted, a completed revision, or a logged test. Viewing pages does not count.`

export function computeStreaks(data: AppData, today: string): StreakSummary {
  const days = qualifyingDays(data)
  const sorted = [...days].filter(day => day <= today).sort()
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const day of sorted) {
    run = previous && differenceInCalendarDays(parseISO(`${day}T12:00:00`), parseISO(`${previous}T12:00:00`)) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }
  // The current streak may still be alive if yesterday counted and today has not yet.
  const yesterday = format(addDays(parseISO(`${today}T12:00:00`), -1), 'yyyy-MM-dd')
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : ''
  let current = 0
  while (cursor && days.has(cursor)) {
    current += 1
    cursor = format(addDays(parseISO(`${cursor}T12:00:00`), -1), 'yyyy-MM-dd')
  }
  let weeklyConsistency = 0
  for (let offset = 0; offset < 7; offset += 1) {
    const day = format(addDays(parseISO(`${today}T12:00:00`), -offset), 'yyyy-MM-dd')
    if (days.has(day)) weeklyConsistency += 1
  }
  return { current, longest, weeklyConsistency, qualifyingToday: days.has(today), rule: STREAK_RULE_TEXT }
}

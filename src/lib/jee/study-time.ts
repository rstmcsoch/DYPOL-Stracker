import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import { indiaDate } from '../date.js'
import type { AppData, AppSettings, StudyActivity, Subject } from '../../types/index.js'
import { subjectsFor } from '../exams/subjects.js'

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

/**
 * The one "active days this week" number used everywhere (Home rhythm, Profile, Analytics
 * weekly report): qualifying days (the streak rule above) from Monday through today, IST.
 */
export function activeDaysThisWeek(data: AppData, today: string, days: Set<string> = qualifyingDays(data)): number {
  const range = weekRange(today)
  let count = 0
  for (const day of days) if (day >= range.start && day <= range.end) count += 1
  return count
}

/**
 * Today's minutes per subject against an optional per-subject share of the daily goal.
 * A subject with no target is reported with `target: null`, so the Home ring never invents
 * a denominator the student never set.
 */
export interface SubjectTargetRow {
  subject: Subject
  minutes: number
  target: number | null
  percent: number | null
}

export const SUBJECT_TARGET_MINUTES_MIN = 0
export const SUBJECT_TARGET_MINUTES_MAX = 1440

export function subjectTargetRows(data: AppData, today: string): SubjectTargetRow[] {
  const targets = data.settings.subject_daily_targets ?? {}
  const subjects = [...new Set([...subjectsFor(data), ...(Object.keys(targets) as string[])])] as Subject[]
  const minutes = new Map<Subject, number>()
  for (const session of data.sessions) {
    if (indiaDate(session.started_at) !== today) continue
    const subject = session.subject ?? data.chapters.find(chapter => chapter.id === session.chapter_id)?.subject
    if (!subject) continue
    minutes.set(subject, (minutes.get(subject) ?? 0) + session.duration_minutes)
  }
  return subjects.map(subject => {
    const target = typeof targets[subject] === 'number' ? targets[subject]! : null
    const value = minutes.get(subject) ?? 0
    return { subject, minutes: value, target, percent: target && target > 0 ? Math.min(100, (value / target) * 100) : null }
  })
}

/** True when at least one subject has a target, so the UI can stay quiet otherwise. */
export function hasSubjectTargets(data: AppData): boolean {
  return Object.values(data.settings.subject_daily_targets ?? {}).some(value => typeof value === 'number' && value > 0)
}

export interface StreakSummary {
  current: number
  longest: number
  /** Qualifying days this IST week (Monday through today); see activeDaysThisWeek. */
  weeklyConsistency: number
  qualifyingToday: boolean
  /** True while today can still be taken as a rest day without breaking the streak. */
  restAvailableToday: boolean
  /** True when today is already recorded as a rest day. */
  restingToday: boolean
  /** Monthly freezes still usable this calendar month (0 or 1). */
  freezesLeftThisMonth: number
  /** True when a freeze would be accepted right now: earned by a 7-day run, unused this month. */
  freezeAvailableToday: boolean
  /** True when today is already recorded as a freeze day. */
  freezingToday: boolean
  /** Consecutive calendar days that continue the streak, rest days included. */
  activeWindow: string[]
  rule: string
}

export const STREAK_RULE_TEXT = `A day counts after ${STREAK_MIN_MINUTES}+ minutes of recorded study, a practice log with questions attempted, a completed revision, or a logged test. Viewing pages does not count.`
export const STREAK_REST_RULE_TEXT = 'A rest day keeps the streak alive without adding to it.'
export const STREAK_FREEZE_RULE_TEXT = 'A freeze is earned by a 7-day streak and can be spent once a month. It protects a missed day without adding to the count.'
/** Freezes cost a saved-up 7-day run, so a freeze can never be a student's first move. */
export const STREAK_FREEZE_MIN_RUN = 7

/**
 * Days that continue a streak: qualifying days plus recorded rest days.
 *
 * Rest days are how a real streak survives a fever, a wedding or a travel day. A student
 * may take up to `settings.streak_rest_days` rest days per Monday–Sunday week (0 turns the
 * feature off). A rest day is never invented: only dates the student actually recorded in
 * `settings.streak_rest_days_used` are honoured, and they must still fit the weekly budget.
 * Rest days never add to the streak count; they only bridge the gap.
 */
export function streakDays(data: AppData, today: string): Set<string> {
  const days = qualifyingDays(data)
  for (const day of honouredFreezes(data.settings, today)) if (!days.has(day)) days.add(day)
  const budget = Math.max(0, Math.min(2, data.settings.streak_rest_days ?? 0))
  if (budget === 0) return days
  const used = [...new Set(data.settings.streak_rest_days_used ?? [])].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today).sort()
  const perWeek = new Map<string, number>()
  const honoured = new Set<string>()
  for (const day of used) {
    if (days.has(day)) continue
    const week = weekRange(day).start
    const count = perWeek.get(week) ?? 0
    if (count >= budget) continue
    perWeek.set(week, count + 1)
    honoured.add(day)
  }
  for (const day of honoured) days.add(day)
  return days
}

/**
 * Freeze days that still count, honouring at most one per calendar month.
 * A freeze is only worth anything once the student has actually built a 7-day run, which is
 * checked when they spend it, not here — old data should keep rendering either way.
 */
export function honouredFreezes(settings: Pick<AppSettings, 'streak_freezes_used'>, today: string): Set<string> {
  const used = [...new Set(settings.streak_freezes_used ?? [])].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today).sort()
  const months = new Set<string>()
  const honoured = new Set<string>()
  for (const day of used) {
    const month = day.slice(0, 7)
    if (months.has(month)) continue
    months.add(month)
    honoured.add(day)
  }
  return honoured
}

export function computeStreaks(data: AppData, today: string): StreakSummary {
  const days = streakDays(data, today)
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
  const activeWindow: string[] = []
  while (cursor && days.has(cursor)) {
    activeWindow.push(cursor)
    cursor = format(addDays(parseISO(`${cursor}T12:00:00`), -1), 'yyyy-MM-dd')
  }
  const qualifyingToday = qualifyingDays(data).has(today)
  const restingToday = days.has(today) && !qualifyingToday
  const budget = Math.max(0, Math.min(2, data.settings.streak_rest_days ?? 0))
  const restThisWeek = (data.settings.streak_rest_days_used ?? []).filter(day => weekRange(day).start === weekRange(today).start && day <= today && !qualifyingDays(data).has(day)).length
  const weeklyConsistency = activeDaysThisWeek(data, today, days)
  const freezes = honouredFreezes(data.settings, today)
  const month = today.slice(0, 7)
  const freezesThisMonth = [...freezes].filter(day => day.startsWith(month)).length
  const lastQualifying = [...qualifyingDays(data)].filter(day => day <= today).sort().at(-1)
  // Earned means a 7-day unbroken run has actually happened, ending at or after the last
  // qualifying day — recorded rest days count toward the run because they keep it alive.
  const runLength = (() => {
    if (!lastQualifying) return 0
    let run = 0
    let cursor = lastQualifying
    while (days.has(cursor)) {
      run += 1
      cursor = format(addDays(parseISO(`${cursor}T12:00:00`), -1), 'yyyy-MM-dd')
    }
    return run
  })()
  const freezingToday = freezes.has(today) && !qualifyingToday
  return {
    // Rest days bridge the gap but never inflate the number the student sees.
    current: activeWindow.filter(day => qualifyingDays(data).has(day)).length,
    longest, weeklyConsistency, qualifyingToday,
    restAvailableToday: budget > 0 && !qualifyingToday && !restingToday && restThisWeek < budget,
    restingToday,
    freezesLeftThisMonth: Math.max(0, 1 - freezesThisMonth),
    freezeAvailableToday: !qualifyingToday && !freezingToday && freezesThisMonth === 0 && runLength >= STREAK_FREEZE_MIN_RUN,
    freezingToday,
    activeWindow: activeWindow.reverse(),
    rule: budget > 0 ? `${STREAK_RULE_TEXT} ${STREAK_REST_RULE_TEXT}` : STREAK_RULE_TEXT
  }
}

/** Record `today` as a freeze. Pure, so the page can hand the patch straight to settings. */
export function takeFreezeDay(settings: Pick<AppSettings, 'streak_freezes_used'>, today: string): string[] {
  return [...new Set([...(settings.streak_freezes_used ?? []), today])].sort()
}

/** Record `today` as a rest day. Pure, so the page can hand the patch straight to settings. */
export function takeRestDay(settings: Pick<AppSettings, 'streak_rest_days_used'>, today: string): string[] {
  return [...new Set([...(settings.streak_rest_days_used ?? []), today])].sort()
}

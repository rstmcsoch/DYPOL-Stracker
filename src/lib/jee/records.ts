import type { AppData } from '../../types/index.js'
import { indiaDate } from '../date.js'
import { fmtDuration } from '../format.js'
import { computeStreaks } from './study-time.js'

/**
 * Personal records and private milestones.
 *
 * Everything here is derived from rows the student already has — no new table, nothing to
 * sync, and nothing shared. The point is the same information a leaderboard would give
 * ("where am I?") without ranking a student against strangers or inviting cheating.
 */

export interface PersonalRecord {
  id: string
  label: string
  value: string
  detail: string
  /** Numeric value, for "is this a new best" checks elsewhere. */
  amount: number
}

/** Whole days between two `yyyy-mm-dd` dates; null when the earlier one is missing. */
export function averageDaysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T12:00:00`)
  const end = Date.parse(`${to}T12:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return Math.floor((end - start) / 86_400_000)
}

export function personalRecords(data: AppData, today: string): PersonalRecord[] {
  const records: PersonalRecord[] = []
  const focusMinutes = data.sessions.filter(session => session.mode !== 'Short Break' && session.mode !== 'Long Break')
  const longestBlock = Math.max(0, ...focusMinutes.map(session => session.duration_minutes))
  if (longestBlock > 0) {
    const when = focusMinutes.find(session => session.duration_minutes === longestBlock)
    records.push({
      id: 'longest-block', label: 'Longest focus block', value: fmtDuration(longestBlock),
      detail: when ? `on ${indiaDate(when.started_at)}` : '', amount: longestBlock
    })
  }

  const bestTest = data.tests.map(test => {
    const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
    const marks = scores.reduce((sum, score) => sum + (score.marks_obtained ?? 0), 0)
    const total = scores.reduce((sum, score) => sum + (score.total_marks ?? 0), 0)
    return { test, percent: total > 0 ? (marks / total) * 100 : null }
  }).filter(row => row.percent !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0]
  if (bestTest?.percent !== null && bestTest?.percent !== undefined) {
    records.push({
      id: 'best-test', label: 'Best test', value: `${Math.round(bestTest.percent)}%`,
      detail: `${bestTest.test.title} · ${bestTest.test.test_date}`, amount: bestTest.percent
    })
  }

  const questionsByDay = new Map<string, number>()
  for (const practice of data.practiceSessions) {
    questionsByDay.set(practice.practice_date, (questionsByDay.get(practice.practice_date) ?? 0) + practice.attempted)
  }
  const bestQuestions = [...questionsByDay.entries()].sort((a, b) => b[1] - a[1])[0]
  if (bestQuestions) {
    records.push({ id: 'questions-day', label: 'Most questions in a day', value: `${bestQuestions[1]}`, detail: `on ${bestQuestions[0]}`, amount: bestQuestions[1] })
  }

  const streak = computeStreaks(data, today)
  if (streak.longest > 0) {
    records.push({ id: 'longest-streak', label: 'Longest streak', value: `${streak.longest} day${streak.longest === 1 ? '' : 's'}`, detail: `current run ${streak.current}`, amount: streak.longest })
  }

  const totalQuestions = data.practiceSessions.reduce((sum, practice) => sum + practice.attempted, 0)
  if (totalQuestions > 0) {
    records.push({ id: 'total-questions', label: 'Questions practised', value: `${totalQuestions}`, detail: `across ${data.practiceSessions.length} block${data.practiceSessions.length === 1 ? '' : 's'}`, amount: totalQuestions })
  }

  return records
}

export interface Milestone {
  id: string
  label: string
  detail: string
}

/**
 * Private milestones. Deliberately quiet and unshared: the audit's "never add" list rules out
 * leaderboards, so these are the reward layer instead — reached, not earned against anyone.
 */
export function recentBadges(data: AppData, today: string): Milestone[] {
  const out: Milestone[] = []
  const streak = computeStreaks(data, today)
  for (const [days, label] of [[7, '7-day streak'], [30, '30-day streak'], [100, '100-day streak']] as const) {
    if (streak.longest >= days) out.push({ id: `streak-${days}`, label, detail: `Reached a ${days}-day run.` })
  }
  const questions = data.practiceSessions.reduce((sum, practice) => sum + practice.attempted, 0)
  for (const [count, label] of [[100, '100 questions'], [1000, '1,000 questions'], [5000, '5,000 questions']] as const) {
    if (questions >= count) out.push({ id: `questions-${count}`, label, detail: `${questions} questions practised so far.` })
  }
  const perfectChapter = data.chapters.find(chapter => {
    const tests = data.tests.filter(test => test.subject === chapter.subject && test.test_type !== 'Full Mock')
    return tests.some(test => {
      const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
      return scores.some(score => score.marks_obtained !== null && score.total_marks !== null && score.total_marks > 0 && score.marks_obtained === score.total_marks)
    })
  })
  if (perfectChapter) out.push({ id: 'perfect-chapter', label: 'Full marks chapter test', detail: `A perfect score in ${perfectChapter.subject}.` })
  return out
}

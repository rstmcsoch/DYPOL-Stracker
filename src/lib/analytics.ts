import { addDays, differenceInCalendarDays, parseISO, startOfWeek, format } from 'date-fns'
import { indiaDate, indiaToday } from './date'
import { percent } from './format'
import type {
  AppData, Chapter, MistakeType, Subject, TestChapterLink, TestRecord, TestSubjectScore
} from '../types'

export interface ChapterPerformance {
  chapter: Chapter
  results: { test: TestRecord; percentage: number }[]
  average: number | null
  latest: number | null
  trend: 'up' | 'down' | 'steady' | 'none'
  dropping: boolean
  classification: 'Weak' | 'Okay' | 'Strong' | 'Untested'
}

export function validPercentage(marks: number | null | undefined, total: number | null | undefined): number | null {
  if (marks == null || total == null || !Number.isFinite(marks) || !Number.isFinite(total) || total <= 0 || marks < 0) return null
  return percent(marks, total)
}

export function testPercentage(test: TestRecord): number | null {
  return validPercentage(test.marks_obtained, test.total_marks)
}

export function subjectPercentage(score: TestSubjectScore): number | null {
  return validPercentage(score.marks_obtained, score.total_marks)
}

function linkedResult(link: TestChapterLink): number | null {
  return validPercentage(link.marks_obtained, link.total_marks)
}

export function getChapterPerformance(data: AppData): ChapterPerformance[] {
  return data.chapters.map(chapter => {
    const resultMap = new Map<string, { test: TestRecord; percentage: number }>()
    for (const test of data.tests) {
      if (test.chapter_id === chapter.id) {
        const value = testPercentage(test)
        if (value !== null) resultMap.set(test.id, { test, percentage: value })
      }
    }
    for (const link of data.testChapterLinks) {
      if (link.chapter_id !== chapter.id) continue
      const test = data.tests.find(item => item.id === link.test_id)
      const value = linkedResult(link)
      if (test && value !== null) resultMap.set(test.id, { test, percentage: value })
    }
    const results = [...resultMap.values()].sort((a, b) => b.test.test_date.localeCompare(a.test.test_date)).slice(0, 3)
    const average = results.length ? results.reduce((sum, item) => sum + item.percentage, 0) / results.length : null
    const latest = results[0]?.percentage ?? null
    const previous = results[1]?.percentage
    const dropping = latest !== null && previous !== undefined && previous - latest >= data.settings.dropping_threshold
    const trend = latest === null || previous === undefined ? 'none' : latest - previous >= 2 ? 'up' : previous - latest >= 2 ? 'down' : 'steady'
    const classification = average === null ? 'Untested' : average < data.settings.weak_threshold ? 'Weak' : average <= data.settings.strong_threshold ? 'Okay' : 'Strong'
    return { chapter, results, average, latest, trend, dropping, classification }
  })
}

export function getSubjectPerformance(data: AppData): { subject: Subject; average: number | null; count: number }[] {
  const bySubject = new Map<Subject, number[]>()
  for (const subject of ['Physics', 'Chemistry', 'Maths'] as const) bySubject.set(subject, [])
  for (const test of data.tests) {
    const scoreRows = data.testSubjectScores.filter(score => score.test_id === test.id)
    if (scoreRows.length) {
      for (const score of scoreRows) {
        const value = subjectPercentage(score)
        if (value !== null) bySubject.get(score.subject)?.push(value)
      }
    } else if (test.subject) {
      const value = testPercentage(test)
      if (value !== null) bySubject.get(test.subject)?.push(value)
    }
  }
  return (['Physics', 'Chemistry', 'Maths'] as const).map(subject => {
    const values = bySubject.get(subject) ?? []
    return { subject, average: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null, count: values.length }
  })
}

export function getAccuracy(data: AppData): { correct: number; attempted: number; rate: number | null } {
  const tests = data.tests.filter(test => test.correct != null && test.wrong != null)
  const correct = tests.reduce((sum, test) => sum + (test.correct ?? 0), 0)
  const attempted = tests.reduce((sum, test) => sum + (test.correct ?? 0) + (test.wrong ?? 0), 0)
  return { correct, attempted, rate: attempted > 0 ? (correct / attempted) * 100 : null }
}

export function getAttemptRate(data: AppData): { attempted: number; total: number; rate: number | null } {
  const tests = data.tests.filter(test => test.correct != null && test.wrong != null && test.skipped != null)
  const attempted = tests.reduce((sum, test) => sum + (test.correct ?? 0) + (test.wrong ?? 0), 0)
  const total = tests.reduce((sum, test) => sum + (test.correct ?? 0) + (test.wrong ?? 0) + (test.skipped ?? 0), 0)
  return { attempted, total, rate: total > 0 ? (attempted / total) * 100 : null }
}

export function getStudyStreak(data: AppData): { current: number; longest: number; daysThisMonth: number } {
  const days = new Set(data.sessions.filter(session => session.duration_minutes > 0).map(session => indiaDate(session.started_at)))
  const sorted = [...days].sort()
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const day of sorted) {
    run = previous && differenceInCalendarDays(parseISO(`${day}T12:00:00`), parseISO(`${previous}T12:00:00`)) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }
  const today = indiaToday()
  const yesterday = format(addDays(parseISO(`${today}T12:00:00`), -1), 'yyyy-MM-dd')
  let current = 0
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : ''
  while (cursor && days.has(cursor)) {
    current += 1
    cursor = format(addDays(parseISO(`${cursor}T12:00:00`), -1), 'yyyy-MM-dd')
  }
  const monthPrefix = today.slice(0, 7)
  return { current, longest, daysThisMonth: sorted.filter(day => day.startsWith(monthPrefix)).length }
}

export function getTodayStudyMinutes(data: AppData): number {
  const today = indiaToday()
  return data.sessions.filter(session => indiaDate(session.started_at) === today)
    .reduce((sum, session) => sum + session.duration_minutes, 0)
}

export function getMistakeCounts(data: AppData): { type: MistakeType; count: number }[] {
  const types: MistakeType[] = ['Concept', 'Silly', 'Calculation', 'Time', 'Guess']
  return types.map(type => ({ type, count: data.mistakes.filter(mistake => mistake.mistake_type === type).length }))
}

export function getSmartTip(data: AppData): string {
  const counts = getMistakeCounts(data)
  const largest = [...counts].sort((a, b) => b.count - a.count)[0]
  if (largest && largest.count > 0 && counts.filter(item => item.count === largest.count).length === 1 && largest.type === 'Silly') {
    return `Most of your recorded mistakes (${largest.count}) are silly mistakes. Add a 5-minute verification step to your test routine.`
  }
  const subjects = getSubjectPerformance(data).filter(item => item.average !== null)
  if (subjects.length >= 2) {
    const lowest = [...subjects].sort((a, b) => (a.average ?? 0) - (b.average ?? 0))[0]
    const others = subjects.filter(item => item.subject !== lowest?.subject)
    if (lowest?.average !== null && lowest?.average !== undefined && others.length && others.every(item => item.average !== null && item.average - lowest.average! >= 10)) {
      return `${lowest.subject} is currently below your other subject averages. Plan one focused practice block and review the last mistakes.`
    }
  }
  const untested = getChapterPerformance(data).filter(item => item.classification === 'Untested').length
  if (untested >= 5) return `You have ${untested} untested chapters. Short chapter tests can reveal gaps before the next full mock.`
  const overdue = data.revisions.filter(item => !item.completed_at && item.due_on < indiaToday()).length
  if (overdue > 0) return `You have ${overdue} overdue revision${overdue === 1 ? '' : 's'}. Clear the oldest one before adding low-priority tasks.`
  const declining = getChapterPerformance(data).find(item => item.dropping)
  if (declining) return `${declining.chapter.name} is down by ${Math.round((declining.results[1]?.percentage ?? 0) - (declining.latest ?? 0))} points on the latest test. Review the paper before attempting another.`
  const untestedTotal = getChapterPerformance(data).filter(item => item.classification === 'Untested').length
  if (untestedTotal > 0) return `${untestedTotal} chapter${untestedTotal === 1 ? ' is' : 's are'} still untested. Try a short test to establish a baseline.`
  if (data.tasks.some(task => task.task_date === indiaToday() && !task.is_completed)) return 'Start with one high-priority task. A small, finished block is a good way into the day.'
  return 'Your study data is up to date. Keep logging tests and focus sessions to make your next insight more useful.'
}

export function getMarksTrend(data: AppData, rangeDays = 180): { date: string; overall: number | null; Physics: number | null; Chemistry: number | null; Maths: number | null }[] {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - rangeDays)
  const filtered = data.tests.filter(test => new Date(`${test.test_date}T12:00:00`) >= cutoff).sort((a, b) => a.test_date.localeCompare(b.test_date))
  return filtered.map(test => {
    const subjectScores = data.testSubjectScores.filter(score => score.test_id === test.id)
    const row: { date: string; overall: number | null; Physics: number | null; Chemistry: number | null; Maths: number | null } = {
      date: test.test_date,
      overall: testPercentage(test),
      Physics: null, Chemistry: null, Maths: null
    }
    if (subjectScores.length) {
      for (const score of subjectScores) row[score.subject] = subjectPercentage(score)
    } else if (test.subject) {
      row[test.subject] = testPercentage(test)
    }
    return row
  })
}

export function getWeekStart(date: string): string {
  return format(startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

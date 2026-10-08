import { addDays, differenceInCalendarDays, parseISO, startOfWeek, format } from 'date-fns'
import { indiaDate, indiaToday } from './date'
import { percent } from './format'
import type {
  AppData, Chapter, MistakeType, Subject, TestChapterLink, TestRecord, TestSubjectScore
} from '../types'
import { SUBJECTS } from '../types'

export interface ChapterPerformance {
  chapter: Chapter
  results: { test: TestRecord; percentage: number }[]
  average: number | null
  latest: number | null
  trend: 'up' | 'down' | 'steady' | 'none'
  dropping: boolean
  classification: 'Weak' | 'Okay' | 'Strong' | 'Untested'
}

export interface MarksTotal { marks: number; total: number }

/** Return a percentage only for mathematically valid product scores (whole total, half-mark scores, 0–total). */
export function validPercentage(marks: number | null | undefined, total: number | null | undefined): number | null {
  if (marks == null || total == null || !Number.isFinite(marks) || !Number.isFinite(total) || total <= 0 || !Number.isInteger(total) || marks < 0 || marks > total || marks * 2 !== Math.trunc(marks * 2)) return null
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

function fullMockSubjectRows(testId: string, scores: TestSubjectScore[]): Map<Subject, TestSubjectScore> | null {
  const rows = scores.filter(score => score.test_id === testId)
  if (rows.length !== SUBJECTS.length) return null
  const bySubject = new Map<Subject, TestSubjectScore>()
  for (const row of rows) {
    if (bySubject.has(row.subject)) return null
    bySubject.set(row.subject, row)
  }
  return SUBJECTS.every(subject => bySubject.has(subject)) ? bySubject : null
}

/** A Full Mock's comparable total is the sum of its three subject results, not its optional subject tag. */
export function getFullMockAggregate(testId: string, scores: TestSubjectScore[]): MarksTotal | null {
  const rows = fullMockSubjectRows(testId, scores)
  if (!rows) return null
  let marks = 0
  let total = 0
  for (const subject of SUBJECTS) {
    const score = rows.get(subject)
    if (!score || subjectPercentage(score) === null) return null
    marks += score.marks_obtained ?? 0
    total += score.total_marks ?? 0
  }
  return Number.isFinite(marks) && Number.isFinite(total) && total > 0 && marks <= total ? { marks, total } : null
}

/**
 * Overall result for one test. Complete Full Mocks aggregate the three subject marks
 * and totals before computing a percentage. Non-mocks (and legacy mocks with no
 * subject rows) use their direct score. Partial Full Mock rows are never treated as
 * a complete aggregate.
 */
export function getOverallTestScore(test: TestRecord, scores: TestSubjectScore[]): MarksTotal | null {
  if (test.test_type === 'Full Mock') {
    const subjectRows = scores.filter(score => score.test_id === test.id)
    if (subjectRows.length) return getFullMockAggregate(test.id, scores)
  }
  return test.marks_obtained != null && validPercentage(test.marks_obtained, test.total_marks) !== null
    ? { marks: test.marks_obtained, total: test.total_marks! }
    : null
}

export function getOverallTestPercentage(test: TestRecord, scores: TestSubjectScore[]): number | null {
  const result = getOverallTestScore(test, scores)
  return result ? validPercentage(result.marks, result.total) : null
}

/** Mean of test percentages: each usable test record counts once, including one aggregate result per complete Full Mock. */
export function getMeanTestPercentage(tests: TestRecord[], scores: TestSubjectScore[]): { average: number | null; count: number } {
  const values = tests.map(test => getOverallTestPercentage(test, scores)).filter((value): value is number => value !== null)
  return { average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length }
}

export function getOverallTestAverage(data: AppData): { average: number | null; count: number } {
  return getMeanTestPercentage(data.tests, data.testSubjectScores)
}

/** Total marks for a test, even if the earned score is unknown; used only for comparable ratios such as penalties. */
export function getOverallTestTotal(test: TestRecord, scores: TestSubjectScore[]): number | null {
  if (test.test_type === 'Full Mock') {
    const rows = fullMockSubjectRows(test.id, scores)
    if (rows) {
      const totals = SUBJECTS.map(subject => rows.get(subject)?.total_marks)
      if (totals.every((value): value is number => value != null && Number.isFinite(value) && Number.isInteger(value) && value > 0)) {
        const combined = totals.reduce((sum, value) => sum + value, 0)
        return Number.isFinite(combined) ? combined : null
      }
    }
    if (scores.some(score => score.test_id === test.id)) return null
  }
  return test.total_marks != null && Number.isFinite(test.total_marks) && Number.isInteger(test.total_marks) && test.total_marks > 0
    ? test.total_marks
    : null
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

/**
 * Subject average is the unweighted arithmetic mean of recorded per-test percentages:
 * one Subject Test result counts once; a Full Mock contributes its corresponding
 * subject score once. Zero scores are included, blank/invalid scores are excluded,
 * and a Full Mock's optional `test.subject` tag is never treated as a subject score.
 */
export function getSubjectPerformance(data: AppData): { subject: Subject; average: number | null; count: number }[] {
  const bySubject = new Map<Subject, number[]>(SUBJECTS.map(subject => [subject, []]))
  for (const test of data.tests) {
    if (test.test_type === 'Full Mock') {
      const seen = new Set<Subject>()
      for (const score of data.testSubjectScores.filter(row => row.test_id === test.id)) {
        if (seen.has(score.subject)) continue
        seen.add(score.subject)
        const value = subjectPercentage(score)
        if (value !== null) bySubject.get(score.subject)?.push(value)
      }
    } else if (test.subject) {
      const value = testPercentage(test)
      if (value !== null) bySubject.get(test.subject)?.push(value)
    }
  }
  return SUBJECTS.map(subject => {
    const values = bySubject.get(subject) ?? []
    return { subject, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length }
  })
}

export function getNegativeMarkImpact(data: AppData): { totalNegativeMarks: number; comparableNegativeMarks: number; totalMarks: number; percentage: number | null; testsIncluded: number } {
  const recorded = data.tests.filter(test => test.negative_marks != null && Number.isFinite(test.negative_marks) && test.negative_marks >= 0)
  const totalNegativeMarks = recorded.reduce((sum, test) => sum + (test.negative_marks ?? 0), 0)
  let comparableNegativeMarks = 0
  let totalMarks = 0
  let testsIncluded = 0
  for (const test of recorded) {
    const total = getOverallTestTotal(test, data.testSubjectScores)
    if (total === null) continue
    comparableNegativeMarks += test.negative_marks ?? 0
    totalMarks += total
    testsIncluded += 1
  }
  const percentage = totalMarks > 0 && Number.isFinite(totalMarks) && Number.isFinite(comparableNegativeMarks)
    ? comparableNegativeMarks / totalMarks * 100
    : null
  return { totalNegativeMarks, comparableNegativeMarks, totalMarks, percentage, testsIncluded }
}

function hasValidCounts(test: TestRecord, includeSkipped: boolean): boolean {
  const values = includeSkipped ? [test.correct, test.wrong, test.skipped] : [test.correct, test.wrong]
  return values.every(value => value != null && Number.isFinite(value) && Number.isInteger(value) && value >= 0)
}

export function getAccuracy(data: AppData): { correct: number; attempted: number; rate: number | null } {
  const tests = data.tests.filter(test => hasValidCounts(test, false))
  const correct = tests.reduce((sum, test) => sum + (test.correct ?? 0), 0)
  const attempted = tests.reduce((sum, test) => sum + (test.correct ?? 0) + (test.wrong ?? 0), 0)
  return { correct, attempted, rate: attempted > 0 ? (correct / attempted) * 100 : null }
}

export function getAttemptRate(data: AppData): { attempted: number; total: number; rate: number | null } {
  const tests = data.tests.filter(test => hasValidCounts(test, true))
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
    const row: { date: string; overall: number | null; Physics: number | null; Chemistry: number | null; Maths: number | null } = {
      date: test.test_date,
      overall: getOverallTestPercentage(test, data.testSubjectScores),
      Physics: null, Chemistry: null, Maths: null
    }
    if (test.test_type === 'Full Mock') {
      const seen = new Set<Subject>()
      for (const score of data.testSubjectScores.filter(item => item.test_id === test.id)) {
        if (seen.has(score.subject)) continue
        seen.add(score.subject)
        row[score.subject] = subjectPercentage(score)
      }
    } else if (test.subject) {
      row[test.subject] = testPercentage(test)
    }
    return row
  })
}

export function getWeekStart(date: string): string {
  return format(startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

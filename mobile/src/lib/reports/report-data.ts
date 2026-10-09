import { format, parseISO } from 'date-fns'
import type { AppData, TestRecord } from '../../shared/types'
import { SUBJECTS } from '../../shared/types'
import { getMeanTestPercentage, getNegativeMarkImpact, getOverallTestPercentage, getOverallTestScore } from '../../shared/lib/analytics'
import { indiaDate, prettyDate } from '../../shared/lib/date'
import { fmtDuration, fmtNumber } from '../../shared/lib/format'
import { makeStudyBars } from '../../shared/lib/study-aggregation'

/**
 * Report content shared by the PDF and DOCX builders. Both formats show the same numbers and wording,
 * built only from saved records. Nothing here invents a value: an absent result is shown as absent.
 */
export interface ReportSections {
  summary: boolean
  performance: boolean
  chapters: boolean
  mistakes: boolean
  tests: boolean
  study: boolean
  tips: boolean
}

export interface ReportOptions { from: string; to: string; sections: ReportSections; ownerName: string }

export const SECTION_LABELS: { key: keyof ReportSections; label: string; note: string }[] = [
  { key: 'summary', label: 'Summary', note: 'Tests, best score, study time, streak' },
  { key: 'performance', label: 'Performance charts', note: 'Score trend and subject averages' },
  { key: 'chapters', label: 'Chapter signals', note: 'Weak, strong, dropping and untested' },
  { key: 'mistakes', label: 'Mistake breakdown', note: 'Recorded mistake categories' },
  { key: 'tests', label: 'Test history', note: 'Results within the date range' },
  { key: 'study', label: 'Study hours', note: 'Logged focus sessions' },
  { key: 'tips', label: 'Study notes', note: 'Rule-based tips from real data' }
]

/** Restricts every collection to the report's date range. Undated items are dropped rather than guessed. */
export function scopedData(data: AppData, from: string, to: string): AppData {
  const between = (date: string) => (!from || date >= from) && (!to || date <= to)
  const tests = data.tests.filter(test => between(test.test_date))
  const testIds = new Set(tests.map(test => test.id))
  const mistakeIds = new Set(data.mistakes.filter(mistake => between(indiaDate(mistake.created_at))).map(mistake => mistake.id))
  const sessions = data.sessions.filter(session => between(indiaDate(session.started_at)))
  return {
    ...data,
    tests,
    testSubjectScores: data.testSubjectScores.filter(item => testIds.has(item.test_id)),
    testChapterLinks: data.testChapterLinks.filter(item => testIds.has(item.test_id)),
    mistakes: data.mistakes.filter(item => mistakeIds.has(item.id)),
    sessions,
    revisions: data.revisions.filter(item => (item.completed_at && between(indiaDate(item.completed_at))) || between(item.due_on))
  }
}

export function overallTestPercent(test: TestRecord, data: AppData): number | null {
  return getOverallTestPercentage(test, data.testSubjectScores)
}

export function overallTestMarks(test: TestRecord, data: AppData): { marks: number; total: number } | null {
  return getOverallTestScore(test, data.testSubjectScores)
}

export function visibleTestMarks(test: TestRecord, data: AppData): { marks: number | null; total: number | null } | null {
  const score = overallTestMarks(test, data)
  if (score) return score
  const hasSubjectRows = data.testSubjectScores.some(item => item.test_id === test.id)
  return (test.test_type !== 'Full Mock' || !hasSubjectRows) && (test.marks_obtained !== null || test.total_marks !== null)
    ? { marks: test.marks_obtained, total: test.total_marks }
    : null
}

export function testSubjectLabel(test: TestRecord): string {
  return test.test_type === 'Full Mock' ? 'All subjects' : test.subject ?? '—'
}

export function negativeMarkSummary(data: AppData): string {
  const metrics = getNegativeMarkImpact(data)
  const hasRecorded = data.tests.some(test => test.negative_marks != null && Number.isFinite(test.negative_marks) && test.negative_marks >= 0)
  const recorded = hasRecorded ? fmtNumber(metrics.totalNegativeMarks, 1) : 'none'
  if (metrics.percentage === null) return `Recorded negative marks: ${recorded}. No comparable total marks were available for a ratio.`
  return `Recorded negative marks: ${recorded}. Penalty ratio = comparable penalties / comparable totals = ${metrics.percentage.toFixed(1)}% across ${metrics.testsIncluded} tests.`
}

export function rangeLabel(options: ReportOptions): string {
  return options.from || options.to
    ? `${options.from ? prettyDate(options.from) : 'All time'} — ${options.to ? prettyDate(options.to) : 'Today'}`
    : 'All recorded time'
}

/** Last twelve tests with a usable percentage, oldest first, as the website's trend chart draws them. */
export interface TrendPoint { label: string; value: number }
export function trendPoints(data: AppData): TrendPoint[] {
  return data.tests
    .filter(test => overallTestPercent(test, data) !== null)
    .sort((a, b) => a.test_date.localeCompare(b.test_date))
    .slice(-12)
    .map(test => ({ label: format(parseISO(`${test.test_date}T12:00:00`), 'd MMM'), value: Math.round(overallTestPercent(test, data) ?? 0) }))
}

/** Fourteen daily study-hour bars ending on the report's last day. */
export interface HourBar { label: string; hours: number; showLabel: boolean }
export function hourBars(data: AppData, endDate: string): HourBar[] {
  return makeStudyBars(data.sessions, 'day', endDate).map((bar, index) => ({ label: format(parseISO(`${bar.date}T12:00:00`), 'd MMM'), hours: bar.hours, showLabel: index % 2 === 0 }))
}

export function totalStudyMinutes(data: AppData): number {
  return data.sessions.reduce((sum, session) => sum + session.duration_minutes, 0)
}

export function subjectMinutes(data: AppData): [string, string][] {
  return SUBJECTS.map(subject => [subject, fmtDuration(data.sessions.filter(session => session.subject === subject).reduce((sum, session) => sum + session.duration_minutes, 0))])
}

export function bestPercent(data: AppData): number | null {
  const scores = data.tests.map(test => overallTestMarks(test, data)).filter((item): item is { marks: number; total: number } => item !== null)
  return scores.length ? Math.max(...scores.map(row => (row.marks / row.total) * 100)) : null
}

export function averagePercent(data: AppData): number | null {
  return getMeanTestPercentage(data.tests, data.testSubjectScores).average
}

export function syllabusDone(data: AppData): number {
  return data.chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised').length
}

export function testRows(data: AppData): string[][] {
  return [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)).map(test => {
    const score = visibleTestMarks(test, data)
    const percentage = overallTestPercent(test, data)
    return [
      test.test_date,
      test.title,
      test.test_type,
      testSubjectLabel(test),
      score ? `${fmtNumber(score.marks, 1)} / ${fmtNumber(score.total, 1)}` : '—',
      percentage === null ? '—' : `${Math.round(percentage)}%`
    ]
  })
}

export function reportDateLabel(): string {
  return prettyDate(indiaDate(new Date()))
}

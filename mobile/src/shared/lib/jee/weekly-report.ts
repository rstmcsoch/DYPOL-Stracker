import { getChapterPerformance, subjectPercentage, testPercentage } from '../analytics.js'
import { indiaDate } from '../date.js'
import { studyMinutesByActivity, previousWeekRange, weekRange, type ActivityMinutes } from './study-time.js'
import { aggregatePractice } from './progress.js'
import type { AppData, Subject } from '../../types/index.js'
import { SUBJECTS } from '../../types/index.js'

export interface SubjectSignal { subject: Subject; value: number; samples: number }

/**
 * Subject performance inside a date range, pooled from two real sources: subject-level
 * test percentages (tests and full-mock subject scores) and practice accuracy on chapters
 * of that subject. Returns null per subject when the range holds no usable data.
 */
export function subjectSignals(data: AppData, from: string, to: string): Map<Subject, SubjectSignal | null> {
  const values = new Map<Subject, number[]>(SUBJECTS.map(subject => [subject, []]))
  for (const test of data.tests) {
    if (test.test_date < from || test.test_date > to) continue
    if (test.test_type === 'Full Mock') {
      for (const score of data.testSubjectScores.filter(row => row.test_id === test.id)) {
        const value = subjectPercentage(score)
        if (value !== null) values.get(score.subject)?.push(value)
      }
    } else if (test.subject) {
      const value = testPercentage(test)
      if (value !== null) values.get(test.subject)?.push(value)
    }
  }
  const chapterSubject = new Map(data.chapters.map(chapter => [chapter.id, chapter.subject]))
  for (const subject of SUBJECTS) {
    const sessions = data.practiceSessions.filter(item => item.practice_date >= from && item.practice_date <= to && chapterSubject.get(item.chapter_id) === subject)
    const aggregate = aggregatePractice(sessions)
    if (aggregate.accuracy !== null && aggregate.attempted > 0) values.get(subject)?.push(aggregate.accuracy)
  }
  return new Map(SUBJECTS.map(subject => {
    const list = values.get(subject) ?? []
    return [subject, list.length ? { subject, value: list.reduce((sum, value) => sum + value, 0) / list.length, samples: list.length } : null]
  }))
}

export interface WeeklyReport {
  range: { start: string; end: string }
  studiedMinutes: number
  activity: ActivityMinutes
  testsLogged: number
  questionsAttempted: number
  practiceAccuracy: number | null
  activeDays: number
  strongestSubject: { subject: Subject; value: number } | null
  weakestArea: { name: string; value: number; basis: string } | null
  /** Empty when there is not enough history for a fair comparison. */
  comparisons: string[]
  historyNote: string
  actionable: string
}

export function buildWeeklyReport(data: AppData, today: string): WeeklyReport {
  const range = weekRange(today)
  const previous = previousWeekRange(today)
  const activity = studyMinutesByActivity(data, range.start, range.end)
  const practice = aggregatePractice(data.practiceSessions.filter(item => item.practice_date >= range.start && item.practice_date <= range.end))
  const tests = data.tests.filter(test => test.test_date >= range.start && test.test_date <= range.end)
  const activeDays = new Set<string>([
    ...data.sessions.map(session => indiaDate(session.started_at)).filter(day => day >= range.start && day <= range.end),
    ...data.practiceSessions.filter(item => item.attempted > 0 && item.practice_date >= range.start && item.practice_date <= range.end).map(item => item.practice_date),
    ...tests.map(test => test.test_date)
  ]).size

  const current = subjectSignals(data, range.start, range.end)
  const prior = subjectSignals(data, previous.start, previous.end)
  const ranked = [...current.values()].filter((item): item is SubjectSignal => item !== null).sort((a, b) => b.value - a.value)
  const strongest = ranked[0] ? { subject: ranked[0].subject, value: ranked[0].value } : null

  // Weakest chapter: lowest practice accuracy this week (≥5 questions), otherwise lowest test average.
  const chapterPractice = data.chapters.map(chapter => {
    const agg = aggregatePractice(data.practiceSessions.filter(item => item.chapter_id === chapter.id && item.practice_date >= range.start && item.practice_date <= range.end))
    return { chapter, agg }
  }).filter(item => item.agg.attempted >= 5 && item.agg.accuracy !== null).sort((a, b) => (a.agg.accuracy ?? 0) - (b.agg.accuracy ?? 0))
  const weakestChapter = chapterPractice[0]
    ? { name: chapterPractice[0].chapter.name, value: chapterPractice[0].agg.accuracy ?? 0, basis: `practice accuracy on ${chapterPractice[0].agg.attempted} questions` }
    : (() => {
      const testBased = getChapterPerformance(data).filter(item => item.average !== null && item.results.some(result => result.test.test_date >= range.start && result.test.test_date <= range.end)).sort((a, b) => (a.average ?? 0) - (b.average ?? 0))[0]
      return testBased ? { name: testBased.chapter.name, value: testBased.average ?? 0, basis: 'average of recent tests' } : null
    })()

  const comparisons: string[] = []
  for (const subject of SUBJECTS) {
    const now = current.get(subject)
    const before = prior.get(subject)
    if (now && before) {
      const delta = Math.round(now.value - before.value)
      if (Math.abs(delta) >= 3) comparisons.push(`${subject} performance ${delta < 0 ? 'dropped' : 'rose'} ${Math.abs(delta)} point${Math.abs(delta) === 1 ? '' : 's'} compared with the previous week.`)
    }
  }
  const priorHasHistory = [...prior.values()].some(Boolean) || data.sessions.some(session => indiaDate(session.started_at) >= previous.start && indiaDate(session.started_at) <= previous.end)
  const historyNote = comparisons.length
    ? 'Comparisons use subjects with data in both weeks.'
    : priorHasHistory
      ? 'Not enough overlapping subject data between the two weeks to compare subjects yet.'
      : 'Not enough history to compare with the previous week yet. Comparisons start once you have data in both weeks.'

  const actionable = comparisons[0]
    ?? (weakestChapter ? `Start the next block with ${weakestChapter.name}: ${weakestChapter.basis} is ${Math.round(weakestChapter.value)}%.` : 'Log a practice block or test this week to get a specific action.')

  return {
    range, studiedMinutes: activity.total, activity,
    testsLogged: tests.length, questionsAttempted: practice.attempted,
    practiceAccuracy: practice.accuracy, activeDays,
    strongestSubject: strongest, weakestArea: weakestChapter,
    comparisons, historyNote, actionable
  }
}

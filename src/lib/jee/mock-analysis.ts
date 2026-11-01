import type { AppData, ErrorCategory, Subject, TestErrorLog, TestRecord, TestTimeEntry } from '../../types/index.js'
import { ERROR_CATEGORIES } from '../../types/index.js'
import { examSubjects } from '../exams/subjects.js'
import { getOverallTestScore, subjectPercentage } from '../analytics.js'

/**
 * Mock deep-dive. Three layers are kept apart so the UI can label them:
 *  - recorded:   values the student entered as test results or time/attempt data
 *  - classified: the student's own error-category tags on lost marks
 *  - derived:    sentences computed from the two layers above
 * Missing data stays missing: nothing here fabricates a time or a mark.
 */

export interface CategoryTotal {
  category: ErrorCategory
  entries: number
  marksLost: number | null
  questions: number | null
}

export function categoryTotals(logs: TestErrorLog[]): CategoryTotal[] {
  return ERROR_CATEGORIES.map(category => {
    const rows = logs.filter(log => log.category === category)
    const marks = rows.filter(row => row.marks_lost !== null)
    const questions = rows.filter(row => row.questions !== null)
    return {
      category,
      entries: rows.length,
      marksLost: marks.length ? marks.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0) : null,
      questions: questions.length ? questions.reduce((sum, row) => sum + (row.questions ?? 0), 0) : null
    }
  }).filter(item => item.entries > 0)
}

export interface SubjectTimeRow {
  subject: Subject
  minutes: number | null
  attempted: number | null
  unattempted: number | null
  marks: number | null
  total: number | null
  /** Marks gained per recorded minute, or null when time or marks are missing. */
  marksPerMinute: number | null
}

export function subjectTimeRows(test: TestRecord, data: AppData): SubjectTimeRow[] {
  const entries = data.testTimeEntries.filter(entry => entry.test_id === test.id)
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  const subjects = [...new Set([...examSubjects(data.settings), ...entries.map(entry => entry.subject), ...scores.map(score => score.subject)].filter((subject): subject is string => Boolean(subject)))]
  return subjects.map(subject => {
    const rows = entries.filter(entry => entry.subject === subject)
    const minutes = rows.filter(row => row.minutes !== null)
    const attempted = rows.filter(row => row.attempted !== null)
    const unattempted = rows.filter(row => row.unattempted !== null)
    const score = scores.find(row => row.subject === subject)
    const minutesSum = minutes.length ? minutes.reduce((sum, row) => sum + (row.minutes ?? 0), 0) : null
    const marks = score?.marks_obtained ?? null
    return {
      subject,
      minutes: minutesSum,
      attempted: attempted.length ? attempted.reduce((sum, row) => sum + (row.attempted ?? 0), 0) : null,
      unattempted: unattempted.length ? unattempted.reduce((sum, row) => sum + (row.unattempted ?? 0), 0) : null,
      marks,
      total: score?.total_marks ?? null,
      marksPerMinute: minutesSum && minutesSum > 0 && marks !== null ? marks / minutesSum : null
    }
  }).filter(row => row.minutes !== null || row.attempted !== null || row.marks !== null)
}

export interface MockInsight {
  kind: 'recorded' | 'classified' | 'derived'
  text: string
}

/**
 * Plain-language answer to "what should I fix before my next mock?" Every sentence says
 * what it is based on. Returns an empty list rather than guessing when inputs are sparse.
 */
export function mockInsights(test: TestRecord, data: AppData): MockInsight[] {
  const insights: MockInsight[] = []
  const logs = data.testErrorLogs.filter(log => log.test_id === test.id)
  const bySubject = new Map<Subject, TestErrorLog[]>()
  for (const log of logs) {
    if (!log.subject) continue
    const list = bySubject.get(log.subject) ?? []
    list.push(log)
    bySubject.set(log.subject, list)
  }
  for (const subject of [...new Set([...examSubjects(data.settings), ...bySubject.keys()])]) {
    const rows = bySubject.get(subject) ?? []
    const marked = rows.filter(row => row.marks_lost !== null && row.marks_lost > 0)
    const taggedLost = marked.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0)
    // Never quote more lost marks than the recorded subject result actually lost.
    const actual = actualLostMarks(test, data, subject)
    const totalLost = actual === null ? taggedLost : round2(Math.min(taggedLost, actual))
    if (totalLost > 0) {
      const byCategory = new Map<ErrorCategory, number>()
      for (const row of marked) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + (row.marks_lost ?? 0))
      const [topCategory, taggedTop] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]!
      const topMarks = round2(Math.min(taggedTop, totalLost))
      const share = Math.round((taggedTop / taggedLost) * 100)
      if (share >= 50) {
        insights.push({ kind: 'derived', text: `${subject} lost ${totalLost} marks; ${share}% of that came from ${topCategory.toLowerCase()}.` })
      } else {
        insights.push({ kind: 'derived', text: `${subject} lost ${totalLost} marks across several causes; the largest was ${topCategory.toLowerCase()} (${topMarks}).` })
      }
    }
    const avoidable = rows.filter(row => row.category === 'Silly mistake' || row.category === 'Calculation error' || row.category === 'Misread question')
    const avoidableQuestions = avoidable.reduce((sum, row) => sum + (row.questions ?? 0), 0)
    if (avoidableQuestions >= 2) {
      insights.push({ kind: 'derived', text: `${subject}: ${avoidableQuestions} questions were lost to avoidable slips (silly, calculation or misread).` })
    }
  }

  for (const row of subjectTimeRows(test, data)) {
    if (row.minutes !== null && row.marks !== null && row.total) {
      const pct = subjectPercentage({ id: '', test_id: test.id, subject: row.subject, marks_obtained: row.marks, total_marks: row.total, created_at: '', updated_at: '' })
      if (pct !== null) insights.push({ kind: 'recorded', text: `${row.subject}: ${row.minutes} min spent for ${row.marks} of ${row.total} marks (${Math.round(pct)}%).` })
    }
    if (row.unattempted !== null && row.unattempted > 0) insights.push({ kind: 'recorded', text: `${row.subject}: ${row.unattempted} question${row.unattempted === 1 ? '' : 's'} left unattempted.` })
  }

  const timeLost = logs.filter(log => log.category === 'Time pressure' && log.marks_lost)
  const overallLost = actualLostMarks(test, data, null)
  const timeTagged = timeLost.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0)
  const timeLostTotal = overallLost === null ? timeTagged : round2(Math.min(timeTagged, overallLost))
  if (timeLostTotal > 0) insights.push({ kind: 'classified', text: `You tagged ${timeLostTotal} marks as lost to time pressure.` })
  const guessed = logs.filter(log => log.category === 'Guess / bad attempt').reduce((sum, row) => sum + (row.questions ?? 0), 0)
  if (guessed >= 3) insights.push({ kind: 'classified', text: `${guessed} questions were tagged as guesses or bad attempts — consider skipping more aggressively.` })

  return insights
}

/**
 * Marks actually lost on a test: total − obtained, for one subject (from its subject score,
 * or the test itself when it is a single-subject test) or for the whole test. Null when the
 * recorded result does not say.
 */
export function actualLostMarks(test: TestRecord, data: AppData, subject?: string | null): number | null {
  if (subject) {
    const row = data.testSubjectScores.find(score => score.test_id === test.id && score.subject === subject)
    if (row && row.marks_obtained != null && row.total_marks != null) return Math.max(0, row.total_marks - row.marks_obtained)
    if (!row && test.test_type !== 'Full Mock' && test.subject === subject && test.marks_obtained != null && test.total_marks != null) {
      return Math.max(0, test.total_marks - test.marks_obtained)
    }
    return null
  }
  const overall = getOverallTestScore(test, data.testSubjectScores)
  return overall ? Math.max(0, overall.total - overall.marks) : null
}

export interface LostMarksCheck { ok: boolean; message: string | null; remaining: number | null }

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Classified lost marks can never exceed what was really lost: per subject (when the subject
 * score is known) and across the whole test. `excludeLogId` skips the row being edited.
 */
export function checkLostMarks(test: TestRecord, data: AppData, subject: string | null, marksLost: number | null, excludeLogId?: string): LostMarksCheck {
  if (marksLost === null || marksLost <= 0) return { ok: true, message: null, remaining: null }
  const others = data.testErrorLogs.filter(log => log.test_id === test.id && log.id !== excludeLogId && log.marks_lost !== null)
  const checks: { actual: number | null; used: number; scope: string }[] = []
  if (subject) checks.push({ actual: actualLostMarks(test, data, subject), used: others.filter(log => log.subject === subject).reduce((sum, log) => sum + (log.marks_lost ?? 0), 0), scope: subject })
  checks.push({ actual: actualLostMarks(test, data, null), used: others.reduce((sum, log) => sum + (log.marks_lost ?? 0), 0), scope: 'this test' })
  for (const check of checks) {
    if (check.actual === null) continue
    const remaining = round2(Math.max(0, check.actual - check.used))
    if (marksLost > remaining + 1e-9) {
      const already = check.used > 0 ? ` (${round2(check.used)} already classified)` : ''
      return { ok: false, remaining, message: `Only ${round2(check.actual)} marks were lost in ${check.scope}${already}. Enter ${remaining} or fewer.` }
    }
  }
  return { ok: true, message: null, remaining: null }
}

/** Overall mock summary for the list view: score as recorded, and how many tagged losses exist. */
export function mockSummary(test: TestRecord, data: AppData): { score: number | null; taggedQuestions: number; taggedMarks: number | null } {
  const result = getOverallTestScore(test, data.testSubjectScores)
  const score = result && result.total > 0 ? (result.marks / result.total) * 100 : null
  const logs = data.testErrorLogs.filter(log => log.test_id === test.id)
  const taggedQuestions = logs.reduce((sum, row) => sum + (row.questions ?? 0), 0)
  const marksRows = logs.filter(row => row.marks_lost !== null)
  return { score, taggedQuestions, taggedMarks: marksRows.length ? marksRows.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0) : null }
}

export type { TestTimeEntry }

import type { AppData, ErrorCategory, Subject, TestErrorLog, TestRecord, TestTimeEntry } from '../../types/index.js'
import { ERROR_CATEGORIES, SUBJECTS } from '../../types/index.js'
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
  return SUBJECTS.map(subject => {
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
  for (const subject of SUBJECTS) {
    const rows = bySubject.get(subject) ?? []
    const marked = rows.filter(row => row.marks_lost !== null && row.marks_lost > 0)
    const totalLost = marked.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0)
    if (totalLost > 0) {
      const byCategory = new Map<ErrorCategory, number>()
      for (const row of marked) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + (row.marks_lost ?? 0))
      const [topCategory, topMarks] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]!
      const share = Math.round((topMarks / totalLost) * 100)
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
  const timeLostTotal = timeLost.reduce((sum, row) => sum + (row.marks_lost ?? 0), 0)
  if (timeLostTotal > 0) insights.push({ kind: 'classified', text: `You tagged ${timeLostTotal} marks as lost to time pressure.` })
  const guessed = logs.filter(log => log.category === 'Guess / bad attempt').reduce((sum, row) => sum + (row.questions ?? 0), 0)
  if (guessed >= 3) insights.push({ kind: 'classified', text: `${guessed} questions were tagged as guesses or bad attempts — consider skipping more aggressively.` })

  return insights
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

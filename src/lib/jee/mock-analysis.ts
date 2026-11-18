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

export interface SubjectDelta {
  subject: Subject
  /** Percentage on this mock, or null when it was not recorded. */
  current: number | null
  /** Percentage on the previous full mock, or null when there is none. */
  previous: number | null
  delta: number | null
  previousTitle: string | null
}

/**
 * Subject-by-subject change against the previous mock of the same kind.
 *
 * Students compare themselves to their last paper, not to an absolute score, so the delta is
 * the number worth showing — and it stays null (not zero) when either side is missing.
 */
export function subjectDeltas(test: TestRecord, data: AppData): SubjectDelta[] {
  const earlier = [...data.tests]
    .filter(item => item.id !== test.id && item.test_type === test.test_type && item.test_date < test.test_date)
    .sort((a, b) => b.test_date.localeCompare(a.test_date))[0] ?? null
  const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
  const previousScores = earlier ? data.testSubjectScores.filter(score => score.test_id === earlier.id) : []
  const subjects = [...new Set([
    ...examSubjects(data.settings),
    ...scores.map(score => score.subject),
    ...previousScores.map(score => score.subject)
  ])]
  return subjects.map(subject => {
    const current = percentagesBySubject(scores).get(subject) ?? null
    const previous = percentagesBySubject(previousScores).get(subject) ?? null
    return {
      subject,
      // Rounded at the source: 55/100 is stored as 55.00000000000001 in floating point, and a
      // percentage shown to a student should not carry that noise.
      current: current === null ? null : round2(current),
      previous: previous === null ? null : round2(previous),
      delta: current !== null && previous !== null ? round2(current - previous) : null,
      previousTitle: earlier?.title ?? null
    }
  }).filter(row => row.current !== null || row.previous !== null)
}

function percentagesBySubject(scores: AppData['testSubjectScores']): Map<string, number> {
  const out = new Map<string, number>()
  for (const score of scores) {
    const pct = subjectPercentage(score)
    if (pct !== null) out.set(score.subject, pct)
  }
  return out
}

export interface ChapterRepeat {
  chapterId: string
  chapterName: string
  subject: Subject
  /** How many of the recent mocks flag this chapter. */
  mocks: number
  questions: number
}

/**
 * Chapters flagged in two or more of the last `window` tests: the "repeat offender" list.
 * A chapter that keeps appearing is a syllabus hole, not a one-off bad day.
 */
export function chapterRepeatOffenders(data: AppData, window = 5): ChapterRepeat[] {
  const recent = [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)).slice(0, window)
  const recentIds = new Set(recent.map(item => item.id))
  const logs = data.testErrorLogs.filter(log => recentIds.has(log.test_id) && log.chapter_id)
  const grouped = new Map<string, { mocks: Set<string>; questions: number }>()
  for (const log of logs) {
    if (!log.chapter_id) continue
    const row = grouped.get(log.chapter_id) ?? { mocks: new Set<string>(), questions: 0 }
    row.mocks.add(log.test_id)
    row.questions += log.questions ?? 0
    grouped.set(log.chapter_id, row)
  }
  const out: ChapterRepeat[] = []
  for (const [chapterId, row] of grouped) {
    if (row.mocks.size < 2) continue
    const chapter = data.chapters.find(item => item.id === chapterId)
    if (!chapter) continue
    out.push({ chapterId, chapterName: chapter.name, subject: chapter.subject, mocks: row.mocks.size, questions: row.questions })
  }
  return out.sort((a, b) => b.mocks - a.mocks || b.questions - a.questions || a.chapterName.localeCompare(b.chapterName))
}

export interface FixFirst {
  label: string
  /** Marks that could plausibly be recovered, the ranking key. */
  marks: number | null
  reason: string
  to: string
}

/**
 * "What to fix first", ordered by marks recoverable rather than by raw count: five silly slips
 * worth 20 marks outrank twelve untagged guesses worth nothing measured.
 */
export function fixFirstList(test: TestRecord, data: AppData): FixFirst[] {
  const logs = data.testErrorLogs.filter(log => log.test_id === test.id)
  const byCategory = new Map<ErrorCategory, { marks: number; questions: number }>()
  for (const log of logs) {
    const row = byCategory.get(log.category) ?? { marks: 0, questions: 0 }
    row.marks += log.marks_lost ?? 0
    row.questions += log.questions ?? 0
    byCategory.set(log.category, row)
  }
  const items: FixFirst[] = [...byCategory.entries()]
    .filter(([, row]) => row.marks > 0 || row.questions > 0)
    .map(([category, row]) => ({
      label: category,
      marks: row.marks > 0 ? round2(row.marks) : null,
      reason: `${row.questions || '—'} question${row.questions === 1 ? '' : 's'} tagged${row.marks > 0 ? `, ${round2(row.marks)} marks lost` : ', no marks entered'}`,
      to: '/mistakes'
    }))
  const repeats = chapterRepeatOffenders(data).slice(0, 2)
  for (const repeat of repeats) {
    items.push({
      label: `${repeat.chapterName} keeps appearing`,
      marks: null,
      reason: `Flagged in ${repeat.mocks} of your last 5 tests${repeat.questions ? ` · ${repeat.questions} questions` : ''}`,
      to: `/practice?chapter=${repeat.chapterId}`
    })
  }
  return items.sort((a, b) => (b.marks ?? -1) - (a.marks ?? -1))
}

export type { TestTimeEntry }

/* ------------------------------------------------------------------ */
/* Percentile band                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rough JEE Main percentile from raw marks out of 300.
 *
 * This is a *band*, not a prediction, and it says so. JEE Main percentile depends on the
 * session's normalisation and the whole candidate pool, neither of which we can see; the
 * mapping below is a widely-quoted approximation. It is deliberately coarse (600-wide steps
 * at the bottom, 100-wide near the top) because a precise-looking number would be a lie.
 */
export interface PercentileBand {
  percentile: number | null
  /** The exam's own percentile if the student typed one into the test form. */
  reported: number | null
  label: string
  note: string
  /** 0–100, where the estimate sits inside the band. Null when there is no estimate. */
  position: number | null
}

const BANDS: Array<[number, number]> = [
  [0, 0.5], [10, 1], [20, 3], [30, 6], [40, 10], [50, 15], [60, 21], [70, 28],
  [80, 36], [90, 45], [100, 55], [110, 64], [120, 72], [130, 79], [140, 85],
  [150, 90], [160, 93.5], [170, 96], [180, 97.5], [190, 98.5], [200, 99.1],
  [210, 99.4], [220, 99.6], [230, 99.7], [240, 99.8], [250, 99.87], [260, 99.92],
  [270, 99.96], [280, 99.98], [300, 99.995]
]

export function estimatePercentile(marks: number, total: number): number | null {
  if (!Number.isFinite(marks) || !Number.isFinite(total) || total <= 0) return null
  // Normalise to the 300-mark scale the bands are quoted on.
  const scaled = Math.max(0, Math.min(300, (marks / total) * 300))
  for (let index = 0; index < BANDS.length - 1; index += 1) {
    const [lowMarks, lowP] = BANDS[index]!
    const [highMarks, highP] = BANDS[index + 1]!
    if (scaled <= highMarks) {
      const span = highMarks - lowMarks
      const ratio = span > 0 ? (scaled - lowMarks) / span : 0
      // Never show a flat 100: nobody is at the very top of the candidate pool, and a
      // rounded 99.995 would read as "100th percentile".
      return Math.min(99.9, Math.round((lowP + (highP - lowP) * ratio) * 10) / 10)
    }
  }
  return 99.9
}

export function percentileBand(data: AppData, test: TestRecord): PercentileBand {
  const raw = test.percentile ?? null
  // Same score source as the Analytics charts, so a full mock with subject rows counts too.
  const score = getOverallTestScore(test, data.testSubjectScores)
  const estimated = score ? estimatePercentile(score.marks, score.total) : null
  // The reported number wins when present: it is the exam's own data, not our guess.
  const value = raw ?? estimated
  if (value === null) return { percentile: null, reported: raw, label: 'No percentile yet', note: 'Add marks to this test to see where it sits.', position: null }
  const source = raw !== null ? 'reported' : 'estimated'
  const band = value >= 99 ? 'Top 1%' : value >= 95 ? 'Top 5%' : value >= 90 ? 'Top 10%' : value >= 75 ? 'Top 25%' : value >= 50 ? 'Top half' : 'Below half'
  return {
    percentile: value,
    reported: raw,
    label: band,
    note: source === 'reported' ? 'The percentile you entered for this paper.' : 'Estimated from marks out of 300. Session normalisation and the candidate pool move this by a few tenths of a percentile.',
    position: Math.max(0, Math.min(100, value)),
  }
}

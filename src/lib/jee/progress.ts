import type {
  AppData, AppSettings, Chapter, ChapterImportance, ChapterStageKey, PracticeSession, PYQExam, PyqRecord, Subject
} from '../../types/index.js'
import { CHAPTER_STAGE_KEYS } from '../../types/index.js'
import { examSubjects } from '../exams/subjects.js'
import { isJeeExam } from '../exams/catalog.js'

/* ------------------------------------------------------------------ */
/* Importance weights — configurable in Settings, never hardcoded here */
/* ------------------------------------------------------------------ */

export function importanceWeight(settings: AppSettings, importance: ChapterImportance | undefined): number {
  switch (importance) {
    case 'high': return settings.weight_high
    case 'low': return settings.weight_low
    default: return settings.weight_medium
  }
}

export interface SyllabusProgress {
  /** Chapters whose status is Done or Revised, as a share of all chapters (no weighting). */
  raw: number | null
  /** Same completion, but each chapter counts by its configurable importance weight. */
  weighted: number | null
  completedChapters: number
  totalChapters: number
  bySubject: { subject: Subject; raw: number | null; weighted: number | null; completed: number; total: number }[]
}

export function isChapterComplete(chapter: Chapter): boolean {
  return chapter.status === 'Done' || chapter.status === 'Revised'
}

/**
 * Raw and weighted syllabus completion. With every chapter at the default "medium"
 * importance the two numbers are equal by construction; they diverge only when the
 * student changes importance, which is the intended behaviour.
 */
export function syllabusProgress(chapters: Chapter[], settings: AppSettings): SyllabusProgress {
  const ratio = (items: Chapter[]) => {
    const totalWeight = items.reduce((sum, chapter) => sum + importanceWeight(settings, chapter.importance), 0)
    const doneWeight = items.filter(isChapterComplete).reduce((sum, chapter) => sum + importanceWeight(settings, chapter.importance), 0)
    const done = items.filter(isChapterComplete).length
    return {
      raw: items.length ? (done / items.length) * 100 : null,
      weighted: totalWeight > 0 ? (doneWeight / totalWeight) * 100 : null,
      completed: done, total: items.length
    }
  }
  const overall = ratio(chapters)
  return {
    raw: overall.raw, weighted: overall.weighted, completedChapters: overall.completed, totalChapters: overall.total,
    bySubject: [...new Set([...examSubjects(settings), ...chapters.map(chapter => chapter.subject)])].map(subject => ({ subject, ...ratio(chapters.filter(chapter => chapter.subject === subject)) }))
  }
}

/* ------------------------------------------------------------------ */
/* Practice (DPP / module / sheet) aggregates                           */
/* ------------------------------------------------------------------ */

export interface PracticeAggregate {
  sessions: number
  attempted: number
  correct: number
  incorrect: number
  /** Questions skipped; tracked separately and not part of accuracy. */
  skipped: number
  /** correct ÷ attempted, as a percentage. Null when nothing has been attempted. */
  accuracy: number | null
  /** Accuracy over the most recent three practice blocks only. */
  recentAccuracy: number | null
  timeMinutes: number
  /**
   * Average seconds per attempted question, from blocks that recorded time.
   * Null when no block has both a time and questions. Self-reported time is approximate,
   * so this is shown as a pace reading, never as a score.
   */
  secondsPerQuestion: number | null
}

export const PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL = 20

export function aggregatePractice(sessions: PracticeSession[]): PracticeAggregate {
  const sorted = [...sessions].sort((a, b) => b.practice_date.localeCompare(a.practice_date) || b.created_at.localeCompare(a.created_at))
  const sum = (items: PracticeSession[], pick: (item: PracticeSession) => number) => items.reduce((total, item) => total + pick(item), 0)
  const attempted = sum(sorted, item => item.attempted)
  const correct = sum(sorted, item => item.correct)
  const recent = sorted.slice(0, 3)
  const recentAttempted = sum(recent, item => item.attempted)
  return {
    sessions: sorted.length,
    attempted,
    correct,
    incorrect: sum(sorted, item => item.incorrect),
    skipped: sum(sorted, item => item.skipped ?? 0),
    accuracy: attempted > 0 ? (correct / attempted) * 100 : null,
    recentAccuracy: recentAttempted > 0 ? (sum(recent, item => item.correct) / recentAttempted) * 100 : null,
    timeMinutes: sum(sorted, item => item.time_minutes ?? 0),
    secondsPerQuestion: (() => {
      const timed = sorted.filter(item => item.time_minutes !== null && item.attempted > 0)
      const timedAttempted = sum(timed, item => item.attempted)
      const timedMinutes = sum(timed, item => item.time_minutes ?? 0)
      return timedAttempted > 0 && timedMinutes > 0 ? (timedMinutes * 60) / timedAttempted : null
    })()
  }
}

export type SpeedAccuracyBand = 'fast-accurate' | 'fast-loose' | 'slow-accurate' | 'slow-loose'

/**
 * The four practice quadrants, against the student's own weak-area threshold and a 90-second
 * pace reference (JEE Main allows roughly 1 minute per question, Advanced more; 90 s is a
 * middle marker, not a target). "Fast and accurate" is the only cell that needs no work.
 */
export function speedAccuracyBand(agg: PracticeAggregate, weakThreshold: number): SpeedAccuracyBand | null {
  if (agg.accuracy === null || agg.secondsPerQuestion === null || agg.attempted < PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL) return null
  const accurate = agg.accuracy >= weakThreshold
  const fast = agg.secondsPerQuestion <= 90
  if (accurate) return fast ? 'fast-accurate' : 'slow-accurate'
  return fast ? 'fast-loose' : 'slow-loose'
}

export function practiceByChapter(data: AppData): Map<string, PracticeAggregate> {
  const grouped = new Map<string, PracticeSession[]>()
  for (const session of data.practiceSessions) {
    const list = grouped.get(session.chapter_id) ?? []
    list.push(session)
    grouped.set(session.chapter_id, list)
  }
  return new Map([...grouped.entries()].map(([chapterId, sessions]) => [chapterId, aggregatePractice(sessions)]))
}

/* ------------------------------------------------------------------ */
/* PYQ tracker                                                         */
/* ------------------------------------------------------------------ */

export const PYQ_EXAM_LABEL: Record<PYQExam, string> = { Main: 'JEE Main', Advanced: 'JEE Advanced' }

/** Inclusive year window from Settings. Years with no row are simply pending. */
export function pyqYears(settings: Pick<AppSettings, 'pyq_from_year' | 'pyq_to_year'>): number[] {
  const years: number[] = []
  for (let year = settings.pyq_to_year; year >= settings.pyq_from_year; year -= 1) years.push(year)
  return years
}

export interface PyqCompletion {
  exam: PYQExam
  done: number
  total: number
  /** Percentage, or null when the window is empty. */
  percent: number | null
  pendingYears: number[]
  doneYears: number[]
  /** Question-level detail, present only for years where both counts were recorded. */
  questions: { done: number; total: number; percent: number | null }
}

export function pyqCompletion(records: PyqRecord[], chapterId: string | null, exam: PYQExam, settings: AppSettings): PyqCompletion {
  const years = pyqYears(settings)
  const doneYears = years.filter(year => records.some(record => (chapterId === null || record.chapter_id === chapterId) && record.exam === exam && record.year === year && record.status === 'done'))
  const done = doneYears.length
  const scoped = records.filter(record => (chapterId === null || record.chapter_id === chapterId) && record.exam === exam && years.includes(record.year))
  const withCounts = scoped.filter(record => record.questions_total !== null && record.questions_total > 0)
  const questionsDone = withCounts.reduce((sum, record) => sum + Math.min(record.questions_done ?? 0, record.questions_total ?? 0), 0)
  const questionsTotal = withCounts.reduce((sum, record) => sum + (record.questions_total ?? 0), 0)
  return {
    exam, done, total: years.length,
    percent: years.length ? (done / years.length) * 100 : null,
    doneYears,
    pendingYears: years.filter(year => !doneYears.includes(year)),
    questions: { done: questionsDone, total: questionsTotal, percent: questionsTotal > 0 ? (questionsDone / questionsTotal) * 100 : null }
  }
}

/** PYQ columns the student actually tracks: JEE has Main and Advanced, other exams one column. */
export function pyqExamsFor(settings: Pick<AppSettings, 'exam_id'>): PYQExam[] {
  return isJeeExam(settings.exam_id ?? null) ? ['Main', 'Advanced'] : ['Main']
}

/**
 * Every chapter-year marked done in the tracked PYQ window. One year marked done counts
 * here immediately, even before a whole chapter's PYQ stage is complete.
 */
export function pyqProgressCounts(data: AppData): { doneYears: number; startedChapters: number; completeChapters: number } {
  const years = new Set(pyqYears(data.settings))
  const exams = new Set(pyqExamsFor(data.settings))
  const chapterIds = new Set(data.chapters.map(chapter => chapter.id))
  const seen = new Set<string>()
  const started = new Set<string>()
  for (const record of data.pyqRecords) {
    if (record.status !== 'done' || !years.has(record.year) || !exams.has(record.exam) || !chapterIds.has(record.chapter_id)) continue
    const key = `${record.chapter_id}|${record.exam}|${record.year}`
    if (seen.has(key)) continue
    seen.add(key)
    started.add(record.chapter_id)
  }
  const completeChapters = data.chapters.filter(chapter => chapterStages(data, chapter).find(stage => stage.key === 'pyqs')?.done).length
  return { doneYears: seen.size, startedChapters: started.size, completeChapters }
}

/* ------------------------------------------------------------------ */
/* Chapter stages — Theory → Notes → PYQs → Revised → Tested            */
/* ------------------------------------------------------------------ */

export interface StageState {
  key: ChapterStageKey
  label: string
  /** 0–1 progress for this stage. PYQs is fractional; the others are binary. */
  progress: number
  done: boolean
  /** Where the completion came from, shown in the UI for honesty. */
  source: 'manual' | 'evidence' | 'partial' | 'none'
}

const STAGE_LABELS: Record<ChapterStageKey, string> = {
  theory: 'Theory', notes: 'Notes', pyqs: 'PYQs', revised: 'Revised', tested: 'Tested'
}

/**
 * Derive every stage for one chapter. Manual toggles (`chapter_stages` rows) are the
 * student's own claim; Revised and Tested also accept real evidence (a completed
 * revision, a recorded test result). Nothing forces a linear order.
 */
export function chapterStages(data: AppData, chapter: Chapter): StageState[] {
  const manual = new Map(data.chapterStages.filter(row => row.chapter_id === chapter.id).map(row => [row.stage, row.done]))
  // Non-JEE exams keep their PYQ years in the single (Main) column, so only that column counts.
  const pyqTotals = pyqExamsFor(data.settings).map(exam => pyqCompletion(data.pyqRecords, chapter.id, exam, data.settings))
  const pyqTotal = pyqTotals.reduce((sum, row) => sum + row.total, 0)
  const pyqDone = pyqTotals.reduce((sum, row) => sum + row.done, 0)
  const hasRevision = data.revisions.some(revision => revision.chapter_id === chapter.id && revision.completed_at)
  const hasTest = data.tests.some(test => test.chapter_id === chapter.id) || data.testChapterLinks.some(link => link.chapter_id === chapter.id)
  // Chapter status is itself evidence: Studying/Done/Revised means theory has started,
  // Revised means a revision pass happened, and non-empty notes mean notes exist.
  // This keeps the learning-pipeline tile and the per-chapter chips in sync with the syllabus status.
  const theoryFromStatus = chapter.status === 'Studying' || chapter.status === 'Done' || chapter.status === 'Revised'
  const revisedFromStatus = chapter.status === 'Revised'
  const notesFromChapter = Boolean(chapter.notes?.trim() || chapter.formula_notes?.trim())

  return CHAPTER_STAGE_KEYS.map(key => {
    const claimed = manual.get(key) === true
    const label = STAGE_LABELS[key]
    if (key === 'pyqs') {
      const progress = pyqTotal ? pyqDone / pyqTotal : 0
      const done = pyqTotal > 0 && pyqDone === pyqTotal
      return { key, label, progress, done, source: done ? 'manual' : pyqDone > 0 ? 'partial' : 'none' }
    }
    if (key === 'revised') {
      const fromRecords = hasRevision || revisedFromStatus
      const done = claimed || fromRecords
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : fromRecords ? 'evidence' : 'none' }
    }
    if (key === 'tested') {
      const done = claimed || hasTest
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : hasTest ? 'evidence' : 'none' }
    }
    if (key === 'theory') {
      const done = claimed || theoryFromStatus
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : theoryFromStatus ? 'evidence' : 'none' }
    }
    if (key === 'notes') {
      const done = claimed || notesFromChapter
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : notesFromChapter ? 'evidence' : 'none' }
    }
    return { key, label, progress: claimed ? 1 : 0, done: claimed, source: claimed ? 'manual' : 'none' }
  })
}

/** Average of the five stage progress values: a raw "how far through the pipeline" number. */
export function chapterPipelinePercent(stages: StageState[]): number {
  return stages.length ? (stages.reduce((sum, stage) => sum + stage.progress, 0) / stages.length) * 100 : 0
}

export function stageCounts(data: AppData): Record<ChapterStageKey, number> {
  const counts = Object.fromEntries(CHAPTER_STAGE_KEYS.map(key => [key, 0])) as Record<ChapterStageKey, number>
  for (const chapter of data.chapters) {
    for (const stage of chapterStages(data, chapter)) if (stage.done) counts[stage.key] += 1
  }
  return counts
}

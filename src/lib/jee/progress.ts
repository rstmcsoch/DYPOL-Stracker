import type {
  AppData, AppSettings, Chapter, ChapterImportance, ChapterStageKey, PracticeSession, PYQExam, PyqRecord, Subject
} from '../../types/index.js'
import { CHAPTER_STAGE_KEYS, SUBJECTS } from '../../types/index.js'

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
    bySubject: SUBJECTS.map(subject => ({ subject, ...ratio(chapters.filter(chapter => chapter.subject === subject)) }))
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
  /** correct ÷ attempted, as a percentage. Null when nothing has been attempted. */
  accuracy: number | null
  /** Accuracy over the most recent three practice blocks only. */
  recentAccuracy: number | null
  timeMinutes: number
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
    accuracy: attempted > 0 ? (correct / attempted) * 100 : null,
    recentAccuracy: recentAttempted > 0 ? (sum(recent, item => item.correct) / recentAttempted) * 100 : null,
    timeMinutes: sum(sorted, item => item.time_minutes ?? 0)
  }
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
}

export function pyqCompletion(records: PyqRecord[], chapterId: string | null, exam: PYQExam, settings: AppSettings): PyqCompletion {
  const years = pyqYears(settings)
  const doneYears = years.filter(year => records.some(record => (chapterId === null || record.chapter_id === chapterId) && record.exam === exam && record.year === year && record.status === 'done'))
  const done = doneYears.length
  return {
    exam, done, total: years.length,
    percent: years.length ? (done / years.length) * 100 : null,
    doneYears,
    pendingYears: years.filter(year => !doneYears.includes(year))
  }
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
  const pyq = pyqCompletion(data.pyqRecords, chapter.id, 'Main', data.settings)
  const pyqAdv = pyqCompletion(data.pyqRecords, chapter.id, 'Advanced', data.settings)
  const pyqTotal = pyq.total + pyqAdv.total
  const pyqDone = pyq.done + pyqAdv.done
  const hasRevision = data.revisions.some(revision => revision.chapter_id === chapter.id && revision.completed_at)
  const hasTest = data.tests.some(test => test.chapter_id === chapter.id) || data.testChapterLinks.some(link => link.chapter_id === chapter.id)

  return CHAPTER_STAGE_KEYS.map(key => {
    const claimed = manual.get(key) === true
    const label = STAGE_LABELS[key]
    if (key === 'pyqs') {
      const progress = pyqTotal ? pyqDone / pyqTotal : 0
      const done = pyqTotal > 0 && pyqDone === pyqTotal
      return { key, label, progress, done, source: done ? 'manual' : pyqDone > 0 ? 'partial' : 'none' }
    }
    if (key === 'revised') {
      const done = claimed || hasRevision
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : hasRevision ? 'evidence' : 'none' }
    }
    if (key === 'tested') {
      const done = claimed || hasTest
      return { key, label, progress: done ? 1 : 0, done, source: claimed ? 'manual' : hasTest ? 'evidence' : 'none' }
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

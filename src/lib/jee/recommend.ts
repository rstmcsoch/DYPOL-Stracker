import { differenceInCalendarDays, parseISO } from 'date-fns'
import { getChapterPerformance } from '../analytics.js'
import { indiaDate } from '../date.js'
import { practiceByChapter, pyqCompletion, importanceWeight } from './progress.js'
import { isAwake } from './reminders.js'
import { currentExamMode } from './exam.js'
import type { AppData, Chapter, Subject } from '../../types/index.js'

/**
 * Deterministic "What should I study now?" engine. It only reads data and never calls
 * Date.now(): `today` is injected, so the same data always yields the same ranking.
 * Each candidate carries human-readable reasons, so every recommendation is explainable.
 */

export type RecommendationKind =
  | 'revision' | 'backlog' | 'flashcards' | 'practice' | 'pyq' | 'weak-chapter'
  | 'retry-mistakes' | 'mock-fix' | 'start-chapter'

export interface Recommendation {
  id: string
  kind: RecommendationKind
  title: string
  subject: Subject | null
  chapterId: string | null
  score: number
  reasons: string[]
  /** One-sentence explanation, e.g. "Study Electrostatics — PYQ accuracy is 58%, revision is overdue." */
  summary: string
  to: string
  actionLabel: string
}

export interface StudyNowResult {
  primary: Recommendation | null
  alternatives: Recommendation[]
  examMode: boolean
  examLabel: string | null
  /** Shown when there is simply nothing actionable yet. */
  emptyReason: string | null
}

const IMPORTANCE_FACTOR_MIN = 0.6
const IMPORTANCE_FACTOR_MAX = 1.6
const MAX_ALTERNATIVES = 4

function joinReasons(reasons: string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? ''
  return `${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`
}

function summarise(title: string, reasons: string[]): string {
  return reasons.length ? `Study ${title} — ${joinReasons(reasons)}.` : `Study ${title}.`
}

interface Draft { id: string; kind: RecommendationKind; title: string; subject: Subject | null; chapterId: string | null; base: number; reasons: string[]; to: string; actionLabel: string; examBoost?: boolean; scaleByImportance?: boolean; chapterPriority?: Chapter['priority'] }

export function recommendStudyNow(data: AppData, today: string): StudyNowResult {
  const exam = currentExamMode(data, today)
  const now = new Date(`${today}T12:00:00`)
  const chapterById = new Map(data.chapters.map(chapter => [chapter.id, chapter]))
  const performance = new Map(getChapterPerformance(data).map(item => [item.chapter.id, item]))
  const practice = practiceByChapter(data)
  const drafts: Draft[] = []
  const threshold = data.settings.weak_threshold

  // 1. Revisions — overdue first, then due today.
  const revisionsByChapter = new Map<string, { overdueDays: number; dueToday: boolean; count: number }>()
  for (const revision of data.revisions) {
    if (revision.completed_at || !chapterById.has(revision.chapter_id)) continue
    const current = revisionsByChapter.get(revision.chapter_id) ?? { overdueDays: 0, dueToday: false, count: 0 }
    if (revision.due_on < today) current.overdueDays = Math.max(current.overdueDays, differenceInCalendarDays(now, parseISO(`${revision.due_on}T12:00:00`)))
    else if (revision.due_on === today) current.dueToday = true
    else continue
    current.count += 1
    revisionsByChapter.set(revision.chapter_id, current)
  }
  for (const [chapterId, info] of revisionsByChapter) {
    const chapter = chapterById.get(chapterId)!
    const reasons: string[] = []
    let base = 0
    if (info.overdueDays > 0) { base = 78 + Math.min(info.overdueDays, 14) * 1.2; reasons.push(`revision is overdue by ${info.overdueDays} day${info.overdueDays === 1 ? '' : 's'}`) }
    else { base = 60; reasons.push('revision is due today') }
    drafts.push({ id: `rev:${chapterId}`, kind: 'revision', title: chapter.name, subject: chapter.subject, chapterId, base, reasons, to: '/revision', actionLabel: 'Open revisions', examBoost: true, scaleByImportance: true, chapterPriority: chapter.priority })
  }

  // 2. Backlog — overdue, due today, or a high-priority active item.
  for (const item of data.backlogItems) {
    if (!isAwake(item, today)) continue
    const dueOverdue = item.due_on !== null && item.due_on < today
    const dueToday = item.due_on === today
    if (!dueOverdue && !dueToday && item.priority !== 'High') continue
    // During exam mode only genuinely important backlog outranks revision and PYQ work.
    if (exam.active && !dueOverdue && !dueToday && item.priority !== 'High') continue
    const reasons: string[] = []
    let base: number
    if (dueOverdue) { base = 70; reasons.push('it is past its due date') }
    else if (dueToday) { base = 60; reasons.push('it is due today') }
    else { base = 46; reasons.push('it is marked high priority') }
    if (item.priority === 'High' && !reasons.includes('it is marked high priority')) reasons.push('it is marked high priority')
    const chapter = item.chapter_id ? chapterById.get(item.chapter_id) : undefined
    drafts.push({ id: `backlog:${item.id}`, kind: 'backlog', title: item.title, subject: item.subject ?? chapter?.subject ?? null, chapterId: item.chapter_id, base, reasons, to: '/backlog', actionLabel: 'Open backlog', examBoost: false })
  }

  // 3. Flashcards due for review, grouped by chapter.
  const dueCards = new Map<string, number>()
  for (const card of data.studyCards) {
    // New cards (no review yet) are due immediately; scheduled cards wait for their date.
    if ((card.next_review_at && indiaDate(card.next_review_at) > today) || !chapterById.has(card.chapter_id)) continue
    dueCards.set(card.chapter_id, (dueCards.get(card.chapter_id) ?? 0) + 1)
  }
  for (const [chapterId, count] of dueCards) {
    const chapter = chapterById.get(chapterId)!
    drafts.push({ id: `cards:${chapterId}`, kind: 'flashcards', title: `${chapter.name} flashcards`, subject: chapter.subject, chapterId, base: 50 + Math.min(count, 10), reasons: [`${count} card${count === 1 ? ' is' : 's are'} due for review`], to: '/decks', actionLabel: 'Review cards', examBoost: true })
  }

  // 4. Mistakes waiting for a retry.
  const retryByChapter = new Map<string, number>()
  for (const mistake of data.mistakes) {
    if (mistake.retry_status !== 'pending' || !mistake.retry_later || !chapterById.has(mistake.chapter_id)) continue
    retryByChapter.set(mistake.chapter_id, (retryByChapter.get(mistake.chapter_id) ?? 0) + 1)
  }
  for (const [chapterId, count] of retryByChapter) {
    const chapter = chapterById.get(chapterId)!
    drafts.push({ id: `retry:${chapterId}`, kind: 'retry-mistakes', title: chapter.name, subject: chapter.subject, chapterId, base: 52 + Math.min(count, 8) * 2, reasons: [`${count} saved mistake${count === 1 ? ' is' : 's are'} waiting for a retry`], to: '/retry', actionLabel: 'Open retry', examBoost: true })
  }

  // 5. Practice accuracy and chapter-level test weakness.
  for (const chapter of data.chapters) {
    const agg = practice.get(chapter.id)
    const perf = performance.get(chapter.id)
    const reasons: string[] = []
    let base = 0
    if (agg && agg.attempted >= 10 && agg.accuracy !== null && agg.accuracy < threshold) {
      base = Math.max(base, 62 + (threshold - agg.accuracy) * 0.4)
      reasons.push(`practice accuracy is ${Math.round(agg.accuracy)}%`)
      if (agg.incorrect >= 20) reasons.push(`${agg.incorrect} questions were answered incorrectly`)
    }
    if (perf?.classification === 'Weak' && perf.average !== null) {
      base = Math.max(base, 64 + (threshold - perf.average) * 0.4)
      reasons.push(`your test average is ${Math.round(perf.average)}%`)
    }
    if (perf?.dropping) { base += 6; reasons.push('the latest test dropped sharply') }
    if (base > 0) {
      drafts.push({ id: `weak:${chapter.id}`, kind: 'weak-chapter', title: chapter.name, subject: chapter.subject, chapterId: chapter.id, base, reasons, to: '/weak-areas', actionLabel: 'See weak areas', examBoost: true, scaleByImportance: true, chapterPriority: chapter.priority })
    }
  }

  // 6. Pending PYQs on chapters the student has already started.
  for (const chapter of data.chapters) {
    if (chapter.status === 'Not Started') continue
    const main = pyqCompletion(data.pyqRecords, chapter.id, 'Main', data.settings)
    const advanced = pyqCompletion(data.pyqRecords, chapter.id, 'Advanced', data.settings)
    const pending = (main.total - main.done) + (advanced.total - advanced.done)
    const total = main.total + advanced.total
    if (pending <= 0 || total === 0 || pending === total) continue
    const percentDone = Math.round(((total - pending) / total) * 100)
    drafts.push({ id: `pyq:${chapter.id}`, kind: 'pyq', title: chapter.name, subject: chapter.subject, chapterId: chapter.id, base: 44 + (pending / total) * 12, reasons: [`PYQs are ${percentDone}% done`], to: '/pyqs', actionLabel: 'Open PYQs', examBoost: true, scaleByImportance: true, chapterPriority: chapter.priority })
  }

  // 7. Fix the largest lost-marks category from recorded mock analysis.
  const lostBySubjectCategory = new Map<string, { subject: Subject; category: string; marks: number }>()
  for (const log of data.testErrorLogs) {
    if (!log.subject || log.marks_lost == null || log.marks_lost <= 0) continue
    const key = `${log.subject}|${log.category}`
    const entry = lostBySubjectCategory.get(key) ?? { subject: log.subject, category: log.category, marks: 0 }
    entry.marks += log.marks_lost
    lostBySubjectCategory.set(key, entry)
  }
  const topLoss = [...lostBySubjectCategory.values()].sort((a, b) => b.marks - a.marks || a.subject.localeCompare(b.subject) || a.category.localeCompare(b.category))[0]
  if (topLoss && topLoss.marks >= 4) {
    drafts.push({ id: `mock:${topLoss.subject}:${topLoss.category}`, kind: 'mock-fix', title: `${topLoss.subject} — ${topLoss.category.toLowerCase()}`, subject: topLoss.subject, chapterId: null, base: 50 + Math.min(topLoss.marks, 30) * 0.3, reasons: [`${topLoss.marks} marks were lost to ${topLoss.category.toLowerCase()} in mocks`], to: '/mock-analysis', actionLabel: 'Open mock analysis', examBoost: true })
  }

  // 8. Start a chapter nobody has touched, when no urgent work exists. Blocked in exam mode.
  if (!exam.active) {
    for (const chapter of data.chapters) {
      if (chapter.status !== 'Not Started' || chapter.priority !== 'High') continue
      drafts.push({ id: `start:${chapter.id}`, kind: 'start-chapter', title: chapter.name, subject: chapter.subject, chapterId: chapter.id, base: 36, reasons: ['it is a high-priority chapter you have not started'], to: '/syllabus', actionLabel: 'Open syllabus', scaleByImportance: true, chapterPriority: chapter.priority })
    }
  }

  const scored: Recommendation[] = drafts.map(draft => {
    let score = draft.base
    const reasons = [...draft.reasons]
    if (draft.scaleByImportance && draft.chapterId) {
      const chapter = chapterById.get(draft.chapterId)
      const factor = Math.min(IMPORTANCE_FACTOR_MAX, Math.max(IMPORTANCE_FACTOR_MIN, importanceWeight(data.settings, chapter?.importance) / (data.settings.weight_medium || 1)))
      score *= factor
      if (chapter?.importance === 'high') reasons.push('the chapter is marked high importance')
    }
    if (draft.chapterPriority === 'High') { score += 4; if (!reasons.some(reason => reason.includes('priority'))) reasons.push('it is marked high priority') }
    if (exam.active && draft.examBoost) score *= exam.boost
    return {
      id: draft.id, kind: draft.kind, title: draft.title, subject: draft.subject, chapterId: draft.chapterId,
      score: Math.round(score * 100) / 100, reasons, summary: summarise(draft.title, reasons), to: draft.to, actionLabel: draft.actionLabel
    }
  }).filter(item => item.score > 0)

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const [primary = null, ...rest] = scored
  const alternatives = rest.slice(0, MAX_ALTERNATIVES)
  const hasAnyChapter = data.chapters.length > 0
  const emptyReason = primary ? null
    : !hasAnyChapter ? 'Your syllabus is empty. Add chapters to get recommendations.'
    : 'Nothing is urgent right now. Log a practice block or a test and the next recommendation will sharpen.'

  return {
    primary, alternatives, examMode: exam.active, examLabel: exam.label, emptyReason
  }
}


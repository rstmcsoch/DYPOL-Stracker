import { stableId } from '../id.js'
import type { ChapterStageKey, PYQExam } from '../../types/index.js'

/**
 * Deterministic IDs for rows that must be unique per (owner, business key). Using the
 * business key as the ID means two devices, or a retry after a flaky network, can never
 * create a second PYQ row for the same chapter/exam/year or a second stage toggle.
 */
export const pyqRecordId = (userId: string, chapterId: string, exam: PYQExam, year: number): string =>
  stableId(`${userId}:pyq:${chapterId}:${exam}:${year}`)

export const chapterStageId = (userId: string, chapterId: string, stage: ChapterStageKey): string =>
  stableId(`${userId}:stage:${chapterId}:${stage}`)

/** The study-time row that mirrors a practice block's time. Same ID on every save, so edits update it. */
export const practiceStudySessionId = (practiceId: string): string => stableId(`practice-time:${practiceId}`)

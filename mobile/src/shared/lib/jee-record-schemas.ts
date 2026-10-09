import { z } from 'zod'
import {
  BACKLOG_TYPES, CARD_DIFFICULTIES, CARD_KINDS, CHAPTER_STAGE_KEYS, ERROR_CATEGORIES,
  PRACTICE_SOURCES, PYQ_EXAMS, TRACK_IDS
} from '../types/index.js'
import { POSTGRES_INTEGER_MAX } from './test-validation.js'

/**
 * Backup/import schemas for the JEE-preparation collections. They mirror the Postgres
 * constraints in the 20261008180000 migration so an imported row can always be synced.
 */
const dateValue = z.iso.date()
const timestampValue = z.iso.datetime({ offset: true })
const uuid = z.string().uuid()
const subjectValue = z.enum(['Physics', 'Chemistry', 'Maths'])
const baseFields = {
  id: uuid, created_at: timestampValue, updated_at: timestampValue, user_id: uuid.optional()
}
const count = z.number().finite().int().min(0).max(100000)

export const practiceSessionSchema = z.object({
  ...baseFields,
  chapter_id: uuid,
  practice_date: dateValue,
  attempted: count, correct: count, incorrect: count,
  source: z.enum(PRACTICE_SOURCES),
  time_minutes: z.number().finite().int().min(0).max(1440).nullable(),
  notes: z.string().max(5000)
}).refine(value => value.correct + value.incorrect <= value.attempted, {
  path: ['attempted'], message: 'Correct plus incorrect cannot exceed attempted.'
})

export const pyqRecordSchema = z.object({
  ...baseFields,
  chapter_id: uuid,
  exam: z.enum(PYQ_EXAMS),
  year: z.number().finite().int().min(1990).max(2100),
  status: z.enum(['done', 'pending']),
  questions_total: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable(),
  questions_done: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  completed_at: timestampValue.nullable()
})

export const chapterStageSchema = z.object({
  ...baseFields,
  chapter_id: uuid,
  stage: z.enum(CHAPTER_STAGE_KEYS),
  done: z.boolean(),
  completed_at: timestampValue.nullable()
})

export const backlogItemSchema = z.object({
  ...baseFields,
  title: z.string().trim().min(1).max(200),
  type: z.enum(BACKLOG_TYPES),
  subject: subjectValue.nullable(),
  chapter_id: uuid.nullable(),
  priority: z.enum(['High', 'Medium', 'Low']),
  due_on: dateValue.nullable(),
  status: z.enum(['active', 'done', 'snoozed']),
  snoozed_until: dateValue.nullable(),
  completed_at: timestampValue.nullable(),
  notes: z.string().max(5000)
})

export const studyCardSchema = z.object({
  ...baseFields,
  chapter_id: uuid,
  kind: z.enum(CARD_KINDS),
  front: z.string().trim().min(1).max(5000),
  back: z.string().trim().min(1).max(10000),
  hint: z.string().max(2000),
  position: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX),
  difficulty: z.enum(CARD_DIFFICULTIES).nullable(),
  reviews: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX),
  last_reviewed_at: timestampValue.nullable(),
  next_review_at: timestampValue.nullable()
})

export const testErrorLogSchema = z.object({
  ...baseFields,
  test_id: uuid,
  chapter_id: uuid.nullable(),
  subject: subjectValue.nullable(),
  category: z.enum(ERROR_CATEGORIES),
  marks_lost: z.number().finite().min(0).max(999999.99).nullable(),
  questions: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable(),
  note: z.string().max(5000)
})

export const testTimeEntrySchema = z.object({
  ...baseFields,
  test_id: uuid,
  subject: subjectValue.nullable(),
  label: z.string().max(120),
  minutes: z.number().finite().int().min(0).max(1440).nullable(),
  attempted: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable(),
  unattempted: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable(),
  order_index: z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX)
})

export const userExamTrackSchema = z.object({
  ...baseFields,
  track: z.enum(TRACK_IDS),
  label: z.string().max(120),
  exam_date: dateValue.nullable(),
  enabled: z.boolean(),
  target_score: z.number().finite().min(0).max(999999.99).nullable(),
  notes: z.string().max(5000)
})

import { z } from 'zod'
import { BACKLOG_TYPES, CARD_DIFFICULTIES, CARD_KINDS, CHAPTER_STAGE_KEYS, ERROR_CATEGORIES, PRACTICE_SOURCES, PYQ_EXAMS, STUDY_ACTIVITIES, TRACK_IDS, type TableName } from '../types/index.js'
import { goalSchema } from './goal-validation.js'
import { settingsSchema } from './settings-validation.js'
import { taskInputSchema } from './task-validation.js'
import { chapterScoreInputSchema, POSTGRES_INTEGER_MAX, subjectScoreInputSchema, testFormSchema } from './test-validation.js'

const nonNegativePostgresInteger = z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX)
const positivePostgresInteger = z.number().finite().int().min(1).max(POSTGRES_INTEGER_MAX)
const dateValue = z.iso.date()
const chapterPositionSchema = z.object({ position: nonNegativePostgresInteger })
const revisionRecordSchema = z.object({ revision_number: positivePostgresInteger, due_on: dateValue })
const taskPositionSchema = z.object({ position: nonNegativePostgresInteger })
const sessionDurationSchema = z.object({ duration_minutes: z.number().finite().int().min(0).max(1440) })

const practiceSessionSchema = z.object({
  chapter_id: z.string().min(1),
  practice_date: dateValue,
  attempted: nonNegativePostgresInteger.max(100000),
  correct: nonNegativePostgresInteger.max(100000),
  incorrect: nonNegativePostgresInteger.max(100000),
  source: z.enum(PRACTICE_SOURCES),
  time_minutes: z.number().finite().int().min(0).max(1440).nullable().optional()
}).refine(value => value.correct + value.incorrect <= value.attempted, {
  path: ['attempted'], message: 'Correct plus incorrect cannot exceed attempted.'
})

const pyqRecordSchema = z.object({
  chapter_id: z.string().min(1),
  exam: z.enum(PYQ_EXAMS),
  year: z.number().finite().int().min(1990).max(2100),
  status: z.enum(['done', 'pending']),
  questions_total: nonNegativePostgresInteger.nullable().optional(),
  questions_done: nonNegativePostgresInteger.nullable().optional()
})

const chapterStageSchema = z.object({
  chapter_id: z.string().min(1),
  stage: z.enum(CHAPTER_STAGE_KEYS),
  done: z.boolean()
})

const backlogItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(BACKLOG_TYPES),
  subject: z.enum(['Physics', 'Chemistry', 'Maths']).nullable().optional(),
  chapter_id: z.string().nullable().optional(),
  priority: z.enum(['High', 'Medium', 'Low']),
  due_on: dateValue.nullable().optional(),
  status: z.enum(['active', 'done', 'snoozed']),
  snoozed_until: dateValue.nullable().optional()
})

const studyCardSchema = z.object({
  chapter_id: z.string().min(1),
  kind: z.enum(CARD_KINDS),
  front: z.string().trim().min(1).max(5000),
  back: z.string().trim().min(1).max(10000),
  position: nonNegativePostgresInteger,
  difficulty: z.enum(CARD_DIFFICULTIES).nullable().optional()
})

const testErrorLogSchema = z.object({
  test_id: z.string().min(1),
  category: z.enum(ERROR_CATEGORIES),
  marks_lost: z.number().finite().min(0).max(999999.99).multipleOf(0.01).nullable().optional(),
  questions: nonNegativePostgresInteger.nullable().optional()
})

const testTimeEntrySchema = z.object({
  test_id: z.string().min(1),
  minutes: z.number().finite().int().min(0).max(1440).nullable().optional(),
  attempted: nonNegativePostgresInteger.nullable().optional(),
  unattempted: nonNegativePostgresInteger.nullable().optional(),
  order_index: nonNegativePostgresInteger
})

const userExamTrackSchema = z.object({
  track: z.enum(TRACK_IDS),
  exam_date: dateValue.nullable().optional(),
  enabled: z.boolean()
})

/**
 * Last client-side persistence boundary before a record enters IndexedDB or the
 * Supabase sync queue. UI forms also validate; this protects imports and any future
 * caller from caching a record that violates the same numeric contract.
 */
export function validatePersistedRecords(table: TableName, records: Record<string, unknown>[]): void {
  const failures: string[] = []
  for (const [index, record] of records.entries()) {
    let parsed: { success: boolean; error?: z.ZodError }
    switch (table) {
      case 'tests': parsed = testFormSchema.safeParse(record); break
      case 'test_subject_scores': parsed = subjectScoreInputSchema.safeParse(record); break
      case 'test_chapter_links': parsed = chapterScoreInputSchema.safeParse(record); break
      case 'app_settings': parsed = settingsSchema.safeParse(record); break
      case 'chapters': parsed = chapterPositionSchema.safeParse(record); break
      case 'chapter_revisions': parsed = revisionRecordSchema.safeParse(record); break
      case 'daily_tasks': {
        const task = taskInputSchema.safeParse(record)
        const position = taskPositionSchema.safeParse(record)
        parsed = task.success && position.success ? { success: true } : {
          success: false,
          error: task.success ? position.error : position.success ? task.error : new z.ZodError([...task.error.issues, ...position.error.issues])
        }
        break
      }
      case 'weekly_goals': parsed = goalSchema.safeParse(record); break
      case 'study_sessions': {
        const duration = sessionDurationSchema.safeParse(record)
        const activity = z.enum(STUDY_ACTIVITIES).safeParse(record.activity ?? 'Practice')
        parsed = duration.success && activity.success ? { success: true } : {
          success: false,
          error: duration.success ? activity.error : activity.success ? duration.error : new z.ZodError([...duration.error.issues, ...activity.error.issues])
        }
        break
      }
      case 'practice_sessions': parsed = practiceSessionSchema.safeParse(record); break
      case 'pyq_records': parsed = pyqRecordSchema.safeParse(record); break
      case 'chapter_stages': parsed = chapterStageSchema.safeParse(record); break
      case 'backlog_items': parsed = backlogItemSchema.safeParse(record); break
      case 'study_cards': parsed = studyCardSchema.safeParse(record); break
      case 'test_error_logs': parsed = testErrorLogSchema.safeParse(record); break
      case 'test_time_entries': parsed = testTimeEntrySchema.safeParse(record); break
      case 'user_exam_tracks': parsed = userExamTrackSchema.safeParse(record); break
      default: parsed = { success: true }
    }
    if (!parsed.success) {
      const message = parsed.error?.issues.map(issue => issue.message).join(' ') ?? 'Invalid numeric or date value.'
      failures.push(`row ${index + 1}: ${message}`)
    }
  }
  if (failures.length) throw new Error(`Cannot save invalid ${table.replaceAll('_', ' ')} data. ${failures.join(' ')}`)
}

/** Refuse a reversible delete if restoring any affected row would violate current validation. */
export function validateUndoRestores(records: { table: TableName; record: Record<string, unknown> }[]): void {
  const failures: string[] = []
  for (const item of records) {
    try {
      validatePersistedRecords(item.table, [item.record])
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `Invalid ${item.table.replaceAll('_', ' ')} row.`)
    }
  }
  if (failures.length) {
    throw new Error(`Cannot delete this record while Undo is available because stored values fail current validation. Edit and correct the invalid values first. ${failures.join(' ')}`)
  }
}

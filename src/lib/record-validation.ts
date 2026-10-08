import { z } from 'zod'
import type { TableName } from '../types/index.js'
import { goalSchema } from './goal-validation.js'
import { settingsSchema } from './settings-validation.js'
import { taskInputSchema } from './task-validation.js'
import { chapterScoreInputSchema, POSTGRES_INTEGER_MAX, subjectScoreInputSchema, testFormSchema } from './test-validation.js'

const nonNegativePostgresInteger = z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX)
const positivePostgresInteger = z.number().finite().int().min(1).max(POSTGRES_INTEGER_MAX)
const chapterPositionSchema = z.object({ position: nonNegativePostgresInteger })
const revisionRecordSchema = z.object({ revision_number: positivePostgresInteger, due_on: z.iso.date() })
const taskPositionSchema = z.object({ position: nonNegativePostgresInteger })
const sessionDurationSchema = z.object({ duration_minutes: z.number().finite().int().min(0).max(1440) })

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
      case 'study_sessions': parsed = sessionDurationSchema.safeParse(record); break
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

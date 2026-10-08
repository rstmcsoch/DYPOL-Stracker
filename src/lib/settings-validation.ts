import { z } from 'zod'

const dateValue = z.iso.date()
const timestampValue = z.iso.datetime({ offset: true })
const POSTGRES_INTEGER_MAX = 2_147_483_647

export const settingsSchema = z.object({
  owner_name: z.string().trim().max(100),
  main_exam_date: z.union([z.literal(''), dateValue]),
  advanced_exam_date: z.union([z.literal(''), dateValue]),
  target_score: z.number().min(0).max(999_999.99).multipleOf(0.01),
  theme: z.enum(['light', 'dark', 'auto']),
  weak_threshold: z.number().min(0).max(99.99).multipleOf(0.01),
  strong_threshold: z.number().min(0.01).max(100).multipleOf(0.01),
  dropping_threshold: z.number().min(0).max(100).multipleOf(0.01),
  revision_gaps: z.array(z.number().int().positive().max(POSTGRES_INTEGER_MAX)).min(1).max(12),
  daily_study_goal_minutes: z.number().int().min(0).max(1440),
  sound_enabled: z.boolean()
}).refine(value => value.weak_threshold < value.strong_threshold, {
  path: ['strong_threshold'],
  message: 'The weak threshold must be below the strong threshold.'
})

export const settingsRecordSchema = settingsSchema.extend({
  id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  created_at: timestampValue,
  updated_at: timestampValue,
  last_backup_at: timestampValue.nullable()
})

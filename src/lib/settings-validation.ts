import { z } from 'zod'

const dateValue = z.iso.date()
const timestampValue = z.iso.datetime({ offset: true })
const POSTGRES_INTEGER_MAX = 2_147_483_647

export const settingsSchema = z.object({
  owner_name: z.string().trim().max(100),
  main_exam_date: z.union([z.literal(''), dateValue]),
  advanced_exam_date: z.union([z.literal(''), dateValue]),
  target_score: z.number().finite().min(0).max(999_999.99).multipleOf(0.01),
  theme: z.enum(['light', 'dark', 'auto']),
  weak_threshold: z.number().finite().min(0).max(99.99).multipleOf(0.01),
  strong_threshold: z.number().finite().min(0.01).max(100).multipleOf(0.01),
  dropping_threshold: z.number().finite().min(0).max(100).multipleOf(0.01),
  revision_gaps: z.array(z.number().finite().int().positive().max(POSTGRES_INTEGER_MAX)).min(1).max(12),
  daily_study_goal_minutes: z.number().finite().int().min(0).max(1440),
  sound_enabled: z.boolean()
}).refine(value => value.weak_threshold < value.strong_threshold, {
  path: ['strong_threshold'],
  message: 'Strong above must be greater than Weak below.'
})

export type SettingsFieldErrors = Record<string, string>

/** Turn Zod's complete issue list into concise, field-level copy for the Settings form. */
export function settingsFieldErrors(error: z.ZodError): SettingsFieldErrors {
  const fieldErrors: SettingsFieldErrors = {}
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form')
    if (fieldErrors[field]) continue
    switch (field) {
      case 'target_score': fieldErrors[field] = 'Enter a target score from 0 to 999,999.99 (up to two decimal places).'; break
      case 'weak_threshold': fieldErrors[field] = 'Must be between 0 and 99.99, using up to two decimal places.'; break
      case 'strong_threshold': fieldErrors[field] = issue.code === 'custom'
        ? issue.message
        : 'Must be between 0.01 and 100, using up to two decimal places.'; break
      case 'dropping_threshold': fieldErrors[field] = 'Must be between 0 and 100, using up to two decimal places.'; break
      case 'revision_gaps': fieldErrors[field] = 'Enter 1–12 positive whole days, e.g. 1, 7, 30.'; break
      case 'daily_study_goal_minutes': fieldErrors[field] = 'Enter a daily goal from 0 to 24 hours.'; break
      case 'owner_name': fieldErrors[field] = 'Name must be 100 characters or fewer.'; break
      case 'main_exam_date': fieldErrors[field] = 'Choose a valid calendar date or leave it blank.'; break
      case 'advanced_exam_date': fieldErrors[field] = 'Choose a valid calendar date or leave it blank.'; break
      default: fieldErrors[field] = issue.message
    }
  }
  return fieldErrors
}

export const settingsRecordSchema = settingsSchema.extend({
  id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  created_at: timestampValue,
  updated_at: timestampValue,
  last_backup_at: timestampValue.nullable()
})

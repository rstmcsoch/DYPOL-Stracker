import { z } from 'zod'
import { EXAM_MODES, INTERFACE_FONTS, REMINDER_KINDS, TRACK_IDS } from '../types/index.js'

const dateValue = z.iso.date()
const timestampValue = z.iso.datetime({ offset: true })
const POSTGRES_INTEGER_MAX = 2_147_483_647

export const settingsSchema = z.object({
  owner_name: z.string().trim().max(100),
  main_exam_date: z.union([z.literal(''), dateValue]),
  advanced_exam_date: z.union([z.literal(''), dateValue]),
  target_score: z.number().finite().min(0).max(999_999.99).multipleOf(0.01),
  theme: z.enum(['light', 'dark', 'auto']),
  // Defaulted so rows written before the preference existed still validate and simply
  // fall back to the Stracker default typography.
  interface_font: z.enum(INTERFACE_FONTS).default('default'),
  weak_threshold: z.number().finite().min(0).max(99.99).multipleOf(0.01),
  strong_threshold: z.number().finite().min(0.01).max(100).multipleOf(0.01),
  dropping_threshold: z.number().finite().min(0).max(100).multipleOf(0.01),
  revision_gaps: z.array(z.number().finite().int().positive().max(POSTGRES_INTEGER_MAX)).min(1).max(12),
  daily_study_goal_minutes: z.number().finite().int().min(0).max(1440),
  sound_enabled: z.boolean(),
  // --- JEE preparation extensions (all defaulted for backward compatibility) ---
  weight_high: z.number().finite().min(0.1).max(10).multipleOf(0.01).default(2),
  weight_medium: z.number().finite().min(0.1).max(10).multipleOf(0.01).default(1),
  weight_low: z.number().finite().min(0.1).max(10).multipleOf(0.01).default(0.5),
  pyq_from_year: z.number().finite().int().min(1990).max(2100).default(2019),
  pyq_to_year: z.number().finite().int().min(1990).max(2100).default(2026),
  active_track: z.enum(TRACK_IDS).default('main1'),
  exam_mode: z.enum(EXAM_MODES).default('auto'),
  reminders_enabled: z.boolean().default(false),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a reminder time like 08:00.').default('08:00'),
  reminder_types: z.array(z.enum(REMINDER_KINDS)).max(REMINDER_KINDS.length).default(['revision', 'backlog'])
}).refine(value => value.weak_threshold < value.strong_threshold, {
  path: ['strong_threshold'],
  message: 'Strong above must be greater than Weak below.'
}).refine(value => value.pyq_from_year <= value.pyq_to_year, {
  path: ['pyq_to_year'],
  message: 'The PYQ year range must start before it ends.'
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
      case 'interface_font': fieldErrors[field] = 'Choose Default, Poppins, Sora, or Open Sans.'; break
      case 'daily_study_goal_minutes': fieldErrors[field] = 'Enter a daily goal from 0 to 24 hours.'; break
      case 'owner_name': fieldErrors[field] = 'Name must be 100 characters or fewer.'; break
      case 'main_exam_date': fieldErrors[field] = 'Choose a valid calendar date or leave it blank.'; break
      case 'advanced_exam_date': fieldErrors[field] = 'Choose a valid calendar date or leave it blank.'; break
      case 'weight_high': case 'weight_medium': case 'weight_low': fieldErrors[field] = 'Use a weight from 0.1 to 10 (up to two decimal places).'; break
      case 'pyq_from_year': case 'pyq_to_year': fieldErrors[field] = issue.code === 'custom' ? issue.message : 'Use a year between 1990 and 2100.'; break
      case 'reminder_time': fieldErrors[field] = 'Choose a reminder time like 08:00.'; break
      case 'reminder_types': fieldErrors[field] = 'Pick at least one reminder type or turn reminders off.'; break
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

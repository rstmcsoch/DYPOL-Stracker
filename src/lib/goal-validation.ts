import { z } from 'zod'

export const MAX_COUNT_GOAL = 999_999
export const MAX_WEEKLY_STUDY_HOURS = 168

export const goalSchema = z.object({
  goal_type: z.enum(['study_hours', 'tests', 'chapters', 'revisions', 'custom']),
  title: z.string().trim().min(1, 'Give the goal a name.').max(120),
  target: z.number().positive().max(999_999.99),
  progress_value: z.number().nonnegative().max(999_999.99),
  week_start: z.iso.date(),
  unit: z.string().max(30)
}).superRefine((value, context) => {
  if (value.goal_type === 'study_hours') {
    if (value.target > MAX_WEEKLY_STUDY_HOURS) context.addIssue({ code: 'custom', path: ['target'], message: 'A weekly study-hours target cannot exceed 168 hours.' })
    if (value.target * 2 !== Math.trunc(value.target * 2)) context.addIssue({ code: 'custom', path: ['target'], message: 'Study-hours targets use half-hour increments.' })
  } else if (!Number.isInteger(value.target) || value.target > MAX_COUNT_GOAL) {
    context.addIssue({ code: 'custom', path: ['target'], message: 'Test, chapter, revision, and custom targets must be whole-number counts.' })
  }

  if (value.goal_type !== 'study_hours' && !Number.isInteger(value.progress_value)) {
    context.addIssue({ code: 'custom', path: ['progress_value'], message: 'Count-goal progress must be a whole number.' })
  }
})

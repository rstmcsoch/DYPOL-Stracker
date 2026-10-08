import { z } from 'zod'

export const POSTGRES_INTEGER_MAX = 2_147_483_647
export const MAX_TOTAL_MARKS = 9_999_999
export const MAX_MARKS_OBTAINED = 9_999_999.5
export const MAX_NEGATIVE_MARKS = 999_999.75

export const marksObtainedSchema = z.number().min(0).max(MAX_MARKS_OBTAINED).multipleOf(0.5).nullable()
export const totalMarksSchema = z.number().int().min(1).max(MAX_TOTAL_MARKS).nullable()
export const countSchema = z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable()
export const negativeMarksSchema = z.number().min(0).max(MAX_NEGATIVE_MARKS).multipleOf(0.25).nullable()
export const timeMinutesSchema = z.number().int().min(0).max(POSTGRES_INTEGER_MAX).nullable()

export const testFormSchema = z.object({
  title: z.string().trim().min(1, 'Test title is required.').max(160),
  test_date: z.iso.date('Choose a valid date.'),
  test_type: z.enum(['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']),
  marks_obtained: marksObtainedSchema,
  total_marks: totalMarksSchema,
  correct: countSchema,
  wrong: countSchema,
  skipped: countSchema,
  negative_marks: negativeMarksSchema,
  time_minutes: timeMinutesSchema,
  notes: z.string().max(10_000)
}).superRefine((value, context) => {
  if (value.marks_obtained != null && value.total_marks == null) {
    context.addIssue({ code: 'custom', path: ['total_marks'], message: 'Add a positive integer total to record a score.' })
  }
  if (value.marks_obtained != null && value.total_marks != null && value.marks_obtained > value.total_marks * 2) {
    context.addIssue({ code: 'custom', path: ['marks_obtained'], message: 'Marks obtained cannot exceed twice the total.' })
  }
})

export const subjectScoreInputSchema = z.object({
  marks_obtained: marksObtainedSchema,
  total_marks: totalMarksSchema
}).superRefine((value, context) => {
  if (value.marks_obtained != null && value.total_marks == null) {
    context.addIssue({ code: 'custom', path: ['total_marks'], message: 'Add a positive integer subject total for this score.' })
  }
  if (value.marks_obtained != null && value.total_marks != null && value.marks_obtained > value.total_marks * 2) {
    context.addIssue({ code: 'custom', path: ['marks_obtained'], message: 'Subject marks cannot exceed twice the subject total.' })
  }
})

export function nullableNumberInput(value: string): number | null {
  if (value.trim() === '') return null
  return Number(value)
}

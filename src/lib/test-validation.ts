import { z } from 'zod'

export const POSTGRES_INTEGER_MAX = 2_147_483_647
export const MAX_TOTAL_MARKS = 9_999_999
export const MAX_MARKS_OBTAINED = 9_999_999.5
export const MAX_NEGATIVE_MARKS = 999_999.75

// Marks can be awarded in half-point increments; totals are whole marks. A score is
// bounded by its own total below (never by an arbitrary universal percentage cap).
export const marksObtainedSchema = z.number().finite().min(0).max(MAX_MARKS_OBTAINED).multipleOf(0.5).nullable()
export const totalMarksSchema = z.number().finite().int().min(1).max(MAX_TOTAL_MARKS).nullable()
export const countSchema = z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable()
export const negativeMarksSchema = z.number().finite().min(0).max(MAX_NEGATIVE_MARKS).multipleOf(0.25).nullable()
export const timeMinutesSchema = z.number().finite().int().min(0).max(POSTGRES_INTEGER_MAX).nullable()

export const testFormSchema = z.object({
  title: z.string().trim().min(1, 'Test title is required.').max(160, 'Test titles can be at most 160 characters.'),
  test_date: z.iso.date('Choose a valid date.'),
  test_type: z.enum(['Chapter Test', 'Subject Test', 'Full Mock', 'PYQ Practice']),
  marks_obtained: marksObtainedSchema,
  total_marks: totalMarksSchema,
  correct: countSchema,
  wrong: countSchema,
  skipped: countSchema,
  negative_marks: negativeMarksSchema,
  time_minutes: timeMinutesSchema,
  notes: z.string().max(10_000, 'Notes can be at most 10,000 characters.')
}).superRefine((value, context) => {
  if (value.marks_obtained != null && value.total_marks == null) {
    context.addIssue({ code: 'custom', path: ['total_marks'], message: 'Add a positive whole-number total to record a score.' })
  }
  if (value.marks_obtained != null && value.total_marks != null && value.marks_obtained > value.total_marks) {
    context.addIssue({ code: 'custom', path: ['marks_obtained'], message: 'Marks obtained cannot exceed total marks.' })
  }
})

function scoreInputSchema(scope: 'subject' | 'chapter') {
  const label = scope === 'subject' ? 'subject' : 'chapter'
  return z.object({
    marks_obtained: marksObtainedSchema,
    total_marks: totalMarksSchema
  }).superRefine((value, context) => {
    if (value.marks_obtained != null && value.total_marks == null) {
      context.addIssue({ code: 'custom', path: ['total_marks'], message: `Add a positive whole-number ${label} total for this score.` })
    }
    if (value.marks_obtained != null && value.total_marks != null && value.marks_obtained > value.total_marks) {
      context.addIssue({ code: 'custom', path: ['marks_obtained'], message: scope === 'subject' ? 'Subject marks cannot exceed that subject’s total.' : 'Chapter-linked marks cannot exceed that chapter’s total.' })
    }
  })
}

export const subjectScoreInputSchema = scoreInputSchema('subject')
export const chapterScoreInputSchema = scoreInputSchema('chapter')

/** Empty input is an unknown value; malformed and non-finite values stay invalid. */
export function nullableNumberInput(value: string): number | null {
  if (value.trim() === '') return null
  return Number(value)
}

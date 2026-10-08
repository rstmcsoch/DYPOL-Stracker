import { describe, expect, it } from 'vitest'
import { MAX_TOTAL_MARKS, nullableNumberInput, subjectScoreInputSchema, testFormSchema } from './test-validation'

const validTest = {
  title: 'Mock exam', test_date: '2026-10-08', test_type: 'Chapter Test', marks_obtained: null,
  total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: ''
} as const

describe('test numeric validation', () => {
  it.each([[50, 49], [50, 50], [100, 100], [120, 120], [300, 300]])('accepts %i / %i', (total, marks) => {
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: marks, total_marks: total }).success).toBe(true)
  })

  it.each([[50, 51], [100, 101], [120, 121], [300, 301]])('rejects %i / %i before persistence', (total, marks) => {
    const result = testFormSchema.safeParse({ ...validTest, marks_obtained: marks, total_marks: total })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === 'marks_obtained')).toBe(true)
  })

  it('accepts zero scores and unknown scores, including an unknown score with a known total', () => {
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 0, total_marks: 50 }).success).toBe(true)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: null, total_marks: 50 }).success).toBe(true)
    expect(testFormSchema.safeParse(validTest).success).toBe(true)
  })

  it('rejects fractional totals, zero totals for scores, and totals over the database range', () => {
    expect(testFormSchema.safeParse({ ...validTest, total_marks: 50.5 }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 1, total_marks: 0 }).success).toBe(false)
    expect(subjectScoreInputSchema.safeParse({ marks_obtained: 1, total_marks: MAX_TOTAL_MARKS + 1 }).success).toBe(false)
  })

  it('accepts half-point marks and quarter-point negative marks while rejecting other fractions', () => {
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 24.5, total_marks: 50, negative_marks: 0.25 }).success).toBe(true)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 24.25, total_marks: 50 }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 24, total_marks: 50, negative_marks: 0.1 }).success).toBe(false)
  })

  it('validates each Full Mock subject against its own total', () => {
    const physics = subjectScoreInputSchema.safeParse({ marks_obtained: 110, total_marks: 100 })
    const chemistry = subjectScoreInputSchema.safeParse({ marks_obtained: 95, total_marks: 100 })
    const maths = subjectScoreInputSchema.safeParse({ marks_obtained: 200, total_marks: 200 })
    expect(physics.success).toBe(false)
    expect(chemistry.success).toBe(true)
    expect(maths.success).toBe(true)
    expect(subjectScoreInputSchema.safeParse({ marks_obtained: 201, total_marks: 200 }).success).toBe(false)
  })

  it('rejects negative, non-finite, and malformed numeric values', () => {
    for (const marks of [-0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(testFormSchema.safeParse({ ...validTest, marks_obtained: marks, total_marks: 50 }).success).toBe(false)
    }
    expect(nullableNumberInput('')).toBeNull()
    expect(nullableNumberInput('  ')).toBeNull()
    expect(Number.isNaN(nullableNumberInput('not a number'))).toBe(true)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: nullableNumberInput('not a number') }).success).toBe(false)
  })

  it('keeps future-dated tests valid; entering a date is not proof that a test is completed', () => {
    expect(testFormSchema.safeParse({ ...validTest, test_date: '2030-01-01' }).success).toBe(true)
    expect(testFormSchema.safeParse({ ...validTest, test_date: '2026-02-30' }).success).toBe(false)
  })

  it('requires integer counts and nonnegative integer durations', () => {
    expect(testFormSchema.safeParse({ ...validTest, correct: 1.5 }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, correct: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, time_minutes: -1 }).success).toBe(false)
  })
})

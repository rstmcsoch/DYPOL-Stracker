import { describe, expect, it } from 'vitest'
import { MAX_TOTAL_MARKS, nullableNumberInput, subjectScoreInputSchema, testFormSchema } from './test-validation'

const validTest = {
  title: 'Mock exam', test_date: '2026-10-08', test_type: 'Chapter Test', marks_obtained: null,
  total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: ''
} as const

describe('test numeric validation', () => {
  it.each([50, 100, 120, 180, 200, 300])('accepts integer total marks of %i', total => {
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 25, total_marks: total }).success).toBe(true)
    expect(subjectScoreInputSchema.safeParse({ marks_obtained: 25, total_marks: total }).success).toBe(true)
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

  it('rejects scores above the established two-times-total database limit', () => {
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: 101, total_marks: 50 }).success).toBe(false)
    expect(subjectScoreInputSchema.safeParse({ marks_obtained: 100, total_marks: 50 }).success).toBe(true)
    expect(subjectScoreInputSchema.safeParse({ marks_obtained: 100.5, total_marks: 50 }).success).toBe(false)
  })

  it('requires calendar-valid dates and bounds integer counts and durations', () => {
    expect(testFormSchema.safeParse({ ...validTest, test_date: '2026-02-30' }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, correct: 1.5 }).success).toBe(false)
    expect(testFormSchema.safeParse({ ...validTest, time_minutes: -1 }).success).toBe(false)
  })

  it('does not turn malformed numeric text into an empty value', () => {
    expect(nullableNumberInput('')).toBeNull()
    expect(Number.isNaN(nullableNumberInput('not a number'))).toBe(true)
    expect(testFormSchema.safeParse({ ...validTest, marks_obtained: nullableNumberInput('not a number') }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { goalSchema } from './goal-validation'

const goal = {
  goal_type: 'study_hours', title: 'Study hours', target: 10, progress_value: 0,
  week_start: '2026-10-05', unit: 'hours'
} as const

describe('weekly goal validation', () => {
  it('allows half-hour study targets within one week', () => {
    expect(goalSchema.safeParse({ ...goal, target: 10.5 }).success).toBe(true)
    expect(goalSchema.safeParse({ ...goal, target: 168 }).success).toBe(true)
    expect(goalSchema.safeParse({ ...goal, target: 168.5 }).success).toBe(false)
    expect(goalSchema.safeParse({ ...goal, target: 0.25 }).success).toBe(false)
  })

  it.each(['tests', 'chapters', 'revisions', 'custom'] as const)('requires whole-count targets for %s', goal_type => {
    expect(goalSchema.safeParse({ ...goal, goal_type, target: 2 }).success).toBe(true)
    expect(goalSchema.safeParse({ ...goal, goal_type, target: 2.5 }).success).toBe(false)
  })

  it('requires whole custom progress and a real calendar week start', () => {
    expect(goalSchema.safeParse({ ...goal, goal_type: 'custom', target: 3, progress_value: 1.5 }).success).toBe(false)
    expect(goalSchema.safeParse({ ...goal, week_start: '2026-02-30' }).success).toBe(false)
  })
})

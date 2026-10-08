import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { settingsSchema } from './settings-validation'

const validSettings = defaultSettings('a3f147d2-b7cf-53bd-a461-0d3cfed00001')

describe('settings validation', () => {
  it('accepts a complete settings record with optional exam dates left blank', () => {
    expect(settingsSchema.safeParse(validSettings).success).toBe(true)
  })

  it('rejects invalid calendar dates, unordered thresholds, and out-of-range daily goals', () => {
    expect(settingsSchema.safeParse({ ...validSettings, main_exam_date: '2026-02-30' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, weak_threshold: 80, strong_threshold: 80 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, daily_study_goal_minutes: 1441 }).success).toBe(false)
  })

  it('matches the persisted decimal precision for scores and thresholds', () => {
    expect(settingsSchema.safeParse({ ...validSettings, target_score: 999999.99 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, target_score: 1000000 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, weak_threshold: 60.001 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, revision_gaps: [1, 366] }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, revision_gaps: [1, 2_147_483_648] }).success).toBe(false)
  })
})

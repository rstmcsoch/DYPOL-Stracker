import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { settingsFieldErrors, settingsSchema } from './settings-validation'

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

  it('matches persisted precision and finite numeric ranges', () => {
    expect(settingsSchema.safeParse({ ...validSettings, target_score: 999999.99 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, target_score: 1000000 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, target_score: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, target_score: Number.NaN }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, weak_threshold: 60.001 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettings, revision_gaps: [1, 366] }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, revision_gaps: [1, 2_147_483_648] }).success).toBe(false)
  })

  it('collects multiple Settings issues by field instead of forcing one-at-a-time guesses', () => {
    const parsed = settingsSchema.safeParse({
      ...validSettings, strong_threshold: 999, revision_gaps: [-1, Number.NaN, 0]
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const errors = settingsFieldErrors(parsed.error)
      expect(errors.strong_threshold).toContain('0.01 and 100')
      expect(errors.revision_gaps).toContain('positive whole days')
      expect(Object.keys(errors)).toEqual(expect.arrayContaining(['strong_threshold', 'revision_gaps']))
    }
  })

  it('keeps thresholds and fractional score metrics finite and within their intended decimal precision', () => {
    expect(settingsSchema.safeParse({ ...validSettings, weak_threshold: 0 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, weak_threshold: 0, strong_threshold: 0.01 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, strong_threshold: 100 }).success).toBe(true)
    expect(settingsSchema.safeParse({ ...validSettings, dropping_threshold: Number.POSITIVE_INFINITY }).success).toBe(false)
  })
})

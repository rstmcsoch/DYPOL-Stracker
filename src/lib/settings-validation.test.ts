import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { settingsSchema } from './settings-validation'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'

function validSettingsInput() {
  const settings = defaultSettings(userId)
  return {
    owner_name: settings.owner_name,
    target_score: settings.target_score,
    weak_threshold: settings.weak_threshold,
    strong_threshold: settings.strong_threshold,
    dropping_threshold: settings.dropping_threshold,
    revision_gaps: settings.revision_gaps,
    daily_study_goal_minutes: settings.daily_study_goal_minutes
  }
}

describe('settings validation', () => {
  it('accepts the valid stored defaults without requiring edits to unrelated fields', () => {
    expect(settingsSchema.safeParse(validSettingsInput()).success).toBe(true)
  })

  it('accepts decimal thresholds permitted by the schema', () => {
    const result = settingsSchema.safeParse({
      ...validSettingsInput(), weak_threshold: 60.25, strong_threshold: 80.5, dropping_threshold: 10.75
    })
    expect(result.success).toBe(true)
  })

  it('continues to reject invalid threshold ranges and threshold ordering', () => {
    expect(settingsSchema.safeParse({ ...validSettingsInput(), strong_threshold: 0 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettingsInput(), weak_threshold: 100 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettingsInput(), weak_threshold: 80, strong_threshold: 80 }).success).toBe(false)
  })

  it('continues to reject invalid revision gaps and daily goals', () => {
    expect(settingsSchema.safeParse({ ...validSettingsInput(), revision_gaps: [1, 0, 7] }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettingsInput(), revision_gaps: [1, 366] }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettingsInput(), daily_study_goal_minutes: 1441 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...validSettingsInput(), daily_study_goal_minutes: 30.5 }).success).toBe(false)
  })

  it('returns the trimmed owner name from parsed data', () => {
    const result = settingsSchema.safeParse({ ...validSettingsInput(), owner_name: '  Sam  ' })
    expect(result.success && result.data.owner_name).toBe('Sam')
  })
})

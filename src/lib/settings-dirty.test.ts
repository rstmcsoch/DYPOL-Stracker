import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { rhythmTextsDirty, sameSettingValue } from './settings-dirty'

describe('settings dirty comparison', () => {
  it('treats subject target objects with different key order as the same saved value', () => {
    expect(sameSettingValue({ Chemistry: 20, Physics: 30 }, { Physics: 30, Chemistry: 20 })).toBe(true)
    expect(sameSettingValue({}, {})).toBe(true)
    expect(sameSettingValue({}, undefined)).toBe(false)
    expect(sameSettingValue({ Physics: 30 }, { Physics: 45 })).toBe(false)
  })

  it('treats reminder-type lists as a set, so a reorder after load is not unsaved', () => {
    expect(sameSettingValue(['backlog', 'revision'], ['revision', 'backlog'])).toBe(true)
    expect(sameSettingValue(['revision'], ['revision', 'backlog'])).toBe(false)
  })

  it('does not flag the default rhythm texts as dirty after load', () => {
    const settings = defaultSettings('00000000-0000-4000-8000-000000000001')
    const gapsText = settings.revision_gaps.join(', ')
    const dailyGoalText = String(settings.daily_study_goal_minutes / 60)
    expect(rhythmTextsDirty(gapsText, dailyGoalText, settings)).toBe(false)
  })
})

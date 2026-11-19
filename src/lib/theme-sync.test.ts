import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { isThemeOnlySettingsChange, preserveLocalTheme } from './theme-sync'

const USER_ID = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'

describe('theme-only local sync guard', () => {
  it('detects Light/Night/Auto theme-only edits (ignoring updated_at)', () => {
    const base = defaultSettings(USER_ID)
    expect(isThemeOnlySettingsChange(base, { ...base, theme: 'dark' })).toBe(true)
    expect(isThemeOnlySettingsChange(base, { ...base, theme: 'auto', updated_at: '2026-11-19T12:00:00.000Z' })).toBe(true)
    expect(isThemeOnlySettingsChange(base, { ...base, updated_at: '2026-11-19T12:00:00.000Z' })).toBe(true)
  })

  it('returns false whenever any other setting changes, with or without theme', () => {
    const base = defaultSettings(USER_ID)
    expect(isThemeOnlySettingsChange(base, { ...base, interface_font: 'sora' })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, theme: 'dark', interface_font: 'sora' })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, color_theme: 'ocean-deep' })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, theme: 'dark', color_theme: 'ocean-deep' })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, target_score: 280 })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, revision_gaps: [1, 3, 7, 30] })).toBe(false)
    expect(isThemeOnlySettingsChange(base, { ...base, owner_name: 'Rustam' })).toBe(false)
  })

  it('preserves the device-local theme across cloud refreshes while keeping cloud values when none is stored locally', () => {
    const cloud = { ...defaultSettings(USER_ID), theme: 'light' as const, target_score: 290 }
    expect(preserveLocalTheme(cloud, 'dark')).toEqual({ ...cloud, theme: 'dark' })
    expect(preserveLocalTheme(cloud, 'auto')).toEqual({ ...cloud, theme: 'auto' })
    expect(preserveLocalTheme(cloud, 'light')).toBe(cloud)
    expect(preserveLocalTheme(cloud, undefined)).toBe(cloud)
  })
})

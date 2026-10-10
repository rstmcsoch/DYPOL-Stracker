import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROL_THEME, normalizeControlTheme, resolveControlTheme } from './control-theme'

describe('control center theme preference', () => {
  it('defaults to the existing dark look for missing or unknown values', () => {
    expect(DEFAULT_CONTROL_THEME).toBe('dark')
    expect(normalizeControlTheme(null)).toBe('dark')
    expect(normalizeControlTheme('sepia')).toBe('dark')
    expect(normalizeControlTheme('light')).toBe('light')
    expect(normalizeControlTheme('system')).toBe('system')
  })

  it('resolves system to the device setting and leaves explicit choices alone', () => {
    expect(resolveControlTheme('system', true)).toBe('dark')
    expect(resolveControlTheme('system', false)).toBe('light')
    expect(resolveControlTheme('light', true)).toBe('light')
    expect(resolveControlTheme('dark', false)).toBe('dark')
  })
})

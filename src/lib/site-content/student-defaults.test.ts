import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../defaults'
import { resolveSiteValues, validateFieldValue } from './content'
import { fieldDefinition } from './registry'
import { applyOwnerThemeDefaults } from './student-defaults'

describe('owner theme defaults for new students', () => {
  it('keeps the built-in defaults when nothing is published', () => {
    const base = defaultSettings('u1', 'Asha')
    const applied = applyOwnerThemeDefaults(base, resolveSiteValues({}))
    expect(applied.theme).toBe(base.theme)
    expect(applied.color_theme).toBe(base.color_theme)
  })

  it('applies the published mode and colour theme', () => {
    const applied = applyOwnerThemeDefaults(defaultSettings('u1', 'Asha'), resolveSiteValues({ 'user.appearance.default_mode': 'dark', 'user.appearance.default_color': 'ocean-deep' }))
    expect(applied.theme).toBe('dark')
    expect(applied.color_theme).toBe('ocean-deep')
  })

  it('rejects unknown values at validation and render time', () => {
    expect(validateFieldValue(fieldDefinition('user.appearance.default_color')!, 'neon-pink').ok).toBe(false)
    const applied = applyOwnerThemeDefaults(defaultSettings('u1', 'Asha'), resolveSiteValues({ 'user.appearance.default_mode': 'purple' }))
    expect(applied.theme).toBe(defaultSettings('u1', 'Asha').theme)
  })
})

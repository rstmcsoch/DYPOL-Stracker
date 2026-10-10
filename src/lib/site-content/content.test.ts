import { describe, expect, it } from 'vitest'
import { SITE_CONTENT_FIELDS, SITE_CONTENT_DEFAULTS, fieldDefinition, type FieldDefinition } from './registry'
import { overridesFromValues, resolveSiteValues, sanitizeStoredOverrides, validateFieldValue, validateOverrides } from './content'

const text = (key: string): FieldDefinition => {
  const definition = fieldDefinition(key)
  if (!definition) throw new Error(`missing ${key}`)
  return definition
}

const firstLink = SITE_CONTENT_FIELDS.find(field => field.type === 'link')
const firstText = SITE_CONTENT_FIELDS.find(field => field.type === 'text')

describe('site content validation', () => {
  it('accepts plain text and rejects markup and hidden control characters', () => {
    const definition = firstText!
    expect(validateFieldValue(definition, 'Plain words').ok).toBe(true)
    expect(validateFieldValue(definition, 'Hi <b>there</b>').ok).toBe(false)
    expect(validateFieldValue(definition, 'bad\u0007bell').ok).toBe(false)
  })

  it('rejects empty and over-length values', () => {
    const definition = firstText!
    expect(validateFieldValue(definition, '   ').ok).toBe(false)
    expect(validateFieldValue(definition, 'x'.repeat(definition.maxLength + 1)).ok).toBe(false)
  })

  it('allows only internal pages, homepage anchors, or https links', () => {
    const definition = firstLink ?? text('public.hero.primary_cta_target')
    expect(validateFieldValue(definition, '/login').ok).toBe(true)
    expect(validateFieldValue(definition, '#features').ok).toBe(true)
    expect(validateFieldValue(definition, 'https://example.com/help').ok).toBe(true)
    expect(validateFieldValue(definition, 'javascript:alert(1)').ok).toBe(false)
    expect(validateFieldValue(definition, 'http://example.com').ok).toBe(false)
    expect(validateFieldValue(definition, 'https://user:pass@example.com').ok).toBe(false)
    expect(validateFieldValue(definition, '/control-panel').ok).toBe(false)
    expect(validateFieldValue(definition, '#not-a-section').ok).toBe(false)
  })

  it('rejects keys that are not editable fields (no mass assignment)', () => {
    const result = validateOverrides({ 'auth.password.rule': 'anything' })
    expect(result.ok).toBe(false)
  })

  it('drops values equal to the default so stored rows stay sparse', () => {
    const key = firstText!.key
    const result = validateOverrides({ [key]: SITE_CONTENT_DEFAULTS[key] })
    expect(result).toEqual({ ok: true, overrides: {} })
  })

  it('reads stored overrides leniently: bad values fall back to the default', () => {
    const key = firstText!.key
    expect(sanitizeStoredOverrides({ [key]: '<script>', unknown: 'x' })).toEqual({})
    const values = resolveSiteValues({ [key]: 'Changed copy' })
    expect(values[key]).toBe('Changed copy')
    expect(resolveSiteValues(undefined)).toEqual(SITE_CONTENT_DEFAULTS)
  })

  it('round-trips display values back to sparse overrides', () => {
    const key = firstText!.key
    const values = { ...SITE_CONTENT_DEFAULTS, [key]: 'Edited' }
    expect(overridesFromValues(values)).toEqual({ [key]: 'Edited' })
  })
})

import {
  INTERNAL_ROUTE_TARGETS,
  SITE_CONTENT_DEFAULTS,
  SITE_CONTENT_FIELDS,
  fieldDefinition,
  type FieldDefinition
} from './registry.js'

export type SiteOverrides = Record<string, string>
export type SiteValues = Record<string, string>
export type FieldValidation = { ok: true; value: string } | { ok: false; message: string }

export type OverrideValidation =
  | { ok: true; overrides: SiteOverrides }
  | { ok: false; errors: Record<string, string> }

const MARKUP = /[<>]/
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

function hasControlCharacter(value: string): boolean {
  return CONTROL.test(value)
}

function validateMediaUrl(value: string): string | null {
  if (value === '') return null
  if (value.startsWith('/videos/')) {
    const name = value.slice('/videos/'.length)
    return name.length > 0 && !name.includes('/') && !/["'\\]/.test(name) ? null : 'Use a file directly inside /videos/.'
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Upload a file on the Homepage video tab, or leave the field empty for the built-in media.'
  }
  if (url.protocol !== 'https:') return 'Media addresses must start with https://.'
  if (url.username || url.password) return 'Media addresses may not contain a username or password.'
  if (url.search || url.hash) return 'Media addresses may not contain query strings or fragments.'
  if (!url.pathname.includes('/storage/v1/object/public/homepage-media/')) {
    return 'Only files from the homepage media library are allowed here.'
  }
  return null
}

function validateNumber(definition: FieldDefinition, value: string): string | null {
  if (!/^\d{1,4}$/.test(value)) return 'Enter a whole number.'
  const parsed = Number(value)
  const min = definition.min ?? 0
  const max = definition.max ?? 9999
  if (parsed < min || parsed > max) return `Use a value between ${min} and ${max}.`
  return null
}

function validateLink(value: string): string | null {
  if (value.startsWith('/')) {
    return (INTERNAL_ROUTE_TARGETS as readonly string[]).includes(value) ? null : 'Choose one of the public pages listed in the menu.'
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return 'External links must use https://.'
    if (url.username || url.password) return 'Links may not contain a username or password.'
    return null
  } catch {
    return 'Enter a public page path or a full https:// address.'
  }
}

export function validateFieldValue(definition: FieldDefinition, raw: unknown): FieldValidation {
  if (typeof raw !== 'string') return { ok: false, message: 'Expected a string.' }
  let value = raw.replace(/\r\n?/g, '\n').trim()
  const multiline = definition.type === 'multiline'
  if (!multiline) value = value.replace(/\s*\n\s*/g, ' ')
  if (definition.type === 'mediaurl') {
    if (value.length === 0) return { ok: true, value: '' }
  } else if (value.length === 0) {
    return { ok: false, message: 'This field cannot be empty.' }
  }
  if (value.length > definition.maxLength) return { ok: false, message: `Use ${definition.maxLength} characters or fewer (currently ${value.length}).` }
  if (hasControlCharacter(value)) return { ok: false, message: 'Remove hidden control characters.' }
  if (MARKUP.test(value)) return { ok: false, message: 'Angle brackets (< >) are not allowed. Write plain text.' }
  if (definition.type === 'link') {
    const problem = validateLink(value)
    if (problem) return { ok: false, message: problem }
  }
  if (definition.type === 'toggle' && value !== 'true' && value !== 'false') {
    return { ok: false, message: 'Switch this setting on or off.' }
  }
  if (definition.type === 'number') {
    const problem = validateNumber(definition, value)
    if (problem) return { ok: false, message: problem }
    value = String(Number(value))
  }
  if (definition.type === 'select' && !(definition.options ?? []).includes(value)) {
    return { ok: false, message: `Choose one of: ${(definition.options ?? []).join(', ')}.` }
  }
  if (definition.type === 'mediaurl') {
    const problem = validateMediaUrl(value)
    if (problem) return { ok: false, message: problem }
  }
  return { ok: true, value }
}

export function validateOverrides(raw: unknown): OverrideValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: { _root: 'Send the content as a set of field values.' } }
  }
  const errors: Record<string, string> = {}
  const overrides: SiteOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const definition = fieldDefinition(key)
    if (!definition) {
      errors[key] = 'This is not an editable field.'
      continue
    }
    const result = validateFieldValue(definition, value)
    if (result.ok === false) {
      errors[key] = result.message
      continue
    }
    if (result.value !== definition.defaultValue) overrides[key] = result.value
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, overrides }
}

export function sanitizeStoredOverrides(raw: unknown): SiteOverrides {
  const result: SiteOverrides = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const definition = fieldDefinition(key)
    if (!definition) continue
    const checked = validateFieldValue(definition, value)
    if (checked.ok && checked.value !== definition.defaultValue) result[key] = checked.value
  }
  return result
}

export function resolveSiteValues(overrides?: unknown): SiteValues {
  const values: SiteValues = { ...SITE_CONTENT_DEFAULTS }
  const applied = sanitizeStoredOverrides(overrides)
  for (const [key, value] of Object.entries(applied)) values[key] = value
  return values
}

export function overridesFromValues(values: SiteValues): SiteOverrides {
  const overrides: SiteOverrides = {}
  for (const definition of SITE_CONTENT_FIELDS) {
    const value = values[definition.key]
    if (value != null && value !== definition.defaultValue) overrides[definition.key] = value
  }
  return overrides
}

export interface ContentChange {
  key: string
  label: string
  page: string
  section: string
  before: string
  after: string
}

export function diffSiteValues(before: SiteValues, after: SiteValues): ContentChange[] {
  const changes: ContentChange[] = []
  for (const definition of SITE_CONTENT_FIELDS) {
    const from = before[definition.key] ?? definition.defaultValue
    const to = after[definition.key] ?? definition.defaultValue
    if (from !== to) {
      changes.push({ key: definition.key, label: definition.label, page: definition.page, section: definition.section, before: from, after: to })
    }
  }
  return changes
}

export function definitionsFor(keys: readonly string[]): FieldDefinition[] {
  return keys.map(key => fieldDefinition(key)).filter((definition): definition is FieldDefinition => Boolean(definition))
}

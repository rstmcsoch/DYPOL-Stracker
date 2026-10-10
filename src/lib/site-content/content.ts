import {
  HOMEPAGE_ANCHOR_TARGETS,
  INTERNAL_ROUTE_TARGETS,
  SITE_CONTENT_DEFAULTS,
  SITE_CONTENT_FIELDS,
  fieldDefinition,
  type FieldDefinition
} from './registry.js'

/**
 * Validation, resolution and diffing for owner-editable copy.
 *
 * Two entry points with different strictness:
 *   - `validateOverrides` is STRICT and is used on every owner write (draft save, publish,
 *     restore). Unknown keys, wrong types, control characters, markup and unsafe links are
 *     rejected with a per-field message; nothing is silently dropped.
 *   - `resolveSiteValues` is LENIENT and is used when rendering. Missing, invalid or
 *     unknown stored values fall back to the default for that one key, so a bad row can
 *     never blank the homepage or the navigation.
 *
 * Stored configuration is "sparse": only values that differ from the default are kept.
 */

/** Sparse map of key → value that differs from its default. */
export type SiteOverrides = Record<string, string>

/** Complete map of every editable key → the value to display. */
export type SiteValues = Record<string, string>

export type FieldValidation = { ok: true; value: string } | { ok: false; message: string }

const MARKUP = /[<>]/
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

function hasControlCharacter(value: string): boolean {
  return CONTROL.test(value)
}

/** Media URLs may be empty (use the bundled asset), a same-origin /videos path, or the
    public homepage-media bucket of the project's Supabase storage. Anything else — other
    buckets, signed URLs, query strings, credentials — is refused. */
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
  // Normalise line endings and trim the outer whitespace; inner line breaks survive for multiline.
  let value = raw.replace(/\r\n?/g, '\n').trim()
  const multiline = definition.type === 'multiline'
  if (!multiline) value = value.replace(/\s*\n\s*/g, ' ')
  if (definition.type === 'mediaurl') {
    // Empty is meaningful here: it selects the bundled default media.
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

export function validateOverrides(raw: unknown): { ok: true; value: SiteOverrides } | { ok: false; message: string; field?: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'Expected an object of field values.' }
  }
  const overrides: SiteOverrides = {}
  for (const [key, value] of Object.entries(raw)) {
    const definition = fieldDefinition(key)
    if (!definition) return { ok: false, message: 'Unknown field.', field: key }
    const result = validateFieldValue(definition, value)
    if (!result.ok) return { ok: false, message: result.message, field: key }
    if (result.value !== definition.defaultValue) overrides[key] = result.value
  }
  return { ok: true, value: overrides }
}

/** Lenient read used at render time. Invalid or unknown values fall back to the default. */
export function sanitizeStoredOverrides(raw: unknown): SiteOverrides {
  const overrides: SiteOverrides = {}
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return overrides
  for (const [key, value] of Object.entries(raw)) {
    const definition = fieldDefinition(key)
    if (!definition) continue
    const result = validateFieldValue(definition, value)
    if (result.ok && result.value !== definition.defaultValue) overrides[key] = result.value
  }
  return overrides
}

/** Resolves stored overrides (or nothing) into a complete, safe value map. */
export function resolveSiteValues(stored: SiteOverrides | null | undefined): SiteValues {
  const values: SiteValues = { ...SITE_CONTENT_DEFAULTS }
  const applied = sanitizeStoredOverrides(stored)
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

/** Fields whose display value differs between two complete value sets, in editor order. */
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

/** Maps a list of field keys to their definitions, ignoring unknown keys. */
export function definitionsFor(keys: readonly string[]): FieldDefinition[] {
  return keys.map(key => fieldDefinition(key)).filter((definition): definition is FieldDefinition => Boolean(definition))
}

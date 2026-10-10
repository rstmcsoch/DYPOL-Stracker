import type { FieldDefinition } from './registry'

export type SiteValues = Record<string, string>

export interface FieldValidationResult {
  ok: true
  value: string
} | {
  ok: false
  message: string
}

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

export function validateFieldValue(definition: FieldDefinition, raw: unknown): FieldValidationResult {
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

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITE_CONTENT_DEFAULTS, SITE_CONTENT_FIELDS } from './registry'

/**
 * Guard against accidental loss of editable keys (e.g. a truncated registry.ts push).
 * Published site content stores values by key, so a dropped key silently loses the
 * owner's customisation. New keys may be added; existing keys must never disappear.
 * To intentionally retire a key, remove it from registry-keys.snapshot.json in the same PR.
 */
const SNAPSHOT: string[] = JSON.parse(readFileSync(new URL('./registry-keys.snapshot.json', import.meta.url), 'utf8'))

describe('site-content registry keys', () => {
  it('keeps every previously shipped key', () => {
    const current = new Set(SITE_CONTENT_FIELDS.map(definition => definition.key))
    const missing = SNAPSHOT.filter(key => !current.has(key))
    expect(missing).toEqual([])
  })

  it('has unique keys with a default for each', () => {
    const keys = SITE_CONTENT_FIELDS.map(definition => definition.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(typeof SITE_CONTENT_DEFAULTS[key]).toBe('string')
  })
})

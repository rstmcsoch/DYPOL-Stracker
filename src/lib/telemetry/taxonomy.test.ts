import { describe, expect, it } from 'vitest'
import { cleanRoute, errorFingerprint, featureForRoute, sanitizeProps, scrubMessage } from './taxonomy'

describe('analytics taxonomy', () => {
  it('rejects unknown events and drops unlisted or invalid props', () => {
    expect(sanitizeProps('made_up', {})).toBeNull()
    const result = sanitizeProps('student_record_write_failed', { feature: 'tests', op: 'create', count: 2, reason: 'server', marks: 99, note: 'secret' })
    expect(result?.props).toEqual({ feature: 'tests', op: 'create', count: 2, reason: 'server' })
    expect(result?.dropped.sort()).toEqual(['marks', 'note'])
    expect(sanitizeProps('student_record_write_succeeded', { feature: 'nope', op: 'create', count: 1 })?.missing).toEqual(['feature'])
    expect(sanitizeProps('web_vital', { metric: 'LCP', value: -5, rating: 'good', nav: 'navigate' })?.props.value).toBeUndefined()
  })

  it('never keeps ids in routes', () => {
    expect(cleanRoute('/tests/3f2c9d1e-1111-4222-8333-444455556666?x=1')).toBe('/tests/:id')
    expect(cleanRoute('/control-panel/users/123456')).toBe('/control-panel/users/:id')
    expect(featureForRoute('/mock-analysis')).toBe('mock_analysis')
    expect(featureForRoute('/')).toBe('home')
    expect(featureForRoute('/unknown')).toBe('other')
  })

  it('groups errors by a stable fingerprint and scrubs personal data', () => {
    expect(errorFingerprint('error', 'Failed at line 12')).toBe(errorFingerprint('error', 'Failed at line 99'))
    expect(errorFingerprint('error', 'A')).not.toBe(errorFingerprint('api', 'A'))
    expect(scrubMessage('user a.b@x.com hit https://x.y/z id 3f2c9d1e1234')).toBe('user [email] hit [url] id [id]')
  })
})

import { describe, expect, it } from 'vitest'
import { isSafeAppPath, safeAppPath } from './safe-path'

describe('safe in-app paths', () => {
  it('keeps ordinary notebook routes', () => {
    expect(isSafeAppPath('/syllabus')).toBe(true)
    expect(isSafeAppPath('/tests?add=1')).toBe(true)
    expect(isSafeAppPath('/practice?chapter=3f2a1c0e-1b2d-4e5f-8a9b-0c1d2e3f4a5b&add=1')).toBe(true)
    expect(safeAppPath('/analytics')).toBe('/analytics')
  })

  it('rejects cross-origin and protocol-relative targets', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      '/login/../../../\\\\evil.example',
      '/%2f%2fevil.example',
      '/%5cevil.example',
      '/\u0000/evil.example',
      '/reset-password/\n/https://evil.example'
    ]) {
      expect(isSafeAppPath(value), value).toBe(false)
      expect(safeAppPath(value)).toBe('/')
    }
  })
})

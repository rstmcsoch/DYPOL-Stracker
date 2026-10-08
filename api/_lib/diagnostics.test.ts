import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeUnexpectedError, logAIEvent, newReference } from './diagnostics'

afterEach(() => vi.restoreAllMocks())

describe('structured AI diagnostics', () => {
  it('drops credential-named fields and redacts key-shaped values before logging', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    logAIEvent('info', 'test_event', {
      taskId: 'task-1', provider: 'openai', apiKey: 'sk-live-should-not-appear', authorization: 'Bearer abc.def',
      note: 'bad key sk-proj-ABCDEFGH12345678 here', providerStatus: 429
    })
    const line = String(info.mock.calls[0]?.[0])
    expect(line).toContain('"event":"test_event"')
    expect(line).toContain('"taskId":"task-1"')
    expect(line).toContain('"providerStatus":429')
    expect(line).not.toContain('sk-live-should-not-appear')
    expect(line).not.toContain('abc.def')
    expect(line).not.toContain('sk-proj-ABCDEFGH12345678')
    expect(line).not.toMatch(/apiKey|authorization/i)
  })

  it('describes unexpected errors by class and message without leaking secrets', () => {
    const error = new Error('upstream said sk-proj-ABCDEFGH12345678')
    const described = describeUnexpectedError(error)
    expect(described.errorType).toBe('Error')
    expect(String(described.errorMessage)).not.toContain('sk-proj-ABCDEFGH12345678')
  })

  it('creates unguessable, prefixed references', () => {
    const a = newReference('err')
    expect(a).toMatch(/^err_[0-9a-f]{16}$/)
    expect(newReference('err')).not.toBe(a)
  })
})

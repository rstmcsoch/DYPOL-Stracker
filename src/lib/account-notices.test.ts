import { describe, expect, it } from 'vitest'
import { banLengthText, formatIst, noticeSummary, parseNotice, signInRefusal } from './account-notices'
import { describeOAuthError, parseOAuthCallbackError } from './google-auth'

describe('account notice text', () => {
  it('formats times in IST with the zone label', () => {
    expect(formatIst('2026-11-14T18:45:00Z')).toBe('15 Nov 2026, 12:15 am IST')
    expect(formatIst(null)).toBe('')
  })

  it('describes ban length, sign-in refusal and popups', () => {
    expect(banLengthText({ permanent: true, until: null })).toBe('permanently')
    expect(banLengthText({ permanent: false, until: '2026-11-14T10:00:00Z' })).toBe('until 14 Nov 2026, 3:30 pm IST')
    expect(signInRefusal({ permanent: false, until: '2026-11-14T10:00:00Z', reason: 'Spam' })).toBe('This account is banned until 14 Nov 2026, 3:30 pm IST. Reason: Spam')
    expect(noticeSummary({ kind: 'warning', reason: 'x', until: null, permanent: false })).toMatch(/keep using Stracker/)
    expect(noticeSummary({ kind: 'ban', reason: 'x', until: null, permanent: true })).toMatch(/permanently.*signed out/)
  })

  it('accepts only known notice shapes', () => {
    expect(parseNotice({ kind: 'warning', reason: 'Be kind', id: 'n1' })).toMatchObject({ id: 'n1', kind: 'warning', reason: 'Be kind', permanent: false })
    expect(parseNotice({ kind: 'delete' })).toBeNull()
    expect(parseNotice(null)).toBeNull()
  })
})

describe('Google sign-in refused for a banned account', () => {
  it('is recognised as a suspension, not a cancellation', () => {
    expect(parseOAuthCallbackError('?error=access_denied&error_code=user_banned&error_description=User+is+banned', '')?.kind).toBe('suspended')
    expect(describeOAuthError('access_denied user cancelled').kind).toBe('cancelled')
  })
})

describe('sync replay helpers', () => {
  it('uses the earlier of the edit time and the queue time', async () => {
    const { queuedOperationTime, noticeTokenUserId } = await import('./account-notices')
    expect(queuedOperationTime({ operation: 'upsert', queued_at: '2026-11-14T10:05:00Z', record: { updated_at: '2026-11-14T10:00:00Z' } })).toBe('2026-11-14T10:00:00Z')
    expect(queuedOperationTime({ operation: 'delete', queued_at: '2026-11-14T10:05:00Z', record: { updated_at: '2026-11-14T09:00:00Z' } })).toBe('2026-11-14T10:05:00Z')
    expect(queuedOperationTime({ operation: 'upsert', queued_at: '2026-11-14T10:05:00Z', record: null })).toBe('2026-11-14T10:05:00Z')
    expect(noticeTokenUserId('a0000000-0000-4000-8000-00000000b001.123.abc')).toBe('a0000000-0000-4000-8000-00000000b001')
    expect(noticeTokenUserId('nonsense')).toBeNull()
  })
})

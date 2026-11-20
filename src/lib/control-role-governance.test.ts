import { describe, expect, it } from 'vitest'
import {
  MEMBER_REMOVAL_COUNTDOWN_DAYS,
  OWNER_REMOVAL_COUNTDOWN_DAYS,
  OWNER_RESTORE_REVIEW_DAYS,
  addIstDays,
  formatIstDaysLeft,
  hasAllOwnerApprovals,
  isIstDayReached,
  istDaysRemaining,
  toIstDateString
} from './control-role-governance'

describe('control-role-governance (IST whole-day countdowns & unanimous owner approvals)', () => {
  it('uses exact governance constants (30d owner, 2d restore, 7d member)', () => {
    expect(OWNER_REMOVAL_COUNTDOWN_DAYS).toBe(30)
    expect(OWNER_RESTORE_REVIEW_DAYS).toBe(2)
    expect(MEMBER_REMOVAL_COUNTDOWN_DAYS).toBe(7)
  })

  it('converts UTC timestamps to IST (UTC+05:30) calendar dates accurately across midnight', () => {
    // 2026-11-20 18:29:59 UTC = 2026-11-20 23:59:59 IST
    expect(toIstDateString('2026-11-20T18:29:59Z')).toBe('2026-11-20')
    // 2026-11-20 18:30:00 UTC = 2026-11-21 00:00:00 IST
    expect(toIstDateString('2026-11-20T18:30:00Z')).toBe('2026-11-21')
  })

  it('computes whole IST days remaining for 30-day, 7-day, and 2-day windows without hours or seconds', () => {
    const start = new Date('2026-11-20T10:00:00Z') // 15:30 IST on 2026-11-20
    const ownerTarget = addIstDays(start, OWNER_REMOVAL_COUNTDOWN_DAYS)
    const memberTarget = addIstDays(start, MEMBER_REMOVAL_COUNTDOWN_DAYS)
    const restoreTarget = addIstDays(start, OWNER_RESTORE_REVIEW_DAYS)

    expect(ownerTarget).toBe('2026-12-20')
    expect(memberTarget).toBe('2026-11-27')
    expect(restoreTarget).toBe('2026-11-22')

    expect(istDaysRemaining(ownerTarget, start)).toBe(30)
    expect(istDaysRemaining(memberTarget, start)).toBe(7)
    expect(istDaysRemaining(restoreTarget, start)).toBe(2)

    expect(isIstDayReached(restoreTarget, new Date('2026-11-21T18:29:59Z'))).toBe(false)
    expect(isIstDayReached(restoreTarget, new Date('2026-11-21T18:30:00Z'))).toBe(true)

    expect(formatIstDaysLeft(30)).toBe('30 days left')
    expect(formatIstDaysLeft(1)).toBe('1 day left')
    expect(formatIstDaysLeft(0)).toBe('0 days left')
  })

  it('requires unanimous approval from every active owner (1, 2, or 3+ owners)', () => {
    expect(hasAllOwnerApprovals(['o1'], ['o1'])).toBe(true)
    expect(hasAllOwnerApprovals(['o1'], [])).toBe(false)
    expect(hasAllOwnerApprovals(['o1', 'o2'], ['o1'])).toBe(false)
    expect(hasAllOwnerApprovals(['o1', 'o2'], ['o1', 'o2'])).toBe(true)
    expect(hasAllOwnerApprovals(['o1', 'o2', 'o3'], ['o1', 'o2'])).toBe(false)
    expect(hasAllOwnerApprovals(['o1', 'o2', 'o3'], ['o3', 'o1', 'o2'])).toBe(true)
    expect(hasAllOwnerApprovals([], ['o1'])).toBe(false)
  })
})

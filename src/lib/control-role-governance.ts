/**
 * Pure role-removal governance rules and IST (Asia/Kolkata) calendar-day countdown math
 * shared between the Control Centre API (server-enforced) and the Settings → Roles UI.
 *
 * All countdowns count whole IST calendar days only — never hours, minutes or seconds.
 */

export const OWNER_REMOVAL_COUNTDOWN_DAYS = 30
export const OWNER_RESTORE_REVIEW_DAYS = 2
export const MEMBER_REMOVAL_COUNTDOWN_DAYS = 7
export const GOVERNANCE_TIME_ZONE = 'Asia/Kolkata'

const IST_OFFSET_MS = 330 * 60 * 1000 // UTC+05:30 (India has no DST)
const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export type RoleRemovalStatus =
  | 'pending_approval'
  | 'countdown'
  | 'review_restore'
  | 'completed'
  | 'restored'
  | 'cancelled'

export const OPEN_REMOVAL_STATUSES: readonly RoleRemovalStatus[] = [
  'pending_approval',
  'countdown',
  'review_restore'
]

/** Returns the YYYY-MM-DD calendar date in Indian Standard Time (Asia/Kolkata). */
export function toIstDateString(input: Date | string | number = new Date()): string {
  if (typeof input === 'string' && ISO_DAY.test(input.trim())) return input.trim()
  const ms = input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input)
  const shifted = new Date((Number.isFinite(ms) ? ms : Date.now()) + IST_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Converts an IST YYYY-MM-DD date (or timestamp) to an integer day number for exact day subtraction. */
export function istDayNumber(input: Date | string | number = new Date()): number {
  const day = toIstDateString(input)
  const match = ISO_DAY.exec(day)
  if (!match) return 0
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS)
}

/** Returns the IST YYYY-MM-DD date `days` calendar days after `from`. */
export function addIstDays(from: Date | string | number, days: number): string {
  const baseDay = istDayNumber(from)
  const target = new Date((baseDay + days) * DAY_MS)
  const y = target.getUTCFullYear()
  const m = String(target.getUTCMonth() + 1).padStart(2, '0')
  const d = String(target.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Whole IST calendar days remaining until `targetIstDay` (never negative, never hours/seconds). */
export function istDaysRemaining(targetIstDay: string | null | undefined, now: Date | number = new Date()): number {
  if (!targetIstDay || !ISO_DAY.test(targetIstDay.trim())) return 0
  return Math.max(0, istDayNumber(targetIstDay) - istDayNumber(now))
}

/** True once the current IST calendar date has reached or passed `targetIstDay`. */
export function isIstDayReached(targetIstDay: string | null | undefined, now: Date | number = new Date()): boolean {
  if (!targetIstDay || !ISO_DAY.test(targetIstDay.trim())) return false
  return istDayNumber(now) >= istDayNumber(targetIstDay)
}

/** Formats a whole-day IST countdown label cleanly ("30 days left", "1 day left", "0 days left"). */
export function formatIstDaysLeft(days: number): string {
  if (days <= 0) return '0 days left'
  return days === 1 ? '1 day left' : `${days} days left`
}

/** True when every required active owner UUID is present in `approvedBy`. */
export function hasAllOwnerApprovals(
  activeOwnerIds: readonly string[],
  approvedBy: readonly string[]
): boolean {
  if (activeOwnerIds.length === 0) return false
  const approved = new Set(approvedBy)
  return activeOwnerIds.every(ownerId => approved.has(ownerId))
}

export interface RoleRemovalView {
  id: string
  targetUserId: string
  targetEmail: string
  targetRole: string
  status: RoleRemovalStatus
  initiatedBy: string | null
  initiatedByEmail: string
  initiatedAt: string
  approvedBy: string[]
  requiredApprovers: number
  approvedCount: number
  /** Whether the currently signed-in authority can click Approve on this request. */
  canApprove: boolean
  /** Whether the currently signed-in owner is the target and can submit the 2-day restore review. */
  canRequestRestore: boolean
  countdownStartedAt: string | null
  effectiveOnIst: string | null
  daysRemaining: number | null
  restoreRequestedAt: string | null
  restoreOnIst: string | null
  restoreDaysRemaining: number | null
}

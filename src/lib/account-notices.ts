/**
 * Account notices (warnings, bans, lifted bans) as shown to students. Shared by the dashboard
 * popup and the sign-in page. Times are always shown in India Standard Time, labelled "IST".
 */
export type AccountNoticeKind = 'warning' | 'ban' | 'unban' | 'ban_ended'

export interface AccountNotice {
  id?: string
  kind: AccountNoticeKind
  reason: string | null
  /** End of a temporary ban (ISO). Null for permanent bans and non-ban notices. */
  until: string | null
  permanent: boolean
  createdAt?: string
}

export const NOTICE_TOKEN_KEY = 'stracker.account-notice'

export function formatIst(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const text = date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  return `${text} IST`
}

/** "permanently" or "until 15 Nov 2026, 4:30 pm IST". */
export function banLengthText(notice: Pick<AccountNotice, 'permanent' | 'until'>): string {
  if (notice.permanent || !notice.until) return 'permanently'
  return `until ${formatIst(notice.until)}`
}

export function noticeTitle(kind: AccountNoticeKind): string {
  switch (kind) {
    case 'warning': return 'You have received a warning'
    case 'ban': return 'Your account is banned'
    case 'unban': return 'Your suspension was lifted'
    case 'ban_ended': return 'Your suspension has ended'
  }
}

export function noticeSummary(notice: AccountNotice): string {
  switch (notice.kind) {
    case 'warning': return 'The Stracker team sent your account a warning. You can keep using Stracker as normal.'
    case 'ban': return notice.permanent || !notice.until
      ? 'The Stracker team has banned your account permanently. You will be signed out.'
      : `The Stracker team has banned your account until ${formatIst(notice.until)}. You will be signed out.`
    case 'unban': return 'The Stracker team lifted the suspension on your account. Welcome back.'
    case 'ban_ended': return 'Your temporary suspension is over, and your account works normally again.'
  }
}

/** The sign-in page message for a banned account whose identity has been proven. */
export function signInRefusal(notice: Pick<AccountNotice, 'permanent' | 'until' | 'reason'>): string {
  const length = notice.permanent || !notice.until ? 'This account is banned permanently.' : `This account is banned until ${formatIst(notice.until)}.`
  return notice.reason ? `${length} Reason: ${notice.reason}` : length
}

/** Shown when Auth refuses a banned account but the reason cannot be revealed (identity unproven). */
export const GENERIC_SUSPENDED_MESSAGE = 'This account is banned and cannot sign in right now. Sign in with your email and password to see the reason and how long it lasts, or contact us if you think this is a mistake.'

export function parseNotice(value: unknown): AccountNotice | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const kind = row.kind
  if (kind !== 'warning' && kind !== 'ban' && kind !== 'unban' && kind !== 'ban_ended') return null
  return {
    id: typeof row.id === 'string' ? row.id : undefined,
    kind,
    reason: typeof row.reason === 'string' ? row.reason : null,
    until: typeof row.until === 'string' ? row.until : null,
    permanent: row.permanent === true,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined
  }
}

export function readNoticeToken(): string | null {
  try {
    const value = window.localStorage.getItem(NOTICE_TOKEN_KEY)
    return value && value.length <= 200 ? value : null
  } catch {
    return null
  }
}

export function storeNoticeToken(token: unknown): void {
  if (typeof token !== 'string' || token.length > 200) return
  try { window.localStorage.setItem(NOTICE_TOKEN_KEY, token) } catch { /* storage unavailable */ }
}

/** Fired by the sync layer when the cloud refuses a write for a non-network reason. */
export const SYNC_REFUSED_EVENT = 'stracker:sync-refused'

/**
 * Header carrying when a queued change was made. The database skips replays made before the end
 * of a ban, so edits made while banned are never synced, even after the ban is lifted.
 */
export const OP_AT_HEADER = 'x-stracker-op-at'

/** The account a device notice token belongs to (`<uid>.<expiry>.<mac>`), without trusting it. */
export function noticeTokenUserId(token: string | null): string | null {
  const id = token?.split('.')[0] ?? ''
  return /^[0-9a-f-]{36}$/.test(id) ? id : null
}

/**
 * When a queued change was made: the earlier of the edit time (upserts) and the queue time.
 * Sent with every replay so the database can skip edits made while the account was banned.
 */
export function queuedOperationTime(change: { queued_at: string; operation: string; record?: Record<string, unknown> | null }): string {
  const stamped = change.operation === 'upsert' && typeof change.record?.updated_at === 'string' ? change.record.updated_at : ''
  return stamped && stamped < change.queued_at ? stamped : change.queued_at
}

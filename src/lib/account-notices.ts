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
    case 'ban': return 'Your account is suspended'
    case 'unban': return 'Your suspension was lifted'
    case 'ban_ended': return 'Your suspension has ended'
  }
}

export function noticeSummary(notice: AccountNotice): string {
  switch (notice.kind) {
    case 'warning': return 'The Stracker team sent your account a warning. You can keep using Stracker as normal.'
    case 'ban': return notice.permanent || !notice.until
      ? 'The Stracker team has suspended your account permanently. You will be signed out.'
      : `The Stracker team has suspended your account until ${formatIst(notice.until)}. You will be signed out.`
    case 'unban': return 'The Stracker team lifted the suspension on your account. Welcome back.'
    case 'ban_ended': return 'Your temporary suspension is over, and your account works normally again.'
  }
}

/** The sign-in page message for a banned account whose identity has been proven. */
export function signInRefusal(notice: Pick<AccountNotice, 'permanent' | 'until' | 'reason'>): string {
  const length = notice.permanent || !notice.until ? 'This account is suspended permanently.' : `This account is suspended until ${formatIst(notice.until)}.`
  return notice.reason ? `${length} Reason: ${notice.reason}` : length
}

/** Shown when Auth refuses a banned account but the reason cannot be revealed (identity unproven). */
export const GENERIC_SUSPENDED_MESSAGE = 'This account is suspended and cannot sign in right now. Sign in with your email and password to see the details, or contact us if you think this is a mistake.'

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

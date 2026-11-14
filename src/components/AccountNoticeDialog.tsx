import { AlertTriangle, Ban, PartyPopper, ShieldCheck } from 'lucide-react'
import { Button, Dialog } from './ui'
import { banLengthText, GENERIC_SUSPENDED_MESSAGE, noticeSummary, noticeTitle, type AccountNotice } from '../lib/account-notices'

/**
 * The themed account-notice popup, shared by the dashboard (warning / ban / lifted) and the
 * sign-in page (a refused sign-in). `notice` null on the sign-in page means the ban could not be
 * proven for this person, so only the generic text is shown.
 */
export function AccountNoticeDialog({ notice, context, onClose, autoSignOut = false }: {
  notice: AccountNotice | null
  context: 'app' | 'signin'
  onClose: () => void
  autoSignOut?: boolean
}) {
  const kind = notice?.kind ?? 'ban'
  const isBan = kind === 'ban'
  const signin = context === 'signin'
  const title = signin ? 'Account banned' : noticeTitle(kind)
  const summary = signin
    ? (notice ? `This account is banned ${banLengthText(notice)}, so it cannot sign in.` : GENERIC_SUSPENDED_MESSAGE)
    : notice ? noticeSummary(notice) : ''
  const Icon = isBan ? Ban : kind === 'warning' ? AlertTriangle : kind === 'unban' ? ShieldCheck : PartyPopper
  const button = signin ? 'OK' : isBan ? 'Sign out' : 'I understand'
  return <Dialog title={title} onClose={onClose} className={`dialog-narrow account-notice account-notice--${kind}`} labelledBy="account-notice-title">
    <div className="account-notice-body">
      <div className="account-notice-icon" aria-hidden="true"><Icon size={22} /></div>
      <p className="type-body">{summary}</p>
    </div>
    {notice?.reason && <div className="account-notice-reason"><span className="eyebrow">REASON</span><p>{notice.reason}</p></div>}
    {isBan && !signin && notice && <p className="account-notice-meta type-caption">
      Anything you add or change while banned is discarded and will not be synced, even after the ban ends.{autoSignOut ? ' Signing you out automatically in 30 seconds.' : ''}
    </p>}
    {isBan && signin && notice && !notice.permanent && <p className="account-notice-meta type-caption">You can sign in again after the ban ends.</p>}
    <div className="dialog-actions">
      <Button variant={isBan && !signin ? 'danger' : 'primary'} onClick={onClose}>{button}</Button>
    </div>
  </Dialog>
}

/** The inline block under the password field on the sign-in page. */
export function BannedSignInBlock({ notice }: { notice: AccountNotice | null }) {
  return <div className="auth-banned-block" role="alert" aria-live="assertive">
    <div className="auth-banned-block__icon" aria-hidden="true"><Ban size={18} /></div>
    <div>
      <strong>Account banned</strong>
      {notice ? <>
        <p>{notice.permanent || !notice.until ? 'Banned permanently.' : `Banned ${banLengthText(notice)}.`}</p>
        {notice.reason && <p><span className="auth-banned-block__label">Reason:</span> {notice.reason}</p>}
      </> : <p>{GENERIC_SUSPENDED_MESSAGE}</p>}
    </div>
  </div>
}

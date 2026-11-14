import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Ban, PartyPopper, ShieldCheck } from 'lucide-react'
import { Button, Dialog } from './ui'
import { supabase } from '../lib/supabase'
import { acknowledgeNotice, fetchMyNotice } from '../lib/account-notices-client'
import { banLengthText, noticeSummary, noticeTitle, type AccountNotice } from '../lib/account-notices'

/** Re-check when the tab comes back into view, at most this often. */
const RECHECK_MS = 5 * 60 * 1000

/**
 * One-time account notices (warning, ban, lifted or ended ban) on dashboard open: a single small
 * RPC that also refreshes this device's notice token. Acknowledgement is stored server-side.
 * A ban notice ends in an automatic sign-out; the server has already revoked every session and
 * row-level security refuses the account's data, so this popup is information, not enforcement.
 */
export function AccountNoticeGate() {
  const [notice, setNotice] = useState<AccountNotice | null>(null)
  const lastCheck = useRef(0)
  const navigate = useNavigate()

  const check = useCallback(async () => {
    lastCheck.current = Date.now()
    try {
      const next = await fetchMyNotice()
      if (next) setNotice(current => current ?? next)
    } catch {
      // Notices are best effort; the server enforces bans regardless.
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    void check()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > RECHECK_MS) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [check])

  const isBan = notice?.kind === 'ban'

  const signOutBanned = useCallback(async (current: AccountNotice) => {
    await acknowledgeNotice(current.id).catch(() => undefined)
    // Local sign-out: the server already revoked every session at ban time.
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setNotice(null)
    navigate('/login', { replace: true, state: { suspended: true } })
  }, [navigate])

  useEffect(() => {
    if (!notice || notice.kind !== 'ban') return
    const timer = window.setTimeout(() => { void signOutBanned(notice) }, 30_000)
    return () => window.clearTimeout(timer)
  }, [notice, signOutBanned])

  if (!notice) return null

  const close = () => {
    if (isBan) { void signOutBanned(notice); return }
    void acknowledgeNotice(notice.id).catch(() => undefined)
    setNotice(null)
  }

  const Icon = notice.kind === 'ban' ? Ban : notice.kind === 'warning' ? AlertTriangle : notice.kind === 'unban' ? ShieldCheck : PartyPopper
  return <Dialog title={noticeTitle(notice.kind)} onClose={close} className={`dialog-narrow account-notice account-notice--${notice.kind}`} labelledBy="account-notice-title">
    <div className="account-notice-body">
      <div className="account-notice-icon" aria-hidden="true"><Icon size={22} /></div>
      <p className="type-body">{noticeSummary(notice)}</p>
    </div>
    {notice.reason && <div className="account-notice-reason"><span className="eyebrow">REASON</span><p>{notice.reason}</p></div>}
    {isBan && <p className="account-notice-meta type-caption">Sign-in stays blocked {banLengthText(notice) === 'permanently' ? 'unless the team lifts it' : 'until then'}. Signing you out automatically in 30 seconds.</p>}
    <div className="dialog-actions">
      <Button variant={isBan ? 'danger' : 'primary'} onClick={close}>{isBan ? 'Sign out' : 'I understand'}</Button>
    </div>
  </Dialog>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AccountNoticeDialog } from './AccountNoticeDialog'
import { supabase } from '../lib/supabase'
import { acknowledgeNotice, discardLocalAccountData, fetchMyNotice } from '../lib/account-notices-client'
import { SYNC_REFUSED_EVENT, type AccountNotice } from '../lib/account-notices'

/** Light background check while the tab is visible (one tiny RPC). */
const POLL_MS = 3 * 60 * 1000
/** Focus / visibility re-checks at most this often. */
const FOCUS_MS = 30 * 1000
/** A refused sync triggers a check at once, then at most this often. */
const REFUSED_MS = 10 * 1000

/**
 * One-time account notices (warning, ban, lifted or ended ban). Checks on dashboard open, when
 * a cloud write is refused (a ban makes the database refuse writes), on focus, and every few
 * minutes while visible. If the session itself is already dead, the signed device token is
 * used instead. A ban discards this device's local copy and unsynced edits, then signs out; the
 * server has already revoked every session and refuses the data, so this is information and
 * cleanup, not enforcement.
 */
export function AccountNoticeGate({ userId }: { userId: string }) {
  const [notice, setNotice] = useState<AccountNotice | null>(null)
  const lastCheck = useRef(0)
  const lastRefused = useRef(0)
  const busy = useRef(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const check = useCallback(async (minGapMs = 0) => {
    if (busy.current || Date.now() - lastCheck.current < minGapMs) return
    busy.current = true
    lastCheck.current = Date.now()
    try {
      const next = await fetchMyNotice()
      if (next) setNotice(current => current ?? next)
    } catch {
      // Notices are best effort; the server enforces bans regardless.
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    void check()
    const onVisible = () => { if (document.visibilityState === 'visible') void check(FOCUS_MS) }
    const onRefused = () => {
      // Measured from the last refusal-triggered check, so a refusal right after opening still checks.
      if (Date.now() - lastRefused.current < REFUSED_MS) return
      lastRefused.current = Date.now()
      void check()
    }
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void check(POLL_MS - 5_000) }, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener(SYNC_REFUSED_EVENT, onRefused)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener(SYNC_REFUSED_EVENT, onRefused)
    }
  }, [check])

  const signOutBanned = useCallback(async (current: AccountNotice) => {
    setNotice(null)
    await acknowledgeNotice(current.id).catch(() => undefined)
    // Forget everything made while banned: local rows, the unsynced outbox and cached images.
    await discardLocalAccountData(userId)
    queryClient.removeQueries({ queryKey: ['stracker-data', userId] })
    // Local sign-out: the server already revoked every session at ban time.
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined)
    navigate('/login', { replace: true, state: { suspended: 'app' } })
  }, [navigate, queryClient, userId])

  useEffect(() => {
    if (!notice || notice.kind !== 'ban') return
    const timer = window.setTimeout(() => { void signOutBanned(notice) }, 30_000)
    return () => window.clearTimeout(timer)
  }, [notice, signOutBanned])

  if (!notice) return null

  const close = () => {
    if (notice.kind === 'ban') { void signOutBanned(notice); return }
    void acknowledgeNotice(notice.id).catch(() => undefined)
    setNotice(null)
  }

  return <AccountNoticeDialog notice={notice} context="app" onClose={close} autoSignOut />
}

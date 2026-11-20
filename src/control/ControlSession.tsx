/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { controlFetch, ControlApiError, type SessionResponse } from './api'
import { CONSOLE_BASE, IDLE_TIMEOUT_MS, idleState } from './policy'
import { formatIstDaysLeft } from '../lib/control-role-governance'
import './owner-readonly.css'

/** Hard maximum lifetime for any Control Centre session (6 hours), regardless of activity. */
export const CONTROL_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000

const SESSION_EXPIRED_NOTICE = 'Your 6-hour Control Centre session has ended. Sign in again to continue.'

export type SessionPayload = SessionResponse & {
  ownerReadOnly?: boolean
  ownerRemovalStatus?: string | null
  removalDaysRemaining?: number | null
  removalTargetDateIst?: string | null
  sessionStartedAt?: number | null
  sessionExpiresAt?: number | null
  maxSessionSeconds?: number
}

/**
 * Console session state machine. The server decides every transition: the browser only
 * renders what /api/control/session reports. Nothing here is a privilege.
 */
export type ControlPhase =
  | { kind: 'loading' }
  | { kind: 'signed_out'; notice?: string }
  | { kind: 'mfa'; passkey?: boolean; owner?: boolean }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }
  | { kind: 'granted'; session: SessionPayload }

export interface ControlSessionValue {
  phase: ControlPhase
  idle: 'active' | 'warning' | 'expired'
  refresh: () => Promise<void>
  signOut: (scope?: 'local' | 'global') => Promise<void>
  markActive: () => void
  lastActivity: () => number
}

const ControlSessionContext = createContext<ControlSessionValue | null>(null)
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const

export function ControlSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<ControlPhase>({ kind: 'loading' })
  const [idle, setIdle] = useState<'active' | 'warning' | 'expired'>('active')
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null)
  const activity = useRef(Date.now())
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (!supabase) {
      setPhase({ kind: 'error', message: 'Cloud sign-in is not configured for this deployment, so the Control Centre cannot open.' })
      return
    }
    const { data } = await supabase.auth.getSession()
    if (!mounted.current) return
    if (!data.session) {
      setSessionExpiresAt(null)
      setPhase(current => (current.kind === 'signed_out' && !current.notice ? current : { kind: 'signed_out' }))
      return
    }
    try {
      const session = await controlFetch<SessionPayload>('session')
      if (!mounted.current) return
      const maxMs = typeof session.maxSessionSeconds === 'number' && Number.isFinite(session.maxSessionSeconds) && session.maxSessionSeconds > 0
        ? session.maxSessionSeconds * 1000
        : CONTROL_SESSION_MAX_AGE_MS
      const serverExpiresAt = typeof session.sessionExpiresAt === 'number' && Number.isFinite(session.sessionExpiresAt)
        ? session.sessionExpiresAt * 1000
        : null
      setSessionExpiresAt(current => serverExpiresAt ?? current ?? (Date.now() + maxMs))
      setPhase(session.status === 'granted' ? { kind: 'granted', session } : { kind: 'mfa', passkey: session.role === 'owner' && session.passkey === true, owner: session.role === 'owner' })
    } catch (error) {
      if (!mounted.current) return
      if (error instanceof ControlApiError) {
        if (error.status === 401) {
          setSessionExpiresAt(null)
          void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          const notice = error.code === 'session_expired'
            ? (error.message || SESSION_EXPIRED_NOTICE)
            : 'Your session has expired. Sign in again to continue.'
          setPhase({ kind: 'signed_out', notice })
          return
        }
        if (error.code === 'access_not_granted') {
          setSessionExpiresAt(null)
          setPhase({ kind: 'denied' })
          return
        }
      }
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'The Control Centre could not be reached.' })
    }
  }, [])

  const signOut = useCallback(async (scope: 'local' | 'global' = 'local') => {
    setSessionExpiresAt(null)
    if (supabase) await supabase.auth.signOut({ scope })
    if (mounted.current) setPhase({ kind: 'signed_out' })
  }, [])

  const markActive = useCallback(() => {
    activity.current = Date.now()
    setIdle('active')
  }, [])

  const lastActivity = useCallback(() => activity.current, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    if (!supabase) {
      return () => { mounted.current = false }
    }
    const { data: subscription } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        setSessionExpiresAt(null)
        setPhase(current => (current.kind === 'signed_out' && current.notice ? current : { kind: 'signed_out' }))
        return
      }
      if (event === 'SIGNED_IN') {
        activity.current = Date.now()
        setSessionExpiresAt(null)
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') {
        // Deferred so the Auth client is never re-entered from inside its own event callback.
        setTimeout(() => { if (mounted.current) void refresh() }, 0)
      }
    })
    return () => {
      mounted.current = false
      subscription.subscription.unsubscribe()
    }
  }, [refresh])

  // Idle policy (20m) and hard absolute session cap (6h): only while a console session is open.
  // User activity resets the idle timer, never the 6-hour absolute limit.
  const active = phase.kind === 'granted' || phase.kind === 'mfa'
  useEffect(() => {
    if (!active) return
    let signingOut = false

    const enforceMaxSession = () => {
      if (signingOut || sessionExpiresAt === null) return false
      if (Date.now() < sessionExpiresAt) return false
      signingOut = true
      void signOut('local').then(() => {
        if (mounted.current) setPhase({ kind: 'signed_out', notice: SESSION_EXPIRED_NOTICE })
      })
      return true
    }

    if (enforceMaxSession()) return

    const onActivity = () => { activity.current = Date.now() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') enforceMaxSession()
    }
    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)

    const expiryTimer = sessionExpiresAt !== null
      ? window.setTimeout(() => { enforceMaxSession() }, Math.max(0, sessionExpiresAt - Date.now()))
      : null

    const timer = window.setInterval(() => {
      if (enforceMaxSession()) return
      const state = idleState(activity.current, Date.now())
      setIdle(state)
      if (state === 'expired' && !signingOut) {
        signingOut = true
        void signOut('local').then(() => {
          if (mounted.current) setPhase({ kind: 'signed_out', notice: 'You were signed out after 20 minutes without activity.' })
        })
      }
    }, 5_000)

    return () => {
      ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      if (expiryTimer !== null) window.clearTimeout(expiryTimer)
      window.clearInterval(timer)
    }
  }, [active, sessionExpiresAt, signOut])

  // Global view-only lockout across EVERY Control Centre page while an authority is in a
  // removal countdown (30-day owner / 7-day non-owner) or 2-day owner restore review.
  const grantedSession = phase.kind === 'granted' ? phase.session : null
  const isReadOnly = grantedSession?.ownerReadOnly === true
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!isReadOnly) {
      delete document.documentElement.dataset.ccOwnerReadonly
      return
    }
    document.documentElement.dataset.ccOwnerReadonly = 'true'
    const blockFormSubmit = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      // Allow read-only search/filter forms and step-up verification dialogs.
      if (target.closest('[role="dialog"], .cc-filters, [role="search"], .cc-restore-zone')) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('submit', blockFormSubmit, true)
    return () => {
      document.removeEventListener('submit', blockFormSubmit, true)
      delete document.documentElement.dataset.ccOwnerReadonly
    }
  }, [isReadOnly])

  const value = useMemo<ControlSessionValue>(() => ({
    phase,
    idle,
    refresh,
    signOut,
    markActive,
    lastActivity
  }), [phase, idle, refresh, signOut, markActive, lastActivity])

  const daysLabel = typeof grantedSession?.removalDaysRemaining === 'number'
    ? formatIstDaysLeft(grantedSession.removalDaysRemaining)
    : null
  const targetDateLabel = grantedSession?.removalTargetDateIst ? `${grantedSession.removalTargetDateIst} IST` : null

  return (
    <ControlSessionContext.Provider value={value}>
      {isReadOnly && grantedSession && (
        <div className="cc-global-readonly-banner" role="alert">
          <div className="cc-global-readonly-banner__body">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>View-only mode — all settings &amp; actions disabled.</strong>{' '}
              {grantedSession.role === 'owner' && grantedSession.ownerRemovalStatus === 'review_restore' ? (
                <>
                  Your 2-day Owner restore review is active{daysLabel ? ` (${daysLabel}` : ''}{targetDateLabel ? `, restoring on ${targetDateLabel})` : daysLabel ? ')' : ''}. You can view the Control Centre, but all edits stay locked until your Owner role is automatically restored. No one can pause or cancel this process.
                </>
              ) : grantedSession.role === 'owner' ? (
                <>
                  Your 30-day Owner removal countdown is active{daysLabel ? ` (${daysLabel}` : ''}{targetDateLabel ? `, scheduled for ${targetDateLabel})` : daysLabel ? ')' : ''}. You can browse and view the Control Centre, but you cannot edit or change anything. Only the restore review button in Roles &amp; members is enabled.
                </>
              ) : (
                <>
                  Your 7-day role removal countdown is active{daysLabel ? ` (${daysLabel}` : ''}{targetDateLabel ? `, scheduled for ${targetDateLabel})` : daysLabel ? ')' : ''}. You can view the Control Centre, but all settings, features, and actions are disabled.
                </>
              )}
            </div>
          </div>
          {grantedSession.role === 'owner' && (
            <a className="cc-global-readonly-banner__link" href={`${CONSOLE_BASE}/settings/roles`}>
              Open Roles &amp; members →
            </a>
          )}
        </div>
      )}
      {children}
    </ControlSessionContext.Provider>
  )
}

export function useControlSession(): ControlSessionValue {
  const value = useContext(ControlSessionContext)
  if (!value) throw new Error('useControlSession must be used inside ControlSessionProvider')
  return value
}

export { IDLE_TIMEOUT_MS }

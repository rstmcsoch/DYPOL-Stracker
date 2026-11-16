/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { localPreviewEnabled, readStoredSessionUser, supabase, supabaseAuthStorageKey } from '../lib/supabase'
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from '../lib/disposable-email'
import { loginFailureReason, track } from '../lib/telemetry/client'
import { displayNameFromMetadata, userAuthProviders } from '../lib/google-auth'
import { banNoticeForCredentials } from '../lib/account-notices-client'
import { signInRefusal, type AccountNotice } from '../lib/account-notices'

export interface AppUser {
  id: string
  email: string
  displayName: string
  isLocal: boolean
  /** Sign-in methods linked to the account, e.g. ['email'], ['google'] or ['email', 'google']. */
  providers?: string[]
}

export interface SignUpResult {
  /** True when Supabase created the user but still expects the emailed confirmation link. */
  needsEmailConfirmation: boolean
}

export interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  error: string | null
  clearError: () => void
  /** `captchaToken`: a fresh Cloudflare Turnstile token (single-use), verified by Supabase Auth. */
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>
  /**
   * Creates a real Supabase account. The profile row is written by the database
   * trigger on `auth.users`; the notebook itself (settings + seeded syllabus) is
   * initialized by the authenticated data session after the first sign-in.
   */
  signUp: (email: string, password: string, displayName: string, captchaToken?: string) => Promise<SignUpResult>
  resendConfirmation: (email: string, captchaToken?: string) => Promise<void>
  signOut: () => Promise<void>
  /** Set when a password sign-in was refused because the (password-proven) account is banned. */
  suspension: AccountNotice | null
  clearSuspension: () => void
  startLocalPreview: () => void
  sendPasswordReset: (email: string, captchaToken?: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const LOCAL_USER_ID = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const LOCAL_SESSION_KEY = 'stracker-local-preview-session'

function userFromSupabase(user: User): AppUser {
  return {
    id: user.id,
    email: user.email ?? '',
    // Stracker's own display_name first; a Google account falls back to its profile name
    // (full_name / name) so first-time setup can prefill it. It stays editable there.
    displayName: displayNameFromMetadata(user.user_metadata),
    isLocal: false,
    providers: userAuthProviders(user.app_metadata)
  }
}

function isBannedAuthError(error: { message?: string; code?: string }): boolean {
  return error.code === 'user_banned' || /user is banned|user banned/i.test(error.message ?? '')
}

const CAPTCHA_MESSAGE = 'We could not confirm you are human. Please try again.'

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) return 'Email or password is incorrect. Please try again.'
  if (normalized.includes('email not confirmed')) return 'Confirm your email before signing in.'
  if (normalized.includes('too many requests')) return 'Too many attempts. Wait a moment, then try again.'
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'Could not reach the sign-in service. Check your connection and try again.'
  if (normalized.includes('captcha')) return CAPTCHA_MESSAGE
  // Raised inside Supabase Auth by the console's sign-in / sign-up switches (database triggers).
  if (normalized.includes('database error')) return 'Sign-in is paused right now. Please try again later.'
  return 'We could not complete that authentication request. Please try again.'
}

/** Sign-up specific mapping: the shared mapper would hide the useful cases. */
function friendlySignUpError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('captcha')) return CAPTCHA_MESSAGE
  if (normalized.includes('already registered') || normalized.includes('already been registered')) return 'Could not create a new account with those details. If you already use Stracker, log in or reset the password.'
  if (normalized.includes('disposable')) return DISPOSABLE_EMAIL_MESSAGE
  if (normalized.includes('database error') || normalized.includes('signups_paused')) return 'New sign-ups are paused right now. Please try again later.'
  if (normalized.includes('signups not allowed') || normalized.includes('signup disabled')) return 'This deployment does not allow new accounts to be created yet. Enable email sign-ups in Supabase Auth, or sign in with an existing account.'
  if (normalized.includes('password should be') || normalized.includes('password is too short')) return 'Use at least 8 characters for your password.'
  if (normalized.includes('unable to validate email') || normalized.includes('invalid email')) return 'That email address does not look right. Check it and try again.'
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) return 'Too many attempts. Wait a moment, then try again.'
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'Could not reach the sign-up service. Check your connection and try again.'
  return friendlyAuthError(message)
}

function mayHaveSession(): boolean {
  if (typeof window === 'undefined') return true
  if (/[?&#](code|access_token|refresh_token|error_description|token_hash)=/.test(`${window.location.search}${window.location.hash}`)) return true
  try { return Boolean(supabaseAuthStorageKey && window.localStorage.getItem(supabaseAuthStorageKey)) } catch { return true }
}

/** Longest the app waits on session restore before rendering anyway. */
export const AUTH_RESTORE_TIMEOUT_MS = 5_000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  // A visitor with no saved session and no sign-in redirect in the URL is signed out for sure, so the
  // public homepage paints immediately instead of waiting for supabase-js to start up.
  const [loading, setLoading] = useState(() => !supabase || mayHaveSession())
  const [error, setError] = useState<string | null>(null)
  const [suspension, setSuspension] = useState<AccountNotice | null>(null)

  useEffect(() => {
    if (!supabase) {
      if (localPreviewEnabled && sessionStorage.getItem(LOCAL_SESSION_KEY) === '1') {
        setUser({ id: LOCAL_USER_ID, email: 'local@stracker.test', displayName: 'Study notebook', isLocal: true })
      }
      setLoading(false)
      return
    }
    let mounted = true
    let settled = false
    // A confirmation link lands with type=signup in the URL hash; record it once.
    let confirming = typeof window !== 'undefined' && /type=signup/.test(window.location.hash)
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (confirming && event === 'SIGNED_IN' && session?.user?.email_confirmed_at) { confirming = false; track('email_verification_completed') }
      settled = true
      setUser(session?.user ? userFromSupabase(session.user) : null)
      setLoading(false)
    })
    // Safety net: never hold the page on a spinner if session restore hangs (auth lock held by a
    // frozen tab, a token refresh stuck on a bad connection). After AUTH_RESTORE_TIMEOUT_MS the
    // app renders with the session saved on this device (or signed out if there is none); the
    // real answer still replaces it as soon as supabase-js responds.
    const restoreTimer = window.setTimeout(() => {
      if (!mounted || settled) return
      const stored = readStoredSessionUser()
      setUser(current => current ?? (stored ? userFromSupabase(stored) : null))
      setLoading(false)
    }, AUTH_RESTORE_TIMEOUT_MS)
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      settled = true
      window.clearTimeout(restoreTimer)
      if (!mounted) return
      if (sessionError) setError('Could not restore your session. Please sign in again.')
      setUser(data.session?.user ? userFromSupabase(data.session.user) : null)
      setLoading(false)
    }).catch(() => {
      settled = true
      window.clearTimeout(restoreTimer)
      if (mounted) {
        setUser(null)
        setLoading(false)
        setError('Could not restore your session. Check your connection and sign in again.')
      }
    })
    return () => {
      mounted = false
      window.clearTimeout(restoreTimer)
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    error,
    clearError: () => setError(null),
    suspension,
    clearSuspension: () => setSuspension(null),
    signIn: async (email, password, captchaToken) => {
      setError(null)
      setSuspension(null)
      if (!supabase) {
        setError('Cloud authentication is not configured. Use the local preview in development or add Supabase environment variables.')
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: captchaToken ? { captchaToken } : undefined })
      if (signInError && isBannedAuthError(signInError)) {
        // Supabase Auth says "banned" before it checks the password, so the details are only
        // shown once the database has proven the password itself. Otherwise: a normal refusal.
        track('login_failed', { reason: 'other' })
        const check = await banNoticeForCredentials(email, password)
        if (check.kind === 'banned') {
          // Shown as the ban popup and the block under the password field, not as an error line.
          setSuspension(check.notice)
          throw new Error(signInRefusal(check.notice))
        }
        const message = check.kind === 'limited' ? 'Too many attempts. Wait a few minutes, then try again.'
          : check.kind === 'unproven' ? 'Email or password is incorrect. Please try again.'
            : 'We could not complete that sign-in. Please try again.'
        setError(message)
        throw new Error(message)
      }
      if (signInError) {
        track('login_failed', { reason: loginFailureReason(signInError.message) })
        const message = friendlyAuthError(signInError.message)
        setError(message)
        throw new Error(message)
      }
      track('login_succeeded')
    },
    signUp: async (email, password, displayName, captchaToken) => {
      setError(null)
      if (!supabase) {
        const message = 'Cloud authentication is not configured. Add the Supabase project URL and public key to the deployment environment before creating an account.'
        setError(message)
        throw new Error(message)
      }
      track('signup_started')
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/`,
          ...(captchaToken ? { captchaToken } : {})
        }
      })
      if (signUpError) {
        // The database refuses disposable domains with a generic "Database error"; tell them apart
        // from paused sign-ups with the same true/false check the form uses.
        const raw = signUpError.message.toLowerCase()
        const message = raw.includes('disposable') || (raw.includes('database error') && await isDisposableEmail(email))
          ? DISPOSABLE_EMAIL_MESSAGE
          : friendlySignUpError(signUpError.message)
        setError(message)
        throw new Error(message)
      }
      // With email confirmation enabled Supabase returns a user but no session.
      // Without it the session arrives immediately and the route guard opens the notebook.
      track('signup_completed', { needs_confirmation: data.session ? 'no' : 'yes' })
      return { needsEmailConfirmation: !data.session }
    },
    resendConfirmation: async (email, captchaToken) => {
      setError(null)
      if (!supabase) throw new Error('Cloud authentication is not configured.')
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: captchaToken ? { captchaToken } : undefined })
      if (resendError) {
        const message = friendlySignUpError(resendError.message)
        setError(message)
        throw new Error(message)
      }
    },
    signOut: async () => {
      setError(null)
      if (user?.isLocal) {
        sessionStorage.removeItem(LOCAL_SESSION_KEY)
        setUser(null)
        return
      }
      if (!supabase) {
        setUser(null)
        return
      }
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) {
        const message = friendlyAuthError(signOutError.message)
        setError(message)
        throw new Error(message)
      }
      setUser(null)
    },
    startLocalPreview: () => {
      if (!localPreviewEnabled) return
      sessionStorage.setItem(LOCAL_SESSION_KEY, '1')
      setError(null)
      setUser({ id: LOCAL_USER_ID, email: 'local@stracker.test', displayName: 'Study notebook', isLocal: true })
    },
    sendPasswordReset: async (email, captchaToken) => {
      setError(null)
      if (!supabase) throw new Error('Cloud authentication is not configured.')
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
        ...(captchaToken ? { captchaToken } : {})
      })
      if (resetError) {
        const message = friendlyAuthError(resetError.message)
        setError(message)
        throw new Error(message)
      }
      track('password_reset_requested')
    },
    updatePassword: async password => {
      setError(null)
      if (!supabase) throw new Error('Cloud authentication is not configured.')
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        const message = friendlyAuthError(updateError.message)
        setError(message)
        throw new Error(message)
      }
    }
  }), [user, loading, error, suspension])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Preview-only injection boundary (editor canvas): a synthetic, signed-out-of-nothing user. */
export function AuthPreviewProvider({ value, children }: { value: AuthContextValue; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

/** The signed-in user when an AuthProvider is present, otherwise null (public pages and tests). */
export function useOptionalUser(): AppUser | null {
  return useContext(AuthContext)?.user ?? null
}

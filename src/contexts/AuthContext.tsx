/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { localPreviewEnabled, supabase } from '../lib/supabase'

export interface AppUser {
  id: string
  email: string
  displayName: string
  isLocal: boolean
}

export interface SignUpResult {
  /** True when Supabase created the user but still expects the emailed confirmation link. */
  needsEmailConfirmation: boolean
}

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  error: string | null
  clearError: () => void
  signIn: (email: string, password: string) => Promise<void>
  /**
   * Creates a real Supabase account. The profile row is written by the database
   * trigger on `auth.users`; the notebook itself (settings + seeded syllabus) is
   * initialized by the authenticated data session after the first sign-in.
   */
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpResult>
  resendConfirmation: (email: string) => Promise<void>
  signOut: () => Promise<void>
  startLocalPreview: () => void
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const LOCAL_USER_ID = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const LOCAL_SESSION_KEY = 'stracker-local-preview-session'

function userFromSupabase(user: User): AppUser {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name : '',
    isLocal: false
  }
}

function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login credentials')) return 'Email or password is incorrect. Please try again.'
  if (normalized.includes('email not confirmed')) return 'Confirm your email before signing in.'
  if (normalized.includes('too many requests')) return 'Too many attempts. Wait a moment, then try again.'
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'Could not reach the sign-in service. Check your connection and try again.'
  return 'We could not complete that authentication request. Please try again.'
}

/** Sign-up specific mapping: the shared mapper would hide the useful cases. */
function friendlySignUpError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('already registered') || normalized.includes('already been registered')) return 'That email already has a Stracker account. Log in instead, or reset the password.'
  if (normalized.includes('signups not allowed') || normalized.includes('signup disabled')) return 'This deployment does not allow new accounts to be created yet. Enable email sign-ups in Supabase Auth, or sign in with an existing account.'
  if (normalized.includes('password should be') || normalized.includes('password is too short')) return 'Use at least 8 characters for your password.'
  if (normalized.includes('unable to validate email') || normalized.includes('invalid email')) return 'That email address does not look right. Check it and try again.'
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) return 'Too many attempts. Wait a moment, then try again.'
  if (normalized.includes('failed to fetch') || normalized.includes('network')) return 'Could not reach the sign-up service. Check your connection and try again.'
  return friendlyAuthError(message)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      if (localPreviewEnabled && sessionStorage.getItem(LOCAL_SESSION_KEY) === '1') {
        setUser({ id: LOCAL_USER_ID, email: 'local@stracker.test', displayName: 'Study notebook', isLocal: true })
      }
      setLoading(false)
      return
    }
    let mounted = true
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ? userFromSupabase(session.user) : null)
      setLoading(false)
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return
      if (sessionError) setError('Could not restore your session. Please sign in again.')
      setUser(data.session?.user ? userFromSupabase(data.session.user) : null)
      setLoading(false)
    }).catch(() => {
      if (mounted) {
        setUser(null)
        setLoading(false)
        setError('Could not restore your session. Check your connection and sign in again.')
      }
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    error,
    clearError: () => setError(null),
    signIn: async (email, password) => {
      setError(null)
      if (!supabase) {
        setError('Cloud authentication is not configured. Use the local preview in development or add Supabase environment variables.')
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        const message = friendlyAuthError(signInError.message)
        setError(message)
        throw new Error(message)
      }
    },
    signUp: async (email, password, displayName) => {
      setError(null)
      if (!supabase) {
        const message = 'Cloud authentication is not configured. Add the Supabase project URL and public key to the deployment environment before creating an account.'
        setError(message)
        throw new Error(message)
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/`
        }
      })
      if (signUpError) {
        const message = friendlySignUpError(signUpError.message)
        setError(message)
        throw new Error(message)
      }
      // With email confirmation enabled Supabase returns a user but no session.
      // Without it the session arrives immediately and the route guard opens the notebook.
      return { needsEmailConfirmation: !data.session }
    },
    resendConfirmation: async email => {
      setError(null)
      if (!supabase) throw new Error('Cloud authentication is not configured.')
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
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
    sendPasswordReset: async email => {
      setError(null)
      if (!supabase) throw new Error('Cloud authentication is not configured.')
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`
      })
      if (resetError) {
        const message = friendlyAuthError(resetError.message)
        setError(message)
        throw new Error(message)
      }
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
  }), [user, loading, error])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

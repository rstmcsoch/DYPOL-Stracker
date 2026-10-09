import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Linking from 'expo-linking'
import type { Session, User } from '@supabase/supabase-js'
import { followAppStateForAuthRefresh, supabase } from '../lib/supabase'
import { localPreviewEnabled } from '../lib/config'

export interface AppUser {
  id: string
  email: string
  displayName: string
  /** Device-only development preview. It never signs in to Supabase and never syncs. */
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
   * Creates a real Supabase account. The profile row is written by the database trigger on
   * `auth.users`; settings and the seeded syllabus are initialised by the first authenticated sync.
   */
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpResult>
  resendConfirmation: (email: string) => Promise<void>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  /** Completes a recovery or confirmation link opened from email. Returns true when it was an auth link. */
  handleAuthLink: (url: string) => Promise<boolean>
  /** Set while a recovery session is open, so the app opens the password form rather than the notebook. */
  recovering: boolean
  endRecovery: () => void
  /** True only in development builds without Supabase configuration, mirroring the website. */
  localPreviewAvailable: boolean
  startLocalPreview: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function userFromSupabase(user: User): AppUser {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName: typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name : '',
    isLocal: false
  }
}

const LOCAL_PREVIEW_USER: AppUser = { id: 'a3f147d2-b7cf-53bd-a461-0d3cfed00001', email: 'local@stracker.test', displayName: 'Study notebook', isLocal: true }

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

/** Where emailed links return to. The `stracker://` scheme is registered in the app manifest. */
export function authRedirect(path: string): string {
  return Linking.createURL(path)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(() => supabase !== null)
  const [error, setError] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)
  const handleAuthLinkRef = useRef<(url: string) => Promise<boolean>>(async () => false)

  useEffect(() => followAppStateForAuthRefresh(), [])

  // Emailed confirmation and recovery links arrive as stracker:// URLs, either at launch or while running.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !supabase) return
      void handleAuthLinkRef.current(url).catch(() => setError('That link could not be opened. Request a new one.'))
    }
    void Linking.getInitialURL().then(handle)
    const subscription = Linking.addEventListener('url', event => handle(event.url))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    const { data: listener } = supabase.auth.onAuthStateChange((event, session: Session | null) => {
      if (!mounted) return
      setUser(session?.user ? userFromSupabase(session.user) : null)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
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

  const requireClient = useCallback(() => {
    if (!supabase) throw new Error('Cloud authentication is not configured. Add the Supabase URL and public key to the build environment.')
    return supabase
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    error,
    clearError: () => setError(null),
    recovering,
    endRecovery: () => setRecovering(false),
    localPreviewAvailable: localPreviewEnabled,
    startLocalPreview: () => {
      if (!localPreviewEnabled) return
      setError(null)
      setUser(LOCAL_PREVIEW_USER)
    },
    signIn: async (email, password) => {
      setError(null)
      const client = requireClient()
      const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        const message = friendlyAuthError(signInError.message)
        setError(message)
        throw new Error(message)
      }
    },
    signUp: async (email, password, displayName) => {
      setError(null)
      const client = requireClient()
      const { data, error: signUpError } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: authRedirect('/')
        }
      })
      if (signUpError) {
        const message = friendlySignUpError(signUpError.message)
        setError(message)
        throw new Error(message)
      }
      // With email confirmation enabled Supabase returns a user but no session.
      return { needsEmailConfirmation: !data.session }
    },
    resendConfirmation: async email => {
      setError(null)
      const client = requireClient()
      const { error: resendError } = await client.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: authRedirect('/') } })
      if (resendError) {
        const message = friendlySignUpError(resendError.message)
        setError(message)
        throw new Error(message)
      }
    },
    signOut: async () => {
      setError(null)
      if (user?.isLocal) {
        setRecovering(false)
        setUser(null)
        return
      }
      const client = requireClient()
      const { error: signOutError } = await client.auth.signOut()
      if (signOutError) {
        const message = friendlyAuthError(signOutError.message)
        setError(message)
        throw new Error(message)
      }
      setRecovering(false)
      setUser(null)
    },
    sendPasswordReset: async email => {
      setError(null)
      const client = requireClient()
      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect('reset-password') })
      if (resetError) {
        const message = friendlyAuthError(resetError.message)
        setError(message)
        throw new Error(message)
      }
    },
    updatePassword: async password => {
      setError(null)
      const client = requireClient()
      const { error: updateError } = await client.auth.updateUser({ password })
      if (updateError) {
        const message = friendlyAuthError(updateError.message)
        setError(message)
        throw new Error(message)
      }
    },
    handleAuthLink: async url => {
      const client = supabase
      if (!client) return false
      const parsed = new URL(url)
      const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''))
      const query = parsed.searchParams
      const code = query.get('code')
      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          setError('That link has expired or was already used. Request a new one.')
          return true
        }
        if (`${parsed.host}${parsed.pathname}`.includes('reset-password')) setRecovering(true)
        return true
      }
      const accessToken = fragment.get('access_token')
      const refreshToken = fragment.get('refresh_token')
      if (accessToken && refreshToken) {
        const { error: sessionError } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (sessionError) {
          setError('That link has expired or was already used. Request a new one.')
          return true
        }
        if (fragment.get('type') === 'recovery') setRecovering(true)
        return true
      }
      return false
    }
  }), [user, loading, error, recovering, requireClient])

  useEffect(() => {
    handleAuthLinkRef.current = value.handleAuthLink
  }, [value.handleAuthLink])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

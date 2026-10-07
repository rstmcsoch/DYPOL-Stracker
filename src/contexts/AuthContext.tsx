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

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  error: string | null
  clearError: () => void
  signIn: (email: string, password: string) => Promise<void>
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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { useGoogleAuthAvailable } from '../lib/google-auth'
import { startGoogleOAuth } from '../lib/google-oauth'

/** Google's standard four-colour "G" (unaltered, per the Sign in with Google branding guidelines). */
export function GoogleGLogo({ size = 20 }: { size?: number }) {
  return <svg className="google-g" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    <path fill="none" d="M0 0h48v48H0z" />
  </svg>
}

export interface GoogleAuthButtonProps {
  /** "signin" → "Continue with Google"; "signup" → "Sign up with Google". */
  intent: 'signin' | 'signup'
  /** Same-origin path to open after the round trip. */
  next?: string
  /** Visual context: the public auth pages or the Control Center gate. */
  surface?: 'public' | 'control'
  disabled?: boolean
  /** Rendered between the Google button and the email form when the button is visible. */
  dividerLabel?: string
}

/**
 * "Continue with Google". Renders nothing until the Supabase project reports the Google
 * provider as enabled, so there is never a broken button. Includes the "or" divider that
 * separates it from the email form.
 */
export function GoogleAuthButton({ intent, next = '/', surface = 'public', disabled = false, dividerLabel = 'or use your email' }: GoogleAuthButtonProps) {
  const available = useGoogleAuthAvailable()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Coming back with the browser's Back button restores this page from cache; clear the spinner.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) setBusy(false) }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  if (!available) return null
  const label = intent === 'signup' ? 'Sign up with Google' : 'Continue with Google'

  const start = async () => {
    if (busy || disabled) return
    setProblem(null)
    setBusy(true)
    try {
      await startGoogleOAuth(next)
      // The browser is now leaving for Google; keep the loading state until it does.
    } catch (error) {
      setBusy(false)
      setProblem(error instanceof Error ? error.message : 'Google sign-in isn’t available right now. Please use your email and password instead.')
    }
  }

  return <div className={`google-auth google-auth--${surface}`}>
    <button
      type="button"
      className="google-button"
      onClick={() => void start()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-intent={intent}
    >
      <span className="google-button__icon">{busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <GoogleGLogo />}</span>
      <span className="google-button__label">{busy ? 'Opening Google…' : label}</span>
    </button>
    {problem && <div className="form-error google-auth__error" role="alert">{problem}</div>}
    {surface === 'public' && <p className="google-auth__legal">By continuing with Google, you agree to Stracker’s <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>. Google shares only your name, email and profile picture.</p>}
    <div className="auth-divider" role="separator" aria-label={dividerLabel}><span>{dividerLabel}</span></div>
  </div>
}

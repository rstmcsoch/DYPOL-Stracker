import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LockKeyhole, ShieldCheck, LogOut, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, Field } from './ui'
import { BrandMark } from './BrandMark'
import { MfaChallengeForm, MfaEnrollment } from './MfaPanels'
import { useControlSession } from './ControlSession'

/** Shared frame for pre-console states: no navigation, no admin data, dark identity. */
export function GateFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <main className="cc-gate" id="main">
      <div className="cc-gate__card">
        <BrandMark />
        <h1 className="cc-gate__title">{title}</h1>
        {subtitle && <p className="cc-gate__subtitle">{subtitle}</p>}
        {children}
      </div>
      <footer className="cc-gate__footer">Stracker by DYPOL LABS · Control Center</footer>
    </main>
  )
}

export function SignInGate({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!supabase) { setError('Cloud sign-in is not configured for this deployment.'); return }
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (signInError) {
      // Generic on purpose: the response does not reveal whether the account exists or is an administrator.
      setError(/not confirmed/i.test(signInError.message) ? 'Confirm your email address before signing in.' : 'Those details could not be signed in. Check them and try again.')
      setPassword('')
    }
  }

  return (
    <GateFrame title="Sign in to the Control Center" subtitle="Restricted to DYPOL LABS operators. Two-step verification is required after sign-in.">
      {notice && <p className="cc-note cc-note--warn" role="status">{notice}</p>}
      <form className="cc-form" onSubmit={submit} noValidate>
        <Field label="Email" htmlFor="cc-email" error={null}>
          <input id="cc-email" className="cc-input" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
        </Field>
        <Field label="Password" htmlFor="cc-password" error={error}>
          <input id="cc-password" className="cc-input" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy} className="cc-btn--block">
          <LockKeyhole size={16} aria-hidden="true" /> {busy ? 'Signing in…' : 'Continue'}
        </Button>
      </form>
      <p className="cc-gate__links">
        <Link to="/reset-password">Forgot your password?</Link>
      </p>
    </GateFrame>
  )
}

/** Owner without a completed second factor: only enrollment or verification is shown. */
export function MfaGate() {
  const { refresh, signOut } = useControlSession()
  const [mode, setMode] = useState<'checking' | 'enroll' | 'challenge'>('checking')
  useEffect(() => {
    let active = true
    if (!supabase) return
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!active) return
      setMode(data?.totp.some(factor => factor.status === 'verified') ? 'challenge' : 'enroll')
    }).catch(() => { if (active) setMode('enroll') })
    return () => { active = false }
  }, [])
  return (
    <GateFrame title="Two-step verification" subtitle="Verify this session with your authenticator app before the console opens.">
      <ol className="cc-steps" aria-label="Sign-in progress">
        <li className="is-done"><Check size={14} aria-hidden="true" /> Password</li>
        <li className="is-current"><ShieldCheck size={14} aria-hidden="true" /> Authenticator</li>
        <li>Console access</li>
      </ol>
      {mode === 'checking' && <p className="cc-inline-status" role="status">Checking your authenticator settings…</p>}
      {mode === 'enroll' && <MfaEnrollment onVerified={refresh} />}
      {mode === 'challenge' && (
        <>
          <MfaChallengeForm onVerified={refresh} />
          <p className="cc-gate__links"><button type="button" className="cc-link" onClick={() => setMode('enroll')}>I need to set up an authenticator instead</button></p>
        </>
      )}
      <div className="cc-gate__signout">
        <Button variant="ghost" onClick={() => void signOut('local')}><LogOut size={15} aria-hidden="true" /> Sign out</Button>
      </div>
    </GateFrame>
  )
}

/** Neutral response for every signed-in account that is not an active owner. */
export function AccessDenied() {
  const { signOut } = useControlSession()
  return (
    <GateFrame title="Access not granted" subtitle="This console is restricted. Nothing on this page depends on your account details.">
      <div className="cc-gate__actions">
        <Link className="cc-btn cc-btn--default cc-btn--md" to="/">Return to Stracker</Link>
        <Button variant="ghost" onClick={() => void signOut('local')}><LogOut size={15} aria-hidden="true" /> Sign out</Button>
      </div>
    </GateFrame>
  )
}

export function GateError({ message }: { message: string }) {
  const { refresh } = useControlSession()
  return (
    <GateFrame title="The Control Center is unavailable" subtitle={message}>
      <div className="cc-gate__actions">
        <Button variant="primary" onClick={() => void refresh()}>Try again</Button>
      </div>
    </GateFrame>
  )
}

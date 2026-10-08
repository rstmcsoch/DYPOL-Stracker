import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Button, Field } from '../components/ui'
import { AuthScaffold } from '../components/public/AuthScaffold'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabaseConfigured } from '../lib/supabase'
import { usePageMeta } from '../lib/head'

import { MIN_PASSWORD_LENGTH } from '../lib/auth-rules'

/**
 * Password recovery, kept on its existing route. Arriving from the emailed link
 * gives the page a short-lived recovery session, which switches it to the
 * "choose a new password" step; a plain visit offers to send that link instead.
 */
export default function ResetPasswordPage() {
  usePageMeta('Reset your Stracker password', 'Send a secure Stracker password reset link, or choose a new password.')
  const { user, loading: authLoading, sendPasswordReset, updatePassword, error, clearError } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [override, setOverride] = useState<'request' | 'update' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const recoveryLinkPending = typeof window !== 'undefined'
    && /(?:^|[?&#])(code=|access_token=|error_description=|type=recovery)/.test(`${window.location.search}${window.location.hash}`)
  const mode: 'request' | 'update' = override ?? (user ? 'update' : 'request')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    clearError()
    setMessage(null)
    if (mode === 'request') {
      setLoading(true)
      try {
        await sendPasswordReset(email)
        setSent(true)
      } catch (submitError) {
        setMessage(submitError instanceof Error ? submitError.message : 'Could not send the reset link. Try again.')
      } finally {
        setLoading(false)
      }
      return
    }
    if (!user) { setMessage('Open the secure reset link from your email to continue here.'); return }
    if (password.length < MIN_PASSWORD_LENGTH) { setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`); return }
    if (password !== confirmPassword) { setMessage('Those passwords do not match.'); return }
    setLoading(true)
    try {
      await updatePassword(password)
      notify('Your password has been updated.')
      navigate('/', { replace: true })
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : 'Could not save the new password. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const waitForLink = recoveryLinkPending && authLoading

  return <AuthScaffold
    kicker={mode === 'update' ? 'NEW PASSWORD' : 'PASSWORD RESET'}
    title={mode === 'update' ? <>Choose a new <em>password.</em></> : <>Get back into <em>your notebook.</em></>}
    blurb={mode === 'update'
      ? 'Pick something you do not use anywhere else — you will use it the next time you log in.'
      : 'Enter the email you signed up with and Stracker will send a secure reset link. Nothing changes until you open it.'}
    note={mode === 'update' ? 'Secure link verified.' : 'Reset links expire, so use yours soon.'}
  >
    <section className="auth-card" aria-labelledby="reset-title">
      <div className="auth-card-sticker"><KeyRound size={14} aria-hidden="true" /> ACCOUNT RECOVERY</div>

      {waitForLink ? <div className="auth-success">
        <div className="success-circle" aria-hidden="true"><ShieldCheck size={22} /></div>
        <h3>Checking your secure link</h3>
        <p>One moment — Stracker is verifying the reset link before showing the form.</p>
      </div> : sent ? <div className="auth-success">
        <div className="success-circle" aria-hidden="true"><Mail size={22} /></div>
        <h3>Check your inbox</h3>
        <p>If <strong>{email.trim()}</strong> belongs to a Stracker account, a secure reset link is on its way. Open it to choose a new password.</p>
        <div className="auth-success-actions">
          <Button variant="secondary" onClick={() => { setSent(false); clearError() }}>Use another email</Button>
          <Link className="button button-primary" to="/login">Back to log in <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </div> : <>
        <div className="auth-card-head">
          <div className="auth-card-icon" aria-hidden="true"><ShieldCheck size={21} /></div>
          <div>
            <span className="eyebrow">{mode === 'update' ? 'SET A NEW PASSWORD' : 'RECOVERY LINK'}</span>
            <h2 id="reset-title">{mode === 'update' ? 'Choose a new password' : 'Reset your password'}</h2>
          </div>
        </div>

        <form className="form-stack auth-form" onSubmit={submit} noValidate>
          {mode === 'request' && <Field label="Account email" required>
            <span className="input-with-icon">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email" autoComplete="username" required maxLength={320} value={email}
                onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-label="Account email"
              />
            </span>
          </Field>}
          {mode === 'update' && <>
            <Field label="New password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
              <span className="input-with-icon">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password}
                  onChange={event => setPassword(event.target.value)} placeholder="Create a strong password" aria-label="New password"
                />
                <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </span>
            </Field>
            <Field label="Confirm new password" required>
              <span className="input-with-icon">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)} placeholder="Type it once more" aria-label="Confirm new password"
                />
              </span>
            </Field>
          </>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="form-notice" role="status">{message}</div>}
          {mode === 'update' && !user && <div className="form-notice" role="status">Open the secure reset link from your email to continue here.</div>}
          {!supabaseConfigured && <div className="form-error" role="status">Supabase is not configured, so password reset is unavailable in this deployment.</div>}
          <Button type="submit" className="auth-submit" size="lg" loading={loading || authLoading} disabled={!supabaseConfigured || (mode === 'update' && !user)}>
            {mode === 'update' ? 'Save new password' : 'Send reset link'} <ArrowRight size={17} aria-hidden="true" />
          </Button>
          <div className="auth-form-links">
            {mode === 'request'
              ? <button type="button" className="text-button" onClick={() => { clearError(); setMessage(null); setOverride('update') }}>I already have a reset link</button>
              : <button type="button" className="text-button" onClick={() => { clearError(); setMessage(null); setOverride('request') }}>Send me a new link</button>}
            <Link className="text-button" to="/login">Back to log in</Link>
          </div>
        </form>
      </>}

      <div className="auth-card-foot">
        <LockKeyhole size={13} aria-hidden="true" />
        <span>Reset links are single-use and sent only to the account email</span>
      </div>
    </section>
  </AuthScaffold>
}

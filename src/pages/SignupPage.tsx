import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, NotebookPen, UserRound } from 'lucide-react'
import { Button, Field } from '../components/ui'
import { AuthScaffold } from '../components/public/AuthScaffold'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { localPreviewEnabled, supabaseConfigured } from '../lib/supabase'
import { usePageMeta } from '../lib/head'

import { MIN_PASSWORD_LENGTH } from '../lib/auth-rules'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const PERKS = [
  'A ready-made, editable syllabus waiting for you',
  'Two exam dates, a daily study goal, and a plan for today',
  'Private by default: your records belong to your account only'
]

/**
 * Dedicated sign-up page. It creates a real Supabase account through the existing
 * auth client — no local-only or pretend accounts — and then follows whatever the
 * project is configured to require: straight into the notebook when email
 * confirmation is off, or a confirmation step when it is on.
 */
export default function SignupPage() {
  usePageMeta('Create your Stracker account', 'Create a Stracker account to organize exam preparation: syllabus, tests, mistakes, revision, planning and focus sessions.')
  const { signUp, resendConfirmation, error, clearError, loading: authLoading } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const clearFieldError = (key: string) => setFieldErrors(current => {
    if (!current[key]) return current
    const next = { ...current }
    delete next[key]
    return next
  })

  const validate = () => {
    const next: Record<string, string> = {}
    if (!displayName.trim()) next.displayName = 'Tell Stracker what to call you.'
    if (displayName.trim().length > 100) next.displayName = 'Keep the name under 100 characters.'
    if (!email.trim()) next.email = 'Enter the email address you want to sign in with.'
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'That email address does not look complete.'
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    if (confirmPassword !== password) next.confirmPassword = 'Those passwords do not match.'
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    clearError()
    if (!validate()) return
    setLoading(true)
    try {
      const result = await signUp(email, password, displayName)
      if (result.needsEmailConfirmation) setSentTo(email.trim())
      else navigate('/', { replace: true })
    } catch (submitError) {
      notify(submitError instanceof Error ? submitError.message : 'Could not create the account. Try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    if (!sentTo || resending) return
    setResending(true)
    try {
      await resendConfirmation(sentTo)
      notify('Confirmation email sent again. Check your inbox.')
    } catch (resendError) {
      notify(resendError instanceof Error ? resendError.message : 'Could not resend the email. Try again in a moment.', 'error')
    } finally {
      setResending(false)
    }
  }

  return <AuthScaffold
    kicker="CREATE YOUR NOTEBOOK"
    title={<>Start the record <em>on day one.</em></>}
    blurb="Set up your syllabus once, then let every test, mistake, revision and study session land in the same place."
    note="The best time to start keeping the record is before the first test."
  >
    <section className="auth-card" aria-labelledby="signup-title">
      <div className="auth-card-sticker"><NotebookPen size={14} aria-hidden="true" /> A NEW NOTEBOOK</div>
      {sentTo ? <div className="auth-success">
        <div className="success-circle" aria-hidden="true"><Mail size={22} /></div>
        <h3>Confirm your email</h3>
        <p>Your account is created. We sent a confirmation link to <strong>{sentTo}</strong> — open it to activate the notebook, then log in.</p>
        <div className="auth-success-actions">
          <Button variant="secondary" onClick={() => void resend()} loading={resending}>Resend the email</Button>
          <Link className="button button-primary" to="/login">Go to log in <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <p className="auth-success-note">Wrong address? <button type="button" className="text-button" onClick={() => { setSentTo(null); clearError() }}>Use a different email</button></p>
      </div> : <>
        <div className="auth-card-head">
          <div className="auth-card-icon" aria-hidden="true"><UserRound size={21} /></div>
          <div><span className="eyebrow">NEW ACCOUNT</span><h2 id="signup-title">Create your Stracker account</h2></div>
        </div>

        <form className="form-stack auth-form" onSubmit={submit} noValidate>
          <Field label="What should Stracker call you?" required error={fieldErrors.displayName}>
            <span className="input-with-icon">
              <UserRound size={17} aria-hidden="true" />
              <input
                type="text" autoComplete="name" required maxLength={100} value={displayName}
                onChange={event => { setDisplayName(event.target.value); clearFieldError('displayName') }}
                placeholder="Your name" aria-label="Your name"
              />
            </span>
          </Field>
          <Field label="Email" required error={fieldErrors.email}>
            <span className="input-with-icon">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email" autoComplete="email" required maxLength={320} value={email}
                onChange={event => { setEmail(event.target.value); clearFieldError('email') }}
                placeholder="you@example.com" aria-label="Email"
              />
            </span>
          </Field>
          <Field label="Password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={fieldErrors.password}>
            <span className="input-with-icon">
              <LockKeyhole size={17} aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password}
                onChange={event => { setPassword(event.target.value); clearFieldError('password') }}
                placeholder="Create a strong password" aria-label="Password"
              />
              <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
            </span>
          </Field>
          <Field label="Confirm password" required error={fieldErrors.confirmPassword}>
            <span className="input-with-icon">
              <LockKeyhole size={17} aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={confirmPassword}
                onChange={event => { setConfirmPassword(event.target.value); clearFieldError('confirmPassword') }}
                placeholder="Type it once more" aria-label="Confirm password"
              />
            </span>
          </Field>
          <ul className="auth-perks">
            {PERKS.map(perk => <li key={perk}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{perk}</span></li>)}
          </ul>
          {error && <div className="form-error" role="alert">{error}</div>}
          {!supabaseConfigured && !localPreviewEnabled && <div className="form-error" role="status">Supabase is not configured, so accounts cannot be created yet. Add the public project URL and anon key to the deployment environment, then redeploy.</div>}
          <Button type="submit" className="auth-submit" size="lg" loading={loading || authLoading} disabled={!supabaseConfigured}>
            Create my Stracker account <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </form>

        <div className="auth-card-foot auth-switch">
          <span>Already have a notebook?</span>
          <Link className="text-button" to="/login">Log in instead</Link>
        </div>
      </>}
    </section>
  </AuthScaffold>
}

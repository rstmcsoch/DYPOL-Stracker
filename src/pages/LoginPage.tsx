import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { Button, Field } from '../components/ui'
import { AuthScaffold } from '../components/public/AuthScaffold'
import { useAuth } from '../contexts/AuthContext'
import { localPreviewEnabled, supabaseConfigured } from '../lib/supabase'
import { usePageMeta } from '../lib/head'
import { safeAppPath } from '../lib/safe-path'

/**
 * Dedicated log-in page. Registration lives on /signup and password recovery on
 * /reset-password, so each entry point stays a single, obvious task.
 */
export default function LoginPage() {
  usePageMeta('Log in — Stracker', 'Log in to your private Stracker notebook.')
  const { signIn, startLocalPreview, error, clearError, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Where the guard interrupted a request, so a deep link survives the sign-in round trip.
  // Only same-origin paths are replayed — never an absolute or protocol-relative target.
  const requested = typeof location.state === 'object' && location.state && 'from' in location.state
    ? String((location.state as { from?: unknown }).from ?? '/')
    : '/'
  const safeTarget = safeAppPath(requested)
  const destination = safeTarget.startsWith('/login') || safeTarget.startsWith('/signup') || safeTarget.startsWith('/reset-password') ? '/' : safeTarget

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    clearError()
    setLoading(true)
    try {
      await signIn(email, password)
      navigate(destination, { replace: true })
    } catch {
      // The context already exposes a friendly message; nothing else to do here.
    } finally {
      setLoading(false)
    }
  }

  return <AuthScaffold
    kicker="WELCOME BACK"
    title={<>Open your notebook <em>where you left it.</em></>}
    blurb="Your syllabus progress, test history, mistake list, revision queue and today’s plan are exactly where you left them."
    note="One page. One problem. One step forward."
  >
    <section className="auth-card" aria-labelledby="login-title">
      <div className="auth-card-sticker"><Sparkles size={15} aria-hidden="true" /> YOUR NOTEBOOK AWAITS</div>
      <div className="auth-card-head">
        <div className="auth-card-icon" aria-hidden="true"><ShieldCheck size={21} /></div>
        <div><span className="eyebrow">ACCOUNT ACCESS</span><h2 id="login-title">Log in to Stracker</h2></div>
      </div>

      <form className="form-stack auth-form" onSubmit={submit} noValidate>
        <Field label="Email" required>
          <span className="input-with-icon">
            <Mail size={17} aria-hidden="true" />
            <input
              type="email" autoComplete="username" required maxLength={320} value={email}
              onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-label="Email"
            />
          </span>
        </Field>
        <Field label="Password" required>
          <span className="input-with-icon">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'} autoComplete="current-password" required minLength={1} value={password}
              onChange={event => setPassword(event.target.value)} placeholder="Your password" aria-label="Password"
            />
            <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            </button>
          </span>
        </Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!supabaseConfigured && !localPreviewEnabled && <div className="form-error" role="status">Supabase is not configured. Add the public project URL and anon key to the deployment environment, then redeploy.</div>}
        <Button type="submit" className="auth-submit" size="lg" loading={loading || authLoading} disabled={!supabaseConfigured && !localPreviewEnabled}>
          Open my notebook <ArrowRight size={17} aria-hidden="true" />
        </Button>
        <div className="auth-form-links">
          <Link className="text-button" to="/reset-password">Forgot your password?</Link>
          <Link className="text-button" to="/signup">Create an account</Link>
        </div>
      </form>

      {localPreviewEnabled && <div className="local-preview-box">
        <div><span className="preview-dot" aria-hidden="true" /><strong>Building or exploring locally?</strong></div>
        <p>Open a private, on-device preview. Nothing syncs to the cloud.</p>
        <Button variant="secondary" onClick={() => { startLocalPreview(); navigate('/', { replace: true }) }}>Continue on this device</Button>
      </div>}

      <div className="auth-card-foot">
        <LockKeyhole size={13} aria-hidden="true" />
        <span>Secure session · Study records stay private to your account</span>
      </div>
    </section>
  </AuthScaffold>
}

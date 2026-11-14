import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { Button, Field } from '../components/ui'
import { AuthScaffold } from '../components/public/AuthScaffold'
import { GoogleAuthButton } from '../components/GoogleAuthButton'
import { useAuth } from '../contexts/AuthContext'
import { useSiteStatus } from '../components/site/SiteStatusContext'
import { localPreviewEnabled, supabaseConfigured } from '../lib/supabase'
import { usePageMeta } from '../lib/head'
import { safeAppPath } from '../lib/safe-path'
import { noticeTokenUserId, readNoticeToken, type AccountNotice } from '../lib/account-notices'
import { banNoticeForDevice, discardLocalAccountData } from '../lib/account-notices-client'
import { AccountNoticeDialog, BannedSignInBlock } from '../components/AccountNoticeDialog'
import { TurnstileWidget, type TurnstileHandle } from '../components/TurnstileWidget'

/**
 * Dedicated log-in page. Registration lives on /signup and password recovery on
 * /reset-password, so each entry point stays a single, obvious task.
 */
export default function LoginPage() {
  usePageMeta('Log in — Stracker', 'Log in to your private Stracker notebook.')
  const { signIn, startLocalPreview, error, clearError, loading: authLoading, suspension, clearSuspension } = useAuth()
  const { status: siteStatus } = useSiteStatus()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const captcha = useRef<TurnstileHandle>(null)

  // Where the guard interrupted a request, so a deep link survives the sign-in round trip.
  // Only same-origin paths are replayed — never an absolute or protocol-relative target.
  const requested = typeof location.state === 'object' && location.state && 'from' in location.state
    ? String((location.state as { from?: unknown }).from ?? '/')
    : '/'
  const safeTarget = safeAppPath(requested)
  const destination = safeTarget.startsWith('/login') || safeTarget.startsWith('/signup') || safeTarget.startsWith('/reset-password') ? '/' : safeTarget

  // A banned account: the popup once per refusal, and the block under the password field.
  // `banned.notice` null = refused by Google for a ban we cannot explain to this device.
  const [banned, setBanned] = useState<{ notice: AccountNotice | null } | null>(null)
  const [popup, setPopup] = useState(false)
  const arrival = typeof location.state === 'object' && location.state !== null ? location.state as { suspended?: unknown; from?: unknown } : {}
  const arrivedFrom = arrival.suspended === 'google' ? 'google' : arrival.suspended === 'app' || arrival.suspended === true ? 'app' : 'from' in arrival ? 'session' : null
  useEffect(() => {
    // Google refused a banned account, the dashboard just signed a banned account out, or a session
    // ended (a ban stops token refresh). The signed device token explains the ban if this device
    // last held the account; one small check, and only on these arrivals.
    if (!arrivedFrom) return
    const token = readNoticeToken()
    if (!token && arrivedFrom !== 'google') return
    let active = true
    void banNoticeForDevice().then(async notice => {
      if (!active) return
      if (!notice && arrivedFrom !== 'google') return
      if (notice) await discardLocalAccountData(noticeTokenUserId(token))
      setBanned({ notice })
      // The dashboard already showed the popup before signing out; every other arrival gets it here.
      if (arrivedFrom !== 'app') setPopup(true)
    }).catch(() => undefined)
    return () => { active = false }
  }, [arrivedFrom])
  useEffect(() => {
    if (!suspension) return
    setBanned({ notice: suspension })
    setPopup(true)
  }, [suspension])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    clearError()
    clearSuspension()
    setBanned(null)
    setLoading(true)
    try {
      const captchaToken = await captcha.current?.getToken()
      await signIn(email, password, captchaToken)
      navigate(destination, { replace: true })
    } catch {
      // The context already exposes a friendly message; nothing else to do here.
    } finally {
      // Turnstile tokens are single-use: always start a fresh check for the next attempt.
      captcha.current?.reset()
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

 {!siteStatus.signinEnabled && <div className="form-notice" role="status">Sign-in is paused right now. Please try again later.</div>}
      {supabaseConfigured && <GoogleAuthButton intent="signin" next={destination} disabled={loading} />}

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
        {banned && <BannedSignInBlock notice={banned.notice} />}
        {error && !banned && <div className="form-error" role="alert">{error}</div>}
        {supabaseConfigured && <TurnstileWidget ref={captcha} action="login" />}
        {!supabaseConfigured && !localPreviewEnabled && <div className="form-error" role="status">Supabase is not configured. Add the public project URL and anon key to the deployment environment, then redeploy.</div>}
        <Button type="submit" className="auth-submit" size="lg" loading={loading || authLoading} disabled={!supabaseConfigured && !localPreviewEnabled}>
          Open my notebook <ArrowRight size={17} aria-hidden="true" />
        </Button>
        <div className="auth-form-links">
          <Link className="text-button" to="/reset-password">Forgot your password?</Link>
          {siteStatus.signupEnabled && <Link className="text-button" to="/signup">Create an account</Link>}
        </div>
      </form>

      {localPreviewEnabled && <div className="local-preview-box">
        <div><span className="preview-dot" aria-hidden="true" /><strong>Building or exploring locally?</strong></div>
        <p>Open a private, on-device preview. Nothing syncs to the cloud.</p>
        <Button variant="secondary" onClick={() => { startLocalPreview(); navigate('/', { replace: true }) }}>Continue on this device</Button>
      </div>}

      {popup && banned && <AccountNoticeDialog notice={banned.notice} context="signin" onClose={() => setPopup(false)} />}

      <div className="auth-card-foot">
        <LockKeyhole size={13} aria-hidden="true" />
        <span>Secure session · Study records stay private to your account</span>
      </div>
    </section>
  </AuthScaffold>
}

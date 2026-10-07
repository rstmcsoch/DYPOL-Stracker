import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { Button, Field } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { localPreviewEnabled, supabaseConfigured } from '../lib/supabase'

export default function AuthPage() {
  const { user, signIn, sendPasswordReset, updatePassword, startLocalPreview, error, clearError, loading: authLoading } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const resetRoute = location.pathname === '/reset-password'
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>(resetRoute ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (user && !resetRoute) navigate('/', { replace: true })
  }, [user, resetRoute, navigate])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate('/', { replace: true })
      } else if (mode === 'forgot') {
        await sendPasswordReset(email)
        setSent(true)
      } else {
        if (password.length < 8) throw new Error('Use at least 8 characters for your new password.')
        if (password !== confirmPassword) throw new Error('Those passwords do not match.')
        await updatePassword(password)
        notify('Your password has been updated.')
        navigate('/', { replace: true })
      }
    } catch (submitError) {
      if (submitError instanceof Error && !error) notify(submitError.message, 'error')
    } finally { setLoading(false) }
  }

  return <div className="auth-page">
    <div className="auth-paper-marks" aria-hidden="true"><span>✳</span><span>∿</span><span>✦</span></div>
    <header className="auth-header"><Link to="/" className="brand"><span className="brand-mark"><span>S</span><i>✳</i></span><span className="brand-type">Stracker<small>JEE STUDY HOME</small></span></Link><span className="auth-private"><LockKeyhole size={14} /> PRIVATE NOTEBOOK</span></header>
    <main className="auth-content">
      <div className="auth-intro">
        <div className="auth-kicker"><span className="kicker-scribble">✎</span> YOUR NEXT CHAPTER STARTS HERE</div>
        <h1>Make room for<br /><em>the big ideas.</em></h1>
        <p>A calm place to plan your day, learn from every test, and keep showing up for JEE 2027.</p>
        <div className="auth-doodle-note"><BookOpen size={18} /><span>One page. One problem. One step forward.</span><span className="doodle-star">✦</span></div>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-sticker"><Sparkles size={15} /> YOUR NOTEBOOK AWAITS</div>
        <div className="auth-card-head"><div className="auth-card-icon"><ShieldCheck size={21} /></div><div><span className="eyebrow">OWNER ACCESS</span><h2 id="auth-title">{mode === 'login' ? 'Welcome back' : mode === 'forgot' ? 'Reset your password' : 'Choose a new password'}</h2></div></div>
        {sent ? <div className="auth-success"><div className="success-circle"><Mail size={22} /></div><h3>Check your inbox</h3><p>If that address belongs to the owner account, a secure reset link is on its way. Follow it to set a new password.</p><Button variant="secondary" onClick={() => { setSent(false); setMode('login') }}>Back to sign in</Button></div> : <form className="form-stack auth-form" onSubmit={submit}>
          {mode !== 'reset' && <Field label="Owner email" required><span className="input-with-icon"><Mail size={17} /><input type="email" autoComplete="username" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></span></Field>}
          {mode !== 'forgot' && <Field label={mode === 'reset' ? 'New password' : 'Password'} required hint={mode === 'reset' ? 'Use at least 8 characters.' : undefined}><span className="input-with-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'reset' ? 'new-password' : 'current-password'} required minLength={mode === 'reset' ? 8 : 1} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'reset' ? 'Create a strong password' : 'Your password'} /><button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></Field>}
          {mode === 'reset' && <Field label="Confirm new password" required><span className="input-with-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Type it once more" /></span></Field>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {mode === 'reset' && !user && <div className="form-notice" role="status">Open the secure password-reset link from your email to continue here.</div>}
          {!supabaseConfigured && !localPreviewEnabled && <div className="form-error" role="status">Supabase is not configured. Add the public project URL and anon key to the deployment environment, then redeploy.</div>}
          <Button type="submit" className="auth-submit" size="lg" loading={loading || authLoading} disabled={!supabaseConfigured && !localPreviewEnabled || (mode === 'reset' && !user)}>
            {mode === 'login' ? 'Open my notebook' : mode === 'forgot' ? 'Send reset link' : 'Save new password'}<ArrowRight size={17} />
          </Button>
          {mode === 'login' && <button type="button" className="text-button auth-forgot" onClick={() => { clearError(); setMode('forgot') }}>Forgot your password?</button>}
          {mode !== 'login' && <button type="button" className="text-button auth-forgot" onClick={() => { clearError(); setMode('login'); setSent(false) }}>Back to sign in</button>}
        </form>}
        {mode === 'login' && !sent && <div className="auth-footnote"><LockKeyhole size={13} /> Secure owner access · No public registration</div>}
        {mode === 'login' && localPreviewEnabled && <div className="local-preview-box"><div><span className="preview-dot" /><strong>Building or exploring locally?</strong></div><p>Open a private, on-device preview. Nothing syncs to the cloud.</p><Button variant="secondary" onClick={() => { startLocalPreview(); navigate('/', { replace: true }) }}>Continue on this device</Button></div>}
        {mode === 'login' && supabaseConfigured && <div className="auth-setup-note">Owner account provisioning is intentionally private. The first owner is created in Supabase; public sign-up stays disabled.</div>}
      </section>
    </main>
    <footer className="auth-footer"><span className="auth-footer-rule" /><span>Stracker <b>by DYPOL LABS</b></span><span className="auth-footer-rule" /></footer>
  </div>
}

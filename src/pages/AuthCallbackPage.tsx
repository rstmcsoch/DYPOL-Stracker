import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, LoaderCircle, ShieldCheck } from 'lucide-react'
import { AuthScaffold } from '../components/public/AuthScaffold'
import { supabase } from '../lib/supabase'
import { usePageMeta } from '../lib/head'
import { parseOAuthCallbackError, takeOAuthNext, type OAuthCallbackProblem } from '../lib/google-auth'
import { track } from '../lib/telemetry/client'
import { banNoticeForDevice } from '../lib/account-notices-client'
import { signInRefusal } from '../lib/account-notices'

/**
 * Landing page for the Google (OAuth, PKCE) round trip.
 *
 * supabase-js is created with `detectSessionInUrl` and `flowType: 'pkce'`, so on load it
 * exchanges `?code=` for a session using the verifier it stored before leaving. This page
 * waits for that (`getSession()` resolves after the client's initialisation, which includes
 * the exchange), then opens the remembered destination. An `error=` on the URL, or a code that
 * could not be exchanged, shows a friendly message instead of raw provider text.
 */
export default function AuthCallbackPage() {
  usePageMeta('Signing you in — Stracker', 'Finishing sign-in to Stracker.')
  const navigate = useNavigate()
  const [problem, setProblem] = useState<(OAuthCallbackProblem & { detailed?: boolean }) | null>(() => typeof window === 'undefined' ? null : parseOAuthCallbackError(window.location.search, window.location.hash))

  useEffect(() => {
    if (problem) {
      // Drop the error parameters so a reload does not repeat the message.
      window.history.replaceState(null, '', window.location.pathname)
      if (problem.kind === 'suspended' && !problem.detailed) {
        // Google returns no identity for a banned account. If this device last held the
        // account (signed token from the dashboard), the details can be shown safely.
        let active = true
        void banNoticeForDevice().then(notice => {
          if (active && notice) setProblem({ kind: 'suspended', message: signInRefusal(notice), detailed: true })
        }).catch(() => undefined)
        return () => { active = false }
      }
      return
    }
    let active = true
    const finish = async () => {
      if (!supabase) {
        setProblem({ kind: 'unavailable', message: 'Cloud sign-in is not configured for this deployment.' })
        return
      }
      const hadCode = new URLSearchParams(window.location.search).has('code')
      let { data, error } = await supabase.auth.getSession()
      if (!data.session && !error && hadCode) {
        // Initialisation normally completes the exchange; this covers a client that skipped it.
        const code = new URLSearchParams(window.location.search).get('code') ?? ''
        const exchanged = await supabase.auth.exchangeCodeForSession(code)
        data = { session: exchanged.data.session }
        error = exchanged.error
      }
      if (!active) return
      if (data.session) {
        track('login_succeeded')
        navigate(takeOAuthNext(), { replace: true })
        return
      }
      setProblem({
        kind: 'failed',
        message: hadCode
          ? 'This sign-in link has expired or was already used. Start again with Google, or use your email and password.'
          : 'We couldn’t finish signing you in with Google. Please try again, or use your email and password.'
      })
    }
    void finish().catch(() => {
      if (active) setProblem({ kind: 'failed', message: 'We couldn’t reach the sign-in service. Check your connection and try again.' })
    })
    return () => { active = false }
  }, [problem, navigate])

  return <AuthScaffold
    kicker="SIGNING IN"
    title={<>One moment, <em>opening your notebook.</em></>}
    blurb="Stracker is finishing your Google sign-in. Your study records stay private to your account."
  >
    <section className="auth-card auth-callback-card" aria-labelledby="callback-title" aria-live="polite">
      {problem ? <>
        <div className="auth-card-head">
          <div className="auth-card-icon" aria-hidden="true"><AlertCircle size={21} /></div>
          <div><span className="eyebrow">{problem.kind === 'cancelled' ? 'SIGN-IN CANCELLED' : problem.kind === 'suspended' ? 'ACCOUNT SUSPENDED' : 'SIGN-IN NOT FINISHED'}</span><h2 id="callback-title">{problem.kind === 'suspended' ? 'This account can’t sign in' : 'Google sign-in didn’t complete'}</h2></div>
        </div>
        <div className="form-error" role="alert">{problem.message}</div>
        <div className="auth-success-actions auth-callback-actions">
          <Link className="button type-button button-primary button-md" to="/login">Back to log in</Link>
          <Link className="button type-button button-secondary button-md" to="/signup">Create an account with email</Link>
        </div>
      </> : <>
        <div className="auth-card-head">
          <div className="auth-card-icon" aria-hidden="true"><ShieldCheck size={21} /></div>
          <div><span className="eyebrow">SECURE SIGN-IN</span><h2 id="callback-title">Signing you in…</h2></div>
        </div>
        <p className="auth-callback-status" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" /> Checking your Google sign-in</p>
      </>}
    </section>
  </AuthScaffold>
}

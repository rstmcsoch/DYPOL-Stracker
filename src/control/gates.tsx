import { useEffect, useState } from 'react'
import { ShieldCheck, LogOut, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'
import { BrandMark } from './BrandMark'
import { MfaChallengeForm, MfaEnrollment } from './MfaPanels'
import { useControlSession } from './ControlSession'

/**
 * Shared frame for pre-console states: no navigation, no admin data, dark identity.
 *
 * There is deliberately no sign-in form here. The console has no login portal of its own:
 * a visitor without a normal Stracker session, or a signed-in account without an active
 * control role, is sent to the homepage by ControlEntry / ControlRouter. Only a role holder
 * who already signed in through the normal Stracker login reaches the authenticator step.
 */
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
        <li className="is-done"><Check size={14} aria-hidden="true" /> Signed in</li>
        <li className="is-current"><ShieldCheck size={14} aria-hidden="true" /> Authenticator</li>
        <li>Console access</li>
      </ol>
      {mode === 'checking' && <p className="cc-inline-status" role="status">Checking your authenticator settings…</p>}
      {mode === 'enroll' && <MfaEnrollment onVerified={refresh} />}
      {mode === 'challenge' && (
        <>
          <MfaChallengeForm onVerified={refresh} />
          {/* A second authenticator cannot be added before this session is verified (Supabase refuses it),
              so there is no self-service re-enrollment here; lost devices follow the recovery procedure. */}
          <p className="cc-note">Lost the phone with your authenticator? Recovery is done by the owner through Supabase (docs/control-center.md, MFA recovery). There is no bypass on this page.</p>
        </>
      )}
      <div className="cc-gate__signout">
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

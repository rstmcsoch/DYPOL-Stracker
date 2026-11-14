import { useEffect, useState } from 'react'
import { ShieldCheck, LogOut, Check, Fingerprint } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'
import { BrandMark } from './BrandMark'
import { MfaChallengeForm, MfaEnrollment } from './MfaPanels'
import { useControlSession } from './ControlSession'
import { verifyWithOwnerPasskey } from './passkey'

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
      <footer className="cc-gate__footer">Control Centre</footer>
    </main>
  )
}

/**
 * Owner's "Use passkey" option. Shown only when the server says this session belongs to the
 * owner AND a passkey is registered; the server separately refuses passkeys for every other role.
 */
export function PasskeyOption({ onVerified, label = 'Use passkey' }: { onVerified: () => void | Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    const result = await verifyWithOwnerPasskey()
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    await onVerified()
  }
  return (
    <div className="cc-passkey-option">
      <Button variant="primary" onClick={() => void run()} disabled={busy}><Fingerprint size={16} aria-hidden="true" /> {busy ? 'Waiting for your passkey…' : label}</Button>
      {error && <p className="cc-field__error" role="alert">{error}</p>}
      <p className="cc-divider-text" aria-hidden="true"><span>or enter your authenticator code</span></p>
    </div>
  )
}

/** Role holder without a completed second step: enrollment, code, or (owner only) passkey. */
export function MfaGate() {
  const { refresh, signOut, phase } = useControlSession()
  const ownerPasskey = phase.kind === 'mfa' && phase.passkey === true
  const owner = phase.kind === 'mfa' && phase.owner === true
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
    <GateFrame title="Two-step verification" subtitle={ownerPasskey ? 'Verify this session with your passkey or your authenticator app.' : 'Verify this session with your authenticator app.'}>
      <ol className="cc-steps" aria-label="Sign-in progress">
        <li className="is-done"><Check size={14} aria-hidden="true" /> Signed in</li>
        <li className="is-current"><ShieldCheck size={14} aria-hidden="true" /> {ownerPasskey ? 'Passkey or code' : 'Authenticator'}</li>
        <li>Console access</li>
      </ol>
      {mode === 'checking' && <p className="cc-inline-status" role="status">Checking your authenticator settings…</p>}
      {mode === 'enroll' && ownerPasskey && <PasskeyOption onVerified={refresh} label="Use passkey instead" />}
      {mode === 'enroll' && <MfaEnrollment onVerified={refresh} />}
      {mode === 'challenge' && (
        <>
          {ownerPasskey && <PasskeyOption onVerified={refresh} />}
          <MfaChallengeForm onVerified={refresh} />
          {/* A second authenticator cannot be added before this session is verified (Supabase refuses it),
              so there is no self-service re-enrollment here. */}
          <p className="cc-note">{owner ? 'Lost your authenticator? Recover through Supabase.' : 'Lost your authenticator? Ask the owner to reset it.'}</p>
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
    <GateFrame title="The Control Centre is unavailable" subtitle={message}>
      <div className="cc-gate__actions">
        <Button variant="primary" onClick={() => void refresh()}>Try again</Button>
      </div>
    </GateFrame>
  )
}

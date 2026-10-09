import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, QrCode, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, Field, Spinner } from './ui'

const CODE_PATTERN = /^\d{6}$/

interface VerifiedFactor { id: string }

/** Finds the account's verified TOTP factor using Supabase Auth's own factor list. */
async function verifiedTotpFactor(): Promise<VerifiedFactor | null> {
  if (!supabase) throw new Error('Cloud sign-in is not configured.')
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error('Your authenticator settings could not be read. Try again.')
  const factor = data.totp.find(item => item.status === 'verified')
  return factor ? { id: factor.id } : null
}

/**
 * Verifies a 6-digit code from the enrolled authenticator app. Supabase performs the check
 * and upgrades the session to aal2 only when the code is valid. No code is generated here.
 */
export function MfaChallengeForm({ onVerified, submitLabel = 'Verify and continue', heading = 'Enter your authenticator code' }: {
  onVerified: () => void | Promise<void>; submitLabel?: string; heading?: string
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [factorState, setFactorState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const factorId = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    void verifiedTotpFactor().then(factor => {
      if (!active) return
      factorId.current = factor?.id ?? null
      setFactorState(factor ? 'ready' : 'missing')
    }).catch(err => {
      if (active) { setError(err instanceof Error ? err.message : 'Could not read authenticator settings.'); setFactorState('missing') }
    })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!CODE_PATTERN.test(code.trim())) { setError('Enter the 6-digit code shown in your authenticator app.'); return }
    if (!factorId.current || !supabase) { setError('No verified authenticator is enrolled for this account.'); return }
    setBusy(true)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.current, code: code.trim() })
    setBusy(false)
    if (verifyError) {
      setError('That code was not accepted. Use the current code from your authenticator app.')
      setCode('')
      return
    }
    await onVerified()
  }

  if (factorState === 'loading') return <Spinner label="Checking your authenticator…" />
  if (factorState === 'missing') return <p className="cc-note cc-note--warn">No verified authenticator is enrolled. Use the enrollment step.</p>

  return (
    <form className="cc-form" onSubmit={submit} noValidate>
      <h3 className="cc-form__heading"><KeyRound size={18} aria-hidden="true" /> {heading}</h3>
      <Field label="Six-digit code" htmlFor="cc-mfa-code" error={error} hint="Codes change every 30 seconds. Do not share them.">
        <input id="cc-mfa-code" className="cc-input cc-input--code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} autoFocus />
      </Field>
      <div className="cc-form__actions">
        <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : submitLabel}</Button>
      </div>
    </form>
  )
}

/**
 * First-time enrollment. Supabase issues the TOTP secret and QR code for this account; the
 * factor is only enabled after the user proves possession by entering a valid code.
 */
export function MfaEnrollment({ onVerified }: { onVerified: () => void | Promise<void> }) {
  const [state, setState] = useState<{ status: 'starting' } | { status: 'ready'; factorId: string; qr: string; secret: string } | { status: 'failed'; message: string }>({ status: 'starting' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current || !supabase) return
    started.current = true
    const client = supabase
    void (async () => {
      try {
        // Remove abandoned, never-verified TOTP attempts so only the current QR code is valid.
        const { data: list } = await client.auth.mfa.listFactors()
        for (const stale of (list?.all ?? []).filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')) {
          await client.auth.mfa.unenroll({ factorId: stale.id })
        }
        const { data, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Stracker Control Center' })
        if (enrollError || !data?.totp) throw new Error('The authenticator could not be set up. Try again.')
        const qr = data.totp.qr_code.startsWith('data:') ? data.totp.qr_code : `data:image/svg+xml;utf8,${encodeURIComponent(data.totp.qr_code)}`
        setState({ status: 'ready', factorId: data.id, qr, secret: data.totp.secret })
      } catch (err) {
        setState({ status: 'failed', message: err instanceof Error ? err.message : 'The authenticator could not be set up.' })
      }
    })()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (state.status !== 'ready' || !supabase) return
    setError(null)
    if (!CODE_PATTERN.test(code.trim())) { setError('Enter the 6-digit code from your authenticator app.'); return }
    setBusy(true)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code: code.trim() })
    setBusy(false)
    if (verifyError) {
      setError('That code did not match. Check the time on your device and enter the current code.')
      setCode('')
      return
    }
    await onVerified()
  }

  const copySecret = async () => {
    if (state.status !== 'ready') return
    try {
      await navigator.clipboard.writeText(state.secret)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  if (state.status === 'starting') return <Spinner label="Preparing your authenticator setup…" />
  if (state.status === 'failed') return <p className="cc-note cc-note--crit" role="alert">{state.message}</p>

  return (
    <div className="cc-enroll">
      <div className="cc-enroll__qr">
        <img src={state.qr} alt="QR code to add Stracker Control Center to an authenticator app" width={184} height={184} />
        <QrCode size={14} aria-hidden="true" /> <span>Scan with Google Authenticator, 1Password, Authy or another TOTP app.</span>
      </div>
      <div className="cc-enroll__steps">
        <h3>Set up your authenticator</h3>
        <ol>
          <li>Scan the QR code, or enter the setup key manually.</li>
          <li>Enter the six-digit code the app shows to finish enrollment.</li>
        </ol>
        <div className="cc-secret">
          <span>Setup key</span>
          <code aria-label="Manual setup key">{state.secret}</code>
          <Button size="sm" variant="ghost" onClick={copySecret}>{copied ? 'Copied' : 'Copy key'}</Button>
        </div>
        <form className="cc-form" onSubmit={submit} noValidate>
          <Field label="Six-digit code" htmlFor="cc-enroll-code" error={error}>
            <input id="cc-enroll-code" className="cc-input cc-input--code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} disabled={busy} />
          </Field>
          <div className="cc-form__actions">
            <Button variant="primary" type="submit" disabled={busy || code.length !== 6}><ShieldCheck size={16} aria-hidden="true" /> {busy ? 'Verifying…' : 'Activate and continue'}</Button>
          </div>
        </form>
        <p className="cc-note">Lost your device? Recovery does not use a hidden bypass. See the recovery procedure in docs/control-center.md.</p>
      </div>
    </div>
  )
}

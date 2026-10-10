import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LogOut, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { controlFetch, ControlApiError, type AuditRow } from '../api'
import { Badge, Button, Dialog, EmptyState, Panel, Spinner, Skeleton, Stat, ErrorState } from '../ui'
import { PageHeader } from '../pageParts'
import { CONSOLE_BASE, formatRelative, IDLE_TIMEOUT_MS, RECENT_MFA_SECONDS } from '../policy'
import { useControlSession } from '../ControlSession'
import { useSensitiveAction } from '../reauth'
import { AuditTable } from './AuditPage'
import { useToast } from '../../contexts/ToastContext'

interface AuditList { events: AuditRow[]; total: number }
const PRIVILEGED_ACTIONS = new Set(['owner.provisioned', 'user.suspend', 'user.restore', 'audit.export'])

function sevenDaysAgoDate(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default function SecurityPage() {
  const { phase, refresh, signOut } = useControlSession()
  const session = phase.kind === 'granted' ? phase.session : null
  const [confirmGlobal, setConfirmGlobal] = useState(false)
  const [busy, setBusy] = useState(false)
  const sensitive = useSensitiveAction()
  const { notify } = useToast()

  const factors = useQuery({
    queryKey: ['control', 'security', 'factors'],
    queryFn: async () => {
      if (!supabase) throw new Error('Cloud sign-in is not configured.')
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw new Error('Authenticator settings could not be read.')
      return { verified: data.totp.filter(factor => factor.status === 'verified').length }
    }
  })
  const denied = useQuery({
    queryKey: ['control', 'security', 'denied'],
    queryFn: () => controlFetch<AuditList & { page: number }>(`audit?outcome=denied&from=${sevenDaysAgoDate()}&pageSize=10`)
  })
  const changes = useQuery({
    queryKey: ['control', 'security', 'changes'],
    queryFn: async () => {
      const data = await controlFetch<AuditList>('audit?pageSize=100')
      return data.events.filter(event => PRIVILEGED_ACTIONS.has(event.action)).slice(0, 10)
    }
  })

  const verifiedCount = factors.data?.verified ?? 0
  const findings: Array<{ tone: 'ok' | 'warn' | 'info' | 'crit'; title: string; detail: string; to?: string }> = []
  if (factors.data) {
    findings.push(verifiedCount >= 1
      ? { tone: 'ok', title: 'Two-step verification is active', detail: 'This session is verified with an authenticator app, and every console request requires aal2.' }
      : { tone: 'crit', title: 'No verified authenticator', detail: 'Enrollment is required before the console opens.' })
    if (verifiedCount === 1) findings.push({ tone: 'info', title: 'Single authenticator enrolled', detail: 'Keep a second way to recover access (for example a second authenticator device). Recovery is an operator procedure; no codes are issued by the console.' })
  }
  if (denied.data && denied.data.total > 0) findings.push({ tone: 'warn', title: `${denied.data.total} denied console attempt${denied.data.total === 1 ? '' : 's'} in 7 days`, detail: 'Authenticated accounts without the owner role, or sessions without aal2. Review the details below.', to: `${CONSOLE_BASE}/audit?outcome=denied` })
  findings.push({ tone: 'info', title: 'Email delivery is not probed by the console', detail: 'Delivery depends on the Supabase Auth SMTP or provider settings. The health page reports this as unknown rather than healthy.', to: `${CONSOLE_BASE}/health` })

  const signOutEverywhere = async () => {
    setBusy(true)
    try {
      await sensitive(async () => {
        if (!session?.recentMfa) throw new ControlApiError(403, 'reauthentication_required', 'Verify your authenticator code again before signing out every session.')
        if (!supabase) throw new Error('Cloud sign-in is not configured.')
        const { error } = await supabase.auth.signOut({ scope: 'global' })
        if (error) throw new Error('Other sessions could not be ended. Try again.')
      })
      setConfirmGlobal(false)
      notify('Every session for this account has been signed out. You are signed out here too.', 'success')
      await signOut('local')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Sessions could not be ended.', 'error')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Security center" description="Authentication state, administrative sessions, denied access and privileged changes." />

      <div className="cc-kpis cc-kpis--compact">
        <Stat label="Assurance level" value={session?.aal ?? '—'} hint={session?.aal === 'aal2' ? 'Second factor verified' : 'Console requires aal2'} tone={session?.aal === 'aal2' ? 'ok' : 'crit'} />
        <Stat label="Recent verification" value={session?.recentMfa ? 'Within 15 min' : 'Older'} hint={`Sensitive actions need a verification within ${RECENT_MFA_SECONDS / 60} minutes`} tone={session?.recentMfa ? 'ok' : 'warn'} />
        <Stat label="Authenticators" value={factors.isPending ? '…' : factors.isError ? '—' : verifiedCount} hint="Verified TOTP factors on this account" />
        <Stat label="Idle sign-out" value={`${IDLE_TIMEOUT_MS / 60000} min`} hint="Enforced in the browser, with a warning first" />
      </div>

      <div className="cc-grid cc-grid--main">
        <Panel title="Findings" description="Each item has a severity and the next step. Unknown checks are labelled as unknown.">
          {factors.isPending && !factors.data && <Skeleton rows={3} />}
          <ul className="cc-list">
            {findings.map(item => (
              <li key={item.title} className="cc-finding">
                <Badge tone={item.tone === 'info' ? 'info' : item.tone}>{item.tone === 'ok' ? 'Good' : item.tone === 'crit' ? 'Critical' : item.tone === 'warn' ? 'Review' : 'Note'}</Badge>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  {item.to && <Link to={item.to} className="cc-link">Open</Link>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Sessions and sign-out" description="Only this browser can be signed out from here. Sign-out everywhere ends every session on every device for this account.">
          <div className="cc-stack cc-stack--tight">
            <p className="cc-muted">Idle sign-out is enforced in this browser after 20 minutes without activity. Server-side session lists are not exposed by the Supabase Auth API used here.</p>
            <div className="cc-form__actions">
              <Button variant="ghost" onClick={() => void signOut('local')}><LogOut size={15} aria-hidden="true" /> Sign out of this browser</Button>
              <Button variant="danger" onClick={() => setConfirmGlobal(true)}>Sign out everywhere</Button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="cc-grid cc-grid--main">
        <Panel title="Denied attempts (7 days)" description="Authenticated accounts that were refused console access, and sessions that lacked aal2.">
          {denied.isPending && <Skeleton rows={3} />}
          {denied.isError && <ErrorState message="Denied attempts could not be loaded." onRetry={() => void denied.refetch()} />}
          {denied.data && <AuditTable rows={denied.data.events} emptyTitle="No denied attempts in 7 days" emptyBody="Refused console requests will appear here." />}
        </Panel>
        <Panel title="Privileged changes" description="Owner provisioning, account restrictions, restorations and exports (latest 10).">
          {changes.isPending && <Skeleton rows={3} />}
          {changes.isError && <ErrorState message="Privileged changes could not be loaded." onRetry={() => void changes.refetch()} />}
          {changes.data && (changes.data.length === 0 ? <EmptyState title="No privileged changes yet" body="Restrictions, restorations, provisioning and exports are listed here." /> : <AuditTable rows={changes.data} emptyTitle="" emptyBody="" />)}
          <p className="cc-note">Last refreshed {formatRelative(new Date().toISOString())}. <Link to={`${CONSOLE_BASE}/audit`} className="cc-link">Full audit log</Link></p>
        </Panel>
      </div>

      <Panel title="Configured limits" description="These are the values enforced by the server and browser today. They are configuration, not live measurements.">
        <dl className="cc-dl">
          <div><dt>Console API requests</dt><dd>120 per account per minute (server, database-backed)</dd></div>
          <div><dt>Signed-out console requests</dt><dd>60 per client address per minute (hashed, never stored raw)</dd></div>
          <div><dt>Denied-access audit entries</dt><dd>20 per account per 10 minutes (prevents audit flooding)</dd></div>
          <div><dt>Sign-in attempts</dt><dd>Enforced by Supabase Auth’s own rate limits</dd></div>
          <div><dt>Recent verification for sensitive changes</dt><dd>{RECENT_MFA_SECONDS / 60} minutes</dd></div>
        </dl>
      </Panel>

      {confirmGlobal && (
        <Dialog
          title="Sign out every session?"
          description="This ends every browser and app session for this account, including Stracker on other devices. You will need to sign in again."
          onClose={() => setConfirmGlobal(false)}
          busy={busy}
          danger
          footer={<><Button variant="ghost" onClick={() => setConfirmGlobal(false)} disabled={busy}>Cancel</Button><Button variant="danger" onClick={() => void signOutEverywhere()} disabled={busy}>{busy ? <Spinner label="Signing out…" /> : 'Sign out everywhere'}</Button></>}
        >
          <p className="cc-note cc-note--warn"><ShieldCheck size={14} aria-hidden="true" /> A fresh authenticator code is required. If it is missing, you will be asked for one first.</p>
          <p className="cc-muted">Session data stays intact. Only sign-in sessions are ended.</p>
        </Dialog>
      )}
    </>
  )
}

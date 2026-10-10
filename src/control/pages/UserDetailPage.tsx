import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, ShieldOff, ShieldCheck } from 'lucide-react'
import { controlFetch, ControlApiError, type UserDetailResponse } from '../api'
import { Badge, Button, Dialog, EmptyState, Field, Panel, Segmented, Spinner } from '../ui'
import { PageHeader, QueryFrame } from '../pageParts'
import { CONSOLE_BASE, formatDate, formatDateTime, formatRelative } from '../policy'
import { useControlSession } from '../ControlSession'
import { useSensitiveAction } from '../reauth'
import { useToast } from '../../contexts/ToastContext'
import { AuditTable } from './AuditPage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Tab = 'overview' | 'activity' | 'security' | 'audit'

export default function UserDetailPage() {
  const { userId = '' } = useParams()
  const valid = UUID.test(userId)
  const query = useQuery({
    queryKey: ['control', 'user', userId],
    queryFn: () => controlFetch<UserDetailResponse>(`user?id=${encodeURIComponent(userId)}`),
    enabled: valid,
    retry: false
  })

  if (!valid) return <EmptyState title="Account not found" body="That link does not identify an account." action={<Link to={`${CONSOLE_BASE}/users`} className="cc-link">Back to users</Link>} />

  return (
    <>
      <Link to={`${CONSOLE_BASE}/users`} className="cc-back"><ArrowLeft size={15} aria-hidden="true" /> All users</Link>
      <QueryFrame query={query} errorLabel="This account could not be loaded.">
        {data => <UserBody data={data} />}
      </QueryFrame>
    </>
  )
}

function UserBody({ data }: { data: UserDetailResponse }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [dialog, setDialog] = useState<null | 'suspend' | 'restore'>(null)
  const { phase } = useControlSession()
  const self = phase.kind === 'granted' && phase.session.userId === data.user.id
  const u = data.user

  return (
    <>
      <PageHeader
        title={u.displayName || u.email}
        description={u.displayName ? u.email : 'No display name set'}
        actions={
          <>
            {u.suspended ? <Badge tone="crit">Suspended</Badge> : <Badge tone="ok">Active</Badge>}
            {u.emailConfirmedAt ? <Badge tone="ok">Email verified</Badge> : <Badge tone="warn">Email unconfirmed</Badge>}
            {u.adminRole && <Badge tone="info">Admin: {u.adminRole}</Badge>}
            {u.adminRole ? (
              <span className="cc-muted">Administrator accounts cannot be restricted here.</span>
            ) : u.suspended ? (
              <Button variant="primary" onClick={() => setDialog('restore')} disabled={self}><ShieldCheck size={15} aria-hidden="true" /> Restore access</Button>
            ) : (
              <Button variant="danger" onClick={() => setDialog('suspend')} disabled={self}><ShieldOff size={15} aria-hidden="true" /> Suspend sign-in</Button>
            )}
          </>
        }
      />
      {self && <p className="cc-note">This is your own account, so access changes are disabled here.</p>}

      <Segmented<Tab>
        label="Account sections"
        value={tab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Study activity' },
          { value: 'security', label: 'Security' },
          { value: 'audit', label: 'Audit history' }
        ]}
        onChange={setTab}
      />

      <div className="cc-tabpanel" role="region" aria-label={tabLabel(tab)}>
        {tab === 'overview' && (
          <Panel title="Account">
            <dl className="cc-dl">
              <div><dt>Account ID</dt><dd><CopyId id={u.id} /></dd></div>
              <div><dt>Display name</dt><dd>{u.displayName || '—'}</dd></div>
              <div><dt>Email</dt><dd>{u.email || '—'}</dd></div>
              <div><dt>Email verified</dt><dd>{formatDateTime(u.emailConfirmedAt)}</dd></div>
              <div><dt>Registered</dt><dd>{formatDateTime(u.createdAt)}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatDateTime(u.lastSignInAt)} <span className="cc-muted">({formatRelative(u.lastSignInAt)})</span></dd></div>
              <div><dt>Sign-in status</dt><dd>{u.suspended ? `Suspended until ${formatDateTime(u.bannedUntil)}` : 'Active'}</dd></div>
            </dl>
          </Panel>
        )}

        {tab === 'activity' && (
          <Panel title="Study activity" description="Aggregate counts only. Chapter notes, mistake text, test answers and session details are not shown in the console.">
            <div className="cc-kpis cc-kpis--compact">
              <div className="cc-stat"><span className="cc-stat__label">Chapters tracked</span><strong className="cc-stat__value">{data.activity.chapters}</strong></div>
              <div className="cc-stat"><span className="cc-stat__label">Tests logged</span><strong className="cc-stat__value">{data.activity.tests}</strong></div>
              <div className="cc-stat"><span className="cc-stat__label">Mistakes recorded</span><strong className="cc-stat__value">{data.activity.mistakes}</strong></div>
              <div className="cc-stat"><span className="cc-stat__label">Study sessions</span><strong className="cc-stat__value">{data.activity.studySessions}</strong></div>
              <div className="cc-stat"><span className="cc-stat__label">Latest test date</span><strong className="cc-stat__value cc-stat__value--small">{formatDate(data.activity.lastTestDate)}</strong></div>
            </div>
          </Panel>
        )}

        {tab === 'security' && (
          <Panel title="Sign-in and security" description="What this console can and cannot see about the account.">
            <dl className="cc-dl">
              <div><dt>Sign-in provider</dt><dd>{u.provider ?? 'Unknown'}</dd></div>
              <div><dt>Email confirmation</dt><dd>{u.emailConfirmedAt ? `Confirmed ${formatDateTime(u.emailConfirmedAt)}` : 'Not confirmed'}</dd></div>
              <div><dt>Restriction</dt><dd>{u.suspended ? `Sign-in disabled until ${formatDateTime(u.bannedUntil)}` : 'None'}</dd></div>
            </dl>
            <p className="cc-note">Active session lists and per-account failed sign-in history are not available through the Supabase Admin API this console uses. Use the Security center for administrative sign-in events.</p>
          </Panel>
        )}

        {tab === 'audit' && (
          <Panel title="Audit history" description="Every recorded console action that targeted this account.">
            <AuditTable rows={data.audit} emptyTitle="No console actions yet" emptyBody="Viewing, suspension and restoration by administrators are recorded here." />
          </Panel>
        )}
      </div>

      {dialog && <AccessChangeDialog mode={dialog} user={u} onClose={() => setDialog(null)} />}
    </>
  )
}

function tabLabel(tab: Tab): string {
  return { overview: 'Overview', activity: 'Study activity', security: 'Security', audit: 'Audit history' }[tab]
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="cc-copy">
      <code className="cc-mono">{id}</code>
      <button type="button" className="cc-icon-btn" aria-label={copied ? 'Copied' : 'Copy account ID'} onClick={() => { void navigator.clipboard?.writeText(id).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => setCopied(false)) }}>
        <Copy size={14} aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * Suspend or restore. The reason and the typed target email are both required. The server
 * re-checks the email, the owner protection and the recent TOTP verification. This dialog
 * never decides anything on its own.
 */
function AccessChangeDialog({ mode, user, onClose }: { mode: 'suspend' | 'restore'; user: UserDetailResponse['user']; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const sensitive = useSensitiveAction()
  const { notify } = useToast()
  const isSuspend = mode === 'suspend'
  const emailMatches = confirmEmail.trim().toLowerCase() === user.email.toLowerCase()
  const reasonValid = reason.trim().length >= 10

  const mutation = useMutation({
    mutationFn: () => sensitive(() => controlFetch<{ ok: true; status: string; auditRecorded: boolean; note: string }>('user-access', {
      method: 'POST',
      body: { userId: user.id, action: mode, reason: reason.trim(), confirmEmail: confirmEmail.trim() }
    })),
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: ['control', 'user', user.id] })
      await queryClient.invalidateQueries({ queryKey: ['control', 'users'] })
      onClose()
      notify(result.note, 'success')
    },
    onError: err => {
      setError(err instanceof ControlApiError ? err.message : 'The change could not be completed. Nothing was confirmed.')
    }
  })

  return (
    <Dialog
      title={isSuspend ? 'Suspend sign-in' : 'Restore sign-in'}
      description={isSuspend ? 'Disables sign-in for this account. Account data is kept and the change can be reversed.' : 'Allows this account to sign in again.'}
      onClose={onClose}
      busy={mutation.isPending}
      danger={isSuspend}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant={isSuspend ? 'danger' : 'primary'} disabled={!reasonValid || !emailMatches || mutation.isPending} onClick={() => { setError(null); mutation.mutate() }}>
            {mutation.isPending ? <Spinner label="Applying…" /> : isSuspend ? 'Suspend sign-in' : 'Restore sign-in'}
          </Button>
        </>
      }
    >
      <p className="cc-target"><strong>Target:</strong> {user.displayName || 'No display name'} · <span className="cc-mono">{user.id.slice(0, 8)}…</span></p>
      <Field label="Reason (recorded in the audit log)" htmlFor="cc-reason" hint="At least 10 characters. Avoid personal details beyond what the record needs.">
        <textarea id="cc-reason" className="cc-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
      </Field>
      <Field label={`Type the account email to confirm: ${user.email}`} htmlFor="cc-confirm-email" error={confirmEmail && !emailMatches ? 'This does not match the account email.' : null}>
        <input id="cc-confirm-email" className="cc-input" type="email" autoComplete="off" value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} />
      </Field>
      {error && <p className="cc-note cc-note--crit" role="alert">{error}</p>}
      {isSuspend && <p className="cc-note cc-note--warn">An open session stays valid until its current access token expires (about an hour), and it cannot be refreshed.</p>}
    </Dialog>
  )
}


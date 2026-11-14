import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Ban, Copy, ShieldCheck, Trash2 } from 'lucide-react'
import { controlFetch, ControlApiError, type SanctionRow, type UserDetailResponse } from '../api'
import { Badge, Button, Dialog, EmptyState, Field, Panel, Segmented, Spinner } from '../ui'
import { PageHeader, QueryFrame } from '../pageParts'
import { CONSOLE_BASE, formatDate, formatDateTime, formatRelative, zoneShortLabel } from '../policy'
import { useControlSession } from '../ControlSession'
import { useStepUp } from '../reauth'
import { useToast } from '../../contexts/ToastContext'
import { AuditTable } from './AuditPage'
import { useTimeZone } from '../time'
import { BAN_PRESETS, resolveBan, SANCTION_LABELS, type BanChoice, type BanPreset, type DurationUnit } from '../sanctions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Tab = 'overview' | 'activity' | 'sanctions' | 'security' | 'audit'
type SanctionMode = 'warn' | 'ban' | 'unban' | 'delete'

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
  const [dialog, setDialog] = useState<null | SanctionMode>(null)
  const { phase } = useControlSession()
  const self = phase.kind === 'granted' && phase.session.userId === data.user.id
  const { zone } = useTimeZone()
  const u = data.user
  const ban = data.ban ?? null
  const can = data.can ?? { warn: false, ban: false, delete: false }
  const anyAction = can.warn || can.ban || can.delete

  return (
    <>
      <PageHeader
        title={u.displayName || u.email}
        description={u.displayName ? u.email : 'No display name set'}
        actions={
          <>
            {ban ? <Badge tone="crit">{ban.permanent ? 'Banned permanently' : 'Banned'}</Badge> : u.suspended ? <Badge tone="crit">Suspended</Badge> : <Badge tone="ok">Active</Badge>}
            {u.emailConfirmedAt ? <Badge tone="ok">Email verified</Badge> : <Badge tone="warn">Email unconfirmed</Badge>}
            {u.adminRole && <Badge tone="info">Role: {u.adminRole}</Badge>}
          </>
        }
      />
      <div className="cc-user-actions" role="group" aria-label="Account actions">
        {can.warn && <Button onClick={() => setDialog('warn')}><AlertTriangle size={15} aria-hidden="true" /> Warn</Button>}
        {can.ban && (ban
          ? <Button variant="primary" onClick={() => setDialog('unban')}><ShieldCheck size={15} aria-hidden="true" /> Lift ban</Button>
          : <Button variant="danger" onClick={() => setDialog('ban')}><Ban size={15} aria-hidden="true" /> Ban</Button>)}
        {can.delete && <Button variant="danger" onClick={() => setDialog('delete')}><Trash2 size={15} aria-hidden="true" /> Delete account</Button>}
        {!anyAction && <span className="cc-muted">{self ? 'This is your own account, so account actions are disabled here.' : u.adminRole === 'owner' ? 'The owner account cannot be warned, banned or deleted.' : u.adminRole ? 'Account actions need a role above this account’s role.' : 'Your role does not include account actions.'}</span>}
      </div>
      {ban && <p className="cc-note cc-note--crit">Banned {ban.permanent ? 'permanently' : `until ${formatDateTime(ban.until, zone)}`} · Reason: {ban.reason}</p>}

      <Segmented<Tab>
        label="Account sections"
        value={tab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Study activity' },
          { value: 'sanctions', label: 'Warnings and bans' },
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
              <div><dt>Email verified</dt><dd>{formatDateTime(u.emailConfirmedAt, zone)}</dd></div>
              <div><dt>Registered</dt><dd>{formatDateTime(u.createdAt, zone)}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatDateTime(u.lastSignInAt, zone)} <span className="cc-muted">({formatRelative(u.lastSignInAt)})</span></dd></div>
              <div><dt>Sign-in status</dt><dd>{ban ? (ban.permanent ? 'Banned permanently' : `Banned until ${formatDateTime(ban.until, zone)}`) : u.suspended ? `Suspended until ${formatDateTime(u.bannedUntil, zone)}` : 'Active'}</dd></div>
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

        {tab === 'sanctions' && (
          <Panel title="Warnings and bans" description="Every warning, ban and lifted ban on this account, newest first. The student sees each one once on their dashboard.">
            <SanctionHistory rows={data.sanctions ?? []} zone={zone} />
          </Panel>
        )}

        {tab === 'security' && (
          <Panel title="Sign-in and security" description="What this console can and cannot see about the account.">
            <dl className="cc-dl">
              <div><dt>Sign-in provider</dt><dd>{u.provider ?? 'Unknown'}</dd></div>
              <div><dt>Email confirmation</dt><dd>{u.emailConfirmedAt ? `Confirmed ${formatDateTime(u.emailConfirmedAt, zone)}` : 'Not confirmed'}</dd></div>
              <div><dt>Restriction</dt><dd>{ban ? `Banned ${ban.permanent ? 'permanently' : `until ${formatDateTime(ban.until, zone)}`}` : u.suspended ? `Sign-in disabled until ${formatDateTime(u.bannedUntil, zone)}` : 'None'}</dd></div>
            </dl>
            <p className="cc-note">Active session lists and per-account failed sign-in history are not available through the Supabase Admin API this console uses. Use the Security center for administrative sign-in events.</p>
          </Panel>
        )}

        {tab === 'audit' && (
          <Panel title="Audit history" description="Every recorded console action that targeted this account.">
            <AuditTable rows={data.audit} emptyTitle="No console actions yet" emptyBody="Viewing, warnings, bans and deletion by the team are recorded here." />
          </Panel>
        )}
      </div>

      {dialog && <SanctionDialog mode={dialog} user={u} onClose={() => setDialog(null)} />}
    </>
  )
}

function tabLabel(tab: Tab): string {
  return { overview: 'Overview', activity: 'Study activity', sanctions: 'Warnings and bans', security: 'Security', audit: 'Audit history' }[tab]
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

function SanctionHistory({ rows, zone }: { rows: SanctionRow[]; zone: string }) {
  if (rows.length === 0) return <EmptyState title="No warnings or bans" body="This account has a clean record." />
  return (
    <ol className="cc-sanctions">
      {rows.map(row => (
        <li key={row.id} className={`cc-sanction cc-sanction--${row.kind}`}>
          <div className="cc-sanction__head">
            <Badge tone={row.kind === 'ban' ? 'crit' : row.kind === 'warning' ? 'warn' : 'ok'}>{SANCTION_LABELS[row.kind]}</Badge>
            <span>{formatDateTime(row.createdAt, zone)}</span>
            {row.byRole && <span className="cc-muted">by {row.byRole}</span>}
          </div>
          {row.kind === 'ban' && <p className="cc-sanction__meta">{row.permanent ? 'Permanent' : `Until ${formatDateTime(row.until, zone)}`}</p>}
          {row.reason && <p className="cc-sanction__reason">{row.reason}</p>}
          <p className="cc-muted cc-sanction__seen">{row.seenAt ? `Seen by the student ${formatDateTime(row.seenAt, zone)}` : 'Not seen yet'}</p>
        </li>
      ))}
    </ol>
  )
}

const DIALOG_COPY: Record<SanctionMode, { title: string; description: string; submit: string; danger: boolean }> = {
  warn: { title: 'Warn this student', description: 'They see this once on their dashboard and keep full access.', submit: 'Send warning', danger: false },
  ban: { title: 'Ban this account', description: 'Signs them out everywhere at once and blocks sign-in until the ban ends. They see the reason and end time.', submit: 'Ban account', danger: true },
  unban: { title: 'Lift the ban', description: 'They can sign in again straight away and see a short notice.', submit: 'Lift ban', danger: false },
  delete: { title: 'Delete this account permanently', description: 'Removes the sign-in, every study record, AI history, contact messages and stored files. This cannot be undone.', submit: 'Delete permanently', danger: true }
}

/**
 * Warn, ban, lift a ban, or delete. The server re-checks the permission, the rank rules, the
 * typed email (delete) and a fresh step-up for every action. This dialog decides nothing.
 */
function SanctionDialog({ mode, user, onClose }: { mode: SanctionMode; user: UserDetailResponse['user']; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [choice, setChoice] = useState<BanChoice>({ preset: '24h', amount: '2', unit: 'hours', untilLocal: '' })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const stepUp = useStepUp()
  const { notify } = useToast()
  const { zone } = useTimeZone()
  const copy = DIALOG_COPY[mode]
  const reasonRequired = mode === 'warn' || mode === 'ban'
  const reasonValid = !reasonRequired || reason.trim().length >= 5
  const emailMatches = mode !== 'delete' || confirmEmail.trim().toLowerCase() === user.email.toLowerCase()
  const resolved = mode === 'ban' ? resolveBan(choice, zone) : null
  const banError = resolved && 'error' in resolved ? resolved.error : null

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: mode, userId: user.id }
      if (reason.trim()) body.reason = reason.trim()
      if (mode === 'ban' && resolved && !('error' in resolved)) Object.assign(body, resolved)
      if (mode === 'delete') body.confirmEmail = confirmEmail.trim()
      return stepUp(() => controlFetch<{ ok: true }>(`user-sanction?action=${mode}`, { method: 'POST', body }))
    },
    onSuccess: async result => {
      if (result === null) return
      onClose()
      if (mode === 'delete') {
        queryClient.removeQueries({ queryKey: ['control', 'user', user.id] })
        await queryClient.invalidateQueries({ queryKey: ['control', 'users'] })
        notify('The account and its data were deleted.', 'success')
        navigate(`${CONSOLE_BASE}/users`)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['control', 'user', user.id] })
      await queryClient.invalidateQueries({ queryKey: ['control', 'users'] })
      notify(mode === 'warn' ? 'Warning sent.' : mode === 'ban' ? 'Account banned and signed out everywhere.' : 'Ban lifted.', 'success')
    },
    onError: err => {
      setError(err instanceof ControlApiError ? err.message : 'The action could not be completed. Nothing was confirmed.')
    }
  })

  const presetField = (
    <fieldset className="cc-ban-length">
      <legend>Ban length</legend>
      <div className="cc-chip-row">
        {BAN_PRESETS.map(preset => (
          <button key={preset.id} type="button" className={`cc-chip${choice.preset === preset.id ? ' is-active' : ''}`} aria-pressed={choice.preset === preset.id} onClick={() => setChoice(current => ({ ...current, preset: preset.id as BanPreset }))}>
            {preset.label}
          </button>
        ))}
      </div>
      {choice.preset === 'duration' && (
        <div className="cc-inline-fields">
          <input aria-label="Ban length amount" className="cc-input" type="number" min={1} inputMode="numeric" value={choice.amount} onChange={event => setChoice(current => ({ ...current, amount: event.target.value }))} />
          <select aria-label="Ban length unit" className="cc-input" value={choice.unit} onChange={event => setChoice(current => ({ ...current, unit: event.target.value as DurationUnit }))}>
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}
      {choice.preset === 'until' && (
        <input aria-label={`Ban ends (${zone === 'UTC' ? 'UTC' : 'your local time'})`} className="cc-input" type="datetime-local" value={choice.untilLocal} onChange={event => setChoice(current => ({ ...current, untilLocal: event.target.value }))} />
      )}
      <p className="cc-muted cc-ban-length__preview" aria-live="polite">
        {banError ? banError : resolved && 'permanent' in resolved && resolved.permanent ? 'Lasts until someone lifts it.' : resolved && 'until' in resolved ? `Ends ${formatDateTime(resolved.until, zone)} (${zoneLabel(zone)})` : ''}
      </p>
    </fieldset>
  )

  return (
    <Dialog
      title={copy.title}
      description={copy.description}
      onClose={onClose}
      busy={mutation.isPending}
      danger={copy.danger}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant={copy.danger ? 'danger' : 'primary'} disabled={!reasonValid || !emailMatches || Boolean(banError) || mutation.isPending} onClick={() => { setError(null); mutation.mutate() }}>
            {mutation.isPending ? <Spinner label="Applying…" /> : copy.submit}
          </Button>
        </>
      }
    >
      <p className="cc-target"><strong>Account:</strong> {user.displayName || 'No display name'} · {user.email}</p>
      {mode === 'ban' && presetField}
      <Field
        label={reasonRequired ? 'Reason (the student sees this)' : 'Note (optional, kept in the audit log)'}
        htmlFor="cc-sanction-reason"
        hint={reasonRequired ? 'At least 5 characters. Keep it factual and avoid personal details.' : undefined}
      >
        <textarea id="cc-sanction-reason" className="cc-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
      </Field>
      {mode === 'delete' && (
        <Field label={`Type the account email to confirm: ${user.email}`} htmlFor="cc-confirm-email" error={confirmEmail && !emailMatches ? 'This does not match the account email.' : null}>
          <input id="cc-confirm-email" className="cc-input" type="email" autoComplete="off" value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} />
        </Field>
      )}
      <p className="cc-muted">You will confirm again (passkey or authenticator code) before anything changes.</p>
      {error && <p className="cc-note cc-note--crit" role="alert">{error}</p>}
    </Dialog>
  )
}

function zoneLabel(zone: string): string {
  return zone === 'UTC' ? 'UTC' : zoneShortLabel(zone)
}

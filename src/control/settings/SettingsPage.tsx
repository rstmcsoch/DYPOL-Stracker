import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useCurrentTabInView } from '../useCurrentTabInView'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Fingerprint, KeyRound, RotateCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { controlFetch } from '../api'
import { useControlSession } from '../ControlSession'
import { useStepUp } from '../reauth'
import { Badge, Button, Dialog, EmptyState, Field, Panel, Switch } from '../ui'
import { PageHeader, QueryFrame } from '../pageParts'
import { CONSOLE_BASE, formatDateTime } from '../policy'
import { useTimeZone } from '../time'
import { supabase } from '../../lib/supabase'
import {
  EDITABLE_ROLES,
  PERMISSION_DEFINITIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isControlRole,
  type ControlRole,
  type EditableRole,
  type Permission
} from '../../lib/control-permissions'
import { formatIstDaysLeft, type RoleRemovalView } from '../../lib/control-role-governance'
import { describeAuditEvent } from '../../lib/control-audit-catalog'
import { MIN_PASSWORD_LENGTH } from '../../lib/auth-rules'
import { DISPOSABLE_LIST_SOURCES, normalizeDomainInput } from '../../lib/email-domains'
import './role-governance.css'

export interface SiteSettings { maintenanceEnabled: boolean; maintenanceMessage: string; siteDown: boolean; signupEnabled: boolean; signinEnabled: boolean; updatedAt: string | null }
export interface Member { userId: string; email: string; role: string; grantedAt: string; revokedAt: string | null; active: boolean; mfaEnrolled: boolean; overrides: Record<string, 'allow' | 'deny'> }
export interface SettingsResponse {
  me: {
    userId: string
    role: ControlRole
    permissions: Permission[]
    assignableRoles: ControlRole[]
    ownerReadOnly?: boolean
    ownerRemovalStatus?: string | null
  }
  site: SiteSettings
  members: Member[] | null
  removals?: RoleRemovalView[] | null
  matrix: Record<EditableRole, Record<Permission, boolean>> | null
  activity: Array<Record<string, unknown>> | null
  passkeys: { available: boolean; items: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }> } | null
  emailDomains?: EmailDomains | null
}
export interface EmailDomains {
  builtIn: string[]
  allowed: Array<{ domain: string; createdAt: string }>
  blocked: Array<{ domain: string; createdAt: string }>
  list: { count: number; refreshedAt: string | null }
}

type TabId = 'site' | 'access' | 'domains' | 'security' | 'roles' | 'permissions' | 'activity'
interface TabDef { id: TabId; label: string; visible: (me: SettingsResponse['me']) => boolean }
const SETTINGS_TABS: TabDef[] = [
  { id: 'site', label: 'Site status', visible: me => me.permissions.includes('settings.site') },
  { id: 'access', label: 'Sign-up & sign-in', visible: me => me.permissions.includes('settings.access') },
  { id: 'domains', label: 'Email domains', visible: me => me.permissions.includes('settings.domains') },
  { id: 'security', label: 'Security', visible: () => true },
  { id: 'roles', label: 'Roles & members', visible: me => me.permissions.includes('roles.manage') },
  { id: 'permissions', label: 'Permissions', visible: me => me.role === 'owner' },
  { id: 'activity', label: 'Activity', visible: me => me.permissions.includes('audit.view') }
]

const BASE = `${CONSOLE_BASE}/settings`
const QUERY_KEY = ['control', 'settings'] as const

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The change could not be saved.'
}

function passkeyRegistrationErrorMessage(error: unknown): string {
  const obj = error && typeof error === 'object' ? (error as { name?: string; code?: string; message?: string }) : null
  const text = obj ? `${obj.name ?? ''} ${obj.code ?? ''} ${obj.message ?? ''}`.toLowerCase() : String(error ?? '').toLowerCase()
  const host = typeof window !== 'undefined' ? window.location.host : ''
  if (/invalidstateerror|already.*registered|exclude/.test(text)) {
    return 'A passkey for this account is already saved on this device or password manager.'
  }
  if (/securityerror|relying party|rpid|rp id|origin.*not|invalid.*origin|domain/.test(text)) {
    return `This browser blocked passkey setup for ${host || 'this address'}. Open Stracker on https://dypol-stracker.vercel.app (not a preview URL) and check Supabase → Authentication → Passkeys (Relying Party ID: dypol-stracker.vercel.app).`
  }
  if (/notsupportederror|not supported/.test(text)) {
    return 'This browser profile does not support passkey creation. Check your device screen lock and Chrome password manager settings.'
  }
  if (/abort|cancel|notallowed|not allowed/.test(text)) {
    return 'The passkey prompt was closed or denied by the browser. Click “Create passkey now” again, or check that your device screen lock is enabled.'
  }
  return 'The passkey was not added. Your device cancelled it, passkeys are off in Supabase, or Supabase wants this session confirmed with your authenticator code: confirm with the code and try again.'
}

/** One save = one fresh confirmation. Returns a status line for the form. */
function useSave() {
  const stepUp = useStepUp()
  const client = useQueryClient()
  const [state, setState] = useState<{ busy: boolean; message: string | null; tone: 'ok' | 'crit' }>({ busy: false, message: null, tone: 'ok' })
  const run = async (body: Record<string, unknown>, success: string): Promise<boolean> => {
    setState({ busy: true, message: null, tone: 'ok' })
    try {
      const result = await stepUp(() => controlFetch<Record<string, unknown>>('settings', { method: 'POST', body }))
      if (result === null) { setState({ busy: false, message: 'Cancelled. Nothing was saved.', tone: 'crit' }); return false }
      await client.invalidateQueries({ queryKey: QUERY_KEY })
      setState({ busy: false, message: success, tone: 'ok' })
      return true
    } catch (error) {
      setState({ busy: false, message: errorText(error), tone: 'crit' })
      return false
    }
  }
  return { ...state, run }
}

function SaveStatus({ message, tone }: { message: string | null; tone: 'ok' | 'crit' }) {
  if (!message) return null
  return <p className={`cc-note ${tone === 'ok' ? 'cc-note--ok' : 'cc-note--crit'}`} role={tone === 'ok' ? 'status' : 'alert'}>{message}</p>
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint: ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="cc-toggle-row">
    <Switch id={id} checked={checked} disabled={disabled} onChange={onChange} labelledBy={`${id}-label`} describedBy={`${id}-hint`} />
    <span><label htmlFor={id} id={`${id}-label`}><strong>{label}</strong></label><small className="cc-muted" id={`${id}-hint`}> {hint}</small></span>
  </div>
}

const STEP_UP_NOTE = 'Saving asks you to confirm again: a fresh authenticator code (the owner can also use a passkey).'

export default function SettingsPage() {
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => controlFetch<SettingsResponse>('settings'), staleTime: 15_000 })
  return <>
    <PageHeader title="Settings" description="Site status, sign-up and sign-in, your security, team roles and permissions. Every save is confirmed again before it is applied." />
    <QueryFrame query={query} errorLabel="Settings could not be loaded.">
      {data => <SettingsTabs data={data} />}
    </QueryFrame>
  </>
}

function SettingsTabs({ data }: { data: SettingsResponse }) {
  const tabs = SETTINGS_TABS.filter(tab => tab.visible(data.me))
  const first = tabs[0]?.id ?? 'security'
  const navRef = useRef<HTMLElement>(null)
  useCurrentTabInView(navRef)

  const ownerReadOnly = data.me.ownerReadOnly === true
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (ownerReadOnly) {
      document.documentElement.dataset.ccOwnerReadonly = 'true'
    } else {
      delete document.documentElement.dataset.ccOwnerReadonly
    }
    return () => {
      delete document.documentElement.dataset.ccOwnerReadonly
    }
  }, [ownerReadOnly])

  return <>
    {ownerReadOnly && (
      <div className="cc-readonly-banner" role="alert">
        <div className="cc-readonly-banner__body">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Read-only mode active.</strong>{' '}
            {data.me.ownerRemovalStatus === 'review_restore'
              ? 'Your 2-day Owner restore review is running (IST). Full Owner access will return automatically when the countdown ends — no one can pause or cancel this process.'
              : 'Your 30-day Owner removal countdown is active (IST). You can view the entire Control Centre, but all edits are locked. To reclaim your Owner role, open Roles & members and submit a restore review.'}
          </div>
        </div>
        <NavLink className="cc-readonly-banner__link" to={`${BASE}/roles`}>Go to Roles &amp; members →</NavLink>
      </div>
    )}
    <nav className="cc-tabs" aria-label="Settings sections" ref={navRef}>
      {tabs.map(tab => <NavLink key={tab.id} to={`${BASE}/${tab.id}`} className={({ isActive }) => `cc-tabs__link${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>)}
    </nav>
    <Routes>
      <Route index element={<Navigate to={`${BASE}/${first}`} replace />} />
      {tabs.map(tab => <Route key={tab.id} path={tab.id} element={<TabBody id={tab.id} data={data} readOnly={ownerReadOnly} />} />)}
      <Route path="*" element={<Navigate to={`${BASE}/${first}`} replace />} />
    </Routes>
  </>
}

function TabBody({ id, data, readOnly }: { id: TabId; data: SettingsResponse; readOnly: boolean }) {
  switch (id) {
    case 'site': return <SiteTab site={data.site} readOnly={readOnly} />
    case 'access': return <AccessTab site={data.site} readOnly={readOnly} />
    case 'domains': return <EmailDomainsTab domains={data.emailDomains ?? null} readOnly={readOnly} />
    case 'security': return <SecurityTab data={data} readOnly={readOnly} />
    case 'roles': return <RolesTab data={data} readOnly={readOnly} />
    case 'permissions': return <PermissionsTab data={data} readOnly={readOnly} />
    case 'activity': return <ActivityTab data={data} />
  }
}

function SiteTab({ site, readOnly }: { site: SiteSettings; readOnly: boolean }) {
  const [maintenance, setMaintenance] = useState(site.maintenanceEnabled)
  const [down, setDown] = useState(site.siteDown)
  const [message, setMessage] = useState(site.maintenanceMessage)
  const save = useSave()
  const locked = readOnly || save.busy
  const dirty = maintenance !== site.maintenanceEnabled || down !== site.siteDown || message !== site.maintenanceMessage
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (readOnly) return
    void save.run({ action: 'site.update', maintenanceEnabled: maintenance, siteDown: down, maintenanceMessage: message }, down ? 'Saved. The site is now down for visitors and students.' : 'Saved.')
  }
  return <Panel title="Site status" description="What visitors and students see. The Control Centre and team sign-in keep working in every mode.">
    <form className="cc-form" onSubmit={submit}>
      <p className="cc-inline-status">Now: {site.siteDown ? <Badge tone="crit">Site down</Badge> : site.maintenanceEnabled ? <Badge tone="warn">Maintenance notice</Badge> : <Badge tone="ok">Live</Badge>}</p>
      <Toggle id="set-maint" label="Maintenance notice" hint="A thin banner with your message on every public and student page. Everything keeps working." checked={maintenance} onChange={setMaintenance} disabled={locked} />
      <Toggle id="set-down" label="Site down (full outage)" hint="Public pages and student notebooks show a maintenance page. Log in stays open so the team can sign in; students who sign in see the maintenance page. Student AI chat and the contact form are refused by the server." checked={down} onChange={setDown} disabled={locked} />
      <Field label="Message" htmlFor="set-message" hint="Up to 500 characters. Leave empty for the default message.">
        <textarea id="set-message" className="cc-input" rows={3} maxLength={500} value={message} onChange={event => setMessage(event.target.value)} disabled={locked} placeholder="Stracker is down for maintenance. Please check back soon." />
      </Field>
      {down && !site.siteDown && <p className="cc-note cc-note--warn">Turning the site down hides Stracker from every student until you turn it back up.</p>}
      <div className="cc-form__actions"><Button type="submit" variant={down ? 'danger' : 'primary'} disabled={!dirty || locked}><ShieldCheck size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Save site status'}</Button></div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </form>
  </Panel>
}

function AccessTab({ site, readOnly }: { site: SiteSettings; readOnly: boolean }) {
  const [signup, setSignup] = useState(site.signupEnabled)
  const [signin, setSignin] = useState(site.signinEnabled)
  const save = useSave()
  const locked = readOnly || save.busy
  const dirty = signup !== site.signupEnabled || signin !== site.signinEnabled
  return <Panel title="Sign-up and sign-in" description="Pause new accounts or student sign-ins. Team members with a role can always sign in.">
    <form className="cc-form" onSubmit={event => { event.preventDefault(); if (readOnly) return; void save.run({ action: 'access.update', signupEnabled: signup, signinEnabled: signin }, 'Saved.') }}>
      <Toggle id="set-signup" label="Allow new sign-ups" hint="Off: the sign-up page says sign-ups are paused, and Supabase itself refuses to create any new account (email or Google)." checked={signup} onChange={setSignup} disabled={locked} />
      <Toggle id="set-signin" label="Allow student sign-in" hint="Off: the log-in page says sign-in is paused, and Supabase refuses new sign-ins for accounts without a team role. People already signed in stay signed in." checked={signin} onChange={setSignin} disabled={locked} />
      <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={!dirty || locked}><ShieldCheck size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Save switches'}</Button></div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </form>
  </Panel>
}

function useSignInMethods(): string[] {
  const [methods, setMethods] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void supabase?.auth.getUser().then(({ data }) => {
      if (!active) return
      const providers = new Set((data.user?.identities ?? []).map(identity => identity.provider))
      setMethods([...providers].map(provider => provider === 'email' ? 'Email and password' : provider === 'google' ? 'Google' : provider))
    })
    return () => { active = false }
  }, [])
  return methods
}

function usePasskeysEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
    if (!url || !key) { setEnabled(false); return }
    let active = true
    void fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: key }, cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ passkeys_enabled?: boolean }> : null)
      .then(body => { if (active) setEnabled(body?.passkeys_enabled === true) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [])
  return enabled
}

function SecurityTab({ data, readOnly }: { data: SettingsResponse; readOnly: boolean }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const save = useSave()
  const locked = readOnly || save.busy
  const methods = useSignInMethods()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (readOnly) return
    setFormError(null)
    if (password.length < MIN_PASSWORD_LENGTH) { setFormError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return }
    if (password !== confirm) { setFormError('The two passwords do not match.'); return }
    const ok = await save.run({ action: 'password.change', password }, 'Password changed. Use it next time you sign in.')
    if (ok) { setPassword(''); setConfirm('') }
  }
  return <>
    <Panel title="Your sign-in methods" description="Both open the same account. The console checks your role by account, never by how you signed in.">
      <p>{methods.length ? methods.map(method => <Badge key={method} tone="neutral">{method}</Badge>) : <span className="cc-muted">Checking…</span>}</p>
      <p className="cc-muted">Google links itself to this account automatically the first time you use “Continue with Google” with the same email address.</p>
    </Panel>
    <Panel title="Change your password" description="For your own account. The new password is sent once to the server over HTTPS and is never stored or logged by Stracker.">
      <form className="cc-form" onSubmit={event => void submit(event)} noValidate>
        <Field label="New password" htmlFor="set-pw" error={null} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <input id="set-pw" className="cc-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={locked} />
        </Field>
        <Field label="Confirm new password" htmlFor="set-pw2" error={formError}>
          <input id="set-pw2" className="cc-input" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={locked} />
        </Field>
        <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={locked || !password}><KeyRound size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Change password'}</Button></div>
        <p className="cc-muted">{STEP_UP_NOTE} Forgot it? Use “Forgot your password?” on the Stracker log-in page.</p>
        <SaveStatus message={save.message} tone={save.tone} />
      </form>
    </Panel>
    {data.me.role === 'owner' && <PasskeysPanel data={data} readOnly={readOnly} />}
  </>
}

function PasskeysPanel({ data, readOnly }: { data: SettingsResponse; readOnly: boolean }) {
  const enabled = usePasskeysEnabled()
  const stepUp = useStepUp()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [status, setStatus] = useState<{ message: string; tone: 'ok' | 'crit' } | null>(null)
  const items = data.passkeys?.items ?? []
  const locked = readOnly || busy

  // Step 1: verify step-up with the server. Step 2 (`registerNow`) runs from a dedicated click
  // button so Chrome/Chromium always has a fresh transient user activation for navigator.credentials.create().
  const authorize = async () => {
    if (!supabase || readOnly) return
    setBusy(true); setStatus(null)
    try {
      const allowed = await stepUp(() => controlFetch('settings', { method: 'POST', body: { action: 'passkey.authorize' } }))
      if (allowed === null) { setStatus({ message: 'Cancelled.', tone: 'crit' }); return }
      setAuthorized(true)
      setStatus({ message: 'Confirmed. Click “Create passkey now” so your browser opens the passkey prompt.', tone: 'ok' })
    } catch (error) {
      setStatus({ message: errorText(error), tone: 'crit' })
    } finally { setBusy(false) }
  }

  const registerNow = async () => {
    if (!supabase || readOnly) return
    if (typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'undefined') {
      setStatus({ message: 'This browser cannot create passkeys here. Open Stracker over HTTPS in a supported browser.', tone: 'crit' })
      return
    }
    setBusy(true); setStatus(null)
    try {
      const { error } = await supabase.auth.registerPasskey()
      if (error) { setStatus({ message: passkeyRegistrationErrorMessage(error), tone: 'crit' }); return }
      setAuthorized(false)
      await client.invalidateQueries({ queryKey: QUERY_KEY })
      setStatus({ message: 'Passkey added. Next time, choose “Use passkey” on the two-step screen or when confirming a save.', tone: 'ok' })
    } catch (error) {
      setStatus({ message: passkeyRegistrationErrorMessage(error), tone: 'crit' })
    } finally { setBusy(false) }
  }

  const remove = async (passkeyId: string) => {
    if (readOnly) return
    setBusy(true); setStatus(null)
    try {
      const done = await stepUp(() => controlFetch('settings', { method: 'POST', body: { action: 'passkey.delete', passkeyId } }))
      if (done !== null) { await client.invalidateQueries({ queryKey: QUERY_KEY }); setStatus({ message: 'Passkey removed.', tone: 'ok' }) }
    } catch (error) {
      setStatus({ message: errorText(error), tone: 'crit' })
    } finally { setBusy(false) }
  }

  return <Panel title="Passkeys (owner)" description="Only the owner can have passkeys. Use one (fingerprint, face or device PIN) instead of the authenticator code on the two-step screen and to confirm settings saves. Your authenticator code keeps working too.">
    {enabled === false && <p className="cc-note cc-note--warn">Passkeys are switched off for this Supabase project. Turn them on in Supabase → Authentication → Passkeys, with the site address dypol-stracker.vercel.app, then come back here.</p>}
    {items.length === 0 ? <p className="cc-muted">No passkeys yet.</p> : <ul className="cc-list">
      {items.map(item => <li key={item.id} className="cc-list__row">
        <span><Fingerprint size={15} aria-hidden="true" /> {item.name} <small className="cc-muted">added {formatDateTime(item.createdAt)}{item.lastUsedAt ? `, last used ${formatDateTime(item.lastUsedAt)}` : ''}</small></span>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => void remove(item.id)}><Trash2 size={14} aria-hidden="true" /> Remove</Button>
      </li>)}
    </ul>}
    <div className="cc-form__actions">
      {authorized ? <>
        <Button variant="primary" disabled={locked} onClick={() => void registerNow()}><Fingerprint size={15} aria-hidden="true" /> {busy ? 'Opening passkey prompt…' : 'Create passkey now'}</Button>
        <Button variant="ghost" disabled={locked} onClick={() => { setAuthorized(false); setStatus(null) }}>Cancel</Button>
      </> : (
        <Button variant="primary" disabled={locked || enabled !== true} onClick={() => void authorize()}><Fingerprint size={15} aria-hidden="true" /> {busy ? 'Working…' : 'Add a passkey on this device'}</Button>
      )}
    </div>
    {status && <SaveStatus message={status.message} tone={status.tone} />}
  </Panel>
}

function RolesTab({ data, readOnly }: { data: SettingsResponse; readOnly: boolean }) {
  const { zone } = useTimeZone()
  const members = data.members ?? []
  const removals = data.removals ?? []
  const assignable = data.me.assignableRoles
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ControlRole>(assignable.includes('moderator') ? 'moderator' : assignable[0] ?? 'viewer')
  const [removing, setRemoving] = useState<Member | null>(null)
  const [confirmOwnerConsent, setConfirmOwnerConsent] = useState<RoleRemovalView | null>(null)
  const save = useSave()
  const active = members.filter(member => member.active)
  const past = members.filter(member => !member.active)
  const openRemovalByTarget = useMemo(() => new Map(removals.map(item => [item.targetUserId, item])), [removals])

  // Owners NEVER see a role-change dropdown on another owner — every active owner gets the
  // exact same green Owner tag simultaneously, and the server refuses changing any owner's role.
  const canChangeRole = (member: Member) =>
    !readOnly &&
    member.userId !== data.me.userId &&
    isControlRole(member.role) &&
    member.role !== 'owner' &&
    assignable.includes(member.role) &&
    !openRemovalByTarget.has(member.userId)

  const canRequestRemoval = (member: Member) =>
    !readOnly &&
    member.userId !== data.me.userId &&
    isControlRole(member.role) &&
    assignable.includes(member.role) &&
    !openRemovalByTarget.has(member.userId)

  const give = async (event: FormEvent) => {
    event.preventDefault()
    if (readOnly) return
    if (await save.run({ action: 'role.assign', email: email.trim(), role }, `Role given. The next time they open the Control Centre they must set up their own authenticator first.`)) setEmail('')
  }

  return <>
    <Panel title="Give a role" description="The person must already have a Stracker account. They sign in to Stracker normally, then open the Control Centre and set up their own authenticator before anything else.">
      <form className="cc-form cc-form--inline" onSubmit={event => void give(event)}>
        <Field label="Their Stracker email" htmlFor="role-email"><input id="role-email" className="cc-input" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} disabled={readOnly || save.busy} required /></Field>
        <Field label="Role" htmlFor="role-pick">
          <select id="role-pick" className="cc-input" value={role} onChange={event => setRole(event.target.value as ControlRole)} disabled={readOnly || save.busy}>
            {assignable.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
          </select>
        </Field>
        <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={readOnly || save.busy || !email.trim()}><UserPlus size={15} aria-hidden="true" /> Give role</Button></div>
      </form>
      <p className="cc-muted">{ROLE_DESCRIPTIONS[role]} {STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </Panel>

    <Panel title="Team" description="Owners cannot change another owner’s role. Removing an owner requires that owner’s explicit confirmation and starts a 30-day IST countdown with read-only access. Removing any other role requires unanimous approval from all active owners and runs a 7-day IST countdown.">
      {active.length === 0 ? <EmptyState title="No team members" body="Give a role above." /> : <div className="cc-table-wrap" tabIndex={0}>
        <table className="cc-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Authenticator</th><th scope="col">Since</th><th scope="col"><span className="cc-sr-only">Actions</span></th></tr></thead>
          <tbody>{active.map(member => {
            const pendingRemoval = openRemovalByTarget.get(member.userId)
            return <tr key={member.userId}>
              <td>{member.email || member.userId.slice(0, 8)}{member.userId === data.me.userId && <> <Badge tone="neutral">You</Badge></>}</td>
              <td>{canChangeRole(member) ? <select aria-label={`Role of ${member.email}`} className="cc-input cc-input--sm" value={member.role} disabled={save.busy} onChange={event => void save.run({ action: 'role.assign', email: member.email, role: event.target.value }, 'Role changed.')}>
                {assignable.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
              </select> : <Badge tone={member.role === 'owner' ? 'ok' : 'neutral'}>{isControlRole(member.role) ? ROLE_LABELS[member.role] : member.role}</Badge>}</td>
              <td>{member.mfaEnrolled ? <Badge tone="ok">Set up</Badge> : <Badge tone="warn">Not yet</Badge>}</td>
              <td>{formatDateTime(member.grantedAt, zone)}</td>
              <td>{pendingRemoval
                ? <Badge tone={pendingRemoval.status === 'review_restore' ? 'ok' : 'warn'}>
                    {pendingRemoval.status === 'review_restore'
                      ? 'Restoring'
                      : pendingRemoval.status === 'countdown'
                        ? formatIstDaysLeft(pendingRemoval.daysRemaining ?? 0)
                        : 'Pending removal'}
                  </Badge>
                : canRequestRemoval(member) && <Button size="sm" variant="danger" disabled={save.busy} onClick={() => setRemoving(member)}>Remove role</Button>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>}
      {past.length > 0 && <details className="cc-disclosure"><summary>Removed ({past.length})</summary><ul className="cc-list">{past.map(member => <li key={member.userId}>{member.email || member.userId.slice(0, 8)} · was {isControlRole(member.role) ? ROLE_LABELS[member.role] : member.role} · removed {formatDateTime(member.revokedAt, zone)}</li>)}</ul></details>}
    </Panel>

    <div className="cc-restore-zone">
      <Panel
        title="Pending & scheduled removals"
        description="Countdowns run in Indian Standard Time (IST) and count whole days only. Owner removals need the targeted owner’s confirmation (30 days, read-only, with an unstoppable 2-day self-restore review). Non-owner removals need every active owner’s approval (7 days)."
      >
        {removals.length === 0 ? (
          <p className="cc-muted">No pending or scheduled role removals right now.</p>
        ) : (
          <ul className="cc-removals-list">
            {removals.map(item => {
              const roleLabel = isControlRole(item.targetRole) ? ROLE_LABELS[item.targetRole] : item.targetRole
              const isOwnerTarget = item.targetRole === 'owner'
              const cardClass = item.status === 'review_restore'
                ? 'cc-removal-card cc-removal-card--restore'
                : isOwnerTarget
                  ? 'cc-removal-card cc-removal-card--owner'
                  : 'cc-removal-card'
              return (
                <li key={item.id} className={cardClass}>
                  <div className="cc-removal-card__info">
                    <div className="cc-removal-card__head">
                      <strong>{item.targetEmail || item.targetUserId.slice(0, 8)}</strong>
                      <Badge tone={isOwnerTarget ? 'ok' : 'neutral'}>{roleLabel}</Badge>
                      {item.status === 'pending_approval' && isOwnerTarget && (
                        <Badge tone="warn">Awaiting owner consent</Badge>
                      )}
                      {item.status === 'pending_approval' && !isOwnerTarget && (
                        <Badge tone="warn">Approvals: {item.approvedCount} / {item.requiredApprovers} owners</Badge>
                      )}
                      {item.status === 'countdown' && (
                        <Badge tone={isOwnerTarget ? 'crit' : 'warn'}>
                          <Clock size={12} aria-hidden="true" /> {formatIstDaysLeft(item.daysRemaining ?? 0)} (IST)
                        </Badge>
                      )}
                      {item.status === 'review_restore' && (
                        <Badge tone="ok">
                          <CheckCircle2 size={12} aria-hidden="true" /> Restoring in {formatIstDaysLeft(item.restoreDaysRemaining ?? 0)} (IST)
                        </Badge>
                      )}
                    </div>
                    <p className="cc-removal-card__meta">
                      {item.status === 'pending_approval' && isOwnerTarget && (
                        <>Requested by {item.initiatedByEmail || 'an owner'}. Nothing changes until the targeted owner accepts their removal.</>
                      )}
                      {item.status === 'pending_approval' && !isOwnerTarget && (
                        <>Requested by {item.initiatedByEmail || 'an owner'}. Every active owner ({item.requiredApprovers}) must approve before the 7-day IST countdown starts.</>
                      )}
                      {item.status === 'countdown' && isOwnerTarget && (
                        <>30-day IST countdown active (removal scheduled for {item.effectiveOnIst} IST). Control Centre access is locked to read-only until completion or restore.</>
                      )}
                      {item.status === 'countdown' && !isOwnerTarget && (
                        <>7-day IST countdown active (removal scheduled for {item.effectiveOnIst} IST). Role, authenticator, passkeys, and sessions will end automatically on that date.</>
                      )}
                      {item.status === 'review_restore' && (
                        <>Unstoppable 2-day restore review active (restores automatically on {item.restoreOnIst} IST). No one can pause, cancel, or step down this restore.</>
                      )}
                    </p>
                  </div>
                  <div className="cc-removal-card__actions">
                    {item.canApprove && isOwnerTarget && (
                      <Button size="sm" variant="danger" disabled={save.busy} onClick={() => setConfirmOwnerConsent(item)}>
                        Approve my removal
                      </Button>
                    )}
                    {item.canApprove && !isOwnerTarget && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={save.busy}
                        onClick={() => void save.run(
                          { action: 'role.removal.approve', removalId: item.id },
                          'Approval recorded.'
                        )}
                      >
                        Approve removal
                      </Button>
                    )}
                    {item.canRequestRestore && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={save.busy}
                        onClick={() => void save.run(
                          { action: 'role.removal.restore_review', removalId: item.id },
                          'Restore review submitted. Your Owner role will be automatically restored after 2 days (IST).'
                        )}
                      >
                        <RotateCcw size={14} aria-hidden="true" /> Submit review to reclaim Owner role
                      </Button>
                    )}
                    {item.status === 'pending_approval' && !readOnly && (data.me.role === 'owner' || item.initiatedBy === data.me.userId) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={save.busy}
                        onClick={() => void save.run(
                          { action: 'role.removal.cancel', removalId: item.id },
                          'Pending removal request cancelled.'
                        )}
                      >
                        Cancel request
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>

    {removing && <Dialog
      danger
      title={`Remove ${removing.email}?`}
      description={removing.role === 'owner'
        ? 'This creates an owner removal request. Nothing changes until this owner explicitly reviews the notice and confirms their own removal, which starts a 30-day IST countdown in read-only mode.'
        : 'This starts a governed removal request. Once every active owner approves it, a 7-day IST countdown begins before their role, authenticator, passkeys, and sessions are revoked. Their student account and study data stay.'}
      onClose={() => setRemoving(null)}
      footer={<>
        <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
        <Button
          variant="danger"
          onClick={() => {
            const target = removing
            setRemoving(null)
            void save.run(
              { action: 'role.remove', userId: target.userId },
              target.role === 'owner'
                ? `Owner removal request sent to ${target.email}. They must approve it before the 30-day IST countdown starts.`
                : `Removal workflow started for ${target.email}.`
            )
          }}
        >
          Remove role
        </Button>
      </>}
    >
      <p className="cc-muted">{STEP_UP_NOTE}</p>
    </Dialog>}

    {confirmOwnerConsent && <Dialog
      danger
      title="Important notice: confirm removing yourself as Owner"
      description="Read carefully before confirming. This action immediately locks your Control Centre editing access."
      onClose={() => setConfirmOwnerConsent(null)}
      footer={<>
        <Button variant="ghost" onClick={() => setConfirmOwnerConsent(null)}>Cancel</Button>
        <Button
          variant="danger"
          onClick={() => {
            const target = confirmOwnerConsent
            setConfirmOwnerConsent(null)
            void save.run(
              { action: 'role.removal.approve', removalId: target.id },
              'Owner removal confirmed. Your 30-day IST countdown has started and your Control Centre access is now read-only.'
            )
          }}
        >
          Confirm my removal
        </Button>
      </>}
    >
      <div className="cc-concern-box">
        <strong>What will happen immediately after you confirm:</strong>
        <ul>
          <li>Your entire Control Centre access will be locked to <strong>read-only mode</strong> (all settings, role changes, user actions, and edits will be blocked and greyed out).</li>
          <li>A <strong>30-day Indian Standard Time (IST) countdown</strong> will begin (counted in whole days only). When it reaches 0 days, your Owner role, authenticator, passkeys, and sessions will be revoked.</li>
          <li>You will still be able to sign in and view everything in the Control Centre during the 30 days.</li>
          <li>If you change your mind during those 30 days, you can open <strong>Settings → Roles &amp; members</strong> and click <strong>Submit review to reclaim Owner role</strong>. After <strong>2 days (IST)</strong>, the system will automatically restore your Owner position — and no one can pause or stop that process.</li>
        </ul>
      </div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
    </Dialog>}
  </>
}

function PermissionsTab({ data, readOnly }: { data: SettingsResponse; readOnly: boolean }) {
  const matrix = data.matrix
  const [role, setRole] = useState<EditableRole>('administrator')
  const [draft, setDraft] = useState<Record<string, boolean>>(() => ({ ...(matrix?.[role] ?? {}) }))
  useEffect(() => { setDraft({ ...(matrix?.[role] ?? {}) }) }, [role, matrix])
  const save = useSave()
  const locked = readOnly || save.busy
  const changed = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([permission, allowed]) => matrix?.[role]?.[permission as Permission] !== allowed)), [draft, matrix, role])
  const members = (data.members ?? []).filter(member => member.active && member.role !== 'owner')
  return <>
    <Panel title="Role permissions" description="What each role can open and change. The Owner always has everything and cannot be restricted. Changes apply on the person’s next request.">
      <div className="cc-segmented" role="tablist" aria-label="Role">
        {EDITABLE_ROLES.map(item => <button key={item} type="button" role="tab" aria-selected={role === item} className={role === item ? 'is-active' : ''} onClick={() => setRole(item)}>{ROLE_LABELS[item]}</button>)}
      </div>
      <p className="cc-muted">{ROLE_DESCRIPTIONS[role]}</p>
      <PermissionList render={definition => <Switch label={`${ROLE_LABELS[role]}: ${definition.label}`} checked={draft[definition.id] === true} disabled={locked} onChange={value => setDraft(current => ({ ...current, [definition.id]: value }))} />} />
      <div className="cc-form__actions"><Button variant="primary" disabled={locked || Object.keys(changed).length === 0} onClick={() => void save.run({ action: 'permissions.role', role, permissions: changed }, `${ROLE_LABELS[role]} permissions saved.`)}><ShieldCheck size={15} aria-hidden="true" /> Save {ROLE_LABELS[role]} permissions</Button></div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </Panel>
    <MemberOverrides members={data.members === null ? [] : members} matrix={matrix} readOnly={readOnly} />
  </>
}

function PermissionList({ render }: { render: (definition: (typeof PERMISSION_DEFINITIONS)[number]) => ReactNode }) {
  return <div className="cc-table-wrap" tabIndex={0}>
    <table className="cc-table">
      <thead><tr><th scope="col">Area</th><th scope="col">Permission</th><th scope="col">Allowed</th></tr></thead>
      <tbody>{PERMISSION_DEFINITIONS.map(definition => <tr key={definition.id}>
        <td className="cc-muted">{definition.area}</td>
        <td><strong>{definition.label}</strong><br /><small className="cc-muted">{definition.description}</small></td>
        <td>{render(definition)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

function MemberOverrides({ members, matrix, readOnly }: { members: Member[]; matrix: SettingsResponse['matrix']; readOnly: boolean }) {
  const [userId, setUserId] = useState(members[0]?.userId ?? '')
  const member = members.find(item => item.userId === userId) ?? null
  const [draft, setDraft] = useState<Record<string, 'inherit' | 'allow' | 'deny'>>({})
  useEffect(() => { setDraft(Object.fromEntries(Object.entries(member?.overrides ?? {}))) }, [member])
  const save = useSave()
  const locked = readOnly || save.busy
  if (members.length === 0) return <Panel title="Personal permissions" description="Give one person more or less than their role."><p className="cc-muted">No team members besides owners yet.</p></Panel>
  const roleDefaults = member && matrix && isControlRole(member.role) && member.role !== 'owner' ? matrix[member.role as EditableRole] : null
  return <Panel title="Personal permissions" description="Give one person more (Allow) or less (Deny) than their role. Inherit follows the role.">
    <Field label="Person" htmlFor="perm-member">
      <select id="perm-member" className="cc-input" value={userId} onChange={event => setUserId(event.target.value)} disabled={readOnly}>
        {members.map(item => <option key={item.userId} value={item.userId}>{item.email} · {isControlRole(item.role) ? ROLE_LABELS[item.role] : item.role}</option>)}
      </select>
    </Field>
    <PermissionList render={definition => <select aria-label={`${member?.email ?? ''}: ${definition.label}`} className="cc-input cc-input--sm" value={draft[definition.id] ?? 'inherit'} disabled={locked} onChange={event => setDraft(current => ({ ...current, [definition.id]: event.target.value as 'inherit' | 'allow' | 'deny' }))}>
      <option value="inherit">Inherit ({roleDefaults?.[definition.id] ? 'on' : 'off'})</option>
      <option value="allow">Allow</option>
      <option value="deny">Deny</option>
    </select>} />
    <div className="cc-form__actions"><Button variant="primary" disabled={locked || !member} onClick={() => void save.run({ action: 'permissions.member', userId, overrides: draft }, 'Personal permissions saved.')}><ShieldCheck size={15} aria-hidden="true" /> Save personal permissions</Button></div>
    <p className="cc-muted">{STEP_UP_NOTE}</p>
    <SaveStatus message={save.message} tone={save.tone} />
  </Panel>
}

function ActivityTab({ data }: { data: SettingsResponse }) {
  const { zone } = useTimeZone()
  const { phase } = useControlSession()
  const selfId = phase.kind === 'granted' ? phase.session.userId : null
  const rows = data.activity ?? []
  return <Panel title="Settings activity" description="Every settings, role and permission change, newest first (last 50). Who, what, when and the result. Never passwords or codes. The full history is in the Audit log.">
    {rows.length === 0 ? <EmptyState title="No settings changes yet" body="Changes made on these tabs appear here." /> : <ul className="cc-list">
      {rows.map(row => {
        const result = row.result === 'error' ? 'failed' : row.result === 'denied' ? 'denied' : 'success'
        const description = describeAuditEvent({ action: String(row.action), outcome: result, actor_id: row.actor_id as string | null, actor_role: row.actor_role as string | null, target_type: row.target_type as string | null, target_id: row.target_id as string | null, error_code: row.error_category as string | null, reason: row.reason as string | null }, { selfId })
        return <li key={String(row.id)} className="cc-list__row">
          <span><Badge tone={result === 'success' ? 'ok' : result === 'denied' ? 'warn' : 'crit'}>{result}</Badge> {description.title}{description.detail ? <small className="cc-muted"> · {description.detail}</small> : null}</span>
          <small className="cc-muted">{description.actor} · {formatDateTime(String(row.created_at), zone)}</small>
        </li>
      })}
    </ul>}
  </Panel>
}

function EmailDomainsTab({ domains, readOnly }: { domains: EmailDomains | null; readOnly: boolean }) {
  const { zone } = useTimeZone()
  const save = useSave()
  const locked = readOnly || save.busy
  const [allowInput, setAllowInput] = useState('')
  const [blockInput, setBlockInput] = useState('')
  const [inputError, setInputError] = useState<{ kind: 'allow' | 'block'; message: string } | null>(null)
  const [removing, setRemoving] = useState<{ domain: string; kind: 'allow' | 'block' } | null>(null)
  if (!domains) return <Panel title="Email domains"><p className="cc-muted">Email domain rules could not be loaded.</p></Panel>

  const add = async (kind: 'allow' | 'block') => {
    if (readOnly) return
    const raw = kind === 'allow' ? allowInput : blockInput
    const domain = normalizeDomainInput(raw)
    if (!domain) { setInputError({ kind, message: 'Enter a domain like example.com: lowercase letters, numbers, dots and dashes, without @.' }); return }
    if (domains.builtIn.includes(domain)) { setInputError({ kind, message: kind === 'block' ? 'This provider is always allowed and cannot be blocked.' : 'This provider is already always allowed.' }); return }
    setInputError(null)
    const ok = await save.run({ action: 'domains.add', domain, kind }, kind === 'allow' ? `${domain} is now always allowed.` : `${domain} is now blocked for new sign-ups.`)
    if (ok) { if (kind === 'allow') setAllowInput(''); else setBlockInput('') }
  }

  const addForm = (kind: 'allow' | 'block') => {
    const id = `domain-${kind}`
    const value = kind === 'allow' ? allowInput : blockInput
    return <form className="cc-form cc-domain-form" onSubmit={event => { event.preventDefault(); void add(kind) }}>
      <Field label={kind === 'allow' ? 'Always allow a domain' : 'Block a domain'} htmlFor={id} hint="Domain only, e.g. example.com. Subdomains follow their parent." error={inputError?.kind === kind ? inputError.message : undefined}>
        <input id={id} className="cc-input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={253} placeholder="example.com" value={value}
          onChange={event => { if (kind === 'allow') setAllowInput(event.target.value); else setBlockInput(event.target.value); setInputError(null) }} disabled={locked} />
      </Field>
      <div className="cc-form__actions"><Button type="submit" variant={kind === 'block' ? 'danger' : 'primary'} disabled={locked || !value.trim()}><ShieldCheck size={15} aria-hidden="true" /> {kind === 'allow' ? 'Always allow' : 'Block'}</Button></div>
    </form>
  }

  const customList = (rows: Array<{ domain: string; createdAt: string }>, kind: 'allow' | 'block') => rows.length === 0
    ? <p className="cc-muted">{kind === 'allow' ? 'No domains added yet.' : 'No custom blocked domains yet.'}</p>
    : <ul className="cc-list cc-domain-list">{rows.map(row => <li key={row.domain} className="cc-list__row">
      <span><strong>{row.domain}</strong> <small className="cc-muted">· added {formatDateTime(row.createdAt, zone)}</small></span>
      <Button size="sm" variant="ghost" disabled={locked} onClick={() => setRemoving({ domain: row.domain, kind })} aria-label={`Remove ${row.domain}`}><Trash2 size={14} aria-hidden="true" /> Remove</Button>
    </li>)}</ul>

  return <>
    <Panel title="Always allowed" description="These domains skip every disposable-email check, in the sign-up form and on the server. Your own entries override the disposable-domain list.">
      <h3 className="cc-subhead">Built-in providers ({domains.builtIn.length})</h3>
      <div className="cc-domain-chips" aria-label="Built-in always-allowed providers">{domains.builtIn.map(domain => <span key={domain} className="cc-domain-chip">{domain}</span>)}</div>
      <h3 className="cc-subhead">Added by you ({domains.allowed.length})</h3>
      {customList(domains.allowed, 'allow')}
      {addForm('allow')}
    </Panel>
    <Panel title="Blocked" description="New accounts with these email domains (or their subdomains) are refused, on top of the disposable-domain list. Existing accounts are not affected.">
      <div className="cc-domain-meta"><span>Disposable-domain list:</span> <Badge tone="neutral">{domains.list.count.toLocaleString('en-IN')} domains</Badge>{domains.list.refreshedAt && <small className="cc-muted">Refreshed {formatDateTime(domains.list.refreshedAt, zone)} · updates weekly</small>}</div>
      <p className="cc-muted">Merged from free, open lists on GitHub:</p>
      <ul className="cc-domain-sources">{DISPOSABLE_LIST_SOURCES.map(source => <li key={source.url}><a className="cc-link" href={source.url} target="_blank" rel="noopener noreferrer">{source.name} <ExternalLink size={13} aria-hidden="true" /></a></li>)}</ul>
      <h3 className="cc-subhead">Added by you ({domains.blocked.length})</h3>
      {customList(domains.blocked, 'block')}
      {addForm('block')}
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </Panel>
    {removing && <Dialog title={`Remove ${removing.domain}?`} description={removing.kind === 'allow' ? 'It goes back to normal checks: if it is on the disposable-domain list, new sign-ups with it are refused again.' : 'New sign-ups with this domain are allowed again, unless it is on the disposable-domain list.'} onClose={() => setRemoving(null)}
      footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={() => { const target = removing; setRemoving(null); void save.run({ action: 'domains.remove', domain: target.domain }, `${target.domain} removed.`) }}>Remove</Button></>}>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
    </Dialog>}
  </>
}

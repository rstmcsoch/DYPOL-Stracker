import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useCurrentTabInView } from '../useCurrentTabInView'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Fingerprint, KeyRound, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
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
import { describeAuditEvent } from '../../lib/control-audit-catalog'
import { MIN_PASSWORD_LENGTH } from '../../lib/auth-rules'
import { GITHUB_BLOCKLIST_URL, normalizeDomainInput } from '../../lib/email-domains'

export interface SiteSettings { maintenanceEnabled: boolean; maintenanceMessage: string; siteDown: boolean; signupEnabled: boolean; signinEnabled: boolean; updatedAt: string | null }
export interface Member { userId: string; email: string; role: string; grantedAt: string; revokedAt: string | null; active: boolean; mfaEnrolled: boolean; overrides: Record<string, 'allow' | 'deny'> }
export interface SettingsResponse {
  me: { userId: string; role: ControlRole; permissions: Permission[]; assignableRoles: ControlRole[] }
  site: SiteSettings
  members: Member[] | null
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

/** One save = one fresh authenticator code. Returns a status line for the form. */
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
  return <>
    <nav className="cc-tabs" aria-label="Settings sections" ref={navRef}>
      {tabs.map(tab => <NavLink key={tab.id} to={`${BASE}/${tab.id}`} className={({ isActive }) => `cc-tabs__link${isActive ? ' is-active' : ''}`}>{tab.label}</NavLink>)}
    </nav>
    <Routes>
      <Route index element={<Navigate to={`${BASE}/${first}`} replace />} />
      {tabs.map(tab => <Route key={tab.id} path={tab.id} element={<TabBody id={tab.id} data={data} />} />)}
      <Route path="*" element={<Navigate to={`${BASE}/${first}`} replace />} />
    </Routes>
  </>
}

function TabBody({ id, data }: { id: TabId; data: SettingsResponse }) {
  switch (id) {
    case 'site': return <SiteTab site={data.site} />
    case 'access': return <AccessTab site={data.site} />
    case 'domains': return <EmailDomainsTab domains={data.emailDomains ?? null} />
    case 'security': return <SecurityTab data={data} />
    case 'roles': return <RolesTab data={data} />
    case 'permissions': return <PermissionsTab data={data} />
    case 'activity': return <ActivityTab data={data} />
  }
}

function SiteTab({ site }: { site: SiteSettings }) {
  const [maintenance, setMaintenance] = useState(site.maintenanceEnabled)
  const [down, setDown] = useState(site.siteDown)
  const [message, setMessage] = useState(site.maintenanceMessage)
  const save = useSave()
  const dirty = maintenance !== site.maintenanceEnabled || down !== site.siteDown || message !== site.maintenanceMessage
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save.run({ action: 'site.update', maintenanceEnabled: maintenance, siteDown: down, maintenanceMessage: message }, down ? 'Saved. The site is now down for visitors and students.' : 'Saved.')
  }
  return <Panel title="Site status" description="What visitors and students see. The Control Centre and team sign-in keep working in every mode.">
    <form className="cc-form" onSubmit={submit}>
      <p className="cc-inline-status">Now: {site.siteDown ? <Badge tone="crit">Site down</Badge> : site.maintenanceEnabled ? <Badge tone="warn">Maintenance notice</Badge> : <Badge tone="ok">Live</Badge>}</p>
      <Toggle id="set-maint" label="Maintenance notice" hint="A thin banner with your message on every public and student page. Everything keeps working." checked={maintenance} onChange={setMaintenance} disabled={save.busy} />
      <Toggle id="set-down" label="Site down (full outage)" hint="Public pages and student notebooks show a maintenance page. Log in stays open so the team can sign in; students who sign in see the maintenance page. Student AI chat and the contact form are refused by the server." checked={down} onChange={setDown} disabled={save.busy} />
      <Field label="Message" htmlFor="set-message" hint="Up to 500 characters. Leave empty for the default message.">
        <textarea id="set-message" className="cc-input" rows={3} maxLength={500} value={message} onChange={event => setMessage(event.target.value)} disabled={save.busy} placeholder="Stracker is down for maintenance. Please check back soon." />
      </Field>
      {down && !site.siteDown && <p className="cc-note cc-note--warn">Turning the site down hides Stracker from every student until you turn it back up.</p>}
      <div className="cc-form__actions"><Button type="submit" variant={down ? 'danger' : 'primary'} disabled={!dirty || save.busy}><ShieldCheck size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Save site status'}</Button></div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </form>
  </Panel>
}

function AccessTab({ site }: { site: SiteSettings }) {
  const [signup, setSignup] = useState(site.signupEnabled)
  const [signin, setSignin] = useState(site.signinEnabled)
  const save = useSave()
  const dirty = signup !== site.signupEnabled || signin !== site.signinEnabled
  return <Panel title="Sign-up and sign-in" description="Pause new accounts or student sign-ins. Team members with a role can always sign in.">
    <form className="cc-form" onSubmit={event => { event.preventDefault(); void save.run({ action: 'access.update', signupEnabled: signup, signinEnabled: signin }, 'Saved.') }}>
      <Toggle id="set-signup" label="Allow new sign-ups" hint="Off: the sign-up page says sign-ups are paused, and Supabase itself refuses to create any new account (email or Google)." checked={signup} onChange={setSignup} disabled={save.busy} />
      <Toggle id="set-signin" label="Allow student sign-in" hint="Off: the log-in page says sign-in is paused, and Supabase refuses new sign-ins for accounts without a team role. People already signed in stay signed in." checked={signin} onChange={setSignin} disabled={save.busy} />
      <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={!dirty || save.busy}><ShieldCheck size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Save switches'}</Button></div>
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

function SecurityTab({ data }: { data: SettingsResponse }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const save = useSave()
  const methods = useSignInMethods()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
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
          <input id="set-pw" className="cc-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={save.busy} />
        </Field>
        <Field label="Confirm new password" htmlFor="set-pw2" error={formError}>
          <input id="set-pw2" className="cc-input" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={save.busy} />
        </Field>
        <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={save.busy || !password}><KeyRound size={15} aria-hidden="true" /> {save.busy ? 'Saving…' : 'Change password'}</Button></div>
        <p className="cc-muted">{STEP_UP_NOTE} Forgot it? Use “Forgot your password?” on the Stracker log-in page.</p>
        <SaveStatus message={save.message} tone={save.tone} />
      </form>
    </Panel>
    {data.me.role === 'owner' && <PasskeysPanel data={data} />}
  </>
}

function PasskeysPanel({ data }: { data: SettingsResponse }) {
  const enabled = usePasskeysEnabled()
  const stepUp = useStepUp()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ message: string; tone: 'ok' | 'crit' } | null>(null)
  const items = data.passkeys?.items ?? []
  const add = async () => {
    if (!supabase) return
    setBusy(true); setStatus(null)
    try {
      const allowed = await stepUp(() => controlFetch('settings', { method: 'POST', body: { action: 'passkey.authorize' } }))
      if (allowed === null) { setStatus({ message: 'Cancelled.', tone: 'crit' }); return }
      const { error } = await supabase.auth.registerPasskey()
      if (error) { setStatus({ message: 'The passkey was not added. Your device cancelled it, passkeys are off in Supabase, or Supabase wants this session confirmed with your authenticator code: confirm with the code and try again.', tone: 'crit' }); return }
      await client.invalidateQueries({ queryKey: QUERY_KEY })
      setStatus({ message: 'Passkey added. Next time, choose “Use passkey” on the two-step screen or when confirming a save.', tone: 'ok' })
    } catch (error) {
      setStatus({ message: errorText(error), tone: 'crit' })
    } finally { setBusy(false) }
  }
  const remove = async (passkeyId: string) => {
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
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(item.id)}><Trash2 size={14} aria-hidden="true" /> Remove</Button>
      </li>)}
    </ul>}
    <div className="cc-form__actions"><Button variant="primary" disabled={busy || enabled !== true} onClick={() => void add()}><Fingerprint size={15} aria-hidden="true" /> {busy ? 'Working…' : 'Add a passkey on this device'}</Button></div>
    {status && <SaveStatus message={status.message} tone={status.tone} />}
  </Panel>
}

function RolesTab({ data }: { data: SettingsResponse }) {
  const { zone } = useTimeZone()
  const members = data.members ?? []
  const assignable = data.me.assignableRoles
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ControlRole>(assignable.includes('moderator') ? 'moderator' : assignable[0] ?? 'viewer')
  const [removing, setRemoving] = useState<Member | null>(null)
  const save = useSave()
  const active = members.filter(member => member.active)
  const past = members.filter(member => !member.active)
  const canTouch = (member: Member) => member.userId !== data.me.userId && isControlRole(member.role) && assignable.includes(member.role)
  const give = async (event: FormEvent) => {
    event.preventDefault()
    if (await save.run({ action: 'role.assign', email: email.trim(), role }, `Role given. The next time they open the Control Centre they must set up their own authenticator first.`)) setEmail('')
  }
  return <>
    <Panel title="Give a role" description="The person must already have a Stracker account. They sign in to Stracker normally, then open the Control Centre and set up their own authenticator before anything else.">
      <form className="cc-form cc-form--inline" onSubmit={event => void give(event)}>
        <Field label="Their Stracker email" htmlFor="role-email"><input id="role-email" className="cc-input" type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} disabled={save.busy} required /></Field>
        <Field label="Role" htmlFor="role-pick">
          <select id="role-pick" className="cc-input" value={role} onChange={event => setRole(event.target.value as ControlRole)} disabled={save.busy}>
            {assignable.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
          </select>
        </Field>
        <div className="cc-form__actions"><Button type="submit" variant="primary" disabled={save.busy || !email.trim()}><UserPlus size={15} aria-hidden="true" /> Give role</Button></div>
      </form>
      <p className="cc-muted">{ROLE_DESCRIPTIONS[role]} {STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </Panel>
    <Panel title="Team" description="Removing a role ends that person’s console access at once: the role and personal permissions are removed, their authenticator and passkeys are deleted, and they are signed out everywhere. If they get a role again, they set up a new authenticator.">
      {active.length === 0 ? <EmptyState title="No team members" body="Give a role above." /> : <div className="cc-table-wrap" tabIndex={0}>
        <table className="cc-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Authenticator</th><th scope="col">Since</th><th scope="col"><span className="cc-sr-only">Actions</span></th></tr></thead>
          <tbody>{active.map(member => <tr key={member.userId}>
            <td>{member.email || member.userId.slice(0, 8)}{member.userId === data.me.userId && <> <Badge tone="neutral">You</Badge></>}</td>
            <td>{canTouch(member) ? <select aria-label={`Role of ${member.email}`} className="cc-input cc-input--sm" value={member.role} disabled={save.busy} onChange={event => void save.run({ action: 'role.assign', email: member.email, role: event.target.value }, 'Role changed.')}>
              {assignable.map(item => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
            </select> : <Badge tone={member.role === 'owner' ? 'ok' : 'neutral'}>{isControlRole(member.role) ? ROLE_LABELS[member.role] : member.role}</Badge>}</td>
            <td>{member.mfaEnrolled ? <Badge tone="ok">Set up</Badge> : <Badge tone="warn">Not yet</Badge>}</td>
            <td>{formatDateTime(member.grantedAt, zone)}</td>
            <td>{canTouch(member) && <Button size="sm" variant="danger" disabled={save.busy} onClick={() => setRemoving(member)}>Remove role</Button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {past.length > 0 && <details className="cc-disclosure"><summary>Removed ({past.length})</summary><ul className="cc-list">{past.map(member => <li key={member.userId}>{member.email || member.userId.slice(0, 8)} · was {isControlRole(member.role) ? ROLE_LABELS[member.role] : member.role} · removed {formatDateTime(member.revokedAt, zone)}</li>)}</ul></details>}
    </Panel>
    {removing && <Dialog danger title={`Remove ${removing.email}?`} description="Their role and personal permissions are removed, their authenticator and passkeys are deleted, and every session they have is ended. Their student account and study data stay." onClose={() => setRemoving(null)}
      footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={() => { const target = removing; setRemoving(null); void save.run({ action: 'role.remove', userId: target.userId }, `${target.email} no longer has a role. Their access has ended.`) }}>Remove role</Button></>}>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
    </Dialog>}
  </>
}

function PermissionsTab({ data }: { data: SettingsResponse }) {
  const matrix = data.matrix
  const [role, setRole] = useState<EditableRole>('administrator')
  const [draft, setDraft] = useState<Record<string, boolean>>(() => ({ ...(matrix?.[role] ?? {}) }))
  useEffect(() => { setDraft({ ...(matrix?.[role] ?? {}) }) }, [role, matrix])
  const save = useSave()
  const changed = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([permission, allowed]) => matrix?.[role]?.[permission as Permission] !== allowed)), [draft, matrix, role])
  const members = (data.members ?? []).filter(member => member.active && member.role !== 'owner')
  return <>
    <Panel title="Role permissions" description="What each role can open and change. The Owner always has everything and cannot be restricted. Changes apply on the person’s next request.">
      <div className="cc-segmented" role="tablist" aria-label="Role">
        {EDITABLE_ROLES.map(item => <button key={item} type="button" role="tab" aria-selected={role === item} className={role === item ? 'is-active' : ''} onClick={() => setRole(item)}>{ROLE_LABELS[item]}</button>)}
      </div>
      <p className="cc-muted">{ROLE_DESCRIPTIONS[role]}</p>
      <PermissionList render={definition => <Switch label={`${ROLE_LABELS[role]}: ${definition.label}`} checked={draft[definition.id] === true} disabled={save.busy} onChange={value => setDraft(current => ({ ...current, [definition.id]: value }))} />} />
      <div className="cc-form__actions"><Button variant="primary" disabled={save.busy || Object.keys(changed).length === 0} onClick={() => void save.run({ action: 'permissions.role', role, permissions: changed }, `${ROLE_LABELS[role]} permissions saved.`)}><ShieldCheck size={15} aria-hidden="true" /> Save {ROLE_LABELS[role]} permissions</Button></div>
      <p className="cc-muted">{STEP_UP_NOTE}</p>
      <SaveStatus message={save.message} tone={save.tone} />
    </Panel>
    <MemberOverrides members={data.members === null ? [] : members} matrix={matrix} />
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

function MemberOverrides({ members, matrix }: { members: Member[]; matrix: SettingsResponse['matrix'] }) {
  const [userId, setUserId] = useState(members[0]?.userId ?? '')
  const member = members.find(item => item.userId === userId) ?? null
  const [draft, setDraft] = useState<Record<string, 'inherit' | 'allow' | 'deny'>>({})
  useEffect(() => { setDraft(Object.fromEntries(Object.entries(member?.overrides ?? {}))) }, [member])
  const save = useSave()
  if (members.length === 0) return <Panel title="Personal permissions" description="Give one person more or less than their role."><p className="cc-muted">No team members besides owners yet.</p></Panel>
  const roleDefaults = member && matrix && isControlRole(member.role) && member.role !== 'owner' ? matrix[member.role as EditableRole] : null
  return <Panel title="Personal permissions" description="Give one person more (Allow) or less (Deny) than their role. Inherit follows the role.">
    <Field label="Person" htmlFor="perm-member">
      <select id="perm-member" className="cc-input" value={userId} onChange={event => setUserId(event.target.value)}>
        {members.map(item => <option key={item.userId} value={item.userId}>{item.email} · {isControlRole(item.role) ? ROLE_LABELS[item.role] : item.role}</option>)}
      </select>
    </Field>
    <PermissionList render={definition => <select aria-label={`${member?.email ?? ''}: ${definition.label}`} className="cc-input cc-input--sm" value={draft[definition.id] ?? 'inherit'} disabled={save.busy} onChange={event => setDraft(current => ({ ...current, [definition.id]: event.target.value as 'inherit' | 'allow' | 'deny' }))}>
      <option value="inherit">Inherit ({roleDefaults?.[definition.id] ? 'on' : 'off'})</option>
      <option value="allow">Allow</option>
      <option value="deny">Deny</option>
    </select>} />
    <div className="cc-form__actions"><Button variant="primary" disabled={save.busy || !member} onClick={() => void save.run({ action: 'permissions.member', userId, overrides: draft }, 'Personal permissions saved.')}><ShieldCheck size={15} aria-hidden="true" /> Save personal permissions</Button></div>
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

function EmailDomainsTab({ domains }: { domains: EmailDomains | null }) {
  const { zone } = useTimeZone()
  const save = useSave()
  const [allowInput, setAllowInput] = useState('')
  const [blockInput, setBlockInput] = useState('')
  const [inputError, setInputError] = useState<{ kind: 'allow' | 'block'; message: string } | null>(null)
  const [removing, setRemoving] = useState<{ domain: string; kind: 'allow' | 'block' } | null>(null)
  if (!domains) return <Panel title="Email domains"><p className="cc-muted">Email domain rules could not be loaded.</p></Panel>

  const add = async (kind: 'allow' | 'block') => {
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
          onChange={event => { if (kind === 'allow') setAllowInput(event.target.value); else setBlockInput(event.target.value); setInputError(null) }} disabled={save.busy} />
      </Field>
      <div className="cc-form__actions"><Button type="submit" variant={kind === 'block' ? 'danger' : 'primary'} disabled={save.busy || !value.trim()}><ShieldCheck size={15} aria-hidden="true" /> {kind === 'allow' ? 'Always allow' : 'Block'}</Button></div>
    </form>
  }

  const customList = (rows: Array<{ domain: string; createdAt: string }>, kind: 'allow' | 'block') => rows.length === 0
    ? <p className="cc-muted">{kind === 'allow' ? 'No domains added yet.' : 'No custom blocked domains yet.'}</p>
    : <ul className="cc-list cc-domain-list">{rows.map(row => <li key={row.domain} className="cc-list__row">
      <span><strong>{row.domain}</strong> <small className="cc-muted">· added {formatDateTime(row.createdAt, zone)}</small></span>
      <Button size="sm" variant="ghost" disabled={save.busy} onClick={() => setRemoving({ domain: row.domain, kind })} aria-label={`Remove ${row.domain}`}><Trash2 size={14} aria-hidden="true" /> Remove</Button>
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
      <p className="cc-inline-status">Disposable-domain list: <Badge tone="neutral">{domains.list.count.toLocaleString('en-IN')} domains</Badge>{domains.list.refreshedAt && <small className="cc-muted"> · refreshed {formatDateTime(domains.list.refreshedAt, zone)} · updates weekly</small>}</p>
      <p><a className="cc-link" href={GITHUB_BLOCKLIST_URL} target="_blank" rel="noopener noreferrer">View the list on GitHub <ExternalLink size={13} aria-hidden="true" /></a></p>
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

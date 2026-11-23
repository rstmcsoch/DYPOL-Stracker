import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, RotateCcw, ShieldCheck } from 'lucide-react'
import { controlFetch, type MasterMcpConnection, type MasterMcpMutationResult, type MasterMcpStatus } from '../api'
import { useStepUp } from '../reauth'
import { Badge, Button, Dialog, EmptyState, Field, Panel } from '../ui'
import { QueryFrame } from '../pageParts'
import { formatDateTime } from '../policy'
import { useTimeZone } from '../time'

const QUERY_KEY = ['control', 'master-mcp'] as const

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The change could not be saved.'
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the execCommand path used in older browsers and jsdom.
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

interface IssuedToken {
  token: string
  tokenHint: string
  displayName: string
}

function useMasterMcpSave() {
  const stepUp = useStepUp()
  const client = useQueryClient()
  const [state, setState] = useState<{ busy: boolean; message: string | null; tone: 'ok' | 'crit' }>({ busy: false, message: null, tone: 'ok' })
  const run = async (body: Record<string, unknown>, success: string): Promise<MasterMcpMutationResult | null> => {
    setState({ busy: true, message: null, tone: 'ok' })
    try {
      const result = await stepUp(() => controlFetch<MasterMcpMutationResult>('master-mcp', { method: 'POST', body }))
      if (result === null) {
        setState({ busy: false, message: 'Cancelled. Nothing was saved.', tone: 'crit' })
        return null
      }
      await client.invalidateQueries({ queryKey: QUERY_KEY })
      setState({ busy: false, message: success, tone: 'ok' })
      return result
    } catch (error) {
      setState({ busy: false, message: errorText(error), tone: 'crit' })
      return null
    }
  }
  return { ...state, run }
}

export default function MasterMcpTab({ readOnly }: { readOnly: boolean }) {
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => controlFetch<MasterMcpStatus>('master-mcp'), staleTime: 15_000 })
  return (
    <QueryFrame query={query} errorLabel="The Master MCP connection could not be loaded.">
      {data => <MasterMcpPanels data={data} readOnly={readOnly} />}
    </QueryFrame>
  )
}

function MasterMcpPanels({ data, readOnly }: { data: MasterMcpStatus; readOnly: boolean }) {
  const { zone } = useTimeZone()
  const save = useMasterMcpSave()
  const [displayName, setDisplayName] = useState('')
  const [issued, setIssued] = useState<IssuedToken | null>(null)
  const [copied, setCopied] = useState<'token' | 'endpoint' | null>(null)
  const [confirm, setConfirm] = useState<{ action: 'revoke' | 'rotate'; connection: MasterMcpConnection } | null>(null)
  const locked = readOnly || save.busy

  const copy = async (value: string, which: 'token' | 'endpoint') => {
    const ok = await copyText(value)
    setCopied(ok ? which : null)
  }

  const create = (event: FormEvent) => {
    event.preventDefault()
    if (readOnly) return
    void (async () => {
      const result = await save.run({ action: 'create', displayName: displayName.trim() }, 'Connection created. Copy the token now — it will not be shown again.')
      if (result?.token) {
        setIssued({ token: result.token, tokenHint: result.tokenHint ?? result.token.slice(-4), displayName: result.connection.displayName })
        setDisplayName('')
        setCopied(null)
      }
    })()
  }

  const confirmAction = () => {
    if (!confirm || readOnly) return
    const { action, connection } = confirm
    setConfirm(null)
    void (async () => {
      const success = action === 'revoke'
        ? `Revoked “${connection.displayName}”. That token can no longer authenticate.`
        : `Rotated “${connection.displayName}”. The previous token can no longer authenticate.`
      const result = await save.run({ action, id: connection.id }, success)
      if (action === 'rotate' && result?.token) {
        setIssued({ token: result.token, tokenHint: result.tokenHint ?? result.token.slice(-4), displayName: result.connection.displayName })
        setCopied(null)
      }
      if (action === 'revoke' && issued && (issued.tokenHint === connection.tokenHint || issued.displayName === connection.displayName)) {
        setIssued(null)
      }
    })()
  }

  const active = data.connections.filter(row => row.status === 'active')
  const revoked = data.connections.filter(row => row.status === 'revoked')

  return (
    <div className="cc-stack">
      {readOnly && <p className="cc-note cc-note--warn" role="status">View only. Connection changes are disabled during the removal countdown.</p>}
      {save.message && <p className={`cc-note ${save.tone === 'ok' ? 'cc-note--ok' : 'cc-note--crit'}`} role={save.tone === 'ok' ? 'status' : 'alert'}>{save.message}</p>}

      <Panel title="Connection" description="The Streamable HTTP endpoint and named credentials the Owner issues for the Master MCP principal. Tokens are shown once and are never stored in this browser.">
        <dl className="cc-dl">
          <div><dt>Endpoint</dt><dd className="cc-mono">{data.endpointUrl} <Button type="button" size="sm" variant="ghost" onClick={() => void copy(data.endpointUrl, 'endpoint')}>{copied === 'endpoint' ? 'Copied' : 'Copy'}</Button></dd></div>
          <div><dt>Transport</dt><dd>{data.transport}</dd></div>
          <div><dt>Last used</dt><dd>{data.lastUsedAt ? formatDateTime(data.lastUsedAt, zone) : 'Never'}</dd></div>
        </dl>

        {issued && (
          <div className="cc-note cc-note--ok" role="status">
            <p><strong>Token for “{issued.displayName}”</strong> (hint …{issued.tokenHint}). Copy it now. It cannot be recovered later.</p>
            <p className="cc-mono" style={{ wordBreak: 'break-all' }}>{issued.token}</p>
            <Button type="button" size="sm" variant="primary" onClick={() => void copy(issued.token, 'token')}><Copy size={14} aria-hidden /> {copied === 'token' ? 'Copied' : 'Copy token'}</Button>
          </div>
        )}

        <form className="cc-form" onSubmit={create}>
          <Field htmlFor="master-mcp-name" label="Connection name" hint="1–80 characters. A label only — it is not a secret.">
            <input id="master-mcp-name" className="cc-input" maxLength={80} value={displayName} disabled={locked} onChange={event => setDisplayName(event.target.value)} placeholder="Owner operations" autoComplete="off" />
          </Field>
          <div className="cc-form__actions">
            <Button type="submit" variant="primary" disabled={locked || !displayName.trim()}><KeyRound size={16} aria-hidden /> Create connection</Button>
          </div>
        </form>

        {active.length === 0 && revoked.length === 0 ? (
          <EmptyState title="No connections yet" body="Create a named connection, copy the token once, and paste it into the MCP client. Only the Owner can do this." />
        ) : (
          <div className="cc-table-wrap" tabIndex={0} aria-label="Master MCP connections">
            <table className="cc-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Hint</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.connections.map(row => (
                  <tr key={row.id}>
                    <td>{row.displayName}</td>
                    <td className="cc-mono">…{row.tokenHint}</td>
                    <td><Badge tone={row.status === 'active' ? 'ok' : 'neutral'}>{row.status === 'active' ? 'Active' : 'Revoked'}</Badge></td>
                    <td>{formatDateTime(row.createdAt, zone)}</td>
                    <td>{row.lastUsedAt ? formatDateTime(row.lastUsedAt, zone) : 'Never'}</td>
                    <td>
                      {row.status === 'active' ? (
                        <span className="cc-row-actions">
                          <Button type="button" size="sm" disabled={locked} onClick={() => setConfirm({ action: 'rotate', connection: row })}><RotateCcw size={14} aria-hidden /> Rotate</Button>
                          <Button type="button" size="sm" variant="danger" disabled={locked} onClick={() => setConfirm({ action: 'revoke', connection: row })}>Revoke</Button>
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="cc-muted">Saving asks you to confirm again: a fresh authenticator code (the owner can also use a passkey).</p>
      </Panel>

      <Panel title="Capability overview" description="What this Master MCP principal is authorized to do once tools are implemented, and what is permanently refused.">
        <h3 className="cc-subhead">Implemented now</h3>
        <ul className="cc-list">{data.implementedTools.map(name => <li key={name} className="cc-mono">{name}</li>)}</ul>
        <h3 className="cc-subhead">Authorized capabilities</h3>
        <ul className="cc-list">{Object.entries(data.capabilities).map(([key, item]) => <li key={key}>{item}</li>)}</ul>
        <h3 className="cc-subhead">Restricted</h3>
        <ul className="cc-list">{Object.entries(data.restricted).map(([key, item]) => <li key={key}>{item}</li>)}</ul>
      </Panel>

      <Panel title="Operational activity" description="Recent Master MCP actions, failures, tool use, and the configured request limits. Student notes and marks are never recorded here.">
        <p className="cc-muted">
          Limits: {data.rateLimits.authenticatedPerMinute} requests per minute per credential, {data.rateLimits.anonymousPerMinute} per hashed IP when no valid token is presented.
          {data.rateLimits.recentRateLimited > 0 ? ` ${data.rateLimits.recentRateLimited} rate-limited refusal${data.rateLimits.recentRateLimited === 1 ? '' : 's'} in the last 24 hours.` : ' No rate-limit refusals in the last 24 hours.'}
        </p>
        {data.toolUsage.length > 0 && (
          <>
            <h3 className="cc-subhead">Tool use (7 days)</h3>
            <ul className="cc-list">{data.toolUsage.map(row => <li key={row.toolName}><span className="cc-mono">{row.toolName}</span> — {row.count}</li>)}</ul>
          </>
        )}
        <h3 className="cc-subhead">Recent actions</h3>
        {data.recentActions.length === 0 ? <p className="cc-muted">No Master MCP actions recorded yet.</p> : (
          <ActivityTable events={data.recentActions} zone={zone} label="Recent Master MCP actions" />
        )}
        <h3 className="cc-subhead">Recent failures</h3>
        {data.recentFailures.length === 0 ? <p className="cc-muted">No failed or denied Master MCP actions.</p> : (
          <ActivityTable events={data.recentFailures} zone={zone} label="Recent Master MCP failures" />
        )}
      </Panel>

      <Panel title="Security notes" description="The Master MCP principal is not the Owner, and these credentials never become an Owner session.">
        <ul className="cc-list">
          {data.securityNotes.map(note => <li key={note}><ShieldCheck size={14} aria-hidden /> {note}</li>)}
        </ul>
      </Panel>

      {confirm && (
        <Dialog
          title={confirm.action === 'revoke' ? 'Revoke this connection?' : 'Rotate this connection?'}
          description={confirm.action === 'revoke'
            ? `“${confirm.connection.displayName}” (hint …${confirm.connection.tokenHint}) will stop working immediately. This cannot be undone.`
            : `The current token for “${confirm.connection.displayName}” will be revoked and a new token will be shown once.`}
          danger={confirm.action === 'revoke'}
          onClose={() => setConfirm(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button type="button" variant={confirm.action === 'revoke' ? 'danger' : 'primary'} onClick={confirmAction}>
              {confirm.action === 'revoke' ? 'Revoke connection' : 'Rotate connection'}
            </Button>
          </>}
        >
          <p>You will be asked to confirm with a passkey or a fresh authenticator code before the change is applied.</p>
        </Dialog>
      )}
    </div>
  )
}

function ActivityTable({ events, zone, label }: { events: MasterMcpStatus['recentActions']; zone: string; label: string }) {
  return (
    <div className="cc-table-wrap" tabIndex={0} aria-label={label}>
      <table className="cc-table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Tool</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.createdAt}-${event.action}-${index}`}>
              <td>{event.createdAt ? formatDateTime(event.createdAt, zone) : '—'}</td>
              <td>{event.action}{event.credentialLabel ? ` (${event.credentialLabel})` : ''}</td>
              <td className="cc-mono">{event.toolName ?? '—'}</td>
              <td><Badge tone={event.result === 'success' ? 'ok' : 'crit'}>{event.result}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

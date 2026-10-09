import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { controlDownload, controlFetch, ControlApiError, type AuditRow } from '../api'
import { Badge, Button, EmptyState, Field, Panel, Spinner, ErrorState, Pager, Skeleton } from '../ui'
import { PageHeader } from '../pageParts'
import { formatDateTime, shortId } from '../policy'
import { useSensitiveAction } from '../reauth'
import { useToast } from '../../contexts/ToastContext'
import { useSearchParams } from 'react-router-dom'

const PAGE_SIZE = 50
const OUTCOMES = ['all', 'success', 'denied', 'failed'] as const

interface AuditResponse { events: AuditRow[]; total: number; page: number; pageSize: number }

function outcomeTone(outcome: AuditRow['outcome']): 'ok' | 'warn' | 'crit' {
  return outcome === 'success' ? 'ok' : outcome === 'denied' ? 'warn' : 'crit'
}

/** Read-only audit table, also used by account detail pages. */
export function AuditTable({ rows, emptyTitle, emptyBody }: { rows: AuditRow[]; emptyTitle: string; emptyBody: string }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />
  return (
    <div className="cc-table-wrap" tabIndex={0} aria-label="Audit events, scrollable on small screens">
      <table className="cc-table cc-table--audit">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Outcome</th>
            <th scope="col">Actor</th>
            <th scope="col">Target</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{formatDateTime(row.occurred_at)}</td>
              <td><code>{row.action}</code></td>
              <td><Badge tone={outcomeTone(row.outcome)}>{row.outcome}</Badge></td>
              <td className="cc-mono">{row.actor_id ? shortId(row.actor_id) : row.actor_role ?? 'system'}</td>
              <td className="cc-mono">{row.target_id ? shortId(row.target_id) : '—'}</td>
              <td>
                {row.error_code && <span className="cc-muted">{row.error_code}</span>}
                {row.reason && <span className="cc-reason">{row.reason}</span>}
                {row.summary && Object.keys(row.summary).length > 0 && <span className="cc-muted cc-mono">{Object.entries(row.summary).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</span>}
                {!row.error_code && !row.reason && (!row.summary || Object.keys(row.summary).length === 0) && '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AuditPage() {
  const [params, setParams] = useSearchParams()
  const outcome = (OUTCOMES as readonly string[]).includes(params.get('outcome') ?? '') ? params.get('outcome') ?? 'all' : 'all'
  const action = params.get('action') ?? ''
  const target = params.get('target') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [actionDraft, setActionDraft] = useState(action)
  const [targetDraft, setTargetDraft] = useState(target)
  const [exporting, setExporting] = useState(false)
  const { notify } = useToast()
  const sensitive = useSensitiveAction()

  const update = (changes: Record<string, string>) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(changes)) { if (value && value !== 'all') next.set(key, value); else next.delete(key) }
      if (!('page' in changes)) next.delete('page')
      return next
    })
  }

  const filterString = new URLSearchParams({ outcome, action, target, from, to }).toString()
  const query = useQuery({
    queryKey: ['control', 'audit', outcome, action, target, from, to, page],
    queryFn: () => controlFetch<AuditResponse>(`audit?${filterString}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: previous => previous
  })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { blob, filename } = await sensitive(() => controlDownload(`audit?${filterString}&format=csv`))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('Audit export downloaded. The export itself is recorded in the audit log.', 'success')
    } catch (error) {
      notify(error instanceof ControlApiError ? error.message : 'The export could not be produced.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of administrative access, denials, account changes and exports. Entries cannot be edited or deleted."
        actions={<Button variant="ghost" onClick={() => void exportCsv()} disabled={exporting}>{exporting ? <Spinner label="Exporting…" /> : <><Download size={15} aria-hidden="true" /> Export CSV</>}</Button>}
      />
      <Panel>
        <form className="cc-toolbar cc-toolbar--wrap" role="search" onSubmit={event => { event.preventDefault(); update({ action: actionDraft.trim(), target: targetDraft.trim() }) }}>
          <label className="cc-select">
            <span className="cc-sr-only">Outcome</span>
            <select value={outcome} onChange={event => update({ outcome: event.target.value })}>
              <option value="all">All outcomes</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <Field label="Action" htmlFor="cc-audit-action" hint="e.g. user.suspend">
            <input id="cc-audit-action" className="cc-input" value={actionDraft} onChange={event => setActionDraft(event.target.value)} maxLength={80} />
          </Field>
          <Field label="Target account ID" htmlFor="cc-audit-target" hint="Full UUID">
            <input id="cc-audit-target" className="cc-input cc-mono" value={targetDraft} onChange={event => setTargetDraft(event.target.value)} maxLength={36} />
          </Field>
          <Field label="From" htmlFor="cc-audit-from">
            <input id="cc-audit-from" className="cc-input" type="date" value={from} onChange={event => update({ from: event.target.value })} />
          </Field>
          <Field label="To" htmlFor="cc-audit-to">
            <input id="cc-audit-to" className="cc-input" type="date" value={to} onChange={event => update({ to: event.target.value })} />
          </Field>
          <div className="cc-toolbar__submit"><Button type="submit" variant="ghost">Apply text filters</Button></div>
        </form>

        {query.isPending && <Skeleton rows={8} />}
        {query.isError && !query.data && <ErrorState message={query.error instanceof Error ? query.error.message : 'The audit log could not be loaded.'} onRetry={() => void query.refetch()} />}
        {query.data && (
          <>
            <AuditTable rows={query.data.events} emptyTitle="No matching events" emptyBody="Try a wider date range or clear the filters." />
            {query.data.total > 0 && <Pager page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={next => update({ page: String(next) })} />}
          </>
        )}
      </Panel>
    </>
  )
}

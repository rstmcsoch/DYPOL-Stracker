import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, FilterX } from 'lucide-react'
import { controlDownload, controlFetch, ControlApiError, type AuditResponse, type AuditRow } from '../api'
import { Badge, Button, EmptyState, Field, Panel, Spinner, ErrorState, Pager, Skeleton } from '../ui'
import { PageHeader } from '../pageParts'
import { CONSOLE_BASE, formatDateTime, formatDateTimeFull, formatDayRange, shortId } from '../policy'
import { useSensitiveAction } from '../reauth'
import { useToast } from '../../contexts/ToastContext'
import { useTimeZone, TimeZoneSwitch } from '../time'
import { useControlSession } from '../ControlSession'
import { AUDIT_ACTIONS, describeAuditEvent } from '../../lib/control-audit-catalog'
import {
  auditActionChoices,
  auditFiltersToParams,
  buildAuditQuery,
  DEFAULT_AUDIT_FILTERS,
  invalidFilterField,
  isDefaultAuditFilters,
  readAuditFilters,
  readAuditPage,
  type AuditFilters,
  type AuditOutcomeOption
} from '../audit-filters'

const PAGE_SIZE = 50

function outcomeTone(outcome: AuditRow['outcome']): 'ok' | 'warn' | 'crit' {
  return outcome === 'success' ? 'ok' : outcome === 'denied' ? 'warn' : 'crit'
}

/** Read-only audit table, also used by account detail pages. Times are shown in the console's display zone. */
export function AuditTable({ rows, emptyTitle, emptyBody }: { rows: AuditRow[]; emptyTitle: string; emptyBody: string }) {
  const { zone, shortLabel } = useTimeZone()
  const { phase } = useControlSession()
  const selfId = phase.kind === 'granted' ? phase.session.userId : null
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />
  return (
    <div className="cc-table-wrap" tabIndex={0} aria-label="Audit events, scrollable on small screens">
      <table className="cc-table cc-table--audit">
        <thead>
          <tr>
            <th scope="col">When <span className="cc-table__unit">({shortLabel})</span></th>
            <th scope="col">Event</th>
            <th scope="col">Outcome</th>
            <th scope="col">Actor</th>
            <th scope="col">Target</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const description = describeAuditEvent(row, { selfId })
            const summaryEntries = Object.entries(row.summary ?? {})
            return (
              <tr key={row.id}>
                <td><time dateTime={row.occurred_at} title={formatDateTimeFull(row.occurred_at, zone)}>{formatDateTime(row.occurred_at, zone)}</time></td>
                <td>
                  <span className="cc-event__title">{description.title}</span>
                  <code className="cc-event__code">{row.action}</code>
                </td>
                <td><Badge tone={outcomeTone(row.outcome)}>{row.outcome}</Badge></td>
                <td className="cc-mono" title={row.actor_id ?? undefined}>{description.actor}</td>
                <td className="cc-mono">
                  {row.target_id && row.target_type === 'user'
                    ? <Link to={`${CONSOLE_BASE}/users/${row.target_id}`} className="cc-link" title={row.target_id}>{shortId(row.target_id)}</Link>
                    : row.target_id ? <span title={row.target_id}>{shortId(row.target_id)}</span> : '—'}
                </td>
                <td>
                  {description.detail && <span className="cc-reason">{description.detail}</span>}
                  {summaryEntries.length > 0 && <span className="cc-muted cc-mono cc-wrap">{summaryEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</span>}
                  {!description.detail && summaryEntries.length === 0 && '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AuditPage() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readAuditFilters(params), [params])
  const page = readAuditPage(params)
  const { zone, longLabel } = useTimeZone()
  const [draft, setDraft] = useState<AuditFilters>(filters)
  const [exporting, setExporting] = useState(false)
  const { notify } = useToast()
  const sensitive = useSensitiveAction()

  // Keep the visible controls in step with the URL (back/forward, links from other pages, Clear).
  useEffect(() => { setDraft(filters) }, [filters])

  const apply = (next: AuditFilters, nextPage = 1) => {
    setParams(auditFiltersToParams(next, nextPage))
  }
  const clear = () => {
    setDraft(DEFAULT_AUDIT_FILTERS)
    apply(DEFAULT_AUDIT_FILTERS)
  }

  const queryString = buildAuditQuery(filters, zone)
  const query = useQuery({
    queryKey: ['control', 'audit', queryString, page],
    queryFn: () => controlFetch<AuditResponse>(`audit?${queryString}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: previous => previous,
    retry: (count, error) => !(error instanceof ControlApiError && error.status === 400) && count < 1
  })

  const invalidField = query.isError && query.error instanceof ControlApiError ? invalidFilterField(query.error.reason) : null
  const resultsUsable = Boolean(query.data) && !query.isError
  const canExport = resultsUsable && !exporting && !query.isFetching

  const exportCsv = async () => {
    if (!canExport) return
    setExporting(true)
    try {
      const { blob, filename } = await sensitive(() => controlDownload(`audit?${buildAuditQuery(filters, zone, { format: 'csv' })}`))
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

  const draftDirty = JSON.stringify(draft) !== JSON.stringify(filters)
  const filtered = !isDefaultAuditFilters(filters)
  const exportTitle = !resultsUsable ? 'Export is available once the audit log has loaded successfully.' : query.isFetching ? 'Wait for the current query to finish.' : `Export up to 5,000 rows matching the current filters (${longLabel}).`

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of console access, denials, account changes and exports. Entries cannot be edited or deleted."
        actions={
          <Button variant="default" onClick={() => void exportCsv()} disabled={!canExport} title={exportTitle} aria-describedby="cc-audit-export-help">
            {exporting ? <Spinner label="Exporting…" /> : <><Download size={15} aria-hidden="true" /> Export CSV</>}
          </Button>
        }
      />
      <span id="cc-audit-export-help" className="cc-sr-only">{exportTitle}</span>
      <Panel>
        <form
          className="cc-filters"
          role="search"
          aria-label="Audit log filters"
          onSubmit={event => { event.preventDefault(); apply({ ...draft, action: draft.action.trim(), target: draft.target.trim().toLowerCase() }) }}
        >
          <Field label="Action" htmlFor="cc-audit-action" error={invalidField === 'action' ? 'Not a valid action name.' : null}>
            <select id="cc-audit-action" className="cc-input" value={draft.action} onChange={event => setDraft(current => ({ ...current, action: event.target.value }))}>
              <option value="">All actions</option>
              {auditActionChoices(draft.action).map(name => {
                const known = AUDIT_ACTIONS.find(entry => entry.action === name)
                return <option key={name} value={name}>{known ? `${known.label} (${name})` : name}</option>
              })}
            </select>
          </Field>
          <Field label="Target account ID" htmlFor="cc-audit-target" hint="Full account ID (UUID)" error={invalidField === 'target' ? 'Enter the full account ID.' : null}>
            <input id="cc-audit-target" className="cc-input cc-mono" value={draft.target} onChange={event => setDraft(current => ({ ...current, target: event.target.value }))} maxLength={36} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} inputMode="text" />
          </Field>
          <Field label="From" htmlFor="cc-audit-from" error={invalidField === 'from' ? 'Choose a valid date.' : null}>
            <input id="cc-audit-from" className="cc-input" type="date" value={draft.from} max={draft.to || undefined} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} />
          </Field>
          <Field label="To" htmlFor="cc-audit-to" error={invalidField === 'to' ? 'Choose a date on or after From.' : null}>
            <input id="cc-audit-to" className="cc-input" type="date" value={draft.to} min={draft.from || undefined} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} />
          </Field>
          <Field label="Outcome" htmlFor="cc-audit-outcome" error={invalidField === 'outcome' ? 'Choose an outcome.' : null}>
            <select id="cc-audit-outcome" className="cc-input" value={draft.outcome} onChange={event => setDraft(current => ({ ...current, outcome: event.target.value as AuditOutcomeOption }))}>
              <option value="all">All outcomes</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failed">Failed</option>
            </select>
          </Field>
          <div className="cc-filters__actions">
            <Button type="submit" variant="primary" disabled={query.isFetching && !draftDirty}>Apply filters</Button>
            <Button type="button" variant="ghost" onClick={clear} disabled={!filtered && !draftDirty}><FilterX size={15} aria-hidden="true" /> Clear filters</Button>
          </div>
          <p className="cc-filters__summary" role="status">
            {filters.from || filters.to
              ? <>Dates are whole calendar days in {longLabel}{filters.from && filters.to ? `: ${formatDayRange(filters.from, filters.to)}` : filters.from ? ` from ${formatDayRange(filters.from, filters.from)}` : ` up to ${formatDayRange(filters.to, filters.to)}`}.</>
              : <>Dates and times are shown in {longLabel}.</>}
            {' '}<TimeZoneSwitch />
          </p>
        </form>

        {query.isPending && <Skeleton rows={8} />}
        {query.isError && !query.data && (
          <ErrorState
            message={query.error instanceof Error ? query.error.message : 'The audit log could not be loaded.'}
            onRetry={() => void query.refetch()}
            secondaryAction={filtered ? <Button variant="default" onClick={clear}><FilterX size={15} aria-hidden="true" /> Clear filters</Button> : undefined}
          />
        )}
        {query.isError && query.data && (
          <p className="cc-note cc-note--warn" role="status">
            {query.error instanceof Error ? query.error.message : 'The latest request failed.'} Showing the previous results; export is disabled until a query succeeds.
            {' '}<button type="button" className="cc-link" onClick={() => void query.refetch()}>Try again</button>
          </p>
        )}
        {query.data && (
          <>
            <AuditTable rows={query.data.events} emptyTitle="No matching events" emptyBody={filtered ? 'Try a wider date range or clear the filters.' : 'Console access, denials, account changes and exports appear here once they happen.'} />
            {query.data.total > 0 && <Pager page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={next => apply(filters, next)} />}
          </>
        )}
      </Panel>
    </>
  )
}

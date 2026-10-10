import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowUpRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { controlFetch, type AuditRow, type OverviewResponse } from '../api'
import { Badge, Button, Disclosure, EmptyState, Panel, Segmented, Stat } from '../ui'
import { PageHeader, QueryFrame } from '../pageParts'
import { CONSOLE_BASE, formatDate, formatDateTime, formatDateTimeFull, formatDayRange, formatRelative } from '../policy'
import { useTimeZone, TimeZoneSwitch } from '../time'
import { useControlSession } from '../ControlSession'
import { describeAuditEvent } from '../../lib/control-audit-catalog'

const RANGE_OPTIONS = [
  { value: 'today' as const, label: 'Today' },
  { value: '7d' as const, label: '7 days' },
  { value: '30d' as const, label: '30 days' }
]

/** Background refresh cadence while the page is visible. Figures are aggregated per request, so this stays modest. */
const REFRESH_INTERVAL_MS = 60_000

/** Re-renders on a timer so relative labels ("2 min ago") stay truthful without refetching. */
function useClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export default function OverviewPage() {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d')
  const { zone } = useTimeZone()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['control', 'overview', range, zone],
    queryFn: () => controlFetch<OverviewResponse>(`overview?range=${range}&tz=${encodeURIComponent(zone)}`),
    staleTime: 30_000,
    // One request per interval while the tab is visible; nothing while hidden. React Query
    // de-duplicates concurrent requests for the same key, so focus + interval never double-fetch.
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: previous => previous
  })
  const now = useClock(15_000)

  return (
    <>
      <PageHeader
        title="Overview"
        description="Operational summary for DYPOL Stracker. Figures come from the live database each time they are loaded."
        actions={
          <>
            <Segmented label="Reporting window" value={range} options={RANGE_OPTIONS} onChange={setRange} />
            <TimeZoneSwitch />
            <Button variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: ['control', 'overview'] })} disabled={query.isFetching}>
              <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? 'cc-spin' : ''} /> {query.isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        }
      />
      <QueryFrame query={query} errorLabel="Overview metrics could not be loaded.">
        {data => <OverviewBody data={data} now={now} fetching={query.isFetching} failedRefresh={query.isError} dataUpdatedAt={query.dataUpdatedAt} />}
      </QueryFrame>
    </>
  )
}

function OverviewBody({ data, now, fetching, failedRefresh, dataUpdatedAt }: { data: OverviewResponse; now: number; fetching: boolean; failedRefresh: boolean; dataUpdatedAt: number }) {
  const m = data.metrics
  const { zone, shortLabel, longLabel } = useTimeZone()
  const { phase } = useControlSession()
  const selfId = phase.kind === 'granted' ? phase.session.userId : null
  const windowLabel = formatDayRange(data.range.firstDay, data.range.lastDay)
  const windowPeriod = data.range.key === 'today' ? `Today (${shortLabel})` : `${windowLabel} (${shortLabel})`
  const warnings: Array<{ tone: 'warn' | 'crit'; text: string; to: string }> = []
  if (m.pendingOver3Days > 0) warnings.push({ tone: 'warn', text: `${m.pendingOver3Days} account${m.pendingOver3Days === 1 ? '' : 's'} unconfirmed for more than 3 days`, to: `${CONSOLE_BASE}/users?status=unverified` })
  if (m.suspendedAccounts > 0) warnings.push({ tone: 'warn', text: `${m.suspendedAccounts} account${m.suspendedAccounts === 1 ? ' is' : 's are'} currently suspended`, to: `${CONSOLE_BASE}/users?status=suspended` })
  const failures = data.recentActivity.filter(event => event.outcome !== 'success')
  if (failures.length > 0) warnings.push({ tone: 'crit', text: `${failures.length} recent denied or failed administrative event${failures.length === 1 ? '' : 's'}`, to: `${CONSOLE_BASE}/audit?outcome=denied` })

  const destinationFor = (event: AuditRow): string => {
    if (event.target_type === 'user' && event.target_id) return `${CONSOLE_BASE}/users/${event.target_id}`
    const params = new URLSearchParams({ action: event.action })
    if (event.outcome !== 'success') params.set('outcome', event.outcome)
    return `${CONSOLE_BASE}/audit?${params.toString()}`
  }

  return (
    <div className="cc-stack">
      <div className={`cc-dbline${failedRefresh ? ' cc-dbline--warn' : ''}`} role="status" aria-live="polite">
        {failedRefresh ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
        <span>
          {failedRefresh ? 'Latest refresh failed · showing figures from ' : 'Database responding · '}
          {!failedRefresh && <>{data.database.latencyMs} ms · </>}
          <time dateTime={data.generatedAt} title={formatDateTimeFull(data.generatedAt, zone)}>
            {failedRefresh ? formatDateTime(data.generatedAt, zone) : `updated ${formatRelative(data.generatedAt, now).toLowerCase()}`}
          </time>
          {' '}· window {windowLabel}, {longLabel}
          {fetching ? ' · refreshing…' : ` · refreshes every minute while open`}
        </span>
        {!failedRefresh && dataUpdatedAt > 0 && <span className="cc-sr-only">Last loaded {formatDateTimeFull(new Date(dataUpdatedAt).toISOString(), zone)}</span>}
      </div>

      <div className="cc-kpis">
        <Stat label="Accounts" value={m.totalAccounts.toLocaleString()} period="All time" hint="All registered accounts" to={`${CONSOLE_BASE}/users`} linkLabel="Open Users" />
        <Stat label="Registrations" value={m.registrations.toLocaleString()} period={windowPeriod} hint="Accounts created in this window" />
        <Stat label="Verified" value={m.verifiedRatePercent === null ? '—' : `${m.verifiedRatePercent}%`} period="All time" hint={`${m.verifiedAccounts.toLocaleString()} confirmed emails`} tone="ok" to={`${CONSOLE_BASE}/users?status=verified`} linkLabel="Open verified accounts" />
        <Stat label="Pending confirmation" value={m.pendingConfirmation.toLocaleString()} period="All time" hint={`${m.pendingOver3Days} older than 3 days`} tone={m.pendingOver3Days > 0 ? 'warn' : undefined} to={`${CONSOLE_BASE}/users?status=unverified`} linkLabel="Review unconfirmed accounts" />
        <Stat label="Active" value={m.activeAccounts.toLocaleString()} period={windowPeriod} hint="Accounts whose latest sign-in fell in this window (lower bound)" />
        <Stat label="Suspended" value={m.suspendedAccounts.toLocaleString()} period="All time" hint="Sign-in currently disabled" tone={m.suspendedAccounts > 0 ? 'warn' : undefined} to={`${CONSOLE_BASE}/users?status=suspended`} linkLabel="Open suspended accounts" />
        <Stat label="Tests logged" value={m.testsLogged.toLocaleString()} period={windowPeriod} hint="Test journal rows created in this window" />
        <Stat label="Tracker adoption" value={m.trackerAdoptionPercent === null ? '—' : `${m.trackerAdoptionPercent}%`} period="All time" hint={`${m.accountsWithTests.toLocaleString()} accounts with at least one test`} />
      </div>

      <div className="cc-grid cc-grid--main">
        <Panel title="Registration trend" description={`Accounts created per calendar day (${longLabel}). “Verified” counts accounts from that day whose email is confirmed now.`}>
          <RegistrationChart series={data.series} />
        </Panel>

        <Panel title="Attention" description="Items that need a decision. Each one opens the page where you can act.">
          {warnings.length === 0 ? (
            <EmptyState title="Nothing needs attention" body="No warnings for this window. Warnings are computed from the same figures shown here." />
          ) : (
            <ul className="cc-list">
              {warnings.map(warning => (
                <li key={warning.text}>
                  <Badge tone={warning.tone}>{warning.tone === 'crit' ? 'Critical' : 'Review'}</Badge>
                  <span>{warning.text}</span>
                  <Link to={warning.to} className="cc-link cc-link--icon">Open <ArrowUpRight size={14} aria-hidden="true" /></Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="cc-grid cc-grid--main">
        <Panel
          title="Recent administrative activity"
          description="The latest audit events across the console. Select a row to open the account or the matching audit view."
          actions={<Link to={`${CONSOLE_BASE}/audit`} className="cc-link cc-link--icon">Full audit log <ArrowUpRight size={14} aria-hidden="true" /></Link>}
        >
          {data.recentActivity.length === 0 ? (
            <EmptyState title="No administrative activity yet" body="Console access, owner actions, denied attempts and exports appear here once they happen." />
          ) : (
            <ul className="cc-activity">
              {data.recentActivity.map(event => {
                const description = describeAuditEvent(event, { selfId })
                const to = destinationFor(event)
                return (
                  <li key={event.id}>
                    <Link
                      to={to}
                      className="cc-activity__row"
                      aria-label={`${description.title}, ${event.outcome}, by ${description.actor}, ${formatDateTimeFull(event.occurred_at, zone)}`}
                    >
                      <Badge tone={event.outcome === 'success' ? 'ok' : event.outcome === 'denied' ? 'warn' : 'crit'}>{event.outcome}</Badge>
                      <span className="cc-activity__text">
                        <span className="cc-activity__title">{description.title}</span>
                        <span className="cc-activity__meta">
                          <span>by <span className="cc-mono">{description.actor}</span></span>
                          {description.detail && <span> · {description.detail}</span>}
                        </span>
                      </span>
                      <time className="cc-activity__time" dateTime={event.occurred_at} title={formatDateTimeFull(event.occurred_at, zone)}>
                        <span>{formatRelative(event.occurred_at, now)}</span>
                        <span className="cc-muted">{formatDateTime(event.occurred_at, zone)}</span>
                      </time>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Quick actions" description="Common owner tasks.">
          <div className="cc-quick">
            <Link to={`${CONSOLE_BASE}/users`}>Find an account</Link>
            <Link to={`${CONSOLE_BASE}/users?status=unverified`}>Review unconfirmed accounts</Link>
            <Link to={`${CONSOLE_BASE}/audit`}>Search the audit log</Link>
            <Link to={`${CONSOLE_BASE}/health`}>Run system health checks</Link>
            <Link to={`${CONSOLE_BASE}/security`}>Open the security center</Link>
          </div>
        </Panel>
      </div>

      <Disclosure summary="How these figures are defined" className="cc-definitions">
        <dl>
          {Object.entries(data.definitions).map(([key, text]) => (
            <div key={key}><dt>{labelFor(key)}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      </Disclosure>
    </div>
  )
}

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    totalAccounts: 'Accounts',
    registrations: 'Registrations',
    verifiedRatePercent: 'Verified rate',
    pendingConfirmation: 'Pending confirmation',
    pendingOver3Days: 'Pending more than 3 days',
    activeAccounts: 'Active accounts',
    suspendedAccounts: 'Suspended',
    testsLogged: 'Tests logged',
    trackerAdoptionPercent: 'Tracker adoption'
  }
  return labels[key] ?? key
}

/** Width of the chart's container, so the SVG is drawn at device pixels and text never stretches. */
function useMeasuredWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width || fallback)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [fallback])
  return [ref, width]
}

function RegistrationChart({ series }: { series: OverviewResponse['series'] }) {
  const [host, width] = useMeasuredWidth<HTMLElement>(640)
  const total = series.reduce((sum, row) => sum + row.registrations, 0)
  if (series.length === 0 || total === 0) {
    return <EmptyState title="No registrations in this window" body="The trend fills in as accounts are created. Days with no sign-ups are shown as zero." />
  }
  const height = 220
  const pad = { top: 18, right: 8, bottom: 30, left: 34 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const max = Math.max(1, ...series.map(row => row.registrations))
  const slot = innerW / series.length
  const barW = Math.max(4, Math.min(36, slot * 0.62))
  // Label density follows the available pixels, not a fixed count, so narrow screens stay legible.
  const labelEvery = Math.max(1, Math.ceil(44 / slot))
  const showValues = slot >= 26
  const peakDay = series.reduce((best, row) => (row.registrations > best.registrations ? row : best), series[0]!)
  const summary = `${total} registration${total === 1 ? '' : 's'} across ${series.length} day${series.length === 1 ? '' : 's'}. Peak ${peakDay.registrations} on ${formatDate(peakDay.day)}.`
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return (
    <figure className="cc-chart" ref={host}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary}>
        {[0, 0.5, 1].map(step => {
          const y = pad.top + innerH - step * innerH
          return (
            <g key={step}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="cc-chart__grid" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" className="cc-chart__tick">{Math.round(max * step)}</text>
            </g>
          )
        })}
        {series.map((row, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2
          const h = (row.registrations / max) * innerH
          const verifiedH = row.registrations > 0 ? (row.verified / max) * innerH : 0
          const title = `${formatDate(row.day)}: ${row.registrations} registered, ${row.verified} verified now`
          return (
            <g key={row.day} className="cc-chart__day">
              <title>{title}</title>
              <rect x={pad.left + index * slot} y={pad.top} width={slot} height={innerH} className="cc-chart__hit" />
              <rect x={x} y={pad.top + innerH - Math.max(h, row.registrations ? 2 : 0)} width={barW} height={Math.max(h, row.registrations ? 2 : 0)} rx={2} className="cc-chart__bar" />
              {verifiedH > 0 && <rect x={x} y={pad.top + innerH - verifiedH} width={barW} height={verifiedH} rx={2} className="cc-chart__verified" pointerEvents="none" />}
              {showValues && row.registrations > 0 && (
                <text x={x + barW / 2} y={pad.top + innerH - Math.max(h, 2) - 5} textAnchor="middle" className="cc-chart__value">{row.registrations}</text>
              )}
              {index % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="cc-chart__tick">{dayLabel(row.day)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="cc-legend">
        <span><i className="cc-swatch cc-swatch--bar" /> Registered</span>
        <span><i className="cc-swatch cc-swatch--verified" /> Of which verified now</span>
        <span className="cc-muted">{total} in window · peak {peakDay.registrations} on {dayLabel(peakDay.day)}</span>
      </figcaption>
    </figure>
  )
}

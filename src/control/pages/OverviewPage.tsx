import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowUpRight, CircleCheck } from 'lucide-react'
import { controlFetch, type OverviewResponse } from '../api'
import { Badge, Button, EmptyState, Panel, Segmented, Stat } from '../ui'
import { PageHeader, QueryFrame } from '../pageParts'
import { CONSOLE_BASE, formatDate, formatDateTime, formatRelative } from '../policy'

const RANGE_OPTIONS = [
  { value: 'today' as const, label: 'Today' },
  { value: '7d' as const, label: '7 days' },
  { value: '30d' as const, label: '30 days' }
]

export default function OverviewPage() {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d')
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['control', 'overview', range],
    queryFn: () => controlFetch<OverviewResponse>(`overview?range=${range}`),
    staleTime: 60_000
  })

  return (
    <>
      <PageHeader
        title="Overview"
        description="Operational summary for DYPOL Stracker. Figures come from the live database; windows are UTC days."
        actions={
          <>
            <Segmented label="Reporting window" value={range} options={RANGE_OPTIONS} onChange={setRange} />
            <Button variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: ['control', 'overview'] })} disabled={query.isFetching}>
              <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? 'cc-spin' : ''} /> Refresh
            </Button>
          </>
        }
      />
      <QueryFrame query={query} errorLabel="Overview metrics could not be loaded.">
        {data => <OverviewBody data={data} />}
      </QueryFrame>
    </>
  )
}

function OverviewBody({ data }: { data: OverviewResponse }) {
  const m = data.metrics
  const warnings: Array<{ tone: 'warn' | 'crit'; text: string; to: string }> = []
  if (m.pendingOver3Days > 0) warnings.push({ tone: 'warn', text: `${m.pendingOver3Days} account${m.pendingOver3Days === 1 ? '' : 's'} unconfirmed for more than 3 days`, to: `${CONSOLE_BASE}/users?status=unverified` })
  if (m.suspendedAccounts > 0) warnings.push({ tone: 'warn', text: `${m.suspendedAccounts} account${m.suspendedAccounts === 1 ? ' is' : 's are'} currently suspended`, to: `${CONSOLE_BASE}/users?status=suspended` })
  const failures = data.recentActivity.filter(event => event.outcome !== 'success')
  if (failures.length > 0) warnings.push({ tone: 'crit', text: `${failures.length} recent denied or failed administrative event${failures.length === 1 ? '' : 's'}`, to: `${CONSOLE_BASE}/audit?outcome=denied` })

  return (
    <div className="cc-stack">
      <div className="cc-dbline" role="status">
        <CircleCheck size={15} aria-hidden="true" /> Database responding · {data.database.latencyMs} ms · data generated {formatRelative(data.generatedAt)} · window {formatDate(data.range.since)} – {formatDate(data.range.until)} (UTC, exclusive end)
      </div>

      <div className="cc-kpis">
        <Stat label="Accounts" value={m.totalAccounts.toLocaleString()} hint="All registered accounts" />
        <Stat label="Registrations" value={m.registrations.toLocaleString()} hint="Created in this window" />
        <Stat label="Verified" value={m.verifiedRatePercent === null ? '—' : `${m.verifiedRatePercent}%`} hint={`${m.verifiedAccounts.toLocaleString()} confirmed emails`} tone="ok" />
        <Stat label="Pending confirmation" value={m.pendingConfirmation.toLocaleString()} hint={`${m.pendingOver3Days} older than 3 days`} tone={m.pendingOver3Days > 0 ? 'warn' : undefined} />
        <Stat label="Active (last sign-in)" value={m.activeAccounts.toLocaleString()} hint="Lower bound: last sign-in only" />
        <Stat label="Suspended" value={m.suspendedAccounts.toLocaleString()} hint="Sign-in disabled" tone={m.suspendedAccounts > 0 ? 'warn' : undefined} />
        <Stat label="Tests logged" value={m.testsLogged.toLocaleString()} hint="Test journal rows in window" />
        <Stat label="Tracker adoption" value={m.trackerAdoptionPercent === null ? '—' : `${m.trackerAdoptionPercent}%`} hint={`${m.accountsWithTests.toLocaleString()} accounts with a test (all time)`} />
      </div>

      <div className="cc-grid cc-grid--main">
        <Panel title="Registration trend" description={`Accounts created per UTC day. “Verified” counts accounts from that day whose email is confirmed now.`}>
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
        <Panel title="Recent administrative activity" description="The latest audit events across the console." actions={<Link to={`${CONSOLE_BASE}/audit`} className="cc-link">Full audit log</Link>}>
          {data.recentActivity.length === 0 ? (
            <EmptyState title="No administrative activity yet" body="Owner actions, denied attempts and exports appear here once they happen." />
          ) : (
            <ul className="cc-list cc-list--dense">
              {data.recentActivity.map(event => (
                <li key={event.id}>
                  <Badge tone={event.outcome === 'success' ? 'ok' : event.outcome === 'denied' ? 'warn' : 'crit'}>{event.outcome}</Badge>
                  <code>{event.action}</code>
                  <span className="cc-muted">{formatDateTime(event.occurred_at)}</span>
                </li>
              ))}
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

      <details className="cc-definitions">
        <summary>How these figures are defined</summary>
        <dl>
          {Object.entries(data.definitions).map(([key, text]) => (
            <div key={key}><dt>{labelFor(key)}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  )
}

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    registrations: 'Registrations',
    verifiedRatePercent: 'Verified rate',
    pendingConfirmation: 'Pending confirmation',
    activeAccounts: 'Active accounts',
    testsLogged: 'Tests logged',
    trackerAdoptionPercent: 'Tracker adoption'
  }
  return labels[key] ?? key
}

function RegistrationChart({ series }: { series: OverviewResponse['series'] }) {
  const total = series.reduce((sum, row) => sum + row.registrations, 0)
  if (series.length === 0 || total === 0) {
    return <EmptyState title="No registrations in this window" body="The trend fills in as accounts are created. Days with no sign-ups are shown as zero." />
  }
  const width = 640
  const height = 200
  const pad = { top: 12, right: 8, bottom: 28, left: 32 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const max = Math.max(1, ...series.map(row => row.registrations))
  const slot = innerW / series.length
  const barW = Math.max(3, Math.min(28, slot * 0.6))
  const labelEvery = Math.ceil(series.length / 8)
  const summary = `${total} registrations across ${series.length} days. Peak ${max} on one day.`
  return (
    <figure className="cc-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} preserveAspectRatio="none">
        {[0, 0.5, 1].map(step => {
          const y = pad.top + innerH - step * innerH
          return (
            <g key={step}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="cc-chart__grid" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" className="cc-chart__tick">{Math.round(max * step)}</text>
            </g>
          )
        })}
        {series.map((row, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2
          const h = (row.registrations / max) * innerH
          const verifiedH = row.registrations > 0 ? (row.verified / max) * innerH : 0
          return (
            <g key={row.day}>
              <rect x={x} y={pad.top + innerH - h} width={barW} height={Math.max(h, row.registrations ? 2 : 0)} rx={2} className="cc-chart__bar">
                <title>{`${formatDate(row.day)}: ${row.registrations} registered, ${row.verified} verified now`}</title>
              </rect>
              {verifiedH > 0 && <rect x={x} y={pad.top + innerH - verifiedH} width={barW} height={verifiedH} rx={2} className="cc-chart__verified" pointerEvents="none" />}
              {index % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="cc-chart__tick">{formatDate(row.day).replace(/, \d{4}$/, '')}</text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="cc-legend">
        <span><i className="cc-swatch cc-swatch--bar" /> Registered</span>
        <span><i className="cc-swatch cc-swatch--verified" /> Of which verified now</span>
        <span className="cc-muted">{total} in window</span>
      </figcaption>
    </figure>
  )
}

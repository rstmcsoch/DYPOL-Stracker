import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { controlFetch, type HealthResponse } from '../api'
import { Badge, Button, Panel, Skeleton, ErrorState, Stat, type Tone } from '../ui'
import { PageHeader } from '../pageParts'
import { formatDateTime } from '../policy'

const STATUS_TONE: Record<string, Tone> = { healthy: 'ok', degraded: 'warn', unavailable: 'crit', unknown: 'neutral' }
const STATUS_LABEL: Record<string, string> = { healthy: 'Healthy', degraded: 'Degraded', unavailable: 'Unavailable', unknown: 'Unknown' }

export default function HealthPage() {
  const queryClient = useQueryClient()
  // No background polling: checks run on open and on demand, to keep database and auth load low.
  const query = useQuery({
    queryKey: ['control', 'health'],
    queryFn: () => controlFetch<HealthResponse>('health'),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false
  })

  return (
    <>
      <PageHeader
        title="System health"
        description="Bounded, read-only checks: each runs once per request with a timeout. No check is marked healthy unless it succeeded."
        actions={
          <Button variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: ['control', 'health'] })} disabled={query.isFetching}>
            <RefreshCw size={15} aria-hidden="true" className={query.isFetching ? 'cc-spin' : ''} /> {query.isFetching ? 'Checking…' : 'Run checks'}
          </Button>
        }
      />
      {query.isPending && <Skeleton rows={5} />}
      {query.isError && !query.data && <ErrorState message={query.error instanceof Error ? query.error.message : 'Health checks could not run.'} onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <div className="cc-kpis cc-kpis--compact">
            <Stat label="Overall" value={STATUS_LABEL[query.data.overall] ?? query.data.overall} tone={STATUS_TONE[query.data.overall]} hint={`Checked ${formatDateTime(query.data.checkedAt)}`} />
            <Stat label="Deployment" value={query.data.deployment.commit ?? 'Unknown'} hint={`Environment: ${query.data.deployment.environment}`} />
          </div>
          <Panel title="Checks">
            <div className="cc-table-wrap" tabIndex={0}>
              <table className="cc-table">
                <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col" className="is-num">Latency</th><th scope="col">Detail</th></tr></thead>
                <tbody>
                  {query.data.checks.map(check => (
                    <tr key={check.id}>
                      <th scope="row">{check.label}</th>
                      <td><Badge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge></td>
                      <td className="is-num">{check.latencyMs === null ? '—' : `${check.latencyMs} ms`}</td>
                      <td className="cc-wrap">{check.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="cc-note">Not measured by this console: uptime percentages, error-log rates, background job queues. They are not shown rather than estimated.</p>
        </>
      )}
    </>
  )
}

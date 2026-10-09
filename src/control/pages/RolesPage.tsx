import { useQuery } from '@tanstack/react-query'
import { controlFetch } from '../api'
import { Badge, EmptyState, Panel, Skeleton, ErrorState } from '../ui'
import { PageHeader } from '../pageParts'
import { formatDateTime } from '../policy'

interface RolesResponse {
  assignments: Array<{ userId: string; email: string; role: string; grantedAt: string; revokedAt: string | null; active: boolean }>
}

const ROLE_MODEL = [
  { role: 'owner', status: 'Active', tone: 'ok' as const, text: 'Full console access, including access changes, exports and this page. Protected by the server role check and aal2 on every request.' },
  { role: 'administrator', status: 'Not granted to console', tone: 'neutral' as const, text: 'Defined in the database for future delegation. No console permission is attached yet.' },
  { role: 'support', status: 'Not granted to console', tone: 'neutral' as const, text: 'Reserved for limited account lookup. Not yet implemented.' },
  { role: 'analyst', status: 'Not granted to console', tone: 'neutral' as const, text: 'Reserved for read-only aggregate analytics. Not yet implemented.' }
]

export default function RolesPage() {
  const query = useQuery({ queryKey: ['control', 'roles'], queryFn: () => controlFetch<RolesResponse>('roles'), staleTime: 60_000 })

  return (
    <>
      <PageHeader title="Access & roles" description="Who holds administrative roles. Roles are assigned only through the owner provisioning procedure, never from this console." />
      <Panel title="Role assignments" description="Read from the trusted role table. Revoked assignments are kept for history.">
        {query.isPending && <Skeleton rows={3} />}
        {query.isError && <ErrorState message={query.error instanceof Error ? query.error.message : 'Roles could not be loaded.'} onRetry={() => void query.refetch()} />}
        {query.data && (query.data.assignments.length === 0 ? (
          <EmptyState title="No role assignments" body="Run the owner provisioning procedure to assign the initial owner." />
        ) : (
          <div className="cc-table-wrap" tabIndex={0}>
            <table className="cc-table">
              <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col">Granted</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {query.data.assignments.map(item => (
                  <tr key={`${item.userId}-${item.grantedAt}`}>
                    <td>{item.email || <span className="cc-mono">{item.userId.slice(0, 8)}…</span>}</td>
                    <td><code>{item.role}</code></td>
                    <td>{formatDateTime(item.grantedAt)}</td>
                    <td>{item.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Revoked {formatDateTime(item.revokedAt)}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Panel title="Role model" description="What each role may do in the console. Only the owner has permissions today.">
        <ul className="cc-roles">
          {ROLE_MODEL.map(item => (
            <li key={item.role}>
              <div><code>{item.role}</code> <Badge tone={item.tone}>{item.status}</Badge></div>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
        <p className="cc-note">Changing a role is a deliberate operator procedure: see “Owner provisioning” and “Ownership transfer” in docs/control-center.md. The console grants no roles and cannot raise a user’s privilege.</p>
      </Panel>
    </>
  )
}

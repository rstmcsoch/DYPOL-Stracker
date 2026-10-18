import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { controlFetch, type UsersResponse } from '../api'
import { Badge, EmptyState, Panel, Skeleton, ErrorState, Pager } from '../ui'
import { PageHeader } from '../pageParts'
import { CONSOLE_BASE, formatDate, formatRelative } from '../policy'
import { useTimeZone } from '../time'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: 'all', label: 'All accounts' },
  { value: 'verified', label: 'Email verified' },
  { value: 'unverified', label: 'Email not verified' },
  { value: 'suspended', label: 'Suspended' }
]
const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'last_sign_in', label: 'Last signed in' }
]

function oneOf(value: string | null, options: Array<{ value: string }>, fallback: string): string {
  return options.some(option => option.value === value) ? (value as string) : fallback
}

export default function UsersPage() {
  const [params, setParams] = useSearchParams()
  const { zone } = useTimeZone()
  const initialQuery = params.get('q') ?? ''
  const [search, setSearch] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const status = oneOf(params.get('status'), STATUS_OPTIONS, 'all')
  const sort = oneOf(params.get('sort'), SORT_OPTIONS, 'created_desc')
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.get('page') ?? '1', 10) || 1))

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (debounced === initialQuery) return
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (debounced) next.set('q', debounced); else next.delete('q')
      next.delete('page')
      return next
    }, { replace: true })
  }, [debounced, initialQuery, setParams])

  const update = (changes: Record<string, string | null>) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '' || value === 'all' || value === 'created_desc') next.delete(key); else next.set(key, value)
      }
      if (!('page' in changes)) next.delete('page')
      return next
    })
  }

  const query = useQuery({
    queryKey: ['control', 'users', debounced, status, sort, page],
    queryFn: () => controlFetch<UsersResponse>(`users?q=${encodeURIComponent(debounced)}&status=${status}&sort=${sort}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: previous => previous
  })

  return (
    <>
      <PageHeader title="Users" description="Search and review Stracker accounts. Study content is never shown in this directory." />
      <Panel>
        <div className="cc-toolbar" role="search">
          <div className="cc-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Email, display name, or full account ID"
              aria-label="Search accounts"
              maxLength={120}
            />
          </div>
          <label className="cc-select">
            <span className="cc-sr-only">Filter by status</span>
            <select value={status} onChange={event => update({ status: event.target.value })}>
              {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="cc-select">
            <span className="cc-sr-only">Sort order</span>
            <select value={sort} onChange={event => update({ sort: event.target.value })}>
              {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {query.isPending && <Skeleton rows={8} height={20} />}
        {query.isError && !query.data && (
          <ErrorState message={query.error instanceof Error ? query.error.message : 'The directory could not be loaded.'} onRetry={() => void query.refetch()} />
        )}
        {query.data && (
          <>
            {query.data.users.length === 0 ? (
              <EmptyState
                title={debounced || status !== 'all' ? 'No accounts match these filters' : 'No accounts yet'}
                body={debounced || status !== 'all' ? 'Clear the search or change the status filter to see more accounts.' : 'Accounts appear here after people register for Stracker.'}
              />
            ) : (
              <div className="cc-table-wrap" tabIndex={0} aria-label="Accounts table, scrollable horizontally on small screens">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Email</th>
                      <th scope="col">Registered</th>
                      <th scope="col">Last sign-in</th>
                      <th scope="col" className="is-num">Tests</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.users.map(user => (
                      <tr key={user.id}>
                        <th scope="row">
                          <Link to={`${CONSOLE_BASE}/users/${user.id}`} className="cc-link cc-link--strong">{user.displayName || 'No display name'}</Link>
                          <span className="cc-mono cc-muted">{user.id.slice(0, 8)}…</span>
                        </th>
                        <td>{user.email}</td>
                        <td>{formatDate(user.createdAt, zone)}</td>
                        <td>{formatRelative(user.lastSignInAt)}</td>
                        <td className="is-num">{user.testsCount}</td>
                        <td>
                          <div className="cc-badges">
                            {user.emailConfirmedAt ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Unconfirmed</Badge>}
                            {user.suspended ? <Badge tone="crit">Suspended</Badge> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {query.data.total > 0 && (
              <Pager page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={next => update({ page: String(next) })} />
            )}
          </>
        )}
      </Panel>
    </>
  )
}

import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, Skeleton } from './ui'

/** Shared loading / error frame for a query-backed page section. */
export function QueryFrame<T>({ query, children, skeletonRows = 6, errorLabel }: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown; dataUpdatedAt: number; isFetching: boolean }
  children: (data: T) => ReactNode
  skeletonRows?: number
  errorLabel?: string
}) {
  if (query.isPending) return <Skeleton rows={skeletonRows} />
  if (query.isError && !query.data) {
    const message = query.error instanceof Error ? query.error.message : 'The request failed.'
    return <ErrorState message={`${errorLabel ? `${errorLabel} ` : ''}${message}`} onRetry={() => void query.refetch()} />
  }
  return (
    <>
      {query.isError && query.data && (
        <p className="cc-note cc-note--warn" role="status">The latest refresh failed. Showing data from {new Date(query.dataUpdatedAt).toLocaleTimeString()}.</p>
      )}
      {children(query.data as T)}
    </>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="cc-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="cc-page-header__actions">{actions}</div>}
    </div>
  )
}

export function Crumb({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="cc-link">{children}</Link>
}

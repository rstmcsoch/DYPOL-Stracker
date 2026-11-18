import { Navigate, useLocation } from 'react-router-dom'

/**
 * `/retry` used to be its own page: an 80-line view of the mistakes already flagged
 * "retry later". It is now the second tab of the Mistake notebook (where the mistakes
 * actually live), so this route only forwards old links, bookmarks and notification
 * deep links to `/mistakes?tab=retry`. Nothing is lost, and there is one place for
 * mistakes instead of two.
 */
export default function RetryPage() {
  const location = useLocation()
  return <Navigate to={`/mistakes?tab=retry${location.search ? `&${location.search.replace(/^\?/, '')}` : ''}`} replace />
}

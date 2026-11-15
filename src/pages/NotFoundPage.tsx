import { lazy, Suspense } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Compass, Home } from 'lucide-react'
import { NotebookCard } from '../components/ui'

// The public frame (header, footer, homepage styles) loads only for signed-out visitors.
const PublicNotFoundShell = lazy(() => import('../components/public/PublicNotFoundShell'))

/**
 * In-app "Page not found" view for unknown addresses and links to records that do not exist.
 * The address is shown only as the path the browser already holds; nothing is logged.
 */
export default function NotFoundPage({ signedIn = true }: { signedIn?: boolean }) {
  const location = useLocation()
  const body = <NotebookCard className="not-found-card" role="region" aria-labelledby="not-found-title">
    <span className="not-found-mark" aria-hidden="true"><Compass size={26} /></span>
    <span className="eyebrow">404 · PAGE NOT FOUND</span>
    <h1 id="not-found-title">This page isn’t in your notebook.</h1>
    <p>There is nothing at <code>{location.pathname}</code>. The link may be mistyped, or the item it pointed to was removed.</p>
    <div className="not-found-actions">
      <Link className="button type-button button-primary button-md" to="/"><Home size={16} aria-hidden="true" /> {signedIn ? 'Back to Home' : 'Go to the homepage'}</Link>
      {!signedIn && <Link className="button type-button button-secondary button-md" to="/login">Log in</Link>}
    </div>
  </NotebookCard>
  if (signedIn) return <div className="content-page not-found-page">{body}</div>
  return <Suspense fallback={<main className="not-found-public">{body}</main>}>
    <PublicNotFoundShell>{body}</PublicNotFoundShell>
  </Suspense>
}

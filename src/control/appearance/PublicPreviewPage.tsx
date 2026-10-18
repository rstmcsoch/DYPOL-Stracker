import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { controlFetch } from '../api'
import { APPEARANCE_QUERY_KEY, type AppearanceState } from './ContentEditor'
import { SiteContentProvider } from '../../contexts/SiteContentContext'

const LandingPage = lazy(() => import('../../pages/LandingPage'))

/**
 * Renders the public homepage with the saved draft (or the live copy when no draft exists).
 * It reads the owner-only appearance state, so draft text is never served to the public.
 * Mounted inside the console route, under the same owner gate, and it is not indexed.
 */
export default function PublicPreviewPage() {
  const query = useQuery({
    queryKey: [...APPEARANCE_QUERY_KEY, 'state'],
    queryFn: () => controlFetch<AppearanceState>('appearance-state'),
    staleTime: 15_000
  })
  if (query.isError) return <p className="cc-preview-message">The preview could not be loaded. Reload to try again.</p>
  if (!query.data) return <p className="cc-preview-message">Loading preview…</p>
  const overrides = query.data.draft.exists ? query.data.draft.overrides : query.data.published.overrides
  return (
    <SiteContentProvider overrides={overrides}>
      <Suspense fallback={<p className="cc-preview-message">Loading preview…</p>}>
        <LandingPage />
      </Suspense>
    </SiteContentProvider>
  )
}

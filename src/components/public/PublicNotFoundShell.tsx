import type { ReactNode } from 'react'
import { PublicPageShell } from './PublicPageShell'

/** Public 404 frame: the shared public header, footer and theme around the not-found card. */
export default function PublicNotFoundShell({ children }: { children: ReactNode }) {
  return <PublicPageShell title="Page not found">
    <div className="not-found-public">{children}</div>
  </PublicPageShell>
}

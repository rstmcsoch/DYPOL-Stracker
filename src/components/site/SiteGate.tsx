import type { ReactNode } from 'react'
import { LogOut, Wrench } from 'lucide-react'
import { NotebookCard } from '../ui'
import { useAuth } from '../../contexts/AuthContext'
import { useSiteStatus } from './SiteStatusContext'
import { DEFAULT_MAINTENANCE_MESSAGE, siteGateDecision, type SiteGateKind } from '../../lib/site-status'

/** Thin notice above a page while maintenance is announced (or, for the team, while the site is down). */
export function MaintenanceNotice({ message, staff = false }: { message: string; staff?: boolean }) {
  return <div className="site-notice" role="status">
    <Wrench size={15} aria-hidden="true" />
    <span>{staff ? <><strong>Site is down for visitors.</strong> You can still use it. </> : null}{message || DEFAULT_MAINTENANCE_MESSAGE}</span>
  </div>
}

export function MaintenancePage({ message }: { message: string }) {
  const { user, signOut } = useAuth()
  return <main className="not-found-public maintenance-page">
    <NotebookCard className="not-found-card" role="region" aria-labelledby="maintenance-title">
      <span className="not-found-mark" aria-hidden="true"><Wrench size={26} /></span>
      <span className="eyebrow">MAINTENANCE</span>
      <h1 id="maintenance-title">We’ll be right back.</h1>
      <p>{message || DEFAULT_MAINTENANCE_MESSAGE}</p>
      <p className="maintenance-foot">Your notebook and study records are safe. Stracker by DYPOL LABS</p>
      {user && !user.isLocal && <div className="not-found-actions">
        <button type="button" className="button type-button button-secondary button-md" onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" /> Sign out</button>
      </div>}
    </NotebookCard>
  </main>
}

/**
 * Applies the console's site switches to a page. kind: 'public' (homepage, info pages, sign-up),
 * 'app' (the signed-in notebook), 'auth' (log in, password reset, OAuth callback: always
 * reachable so the team can sign in during an outage).
 */
export function SiteGate({ kind, children }: { kind: SiteGateKind; children: ReactNode }) {
  const { status, ready, teamMember } = useSiteStatus()
  const { user } = useAuth()
  if (!ready) return <div className="route-loading"><span>Just a moment…</span></div>
  const decision = siteGateDecision(status, kind, Boolean(user && !user.isLocal), teamMember)
  if (decision === 'maintenance-page') return <MaintenancePage message={status.maintenanceMessage} />
  if (decision === 'render-with-notice') return <>
    <MaintenanceNotice message={status.maintenanceMessage} staff={status.siteDown && kind !== 'auth'} />
    {children}
  </>
  return <>{children}</>
}

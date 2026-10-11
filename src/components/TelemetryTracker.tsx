import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { installTelemetry, setTelemetryUser, track, trackingAllowed } from '../lib/telemetry/client'
import { cleanRoute, featureForRoute } from '../lib/telemetry/taxonomy'

/**
 * Records page views, notebook feature opens, homepage CTA clicks and section views.
 * Renders nothing. Inert when Do Not Track / Global Privacy Control is on.
 */
export function TelemetryTracker() {
  const location = useLocation()
  const { user, loading } = useAuth()
  const signedIn = Boolean(user && !user.isLocal)
  const lastPath = useRef<string | null>(null)

  useEffect(() => { installTelemetry() }, [])
  useEffect(() => { setTelemetryUser(signedIn ? user?.id ?? null : null, Boolean(user)) }, [signedIn, user])

  useEffect(() => {
    if (loading || !trackingAllowed()) return
    const route = cleanRoute(location.pathname)
    if (lastPath.current === route) return
    lastPath.current = route
    track('page_view', { title: document.title.slice(0, 80) })
    if (user && !/^\/control-panel(\/|$)/.test(route) && !/^\/(login|signup|reset-password)/.test(route)) {
      track('feature_opened', { feature: featureForRoute(route) })
      if (route === '/') track('dashboard_viewed')
    }
  }, [location.pathname, loading, user])

  // Homepage/header/footer calls to action: any link to /signup or /login outside the notebook.
  useEffect(() => {
    if (!trackingAllowed()) return
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (!/^\/(signup|login)\b/.test(href)) return
      const placement = link.closest('header') ? 'header' : link.closest('footer') ? 'footer' : link.closest('section')?.getAttribute('aria-labelledby')?.replace(/-title$/, '') ?? 'page'
      track('cta_clicked', { cta: href.slice(1, 40), placement })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  // Public homepage sections seen (≥50% visible), once per page view.
  useEffect(() => {
    if (user || location.pathname !== '/' || !trackingAllowed() || typeof IntersectionObserver === 'undefined') return
    const seen = new Set<string>()
    let observer: IntersectionObserver | null = null
    const start = window.setTimeout(() => {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const section = entry.target.getAttribute('aria-labelledby')?.replace(/-title$/, '')
          if (!entry.isIntersecting || !section || seen.has(section)) continue
          seen.add(section)
          track('section_viewed', { section })
        }
      }, { threshold: 0.5 })
      document.querySelectorAll('section[aria-labelledby]').forEach(node => observer?.observe(node))
    }, 800)
    return () => { clearTimeout(start); observer?.disconnect() }
  }, [location.pathname, user])

  return null
}

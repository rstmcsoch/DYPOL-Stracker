import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { ControlSessionProvider, useControlSession } from './ControlSession'
import { ControlLayout } from './ControlLayout'
import { AccessDenied, GateError, MfaGate, SignInGate } from './gates'
import { ReauthProvider } from './reauth'
import { TimeZoneProvider } from './time'
import { Skeleton } from './ui'
import { CONSOLE_BASE, CONSOLE_NAME } from './policy'
import './control.css'

const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const UserDetailPage = lazy(() => import('./pages/UserDetailPage'))
const RolesPage = lazy(() => import('./pages/RolesPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const SecurityPage = lazy(() => import('./pages/SecurityPage'))
const HealthPage = lazy(() => import('./pages/HealthPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))

/**
 * Entry point for /control-panel/*. It is lazy-loaded by the application router, so the
 * console's code and styles are not part of the public homepage or the student notebook.
 */
export default function ControlPanelApp() {
  return (
    <div className="cc-root">
      <ControlSessionProvider>
        <TimeZoneProvider>
          <ControlRouter />
        </TimeZoneProvider>
      </ControlSessionProvider>
    </div>
  )
}

function useRobotsDirective() {
  useEffect(() => {
    const previousTitle = document.title
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousThemeColor = themeColor?.content
    const createdThemeColor = !themeColor
    const activeThemeColor = themeColor ?? document.createElement('meta')
    if (createdThemeColor) {
      activeThemeColor.name = 'theme-color'
      document.head.appendChild(activeThemeColor)
    }
    // Match the browser/system chrome to the console's fixed dark surface.
    activeThemeColor.content = '#0d0e11'

    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex, nofollow, noarchive'
    tag.dataset.controlCenter = 'true'
    document.head.appendChild(tag)
    document.title = CONSOLE_NAME
    return () => {
      tag.remove()
      if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor
      else if (createdThemeColor) activeThemeColor.remove()
      document.title = previousTitle
    }
  }, [])
}

const GATE_TITLES: Record<string, string> = {
  loading: `Loading · ${CONSOLE_NAME}`,
  signed_out: `Sign in · ${CONSOLE_NAME}`,
  mfa: `Two-step verification · ${CONSOLE_NAME}`,
  denied: `Access not granted · ${CONSOLE_NAME}`,
  error: `Unavailable · ${CONSOLE_NAME}`
}

function ControlRouter() {
  const { phase } = useControlSession()
  const location = useLocation()
  useRobotsDirective()
  // Gate screens set their own titles; the layout sets per-page titles once access is granted.
  useEffect(() => { if (phase.kind !== 'granted') document.title = GATE_TITLES[phase.kind] ?? CONSOLE_NAME }, [phase.kind])

  if (phase.kind === 'loading') return <LoadingScreen />
  if (phase.kind === 'signed_out') return <SignInGate notice={phase.notice} />
  if (phase.kind === 'mfa') return <MfaGate />
  if (phase.kind === 'denied') return <AccessDenied />
  if (phase.kind === 'error') return <GateError message={phase.message} />

  // Granted: the server has confirmed an active owner with aal2.
  return (
    <ReauthProvider>
      <ControlLayout>
        <Suspense fallback={<div className="cc-page-skeleton"><Skeleton rows={6} height={18} /></div>}>
          <Routes location={location}>
            <Route index element={<OverviewPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:userId" element={<UserDetailPage />} />
            <Route path="roles" element={<RolesPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="health" element={<HealthPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<NotInConsole />} />
          </Routes>
        </Suspense>
      </ControlLayout>
    </ReauthProvider>
  )
}

function NotInConsole() {
  return (
    <div className="cc-empty cc-empty--page">
      <strong>That console page does not exist.</strong>
      <p>Choose a section from the navigation.</p>
      <a className="cc-btn cc-btn--default cc-btn--md" href={CONSOLE_BASE}>Back to overview</a>
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="cc-gate" aria-busy="true">
      <div className="cc-gate__card">
        <Skeleton rows={3} height={16} />
      </div>
    </main>
  )
}


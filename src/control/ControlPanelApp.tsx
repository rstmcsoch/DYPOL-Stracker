import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ControlSessionProvider, useControlSession } from './ControlSession'
import { ControlLayout } from './ControlLayout'
import { GateError, MfaGate } from './gates'
import { ReauthProvider } from './reauth'
import { TimeZoneProvider } from './time'
import { ControlThemeRoot } from './ControlTheme'
import { readControlThemePreference, resolveControlTheme, systemPrefersDark } from '../lib/control-theme'
import { UnsavedChangesProvider } from './unsaved'
import { Skeleton } from './ui'
import { CONSOLE_BASE, CONSOLE_NAME, firstAllowedPath } from './policy'
import type { Permission } from '../lib/control-permissions'
import './control.css'

const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const UserDetailPage = lazy(() => import('./pages/UserDetailPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const SecurityPage = lazy(() => import('./pages/SecurityPage'))
const HealthPage = lazy(() => import('./pages/HealthPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const AppearancePage = lazy(() => import('./appearance/AppearancePage'))
const ExamsPage = lazy(() => import('./exams/ExamsPage'))
const AIDefaultsPage = lazy(() => import('./ai/AIDefaultsPage'))
const AnalyticsPage = lazy(() => import('./analytics/AnalyticsPage'))
const MessagesPage = lazy(() => import('./messages/MessagesPage'))
const SettingsPage = lazy(() => import('./settings/SettingsPage'))
const PublicPreviewPage = lazy(() => import('./appearance/PublicPreviewPage'))

/**
 * Entry point for /control-panel/*. It is lazy-loaded by the application router, so the
 * console's code and styles are not part of the public homepage or the student notebook.
 */
export default function ControlPanelApp() {
  return (
    <ControlThemeRoot>
      <ControlSessionProvider>
        <TimeZoneProvider>
          <UnsavedChangesProvider>
            <ControlRouter />
          </UnsavedChangesProvider>
        </TimeZoneProvider>
      </ControlSessionProvider>
    </ControlThemeRoot>
  )
}

/**
 * noindex for the whole console, and the console title / browser colour only once the server
 * has confirmed a role holder (mfa or granted). A visitor who is redirected away never sees
 * the console's name, even in the tab title.
 */
function useRobotsDirective(revealed: boolean) {
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex, nofollow, noarchive'
    tag.dataset.controlCenter = 'true'
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])
  useEffect(() => {
    if (!revealed) return
    const previousTitle = document.title
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousThemeColor = themeColor?.content
    const createdThemeColor = !themeColor
    const activeThemeColor = themeColor ?? document.createElement('meta')
    if (createdThemeColor) {
      activeThemeColor.name = 'theme-color'
      document.head.appendChild(activeThemeColor)
    }
    // Match the browser chrome to the console's current light or dark surface.
    activeThemeColor.content = resolveControlTheme(readControlThemePreference(), systemPrefersDark()) === 'light' ? '#f6f5f1' : '#0d0e11'

    document.title = CONSOLE_NAME
    return () => {
      if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor
      else if (createdThemeColor) activeThemeColor.remove()
      document.title = previousTitle
    }
  }, [revealed])
}

const GATE_TITLES: Record<string, string> = {
  mfa: `Two-step verification · ${CONSOLE_NAME}`,
  error: `Unavailable · ${CONSOLE_NAME}`
}

function ControlRouter() {
  const { phase } = useControlSession()
  const location = useLocation()
  const revealed = phase.kind === 'mfa' || phase.kind === 'granted' || phase.kind === 'error'
  useRobotsDirective(revealed)
  // Gate screens set their own titles; the layout sets per-page titles once access is granted.
  useEffect(() => { const title = GATE_TITLES[phase.kind]; if (title) document.title = title }, [phase.kind])

  if (phase.kind === 'loading') return <LoadingScreen />
  // No console login portal: no normal Stracker session (never signed in, signed out, idle
  // sign-out, cleared storage, expired session) goes to the homepage to sign in as usual, and a
  // signed-in account without an active role goes to its own dashboard (also "/"), with no hint
  // that a console exists. The API refuses both independently of this redirect.
  if (phase.kind === 'signed_out' || phase.kind === 'denied') return <Navigate to="/" replace />
  if (phase.kind === 'mfa') return <MfaGate />
  if (phase.kind === 'error') return <GateError message={phase.message} />

  // Owner preview of the public homepage: rendered without the console chrome, for the
  // Appearance preview frame only. Access is still the owner gate above and the API check.
  const permissions = phase.session.permissions ?? []
  const need = (permission: Permission, element: React.ReactNode) => permissions.includes(permission) ? element : <NotInRole fallback={firstAllowedPath(permissions)} />

  if (location.pathname === `${CONSOLE_BASE}/preview/public`) {
    if (!permissions.includes('appearance.edit')) return <Navigate to={firstAllowedPath(permissions)} replace />
    return (
      <Suspense fallback={<p className="cc-preview-message">Loading preview…</p>}>
        <PublicPreviewPage />
      </Suspense>
    )
  }

  // Granted: the server has confirmed an active owner with aal2.
  return (
    <ReauthProvider passkey={phase.session.role === 'owner' && phase.session.passkey === true}>
      <ControlLayout>
        <Suspense fallback={<div className="cc-page-skeleton"><Skeleton rows={6} height={18} /></div>}>
          <Routes location={location}>
            {/* Each page is shown only to role holders whose permissions include it; the API
                refuses the same requests independently (403 permission_denied). */}
            <Route index element={permissions.includes('overview.view') ? <OverviewPage /> : firstAllowedPath(permissions) === CONSOLE_BASE ? <NotInRole fallback={`${CONSOLE_BASE}/settings`} /> : <Navigate to={firstAllowedPath(permissions)} replace />} />
            <Route path="users" element={need('users.view', <UsersPage />)} />
            <Route path="users/:userId" element={need('users.view', <UserDetailPage />)} />
            <Route path="roles" element={<Navigate to={`${CONSOLE_BASE}/settings/roles`} replace />} />
            <Route path="audit" element={need('audit.view', <AuditPage />)} />
            <Route path="security" element={need('security.view', <SecurityPage />)} />
            <Route path="health" element={need('health.view', <HealthPage />)} />
            <Route path="about" element={<AboutPage />} />
            <Route path="appearance/*" element={need('appearance.edit', <AppearancePage />)} />
            <Route path="exams" element={need('exams.manage', <ExamsPage />)} />
            <Route path="ai" element={need('ai.manage', <AIDefaultsPage />)} />
            <Route path="analytics" element={need('analytics.view', <AnalyticsPage />)} />
            <Route path="messages" element={need('messages.view', <MessagesPage />)} />
            <Route path="settings/*" element={<SettingsPage />} />
            <Route path="*" element={<NotInConsole />} />
          </Routes>
        </Suspense>
      </ControlLayout>
    </ReauthProvider>
  )
}

function NotInRole({ fallback }: { fallback: string }) {
  return (
    <div className="cc-empty cc-empty--page">
      <strong>This section is not part of your role.</strong>
      <p>Ask the owner if you need it. Everything you can use is in the navigation.</p>
      <a className="cc-btn cc-btn--default cc-btn--md" href={fallback}>Go to your first section</a>
    </div>
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

/** Neutral, unbranded wait while the server decides; nothing here names the console. */
function LoadingScreen() {
  return (
    <div className="route-loading" aria-busy="true"><span>Just a moment…</span></div>
  )
}


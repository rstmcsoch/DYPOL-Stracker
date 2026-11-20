import { lazy, Suspense, type ReactNode } from 'react'
import { routeLoaders } from './lib/route-preload'
import { publicRouteLoaders } from './lib/public-preload'
import { withChunkRecovery } from './lib/chunk-recovery'
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SiteContentProvider } from './contexts/SiteContentContext'
import { ToastProvider } from './contexts/ToastContext'
import { LoaderCircle } from 'lucide-react'
import { TelemetryTracker } from './components/TelemetryTracker'
import NotFoundPage from './pages/NotFoundPage'
import { isKnownAppPath } from './lib/app-routes'
import { SiteStatusProvider } from './components/site/SiteStatusContext'
import { SiteGate } from './components/site/SiteGate'

const LandingPage = lazy(withChunkRecovery(() => import('./pages/LandingPage')))
const ProtectedAppShell = lazy(withChunkRecovery(() => import('./components/ProtectedAppShell')))
const LoginPage = lazy(publicRouteLoaders['/login'])
const SignupPage = lazy(publicRouteLoaders['/signup'])
const ResetPasswordPage = lazy(publicRouteLoaders['/reset-password'])
const AuthCallbackPage = lazy(publicRouteLoaders['/auth/callback'])
const SyllabusPage = lazy(routeLoaders['/syllabus'])
const TestsPage = lazy(routeLoaders['/tests'])
const MistakesPage = lazy(routeLoaders['/mistakes'])
const PlannerPage = lazy(routeLoaders['/planner'])
const RevisionPage = lazy(routeLoaders['/revision'])
const AnalyticsPage = lazy(routeLoaders['/analytics'])
const WeakAreasPage = lazy(routeLoaders['/weak-areas'])
const BackupPage = lazy(routeLoaders['/backup'])
const SettingsPage = lazy(routeLoaders['/settings'])
const ProfilePage = lazy(routeLoaders['/profile'])
const FocusPage = lazy(routeLoaders['/focus'])
const PracticePage = lazy(routeLoaders['/practice'])
const PyqPage = lazy(routeLoaders['/pyqs'])
const BacklogPage = lazy(routeLoaders['/backlog'])
const MockAnalysisPage = lazy(routeLoaders['/mock-analysis'])
const DecksPage = lazy(routeLoaders['/decks'])
const StudyNowPage = lazy(routeLoaders['/study-now'])
// Private operations console: lazy-loaded so its code and styles never reach the public or
// notebook bundles, and are not even downloaded by a visitor without a Stracker session.
const ControlPanelApp = lazy(() => import('./control/ControlPanelApp'))
const InfoPage = lazy(publicRouteLoaders['/about'])
const ContactPage = lazy(publicRouteLoaders['/contact'])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 }
  }
})

function AppLoading({ label = 'Opening your study notebook…' }: { label?: string }) {
  return <div className="app-loading"><LoaderCircle className="spin" size={26} /><span>{label}</span></div>
}

function RouteLoading() {
  return <div className="route-loading"><span>Just a moment…</span></div>
}

function ProtectedApp() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AppLoading />
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <SiteGate kind="app"><Suspense fallback={<AppLoading />}><ProtectedAppShell user={user} /></Suspense></SiteGate>
}

/**
 * Root route: visitors see the public product homepage at `/`; signed-in users
 * enter the notebook directly. Checking session loading here prevents any flash
 * of the homepage before a restored session lands on the dashboard.
 */
function RootRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AppLoading label="Opening Stracker…" />
  // Unknown addresses get an in-app 404 for visitors too, instead of silently showing the homepage.
  if (!user && !isKnownAppPath(location.pathname)) return <NotFoundPage signedIn={false} />
  // Published website and notebook copy is loaded once here, for both the homepage and the notebook.
  if (!user) return <SiteGate kind="public"><SiteContentProvider withDocument><LandingPage /></SiteContentProvider></SiteGate>
  return <SiteContentProvider><Outlet /></SiteContentProvider>
}

/**
 * Auth routes (`/login`, `/signup`) are for signed-out visitors. Someone who already
 * has an active session is sent straight to the notebook instead of seeing a login form.
 */
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoading label="Opening Stracker…" />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * /control-panel has no login portal of its own. Without a normal Stracker session (never
 * signed in, signed out, storage cleared, session expired) the visitor goes to the homepage to
 * sign in like everyone else. With a session, the console asks the server whether this account
 * holds an active role; if not, ControlRouter sends the account to its normal dashboard. Every
 * console API route enforces session + role + permission + aal2 again on the server.
 */
export function ControlEntry() {
  const { user, loading } = useAuth()
  if (loading) return <RouteLoading />
  if (!user) return <Navigate to="/" replace />
  return <Suspense fallback={<RouteLoading />}><ControlPanelApp /></Suspense>
}

function AppRoutes() {
  return <Suspense fallback={<RouteLoading />}>
    <Routes>
      <Route path="/" element={<RootRoute />}>
        <Route element={<ProtectedApp />}>
          <Route index element={<AppHome />} />
          <Route path="syllabus" element={<SyllabusPage />} />
          <Route path="tests" element={<TestsPage />} />
          <Route path="mistakes" element={<MistakesPage />} />
          {/* /retry was merged into Mistakes as a tab; the redirect keeps old links working. */}
          <Route path="retry" element={<Navigate to="/mistakes?tab=retry" replace />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="revision" element={<RevisionPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="weak-areas" element={<WeakAreasPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="pyqs" element={<PyqPage />} />
          <Route path="backlog" element={<BacklogPage />} />
          <Route path="mock-analysis" element={<MockAnalysisPage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="study-now" element={<StudyNowPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      {/* Private console: not linked from any public or notebook navigation. Access is enforced by the server. */}
      <Route path="/control-panel/*" element={<ControlEntry />} />
      <Route path="/login" element={<PublicOnly><SiteGate kind="auth"><LoginPage /></SiteGate></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SiteGate kind="public"><SignupPage /></SiteGate></PublicOnly>} />
      {/* Password recovery stays on its original public route: the emailed link
          authenticates a short-lived session, so it must not be redirected away. */}
      <Route path="/reset-password" element={<SiteGate kind="auth"><ResetPasswordPage /></SiteGate>} />
      {/* Google (OAuth, PKCE) returns here; the page finishes the code exchange and moves on. */}
      <Route path="/auth/callback" element={<SiteGate kind="auth"><AuthCallbackPage /></SiteGate>} />
      {/* Information pages and Contact, open to visitors and students alike. Text ships built in and is owner-editable. */}
      <Route path="/privacy" element={<SiteGate kind="public"><SiteContentProvider withDocument><InfoPage kind="privacy" /></SiteContentProvider></SiteGate>} />
      <Route path="/terms" element={<SiteGate kind="public"><SiteContentProvider withDocument><InfoPage kind="terms" /></SiteContentProvider></SiteGate>} />
      <Route path="/about" element={<SiteGate kind="public"><SiteContentProvider withDocument><InfoPage kind="about" /></SiteContentProvider></SiteGate>} />
      <Route path="/contact" element={<SiteGate kind="public"><SiteContentProvider withDocument><ContactPage /></SiteContentProvider></SiteGate>} />
      <Route path="*" element={<NotFoundPage signedIn={false} />} />
    </Routes>
  </Suspense>
}

const HomePage = lazy(routeLoaders['/'])
function AppHome() { return <HomePage /> }

export default function App() {
  return <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <AuthProvider>
        <SiteStatusProvider>
          <BrowserRouter><TelemetryTracker /><ChunkErrorBoundary><AppRoutes /></ChunkErrorBoundary></BrowserRouter>
        </SiteStatusProvider>
      </AuthProvider>
    </ToastProvider>
  </QueryClientProvider>
}

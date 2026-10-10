import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AppearanceProvider } from './contexts/AppearanceContext'
import { DataProvider } from './contexts/DataContext'
import { AIProvider } from './contexts/AIContext'
import { FocusProvider } from './contexts/FocusContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppFrame } from './components/AppShell'
import { LoaderCircle } from 'lucide-react'

const LandingPage = lazy(() => import('./pages/LandingPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const SyllabusPage = lazy(() => import('./pages/SyllabusPage'))
const TestsPage = lazy(() => import('./pages/TestsPage'))
const MistakesPage = lazy(() => import('./pages/MistakesPage'))
const RetryPage = lazy(() => import('./pages/RetryPage'))
const PlannerPage = lazy(() => import('./pages/PlannerPage'))
const RevisionPage = lazy(() => import('./pages/RevisionPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const WeakAreasPage = lazy(() => import('./pages/WeakAreasPage'))
const BackupPage = lazy(() => import('./pages/BackupPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const FocusPage = lazy(() => import('./pages/FocusPage'))
const PracticePage = lazy(() => import('./pages/PracticePage'))
const PyqPage = lazy(() => import('./pages/PyqPage'))
const BacklogPage = lazy(() => import('./pages/BacklogPage'))
const MockAnalysisPage = lazy(() => import('./pages/MockAnalysisPage'))
const DecksPage = lazy(() => import('./pages/DecksPage'))
const StudyNowPage = lazy(() => import('./pages/StudyNowPage'))
// Private operations console: lazy-loaded so its code and styles never reach the public or notebook bundles.
const ControlPanelApp = lazy(() => import('./control/ControlPanelApp'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: 0 }
  }
})

function AppLoading({ label = 'Opening your notebook…' }: { label?: string }) {
  return <div className="app-loading"><div className="loading-mark"><span>S</span><i>✳</i></div><LoaderCircle size={18} className="spin" /><span>{label}</span></div>
}

function RouteLoading() {
  return <div className="route-loading"><LoaderCircle size={22} className="spin" /><span>Just a moment…</span></div>
}

/**
 * Authenticated application shell. While the session is still being restored nothing
 * else is rendered, so a signed-in reload never flashes the public pages (and a
 * signed-out reload never flashes the notebook).
 */
function ProtectedApp() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AppLoading />
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return <DataProvider key={user.id}>
    <AIProvider>
      <AppearanceProvider>
        <FocusProvider key={user.id}>
          <AppFrame />
        </FocusProvider>
      </AppearanceProvider>
    </AIProvider>
  </DataProvider>
}

/**
 * The root route. Logged-out visitors get the public homepage; authenticated users
 * continue straight into the notebook on the same URL, so the installed app and any
 * saved bookmark keep working exactly as before.
 */
function RootRoute() {
  const { user, loading } = useAuth()
  if (loading) return <AppLoading label="Opening Stracker…" />
  if (!user) return <LandingPage />
  return <Outlet />
}

/** /login and /signup are for visitors only: a signed-in user is sent into the notebook. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AppLoading label="Checking your session…" />
  if (user) return <Navigate to="/" replace state={{ from: location.pathname }} />
  return <>{children}</>
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
          <Route path="retry" element={<RetryPage />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="revision" element={<RevisionPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="weak-areas" element={<WeakAreasPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="pyqs" element={<PyqPage />} />
          <Route path="backlog" element={<BacklogPage />} />
          <Route path="mock-analysis" element={<MockAnalysisPage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="study-now" element={<StudyNowPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
      {/* Private console: not linked from any public or notebook navigation. Access is enforced by the server. */}
      <Route path="/control-panel/*" element={<Suspense fallback={<RouteLoading />}><ControlPanelApp /></Suspense>} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      {/* Password recovery stays on its original public route: the emailed link
          authenticates a short-lived session, so it must not be redirected away. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
}

const HomePage = lazy(() => import('./pages/HomePage'))
function AppHome() { return <HomePage /> }

export default function App() {
  return <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter><AppRoutes /></BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </QueryClientProvider>
}

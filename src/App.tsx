import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AppearanceProvider } from './contexts/AppearanceContext'
import { DataProvider } from './contexts/DataContext'
import { AIProvider } from './contexts/AIContext'
import { FocusProvider } from './contexts/FocusContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppFrame } from './components/AppShell'
import { LoaderCircle } from 'lucide-react'

const AuthPage = lazy(() => import('./pages/AuthPage'))
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: 0 }
  }
})

function AppLoading({ label = 'Opening your notebook…' }: { label?: string }) {
  return <div className="app-loading"><div className="loading-mark"><span>S</span><i>✳</i></div><LoaderCircle size={18} className="spin" /><span>{label}</span></div>
}

function ProtectedApp() {
  const { user, loading } = useAuth()
  if (loading) return <AppLoading />
  if (!user) return <Navigate to="/login" replace />
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

function RouteLoading() {
  return <div className="route-loading"><LoaderCircle size={22} className="spin" /><span>Just a moment…</span></div>
}

function AppRoutes() {
  const { user, loading } = useAuth()
  return <Suspense fallback={<RouteLoading />}>
    <Routes>
      <Route path="/login" element={user && !loading ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route path="/reset-password" element={<AuthPage />} />
      <Route element={<ProtectedApp />}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/syllabus" element={<SyllabusPage />} />
        <Route path="/tests" element={<TestsPage />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/retry" element={<RetryPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/revision" element={<RevisionPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/weak-areas" element={<WeakAreasPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  </Suspense>
}

const HomePage = lazy(() => import('./pages/HomePage'))
function HomeRoute() { return <HomePage /> }

export default function App() {
  return <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter><AppRoutes /></BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </QueryClientProvider>
}

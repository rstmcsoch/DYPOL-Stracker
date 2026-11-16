import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { IsolatedMemoryRouter } from './canvas-router'
import { AppFrame } from '../../components/AppShell'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import { StudentLayoutProvider } from '../../contexts/StudentLayoutContext'
import { routeLoaders } from '../../lib/route-preload'
import { STUDENT_PAGES, type StudentPageId } from '../../lib/student-layout/registry'
import { checkStudentLayout } from '../../lib/student-layout/validate'
import { compileStudentLayoutCss } from '../../lib/student-layout/compile-css'
import { buildPreviewFixture } from './fixtures'
import { PreviewProviders } from './PreviewProviders'
import { installPreviewGuard } from './canvas-guard'
import { attachStudentOverlay, type StudentOverlay } from './canvas-overlay'
import { isStudentCanvasMessage, type StudentCanvasMessage, type StudentCanvasState } from './protocol'
import './student-canvas.css'

/**
 * Canvas of the Student Dashboard Editor, loaded in a same-origin iframe at real device
 * widths. It renders the real AppFrame and student pages with a synthetic student (never a
 * real notebook) and the editor's unsaved layout, sent only by the same-origin parent.
 * The router is in memory, so preview navigation never leaves the canvas.
 */

type Loader = () => Promise<{ default: ComponentType }>
const PAGES = STUDENT_PAGES.filter(page => page.path !== null).map(page => ({
  ...page,
  Component: lazy((routeLoaders as unknown as Record<string, Loader>)[page.path!]!)
}))
const pathFor = (page: StudentPageId) => STUDENT_PAGES.find(entry => entry.id === page)?.path ?? '/'
const pageFor = (pathname: string): StudentPageId | null => STUDENT_PAGES.find(entry => entry.path === pathname)?.id ?? null

function RouteSync({ page, onPage }: { page: StudentPageId; onPage: (page: StudentPageId) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const wanted = page === 'shell' ? null : pathFor(page)
  useEffect(() => { if (wanted && location.pathname !== wanted) navigate(wanted, { replace: true }) }, [wanted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const current = pageFor(location.pathname)
    if (current && current !== page && wanted) onPage(current)
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function StudentCanvasPage() {
  const [state, setState] = useState<StudentCanvasState | null>(null)
  const stateRef = useRef<StudentCanvasState | null>(null)
  const overlayRef = useRef<StudentOverlay | null>(null)
  const sendRef = useRef<(message: StudentCanvasMessage) => void>(() => undefined)

  useEffect(() => {
    const parent = window.parent
    if (parent === window) return undefined
    const uninstall = installPreviewGuard()
    const send = (message: StudentCanvasMessage) => parent.postMessage(message, window.location.origin)
    sendRef.current = send
    overlayRef.current = attachStudentOverlay(send, () => stateRef.current)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== parent || !isStudentCanvasMessage(event.data)) return
      const data = event.data as unknown as StudentCanvasState
      if (data.type !== 'sl:state') return
      stateRef.current = data
      setState(data)
    }
    window.addEventListener('message', onMessage)
    send({ type: 'sl:ready' })
    return () => {
      window.removeEventListener('message', onMessage)
      overlayRef.current?.detach()
      uninstall()
    }
  }, [])

  useEffect(() => {
    if (!state) return undefined
    const frame = requestAnimationFrame(() => overlayRef.current?.refresh(state))
    return () => cancelAnimationFrame(frame)
  }, [state])
  useEffect(() => { document.documentElement.dataset.slCanvas = state?.mode ?? 'edit' }, [state?.mode])

  // Re-validated here too, so the canvas renders exactly what students would get.
  const document_ = state?.document
  const prepared = useMemo(() => {
    const checked = document_ ? checkStudentLayout(document_).document : null
    return { document: checked ?? { schemaVersion: 1 }, css: checked ? compileStudentLayoutCss(checked) : '' }
  }, [document_])
  const scenario = state?.scenario
  const theme = state?.theme
  const fixture = useMemo(() => {
    if (!scenario) return null
    const built = buildPreviewFixture(scenario)
    return { ...built, data: { ...built.data, settings: { ...built.data.settings, theme: theme ?? 'light' } } }
  }, [scenario, theme])

  if (!state || !fixture) return <p className="cc-preview-message">Loading the synthetic student preview…</p>
  const startPath = state.page === 'shell' ? '/' : pathFor(state.page)
  return <Fragment key={`${state.scenario}-${state.theme}`}>
    <IsolatedMemoryRouter initialPath={startPath}>
      <RouteSync page={state.page} onPage={page => sendRef.current({ type: 'sl:page', page })} />
      <SiteContentProvider overrides={state.siteOverrides ?? {}}>
        <PreviewProviders fixture={fixture}>
          <StudentLayoutProvider document={prepared.document} css={prepared.css} editing={state.mode === 'edit'}>
            <Suspense fallback={<p className="cc-preview-message">Loading page…</p>}>
              <Fragment key={state.epoch}><Routes>
                <Route path="/" element={<AppFrame />}>
                  {PAGES.map(({ id, path, Component }) => path === '/' ? <Route key={id} index element={<Component />} /> : <Route key={id} path={path!.slice(1)} element={<Component />} />)}
                </Route>
              </Routes></Fragment>
            </Suspense>
          </StudentLayoutProvider>
        </PreviewProviders>
      </SiteContentProvider>
    </IsolatedMemoryRouter>
  </Fragment>
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { SiteContentProvider } from '../../contexts/SiteContentContext'
import { attachCanvasOverlay, type CanvasOverlay } from './canvas-overlay'
import { isCanvasMessage, type CanvasMessage, type CanvasState } from './protocol'
import './live-editor-canvas.css'

const LandingPage = lazy(() => import('../../pages/LandingPage'))
const InfoPage = lazy(() => import('../../pages/InfoPage'))
const ContactPage = lazy(() => import('../../pages/ContactPage'))

/**
 * Canvas of the Live Site Editor, loaded in a same-origin iframe at real device widths so
 * the site's own media queries apply. It renders the real public page components with the
 * editor's unsaved state (sent by the parent window only) and adds the selection layer.
 * Only the same-origin parent may drive it; it fetches no draft data itself.
 */
export default function CanvasPage() {
  const [state, setState] = useState<CanvasState | null>(null)
  const stateRef = useRef<CanvasState | null>(null)
  const overlayRef = useRef<CanvasOverlay | null>(null)

  useEffect(() => {
    const parent = window.parent
    if (parent === window) return undefined
    const send = (message: CanvasMessage) => parent.postMessage(message, window.location.origin)
    overlayRef.current = attachCanvasOverlay(send, () => stateRef.current)
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== parent || !isCanvasMessage(event.data)) return
      const data = event.data as unknown as CanvasState
      if (data.type !== 'se:state') return
      stateRef.current = data
      setState(data)
    }
    window.addEventListener('message', onMessage)
    send({ type: 'se:ready' })
    return () => {
      window.removeEventListener('message', onMessage)
      overlayRef.current?.detach()
    }
  }, [])

  useEffect(() => {
    if (!state) return undefined
    const frame = requestAnimationFrame(() => overlayRef.current?.refresh(state))
    return () => cancelAnimationFrame(frame)
  }, [state])

  useEffect(() => {
    document.documentElement.dataset.seCanvas = state?.mode ?? 'edit'
  }, [state?.mode])

  if (!state) return <p className="cc-preview-message">Loading the editor canvas…</p>
  const page = state.page
  return <SiteContentProvider overrides={state.overrides} document={state.document}>
    <Suspense fallback={<p className="cc-preview-message">Loading page…</p>}>
      <div key={`${page}-${state.epoch}`} className="se-canvas-root">
        {page === 'home' ? <LandingPage /> : page === 'contact' ? <ContactPage /> : <InfoPage kind={page} />}
      </div>
    </Suspense>
  </SiteContentProvider>
}

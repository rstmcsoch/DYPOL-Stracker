import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Eye, FileStack, History, Layers, Maximize2, Minimize2, Monitor, Moon, MousePointer2, RefreshCw, Save, Settings2, Smartphone, Sun, Tablet, Undo2, Redo2, Upload, X
} from 'lucide-react'
import { Button } from '../ui'
import { controlFetch } from '../api'
import { APPEARANCE_QUERY_KEY, type AppearanceState } from '../appearance/ContentEditor'
import { COMPONENT_MAP, STUDENT_PAGES, type StudentPageId } from '../../lib/student-layout/registry'
import { layoutProblemsToErrors } from '../../lib/student-layout/validate'
import { PREVIEW_SCENARIOS, type PreviewScenarioId } from './fixtures'
import { clearStyles, moveBy, resetComponent, setProp, setStyle, setText, toggleHidden, toggleLocked, configOf, type Device } from './layout-ops'
import { HistoryPanel, LayersPanel, PagesPanel } from './StudentPanels'
import { StudentInspector } from './StudentInspector'
import { LOCKED_TEXT } from './editor-model'
import { STUDENT_CANVAS_PATH, isStudentCanvasMessage, type StudentCanvasMessage, type StudentCanvasState } from './protocol'
import { useStudentEditorState, type SaveStatus } from './useStudentEditorState'
import '../live-editor/live-editor.css'
import './student-editor.css'

/**
 * Student Dashboard Editor workspace: the real student AppFrame and pages over a synthetic
 * student in a same-origin iframe at device widths; selection and inline label typing on
 * the canvas, layers, inspector with per-device styles, undo/redo, autosave to the private
 * draft and MFA-protected publishing. Student data is never shown or editable here.
 */

type Viewport = 'desktop' | 'landscape' | 'tablet' | 'mobile'
const VIEWPORTS: Record<Viewport, { label: string; width: number; icon: typeof Monitor }> = {
  desktop: { label: 'Desktop 1280', width: 1280, icon: Monitor },
  landscape: { label: 'Tablet landscape 1180', width: 1180, icon: Tablet },
  tablet: { label: 'Tablet portrait 820', width: 820, icon: Tablet },
  mobile: { label: 'Phone 390', width: 390, icon: Smartphone }
}
type LeftTab = 'layers' | 'pages' | 'history'
const LEFT_TABS: Array<{ id: LeftTab; label: string; icon: typeof Layers }> = [
  { id: 'layers', label: 'Layers', icon: Layers }, { id: 'pages', label: 'Pages', icon: FileStack }, { id: 'history', label: 'History', icon: History }
]
const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: 'Loading…', saved: 'Draft saved', unsaved: 'Unsaved changes', saving: 'Saving draft…', invalid: 'Fix highlighted settings', error: 'Not saved — will retry', conflict: 'Draft changed elsewhere'
}
const deviceForWidth = (width: number): Device => (width <= 640 ? 'mobile' : width <= 1024 ? 'tablet' : 'desktop')

export default function StudentEditorPage() {
  const editor = useStudentEditorState()
  const { working, update } = editor
  const [page, setPage] = useState<StudentPageId>('home')
  const [selected, setSelected] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>(() => (typeof window === 'undefined' || window.innerWidth >= 1280 ? 'desktop' : window.innerWidth >= 900 ? 'landscape' : window.innerWidth >= 700 ? 'tablet' : 'mobile'))
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [scenario, setScenario] = useState<PreviewScenarioId>('full')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [fullscreen, setFullscreen] = useState(false)
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')
  const [sheet, setSheet] = useState<'left' | 'right' | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [note, setNote] = useState('')
  const [frameReady, setFrameReady] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 1000, height: 700 })
  const width = VIEWPORTS[viewport].width
  const [device, setDevice] = useState<Device>('desktop')
  useEffect(() => { setDevice(deviceForWidth(width)) }, [width])

  // Live Navigation & labels text for the sidebar (read-only here).
  const site = useQuery({ queryKey: [...APPEARANCE_QUERY_KEY, 'state'], queryFn: () => controlFetch<AppearanceState>('appearance-state'), staleTime: 60_000, refetchOnWindowFocus: false })
  const siteOverrides = site.data?.published.overrides

  const hasWorking = Boolean(working)
  useEffect(() => {
    const node = stageRef.current
    if (!node) return undefined
    const observer = new ResizeObserver(([entry]) => { if (entry) setStage({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasWorking])
  const scale = zoom === 'fit' ? Math.min(1, (stage.width - 24) / width) : zoom
  const frameHeight = Math.max(320, (stage.height - 24) / scale)

  const flash = useCallback((text: string) => { setNotice(text); window.setTimeout(() => setNotice(current => (current === text ? null : current)), 3200) }, [])
  const isLocked = useCallback((id: string) => Boolean(working && configOf(working, id).locked), [working])

  const actions = useMemo(() => ({
    select: (id: string) => { setSelected(id); setScrollTo(id) },
    move: (id: string, delta: -1 | 1) => {
      if (isLocked(id)) { flash('Unlock this part first.'); return }
      if (!update(doc => moveBy(doc, id, delta))) flash(COMPONENT_MAP.get(id)?.caps.reorderable ? 'It is already at the edge of its section.' : 'This part keeps its position.')
    },
    toggleHidden: (id: string) => {
      if (isLocked(id)) { flash('Unlock this part first.'); return }
      if (!update(doc => toggleHidden(doc, id))) flash('This part is required and cannot be hidden.')
    },
    toggleLocked: (id: string) => { update(doc => toggleLocked(doc, id)) }
  }), [update, flash, isLocked])

  // ---- Canvas messaging ----
  const canvasState = useMemo<StudentCanvasState | null>(() => (working ? {
    type: 'sl:state', page, scenario, theme, document: working, selected, mode, epoch, scrollTo, siteOverrides
  } : null), [working, page, scenario, theme, selected, mode, epoch, scrollTo, siteOverrides])
  useEffect(() => {
    const target = frameRef.current?.contentWindow
    if (frameReady && target && canvasState) target.postMessage(canvasState, window.location.origin)
  }, [frameReady, canvasState])
  useEffect(() => { if (scrollTo) { const timer = window.setTimeout(() => setScrollTo(null), 400); return () => window.clearTimeout(timer) } return undefined }, [scrollTo])

  const handlers = useRef<(message: StudentCanvasMessage) => void>(() => undefined)
  handlers.current = (message: StudentCanvasMessage) => {
    switch (message.type) {
      case 'sl:ready': setFrameReady(true); break
      case 'sl:select': setSelected(message.id && COMPONENT_MAP.has(message.id) ? message.id : null); break
      case 'sl:page': if (STUDENT_PAGES.some(entry => entry.id === message.page)) { setPage(message.page); setSelected(null) } break
      case 'sl:locked': flash(`${COMPONENT_MAP.get(message.id)?.data?.[message.key] ?? 'This value'}: ${LOCKED_TEXT}.`); break
      case 'sl:text': {
        if (isLocked(message.id)) flash('Unlock this part first.')
        else if (!update(doc => setText(doc, message.id, message.key, message.value), `text.${message.id}.${message.key}`) && !COMPONENT_MAP.get(message.id)?.text?.[message.key]) flash(LOCKED_TEXT)
        setSelected(message.id)
        setEpoch(value => value + 1)
        break
      }
      case 'sl:shortcut':
        if (message.action === 'undo') editor.undo()
        else if (message.action === 'redo') editor.redo()
        else if (message.action === 'save') void editor.save()
        else setSelected(null)
        break
      case 'sl:action': {
        if (!selected) break
        if (message.action === 'parent') { const parent = COMPONENT_MAP.get(selected)?.parent; if (parent) setSelected(parent) }
        else if (message.action === 'hide') actions.toggleHidden(selected)
        else actions.move(selected, message.action === 'up' ? -1 : 1)
        break
      }
    }
  }
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow || !isStudentCanvasMessage(event.data)) return
      handlers.current(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void editor.save(); return }
      if (typing) return
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo() }
      else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo() }
      else if (event.key === 'Escape') { setSelected(null); setSheet(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  const errors = useMemo(() => ({ ...layoutProblemsToErrors(editor.problems), ...editor.serverErrors }), [editor.problems, editor.serverErrors])
  const goPage = (next: StudentPageId) => { setPage(next); setSelected(next === 'shell' ? 'shell' : next); setSheet(null) }

  if (editor.query.isError && !working) return <div className="le-loading"><p>The Student Dashboard Editor could not load its configuration.</p><Button onClick={() => void editor.query.refetch()}>Try again</Button> <Link to="/control-panel/appearance" className="cc-btn cc-btn--ghost cc-btn--md">Back to Appearance</Link></div>
  if (!working) return <div className="le-loading"><p>Loading the Student Dashboard Editor…</p></div>

  const guard = (id: string, run: () => void) => { if (isLocked(id)) flash('Unlock this part first.'); else run() }
  const inspector = <StudentInspector id={selected} document={working} device={device} setDevice={setDevice} errors={errors} actions={{
    setText: (key, value) => selected && guard(selected, () => { update(doc => setText(doc, selected, key, value), `text.${selected}.${key}`) }),
    setProp: (key, value) => selected && guard(selected, () => { update(doc => setProp(doc, selected, key, value), `prop.${selected}.${key}`) }),
    setStyle: (styleDevice, key, value, coalesce) => selected && guard(selected, () => { update(doc => setStyle(doc, selected, styleDevice, key, value), coalesce) }),
    clearStyles: styleDevice => selected && guard(selected, () => { update(doc => clearStyles(doc, selected, styleDevice)) }),
    move: delta => selected && actions.move(selected, delta),
    toggleHidden: () => selected && actions.toggleHidden(selected),
    toggleLocked: () => selected && actions.toggleLocked(selected),
    reset: () => selected && guard(selected, () => { if (update(doc => resetComponent(doc, selected))) flash('Reset to the shipped design. Undo brings your changes back.') }),
    select: id => actions.select(id)
  }} />

  const leftPanel = <>
    <div className="le-panel__tabs" role="tablist" aria-label="Editor panels">
      {LEFT_TABS.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={leftTab === tab.id} className={`le-tab${leftTab === tab.id ? ' is-active' : ''}`} onClick={() => setLeftTab(tab.id)}><tab.icon size={15} aria-hidden="true" /> {tab.label}</button>)}
    </div>
    <div className="le-panel__body">
      {leftTab === 'layers' && <LayersPanel page={page} document={working} selected={selected} actions={{ ...actions, select: id => { actions.select(id); setSheet(null) } }} />}
      {leftTab === 'pages' && <PagesPanel page={page} document={working} onPage={goPage} />}
      {leftTab === 'history' && <HistoryPanel versions={editor.query.data?.versions ?? []} publishedVersion={editor.query.data?.published.version ?? 0} draftExists={Boolean(editor.query.data?.draft.exists)}
        onRestore={editor.restore} onDiscard={editor.discardDraft} />}
    </div>
  </>

  const changes = editor.pendingChanges
  return <div className={`le-root se-student${fullscreen ? ' is-fullscreen' : ''}${mode === 'preview' ? ' is-preview' : ''}`}>
    <header className="le-toolbar" aria-label="Editor toolbar">
      <div className="le-toolbar__group">
        <Link to="/control-panel/appearance" className="le-icon-btn le-back" aria-label="Back to Appearance" title="Back to Appearance"><ArrowLeft size={18} /></Link>
        <select className="cc-input le-page-select" aria-label="Student page" value={page} onChange={event => goPage(event.target.value as StudentPageId)}>
          {STUDENT_PAGES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <span className={`le-status is-${editor.saveStatus}`} role="status" aria-live="polite">{STATUS_TEXT[editor.saveStatus]}{editor.problems.length ? ` (${editor.problems.length})` : ''}</span>
      </div>
      <div className="le-toolbar__group">
        <span className="le-synthetic le-hide-sm" title="The canvas shows generated sample data, never a real student">SYNTHETIC STUDENT PREVIEW</span>
        <select className="cc-input le-scenario" aria-label="Sample student" value={scenario} onChange={event => setScenario(event.target.value as PreviewScenarioId)}>
          {PREVIEW_SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" className="le-icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Preview night mode' : 'Preview light mode'} title={theme === 'light' ? 'Night mode' : 'Light mode'}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
      </div>
      <div className="le-toolbar__group">
        <button type="button" className="le-icon-btn" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={18} /></button>
        <button type="button" className="le-icon-btn" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={18} /></button>
        <span className="le-sep" aria-hidden="true" />
        <div className="le-viewports" role="radiogroup" aria-label="Preview width">
          {(Object.keys(VIEWPORTS) as Viewport[]).map(id => { const Icon = VIEWPORTS[id].icon; return <button key={id} type="button" role="radio" aria-checked={viewport === id} className={`le-icon-btn${viewport === id ? ' is-active' : ''}${id === 'landscape' ? ' is-landscape' : ''}`} onClick={() => setViewport(id)} aria-label={VIEWPORTS[id].label} title={VIEWPORTS[id].label}><Icon size={18} /></button> })}
        </div>
        <select className="cc-input le-zoom" aria-label="Zoom" value={String(zoom)} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
          <option value="fit">Fit</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
        </select>
      </div>
      <div className="le-toolbar__group">
        <button type="button" className={`le-icon-btn${mode === 'preview' ? ' is-active' : ''}`} onClick={() => { setMode(mode === 'edit' ? 'preview' : 'edit'); setSelected(null) }} aria-pressed={mode === 'preview'} aria-label={mode === 'preview' ? 'Back to editing' : 'Preview'} title={mode === 'preview' ? 'Back to editing' : 'Preview (sample data reacts, nothing real is saved)'}>{mode === 'preview' ? <MousePointer2 size={18} /> : <Eye size={18} />}</button>
        <button type="button" className="le-icon-btn le-hide-xs" onClick={() => setFullscreen(value => !value)} aria-pressed={fullscreen} aria-label="Full screen canvas" title="Full screen canvas">{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
        <button type="button" className="le-icon-btn le-hide-xs" onClick={() => setEpoch(value => value + 1)} aria-label="Reset sample student" title="Reset sample student"><RefreshCw size={18} /></button>
        <Button size="sm" onClick={() => void editor.save()} disabled={!editor.dirty || editor.saveStatus === 'saving'}><Save size={15} aria-hidden="true" /> <span className="le-hide-sm">Save draft</span></Button>
        <Button size="sm" variant="primary" onClick={() => { editor.setPublishStatus('idle'); setPublishOpen(true) }} disabled={editor.invalid}><Upload size={15} aria-hidden="true" /> Publish</Button>
      </div>
    </header>

    {editor.saveStatus === 'conflict' && <div className="le-banner is-warn" role="alert">
      <span>The draft was changed in another tab or by another administrator. Reload to take their version (your unsaved edits here are lost), or overwrite it with yours.</span>
      <Button size="sm" onClick={() => void editor.reloadFromServer()}>Reload theirs</Button>
      <Button size="sm" variant="danger" onClick={() => void editor.save({ force: true })}>Overwrite with mine</Button>
    </div>}
    {editor.saveMessage && editor.saveStatus !== 'conflict' && (editor.saveStatus === 'error' || editor.saveStatus === 'invalid') && <div className="le-banner is-crit" role="alert">{editor.saveMessage}</div>}
    {notice && <div className="le-toast" role="status">{notice}</div>}

    <div className="le-body">
      <aside className={`le-panel le-panel--left${sheet === 'left' ? ' is-open' : ''}`} aria-label="Layers, pages and history">
        <button type="button" className="le-sheet-close le-icon-btn" onClick={() => setSheet(null)} aria-label="Close panel"><X size={18} /></button>
        {leftPanel}
      </aside>
      <main className="le-stage" ref={stageRef} aria-label="Student page canvas">
        <div className="le-frame" style={{ width: width * scale, height: frameHeight * scale }}>
          <iframe ref={frameRef} title={`${STUDENT_PAGES.find(entry => entry.id === page)?.label ?? 'Student'} page canvas (synthetic student)`} src={STUDENT_CANVAS_PATH}
            style={{ width, height: frameHeight, transform: `scale(${scale})` }} />
        </div>
        <p className="le-stage__caption">{width}px · styles apply to {deviceForWidth(width) === 'desktop' ? 'desktop' : deviceForWidth(width) === 'tablet' ? 'tablet (≤1024px)' : 'phone (≤640px)'}{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''} · sample data only</p>
      </main>
      <aside className={`le-panel le-panel--right${sheet === 'right' ? ' is-open' : ''}`} aria-label="Properties">
        <button type="button" className="le-sheet-close le-icon-btn" onClick={() => setSheet(null)} aria-label="Close panel"><X size={18} /></button>
        {inspector}
      </aside>
      {sheet && <button type="button" className="le-scrim" aria-label="Close panel" onClick={() => setSheet(null)} />}
    </div>

    <nav className="le-dock" aria-label="Editor panels">
      <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('layers'); setSheet(sheet === 'left' && leftTab === 'layers' ? null : 'left') }}><Layers size={18} aria-hidden="true" /> Layers</button>
      <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('pages'); setSheet(sheet === 'left' && leftTab === 'pages' ? null : 'left') }}><FileStack size={18} aria-hidden="true" /> Pages</button>
      <button type="button" className={`le-dock__btn${selected ? ' has-selection' : ''}`} onClick={() => setSheet(sheet === 'right' ? null : 'right')}><Settings2 size={18} aria-hidden="true" /> {selected ? 'Edit' : 'Properties'}</button>
      <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('history'); setSheet(sheet === 'left' && leftTab === 'history' ? null : 'left') }}><History size={18} aria-hidden="true" /> History</button>
    </nav>

    {publishOpen && <div className="le-dialog-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && editor.publishStatus !== 'publishing') setPublishOpen(false) }}>
      <div className="le-dialog" role="dialog" aria-modal="true" aria-labelledby="sl-publish-title">
        <h2 id="sl-publish-title">Publish to every student workspace?</h2>
        {editor.publishStatus === 'published'
          ? <><p className="le-ok" role="status">{editor.publishMessage} Students see it the next time their workspace loads.</p><div className="le-dialog__actions"><Button variant="primary" onClick={() => setPublishOpen(false)}>Done</Button></div></>
          : <>
            <p className="le-hint">This changes the presentation of all student workspaces. Each student’s own data stays private and untouched.</p>
            <ul className="le-changes">
              {changes.length === 0 && <li>No differences from what students see now.</li>}
              {changes.slice(0, 10).map((change, index) => <li key={`${change.label}-${index}`}>{change.area} · {change.label}: {change.detail}</li>)}
              {changes.length > 10 && <li>…and {changes.length - 10} more changes.</li>}
            </ul>
            <label className="le-field"><span className="le-field__label">Note for the version history (optional)</span>
              <input className="cc-input" maxLength={200} value={note} onChange={event => setNote(event.target.value)} /></label>
            <p className="le-hint">You will confirm with your authenticator code. Earlier versions stay restorable in History.</p>
            {editor.publishStatus === 'failed' && <p className="le-error" role="alert">{editor.publishMessage}</p>}
            <div className="le-dialog__actions">
              <Button variant="ghost" disabled={editor.publishStatus === 'publishing'} onClick={() => setPublishOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={editor.publishStatus === 'publishing' || changes.length === 0} onClick={async () => { if (await editor.publish(note.trim())) setNote('') }}>{editor.publishStatus === 'publishing' ? 'Publishing…' : 'Publish now'}</Button>
            </div>
          </>}
      </div>
    </div>}
  </div>
}

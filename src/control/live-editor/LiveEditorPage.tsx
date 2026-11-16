import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Eye, Layers, Maximize2, Minimize2, Monitor, MousePointer2, PanelRight, Plus, Redo2, RefreshCw, Save, Settings2, Smartphone,
  Tablet, Undo2, Upload, X, FileStack, Palette
} from 'lucide-react'
import { Button } from '../ui'
import { ContentEditorContext, type ContentEditorValue } from '../appearance/ContentEditor'
import { LinkSuggestions } from '../appearance/FieldRow'
import { fieldDefinition } from '../../lib/site-content/registry'
import { overridesFromValues, validateFieldValue } from '../../lib/site-content/content'
import { SITE_PAGE_IDS, SITE_PAGE_LABELS, isBuiltinType, type SiteBlock, type SitePageId } from '../../lib/site-editor/model'
import { problemsToErrors } from '../../lib/site-editor/validate'
import {
  clearStyles, createBlock, deleteBlock, duplicateBlock, findBlock, insertBlock, insertionPoint, moveBlock, moveBy, pageBlocks, setPath,
  setStyle, updateBlock, blockLabel, type Device
} from './doc-ops'
import { Inspector } from './Inspector'
import { AddPanel, LayersPanel, PagesPanel, TokensPanel } from './Panels'
import { LinkDatalist } from './PropFields'
import { CANVAS_PATH, isCanvasMessage, type CanvasMessage, type CanvasState, type Selection } from './protocol'
import { effectiveProps, propSpecAt, stripMarkers } from './registry-map'
import { useEditorState, type SaveStatus } from './useEditorState'
import './live-editor.css'

/**
 * Live Site Editor workspace: the real public pages in a same-origin iframe at device widths,
 * selection and inline typing on the page, layers, element library, inspector with per-device
 * styles, undo/redo, autosave to the private draft, and MFA-protected publishing.
 */

type Viewport = 'desktop' | 'tablet' | 'landscape' | 'mobile' | 'custom'
const VIEWPORTS: Record<Exclude<Viewport, 'custom'>, { label: string; width: number; icon: typeof Monitor }> = {
  desktop: { label: 'Desktop 1280', width: 1280, icon: Monitor },
  landscape: { label: 'Tablet landscape 1180', width: 1180, icon: Tablet },
  tablet: { label: 'Tablet portrait 820', width: 820, icon: Tablet },
  mobile: { label: 'Phone 390', width: 390, icon: Smartphone }
}
type LeftTab = 'layers' | 'add' | 'pages' | 'theme'
const LEFT_TABS: Array<{ id: LeftTab; label: string; icon: typeof Layers }> = [
  { id: 'layers', label: 'Layers', icon: Layers }, { id: 'add', label: 'Add', icon: Plus }, { id: 'pages', label: 'Pages', icon: FileStack }, { id: 'theme', label: 'Theme', icon: Palette }
]

const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: 'Loading…', saved: 'Draft saved', unsaved: 'Unsaved changes', saving: 'Saving draft…', invalid: 'Fix highlighted fields', error: 'Not saved — will retry', conflict: 'Draft changed elsewhere'
}

function deviceForWidth(width: number): Device {
  return width <= 640 ? 'mobile' : width <= 1024 ? 'tablet' : 'desktop'
}

export default function LiveEditorPage() {
  const editor = useEditorState()
  const { working, update } = editor
  const [page, setPage] = useState<SitePageId>('home')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [viewport, setViewport] = useState<Viewport>(() => (typeof window === 'undefined' || window.innerWidth >= 1280 ? 'desktop' : window.innerWidth >= 900 ? 'landscape' : window.innerWidth >= 700 ? 'tablet' : 'mobile'))
  const [customWidth, setCustomWidth] = useState(1024)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
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

  const width = viewport === 'custom' ? customWidth : VIEWPORTS[viewport].width
  const [styleDevice, setStyleDevice] = useState<Device>('desktop')
  useEffect(() => { setStyleDevice(deviceForWidth(width)) }, [width])

  // Fit the device frame into the stage.
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

  const document_ = working?.document
  const blocks = useMemo(() => (document_ ? pageBlocks(document_, page) : []), [document_, page])
  const selectedBlock: SiteBlock | null = useMemo(() => (selection?.kind === 'block' ? findBlock(blocks, selection.id)?.block ?? null : null), [blocks, selection])
  useEffect(() => { if (selection?.kind === 'block' && !selectedBlock) setSelection(null) }, [selection, selectedBlock])

  const flash = useCallback((text: string) => { setNotice(text); window.setTimeout(() => setNotice(current => (current === text ? null : current)), 3200) }, [])

  // ---- Document edits (each is one undoable step unless coalesced) ----
  const editDoc = useCallback((recipe: (doc: NonNullable<typeof document_>) => NonNullable<typeof document_> | null, coalesce?: string, failure?: string) => {
    update(current => {
      const next = recipe(current.document)
      if (!next) { if (failure) flash(failure); return null }
      return { ...current, document: next }
    }, coalesce)
  }, [update, flash])

  const selectBlock = useCallback((id: string) => { setSelection({ kind: 'block', id }); setScrollTo(id) }, [])
  const actions = useMemo(() => ({
    select: selectBlock,
    move: (id: string, delta: -1 | 1) => editDoc(doc => moveBy(doc, page, id, delta), undefined, 'That element cannot move there.'),
    drop: (id: string, targetId: string, position: 'before' | 'after' | 'inside') => editDoc(doc => {
      const target = findBlock(pageBlocks(doc, page), targetId)
      if (!target) return null
      if (position === 'inside') return moveBlock(doc, page, id, targetId, target.block.children?.length ?? 0)
      return moveBlock(doc, page, id, target.parentId, target.index + (position === 'after' ? 1 : 0))
    }, undefined, 'That element cannot go there.'),
    toggleHidden: (id: string) => editDoc(doc => updateBlock(doc, page, id, block => ({ ...block, hidden: block.hidden ? undefined : true }))),
    toggleLocked: (id: string) => editDoc(doc => updateBlock(doc, page, id, block => ({ ...block, locked: block.locked ? undefined : true }))),
    duplicate: (id: string) => {
      const current = editor.working
      const result = current ? duplicateBlock(current.document, page, id) : null
      if (!result) { flash('Stracker sections cannot be duplicated.'); return }
      editDoc(() => result.document)
      setSelection({ kind: 'block', id: result.id })
    },
    remove: (id: string) => {
      const current = editor.working
      const located = current ? findBlock(pageBlocks(current.document, page), id) : null
      if (!located) return
      if (isBuiltinType(located.block.type)) { flash('Stracker sections can be hidden but not deleted.'); return }
      if (located.block.locked) { flash('Unlock this element before deleting it.'); return }
      editDoc(doc => deleteBlock(doc, page, id))
      setSelection(located.parentId ? { kind: 'block', id: located.parentId } : null)
      flash(`Deleted ${blockLabel(located.block, page)}. Undo brings it back.`)
    }
  }), [editDoc, page, selectBlock, editor.working, flash])

  const addBlock = useCallback((type: string) => {
    const current = editor.working
    if (!current) return
    const block = createBlock(current.document, page, type)
    const point = insertionPoint(current.document, page, selection?.kind === 'block' ? selection.id : null, block)
    const next = insertBlock(current.document, page, block, point.parentId, point.index) ?? insertBlock(current.document, page, block, null, point.index)
    if (!next) { flash('That element cannot be added here.'); return }
    editDoc(() => next)
    setSelection({ kind: 'block', id: block.id })
    setScrollTo(block.id)
    setSheet(null)
  }, [editor.working, page, selection, editDoc, flash])

  const setValue = useCallback((key: string, value: string) => {
    update(current => (current.values[key] === value ? null : { ...current, values: { ...current.values, [key]: value } }), `value.${key}`)
  }, [update])

  // ---- Canvas messaging ----
  const canvasState = useMemo<CanvasState | null>(() => (working ? {
    type: 'se:state', page, overrides: overridesFromValues(working.values), document: working.document, selected: selection, mode, epoch, scrollTo
  } : null), [working, page, selection, mode, epoch, scrollTo])

  useEffect(() => {
    const target = frameRef.current?.contentWindow
    if (frameReady && target && canvasState) target.postMessage(canvasState, window.location.origin)
  }, [frameReady, canvasState])
  useEffect(() => { if (scrollTo) { const timer = window.setTimeout(() => setScrollTo(null), 400); return () => window.clearTimeout(timer) } return undefined }, [scrollTo])

  const handlers = useRef<(message: CanvasMessage) => void>(() => undefined)
  handlers.current = (message: CanvasMessage) => {
    switch (message.type) {
      case 'se:ready': setFrameReady(true); break
      case 'se:select': setSelection(message.selection); break
      case 'se:page': if (SITE_PAGE_IDS.includes(message.page)) { setPage(message.page); setSelection(null) } break
      case 'se:text': {
        if (message.key) {
          const definition = fieldDefinition(message.key)
          if (definition && (definition.type === 'text' || definition.type === 'multiline')) {
            const value = stripMarkers(message.value).slice(0, definition.maxLength)
            const checked = validateFieldValue(definition, value)
            if (checked.ok) setValue(message.key, checked.value)
            else flash(checked.message)
          }
        } else if (message.prop && message.selection.kind === 'block') {
          const id = message.selection.id
          const path = message.prop
          editDoc(doc => updateBlock(doc, page, id, block => {
            const spec = propSpecAt(block, path)
            const value = spec?.k === 'rich' ? message.value : stripMarkers(message.value).replace(/\n+/g, ' ')
            return { ...block, props: setPath(effectiveProps(block), path, value) as Record<string, unknown> }
          }))
        }
        setEpoch(value => value + 1)
        break
      }
      case 'se:shortcut':
        if (message.action === 'undo') editor.undo()
        else if (message.action === 'redo') editor.redo()
        else if (message.action === 'save') void editor.save()
        else if (message.action === 'escape') setSelection(null)
        else if (selection?.kind === 'block') (message.action === 'delete' ? actions.remove : actions.duplicate)(selection.id)
        break
      case 'se:action': {
        if (selection?.kind !== 'block') break
        const id = selection.id
        if (message.action === 'up' || message.action === 'down') actions.move(id, message.action === 'up' ? -1 : 1)
        else if (message.action === 'duplicate') actions.duplicate(id)
        else if (message.action === 'hide') actions.toggleHidden(id)
        else if (message.action === 'delete') actions.remove(id)
        else if (message.action === 'parent') { const parent = findBlock(blocks, id)?.parentId; if (parent) setSelection({ kind: 'block', id: parent }) }
        break
      }
    }
  }
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow || !isCanvasMessage(event.data)) return
      handlers.current(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Shortcuts when focus is in the editor (not inside a text field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void editor.save(); return }
      if (typing) return
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo() }
      else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo() }
      else if (event.key === 'Escape') { setSelection(null); setSheet(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  // ---- Registry field adapter so the inspector reuses the Appearance field rows ----
  const adapter = useMemo<ContentEditorValue>(() => ({
    state: editor.query.data, loading: editor.query.isLoading, loadError: editor.query.error as Error | null, reload: () => void editor.reloadFromServer(),
    savedValues: working?.values ?? {}, publishedValues: editor.publishedValues, draftExists: Boolean(editor.query.data?.draft.exists),
    values: working?.values ?? {}, dirtyKeys: [], errors: { ...editor.fieldErrors, ...editor.serverErrors }, setValue,
    resetToDefault: key => { const definition = fieldDefinition(key); if (definition) setValue(key, definition.defaultValue) },
    revertEdits: () => undefined, draftChanges: [], saving: false,
    save: async () => ((await editor.save()) ? { ok: true, message: 'Saved.' } : { ok: false, message: editor.saveMessage ?? 'Not saved.' }),
    discardDraft: async () => ({ ok: false, message: 'Use the editor toolbar.' }), publish: async () => ({ ok: false, message: 'Use the editor toolbar.' }),
    restore: async () => ({ ok: false, message: 'Restore from Appearance → Publishing.' }), busy: false
  }), [editor, working, setValue])

  const docErrors = useMemo(() => ({ ...problemsToErrors(editor.problems), ...editor.serverErrors }), [editor.problems, editor.serverErrors])

  if (editor.query.isError && !working) return <div className="le-loading"><p>The editor could not load the site content.</p><Button onClick={() => void editor.query.refetch()}>Try again</Button> <Link to="/control-panel/appearance" className="cc-btn cc-btn--ghost cc-btn--md">Back to Appearance</Link></div>
  if (!working) return <div className="le-loading"><p>Loading the Live Site Editor…</p></div>

  const insertTarget = selectedBlock ? (selectedBlock.children && !isBuiltinType(selectedBlock.type) ? `inside “${blockLabel(selectedBlock, page)}”` : `after “${blockLabel(selectedBlock, page)}”`) : 'at the end of the page'
  const problemsCount = editor.problems.length + Object.keys(editor.fieldErrors).length

  const leftPanel = <>
    <div className="le-panel__tabs" role="tablist" aria-label="Editor panels">
      {LEFT_TABS.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={leftTab === tab.id} className={`le-tab${leftTab === tab.id ? ' is-active' : ''}`} onClick={() => setLeftTab(tab.id)}><tab.icon size={15} aria-hidden="true" /> {tab.label}</button>)}
    </div>
    <div className="le-panel__body">
      {leftTab === 'layers' && <LayersPanel page={page} blocks={blocks} selection={selection} actions={{ ...actions, select: id => { selectBlock(id); setSheet(null) } }} />}
      {leftTab === 'add' && <AddPanel onAdd={addBlock} target={insertTarget} />}
      {leftTab === 'pages' && <PagesPanel page={page} document={working.document} onPage={next => { setPage(next); setSelection(null); setSheet(null) }} />}
      {leftTab === 'theme' && <TokensPanel tokens={working.document.tokens ?? {}} errors={docErrors}
        onChange={(key, value, coalesce) => editDoc(doc => { const tokens = { ...(doc.tokens ?? {}) }; if (value) tokens[key] = value; else delete tokens[key]; return { ...doc, tokens } }, coalesce && `token.${coalesce}`)} />}
    </div>
  </>

  const inspector = <Inspector page={page} selection={selection} block={selectedBlock} device={styleDevice} errors={docErrors} setDevice={setStyleDevice}
    setProp={(key, value, coalesce) => selectedBlock && editDoc(doc => updateBlock(doc, page, selectedBlock.id, block => ({ ...block, props: { ...effectiveProps(block), [key]: value } })), coalesce)}
    setStyle={(device, key, value, coalesce) => selectedBlock && editDoc(doc => setStyle(doc, page, selectedBlock.id, device, key, value), coalesce)}
    clearStyles={device => selectedBlock && editDoc(doc => clearStyles(doc, page, selectedBlock.id, device))}
    setMeta={patch => selectedBlock && editDoc(doc => updateBlock(doc, page, selectedBlock.id, block => {
      const next = { ...block, ...patch }
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) if (!next[key]) delete next[key]
      return next
    }), patch.name !== undefined ? `name.${selectedBlock.id}` : undefined)} />

  return <ContentEditorContext.Provider value={adapter}>
    <div className={`le-root${fullscreen ? ' is-fullscreen' : ''}${mode === 'preview' ? ' is-preview' : ''}`}>
      <LinkSuggestions /><LinkDatalist />
      <header className="le-toolbar" aria-label="Editor toolbar">
        <div className="le-toolbar__group">
          <Link to="/control-panel/appearance" className="le-icon-btn le-back" aria-label="Back to Appearance" title="Back to Appearance"><ArrowLeft size={18} /></Link>
          <select className="cc-input le-page-select" aria-label="Page" value={page} onChange={event => { setPage(event.target.value as SitePageId); setSelection(null) }}>
            {SITE_PAGE_IDS.map(id => <option key={id} value={id}>{SITE_PAGE_LABELS[id]}</option>)}
          </select>
          <span className={`le-status is-${editor.saveStatus}`} role="status" aria-live="polite">{STATUS_TEXT[editor.saveStatus]}{problemsCount ? ` (${problemsCount})` : ''}</span>
        </div>
        <div className="le-toolbar__group">
          <button type="button" className="le-icon-btn" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={18} /></button>
          <button type="button" className="le-icon-btn" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={18} /></button>
          <span className="le-sep" aria-hidden="true" />
          <div className="le-viewports" role="radiogroup" aria-label="Preview width">
            {(Object.keys(VIEWPORTS) as Array<keyof typeof VIEWPORTS>).map(id => { const Icon = VIEWPORTS[id].icon; return <button key={id} type="button" role="radio" aria-checked={viewport === id} className={`le-icon-btn${viewport === id ? ' is-active' : ''}${id === 'landscape' ? ' is-landscape' : ''}`} onClick={() => setViewport(id)} aria-label={VIEWPORTS[id].label} title={VIEWPORTS[id].label}><Icon size={18} /></button> })}
            <label className="le-custom-width" title="Custom width"><span className="cc-sr-only">Custom width</span>
              <input className="cc-input" type="number" min={320} max={1920} step={10} value={width} onChange={event => { setViewport('custom'); setCustomWidth(Math.max(320, Math.min(1920, Number(event.target.value) || 320))) }} />px</label>
          </div>
          <select className="cc-input le-zoom" aria-label="Zoom" value={String(zoom)} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
            <option value="fit">Fit</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
          </select>
        </div>
        <div className="le-toolbar__group">
          <button type="button" className={`le-icon-btn${mode === 'preview' ? ' is-active' : ''}`} onClick={() => { setMode(mode === 'edit' ? 'preview' : 'edit'); setSelection(null) }} aria-pressed={mode === 'preview'} aria-label={mode === 'preview' ? 'Back to editing' : 'Preview'} title={mode === 'preview' ? 'Back to editing' : 'Preview (links work)'}>{mode === 'preview' ? <MousePointer2 size={18} /> : <Eye size={18} />}</button>
          <button type="button" className="le-icon-btn le-hide-xs" onClick={() => setFullscreen(value => !value)} aria-pressed={fullscreen} aria-label="Full screen canvas" title="Full screen canvas">{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
          <button type="button" className="le-icon-btn le-hide-xs" onClick={() => setEpoch(value => value + 1)} aria-label="Reload canvas" title="Reload canvas"><RefreshCw size={18} /></button>
          <Button size="sm" onClick={() => void editor.save()} disabled={!editor.dirty || editor.saveStatus === 'saving'}><Save size={15} aria-hidden="true" /> <span className="le-hide-sm">Save draft</span></Button>
          <Button size="sm" variant="primary" onClick={() => { editor.setPublishStatus('idle'); setPublishOpen(true) }} disabled={editor.invalid}><Upload size={15} aria-hidden="true" /> Publish</Button>
        </div>
      </header>

      {editor.saveStatus === 'conflict' && <div className="le-banner is-warn" role="alert">
        <span>The draft was changed in another tab or by another editor. Reload to take their version (your unsaved edits here are lost), or overwrite it with yours.</span>
        <Button size="sm" onClick={() => void editor.reloadFromServer()}>Reload theirs</Button>
        <Button size="sm" variant="danger" onClick={() => void editor.save({ force: true })}>Overwrite with mine</Button>
      </div>}
      {editor.saveMessage && editor.saveStatus !== 'conflict' && (editor.saveStatus === 'error' || editor.saveStatus === 'invalid') && <div className="le-banner is-crit" role="alert">{editor.saveMessage}</div>}
      {notice && <div className="le-toast" role="status">{notice}</div>}

      <div className="le-body">
        <aside className={`le-panel le-panel--left${sheet === 'left' ? ' is-open' : ''}`} aria-label="Layers and elements">
          <button type="button" className="le-sheet-close le-icon-btn" onClick={() => setSheet(null)} aria-label="Close panel"><X size={18} /></button>
          {leftPanel}
        </aside>
        <main className="le-stage" ref={stageRef} aria-label="Page canvas">
          <div className="le-frame" style={{ width: width * scale, height: frameHeight * scale }}>
            <iframe ref={frameRef} title={`${SITE_PAGE_LABELS[page]} page canvas`} src={CANVAS_PATH}
              style={{ width, height: frameHeight, transform: `scale(${scale})` }} />
          </div>
          <p className="le-stage__caption">{width}px · styles apply to {deviceForWidth(width) === 'desktop' ? 'desktop' : deviceForWidth(width) === 'tablet' ? 'tablet (≤1024px)' : 'phone (≤640px)'}{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}</p>
        </main>
        <aside className={`le-panel le-panel--right${sheet === 'right' ? ' is-open' : ''}`} aria-label="Properties">
          <button type="button" className="le-sheet-close le-icon-btn" onClick={() => setSheet(null)} aria-label="Close panel"><X size={18} /></button>
          {inspector}
        </aside>
        {sheet && <button type="button" className="le-scrim" aria-label="Close panel" onClick={() => setSheet(null)} />}
      </div>

      <nav className="le-dock" aria-label="Editor panels">
        <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('layers'); setSheet(sheet === 'left' && leftTab === 'layers' ? null : 'left') }}><Layers size={18} aria-hidden="true" /> Layers</button>
        <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('add'); setSheet(sheet === 'left' && leftTab === 'add' ? null : 'left') }}><Plus size={18} aria-hidden="true" /> Add</button>
        <button type="button" className={`le-dock__btn${selection ? ' has-selection' : ''}`} onClick={() => setSheet(sheet === 'right' ? null : 'right')}><Settings2 size={18} aria-hidden="true" /> {selection ? 'Edit' : 'Properties'}</button>
        <button type="button" className="le-dock__btn" onClick={() => { setLeftTab('theme'); setSheet(sheet === 'left' && leftTab === 'theme' ? null : 'left') }}><PanelRight size={18} aria-hidden="true" /> Theme</button>
      </nav>

      {publishOpen && <div className="le-dialog-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && editor.publishStatus !== 'publishing') setPublishOpen(false) }}>
        <div className="le-dialog" role="dialog" aria-modal="true" aria-labelledby="le-publish-title">
          <h2 id="le-publish-title">Publish to the live site?</h2>
          {editor.publishStatus === 'published'
            ? <><p className="le-ok" role="status">{editor.publishMessage} Visitors see it on their next page load.</p><div className="le-dialog__actions"><Button variant="primary" onClick={() => setPublishOpen(false)}>Done</Button></div></>
            : <>
              <ul className="le-changes">
                {editor.pendingText.length === 0 && !editor.layoutChanged && <li>No differences from the live site.</li>}
                {editor.layoutChanged && <li>Page layout, added elements, styles or theme changed.</li>}
                {editor.pendingText.slice(0, 8).map(change => <li key={change.key}>{change.section}: {change.label}</li>)}
                {editor.pendingText.length > 8 && <li>…and {editor.pendingText.length - 8} more text changes.</li>}
              </ul>
              <label className="le-field"><span className="le-field__label">Note for the version history (optional)</span>
                <input className="cc-input" maxLength={200} value={note} onChange={event => setNote(event.target.value)} /></label>
              <p className="le-hint">You will confirm with your authenticator code. Earlier versions stay restorable in Appearance → Publishing.</p>
              {editor.publishStatus === 'failed' && <p className="le-error" role="alert">{editor.publishMessage}</p>}
              <div className="le-dialog__actions">
                <Button variant="ghost" disabled={editor.publishStatus === 'publishing'} onClick={() => setPublishOpen(false)}>Cancel</Button>
                <Button variant="primary" disabled={editor.publishStatus === 'publishing' || (editor.pendingText.length === 0 && !editor.layoutChanged)} onClick={async () => { if (await editor.publish(note.trim())) setNote('') }}>{editor.publishStatus === 'publishing' ? 'Publishing…' : 'Publish now'}</Button>
              </div>
            </>}
        </div>
      </div>}
    </div>
  </ContentEditorContext.Provider>
}

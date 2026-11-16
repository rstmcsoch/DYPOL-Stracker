import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, History, Lock, RotateCcw, Unlock } from 'lucide-react'
import { Button } from '../ui'
import { COMPONENT_MAP, STUDENT_PAGES, type StudentPageId } from '../../lib/student-layout/registry'
import type { StudentLayoutDocument } from '../../lib/student-layout/validate'
import { changedAreas } from '../../lib/student-layout/diff'
import { canHide, configOf, orderOf } from './layout-ops'
import type { StudentLayoutVersion } from './useStudentEditorState'

export interface LayerActions {
  select: (id: string) => void
  move: (id: string, delta: -1 | 1) => void
  toggleHidden: (id: string) => void
  toggleLocked: (id: string) => void
}

/** Registered parts of a page as a tree, in the working order. */
export function LayersPanel({ page, document, selected, actions }: { page: StudentPageId; document: StudentLayoutDocument; selected: string | null; actions: LayerActions }) {
  const render = (id: string, depth: number, siblings: string[]) => {
    const def = COMPONENT_MAP.get(id)
    if (!def) return null
    const config = configOf(document, id)
    const children = def.children ? orderOf(document, id) : []
    const movable = def.caps.reorderable && siblings.length > 1
    const reorderable = siblings.filter(item => COMPONENT_MAP.get(item)?.caps.reorderable)
    const first = reorderable[0] === id
    const last = reorderable[reorderable.length - 1] === id
    return <li key={id} role="treeitem" aria-selected={selected === id} aria-expanded={children.length ? true : undefined}>
      <div className={`le-layer${selected === id ? ' is-selected' : ''}${config.hidden ? ' is-hidden' : ''}${config.locked ? ' is-locked' : ''}`} style={{ paddingInlineStart: 6 + depth * 14 }}>
        <span className="le-layer__twisty" aria-hidden="true" />
        <button type="button" className="le-layer__name" onClick={() => actions.select(id)} title={id}>
          {def.label}{def.caps.dataBound && <span className="le-layer__tag" title="Shows live student data (locked)"><Lock size={10} aria-hidden="true" /> data</span>}
        </button>
        <span className="le-layer__actions">
          {movable && <>
            <button type="button" className="le-icon-btn is-secondary" disabled={first || config.locked} onClick={() => actions.move(id, -1)} aria-label={`Move ${def.label} up`} title="Move up"><ChevronUp size={14} /></button>
            <button type="button" className="le-icon-btn is-secondary" disabled={last || config.locked} onClick={() => actions.move(id, 1)} aria-label={`Move ${def.label} down`} title="Move down"><ChevronDown size={14} /></button>
          </>}
          {canHide(id) && <button type="button" className="le-icon-btn" disabled={config.locked} onClick={() => actions.toggleHidden(id)} aria-label={config.hidden ? `Show ${def.label}` : `Hide ${def.label}`} title={config.hidden ? 'Show' : 'Hide'}>{config.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
          {def.caps.lockable && <button type="button" className="le-icon-btn is-secondary" onClick={() => actions.toggleLocked(id)} aria-label={config.locked ? `Unlock ${def.label} in the editor` : `Lock ${def.label} in the editor`} title={config.locked ? 'Unlock editing' : 'Lock editing'}>{config.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>}
        </span>
      </div>
      {children.length > 0 && <ul className="le-layers__list" role="group">{children.map(child => render(child, depth + 1, children))}</ul>}
    </li>
  }
  const root = page
  return <div className="le-layers">
    <ul className="le-layers__list" role="tree" aria-label="Page parts">{render(root, 0, [root])}</ul>
    <p className="le-hint">Only presentation can change here. Parts marked <Lock size={10} aria-hidden="true" /> data show each student’s own records, which stay live and are never editable. Required parts cannot be hidden.</p>
    {page !== 'home' && page !== 'shell' && <p className="le-hint">Page sections keep their functional order; you can restyle them, edit the page title and info tip, and hide optional sections. Section contents are live student data.</p>}
  </div>
}

export function PagesPanel({ page, document, onPage }: { page: StudentPageId; document: StudentLayoutDocument; onPage: (page: StudentPageId) => void }) {
  const changed = new Set(changedAreas(null, document))
  return <ul className="le-pages">
    {STUDENT_PAGES.map(entry => <li key={entry.id}>
      <button type="button" className={`le-page-item${page === entry.id ? ' is-active' : ''}`} aria-current={page === entry.id ? 'page' : undefined} onClick={() => onPage(entry.id)}>
        <span>{entry.label}</span>
        <span className="le-hint">{entry.path ?? 'Sidebar, top bar, mobile bar'}{changed.has(entry.id) || (entry.id === 'shell' && changed.has('navigation')) ? ' · customised' : ''}</span>
      </button>
    </li>)}
  </ul>
}

export function HistoryPanel({ versions, publishedVersion, draftExists, onRestore, onDiscard }: {
  versions: StudentLayoutVersion[]; publishedVersion: number; draftExists: boolean
  onRestore: (version: number) => Promise<string>; onDiscard: () => Promise<void>
}) {
  const [busy, setBusy] = useState<number | 'discard' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (key: number | 'discard', action: () => Promise<string | void>) => {
    setBusy(key)
    setMessage(null)
    try { const text = await action(); setMessage({ ok: true, text: text || 'Done.' }) }
    catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : 'That did not work. Nothing was changed.' }) }
    finally { setBusy(null) }
  }
  return <div className="le-history">
    <p className="le-hint">Live for students: {publishedVersion ? `version ${publishedVersion}` : 'the shipped layout (nothing published yet)'}.</p>
    {draftExists && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { if (window.confirm('Discard the unpublished draft? Student workspaces are not affected.')) void run('discard', onDiscard) }}><RotateCcw size={13} aria-hidden="true" /> Discard draft</Button>}
    {message && <p className={message.ok ? 'le-ok' : 'le-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    {!versions.length && <p className="le-empty">No versions yet. Publishing creates the first one.</p>}
    <ul className="le-pages">
      {versions.map(item => <li key={item.version} className="le-version">
        <div><strong><History size={13} aria-hidden="true" /> Version {item.version}</strong>{item.version === publishedVersion && <span className="le-chip is-active">Live</span>}</div>
        <span className="le-hint">{new Date(item.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST · {item.action === 'restore' ? `restored from v${item.restoredFrom}` : 'published'}{item.createdByYou ? ' by you' : ''}</span>
        {item.note && <span className="le-hint">“{item.note}”</span>}
        {item.version !== publishedVersion && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { if (window.confirm(`Publish version ${item.version} again for every student workspace? You will confirm with your authenticator code.`)) void run(item.version, () => onRestore(item.version)) }}>{busy === item.version ? 'Restoring…' : 'Restore this version'}</Button>}
      </li>)}
    </ul>
  </div>
}

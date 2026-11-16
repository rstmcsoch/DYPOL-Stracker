import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Copy, Eye, EyeOff, FileText, Lock, Search, Trash2, Unlock } from 'lucide-react'
import { BarChart3, Columns3, Image as ImageIcon, Info, MousePointerClick, Type, ListChecks } from 'lucide-react'
import { BLOCK_CATEGORIES, BLOCK_SPEC_LIST, type BlockSpec } from '../../lib/site-editor/blocks-spec'
import { BUILTIN_SECTIONS, SITE_PAGE_IDS, SITE_PAGE_LABELS, SITE_PAGE_PATHS, isBuiltinType, type SiteBlock, type SiteDocument, type SitePageId } from '../../lib/site-editor/model'
import { DESIGN_TOKENS } from '../../lib/site-editor/styles-spec'
import { blockLabel } from './doc-ops'
import type { Selection } from './protocol'

/* ------------------------------------------------------------------ Layers */

export interface LayerActions {
  select: (id: string) => void
  move: (id: string, delta: -1 | 1) => void
  drop: (id: string, targetId: string, position: 'before' | 'after' | 'inside') => void
  toggleHidden: (id: string) => void
  toggleLocked: (id: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
}

function matches(block: SiteBlock, page: SitePageId, query: string): boolean {
  if (!query) return true
  if (blockLabel(block, page).toLowerCase().includes(query) || block.type.toLowerCase().includes(query)) return true
  return (block.children ?? []).some(child => matches(child, page, query))
}

export function LayersPanel({ page, blocks, selection, actions }: { page: SitePageId; blocks: SiteBlock[]; selection: Selection | null; actions: LayerActions }) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; position: 'before' | 'after' | 'inside' } | null>(null)
  const needle = query.trim().toLowerCase()
  const selectedId = selection?.kind === 'block' ? selection.id : null

  const onDragOver = (event: DragEvent<HTMLDivElement>, block: SiteBlock) => {
    if (!dragging || dragging === block.id) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    const container = Boolean(block.children)
    const position = container && ratio > 0.3 && ratio < 0.7 ? 'inside' : ratio < 0.5 ? 'before' : 'after'
    if (over?.id !== block.id || over.position !== position) setOver({ id: block.id, position })
  }

  const renderList = (list: SiteBlock[], depth: number) => <ul className="le-layers__list" role={depth ? 'group' : 'tree'} aria-label={depth ? undefined : 'Page layers'}>
    {list.filter(block => matches(block, page, needle)).map((block, index, visible) => {
      const builtin = isBuiltinType(block.type)
      const open = !collapsed[block.id] || Boolean(needle)
      const hasChildren = Boolean(block.children?.length)
      return <li key={block.id} role="treeitem" aria-selected={selectedId === block.id} aria-expanded={hasChildren ? open : undefined}>
        <div className={`le-layer${selectedId === block.id ? ' is-selected' : ''}${block.hidden ? ' is-hidden' : ''}${block.locked ? ' is-locked' : ''}${over?.id === block.id ? ` is-drop-${over.position}` : ''}`}
          style={{ paddingInlineStart: 6 + depth * 14 }} draggable={!block.locked}
          onDragStart={event => { setDragging(block.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', block.id) }}
          onDragEnd={() => { setDragging(null); setOver(null) }}
          onDragOver={event => onDragOver(event, block)}
          onDragLeave={() => setOver(current => (current?.id === block.id ? null : current))}
          onDrop={event => { event.preventDefault(); if (dragging && over) actions.drop(dragging, block.id, over.position); setDragging(null); setOver(null) }}>
          {hasChildren
            ? <button type="button" className="le-icon-btn le-layer__twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setCollapsed(state => ({ ...state, [block.id]: open }))}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            : <span className="le-layer__twisty" aria-hidden="true" />}
          <button type="button" className="le-layer__name" onClick={() => actions.select(block.id)} title={block.type}>
            {blockLabel(block, page)}{builtin && <span className="le-layer__tag">Stracker</span>}
          </button>
          <span className="le-layer__actions">
            <button type="button" className="le-icon-btn is-secondary" disabled={index === 0 || block.locked} onClick={() => actions.move(block.id, -1)} aria-label={`Move ${blockLabel(block, page)} up`} title="Move up"><ChevronUp size={14} /></button>
            <button type="button" className="le-icon-btn is-secondary" disabled={index === visible.length - 1 || block.locked} onClick={() => actions.move(block.id, 1)} aria-label={`Move ${blockLabel(block, page)} down`} title="Move down"><ChevronDown size={14} /></button>
            <button type="button" className="le-icon-btn" onClick={() => actions.toggleHidden(block.id)} aria-label={block.hidden ? 'Show' : 'Hide'} title={block.hidden ? 'Show' : 'Hide'}>{block.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <button type="button" className="le-icon-btn is-secondary" onClick={() => actions.toggleLocked(block.id)} aria-label={block.locked ? 'Unlock' : 'Lock'} title={block.locked ? 'Unlock' : 'Lock'}>{block.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
            {!builtin && <button type="button" className="le-icon-btn is-secondary" onClick={() => actions.duplicate(block.id)} aria-label="Duplicate" title="Duplicate"><Copy size={14} /></button>}
            {!builtin && <button type="button" className="le-icon-btn is-danger is-secondary" disabled={block.locked} onClick={() => actions.remove(block.id)} aria-label="Delete" title="Delete"><Trash2 size={14} /></button>}
          </span>
        </div>
        {hasChildren && open && renderList(block.children!, depth + 1)}
      </li>
    })}
  </ul>

  return <div className="le-layers">
    <label className="le-search"><Search size={14} aria-hidden="true" /><input className="cc-input" type="search" placeholder="Find a layer" value={query} onChange={event => setQuery(event.target.value)} aria-label="Find a layer" /></label>
    {renderList(blocks, 0)}
    <p className="le-hint">Drag layers to reorder or drop into a container, or use the arrows. Header and footer are edited by tapping them on the page.</p>
  </div>
}

/* ------------------------------------------------------------- Add elements */

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  Layout: Columns3, Text: Type, 'Buttons & links': MousePointerClick, Media: ImageIcon, Information: Info, Data: BarChart3, Interactive: ListChecks
}

function SpecIcon({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] ?? FileText
  return <Icon size={18} aria-hidden="true" />
}

export function AddPanel({ onAdd, target }: { onAdd: (type: string) => void; target: string }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const list = useMemo(() => BLOCK_SPEC_LIST.filter(spec => !needle || `${spec.label} ${spec.hint} ${spec.keywords ?? ''} ${spec.category}`.toLowerCase().includes(needle)), [needle])
  const groups = BLOCK_CATEGORIES.map(category => [category, list.filter(spec => spec.category === category)] as const).filter(([, items]) => items.length)
  const item = (spec: BlockSpec) => <li key={spec.type}>
    <button type="button" className="le-add-item" onClick={() => onAdd(spec.type)} draggable={false}>
      <SpecIcon category={spec.category} /><span><strong>{spec.label}</strong><small>{spec.hint}</small></span>
    </button>
  </li>
  return <div className="le-add">
    <label className="le-search"><Search size={14} aria-hidden="true" /><input className="cc-input" type="search" placeholder="Search elements" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search elements" /></label>
    <p className="le-hint">Adds {target}. Every element starts phone-friendly; adjust it per device in Responsive.</p>
    {groups.map(([category, items]) => <section key={category}><h4 className="le-subhead">{category}</h4><ul className="le-add-grid">{items.map(item)}</ul></section>)}
    {!groups.length && <p className="le-hint">No element matches “{query}”.</p>}
  </div>
}

/* --------------------------------------------------------------------- Pages */

export function PagesPanel({ page, document, onPage }: { page: SitePageId; document: SiteDocument; onPage: (page: SitePageId) => void }) {
  return <ul className="le-pages">
    {SITE_PAGE_IDS.map(id => {
      const extra = (document.pages[id]?.blocks ?? []).filter(block => !isBuiltinType(block.type)).length
      const hidden = (document.pages[id]?.blocks ?? []).filter(block => block.hidden && isBuiltinType(block.type)).length
      return <li key={id}>
        <button type="button" className={`le-page-item${page === id ? ' is-active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => onPage(id)}>
          <strong>{SITE_PAGE_LABELS[id]}</strong>
          <small>{SITE_PAGE_PATHS[id]} · {BUILTIN_SECTIONS[id].length} Stracker section{BUILTIN_SECTIONS[id].length === 1 ? '' : 's'}{extra ? ` · ${extra} added` : ''}{hidden ? ` · ${hidden} hidden` : ''}</small>
        </button>
      </li>
    })}
    <li className="le-hint">The student dashboard, sign-in pages and Control Center are not editable here.</li>
  </ul>
}

/* ---------------------------------------------------------------- Design tokens */

export function TokensPanel({ tokens, errors, onChange }: { tokens: Record<string, string>; errors: Record<string, string>; onChange: (key: string, value: string, coalesce?: string) => void }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const groups = [...new Set(DESIGN_TOKENS.map(token => token.group))]
  return <div className="le-tokens">
    <div className="le-devices" role="radiogroup" aria-label="Theme">
      {(['light', 'dark'] as const).map(item => <button key={item} type="button" role="radio" aria-checked={theme === item} className={`le-chip${theme === item ? ' is-active' : ''}`} onClick={() => setTheme(item)}>{item === 'light' ? 'Light theme' : 'Dark theme'}</button>)}
    </div>
    <p className="le-hint">Site-wide colours and shapes. Empty uses the built-in Stracker value. Changes apply to every public page.</p>
    {groups.map(group => <fieldset key={group} className="le-fieldset"><legend>{group}</legend>
      {DESIGN_TOKENS.filter(token => token.group === group).map(token => {
        const key = `${theme}:${token.key}`
        const value = tokens[key] ?? ''
        const error = Object.entries(errors).find(([path]) => path.endsWith(key))?.[1]
        return <div key={key} className="le-field le-field--style">
          <label className="le-field__label" htmlFor={`le-token-${key}`}>{token.label}</label>
          <div className="le-color">
            {token.kind === 'color' && <input type="color" aria-label={`${token.label}: pick a colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={event => onChange(key, event.target.value, key)} />}
            <input id={`le-token-${key}`} className="cc-input" value={value} placeholder="Default" onChange={event => onChange(key, event.target.value.trim(), key)} />
          </div>
          {error && <p className="le-error" role="alert">{error}</p>}
        </div>
      })}
    </fieldset>)}
  </div>
}

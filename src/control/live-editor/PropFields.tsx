import { useId, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Bold, Italic, Plus, Trash2, Underline } from 'lucide-react'
import { Button } from '../ui'
import { HOMEPAGE_ANCHOR_TARGETS, INTERNAL_ROUTE_TARGETS } from '../../lib/site-content/registry'
import type { PropSpec } from '../../lib/site-editor/blocks-spec'
import { MediaUpload } from './MediaUpload'

/** Human labels for prop keys (fallback: the key, spaced). */
const LABELS: Record<string, string> = {
  text: 'Text', level: 'Heading level', highlight: 'Highlighted words', size: 'Size', pill: 'Pill style', items: 'Items', ordered: 'Numbered', marker: 'Marker',
  cite: 'Source', tone: 'Colour', label: 'Label', href: 'Destination', variant: 'Style', arrow: 'Arrow', align: 'Alignment', title: 'Title', body: 'Text',
  src: 'File', alt: 'Alt text (describe the image)', caption: 'Caption', ratio: 'Aspect ratio', fit: 'Fit', focus: 'Focal point', frame: 'Frame', images: 'Images',
  columns: 'Columns (desktop)', tablet: 'Columns (tablet)', mobile: 'Columns (phone)', poster: 'Poster image', icon: 'Icon', points: 'Bullet points', image: 'Image',
  value: 'Value', layout: 'Layout', quote: 'Quote', name: 'Name', role: 'Role', leftTitle: 'Left heading', left: 'Left points', rightTitle: 'Right heading', right: 'Right points',
  single: 'Open one at a time', background: 'Background', width: 'Width', anchor: 'Anchor id (for #links)', surface: 'Surface', direction: 'Direction', justify: 'Justify',
  wrap: 'Wrap', gap: 'Gap', style: 'Line style', orientation: 'Orientation', speed: 'Speed', steps: 'Steps', step: 'Step', link: 'Chip text'
}
const propLabel = (key: string) => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())

const LINK_SUGGESTIONS = [...INTERNAL_ROUTE_TARGETS, ...HOMEPAGE_ANCHOR_TARGETS]

export function LinkDatalist() {
  return <datalist id="le-links">{LINK_SUGGESTIONS.map(target => <option key={target} value={target} />)}</datalist>
}

function wrapSelection(textarea: HTMLTextAreaElement | HTMLInputElement | null, mark: string, onChange: (value: string) => void) {
  if (!textarea) return
  const { selectionStart: start = 0, selectionEnd: end = 0, value } = textarea
  const s = start ?? 0, e = end ?? 0
  const selected = value.slice(s, e) || 'text'
  onChange(`${value.slice(0, s)}${mark}${selected}${mark}${value.slice(e)}`)
  requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(s + mark.length, s + mark.length + selected.length) })
}

export function FieldShell({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  return <div className={`le-field${error ? ' is-invalid' : ''}`}>
    <label className="le-field__label" htmlFor={htmlFor}>{label}</label>
    {children}
    {error ? <p className="le-error" role="alert">{error}</p> : hint ? <p className="le-hint">{hint}</p> : null}
  </div>
}

export function PropField({ name, spec, value, onChange, error, coalesceKey }: {
  name: string; spec: PropSpec; value: unknown; onChange: (value: unknown, coalesce?: string) => void; error?: string; coalesceKey: string
}) {
  const id = useId()
  const label = propLabel(name)
  const text = typeof value === 'string' ? value : ''
  switch (spec.k) {
    case 'text':
      return <FieldShell label={label} htmlFor={id} error={error} hint={`${text.length}/${spec.max}`}>
        <input id={id} className="cc-input" value={text} maxLength={spec.max + 20} onChange={event => onChange(event.target.value, coalesceKey)} />
      </FieldShell>
    case 'rich': {
      return <FieldShell label={label} htmlFor={id} error={error} hint="Select words, then B / I / U. Line breaks are kept.">
        <div className="le-rich-tools" role="toolbar" aria-label={`${label} formatting`}>
          <button type="button" className="le-icon-btn" title="Bold" aria-label="Bold" onClick={() => wrapSelection(document.getElementById(id) as HTMLTextAreaElement, '**', next => onChange(next))}><Bold size={15} /></button>
          <button type="button" className="le-icon-btn" title="Italic" aria-label="Italic" onClick={() => wrapSelection(document.getElementById(id) as HTMLTextAreaElement, '*', next => onChange(next))}><Italic size={15} /></button>
          <button type="button" className="le-icon-btn" title="Underline" aria-label="Underline" onClick={() => wrapSelection(document.getElementById(id) as HTMLTextAreaElement, '__', next => onChange(next))}><Underline size={15} /></button>
        </div>
        <textarea id={id} className="cc-input le-textarea" rows={Math.min(10, Math.max(3, text.split('\n').length + 1))} value={text} onChange={event => onChange(event.target.value, coalesceKey)} />
      </FieldShell>
    }
    case 'link':
      return <FieldShell label={label} htmlFor={id} error={error} hint="A public page (/signup), a section (#features) or a full https:// address.">
        <input id={id} className="cc-input" list="le-links" value={text} autoComplete="off" spellCheck={false} onChange={event => onChange(event.target.value, coalesceKey)} />
      </FieldShell>
    case 'media':
      return <FieldShell label={label} error={error}><MediaUpload kind={spec.media} value={text} onChange={next => onChange(next)} label={label} /></FieldShell>
    case 'select':
      return <FieldShell label={label} htmlFor={id} error={error}>
        <select id={id} className="cc-input" value={String(value ?? spec.options[0])} onChange={event => onChange(event.target.value)}>
          {spec.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </FieldShell>
    case 'number':
      return <FieldShell label={label} htmlFor={id} error={error}>
        <input id={id} className="cc-input" type="number" inputMode="decimal" min={spec.min} max={spec.max} step={spec.int ? 1 : 'any'} value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value === '' ? spec.min : Number(event.target.value), coalesceKey)} />
      </FieldShell>
    case 'bool':
      return <label className="le-check"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} /> {label}</label>
    case 'strings':
      return <StringsField label={label} items={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []} max={spec.max} onChange={(next, coalesce) => onChange(next, coalesce)} coalesceKey={coalesceKey} error={error} />
    case 'list':
      return <ListField label={label} spec={spec} items={Array.isArray(value) ? value as Array<Record<string, unknown>> : []} onChange={(next, coalesce) => onChange(next, coalesce)} coalesceKey={coalesceKey} error={error} />
    default:
      return null
  }
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

export function RowActions({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  return <span className="le-row-actions">
    <button type="button" className="le-icon-btn" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${label} up`} title="Move up"><ArrowUp size={14} /></button>
    <button type="button" className="le-icon-btn" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${label} down`} title="Move down"><ArrowDown size={14} /></button>
    <button type="button" className="le-icon-btn is-danger" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove"><Trash2 size={14} /></button>
  </span>
}

function StringsField({ label, items, max, onChange, coalesceKey, error }: { label: string; items: string[]; max: number; onChange: (items: string[], coalesce?: string) => void; coalesceKey: string; error?: string }) {
  return <FieldShell label={`${label} (${items.length}/${max})`} error={error}>
    <ol className="le-list">
      {items.map((item, index) => <li key={index} className="le-list__row">
        <input className="cc-input" value={item} aria-label={`${label} ${index + 1}`} onChange={event => onChange(items.map((value, i) => (i === index ? event.target.value : value)), `${coalesceKey}.${index}`)} />
        <RowActions index={index} count={items.length} label={`item ${index + 1}`} onMove={to => onChange(move(items, index, to))} onRemove={() => onChange(items.filter((_, i) => i !== index))} />
      </li>)}
    </ol>
    <Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, 'New item'])}><Plus size={14} aria-hidden="true" /> Add item</Button>
  </FieldShell>
}

function emptyItem(spec: Extract<PropSpec, { k: 'list' }>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec.item).map(([key, item]) => [key, item.k === 'bool' ? false : item.k === 'number' ? item.min : item.k === 'select' ? item.options[0] : item.k === 'text' && !item.optional ? 'New item' : '']))
}

function ListField({ label, spec, items, onChange, coalesceKey, error }: { label: string; spec: Extract<PropSpec, { k: 'list' }>; items: Array<Record<string, unknown>>; onChange: (items: Array<Record<string, unknown>>, coalesce?: string) => void; coalesceKey: string; error?: string }) {
  return <FieldShell label={`${label} (${items.length}/${spec.max})`} error={error}>
    <ol className="le-cards">
      {items.map((item, index) => <li key={index} className="le-card">
        <div className="le-card__head"><strong>{index + 1}</strong><RowActions index={index} count={items.length} label={`item ${index + 1}`} onMove={to => onChange(move(items, index, to))} onRemove={() => onChange(items.filter((_, i) => i !== index))} /></div>
        {Object.entries(spec.item).map(([key, itemSpec]) => <PropField key={key} name={key} spec={itemSpec} value={item[key]} coalesceKey={`${coalesceKey}.${index}.${key}`}
          onChange={(value, coalesce) => onChange(items.map((current, i) => (i === index ? { ...current, [key]: value } : current)), coalesce)} />)}
      </li>)}
    </ol>
    <Button size="sm" disabled={items.length >= spec.max} onClick={() => onChange([...items, emptyItem(spec)])}><Plus size={14} aria-hidden="true" /> Add item</Button>
  </FieldShell>
}

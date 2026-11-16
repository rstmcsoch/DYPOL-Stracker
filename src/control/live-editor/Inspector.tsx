import { useMemo, useState } from 'react'
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import { FieldRow } from '../appearance/FieldRow'
import { BLOCK_SPECS, BUILTIN_PROP_SPECS, type PropSpec } from '../../lib/site-editor/blocks-spec'
import { BUILTIN_DEFAULTS, registryFieldsFor } from './registry-map'
import { isBuiltinType, type SiteBlock, type SitePageId } from '../../lib/site-editor/model'
import { DEVICE_LABELS, blockLabel, type Device } from './doc-ops'
import { ChartEditor, TableEditor, type ChartValue, type TableValue } from './DataEditors'
import { PropField } from './PropFields'
import { StylePanel } from './StylePanel'
import type { Selection } from './protocol'

type Tab = 'content' | 'style' | 'layout' | 'link' | 'responsive' | 'advanced'
const TAB_LABELS: Record<Tab, string> = { content: 'Content', style: 'Style', layout: 'Layout', link: 'Link', responsive: 'Responsive', advanced: 'Advanced' }

export interface InspectorProps {
  page: SitePageId
  selection: Selection | null
  block: SiteBlock | null
  device: Device
  errors: Record<string, string>
  setDevice: (device: Device) => void
  setProp: (key: string, value: unknown, coalesce?: string) => void
  setStyle: (device: Device, key: string, value: string, coalesce?: string) => void
  clearStyles: (device: Device) => void
  setMeta: (patch: Partial<Pick<SiteBlock, 'name' | 'hidden' | 'locked'>>) => void
}

export function Inspector({ page, selection, block, device, errors, setDevice, setProp, setStyle, clearStyles, setMeta }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('content')
  const builtin = block ? isBuiltinType(block.type) : true
  const specs: Record<string, PropSpec> = useMemo(() => (block ? (builtin ? BUILTIN_PROP_SPECS[block.type] ?? {} : BLOCK_SPECS[block.type]?.props ?? {}) : {}), [block, builtin])
  const registry = useMemo(() => (selection ? registryFieldsFor(selection.id) : []), [selection])

  if (!selection) return <div className="le-empty">
    <p><strong>Nothing selected.</strong></p>
    <p>Tap any part of the page, or pick a layer, to edit it. Double-tap text to type straight into the page.</p>
  </div>

  const blockErrors = block ? Object.fromEntries(Object.entries(errors).filter(([path]) => path.includes(`"${block.id}"`) || path.includes(block.id))) : {}
  const linkKeys = Object.entries(specs).filter(([, spec]) => spec.k === 'link').map(([key]) => key)
  const contentKeys = Object.entries(specs).filter(([, spec]) => spec.k !== 'link').map(([key]) => key)
  const registryLinks = registry.filter(field => field.type === 'link')
  const registryContent = registry.filter(field => field.type !== 'link')
  const props = { ...(block && builtin ? BUILTIN_DEFAULTS[block.type] ?? {} : {}), ...(block?.props ?? {}) }
  const tabs: Tab[] = selection.kind === 'region' ? ['content', 'link'] : ['content', 'style', 'layout', 'link', 'responsive', 'advanced']

  const renderProp = (key: string) => {
    const spec = specs[key]!
    const error = Object.entries(errors).find(([path]) => path.endsWith(`.props.${key}`))?.[1]
    if (spec.k === 'table') return <TableEditor key={key} value={props[key] as TableValue} onChange={(next, coalesce) => setProp(key, next, coalesce && `table.${coalesce}`)} />
    if (spec.k === 'chart') return <ChartEditor key={key} value={props[key] as ChartValue} onChange={(next, coalesce) => setProp(key, next, coalesce && `chart.${coalesce}`)} />
    return <PropField key={key} name={key} spec={spec} value={props[key]} error={error} coalesceKey={`${block?.id}.${key}`} onChange={(value, coalesce) => setProp(key, value, coalesce)} />
  }

  return <div className="le-inspector">
    <div className="le-inspector__title">
      <strong>{selection.kind === 'region' ? (selection.id === 'header' ? 'Header' : 'Footer') : block ? blockLabel(block, page) : ''}</strong>
      {block && <span className="le-hint">{builtin ? 'Stracker section' : BLOCK_SPECS[block.type]?.label}</span>}
    </div>
    <div className="le-tabs" role="tablist" aria-label="Properties">
      {tabs.map(item => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`le-tab${tab === item ? ' is-active' : ''}`} onClick={() => setTab(item)}>{TAB_LABELS[item]}</button>)}
    </div>
    <div className="le-inspector__body" role="tabpanel">
      {(tab === 'content' || !tabs.includes(tab)) && <>
        {contentKeys.map(renderProp)}
        {registryContent.length > 0 && <div className="le-registry">
          {builtin && contentKeys.length > 0 && <h4 className="le-subhead">Section text</h4>}
          {registryContent.map(field => <FieldRow key={field.key} definition={field} showContext={false} />)}
        </div>}
        {!contentKeys.length && !registryContent.length && <p className="le-hint">This element has no text of its own. Use Style and Layout to change how it looks.</p>}
      </>}
      {tab === 'link' && <>
        {linkKeys.map(renderProp)}
        {registryLinks.map(field => <FieldRow key={field.key} definition={field} showContext={false} />)}
        {!linkKeys.length && !registryLinks.length && <p className="le-hint">This element has no link or action.</p>}
      </>}
      {block && (tab === 'style' || tab === 'layout' || tab === 'responsive') && <>
        <div className="le-devices" role="radiogroup" aria-label="Device">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map(item => <button key={item} type="button" role="radio" aria-checked={device === item} className={`le-chip${device === item ? ' is-active' : ''}`} onClick={() => setDevice(item)}>{DEVICE_LABELS[item]}</button>)}
        </div>
        <StylePanel block={block} device={device}
          groups={tab === 'style' ? ['Typography', 'Colours', 'Appearance'] : tab === 'layout' ? ['Dimensions', 'Spacing', 'Layout'] : ['Visibility', 'Typography', 'Spacing', 'Dimensions', 'Layout']}
          errors={blockErrors} onChange={(key, value, coalesce) => setStyle(device, key, value, coalesce && `${block.id}.${device}.${coalesce}`)} onClear={() => clearStyles(device)} />
      </>}
      {block && tab === 'advanced' && <div className="le-advanced">
        <label className="le-field"><span className="le-field__label">Layer name (only you see this)</span>
          <input className="cc-input" value={block.name ?? ''} maxLength={60} placeholder={blockLabel({ ...block, name: undefined }, page)} onChange={event => setMeta({ name: event.target.value || undefined })} /></label>
        <div className="le-inline-row">
          <button type="button" className="le-chip" onClick={() => setMeta({ hidden: !block.hidden })}>{block.hidden ? <EyeOff size={14} /> : <Eye size={14} />} {block.hidden ? 'Hidden from visitors' : 'Visible'}</button>
          <button type="button" className="le-chip" onClick={() => setMeta({ locked: !block.locked })}>{block.locked ? <Lock size={14} /> : <Unlock size={14} />} {block.locked ? 'Locked' : 'Unlocked'}</button>
        </div>
        <p className="le-hint">Element id: <code>{block.id}</code>{builtin ? ' · Stracker sections can be hidden or moved, not deleted.' : ''}</p>
      </div>}
    </div>
  </div>
}

import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { Eye, EyeOff, Lock, RotateCcw, Unlock } from 'lucide-react'
import { Button } from '../ui'
import { COMPONENT_MAP } from '../../lib/student-layout/registry'
import { STUDENT_COLOR_TOKENS, STUDENT_STYLE_PROPS } from '../../lib/student-layout/style-spec'
import type { StyleProp } from '../../lib/site-editor/styles-spec'
import type { StudentLayoutDocument } from '../../lib/student-layout/validate'
import { canHide, configOf, orderOf, styleOf, type Device } from './layout-ops'
import { DEVICE_LABELS, LOCKED_TEXT, componentChain } from './editor-model'

type Tab = 'content' | 'style' | 'layout' | 'behaviour' | 'responsive' | 'advanced'
const TABS: Array<[Tab, string]> = [['content', 'Content'], ['style', 'Style'], ['layout', 'Layout'], ['behaviour', 'Behaviour'], ['responsive', 'Responsive'], ['advanced', 'Advanced']]

const PLACEHOLDERS: Record<string, string> = {
  fontSize: 'e.g. 1.1rem', letterSpacing: 'e.g. 0.02em', width: 'e.g. 100% or auto', maxWidth: 'e.g. 720px', minWidth: 'e.g. 200px', height: 'e.g. auto',
  minHeight: 'e.g. 120px', maxHeight: 'e.g. 480px', padding: 'e.g. 16px 20px', margin: 'e.g. 0 0 16px', gap: 'e.g. 12px', rowGap: 'e.g. 12px', columnGap: 'e.g. 12px',
  borderWidth: 'e.g. 1.5px', borderRadius: 'e.g. 18px', lineHeight: '0.8–3', opacity: '0.4–1', columns: '1–6', rows: '1–12'
}
const hexOf = (value: string) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000')

function StyleInput({ prop, value, inherited, disabled, onChange }: { prop: StyleProp; value: string; inherited?: string; disabled: boolean; onChange: (value: string, coalesce?: string) => void }) {
  const id = useId()
  const check = prop.check
  let control
  if (check.kind === 'options') {
    control = <select id={id} className="cc-input" disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{inherited ? `Inherit (${inherited})` : 'Default'}</option>
      {check.options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  } else if (check.kind === 'color') {
    const token = value.startsWith('token:') ? value.slice(6) : ''
    control = <div className="le-color">
      <select className="cc-input" disabled={disabled} aria-label={`${prop.label}: theme colour`} value={token} onChange={event => onChange(event.target.value ? `token:${event.target.value}` : '')}>
        <option value="">{value && !token ? 'Custom colour' : inherited ? `Inherit (${inherited})` : 'Default'}</option>
        {Object.keys(STUDENT_COLOR_TOKENS).map(name => <option key={name} value={name}>Theme: {name}</option>)}
      </select>
      <input type="color" disabled={disabled} aria-label={`${prop.label}: pick a colour`} value={hexOf(value)} onChange={event => onChange(event.target.value, prop.key)} />
    </div>
  } else {
    control = <input id={id} className="cc-input" disabled={disabled} inputMode={check.kind === 'number' ? 'decimal' : undefined} placeholder={inherited ? `Inherit (${inherited})` : PLACEHOLDERS[prop.key]} value={value} onChange={event => onChange(event.target.value.trim(), prop.key)} />
  }
  return <div className="le-field le-field--style"><label className="le-field__label" htmlFor={id}>{prop.label}</label>{control}</div>
}

function StylePanel({ id, document, device, groups, errors, disabled, onChange, onClear }: {
  id: string; document: StudentLayoutDocument; device: Device; groups: string[]; errors: Record<string, string>; disabled: boolean
  onChange: (key: string, value: string, coalesce?: string) => void; onClear: () => void
}) {
  const def = COMPONENT_MAP.get(id)
  const essential = Boolean(def && (def.caps.required || !def.caps.hideable))
  const own = styleOf(document, id, device)
  const config = configOf(document, id)
  const inherited = (key: string) => (device === 'desktop' ? undefined : device === 'mobile' ? config.responsive?.tablet?.[key] ?? config.style?.[key] : config.style?.[key])
  const count = Object.keys(own).length
  return <div className="le-style">
    <div className="le-style__head">
      <span className="le-hint">Editing <strong>{DEVICE_LABELS[device]}</strong>{device !== 'desktop' ? ' — empty values inherit from larger screens.' : ' — the base for every screen.'}</span>
      {count > 0 && <Button size="sm" variant="ghost" disabled={disabled} onClick={onClear}><RotateCcw size={13} aria-hidden="true" /> Clear {count}</Button>}
    </div>
    {groups.map(group => {
      const props = STUDENT_STYLE_PROPS.filter(prop => prop.group === group && !(essential && prop.key === 'display'))
      if (!props.length) return null
      return <fieldset key={group} className="le-fieldset">
        <legend>{group}</legend>
        {props.map(prop => {
          const path = device === 'desktop' ? `style.${prop.key}` : `responsive.${device}.${prop.key}`
          const error = Object.entries(errors).find(([key]) => key.endsWith(path))?.[1]
          return <div key={prop.key}>
            <StyleInput prop={prop} value={own[prop.key] ?? ''} inherited={inherited(prop.key)} disabled={disabled} onChange={(value, coalesce) => onChange(prop.key, value, coalesce)} />
            {error && <p className="le-error" role="alert">{error}</p>}
          </div>
        })}
      </fieldset>
    })}
    {essential && <p className="le-hint">This part is required, so styles that would hide it are not offered.</p>}
  </div>
}

export interface InspectorActions {
  setText: (key: string, value: string) => void
  setProp: (key: string, value: number | null) => void
  setStyle: (device: Device, key: string, value: string, coalesce?: string) => void
  clearStyles: (device: Device) => void
  move: (delta: -1 | 1) => void
  toggleHidden: () => void
  toggleLocked: () => void
  reset: () => void
  select: (id: string) => void
}

export function StudentInspector({ id, document, device, setDevice, errors, actions, extraContent }: {
  id: string | null; document: StudentLayoutDocument; device: Device; setDevice: (device: Device) => void; errors: Record<string, string>; actions: InspectorActions; extraContent?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('content')
  const [textFilter, setTextFilter] = useState('')
  const def = id ? COMPONENT_MAP.get(id) : undefined
  if (!id || !def) return <div className="le-inspector"><p className="le-empty">Select a part of the page (tap it on the canvas or in Layers) to change how it looks.</p>
    <p className="le-hint">The page shows a synthetic student. Values such as dates, marks, scores, names, streaks, counts, timers and progress always come from each student’s own records and are never editable here.</p></div>
  const config = configOf(document, id)
  const locked = Boolean(config.locked)
  const ownErrors = Object.fromEntries(Object.entries(errors).filter(([path]) => path.includes(`components.${id}.`) || path === `order.${def.parent}`))
  const siblings = def.parent ? orderOf(document, def.parent) : []
  const devicePicker = <div className="le-devices" role="radiogroup" aria-label="Device">
    {(['desktop', 'tablet', 'mobile'] as Device[]).map(item => <button key={item} type="button" role="radio" aria-checked={device === item} className={`le-chip${device === item ? ' is-active' : ''}`} onClick={() => setDevice(item)}>{DEVICE_LABELS[item]}</button>)}
  </div>
  const styleFor = (groups: string[]) => <>{devicePicker}<StylePanel id={id} document={document} device={device} groups={groups} errors={ownErrors} disabled={locked}
    onChange={(key, value, coalesce) => actions.setStyle(device, key, value, coalesce && `${id}.${device}.${coalesce}`)} onClear={() => actions.clearStyles(device)} /></>

  return <div className="le-inspector">
    <div className="le-inspector__title">
      <strong>{def.label}</strong>
      <span className="le-hint">{componentChain(id).map(item => item.label).join(' › ')}</span>
    </div>
    {locked && <p className="le-banner is-warn" role="status"><Lock size={14} aria-hidden="true" /> Locked in the editor. Unlock it in Advanced to make changes.</p>}
    <div className="le-tabs" role="tablist" aria-label="Properties">
      {TABS.map(([item, label]) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`le-tab${tab === item ? ' is-active' : ''}`} onClick={() => setTab(item)}>{label}</button>)}
    </div>
    <div className="le-inspector__body" role="tabpanel">
      {tab === 'content' && <>
        {Object.keys(def.text ?? {}).length > 10 && <label className="le-field"><span className="le-field__label">Find a label</span>
          <input className="cc-input" type="search" value={textFilter} placeholder="Type part of the wording" onChange={event => setTextFilter(event.target.value)} /></label>}
        {Object.entries(def.text ?? {}).filter(([key, field]) => !textFilter || `${field.default} ${config.text?.[key] ?? ''}`.toLowerCase().includes(textFilter.toLowerCase())).map(([key, field]) => {
          const value = config.text?.[key] ?? ''
          const error = ownErrors[`components.${id}.text.${key}`]
          return <label key={key} className="le-field"><span className="le-field__label">{field.label} <span className="le-hint">({field.max} max)</span></span>
            <span className="le-inline">
              <input className="cc-input" disabled={locked} maxLength={field.max} placeholder={field.default} value={value} onChange={event => actions.setText(key, event.target.value)} />
              {value && <button type="button" className="le-icon-btn is-secondary" disabled={locked} onClick={() => actions.setText(key, '')} aria-label={`Reset ${field.label} to the shipped text`} title="Reset to shipped text"><RotateCcw size={14} /></button>}
            </span>
            {error && <span className="le-error" role="alert">{error}</span>}
          </label>
        })}
        {Object.entries(def.props ?? {}).map(([key, spec]) => spec.kind === 'number' && <label key={key} className="le-field"><span className="le-field__label">{spec.label} <span className="le-hint">({spec.min}–{spec.max})</span></span>
          <input className="cc-input le-narrow" type="number" disabled={locked} min={spec.min} max={spec.max} step={1} value={Number(config.props?.[key] ?? spec.default)}
            onChange={event => { const value = Math.round(Number(event.target.value)); if (Number.isFinite(value) && value >= spec.min && value <= spec.max) actions.setProp(key, value) }} /></label>)}
        {!def.text && !def.props && <p className="le-hint">This part has no static text of its own. Use Style, Layout and Responsive to change how it looks.</p>}
        {def.data && <div className="le-locked" aria-label="Live student data">
          <h4 className="le-subhead"><Lock size={13} aria-hidden="true" /> Live student data</h4>
          <ul>{Object.entries(def.data).map(([key, label]) => <li key={key} className="le-locked__row"><Lock size={13} aria-hidden="true" /><span><strong>{label}</strong><span className="le-hint">{LOCKED_TEXT}</span></span></li>)}</ul>
        </div>}
        {extraContent}
      </>}
      {tab === 'style' && styleFor(['Typography', 'Colours', 'Appearance'])}
      {tab === 'layout' && <>
        {def.parent && def.caps.reorderable && siblings.length > 1 && <div className="le-field"><span className="le-field__label">Position in {COMPONENT_MAP.get(def.parent)?.label}</span>
          <ol className="le-order">{siblings.map(item => <li key={item} className={item === id ? 'is-current' : ''}>{COMPONENT_MAP.get(item)?.label ?? item}{!COMPONENT_MAP.get(item)?.caps.reorderable ? ' (fixed)' : ''}</li>)}</ol>
          <span className="le-inline-row"><Button size="sm" variant="ghost" disabled={locked} onClick={() => actions.move(-1)}>Move up</Button><Button size="sm" variant="ghost" disabled={locked} onClick={() => actions.move(1)}>Move down</Button></span></div>}
        {def.children && <div className="le-field"><span className="le-field__label">Contains</span>
          <ul className="le-order">{orderOf(document, id).map(child => <li key={child}><button type="button" className="le-link" onClick={() => actions.select(child)}>{COMPONENT_MAP.get(child)?.label ?? child}</button></li>)}</ul></div>}
        {styleFor(['Dimensions', 'Spacing', 'Layout'])}
      </>}
      {tab === 'behaviour' && <div className="le-behaviour">
        <ul className="le-caps">
          <li>{def.caps.required ? 'Required — always shown.' : canHide(id) ? 'Optional — can be hidden for students.' : 'Always shown.'}</li>
          <li>{def.caps.reorderable ? 'Can be reordered within its section.' : 'Keeps its position.'}</li>
          <li>{def.caps.interactive ? 'Its buttons and actions keep working exactly as before (routes, saves and validation are unchanged).' : 'Display only.'}</li>
          <li>{def.caps.dataBound ? 'Shows each student’s own records. Those values stay live and locked.' : 'Shows no student records.'}</li>
        </ul>
        {def.note && <p className="le-hint">{def.note}</p>}
        <p className="le-hint">Behaviour, permissions, routes and data logic cannot be changed in this editor.</p>
      </div>}
      {tab === 'responsive' && <>
        <ul className="le-caps">{(['desktop', 'tablet', 'mobile'] as Device[]).map(item => <li key={item}>{DEVICE_LABELS[item]}: {Object.keys(styleOf(document, id, item)).length || 'no'} override{Object.keys(styleOf(document, id, item)).length === 1 ? '' : 's'}</li>)}</ul>
        {styleFor(['Visibility', 'Typography', 'Spacing', 'Dimensions'])}
      </>}
      {tab === 'advanced' && <div className="le-advanced">
        <div className="le-inline-row">
          {canHide(id) && <button type="button" className="le-chip" disabled={locked} onClick={actions.toggleHidden}>{config.hidden ? <EyeOff size={14} /> : <Eye size={14} />} {config.hidden ? 'Hidden for students' : 'Visible'}</button>}
          {def.caps.lockable && <button type="button" className="le-chip" onClick={actions.toggleLocked}>{locked ? <Lock size={14} /> : <Unlock size={14} />} {locked ? 'Locked in editor' : 'Unlocked'}</button>}
        </div>
        <Button size="sm" variant="ghost" disabled={locked} onClick={actions.reset}><RotateCcw size={13} aria-hidden="true" /> Reset to the shipped design</Button>
        <p className="le-hint">Component id: <code>{id}</code> · {def.kind}</p>
      </div>}
    </div>
  </div>
}

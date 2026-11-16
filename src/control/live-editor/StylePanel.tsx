import { useId } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../ui'
import type { BlockStyle, SiteBlock } from '../../lib/site-editor/model'
import { COLOR_TOKENS, STYLE_PROPS, type StyleProp } from '../../lib/site-editor/styles-spec'
import { DEVICE_LABELS, type Device } from './doc-ops'
import { MediaUpload } from './MediaUpload'

const PLACEHOLDERS: Record<string, string> = {
  fontSize: 'e.g. 1.25rem', letterSpacing: 'e.g. 0.02em', width: 'e.g. 100% or auto', maxWidth: 'e.g. 640px', minWidth: 'e.g. 200px', height: 'e.g. 320px or auto',
  minHeight: 'e.g. 200px', maxHeight: 'e.g. 480px', padding: 'e.g. 16px 24px', margin: 'e.g. 0 auto', gap: 'e.g. 16px', rowGap: 'e.g. 12px', columnGap: 'e.g. 12px',
  borderWidth: 'e.g. 1.5px', borderRadius: 'e.g. 18px', lineHeight: '0.8–3', opacity: '0–1', rotate: '−45 to 45', order: '−10 to 10', columns: '1–6', rows: '1–12'
}


function hexOf(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : /^#[0-9a-fA-F]{3}$/.test(value) ? `#${value.slice(1).split('').map(c => c + c).join('')}` : '#000000'
}

function StyleInput({ prop, value, inherited, onChange }: { prop: StyleProp; value: string; inherited?: string; onChange: (value: string, coalesce?: string) => void }) {
  const id = useId()
  const check = prop.check
  let control
  if (check.kind === 'options') {
    control = <select id={id} className="cc-input" value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{inherited ? `Inherit (${inherited})` : 'Default'}</option>
      {check.options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  } else if (check.kind === 'color') {
    const token = value.startsWith('token:') ? value.slice(6) : ''
    control = <div className="le-color">
      <select className="cc-input" aria-label={`${prop.label}: theme colour`} value={token} onChange={event => onChange(event.target.value ? `token:${event.target.value}` : '')}>
        <option value="">{value && !token ? 'Custom colour' : inherited ? `Inherit (${inherited})` : 'Default'}</option>
        {Object.keys(COLOR_TOKENS).map(name => <option key={name} value={name}>Theme: {name}</option>)}
      </select>
      <input type="color" aria-label={`${prop.label}: pick a colour`} value={hexOf(value)} onChange={event => onChange(event.target.value, prop.key)} />
      <input id={id} className="cc-input le-narrow" placeholder="#hex / rgb()" value={token ? '' : value} onChange={event => onChange(event.target.value.trim(), prop.key)} />
    </div>
  } else if (check.kind === 'media') {
    control = <MediaUpload kind="image" value={value} onChange={next => onChange(next)} label={prop.label} />
  } else {
    control = <input id={id} className="cc-input" inputMode={check.kind === 'number' ? 'decimal' : undefined} placeholder={inherited ? `Inherit (${inherited})` : PLACEHOLDERS[prop.key]} value={value} onChange={event => onChange(event.target.value.trim(), prop.key)} />
  }
  return <div className="le-field le-field--style">
    <label className="le-field__label" htmlFor={id}>{prop.label}</label>
    {control}
  </div>
}

/**
 * Edits whitelisted style properties for one device. Desktop is the base; tablet and phone
 * values override it at their breakpoints (real media queries), and empty means inherit.
 */
export function StylePanel({ block, device, groups, errors, onChange, onClear }: {
  block: SiteBlock; device: Device; groups: ReadonlyArray<StyleProp['group']>
  errors: Record<string, string>; onChange: (key: string, value: string, coalesce?: string) => void; onClear: () => void
}) {
  const own: BlockStyle = (device === 'desktop' ? block.style : block.responsive?.[device]) ?? {}
  const inheritedFrom = (key: string): string | undefined => {
    if (device === 'desktop') return undefined
    if (device === 'mobile') return block.responsive?.tablet?.[key] ?? block.style?.[key]
    return block.style?.[key]
  }
  const count = Object.keys(own).length
  return <div className="le-style">
    <div className="le-style__head">
      <span className="le-hint">Editing <strong>{DEVICE_LABELS[device]}</strong>{device !== 'desktop' ? ' — empty values inherit from larger screens.' : ' — the base for every screen.'}</span>
      {count > 0 && <Button size="sm" variant="ghost" onClick={onClear}><RotateCcw size={13} aria-hidden="true" /> Clear {count}</Button>}
    </div>
    {groups.map(group => {
      const props = STYLE_PROPS.filter(prop => prop.group === group)
      return <fieldset key={group} className="le-fieldset">
        <legend>{group}</legend>
        {props.map(prop => {
          const path = device === 'desktop' ? `style.${prop.key}` : `responsive.${device}.${prop.key}`
          const error = Object.entries(errors).find(([key]) => key.endsWith(path))?.[1]
          return <div key={prop.key}>
            <StyleInput prop={prop} value={own[prop.key] ?? ''} inherited={inheritedFrom(prop.key)} onChange={(value, coalesce) => onChange(prop.key, value, coalesce)} />
            {error && <p className="le-error" role="alert">{error}</p>}
          </div>
        })}
      </fieldset>
    })}
  </div>
}

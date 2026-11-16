import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, RotateCcw } from 'lucide-react'
import { Button } from '../ui'
import { NAV_ALWAYS_VISIBLE, NAV_GROUPS, STUDENT_PAGES } from '../../lib/student-layout/registry'
import { STUDENT_TOKENS } from '../../lib/student-layout/style-spec'
import type { StudentLayoutDocument } from '../../lib/student-layout/validate'
import { navGroupsOf, navItemsOf } from './layout-ops'

const routeLabel = (route: string) => STUDENT_PAGES.find(page => page.path === route)?.label ?? route

export interface NavActions {
  moveGroup: (group: string, delta: -1 | 1) => void
  moveItem: (group: string, route: string, delta: -1 | 1) => void
  toggleHidden: (route: string) => void
}

/** Sidebar and drawer: group order, item order within a group, and optional items hidden. */
export function NavigationEditor({ document, actions, disabled }: { document: StudentLayoutDocument; actions: NavActions; disabled?: boolean }) {
  const groups = navGroupsOf(document)
  const hidden = new Set(document.nav?.hidden ?? [])
  return <div className="le-nav-editor">
    <h4 className="le-subhead">Navigation</h4>
    <p className="le-hint">Order and visibility only. Routes, sign-in guards and the phone bottom bar never change; labels are edited in Appearance → Navigation &amp; labels. Home and Settings always stay visible.</p>
    <ol className="le-nav-groups">
      {groups.map((group, groupIndex) => {
        const caption = NAV_GROUPS.find(entry => entry.id === group)?.caption ?? group
        const items = navItemsOf(document, group)
        return <li key={group} className="le-nav-group">
          <div className="le-inline-row le-nav-row">
            <strong>{caption}</strong>
            <span className="le-row-actions">
              <button type="button" className="le-icon-btn" disabled={disabled || groupIndex === 0} onClick={() => actions.moveGroup(group, -1)} aria-label={`Move ${caption} group up`} title="Move group up"><ChevronUp size={14} /></button>
              <button type="button" className="le-icon-btn" disabled={disabled || groupIndex === groups.length - 1} onClick={() => actions.moveGroup(group, 1)} aria-label={`Move ${caption} group down`} title="Move group down"><ChevronDown size={14} /></button>
            </span>
          </div>
          <ol className="le-nav-items">
            {items.map((route, index) => {
              const fixed = NAV_ALWAYS_VISIBLE.includes(route)
              const label = routeLabel(route)
              return <li key={route} className={`le-inline-row le-nav-row${hidden.has(route) ? ' is-hidden' : ''}`}>
                <span>{label}{hidden.has(route) ? ' (hidden)' : ''}</span>
                <span className="le-row-actions">
                  <button type="button" className="le-icon-btn" disabled={disabled || index === 0} onClick={() => actions.moveItem(group, route, -1)} aria-label={`Move ${label} up`} title="Move up"><ChevronUp size={14} /></button>
                  <button type="button" className="le-icon-btn" disabled={disabled || index === items.length - 1} onClick={() => actions.moveItem(group, route, 1)} aria-label={`Move ${label} down`} title="Move down"><ChevronDown size={14} /></button>
                  {fixed
                    ? <span className="le-icon-btn" title="Always visible" aria-label={`${label} is always visible`}><Lock size={14} /></span>
                    : <button type="button" className="le-icon-btn" disabled={disabled} onClick={() => actions.toggleHidden(route)} aria-label={hidden.has(route) ? `Show ${label}` : `Hide ${label}`} title={hidden.has(route) ? 'Show' : 'Hide'}>{hidden.has(route) ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
                </span>
              </li>
            })}
          </ol>
        </li>
      })}
    </ol>
    <p className="le-hint">Hidden pages stay reachable by their address and from in-page links; only the menu entry is removed.</p>
  </div>
}

const hexOf = (value: string | undefined, fallback: string) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback)

/** Global presentation tokens for the student workspace (default palette only; fonts untouched). */
export function TokensPanel({ tokens, errors, onChange }: { tokens: Record<string, string>; errors: Record<string, string>; onChange: (key: string, value: string | null, coalesce?: string) => void }) {
  const groups = [...new Set(STUDENT_TOKENS.map(token => token.group))]
  const count = Object.keys(tokens).length
  return <div className="le-tokens">
    <p className="le-hint">Colours apply to students using the default colour palette, separately for light and night mode; a student’s own palette choice always wins. Fonts (Reading font and the handwriting identity) are never changed.</p>
    {count > 0 && <Button size="sm" variant="ghost" onClick={() => { for (const key of Object.keys(tokens)) onChange(key, null) }}><RotateCcw size={13} aria-hidden="true" /> Reset {count} token{count === 1 ? '' : 's'}</Button>}
    {groups.map(group => <fieldset key={group} className="le-fieldset">
      <legend>{group}</legend>
      {STUDENT_TOKENS.filter(token => token.group === group).map(token => token.themed
        ? <div key={token.key} className="le-field le-token">
          <span className="le-field__label">{token.label}</span>
          {(['light', 'dark'] as const).map(mode => {
            const key = `${mode}:${token.key}`
            return <span key={mode} className="le-inline">
              <span className="le-hint">{mode === 'light' ? 'Light' : 'Night'}</span>
              <input type="color" aria-label={`${token.label} (${mode === 'light' ? 'light' : 'night'} mode)`} value={hexOf(tokens[key], mode === 'light' ? '#ffffff' : '#111111')} onChange={event => onChange(key, event.target.value, key)} />
              {tokens[key] ? <button type="button" className="le-icon-btn is-secondary" onClick={() => onChange(key, null)} aria-label={`Reset ${token.label} (${mode})`} title="Use the shipped colour"><RotateCcw size={13} /></button> : <span className="le-hint">shipped</span>}
              {errors[`tokens.${key}`] && <span className="le-error" role="alert">{errors[`tokens.${key}`]}</span>}
            </span>
          })}
        </div>
        : <label key={token.key} className="le-field"><span className="le-field__label">{token.label}</span>
          <input className="cc-input le-narrow" placeholder="shipped (e.g. 18px)" value={tokens[token.key] ?? ''} onChange={event => onChange(token.key, event.target.value.trim() || null, token.key)} />
          {errors[`tokens.${token.key}`] && <span className="le-error" role="alert">{errors[`tokens.${token.key}`]}</span>}
        </label>)}
    </fieldset>)}
  </div>
}

/** Assets: kept separate from the public site library and from private student images. */
export function AssetsPanel() {
  return <div className="le-assets-info">
    <p className="le-hint">No student-workspace part takes an image in this version, so there is nothing to upload here.</p>
    <ul className="le-caps">
      <li>Students’ private images (mistake photos) are never listed, previewed or used by this editor.</li>
      <li>Public website images live in the Live Site Editor’s library and are not shared with the student workspace.</li>
      <li>The canvas cannot read or write private image storage.</li>
    </ul>
  </div>
}

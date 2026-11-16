import {
  COMPONENT_MAP, DATA_KEY_PATTERN, NAV_ALWAYS_VISIBLE, NAV_GROUPS, STUDENT_LAYOUT_SCHEMA_VERSION, type ComponentDef
} from './registry.js'
import { checkStudentStyle, checkStudentToken } from './style-spec.js'

/**
 * Student layout document validation.
 *
 * - `checkStudentLayout(raw)` (server writes, publish, restore): returns the cleaned document
 *   and every problem. Callers refuse to store anything when `problems` is non-empty.
 * - The same pass produces a lenient result for rendering: invalid pieces are dropped and the
 *   shipped layout is used for them, so a bad value can never break a student's workspace.
 *
 * Data lock: text, props and config keys that name student data (dates, marks, scores,
 * names, streaks, counts, timers, progress…) are refused with code `data_locked`, both when
 * the component declares them as data and whenever the key itself means a student value.
 */

export const MAX_LAYOUT_BYTES = 200_000
const MAX_TEXT = 200

export type StyleMap = Record<string, string>
export interface ComponentConfig {
  hidden?: boolean
  locked?: boolean
  text?: Record<string, string>
  props?: Record<string, number | string>
  style?: StyleMap
  responsive?: { tablet?: StyleMap; mobile?: StyleMap }
}
export interface StudentLayoutDocument {
  schemaVersion: number
  components?: Record<string, ComponentConfig>
  order?: Record<string, string[]>
  nav?: { groups?: string[]; items?: Record<string, string[]>; hidden?: string[] }
  tokens?: Record<string, string>
}

export interface LayoutProblem { path: string; code: string; message: string }

const CONFIG_KEYS = new Set(['hidden', 'locked', 'text', 'props', 'style', 'responsive'])
const TOP_KEYS = new Set(['schemaVersion', 'components', 'order', 'nav', 'tokens'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Plain, single-purpose label text: no markup, control characters or template braces. */
export function plainLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > Math.min(max, MAX_TEXT)) return null
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i)
    if (code < 32 || code === 127) return null
  }
  if (/[<>{}]/.test(trimmed) || /(?:javascript|data|vbscript):/i.test(trimmed)) return null
  return trimmed
}

function dataLocked(def: ComponentDef, key: string): boolean {
  return Boolean(def.data && Object.prototype.hasOwnProperty.call(def.data, key)) || DATA_KEY_PATTERN.test(key)
}

/** Style values that would make a protected component disappear or become unusable. */
function hidesEssential(key: string, value: string): boolean {
  if (key === 'display') return value === 'hide'
  if (key === 'opacity') return Number(value) < 0.4
  if (['height', 'maxHeight', 'width', 'maxWidth'].includes(key)) return /^0(?:[a-z%]*)$/.test(value)
  return false
}

export function checkStudentLayout(raw: unknown): { document: StudentLayoutDocument | null; problems: LayoutProblem[] } {
  const problems: LayoutProblem[] = []
  const problem = (path: string, code: string, message: string) => { if (problems.length < 200) problems.push({ path, code, message }) }
  if (raw === null || raw === undefined) return { document: null, problems }
  if (!isObject(raw)) return { document: null, problems: [{ path: '', code: 'invalid', message: 'The layout must be an object.' }] }
  let size = 0
  try { size = JSON.stringify(raw).length } catch { return { document: null, problems: [{ path: '', code: 'invalid', message: 'The layout could not be read.' }] } }
  if (size > MAX_LAYOUT_BYTES) return { document: null, problems: [{ path: '', code: 'too_large', message: 'The layout is too large.' }] }
  if (raw.schemaVersion !== STUDENT_LAYOUT_SCHEMA_VERSION) problem('schemaVersion', 'schema', 'Unsupported layout version.')
  for (const key of Object.keys(raw)) if (!TOP_KEYS.has(key)) problem(key, DATA_KEY_PATTERN.test(key) ? 'data_locked' : 'unknown', `“${key}” is not part of the layout.`)

  const document: StudentLayoutDocument = { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }

  if (raw.components !== undefined) {
    if (!isObject(raw.components)) problem('components', 'invalid', 'Components must be an object.')
    else {
      const components: Record<string, ComponentConfig> = {}
      for (const [id, value] of Object.entries(raw.components)) {
        const base = `components.${id}`
        const def = COMPONENT_MAP.get(id)
        if (!def) { problem(base, 'unknown_component', `“${id}” is not a registered student component.`); continue }
        if (!isObject(value)) { problem(base, 'invalid', 'Expected an object.'); continue }
        const config: ComponentConfig = {}
        for (const key of Object.keys(value)) {
          if (!CONFIG_KEYS.has(key)) problem(`${base}.${key}`, dataLocked(def, key) ? 'data_locked' : 'unknown', dataLocked(def, key) ? `${def.label}: “${key}” is live student data and cannot be set.` : `${def.label}: “${key}” is not editable.`)
        }
        if (value.hidden !== undefined) {
          if (typeof value.hidden !== 'boolean') problem(`${base}.hidden`, 'invalid', 'Expected true or false.')
          else if (value.hidden && (!def.caps.hideable || def.caps.required)) problem(`${base}.hidden`, 'required', `${def.label} is required and cannot be hidden.`)
          else if (value.hidden) config.hidden = true
        }
        if (value.locked !== undefined) {
          if (typeof value.locked !== 'boolean') problem(`${base}.locked`, 'invalid', 'Expected true or false.')
          else if (value.locked) config.locked = true
        }
        if (value.text !== undefined) {
          if (!isObject(value.text)) problem(`${base}.text`, 'invalid', 'Expected an object.')
          else {
            const texts: Record<string, string> = {}
            for (const [key, textValue] of Object.entries(value.text)) {
              const field = def.text?.[key]
              if (!field) {
                problem(`${base}.text.${key}`, dataLocked(def, key) ? 'data_locked' : 'unknown', dataLocked(def, key) ? `${def.label}: “${key}” is live student data and is not editable.` : `${def.label} has no editable text “${key}”.`)
                continue
              }
              const clean = plainLabel(textValue, field.max)
              if (clean === null) problem(`${base}.text.${key}`, 'invalid_text', `${field.label}: use 1–${field.max} characters of plain text (no < > { }).`)
              else if (clean !== field.default) texts[key] = clean
            }
            if (Object.keys(texts).length) config.text = texts
          }
        }
        if (value.props !== undefined) {
          if (!isObject(value.props)) problem(`${base}.props`, 'invalid', 'Expected an object.')
          else {
            const props: Record<string, number | string> = {}
            for (const [key, propValue] of Object.entries(value.props)) {
              const spec = def.props?.[key]
              if (!spec) {
                problem(`${base}.props.${key}`, dataLocked(def, key) ? 'data_locked' : 'unknown', dataLocked(def, key) ? `${def.label}: “${key}” is live student data and cannot be set.` : `${def.label} has no option “${key}”.`)
                continue
              }
              if (spec.kind === 'number') {
                if (typeof propValue !== 'number' || !Number.isInteger(propValue) || propValue < spec.min || propValue > spec.max) problem(`${base}.props.${key}`, 'invalid', `${spec.label}: choose ${spec.min}–${spec.max}.`)
                else if (propValue !== spec.default) props[key] = propValue
              } else if (typeof propValue !== 'string' || !spec.options.includes(propValue)) problem(`${base}.props.${key}`, 'invalid', `${spec.label}: choose one of the listed options.`)
              else if (propValue !== spec.default) props[key] = propValue
            }
            if (Object.keys(props).length) config.props = props
          }
        }
        const essential = def.caps.required || !def.caps.hideable
        const styleOf = (input: unknown, path: string): StyleMap | undefined => {
          if (input === undefined) return undefined
          if (!isObject(input)) { problem(path, 'invalid', 'Expected an object.'); return undefined }
          const out: StyleMap = {}
          for (const [key, styleValue] of Object.entries(input)) {
            const clean = checkStudentStyle(key, styleValue)
            if (clean === null) { problem(`${path}.${key}`, 'invalid_style', `${def.label}: “${key}” has an unsupported value.`); continue }
            if (essential && hidesEssential(key, clean)) { problem(`${path}.${key}`, 'required', `${def.label} is required; this style would hide it.`); continue }
            out[key] = clean
          }
          return Object.keys(out).length ? out : undefined
        }
        const style = styleOf(value.style, `${base}.style`)
        if (style) config.style = style
        if (value.responsive !== undefined) {
          if (!isObject(value.responsive)) problem(`${base}.responsive`, 'invalid', 'Expected an object.')
          else {
            for (const key of Object.keys(value.responsive)) if (key !== 'tablet' && key !== 'mobile') problem(`${base}.responsive.${key}`, 'unknown', 'Only tablet and mobile overrides are supported.')
            const tablet = styleOf(value.responsive.tablet, `${base}.responsive.tablet`)
            const mobile = styleOf(value.responsive.mobile, `${base}.responsive.mobile`)
            if (tablet || mobile) config.responsive = { ...(tablet ? { tablet } : {}), ...(mobile ? { mobile } : {}) }
          }
        }
        if (Object.keys(config).length) components[id] = config
      }
      if (Object.keys(components).length) document.components = components
    }
  }

  if (raw.order !== undefined) {
    if (!isObject(raw.order)) problem('order', 'invalid', 'Order must be an object.')
    else {
      const order: Record<string, string[]> = {}
      for (const [id, list] of Object.entries(raw.order)) {
        const def = COMPONENT_MAP.get(id)
        const children = def?.children
        if (!def || !children) { problem(`order.${id}`, 'unknown_component', `“${id}” cannot be reordered.`); continue }
        if (!Array.isArray(list) || list.length !== children.length || new Set(list).size !== list.length || !list.every(item => typeof item === 'string' && children.includes(item))) {
          problem(`order.${id}`, 'invalid_order', `${def.label}: the order must list each of its parts exactly once.`)
          continue
        }
        const fixed = children.filter(child => !COMPONENT_MAP.get(child)?.caps.reorderable)
        if (fixed.some(child => list.indexOf(child) !== children.indexOf(child))) { problem(`order.${id}`, 'required', `${def.label}: some parts have a fixed position.`); continue }
        if (list.some((item, index) => item !== children[index])) order[id] = [...list] as string[]
      }
      if (Object.keys(order).length) document.order = order
    }
  }

  if (raw.nav !== undefined) {
    if (!isObject(raw.nav)) problem('nav', 'invalid', 'Navigation must be an object.')
    else {
      const nav: NonNullable<StudentLayoutDocument['nav']> = {}
      for (const key of Object.keys(raw.nav)) if (!['groups', 'items', 'hidden'].includes(key)) problem(`nav.${key}`, 'unknown', `“${key}” is not a navigation setting. Labels are edited in Navigation & labels; routes are fixed.`)
      const groupIds = NAV_GROUPS.map(group => group.id)
      const groups = raw.nav.groups
      if (groups !== undefined) {
        if (!Array.isArray(groups) || groups.length !== groupIds.length || new Set(groups).size !== groups.length || !groups.every(item => typeof item === 'string' && groupIds.includes(item))) problem('nav.groups', 'invalid_order', 'List each navigation group exactly once.')
        else if (groups.some((item, index) => item !== groupIds[index])) nav.groups = [...groups] as string[]
      }
      const items = raw.nav.items
      if (items !== undefined) {
        if (!isObject(items)) problem('nav.items', 'invalid', 'Expected an object.')
        else {
          const out: Record<string, string[]> = {}
          for (const [groupId, list] of Object.entries(items)) {
            const group = NAV_GROUPS.find(entry => entry.id === groupId)
            if (!group) { problem(`nav.items.${groupId}`, 'unknown', 'Unknown navigation group.'); continue }
            if (!Array.isArray(list) || list.length !== group.routes.length || new Set(list).size !== list.length || !list.every(item => typeof item === 'string' && group.routes.includes(item))) {
              problem(`nav.items.${groupId}`, 'invalid_order', `${group.caption}: list each of its pages exactly once (pages cannot move between groups).`)
              continue
            }
            if (list.some((item, index) => item !== group.routes[index])) out[groupId] = [...list] as string[]
          }
          if (Object.keys(out).length) nav.items = out
        }
      }
      const hidden = raw.nav.hidden
      if (hidden !== undefined) {
        const all = NAV_GROUPS.flatMap(group => group.routes)
        if (!Array.isArray(hidden) || new Set(hidden).size !== hidden.length || !hidden.every(item => typeof item === 'string' && all.includes(item))) problem('nav.hidden', 'invalid', 'Hidden navigation items must be known pages, listed once.')
        else {
          const blocked = hidden.filter(item => NAV_ALWAYS_VISIBLE.includes(item))
          if (blocked.length) problem('nav.hidden', 'required', 'Home and Settings must stay in the navigation.')
          else if (hidden.length) nav.hidden = [...hidden] as string[]
        }
      }
      if (Object.keys(nav).length) document.nav = nav
    }
  }

  if (raw.tokens !== undefined) {
    if (!isObject(raw.tokens)) problem('tokens', 'invalid', 'Tokens must be an object.')
    else {
      const tokens: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw.tokens)) {
        const clean = checkStudentToken(key, value)
        if (clean === null) problem(`tokens.${key}`, 'invalid_token', `Design token “${key}” has an unsupported value.`)
        else tokens[key] = clean
      }
      if (Object.keys(tokens).length) document.tokens = tokens
    }
  }

  return { document, problems }
}

/** Field errors keyed by path, for 422 responses and the editor. */
export function layoutProblemsToErrors(problems: readonly LayoutProblem[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const item of problems.slice(0, 50)) errors[item.path || 'layout'] ??= item.message
  return errors
}

/** Lenient read for rendering: the cleaned document, or null when nothing usable is left. */
export function sanitizeStudentLayout(raw: unknown): StudentLayoutDocument | null {
  const { document } = checkStudentLayout(raw)
  if (!document) return null
  return Object.keys(document).length > 1 ? document : null
}

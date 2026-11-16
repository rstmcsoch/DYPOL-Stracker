import { COMPONENT_MAP, NAV_ALWAYS_VISIBLE, NAV_GROUPS, STUDENT_LAYOUT_SCHEMA_VERSION } from '../../lib/student-layout/registry'
import { checkStudentLayout, type ComponentConfig, type StudentLayoutDocument } from '../../lib/student-layout/validate'

/**
 * Pure edits on the student layout document. Each returns a new document, or null when the
 * edit is not allowed by the component's capabilities (required parts stay visible, fixed
 * parts keep their place, data-bound values are never written).
 */

export type Device = 'desktop' | 'tablet' | 'mobile'
export const EMPTY_LAYOUT: StudentLayoutDocument = { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }

/** Canonical form (defaults dropped) used for change detection and saving. */
export function compactLayout(doc: StudentLayoutDocument): StudentLayoutDocument {
  return checkStudentLayout(doc).document ?? EMPTY_LAYOUT
}

export function configOf(doc: StudentLayoutDocument, id: string): ComponentConfig {
  return doc.components?.[id] ?? {}
}

function withConfig(doc: StudentLayoutDocument, id: string, recipe: (config: ComponentConfig) => ComponentConfig): StudentLayoutDocument {
  const next = recipe({ ...configOf(doc, id) })
  const components = { ...(doc.components ?? {}) }
  for (const key of Object.keys(next) as Array<keyof ComponentConfig>) {
    const value = next[key]
    if (value === undefined || value === false || (typeof value === 'object' && value !== null && !Object.keys(value).length)) delete next[key]
  }
  if (Object.keys(next).length) components[id] = next
  else delete components[id]
  const out: StudentLayoutDocument = { ...doc, components }
  if (!Object.keys(components).length) delete out.components
  return out
}

/** Static label edit. Only keys the registry declares as text are accepted. */
export function setText(doc: StudentLayoutDocument, id: string, key: string, value: string): StudentLayoutDocument | null {
  const field = COMPONENT_MAP.get(id)?.text?.[key]
  if (!field) return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return withConfig(doc, id, config => {
    const text = { ...(config.text ?? {}) }
    if (!clean || clean === field.default) delete text[key]
    else text[key] = clean.slice(0, field.max)
    return { ...config, text }
  })
}

export function setProp(doc: StudentLayoutDocument, id: string, key: string, value: number | string | null): StudentLayoutDocument | null {
  const spec = COMPONENT_MAP.get(id)?.props?.[key]
  if (!spec) return null
  return withConfig(doc, id, config => {
    const props = { ...(config.props ?? {}) }
    if (value === null || value === spec.default) delete props[key]
    else props[key] = value
    return { ...config, props }
  })
}

export function canHide(id: string): boolean {
  const def = COMPONENT_MAP.get(id)
  return Boolean(def && def.caps.hideable && !def.caps.required)
}

export function toggleHidden(doc: StudentLayoutDocument, id: string): StudentLayoutDocument | null {
  if (!canHide(id)) return null
  return withConfig(doc, id, config => ({ ...config, hidden: config.hidden ? undefined : true }))
}

export function toggleLocked(doc: StudentLayoutDocument, id: string): StudentLayoutDocument | null {
  if (!COMPONENT_MAP.get(id)?.caps.lockable) return null
  return withConfig(doc, id, config => ({ ...config, locked: config.locked ? undefined : true }))
}

export function setStyle(doc: StudentLayoutDocument, id: string, device: Device, key: string, value: string | null): StudentLayoutDocument | null {
  if (!COMPONENT_MAP.has(id)) return null
  return withConfig(doc, id, config => {
    const responsive = { ...(config.responsive ?? {}) }
    const current = { ...(device === 'desktop' ? config.style ?? {} : responsive[device] ?? {}) }
    if (value === null || value === '') delete current[key]
    else current[key] = value
    if (device === 'desktop') return { ...config, style: current }
    if (Object.keys(current).length) responsive[device] = current
    else delete responsive[device]
    return { ...config, responsive }
  })
}

export function clearStyles(doc: StudentLayoutDocument, id: string, device: Device): StudentLayoutDocument {
  return withConfig(doc, id, config => {
    if (device === 'desktop') return { ...config, style: undefined }
    const responsive = { ...(config.responsive ?? {}) }
    delete responsive[device]
    return { ...config, responsive }
  })
}

export function styleOf(doc: StudentLayoutDocument, id: string, device: Device): Record<string, string> {
  const config = configOf(doc, id)
  return (device === 'desktop' ? config.style : config.responsive?.[device]) ?? {}
}

/** Children of a container in the working order. */
export function orderOf(doc: StudentLayoutDocument, containerId: string): string[] {
  const children = COMPONENT_MAP.get(containerId)?.children ?? []
  const order = doc.order?.[containerId]
  return order && order.length === children.length && order.every(item => children.includes(item)) ? [...order] : [...children]
}

/** Moves a reorderable part one step among its reorderable siblings (fixed parts stay put). */
export function moveBy(doc: StudentLayoutDocument, id: string, delta: -1 | 1): StudentLayoutDocument | null {
  const def = COMPONENT_MAP.get(id)
  if (!def?.parent || !def.caps.reorderable) return null
  const list = orderOf(doc, def.parent)
  const from = list.indexOf(id)
  let to = from + delta
  while (to >= 0 && to < list.length && !COMPONENT_MAP.get(list[to]!)?.caps.reorderable) to += delta
  if (from < 0 || to < 0 || to >= list.length) return null
  ;[list[from], list[to]] = [list[to]!, list[from]!]
  const defaults = COMPONENT_MAP.get(def.parent)?.children ?? []
  const order = { ...(doc.order ?? {}) }
  if (list.every((item, index) => item === defaults[index])) delete order[def.parent]
  else order[def.parent] = list
  const out: StudentLayoutDocument = { ...doc, order }
  if (!Object.keys(order).length) delete out.order
  return out
}

/** Resets a component's presentation (labels, options, styles, visibility) to the shipped one. */
export function resetComponent(doc: StudentLayoutDocument, id: string): StudentLayoutDocument {
  return withConfig(doc, id, () => ({}))
}

/* ---------------------------------------------------------------- Navigation */

type Nav = NonNullable<StudentLayoutDocument['nav']>
function withNav(doc: StudentLayoutDocument, recipe: (nav: Nav) => Nav): StudentLayoutDocument {
  const nav = recipe({ ...(doc.nav ?? {}) })
  const out: StudentLayoutDocument = { ...doc, nav }
  if (nav.groups && nav.groups.every((id, index) => id === NAV_GROUPS[index]?.id)) delete nav.groups
  if (nav.items) {
    for (const [group, list] of Object.entries(nav.items)) {
      const defaults = NAV_GROUPS.find(entry => entry.id === group)?.routes ?? []
      if (list.every((route, index) => route === defaults[index])) delete nav.items[group]
    }
    if (!Object.keys(nav.items).length) delete nav.items
  }
  if (nav.hidden && !nav.hidden.length) delete nav.hidden
  if (!Object.keys(nav).length) delete out.nav
  return out
}

export function navGroupsOf(doc: StudentLayoutDocument): string[] {
  const ids = NAV_GROUPS.map(group => group.id)
  const order = doc.nav?.groups
  return order && order.length === ids.length && order.every(id => ids.includes(id)) ? [...order] : ids
}
export function navItemsOf(doc: StudentLayoutDocument, group: string): string[] {
  const defaults = [...(NAV_GROUPS.find(entry => entry.id === group)?.routes ?? [])]
  const order = doc.nav?.items?.[group]
  return order && order.length === defaults.length && order.every(route => defaults.includes(route)) ? [...order] : defaults
}

export function moveNavGroup(doc: StudentLayoutDocument, group: string, delta: -1 | 1): StudentLayoutDocument | null {
  const list = navGroupsOf(doc)
  const from = list.indexOf(group)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return null
  ;[list[from], list[to]] = [list[to]!, list[from]!]
  return withNav(doc, nav => ({ ...nav, groups: list }))
}

export function moveNavItem(doc: StudentLayoutDocument, group: string, route: string, delta: -1 | 1): StudentLayoutDocument | null {
  const list = navItemsOf(doc, group)
  const from = list.indexOf(route)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return null
  ;[list[from], list[to]] = [list[to]!, list[from]!]
  return withNav(doc, nav => ({ ...nav, items: { ...(nav.items ?? {}), [group]: list } }))
}

/** Home and Settings are the only sidebar way to reach them, so they never hide. */
export function toggleNavHidden(doc: StudentLayoutDocument, route: string): StudentLayoutDocument | null {
  if (NAV_ALWAYS_VISIBLE.includes(route) || !NAV_GROUPS.some(group => group.routes.includes(route))) return null
  return withNav(doc, nav => {
    const hidden = new Set(nav.hidden ?? [])
    if (hidden.has(route)) hidden.delete(route)
    else hidden.add(route)
    return { ...nav, hidden: [...hidden] }
  })
}

/* -------------------------------------------------------------------- Tokens */

export function setToken(doc: StudentLayoutDocument, key: string, value: string | null): StudentLayoutDocument {
  const tokens = { ...(doc.tokens ?? {}) }
  if (value) tokens[key] = value
  else delete tokens[key]
  const out: StudentLayoutDocument = { ...doc, tokens }
  if (!Object.keys(tokens).length) delete out.tokens
  return out
}

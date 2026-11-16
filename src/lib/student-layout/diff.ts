import { COMPONENT_MAP, STUDENT_LAYOUT_SCHEMA_VERSION, STUDENT_PAGES } from './registry.js'
import type { StudentLayoutDocument } from './validate.js'

/** Top-level areas that differ between two layouts (page ids, `navigation`, `tokens`). */
export function changedAreas(before: StudentLayoutDocument | null, after: StudentLayoutDocument | null): string[] {
  const areas = new Set<string>()
  const a = before ?? { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
  const b = after ?? { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
  const ids = new Set([...Object.keys(a.components ?? {}), ...Object.keys(b.components ?? {})])
  for (const id of ids) if (JSON.stringify(a.components?.[id] ?? null) !== JSON.stringify(b.components?.[id] ?? null)) areas.add(id.split('.')[0] ?? id)
  const orders = new Set([...Object.keys(a.order ?? {}), ...Object.keys(b.order ?? {})])
  for (const id of orders) if (JSON.stringify(a.order?.[id] ?? null) !== JSON.stringify(b.order?.[id] ?? null)) areas.add(id.split('.')[0] ?? id)
  if (JSON.stringify(a.nav ?? null) !== JSON.stringify(b.nav ?? null)) areas.add('navigation')
  if (JSON.stringify(a.tokens ?? null) !== JSON.stringify(b.tokens ?? null)) areas.add('tokens')
  return [...areas].sort()
}

export interface LayoutChange { area: string; label: string; detail: string }

/** Plain-language change list for the publish dialog (component level). */
export function describeChanges(before: StudentLayoutDocument | null, after: StudentLayoutDocument | null): LayoutChange[] {
  const out: LayoutChange[] = []
  const a = before ?? { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
  const b = after ?? { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
  const pageLabel = (id: string) => STUDENT_PAGES.find(page => page.id === (id.split('.')[0] ?? id))?.label ?? id
  const ids = [...new Set([...Object.keys(a.components ?? {}), ...Object.keys(b.components ?? {})])].sort()
  for (const id of ids) {
    const x = a.components?.[id] ?? {}
    const y = b.components?.[id] ?? {}
    const label = COMPONENT_MAP.get(id)?.label ?? id
    const parts: string[] = []
    if (Boolean(x.hidden) !== Boolean(y.hidden)) parts.push(y.hidden ? 'hidden' : 'shown again')
    if (Boolean(x.locked) !== Boolean(y.locked)) parts.push(y.locked ? 'locked in the editor' : 'unlocked')
    if (JSON.stringify(x.text ?? {}) !== JSON.stringify(y.text ?? {})) parts.push('labels')
    if (JSON.stringify(x.props ?? {}) !== JSON.stringify(y.props ?? {})) parts.push('options')
    if (JSON.stringify(x.style ?? {}) !== JSON.stringify(y.style ?? {})) parts.push('desktop style')
    if (JSON.stringify(x.responsive?.tablet ?? {}) !== JSON.stringify(y.responsive?.tablet ?? {})) parts.push('tablet style')
    if (JSON.stringify(x.responsive?.mobile ?? {}) !== JSON.stringify(y.responsive?.mobile ?? {})) parts.push('phone style')
    if (parts.length) out.push({ area: pageLabel(id), label, detail: parts.join(', ') })
  }
  const orders = [...new Set([...Object.keys(a.order ?? {}), ...Object.keys(b.order ?? {})])].sort()
  for (const id of orders) if (JSON.stringify(a.order?.[id] ?? null) !== JSON.stringify(b.order?.[id] ?? null)) out.push({ area: pageLabel(id), label: COMPONENT_MAP.get(id)?.label ?? id, detail: 'order of parts' })
  if (JSON.stringify(a.nav ?? null) !== JSON.stringify(b.nav ?? null)) out.push({ area: 'Application shell', label: 'Navigation', detail: 'order or visibility' })
  if (JSON.stringify(a.tokens ?? null) !== JSON.stringify(b.tokens ?? null)) out.push({ area: 'Theme', label: 'Design tokens', detail: 'colours or shape' })
  return out
}

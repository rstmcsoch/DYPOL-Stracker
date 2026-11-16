import type { ReactNode } from 'react'
import { useStudentLayout } from '../../contexts/StudentLayoutContext'
import type { ComponentConfig } from './validate'

/**
 * Per-component presentation from the published student layout. Without a layout every
 * helper returns the shipped value and adds no attributes, so the DOM is unchanged.
 * Data-bound values are never read from here: only static labels (`t`), presentation
 * options (`prop`), visibility and order.
 */
export function useLayoutSlot(id: string) {
  const { document, editing } = useStudentLayout()
  const config: ComponentConfig | undefined = document?.components?.[id]
  const marked = Boolean(document) || editing
  return {
    /** Hidden for students; the editor canvas keeps it visible (dimmed) so it can be shown again. */
    hidden: !editing && config?.hidden === true,
    attrs: marked ? { 'data-sl': id, ...(editing && config?.hidden ? { 'data-sl-hidden': '' } : {}) } : {},
    t: (key: string, fallback: string): string => config?.text?.[key] ?? fallback,
    /** Inline-editable static label marker (editor canvas only). */
    textAttrs: (key: string) => (editing ? { 'data-sl-text': `${id}:${key}` } : {}),
    /** Locked live-student-data marker (editor canvas only): never inline-editable. */
    dataAttrs: (key: string) => (editing ? { 'data-sl-data': `${id}:${key}` } : {}),
    /** Static label as a text node; wrapped in a marker span only inside the editor canvas. */
    text: (key: string, fallback: string): ReactNode => {
      const value = config?.text?.[key] ?? fallback
      return editing ? <span data-sl-text={`${id}:${key}`}>{value}</span> : value
    },
    /** Live student value; wrapped in a locked marker span only inside the editor canvas. */
    data: (key: string, value: ReactNode): ReactNode => (editing ? <span data-sl-data={`${id}:${key}`}>{value}</span> : value),
    num: (key: string, fallback: number): number => {
      const value = config?.props?.[key]
      return typeof value === 'number' ? value : fallback
    }
  }
}

/** Children of a registered container in the published order (shipped order otherwise). */
export function useLayoutOrder<T extends string>(containerId: string, defaults: readonly T[]): readonly T[] {
  const { document } = useStudentLayout()
  const order = document?.order?.[containerId]
  if (!order || order.length !== defaults.length || !order.every(item => (defaults as readonly string[]).includes(item))) return defaults
  return order as T[]
}

/**
 * Sidebar/drawer navigation in the published order, with optional items hidden from the
 * visible list. Routes, guards and the mobile bottom bar never change; Home and Settings
 * can never be hidden (enforced by the validator).
 */
export function useLayoutNav<G extends { caption: string; items: readonly { to: string }[] }>(groups: readonly G[]): readonly G[] {
  const { document, editing } = useStudentLayout()
  const nav = document?.nav
  if (!nav) return groups
  const idOf = (group: G) => group.caption.trim().toLowerCase()
  const ordered = nav.groups ? [...groups].sort((a, b) => nav.groups!.indexOf(idOf(a)) - nav.groups!.indexOf(idOf(b))) : groups
  const hidden = new Set(editing ? [] : nav.hidden ?? [])
  return ordered.map(group => {
    const order = nav.items?.[idOf(group)]
    const items = order ? [...group.items].sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to)) : group.items
    return { ...group, items: items.filter(item => !hidden.has(item.to)) }
  })
}

/** Page id for a student route, for page-level presentation (null for unknown paths). */
export function layoutPageFor(pathname: string): string | null {
  if (pathname === '/') return 'home'
  const id = pathname.replace(/^\/+|\/+$/g, '')
  return /^[a-z-]+$/.test(id) ? id : null
}

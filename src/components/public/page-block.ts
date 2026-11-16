import { createContext, useContext } from 'react'
import type { SiteBlock } from '../../lib/site-editor/model'

/**
 * The page-document block a registered Stracker section is rendered for. Sections spread
 * `useBlockAttrs()` on their root so block styles and the editor's selection can find them,
 * and read `useBlockProps()` for the structured lists the editor can change.
 */
export const PageBlockContext = createContext<SiteBlock | null>(null)

export function useBlockAttrs(): { 'data-sb'?: string } {
  const block = useContext(PageBlockContext)
  return block ? { 'data-sb': block.id } : {}
}

export function useBlockProps(): Record<string, unknown> {
  return useContext(PageBlockContext)?.props ?? {}
}

/** A list prop as clean objects with string fields, or null when absent/empty (use the shipped list). */
export function stringRecords(value: unknown, keys: readonly string[]): Array<Record<string, string>> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const items = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => Object.fromEntries(keys.map(key => [key, typeof item[key] === 'string' ? item[key] as string : ''])))
  return items.length ? items : null
}

export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return items.length ? items : null
}

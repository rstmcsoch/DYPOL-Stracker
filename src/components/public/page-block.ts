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

export interface DocItem { index: number; text: (key: string) => string; list: (key: string) => string[] }

/**
 * Visible items of a Stracker card list stored in the document (`props.items`), keeping each
 * item's position in the full list (for inline-edit paths). Null when the list is not in the
 * document, in which case the section renders its registry slots as before.
 */
export function documentItems(value: unknown): DocItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const items: DocItem[] = []
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || (raw as { hidden?: unknown }).hidden === true) return
    const item = raw as Record<string, unknown>
    items.push({
      index,
      text: key => (typeof item[key] === 'string' ? item[key] as string : ''),
      list: key => (Array.isArray(item[key]) ? (item[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [])
    })
  })
  return items
}

import { BLOCK_SPECS } from '../../lib/site-editor/blocks-spec'
import {
  BUILTIN_SECTIONS, SITE_DOCUMENT_SCHEMA_VERSION, SITE_PAGE_IDS, defaultPage, isBuiltinType, resolvePage,
  type BlockStyle, type SiteBlock, type SiteDocument, type SitePageId
} from '../../lib/site-editor/model'

/**
 * Pure, immutable operations on the editor's page document. Every edit returns a new
 * document (unchanged branches are shared), which keeps undo/redo snapshots cheap.
 */

export type Device = 'desktop' | 'tablet' | 'mobile'
export const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet (≤1024px)', mobile: 'Phone (≤640px)' }

/** A document with every page resolved (all Stracker sections present). */
export function normalizeDocument(raw: SiteDocument | null): SiteDocument {
  const pages: SiteDocument['pages'] = {}
  for (const page of SITE_PAGE_IDS) pages[page] = resolvePage(raw, page)
  return { schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION, pages, ...(raw?.tokens && Object.keys(raw.tokens).length ? { tokens: raw.tokens } : {}) }
}

/** What gets stored: only pages that differ from the shipped layout; null when nothing does. */
export function compactDocument(document: SiteDocument): SiteDocument | null {
  const pages: SiteDocument['pages'] = {}
  for (const page of SITE_PAGE_IDS) {
    const current = document.pages[page]
    if (current && JSON.stringify(current) !== JSON.stringify(defaultPage(page))) pages[page] = current
  }
  const tokens = document.tokens && Object.keys(document.tokens).length ? document.tokens : undefined
  if (!Object.keys(pages).length && !tokens) return null
  return { schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION, pages, ...(tokens ? { tokens } : {}) }
}

function omit(block: SiteBlock, key: 'style' | 'responsive'): SiteBlock {
  const next = { ...block }
  delete next[key]
  return next
}

export function pageBlocks(document: SiteDocument, page: SitePageId): SiteBlock[] {
  return document.pages[page]?.blocks ?? []
}

function withBlocks(document: SiteDocument, page: SitePageId, blocks: SiteBlock[]): SiteDocument {
  return { ...document, pages: { ...document.pages, [page]: { blocks } } }
}

export interface Located { block: SiteBlock; parentId: string | null; index: number; depth: number; path: string[] }

export function findBlock(blocks: readonly SiteBlock[], id: string, parentId: string | null = null, depth = 0, path: string[] = []): Located | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    if (block.id === id) return { block, parentId, index, depth, path: [...path, block.id] }
    if (block.children) {
      const hit = findBlock(block.children, id, block.id, depth + 1, [...path, block.id])
      if (hit) return hit
    }
  }
  return null
}

function mapTree(blocks: readonly SiteBlock[], fn: (block: SiteBlock) => SiteBlock | null): SiteBlock[] {
  const out: SiteBlock[] = []
  for (const block of blocks) {
    const mapped = fn(block)
    if (!mapped) continue
    out.push(mapped.children ? { ...mapped, children: mapTree(mapped.children, fn) } : mapped)
  }
  return out
}

export function updateBlock(document: SiteDocument, page: SitePageId, id: string, update: (block: SiteBlock) => SiteBlock): SiteDocument {
  return withBlocks(document, page, mapTree(pageBlocks(document, page), block => (block.id === id ? update(block) : block)))
}

export function setProp(document: SiteDocument, page: SitePageId, id: string, key: string, value: unknown): SiteDocument {
  return updateBlock(document, page, id, block => ({ ...block, props: { ...(block.props ?? {}), [key]: value } }))
}

export function setStyle(document: SiteDocument, page: SitePageId, id: string, device: Device, key: string, value: string): SiteDocument {
  return updateBlock(document, page, id, block => {
    const apply = (style: BlockStyle | undefined): BlockStyle | undefined => {
      const next = { ...(style ?? {}) }
      if (value === '') delete next[key]
      else next[key] = value
      return Object.keys(next).length ? next : undefined
    }
    if (device === 'desktop') {
      const style = apply(block.style)
      const rest = omit(block, 'style')
      return style ? { ...rest, style } : rest
    }
    const responsive = { ...(block.responsive ?? {}) }
    const style = apply(responsive[device])
    if (style) responsive[device] = style
    else delete responsive[device]
    const rest = omit(block, 'responsive')
    return Object.keys(responsive).length ? { ...rest, responsive } : rest
  })
}

export function clearStyles(document: SiteDocument, page: SitePageId, id: string, device: Device): SiteDocument {
  return updateBlock(document, page, id, block => {
    if (device === 'desktop') return omit(block, 'style')
    const responsive = { ...(block.responsive ?? {}) }
    delete responsive[device]
    const rest = omit(block, 'responsive')
    return Object.keys(responsive).length ? { ...rest, responsive } : rest
  })
}

let counter = 0
/** A new id unique within the page, readable in the layer list. */
export function newId(document: SiteDocument, page: SitePageId, type: string): string {
  const taken = new Set<string>()
  const collect = (blocks: readonly SiteBlock[]) => blocks.forEach(block => { taken.add(block.id); if (block.children) collect(block.children) })
  collect(pageBlocks(document, page))
  const base = type.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'block'
  let id: string
  do {
    counter += 1
    id = `${base}-${Date.now().toString(36).slice(-4)}${counter.toString(36)}`
  } while (taken.has(id))
  return id
}

/** A new editor block with its defaults (and starting children for templates). */
export function createBlock(document: SiteDocument, page: SitePageId, type: string, props?: Record<string, unknown>): SiteBlock {
  const spec = BLOCK_SPECS[type]
  if (!spec) throw new Error(`Unknown block ${type}`)
  const block: SiteBlock = { id: newId(document, page, type), type, props: { ...spec.defaults(), ...(props ?? {}) } }
  if (spec.container) {
    const seeded = { ...document }
    const children: SiteBlock[] = []
    for (const child of spec.children?.() ?? []) {
      const created = createBlock(withBlocks(seeded, page, [...pageBlocks(seeded, page), block, ...children]), page, child.type, child.props)
      children.push(created)
    }
    block.children = children
  }
  return block
}

export function canContain(parent: SiteBlock | null, child: SiteBlock): boolean {
  if (!parent) return true
  if (isBuiltinType(parent.type) || !BLOCK_SPECS[parent.type]?.container) return false
  if (isBuiltinType(child.type)) return false
  if (parent.type === 'button-group') return child.type === 'button'
  return true
}

function removeFromTree(blocks: readonly SiteBlock[], id: string): { blocks: SiteBlock[]; removed: SiteBlock | null } {
  let removed: SiteBlock | null = null
  const next = mapTree(blocks, block => {
    if (block.id === id) { removed = block; return null }
    return block
  })
  return { blocks: next, removed }
}

function insertInto(blocks: readonly SiteBlock[], parentId: string | null, index: number, block: SiteBlock): SiteBlock[] {
  if (parentId === null) {
    const next = [...blocks]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, block)
    return next
  }
  return mapTree(blocks, candidate => {
    if (candidate.id !== parentId) return candidate
    const children = [...(candidate.children ?? [])]
    children.splice(Math.max(0, Math.min(index, children.length)), 0, block)
    return { ...candidate, children }
  })
}

/** Inserts at a place; returns null if the place cannot hold the block. */
export function insertBlock(document: SiteDocument, page: SitePageId, block: SiteBlock, parentId: string | null, index: number): SiteDocument | null {
  const blocks = pageBlocks(document, page)
  const parent = parentId ? findBlock(blocks, parentId)?.block ?? null : null
  if (parentId && !parent) return null
  if (!canContain(parent, block)) return null
  if (parent && (findBlock(blocks, parentId!)?.depth ?? 0) >= 4) return null
  return withBlocks(document, page, insertInto(blocks, parentId, index, block))
}

/** Where a new block goes relative to the selection: into a selected container, else after it. */
export function insertionPoint(document: SiteDocument, page: SitePageId, selectedId: string | null, block: SiteBlock): { parentId: string | null; index: number } {
  const blocks = pageBlocks(document, page)
  const selected = selectedId ? findBlock(blocks, selectedId) : null
  if (!selected) return { parentId: null, index: blocks.length - (page === 'home' ? 1 : 0) }
  if (canContain(selected.block, block) && !isBuiltinType(selected.block.type)) return { parentId: selected.block.id, index: selected.block.children?.length ?? 0 }
  const parent = selected.parentId ? findBlock(blocks, selected.parentId)?.block ?? null : null
  if (canContain(parent, block)) return { parentId: selected.parentId, index: selected.index + 1 }
  // e.g. a heading selected inside a button group: go after the group.
  const grand = selected.parentId ? findBlock(blocks, selected.parentId) : null
  return grand ? { parentId: grand.parentId, index: grand.index + 1 } : { parentId: null, index: selected.index + 1 }
}

export function moveBlock(document: SiteDocument, page: SitePageId, id: string, parentId: string | null, index: number): SiteDocument | null {
  const blocks = pageBlocks(document, page)
  const located = findBlock(blocks, id)
  if (!located) return null
  // A block cannot move into itself or its own descendants.
  if (parentId && (parentId === id || findBlock(located.block.children ?? [], parentId))) return null
  if (isBuiltinType(located.block.type) && parentId !== null) return null
  const { blocks: without, removed } = removeFromTree(blocks, id)
  if (!removed) return null
  const adjusted = located.parentId === parentId && located.index < index ? index - 1 : index
  const parent = parentId ? findBlock(without, parentId)?.block ?? null : null
  if (!canContain(parent, removed)) return null
  return withBlocks(document, page, insertInto(without, parentId, adjusted, removed))
}

export function moveBy(document: SiteDocument, page: SitePageId, id: string, delta: -1 | 1): SiteDocument | null {
  const located = findBlock(pageBlocks(document, page), id)
  if (!located) return null
  const target = located.index + delta + (delta > 0 ? 1 : 0)
  return moveBlock(document, page, id, located.parentId, Math.max(0, target))
}

function reId(document: SiteDocument, page: SitePageId, block: SiteBlock, taken: SiteDocument): SiteBlock {
  const id = newId(taken, page, block.type)
  return { ...block, id, children: block.children?.map(child => reId(document, page, child, taken)) }
}

export function duplicateBlock(document: SiteDocument, page: SitePageId, id: string): { document: SiteDocument; id: string } | null {
  const located = findBlock(pageBlocks(document, page), id)
  if (!located || isBuiltinType(located.block.type)) return null
  const copy = reId(document, page, located.block, document)
  const next = insertBlock(document, page, { ...copy, name: located.block.name ? `${located.block.name} copy` : undefined }, located.parentId, located.index + 1)
  return next ? { document: next, id: copy.id } : null
}

/** Stracker sections cannot be deleted (only hidden): they hold required destinations. */
export function deleteBlock(document: SiteDocument, page: SitePageId, id: string): SiteDocument | null {
  const located = findBlock(pageBlocks(document, page), id)
  if (!located || isBuiltinType(located.block.type) || located.block.locked) return null
  return withBlocks(document, page, removeFromTree(pageBlocks(document, page), id).blocks)
}

export function blockLabel(block: SiteBlock, page: SitePageId): string {
  if (block.name) return block.name
  if (isBuiltinType(block.type)) return BUILTIN_SECTIONS[page].find(section => section.id === block.id)?.label ?? block.type
  return BLOCK_SPECS[block.type]?.label ?? block.type
}

/** Reads `items.2.title`-style paths inside props. */
export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), source)
}

/** Immutable set of `items.2.title`-style paths inside props. */
export function setPath(source: unknown, path: string, value: unknown): unknown {
  const [head, ...rest] = path.split('.')
  if (head === undefined) return value
  const container = Array.isArray(source) ? [...source] : { ...((source as Record<string, unknown>) ?? {}) }
  const key = Array.isArray(container) ? Number(head) : head
  const current = (container as Record<string | number, unknown>)[key]
  ;(container as Record<string | number, unknown>)[key] = rest.length ? setPath(current, rest.join('.'), value) : value
  return container
}

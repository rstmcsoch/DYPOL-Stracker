import { SITE_CONTENT_DEFAULTS, SITE_CONTENT_FIELDS } from '../site-content/registry'
import { parseOrder, type SiteValues } from '../site-content/content'
import type { SiteBlock, SiteDocument } from './model'

/**
 * Stracker card lists (feature cards, principles, how-it-works steps, privacy points) were
 * numbered registry slots. The Live Site Editor edits them as a list stored in the section's
 * document props. Moving a list into the document is done once, in one undoable step: the slot
 * values become `items` and the slot fields are reset to their defaults, so a value never lives
 * in both places. Older content (and restores of older versions) without `items` keeps
 * rendering from the slots exactly as before.
 */

export type ItemSectionType = 'stracker.features' | 'stracker.principles' | 'stracker.how' | 'stracker.privacy'

interface ItemSection {
  /** Registry keys owned by the slots (reset when the list moves into the document). */
  keyPattern: RegExp
  slotCount: number
  orderKey?: string
  fields: readonly string[]
  slotKey: (n: number, field: string) => string
  /** Default visible slots when there is no order field. */
  defaultVisible: number
}

const countSlots = (pattern: RegExp) => new Set(SITE_CONTENT_FIELDS.map(field => pattern.exec(field.key)?.[1]).filter(Boolean)).size

export const ITEM_SECTIONS: Record<ItemSectionType, ItemSection> = {
  'stracker.features': {
    keyPattern: /^public\.features\.(?:item_(\d+)\.|order$)/, slotCount: countSlots(/^public\.features\.item_(\d+)\./), orderKey: 'public.features.order',
    fields: ['icon', 'title', 'summary', 'points', 'image'], slotKey: (n, field) => `public.features.item_${n}.${field}`, defaultVisible: 8
  },
  'stracker.principles': {
    keyPattern: /^public\.principles\.(?:item_(\d+)\.|order$)/, slotCount: countSlots(/^public\.principles\.item_(\d+)\./), orderKey: 'public.principles.order',
    fields: ['icon', 'title', 'body'], slotKey: (n, field) => `public.principles.item_${n}.${field}`, defaultVisible: 6
  },
  'stracker.how': {
    keyPattern: /^public\.how\.step_(\d+)\./, slotCount: countSlots(/^public\.how\.step_(\d+)\./),
    fields: ['title', 'body'], slotKey: (n, field) => `public.how.step_${n}.${field}`, defaultVisible: 4
  },
  'stracker.privacy': {
    keyPattern: /^public\.privacy\.item_(\d+)\./, slotCount: countSlots(/^public\.privacy\.item_(\d+)\./),
    fields: ['title', 'body'], slotKey: (n, field) => `public.privacy.item_${n}.${field}`, defaultVisible: 6
  }
}

export function isItemSection(type: string): type is ItemSectionType {
  return type in ITEM_SECTIONS
}

/** True when the section's list lives in the document (its slot fields are no longer used). */
export function hasDocumentItems(block: SiteBlock | undefined): boolean {
  return Boolean(block && Array.isArray(block.props?.items) && (block.props!.items as unknown[]).length > 0)
}

function slotItem(type: ItemSectionType, values: SiteValues, n: number, hidden: boolean): Record<string, unknown> {
  const section = ITEM_SECTIONS[type]
  const value = (field: string) => values[section.slotKey(n, field)] ?? SITE_CONTENT_DEFAULTS[section.slotKey(n, field)] ?? ''
  const item: Record<string, unknown> = {}
  for (const field of section.fields) {
    item[field] = field === 'points' ? value(field).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8) : value(field)
  }
  if (type === 'stracker.features') item.alt = ''
  item.hidden = hidden
  return item
}

function slotChanged(type: ItemSectionType, values: SiteValues, n: number): boolean {
  const section = ITEM_SECTIONS[type]
  return section.fields.some(field => {
    const key = section.slotKey(n, field)
    return key in SITE_CONTENT_DEFAULTS && (values[key] ?? SITE_CONTENT_DEFAULTS[key]) !== SITE_CONTENT_DEFAULTS[key]
  })
}

/** The list as currently shown on the site (visible slots in order, then edited hidden slots). */
export function itemsFromSlots(type: ItemSectionType, values: SiteValues): Array<Record<string, unknown>> {
  const section = ITEM_SECTIONS[type]
  const order = section.orderKey ? parseOrder(values[section.orderKey] ?? SITE_CONTENT_DEFAULTS[section.orderKey], section.slotCount) : null
  const visible = order ?? Array.from({ length: Math.min(section.defaultVisible, section.slotCount) }, (_, index) => index + 1)
  const items = visible.map(n => slotItem(type, values, n, false))
  for (let n = 1; n <= section.slotCount; n += 1) {
    if (!visible.includes(n) && slotChanged(type, values, n)) items.push(slotItem(type, values, n, true))
  }
  return items
}

/** Slot fields reset to their defaults (their overrides disappear from the stored content). */
export function resetSlots(type: ItemSectionType, values: SiteValues): SiteValues {
  const pattern = ITEM_SECTIONS[type].keyPattern
  const next = { ...values }
  for (const key of Object.keys(SITE_CONTENT_DEFAULTS)) if (pattern.test(key)) next[key] = SITE_CONTENT_DEFAULTS[key]!
  return next
}

/** Registry keys whose values no longer reach the site because the document owns the list. */
export function managedSlotKeys(document: SiteDocument | null | undefined): (key: string) => boolean {
  const owned = (document?.pages?.home?.blocks ?? []).filter(block => isItemSection(block.type) && hasDocumentItems(block)).map(block => ITEM_SECTIONS[block.type as ItemSectionType].keyPattern)
  return key => owned.some(pattern => pattern.test(key))
}

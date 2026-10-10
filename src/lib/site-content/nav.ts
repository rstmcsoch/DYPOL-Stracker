import { USER_NAV_ITEMS } from './registry'
import type { SiteValues } from './content'

/**
 * Maps a notebook destination to the registry key of its editable label. The key only
 * changes the words shown; the route and the access rule stay where they are in AppShell.
 */
export function userNavLabelKey(to: string): string | null {
  const item = USER_NAV_ITEMS.find(entry => entry.to === to)
  return item ? `user.nav.${item.slug}.label` : null
}

/** Registry key for a navigation group heading such as "KEEP GOING". */
export function userNavCaptionKey(caption: string): string {
  return `user.nav.group.${caption.trim().toLowerCase().replace(/\s+/g, '-')}.label`
}

/** Display label for a destination, falling back to the code default when the key is unknown. */
export function navLabelFor(to: string, fallback: string, values: SiteValues): string {
  const key = userNavLabelKey(to)
  return (key && values[key]) || fallback
}

export function navCaptionFor(caption: string, values: SiteValues): string {
  return values[userNavCaptionKey(caption)] || caption
}

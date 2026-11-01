import type { SiteValues } from './content'

/**
 * Owner-written information pages linked from the footers. No page text is built in:
 * About and Terms exist only once the owner writes them in Control Center (Footer ·
 * Information pages). Privacy falls back to the homepage Privacy section copy.
 */
export type InfoPageKind = 'about' | 'terms' | 'privacy'

export const INFO_PAGE_PATHS: Record<InfoPageKind, string> = { about: '/about', terms: '/terms', privacy: '/privacy' }

export function infoPageBody(values: SiteValues, kind: InfoPageKind): string {
  return (values[`public.footer.${kind}.body`] ?? '').trim()
}

/** About and Terms are shown only with owner text; Privacy always has the homepage section to fall back on. */
export function infoPageAvailable(values: SiteValues, kind: InfoPageKind): boolean {
  return kind === 'privacy' || infoPageBody(values, kind) !== ''
}

/** Blank lines separate paragraphs; single line breaks stay inside a paragraph. */
export function infoParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
}

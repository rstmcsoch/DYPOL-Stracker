import type { SiteValues } from './content'

/**
 * Information pages linked from the footers. Each ships with text written for Stracker by
 * DYPOL LABS (info-page-defaults.ts) that the owner can rewrite in Control Center (Footer ·
 * Information pages). Clearing About or Terms hides that page; clearing Privacy falls back to
 * the homepage Privacy section copy.
 */
export type InfoPageKind = 'about' | 'terms' | 'privacy'

export const INFO_PAGE_PATHS: Record<InfoPageKind, string> = { about: '/about', terms: '/terms', privacy: '/privacy' }
export const CONTACT_PAGE_PATH = '/contact'

export function infoPageBody(values: SiteValues, kind: InfoPageKind): string {
  return (values[`public.footer.${kind}.body`] ?? '').trim()
}

/** About and Terms are shown only with text; Privacy always has the homepage section to fall back on. */
export function infoPageAvailable(values: SiteValues, kind: InfoPageKind): boolean {
  return kind === 'privacy' || infoPageBody(values, kind) !== ''
}

/** Blank lines separate paragraphs; single line breaks stay inside a paragraph. */
export function infoParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
}

export type InfoBlock =
  | { kind: 'heading'; text: string; id: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'updated'; text: string }
  | { kind: 'paragraph'; text: string }

export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'
}

/**
 * Turns plain page text into blocks. "## " starts a heading, a paragraph of "- " lines is a
 * list, and "Last updated:" is the page date. Everything else is a paragraph. Plain text only:
 * nothing here is ever rendered as HTML.
 */
export function infoBlocks(body: string): InfoBlock[] {
  const used = new Map<string, number>()
  return infoParagraphs(body).map((paragraph): InfoBlock => {
    if (paragraph.startsWith('## ')) {
      const text = paragraph.slice(3).replace(/\s*\n\s*/g, ' ').trim()
      const base = headingId(text)
      const seen = used.get(base) ?? 0
      used.set(base, seen + 1)
      return { kind: 'heading', text, id: seen ? `${base}-${seen + 1}` : base }
    }
    const lines = paragraph.split('\n').map(line => line.trim()).filter(Boolean)
    if (lines.length && lines.every(line => line.startsWith('- '))) return { kind: 'list', items: lines.map(line => line.slice(2).trim()) }
    if (/^last updated:/i.test(paragraph)) return { kind: 'updated', text: paragraph }
    return { kind: 'paragraph', text: paragraph }
  })
}

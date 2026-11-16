/**
 * Live Site Editor document model (shared by the public site, the editor and the API).
 *
 * The website's text keeps living in the existing site-content registry (sparse overrides in
 * `site_content_*.content`). This model adds the *structure* on top of it, stored next to the
 * copy in `site_content_*.document` and published, versioned and restored together with it:
 *
 *   SiteDocument
 *     pages.home.blocks     → ordered top-level blocks of the homepage
 *     pages.privacy.blocks  → … and of each public information page
 *     tokens                → optional global design-token overrides
 *
 * A block is either a registered Stracker section (`stracker.*`, the existing React section,
 * text from the registry) or an editor block (`section`, `heading`, `table`, `chart`, …) whose
 * content lives in its own validated props. Stracker sections cannot be deleted, only hidden
 * and moved, so no functional destination can disappear by accident.
 *
 * Keep this module tiny and free of browser/Node APIs: it ships in the homepage chunk.
 * Strict validation lives in ./validate.ts and only loads where it is needed.
 */

export const SITE_DOCUMENT_SCHEMA_VERSION = 1

export const SITE_PAGE_IDS = ['home', 'privacy', 'terms', 'about', 'contact'] as const
export type SitePageId = (typeof SITE_PAGE_IDS)[number]

export const SITE_PAGE_LABELS: Record<SitePageId, string> = {
  home: 'Homepage', privacy: 'Privacy Policy', terms: 'Terms & Conditions', about: 'About Stracker', contact: 'Contact'
}

export const SITE_PAGE_PATHS: Record<SitePageId, string> = {
  home: '/', privacy: '/privacy', terms: '/terms', about: '/about', contact: '/contact'
}

/** Responsive breakpoints used by block styles (max-width, px). Desktop is the base. */
export const BREAKPOINTS = { tablet: 1024, mobile: 640 } as const
export type Breakpoint = 'desktop' | keyof typeof BREAKPOINTS

export type BlockStyle = Record<string, string>

export interface SiteBlock {
  /** Stable id, unique within the page: `^[a-z][a-z0-9-]{0,47}$`. */
  id: string
  type: string
  /** Internal layer name shown in the editor only. */
  name?: string
  hidden?: boolean
  locked?: boolean
  props?: Record<string, unknown>
  style?: BlockStyle
  responsive?: { tablet?: BlockStyle; mobile?: BlockStyle }
  children?: SiteBlock[]
}

export interface SitePage { blocks: SiteBlock[] }

export interface SiteDocument {
  schemaVersion: number
  pages: Partial<Record<SitePageId, SitePage>>
  tokens?: Record<string, string>
}

/**
 * One registered Stracker section: its block type, stable id and layer label.
 * `hiddenByDefault` sections ship hidden (they stay in the layer list, so the owner can show
 * them again in the Live Site Editor) and are re-added hidden when a stored page lacks them.
 */
export interface BuiltinSection { type: string; id: string; label: string; anchor?: string; hiddenByDefault?: boolean }

/** Registered Stracker sections per page, in their shipped order. */
export const BUILTIN_SECTIONS: Record<SitePageId, readonly BuiltinSection[]> = {
  home: [
    { type: 'stracker.hero', id: 'home-hero', label: 'Hero', anchor: 'top' },
    { type: 'stracker.exams', id: 'home-exams', label: 'Exam ticker' },
    { type: 'stracker.stats', id: 'home-stats', label: 'Statistics' },
    { type: 'stracker.loop', id: 'home-loop', label: 'Study loop', anchor: 'why-stracker' },
    { type: 'stracker.features', id: 'home-features', label: 'Feature cards', anchor: 'features' },
    // Retired from the shipped homepage (Nov 2026): their unique points now live in the feature
    // cards. Kept registered and restorable, hidden unless the owner shows them again.
    { type: 'stracker.principles', id: 'home-principles', label: 'Principles', hiddenByDefault: true },
    { type: 'stracker.how', id: 'home-how', label: 'How it works', anchor: 'how-it-works', hiddenByDefault: true },
    { type: 'stracker.ai', id: 'home-ai', label: 'Stracker AI', anchor: 'ai' },
    { type: 'stracker.privacy', id: 'home-privacy', label: 'Privacy section', anchor: 'privacy' },
    { type: 'stracker.dypol', id: 'home-dypol', label: 'DYPOL LABS', anchor: 'dypol-labs' },
    { type: 'stracker.video', id: 'home-video', label: 'Promotional video' },
    { type: 'stracker.final', id: 'home-final', label: 'Final CTA' }
  ],
  privacy: [{ type: 'stracker.doc', id: 'privacy-doc', label: 'Privacy Policy text' }],
  terms: [{ type: 'stracker.doc', id: 'terms-doc', label: 'Terms text' }],
  about: [{ type: 'stracker.doc', id: 'about-doc', label: 'About text' }],
  contact: [{ type: 'stracker.contact', id: 'contact-form', label: 'Contact form' }]
}

export function isBuiltinType(type: string): boolean {
  return type.startsWith('stracker.')
}

export function builtinFor(page: SitePageId, id: string): BuiltinSection | undefined {
  return BUILTIN_SECTIONS[page].find(section => section.id === id)
}

/** A registered section as a block in its shipped state (hidden when `hiddenByDefault`). */
function shippedBlock(section: BuiltinSection): SiteBlock {
  return section.hiddenByDefault ? { id: section.id, type: section.type, hidden: true } : { id: section.id, type: section.type }
}

/** The page as it ships: every registered section, in order; `hiddenByDefault` ones hidden. */
export function defaultPage(page: SitePageId): SitePage {
  return { blocks: BUILTIN_SECTIONS[page].map(shippedBlock) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Lenient structural read used while rendering: anything malformed is dropped, registered
 * sections that are missing (for example a section added to the code later) are put back at
 * their shipped position — hidden if they ship hidden, never silently re-shown — and a registered section is never rendered twice. Editor blocks
 * are passed through untouched here; their props are validated by the block renderer chunk
 * before they are drawn.
 */
export function resolvePage(document: unknown, page: SitePageId): SitePage {
  const stored = isRecord(document) && isRecord(document.pages) ? document.pages[page] : undefined
  const raw = isRecord(stored) && Array.isArray(stored.blocks) ? stored.blocks : null
  if (!raw) return defaultPage(page)
  const builtins = BUILTIN_SECTIONS[page]
  const seen = new Set<string>()
  const blocks: SiteBlock[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string' || seen.has(item.id)) continue
    if (isBuiltinType(item.type)) {
      const known = builtins.find(section => section.id === item.id && section.type === item.type)
      if (!known) continue
    }
    seen.add(item.id)
    blocks.push(item as unknown as SiteBlock)
  }
  builtins.forEach((section, index) => {
    if (seen.has(section.id)) return
    // Insert after the previous registered section that is present, else at the start.
    const previous = builtins.slice(0, index).reverse().find(candidate => seen.has(candidate.id))
    const at = previous ? blocks.findIndex(block => block.id === previous.id) + 1 : 0
    blocks.splice(at, 0, shippedBlock(section))
    seen.add(section.id)
  })
  return { blocks }
}

/** True when the page needs the editor-block renderer (custom blocks or any styling). */
export function pageNeedsBlockRenderer(page: SitePage, document: unknown): boolean {
  if (isRecord(document) && isRecord(document.tokens) && Object.keys(document.tokens).length > 0) return true
  return page.blocks.some(block => !isBuiltinType(block.type) || Boolean(block.style) || Boolean(block.responsive))
}

/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo } from 'react'
import { compileBlocksCss } from '../../lib/site-editor/compile-css'
import type { SiteBlock, SiteDocument, SitePageId } from '../../lib/site-editor/model'
import { resolvePage } from '../../lib/site-editor/model'
import { checkSiteDocument } from '../../lib/site-editor/validate'
import { SiteBlockView } from './SiteBlocks'

/**
 * Lazy chunk for editor blocks. It is loaded by PageLayout only when the page actually has
 * editor blocks, styles or design tokens, so the default homepage downloads none of it.
 */

const cleaned = new WeakMap<object, SiteDocument>()

/** The document after lenient validation (cached per stored object). */
export function cleanDocument(raw: unknown): SiteDocument {
  if (!raw || typeof raw !== 'object') return { schemaVersion: 1, pages: {} }
  const hit = cleaned.get(raw)
  if (hit) return hit
  const document = checkSiteDocument(raw).document
  cleaned.set(raw, document)
  return document
}

function findBlock(document: SiteDocument, page: SitePageId, id: string): SiteBlock | undefined {
  return resolvePage(document, page).blocks.find(block => block.id === id)
}

/** Installs the compiled block and token styles as a constructed stylesheet (allowed by the CSP). */
export function PageBlockStyles({ document, page }: { document: unknown; page: SitePageId }) {
  const css = useMemo(() => {
    const clean = cleanDocument(document)
    return compileBlocksCss(resolvePage(clean, page).blocks, clean.tokens)
  }, [document, page])
  useEffect(() => {
    if (!css || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in window.document)) return undefined
    const sheet = new CSSStyleSheet()
    try { sheet.replaceSync(css) } catch { return undefined }
    const root = window.document
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return () => { root.adoptedStyleSheets = root.adoptedStyleSheets.filter(item => item !== sheet) }
  }, [css])
  return null
}

/** One top-level editor block. Loose blocks (not a Section) are aligned to the page shell. */
export function TopLevelBlock({ document, page, id }: { document: unknown; page: SitePageId; id: string }) {
  const block = findBlock(cleanDocument(document), page, id)
  if (!block || block.hidden) return null
  if (block.type === 'section' || block.type === 'banner') return <SiteBlockView block={block} />
  return <div className="hp-shell sb-loose"><SiteBlockView block={block} /></div>
}

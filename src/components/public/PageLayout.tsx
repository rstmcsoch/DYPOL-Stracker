import { Fragment, lazy, Suspense, useMemo, type ReactNode } from 'react'
import { useSiteDocument } from '../../contexts/SiteContentContext'
import { isBuiltinType, pageNeedsBlockRenderer, resolvePage, type SitePageId } from '../../lib/site-editor/model'
import { PageBlockContext, useBlockAttrs } from './page-block'

const loadBlocks = () => import('../site-blocks/index')
const TopLevelBlock = lazy(() => loadBlocks().then(module => ({ default: module.TopLevelBlock })))
const PageBlockStyles = lazy(() => loadBlocks().then(module => ({ default: module.PageBlockStyles })))

/**
 * Renders a public page from its page document: registered Stracker sections in the stored
 * order (hidden ones skipped) and any editor blocks between them. With no document, the page
 * renders exactly as shipped. Editor blocks and styles load from a separate chunk only when
 * the page uses them, so the default homepage carries no editor code.
 */
export function PageLayout({ page, sections }: { page: SitePageId; sections: Record<string, () => ReactNode> }) {
  const document = useSiteDocument()
  const resolved = useMemo(() => resolvePage(document, page), [document, page])
  const needsBlocks = pageNeedsBlockRenderer(resolved, document)

  return <>
    {needsBlocks && <Suspense fallback={null}><PageBlockStyles document={document} page={page} /></Suspense>}
    {resolved.blocks.map(block => {
      if (block.hidden) return null
      if (isBuiltinType(block.type)) {
        const render = sections[block.type]
        return render ? <PageBlockContext.Provider key={block.id} value={block}>{render()}</PageBlockContext.Provider> : <Fragment key={block.id} />
      }
      return <Suspense key={block.id} fallback={null}><TopLevelBlock document={document} page={page} id={block.id} /></Suspense>
    })}
  </>
}

/** A div root for a registered section that has no root element of its own. */
export function BlockRoot({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className} {...useBlockAttrs()}>{children}</div>
}

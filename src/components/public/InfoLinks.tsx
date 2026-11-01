import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useSiteValues } from '../../contexts/SiteContentContext'
import { INFO_PAGE_PATHS, infoPageAvailable, infoPageBody, type InfoPageKind } from '../../lib/site-content/info-pages'

/**
 * Privacy, Terms and About footer links. About and Terms render only when the owner has
 * written that page. Privacy always renders: to the owner's /privacy page when written,
 * otherwise to the homepage Privacy section (`homepageAnchor`, on the public homepage)
 * or the /privacy page that shows that same section (inside the notebook).
 */
export function InfoLinks({ className, homepageAnchor = false, wrap }: { className?: string; homepageAnchor?: boolean; wrap?: (node: ReactElement, kind: InfoPageKind) => ReactElement }) {
  const values = useSiteValues()
  const kinds: InfoPageKind[] = ['privacy', 'terms', 'about']
  return <>{kinds.filter(kind => infoPageAvailable(values, kind)).map(kind => {
    const label = values[`public.footer.${kind}.label`] ?? ''
    const node = kind === 'privacy' && homepageAnchor && infoPageBody(values, 'privacy') === ''
      ? <a key={kind} className={className} href="#privacy">{label}</a>
      : <Link key={kind} className={className} to={INFO_PAGE_PATHS[kind]}>{label}</Link>
    return wrap ? wrap(node, kind) : node
  })}</>
}

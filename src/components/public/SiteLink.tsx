import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { preloadPublicRoute } from '../../lib/public-preload'

/**
 * Renders a link stored in editable site content: internal paths go through React Router
 * (and warm their target chunk on hover/focus/press), in-page anchors and safe external
 * https links render as plain anchors, and anything unexpected falls back to `/`.
 */
export function SiteLink({ href, className, children, ...rest }: {
  href: string
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) {
    const warm = () => preloadPublicRoute(href)
    return <Link className={className} to={href} onPointerEnter={warm} onPointerDown={warm} onFocus={warm} {...rest}>{children}</Link>
  }
  if (href.startsWith('#')) return <a className={className} href={href} {...rest}>{children}</a>
  if (/^mailto:[^?&]+$/.test(href)) return <a className={className} href={href} {...rest}>{children}</a>
  if (href.startsWith('https://')) return <a className={className} href={href} rel="noopener noreferrer" {...rest}>{children}</a>
  return <Link className={className} to="/" {...rest}>{children}</Link>
}

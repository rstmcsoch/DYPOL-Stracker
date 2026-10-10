import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Renders an owner-chosen destination. Destinations are validated on save (see
 * src/lib/site-content/content.ts): internal pages and homepage anchors are used with the
 * router or as in-page links; a validated https address opens as a normal external link.
 * Anything else falls back to the homepage so a bad stored value cannot create an unsafe link.
 */
export function SiteLink({ href, className, children, ...rest }: {
  href: string
  className?: string
  children: ReactNode
  onClick?: () => void
}) {
  if (href.startsWith('/')) return <Link className={className} to={href} {...rest}>{children}</Link>
  if (href.startsWith('#')) return <a className={className} href={href} {...rest}>{children}</a>
  if (href.startsWith('https://')) return <a className={className} href={href} rel="noopener noreferrer" {...rest}>{children}</a>
  return <Link className={className} to="/" {...rest}>{children}</Link>
}

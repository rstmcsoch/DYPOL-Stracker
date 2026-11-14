import { Link } from 'react-router-dom'
import { useSiteText } from '../../contexts/SiteContentContext'
import { contactLinkKind } from '../../lib/site-content/contact-link'
import { CONTACT_PAGE_PATH } from '../../lib/site-content/info-pages'

/**
 * The footer Contact link. By default it opens the built-in /contact page (messages arrive in
 * Control Center → Messages). The owner may override it in Control Center (Appearance, Footer)
 * with an email address or an https page; no address is built in. `addressOnly` drops homepage
 * anchors, which make no sense outside the homepage (the signed-in notebook footer).
 */
export function ContactLink({ className, addressOnly = false }: { className?: string; addressOnly?: boolean }) {
  const href = useSiteText('public.footer.contact.href').trim() || CONTACT_PAGE_PATH
  const label = useSiteText('public.footer.contact.label')
  const kind = contactLinkKind(href)
  if (kind === 'none') return null
  if (addressOnly && kind === 'anchor') return null
  if (kind === 'route') return <Link className={className} to={href}>{label}</Link>
  if (kind === 'external') return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
  return <a className={className} href={href}>{label}</a>
}

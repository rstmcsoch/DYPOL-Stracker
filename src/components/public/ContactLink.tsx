import { Link } from 'react-router-dom'
import { useSiteText } from '../../contexts/SiteContentContext'
import { contactLinkKind } from '../../lib/site-content/contact-link'

/**
 * The footer Contact link, shown only when the owner has published a contact address in
 * Control Center (Appearance, Footer). No address is built in. `addressOnly` limits it to an
 * email or https page, for places where homepage sections and public routes make no sense
 * (the signed-in notebook footer).
 */
export function ContactLink({ className, addressOnly = false }: { className?: string; addressOnly?: boolean }) {
  const href = useSiteText('public.footer.contact.href').trim()
  const label = useSiteText('public.footer.contact.label')
  const kind = contactLinkKind(href)
  if (kind === 'none') return null
  if (addressOnly && kind !== 'email' && kind !== 'external') return null
  if (kind === 'route') return <Link className={className} to={href}>{label}</Link>
  if (kind === 'external') return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
  return <a className={className} href={href}>{label}</a>
}

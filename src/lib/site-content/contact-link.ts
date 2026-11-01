/**
 * How the optional footer Contact link renders. The address comes only from published site
 * content (validated by the editor); with nothing set the link is not shown at all.
 */
export type ContactLinkKind = 'none' | 'email' | 'external' | 'route' | 'anchor'

export function contactLinkKind(href: string): ContactLinkKind {
  const value = href.trim()
  if (!value) return 'none'
  if (/^mailto:/i.test(value)) return 'email'
  if (/^https:\/\//i.test(value)) return 'external'
  if (value.startsWith('/')) return 'route'
  if (value.startsWith('#')) return 'anchor'
  return 'none'
}

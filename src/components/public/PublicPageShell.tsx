import { useLayoutEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { PublicHeader } from './PublicHeader'
import { PublicFooter } from './PublicFooter'
import { useSiteText } from '../../contexts/SiteContentContext'
import { useOptionalUser } from '../../contexts/AuthContext'
import { accentStyle, usePublicTheme } from '../../lib/public-theme'
import { usePageMeta } from '../../lib/head'

/**
 * Frame for the public information pages (Privacy, Terms, About, Contact): the same header,
 * footer, light/night theme, owner accent and owner font as the homepage, so every public
 * page looks like one website. Section links in the header and footer return to the homepage.
 */
export function PublicPageShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = useSiteText
  const user = useOptionalUser()
  const [theme, toggleTheme] = usePublicTheme(t('public.appearance.default_mode'))
  const ownerAccent = accentStyle(t('public.appearance.accent'))
  const ownerFont = t('public.appearance.font')
  usePageMeta(`${title} · Stracker by DYPOL LABS`, description)
  const { pathname, hash } = useLocation()
  // Footer and sibling links are client-side navigations, so the browser keeps the old scroll
  // position. Open every public page at its top unless the link targets a section on it.
  useLayoutEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])

  return <div className="pub-page pub-subpage" id="top" data-public-theme={theme} data-owner-accent={ownerAccent ? '' : undefined} data-owner-font={ownerFont !== 'identity' ? ownerFont : undefined} style={ownerAccent}>
    <a className="pub-skip-link" href="#main">Skip to content</a>
    <PublicHeader theme={theme} onThemeToggle={toggleTheme} sectionPrefix="/" signedIn={Boolean(user)} />
    <main id="main" className="pub-main pub-doc-main">{children}</main>
    <PublicFooter sectionPrefix="/" />
    <span className="pub-grain" aria-hidden="true" />
  </div>
}

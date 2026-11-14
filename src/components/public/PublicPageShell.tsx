import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { PublicHeader } from './PublicHeader'
import { PublicFooter } from './PublicFooter'
import { useSiteText } from '../../contexts/SiteContentContext'
import { useOptionalUser } from '../../contexts/AuthContext'
import { accentStyle, usePublicTheme } from '../../lib/public-theme'
import { usePageMeta } from '../../lib/head'

/**
 * Footer, header and sibling links are client-side navigations, so the browser would keep the
 * old scroll position (usually the footer) and the new page looked like nothing happened.
 * Every navigation to a public page, including a click on the link of the page already open,
 * jumps instantly to the top (overriding html { scroll-behavior: smooth }) unless the URL targets
 * a section. After a real navigation, focus moves to the page heading for screen readers.
 */
function usePublicPageTop() {
  const { key, hash } = useLocation()

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  useLayoutEffect(() => {
    if (hash) return
    const root = document.documentElement
    const previousBehavior = root.style.scrollBehavior
    root.style.scrollBehavior = 'auto'
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    root.style.scrollBehavior = previousBehavior
    // 'default' is the page the visitor loaded directly: leave focus where the browser put it.
    if (key === 'default') return
    const heading = document.querySelector<HTMLElement>('#main h1')
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }, [key, hash])
}

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
  usePublicPageTop()

  return <div className="pub-page pub-subpage" id="top" data-public-theme={theme} data-owner-accent={ownerAccent ? '' : undefined} data-owner-font={ownerFont !== 'identity' ? ownerFont : undefined} style={ownerAccent}>
    <a className="pub-skip-link" href="#main">Skip to content</a>
    <PublicHeader theme={theme} onThemeToggle={toggleTheme} sectionPrefix="/" signedIn={Boolean(user)} />
    <main id="main" className="pub-main pub-doc-main">{children}</main>
    <PublicFooter sectionPrefix="/" />
    <span className="pub-grain" aria-hidden="true" />
  </div>
}

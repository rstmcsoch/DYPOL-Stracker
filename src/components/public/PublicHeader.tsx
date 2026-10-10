import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useSiteText } from '../../contexts/SiteContentContext'

export type PublicTheme = 'light' | 'dark'

/**
 * The public section list drives both the desktop navigation and the mobile menu, so a
 * section can never be reachable in one layout and missing in the other.
 * Every href is an anchor on the homepage — the links are real, not decorative.
 */
export const PUBLIC_SECTIONS = [
  { href: '#features', key: 'public.header.features.label' },
  { href: '#how-it-works', key: 'public.header.how.label' },
  { href: '#ai', key: 'public.header.ai.label' },
  { href: '#privacy', key: 'public.header.privacy.label' }
] as const

export function PublicBrand({ compact = false }: { compact?: boolean }) {
  return <Link className={`pub-brand ${compact ? 'pub-brand-compact' : ''}`} to="/" aria-label="Stracker home">
    <span className="brand-mark" aria-hidden="true"><span>S</span><i>✳</i></span>
    <span className="pub-brand-text">
      <strong className="type-brand">Stracker</strong>
      <small>by DYPOL LABS</small>
    </span>
  </Link>
}

/** Homepage-only switch: its state never reaches AppearanceContext or account settings. */
function PublicThemeToggle({ theme, onToggle }: { theme: PublicTheme; onToggle: () => void }) {
  const isDark = theme === 'dark'
  const action = isDark ? 'Switch to light mode' : 'Switch to night mode'
  const label = isDark ? 'Night mode on' : 'Light mode on'

  return <button
    type="button"
    role="switch"
    aria-checked={isDark}
    aria-label={`${label}. ${action}.`}
    title={`${label} — ${action}`}
    className={`theme-toggle pub-theme-toggle ${isDark ? 'theme-toggle-dark' : 'theme-toggle-light'}`}
    onClick={onToggle}
  >
    <span className="theme-toggle-track" aria-hidden="true">
      <Sun size={13} className="theme-toggle-icon theme-toggle-sun" />
      <Moon size={13} className="theme-toggle-icon theme-toggle-moon" />
      <span className="theme-toggle-thumb" />
    </span>
    <span className="theme-toggle-copy">
      <strong>{isDark ? 'Night' : 'Light'}</strong>
      <small>Theme</small>
    </span>
  </button>
}

/**
 * Public-site header: wordmark, section navigation, independent theme action, and
 * account actions. The mobile trigger keeps its existing close behaviours and menu.
 */
export function PublicHeader({ theme, onThemeToggle }: { theme: PublicTheme; onThemeToggle: () => void }) {
  const [open, setOpen] = useState(false)
  const t = useSiteText
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    const onResize = () => { if (window.innerWidth > 900) setOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return <header className="pub-header">
    <div className="pub-header-inner">
      <PublicBrand />
      <nav className="pub-nav" aria-label="Stracker sections">
        {PUBLIC_SECTIONS.map(section => <a key={section.href} className="pub-nav-link" href={section.href}>{t(section.key)}</a>)}
      </nav>
      <PublicThemeToggle theme={theme} onToggle={onThemeToggle} />
      <div className="pub-header-actions">
        <Link className="button button-quiet button-sm" to="/login">{t('public.header.login.label')}</Link>
        <Link className="button button-primary button-sm" to="/signup">{t('public.header.signup.label')}</Link>
      </div>
      <button
        ref={triggerRef}
        type="button"
        className="pub-menu-trigger"
        aria-expanded={open}
        aria-controls="stracker-public-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen(value => !value)}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
    </div>
    {open && <div className="pub-menu" id="stracker-public-menu" ref={panelRef}>
      <nav className="pub-menu-nav" aria-label="Stracker sections">
        {PUBLIC_SECTIONS.map(section => <a key={section.href} className="pub-menu-link" href={section.href} onClick={() => setOpen(false)}>{t(section.key)}</a>)}
      </nav>
      <div className="pub-menu-actions">
        <Link className="button button-secondary" to="/login" onClick={() => setOpen(false)}>{t('public.header.login.label')}</Link>
        <Link className="button button-primary" to="/signup" onClick={() => setOpen(false)}>{t('public.header.signup.label')}</Link>
      </div>
    </div>}
  </header>
}

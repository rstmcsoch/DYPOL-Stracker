import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

/**
 * The public section list drives both the desktop navigation and the mobile menu, so a
 * section can never be reachable in one layout and missing in the other.
 * Every href is an anchor on the homepage — the links are real, not decorative.
 */
export const PUBLIC_SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#ai', label: 'AI Assistant' },
  { href: '#privacy', label: 'Privacy' }
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

/**
 * Public-site header: wordmark, section navigation, and the two account actions.
 * The mobile trigger only appears when the navigation cannot fit, and the panel it
 * opens closes on link tap, Escape, an outside tap, or a route change.
 */
export function PublicHeader() {
  const [open, setOpen] = useState(false)
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
        {PUBLIC_SECTIONS.map(section => <a key={section.href} className="pub-nav-link" href={section.href}>{section.label}</a>)}
      </nav>
      <div className="pub-header-actions">
        <Link className="button button-quiet button-sm" to="/login">Log In</Link>
        <Link className="button button-primary button-sm" to="/signup">Sign Up</Link>
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
        {PUBLIC_SECTIONS.map(section => <a key={section.href} className="pub-menu-link" href={section.href} onClick={() => setOpen(false)}>{section.label}</a>)}
      </nav>
      <div className="pub-menu-actions">
        <Link className="button button-secondary" to="/login" onClick={() => setOpen(false)}>Log In</Link>
        <Link className="button button-primary" to="/signup" onClick={() => setOpen(false)}>Sign Up</Link>
      </div>
    </div>}
  </header>
}

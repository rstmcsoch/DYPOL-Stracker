import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { PublicBrand, PublicThemeToggle } from './PublicHeader'
import { useSiteText } from '../../contexts/SiteContentContext'
import { usePublicTheme } from '../../lib/public-theme'
import '../../styles/auth-home.css'

/**
 * Shared chrome for the standalone authentication pages (log in, sign up, password
 * reset). It reuses the existing `.auth-*` notebook shell from the application
 * stylesheet — same paper, same card, same footer rule as the rest of Stracker —
 * so these pages read as part of the product rather than a bolted-on form.
 *
 * Presentation follows the public homepage: the same cream/navy paper, soft blobs and grain,
 * and the visitor's saved public light/night choice (`stracker-public-home-theme`). The
 * theme switch only changes that public preference; it never touches account settings.
 */
export function AuthScaffold({ kicker, title, blurb, note, children }: {
  kicker: ReactNode
  title: ReactNode
  blurb: ReactNode
  note?: ReactNode
  children: ReactNode
}) {
  const [theme, toggleTheme] = usePublicTheme(useSiteText('public.appearance.default_mode'))
  return <div className="auth-page auth-page-public auth-hp" data-public-theme={theme}>
    <div className="auth-hp-ambient" aria-hidden="true"><span /><span /><span /></div>
    <div className="auth-paper-marks" aria-hidden="true"><span>✳</span><span>∿</span></div>
    <header className="auth-header">
      <PublicBrand compact />
      <div className="auth-header-actions">
        <Link className="auth-back" to="/"><ArrowLeft size={14} aria-hidden="true" /> Back to Stracker</Link>
        <span className="auth-private"><LockKeyhole size={14} aria-hidden="true" /> PRIVATE NOTEBOOK</span>
        <PublicThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
    </header>
    <main className="auth-content">
      <div className="auth-intro">
        <div className="auth-kicker"><span className="kicker-scribble" aria-hidden="true">✎</span> {kicker}</div>
        <h1 className="type-display">{title}</h1>
        <p>{blurb}</p>
        {note && <div className="auth-doodle-note"><span aria-hidden="true">✎</span><span>{note}</span></div>}
      </div>
      {children}
    </main>
    <footer className="auth-footer">
      <span className="auth-footer-rule" aria-hidden="true" />
      <span className="type-brand">Stracker <b>by DYPOL LABS</b></span>
      <span className="auth-footer-rule" aria-hidden="true" />
    </footer>
    <div className="auth-hp-grain" aria-hidden="true" />
  </div>
}

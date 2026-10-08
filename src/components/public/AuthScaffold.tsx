import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { PublicBrand } from './PublicHeader'

/**
 * Shared chrome for the standalone authentication pages (log in, sign up, password
 * reset). It reuses the existing `.auth-*` notebook shell from the application
 * stylesheet — same paper, same card, same footer rule as the rest of Stracker —
 * so these pages read as part of the product rather than a bolted-on form.
 */
export function AuthScaffold({ kicker, title, blurb, note, children }: {
  kicker: ReactNode
  title: ReactNode
  blurb: ReactNode
  note?: ReactNode
  children: ReactNode
}) {
  return <div className="auth-page auth-page-public">
    <div className="auth-paper-marks" aria-hidden="true"><span>✳</span><span>∿</span><span>✦</span></div>
    <header className="auth-header">
      <PublicBrand compact />
      <div className="auth-header-actions">
        <Link className="auth-back" to="/"><ArrowLeft size={14} aria-hidden="true" /> Back to Stracker</Link>
        <span className="auth-private"><LockKeyhole size={14} aria-hidden="true" /> PRIVATE NOTEBOOK</span>
      </div>
    </header>
    <main className="auth-content">
      <div className="auth-intro">
        <div className="auth-kicker"><span className="kicker-scribble" aria-hidden="true">✎</span> {kicker}</div>
        <h1>{title}</h1>
        <p>{blurb}</p>
        {note && <div className="auth-doodle-note"><span aria-hidden="true">✦</span><span>{note}</span></div>}
      </div>
      {children}
    </main>
    <footer className="auth-footer">
      <span className="auth-footer-rule" aria-hidden="true" />
      <span>Stracker <b>by DYPOL LABS</b></span>
      <span className="auth-footer-rule" aria-hidden="true" />
    </footer>
  </div>
}

import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { PublicBrand } from './PublicHeader'

/**
 * Public footer. Every entry points at a route or an anchor that exists in this
 * application — there are no placeholder links, social stubs, or dead pages.
 */
export function PublicFooter() {
  const year = new Date().getFullYear()
  return <footer className="pub-footer">
    <div className="pub-footer-inner">
      <div className="pub-footer-brand">
        <PublicBrand compact />
        <p>A focused digital study notebook for JEE preparation.</p>
      </div>
      <nav className="pub-footer-nav" aria-label="Footer">
        <div className="pub-footer-group">
          <h2>Product</h2>
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#ai">AI Assistant</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>Account</h2>
          <ul>
            <li><Link to="/login">Log In</Link></li>
            <li><Link to="/signup">Sign Up</Link></li>
            <li><Link to="/reset-password">Reset password</Link></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>Information</h2>
          <ul>
            <li><a href="#privacy">Privacy</a></li>
            <li><a href="#why-stracker">Study system</a></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>Brand</h2>
          <ul>
            <li><a href="#dypol-labs">DYPOL LABS</a></li>
            <li><a href="#top">Back to top <ArrowUp size={13} aria-hidden="true" /></a></li>
          </ul>
        </div>
      </nav>
    </div>
    <div className="pub-footer-bottom">
      <span className="pub-footer-rule" aria-hidden="true" />
      <p>© {year} DYPOL LABS · Stracker for JEE 2027</p>
      <span className="pub-footer-rule" aria-hidden="true" />
    </div>
  </footer>
}

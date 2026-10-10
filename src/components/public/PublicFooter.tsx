import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { PublicBrand } from './PublicHeader'
import { useSiteText } from '../../contexts/SiteContentContext'

/**
 * Public footer. Every entry points at a route or an anchor that exists in this
 * application — there are no placeholder links, social stubs, or dead pages.
 */
export function PublicFooter() {
  const year = new Date().getFullYear()
  const t = useSiteText
  return <footer className="pub-footer">
    <div className="pub-footer-inner">
      <div className="pub-footer-brand">
        <PublicBrand compact />
        <p>{t('public.footer.tagline')}</p>
      </div>
      <nav className="pub-footer-nav" aria-label="Footer">
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_product.title')}</h2>
          <ul>
            <li><a href="#features">{t('public.footer.features.label')}</a></li>
            <li><a href="#ai">{t('public.footer.ai.label')}</a></li>
            <li><a href="#how-it-works">{t('public.footer.how.label')}</a></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_account.title')}</h2>
          <ul>
            <li><Link to="/login">{t('public.footer.login.label')}</Link></li>
            <li><Link to="/signup">{t('public.footer.signup.label')}</Link></li>
            <li><Link to="/reset-password">{t('public.footer.reset.label')}</Link></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_information.title')}</h2>
          <ul>
            <li><a href="#privacy">{t('public.footer.privacy.label')}</a></li>
            <li><a href="#why-stracker">{t('public.footer.study.label')}</a></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_brand.title')}</h2>
          <ul>
            <li><a href="#dypol-labs">{t('public.footer.dypol.label')}</a></li>
            <li><a href="#top">{t('public.footer.top.label')} <ArrowUp size={13} aria-hidden="true" /></a></li>
          </ul>
        </div>
      </nav>
    </div>
    <div className="pub-footer-bottom">
      <span className="pub-footer-rule" aria-hidden="true" />
      <p>© {year} {t('public.footer.copyright')}</p>
      <span className="pub-footer-rule" aria-hidden="true" />
    </div>
    <div className="pub-footer-wordmark-window" aria-hidden="true">
      <p className="pub-footer-wordmark">STRACKER</p>
    </div>
  </footer>
}

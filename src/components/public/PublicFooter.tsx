import { Link } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { PublicBrand } from './PublicHeader'
import { useSiteText } from '../../contexts/SiteContentContext'
import { ContactLink } from './ContactLink'
import { InfoLinks } from './InfoLinks'

/**
 * Public footer, on the homepage and the public information pages. Every entry points at a
 * route or an anchor that exists in this application — there are no placeholder links,
 * social stubs, or dead pages. Off the homepage, section anchors lead back to the homepage.
 */
export function PublicFooter({ sectionPrefix = '' }: { sectionPrefix?: '' | '/' }) {
  const year = new Date().getFullYear()
  const t = useSiteText
  const onHome = sectionPrefix === ''
  const at = (anchor: string) => `${sectionPrefix}${anchor}`
  return <footer className="pub-footer" data-se-region="footer">
    <div className="pub-footer-inner">
      <div className="pub-footer-brand">
        <PublicBrand compact />
        <p>{t('public.footer.tagline')}</p>
      </div>
      <nav className="pub-footer-nav" aria-label="Footer">
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_product.title')}</h2>
          <ul>
            <li><a href={at('#features')}>{t('public.footer.features.label')}</a></li>
            <li><a href={at('#ai')}>{t('public.footer.ai.label')}</a></li>
            <li><a href={at('#how-it-works')}>{t('public.footer.how.label')}</a></li>
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
            <InfoLinks homepageAnchor={onHome} wrap={(node, kind) => <li key={kind}>{node}</li>} />
            <li><a href={at('#why-stracker')}>{t('public.footer.study.label')}</a></li>
            <li><ContactLink /></li>
          </ul>
        </div>
        <div className="pub-footer-group">
          <h2>{t('public.footer.group_brand.title')}</h2>
          <ul>
            <li><a href={at('#dypol-labs')}>{t('public.footer.dypol.label')}</a></li>
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

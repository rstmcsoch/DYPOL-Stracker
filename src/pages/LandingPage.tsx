import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowRight, Check, LockKeyhole } from 'lucide-react'
import { PublicHeader, type PublicTheme } from '../components/public/PublicHeader'
import { PublicFooter } from '../components/public/PublicFooter'
import { NotebookPreview } from '../components/public/NotebookPreview'
import {
  AiSection, DypolSection, FeatureSection, FinalCta, HowItWorksSection, PrincipleSection, PrivacySection, StudyLoopSection
} from '../components/public/LandingSections'
import { PromoVideoSection } from '../components/public/PromoVideoPlayer'
import { usePageMeta } from '../lib/head'
import { useSiteText } from '../contexts/SiteContentContext'
import { SiteLink } from '../components/public/SiteLink'
import { COLOR_THEME_OPTIONS } from '../lib/themes'

const PUBLIC_THEME_STORAGE_KEY = 'stracker-public-home-theme'

/** The visitor's own saved choice, or null when they never used the toggle. */
function readStoredPublicTheme(): PublicTheme | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(PUBLIC_THEME_STORAGE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : null
  } catch {
    return null
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Owner default (public.appearance.default_mode) applies only until the visitor chooses. */
function usePublicTheme(defaultMode: string): [PublicTheme, () => void] {
  const [stored, setStored] = useState<PublicTheme | null>(readStoredPublicTheme)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  useEffect(() => {
    if (defaultMode !== 'system' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [defaultMode])
  const fallback: PublicTheme = defaultMode === 'dark' || (defaultMode === 'system' && systemDark) ? 'dark' : 'light'
  const theme = stored ?? fallback
  const toggle = () => {
    const next: PublicTheme = theme === 'dark' ? 'light' : 'dark'
    try {
      window.localStorage.setItem(PUBLIC_THEME_STORAGE_KEY, next)
    } catch {
      // The in-memory toggle still works when storage is unavailable.
    }
    setStored(next)
  }
  return [theme, toggle]
}

/** Inline custom properties for a non-default accent preset; undefined keeps the stylesheet values. */
function accentStyle(accent: string): CSSProperties | undefined {
  if (accent === 'default') return undefined
  const option = COLOR_THEME_OPTIONS.find(item => item.value === accent)
  if (!option) return undefined
  return { '--owner-accent-light': option.light[1], '--owner-accent-dark': option.dark[1] } as CSSProperties
}

/** One highlight per line; blank lines are ignored. */
function lines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

/**
 * Public homepage for Stracker by DYPOL LABS.
 *
 * This route renders only for visitors without a session; authenticated users are sent
 * into the notebook by the root route guard in App.tsx. The page is deliberately built
 * from the application's own primitives and design tokens rather than a second
 * front-end, so the marketing surface and the product cannot drift apart.
 */
export default function LandingPage() {
  const t = useSiteText
  const [publicTheme, togglePublicTheme] = usePublicTheme(t('public.appearance.default_mode'))
  const ownerAccent = accentStyle(t('public.appearance.accent'))
  const ownerFont = t('public.appearance.font')

  usePageMeta(t('public.meta.title'), t('public.meta.description'))

  return <div className="pub-page" id="top" data-public-theme={publicTheme} data-owner-accent={ownerAccent ? '' : undefined} data-owner-font={ownerFont !== 'identity' ? ownerFont : undefined} style={ownerAccent}>
    <a className="pub-skip-link" href="#main">Skip to content</a>
    <PublicHeader theme={publicTheme} onThemeToggle={togglePublicTheme} />
    <main id="main" className="pub-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="pub-shell hero-shell">
          <div className="hero-copy">
            <p className="pub-eyebrow"><span aria-hidden="true">✎</span> {t('public.hero.eyebrow')}</p>
            <h1 id="hero-title">{t('public.hero.title')} <em>{t('public.hero.title_emphasis')}</em></h1>
            <p className="hero-lede">{t('public.hero.lede')}</p>
            <ul className="hero-pillars" aria-label="What Stracker brings together">
              {lines(t('public.hero.pillars')).map(pillar => <li key={pillar}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{pillar}</span></li>)}
            </ul>
            <div className="pub-cta-row hero-cta-row">
              <SiteLink className="button button-primary button-lg" href={t('public.hero.cta_primary.href')}>{t('public.hero.cta_primary.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
              <SiteLink className="button button-secondary button-lg" href={t('public.hero.cta_secondary.href')}>{t('public.hero.cta_secondary.label')}</SiteLink>
            </div>
            <p className="hero-scroll"><a href="#why-stracker">{t('public.hero.scroll.label')} <ArrowDown size={14} aria-hidden="true" /><span className="visually-hidden">(jump to the study system section)</span></a></p>
            <p className="hero-meta"><LockKeyhole size={13} aria-hidden="true" /> {t('public.hero.meta')}</p>
          </div>
          <div className="hero-visual">
            {t('public.hero.image')
              ? <img className="hero-image" src={t('public.hero.image')} alt={t('public.hero.image_alt')} decoding="async" width={1200} height={900} />
              : <NotebookPreview />}
          </div>
        </div>
      </section>

      <StudyLoopSection />
      <FeatureSection />
      <PrincipleSection />
      <HowItWorksSection />
      <AiSection />
      <PrivacySection />
      <DypolSection />
      <PromoVideoSection />
      <FinalCta />
    </main>
    <PublicFooter />
    <span className="pub-grain" aria-hidden="true" />
  </div>
}

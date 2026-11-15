import { useRef } from 'react'
import { ArrowDown, ArrowRight, Check, LockKeyhole } from 'lucide-react'
import { PublicHeader } from '../components/public/PublicHeader'
import { PublicFooter } from '../components/public/PublicFooter'
import { NotebookPreview } from '../components/public/NotebookPreview'
import {
  AiSection, DypolSection, FeatureSection, FinalCta, HowItWorksSection, PrincipleSection, PrivacySection, StudyLoopSection
} from '../components/public/LandingSections'
import { useFeatureOrder } from '../components/public/feature-order'
import { PromoVideoSection } from '../components/public/PromoVideoPlayer'
import { useHomeMotion } from '../components/public/home-motion'
import { usePageMeta } from '../lib/head'
import { useSiteText } from '../contexts/SiteContentContext'
import { SiteLink } from '../components/public/SiteLink'
import { accentStyle, usePublicTheme } from '../lib/public-theme'
import '../styles/home.css'

/** One highlight per line; blank lines are ignored. */
function lines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

/**
 * Exams students can pick in Stracker's exam catalogue (src/lib/exams/catalog.ts). The
 * names are shown as the audience the notebook is built for — not as ready-made templates.
 */
const EXAM_NAMES = ['JEE', 'NEET UG', 'MHT CET', 'BITSAT', 'CUET UG', 'CLAT', 'NDA', 'Class 9–12 boards', 'CA', 'CS', 'CMA', 'GATE', 'CAT', 'UPSC CSE', 'SSC CGL', 'IBPS PO', 'SBI PO']

/**
 * Four facts that can each be checked in the product: the count of feature cards shown on
 * this page, the four test types of the test journal, the default revision gaps and the
 * no-ads promise already made in the privacy section.
 */
function StatsStrip() {
  const modules = useFeatureOrder().length
  const notes = [
    { value: String(modules), label: 'core modules in one notebook — each one a page you will use weekly' },
    { value: '4', label: 'test types in the journal: chapter, subject, full mock and PYQ practice' },
    { value: '1 · 7 · 30', label: 'day revision gaps ready to use — change them any time' },
    { value: '0', label: 'ads or third-party trackers on your notebook' }
  ]
  return <section className="hp-stats" aria-label="Stracker at a glance">
    <div className="hp-shell">
      <ul className="hp-stats-list">
        {notes.map((note, index) => <li className={`hp-note hp-note-${index + 1}`} key={note.label} data-reveal="">
          <strong>{note.value}</strong>
          <span>{note.label}</span>
        </li>)}
      </ul>
    </div>
  </section>
}

function ExamBand() {
  const items = EXAM_NAMES.map(name => <li key={name}>{name}<span aria-hidden="true">✳</span></li>)
  return <section className="hp-exams" aria-label="Built for every major exam">
    <p className="hp-exams-label">Built for aspirants preparing for</p>
    <div className="hp-exams-window">
      <ul className="hp-exams-track">{items}</ul>
      <ul className="hp-exams-track" aria-hidden="true">{items}</ul>
    </div>
  </section>
}

/**
 * Public homepage for Stracker by DYPOL LABS.
 *
 * This route renders only for visitors without a session; authenticated users are sent
 * into the notebook by the root route guard in App.tsx. All copy comes from the owner-editable
 * site-content registry; the homepage styles live in styles/home.css, scoped to `.pub-home`.
 */
export default function LandingPage() {
  const t = useSiteText
  const [publicTheme, togglePublicTheme] = usePublicTheme(t('public.appearance.default_mode'))
  const ownerAccent = accentStyle(t('public.appearance.accent'))
  const ownerFont = t('public.appearance.font')
  const rootRef = useRef<HTMLDivElement>(null)

  usePageMeta(t('public.meta.title'), t('public.meta.description'))
  useHomeMotion(rootRef)

  return <div ref={rootRef} className="pub-page pub-home" id="top" data-public-theme={publicTheme} data-owner-accent={ownerAccent ? '' : undefined} data-owner-font={ownerFont !== 'identity' ? ownerFont : undefined} style={ownerAccent}>
    <a className="pub-skip-link" href="#main">Skip to content</a>
    <div className="hp-ambient" aria-hidden="true"><span id="px1" /><span id="px2" /><span id="px3" /></div>
    <div className="hp-progress" aria-hidden="true"><span className="hp-progress-fill" /></div>
    <div className="hp-pencil" aria-hidden="true"><span className="hp-pencil-fill" /><span className="hp-pencil-tip">✎</span></div>
    <PublicHeader theme={publicTheme} onThemeToggle={togglePublicTheme} />
    <main id="main" className="pub-main">
      <section className="hp-hero" aria-labelledby="hero-title">
        <span className="hp-dd hp-dd-1" data-depth="10" aria-hidden="true"><span data-px="18">✎</span></span>
        <span className="hp-dd hp-dd-2" data-depth="-8" aria-hidden="true"><span data-px="-14">✳</span></span>
        <span className="hp-dd hp-dd-3" data-depth="6" aria-hidden="true"><span data-px="10">∫ f(x) dx</span></span>
        <span className="hp-dd hp-dd-4" data-depth="-6" aria-hidden="true"><span data-px="8">a² + b² = c²</span></span>
        <span className="hp-dd hp-dd-5" data-depth="8" aria-hidden="true"><span data-px="-10">→</span></span>
        <div className="hp-shell hp-hero-grid">
          <div className="hp-hero-copy">
            <p className="hp-eyebrow hp-eyebrow-pill"><span aria-hidden="true">✎</span> {t('public.hero.eyebrow')}</p>
            <h1 id="hero-title" className="hp-h1">{t('public.hero.title')} <em className="hp-highlight">{t('public.hero.title_emphasis')}</em></h1>
            <p className="hp-hero-lede">{t('public.hero.lede')}</p>
            <ul className="hp-pillars" aria-label="What Stracker brings together">
              {lines(t('public.hero.pillars')).map(pillar => <li key={pillar}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{pillar}</span></li>)}
            </ul>
            <div className="hp-cta-row">
              <SiteLink className="hp-btn hp-btn-primary hp-btn-lg" href={t('public.hero.cta_primary.href')}>{t('public.hero.cta_primary.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
              <SiteLink className="hp-btn hp-btn-secondary hp-btn-lg" href={t('public.hero.cta_secondary.href')}>{t('public.hero.cta_secondary.label')}</SiteLink>
            </div>
            <p className="hp-hero-scroll"><a href="#why-stracker">{t('public.hero.scroll.label')} <ArrowDown size={14} aria-hidden="true" /><span className="visually-hidden">(jump to the study system section)</span></a></p>
            <p className="hp-hero-meta"><LockKeyhole size={13} aria-hidden="true" /> {t('public.hero.meta')}</p>
          </div>
          <div className="hp-hero-visual">
            {t('public.hero.image')
              ? <img className="hp-hero-image" src={t('public.hero.image')} alt={t('public.hero.image_alt')} decoding="async" width={1200} height={900} />
              : <NotebookPreview />}
          </div>
        </div>
      </section>

      <ExamBand />
      <StatsStrip />
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

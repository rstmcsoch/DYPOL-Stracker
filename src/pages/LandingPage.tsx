import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, Check, LockKeyhole } from 'lucide-react'
import { PublicHeader, type PublicTheme } from '../components/public/PublicHeader'
import { PublicFooter } from '../components/public/PublicFooter'
import { NotebookPreview } from '../components/public/NotebookPreview'
import {
  AiSection, DypolSection, FeatureSection, FinalCta, HowItWorksSection, PrincipleSection, PrivacySection, StudyLoopSection
} from '../components/public/LandingSections'
import { usePageMeta } from '../lib/head'

const PUBLIC_THEME_STORAGE_KEY = 'stracker-public-home-theme'

function readPublicTheme(): PublicTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    return window.localStorage.getItem(PUBLIC_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** The eight things the notebook brings onto one page, in the order they are used. */
const HERO_PILLARS = [
  'Syllabus', 'Tests', 'Mistakes', 'Revision', 'Daily planning', 'Focus sessions', 'Analytics', 'AI assistance'
]

/**
 * Public homepage for Stracker by DYPOL LABS.
 *
 * This route renders only for visitors without a session; authenticated users are sent
 * into the notebook by the root route guard in App.tsx. The page is deliberately built
 * from the application's own primitives and design tokens rather than a second
 * front-end, so the marketing surface and the product cannot drift apart.
 */
export default function LandingPage() {
  const [publicTheme, setPublicTheme] = useState<PublicTheme>(readPublicTheme)

  const togglePublicTheme = () => {
    setPublicTheme(current => {
      const next: PublicTheme = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(PUBLIC_THEME_STORAGE_KEY, next)
      } catch {
        // The in-memory toggle still works when storage is unavailable.
      }
      return next
    })
  }

  usePageMeta(
    'Stracker by DYPOL LABS — a serious JEE 2027 study notebook',
    'Stracker by DYPOL LABS is a digital study notebook for JEE preparation: syllabus tracking, test journal, mistakes and retries, spaced revision, daily planning, focus sessions and analytics.'
  )

  return <div className="pub-page" id="top" data-public-theme={publicTheme}>
    <a className="pub-skip-link" href="#main">Skip to content</a>
    <PublicHeader theme={publicTheme} onThemeToggle={togglePublicTheme} />
    <main id="main" className="pub-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="pub-shell hero-shell">
          <div className="hero-copy">
            <p className="pub-eyebrow"><span aria-hidden="true">✎</span> JEE 2027 · A DIGITAL STUDY NOTEBOOK</p>
            <h1 id="hero-title">Your JEE preparation, organized in <em>one serious study notebook.</em></h1>
            <p className="hero-lede">Stracker keeps the syllabus, the tests, the mistakes, the revision queue, the daily plan, focus sessions and the analytics on the same page — then stays quiet while you actually study.</p>
            <ul className="hero-pillars" aria-label="What Stracker brings together">
              {HERO_PILLARS.map(pillar => <li key={pillar}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{pillar}</span></li>)}
            </ul>
            <div className="pub-cta-row hero-cta-row">
              <Link className="button button-primary button-lg" to="/signup">Start with Stracker <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link className="button button-secondary button-lg" to="/login">Log In</Link>
            </div>
            <p className="hero-scroll"><a href="#why-stracker">Explore how it works <ArrowDown size={14} aria-hidden="true" /><span className="visually-hidden">(jump to the study system section)</span></a></p>
            <p className="hero-meta"><LockKeyhole size={13} aria-hidden="true" /> Private to your account · Works on phone, tablet and desktop · Installable</p>
          </div>
          <div className="hero-visual">
            <NotebookPreview />
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
      <FinalCta />
    </main>
    <PublicFooter />
    <span className="pub-grain" aria-hidden="true" />
  </div>
}

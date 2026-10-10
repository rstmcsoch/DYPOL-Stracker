import { useState, type ReactNode } from 'react'
import {
  AlarmClock, ArrowRight, BookOpen, CalendarCheck, Check, ChevronDown, ChevronUp, Compass,
  ListChecks, LockKeyhole, NotebookPen, Repeat2, Shield, ShieldCheck, Sparkles, Target,
  TrendingUp, Timer
} from 'lucide-react'
import { useSiteText } from '../../contexts/SiteContentContext'
import { SiteLink } from './SiteLink'

/** Splits a one-item-per-line field into clean list entries. */
function lines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

function SectionShell({ id, eyebrow, title, lede, children, tone = 'paper' }: {
  id: string
  eyebrow: string
  title: ReactNode
  lede?: ReactNode
  children: ReactNode
  tone?: 'paper' | 'plain'
}) {
  return <section id={id} className={`pub-section pub-section-${tone}`} aria-labelledby={`${id}-title`}>
    <div className="pub-shell">
      <div className="pub-section-head">
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> {eyebrow}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        {lede && <p className="pub-lede">{lede}</p>}
      </div>
      {children}
    </div>
  </section>
}

/* ------------------------------------------------------------ the study loop */

/** Step names and the link captions are structural: they name the pages they point to. */
const LOOP_STEPS = [
  { step: 'Learn', link: 'Syllabus notebook' },
  { step: 'Test', link: 'Test journal' },
  { step: 'Analyse', link: 'Analytics' },
  { step: 'Revise', link: 'Revision desk' },
  { step: 'Repeat', link: 'Planner + Focus' }
]

export function StudyLoopSection() {
  const t = useSiteText
  return <SectionShell
    id="why-stracker"
    eyebrow={t('public.loop.eyebrow')}
    title={t('public.loop.title')}
    lede={t('public.loop.lede')}
  >
    <ol className="loop-list">
      {LOOP_STEPS.map((item, index) => <li className="loop-step" key={item.step}>
        <div className="loop-step-card">
          <span className="loop-step-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <h3>{item.step}</h3>
          <p>{t(`public.loop.step_${index + 1}.body`)}</p>
          <span className="loop-step-link">{item.link}</span>
        </div>
        {index < LOOP_STEPS.length - 1
          ? <span className="loop-arrow" aria-hidden="true">→</span>
          : <span className="loop-arrow loop-arrow-repeat" aria-hidden="true">↻</span>}
      </li>)}
    </ol>
    <p className="loop-footnote"><Repeat2 size={15} aria-hidden="true" /> {t('public.loop.footnote')}</p>
  </SectionShell>
}

/* ----------------------------------------------------------------- features */

const FEATURE_ICONS: ReactNode[] = [
  <BookOpen size={19} />, <ListChecks size={19} />, <NotebookPen size={19} />, <AlarmClock size={19} />,
  <CalendarCheck size={19} />, <Timer size={19} />, <TrendingUp size={19} />, <Sparkles size={19} />
]

export function FeatureSection() {
  const [expanded, setExpanded] = useState(false)
  const t = useSiteText

  return <SectionShell
    id="features"
    eyebrow={t('public.features.eyebrow')}
    title={t('public.features.title')}
    lede={t('public.features.lede')}
  >
    <ol id="feature-list" className={`feature-list ${expanded ? 'is-expanded' : ''}`}>
      {FEATURE_ICONS.map((icon, index) => {
        const n = index + 1
        return <li className="feature-entry" key={n}>
          <div className="feature-entry-head">
            <span className="feature-index" aria-hidden="true">{String(n).padStart(2, '0')}</span>
            <span className="feature-icon" aria-hidden="true">{icon}</span>
            <div>
              <h3>{t(`public.features.item_${n}.title`)}</h3>
              <p>{t(`public.features.item_${n}.summary`)}</p>
            </div>
          </div>
          <ul className="feature-points">
            {lines(t(`public.features.item_${n}.points`)).map(point => <li key={point}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{point}</span></li>)}
          </ul>
        </li>
      })}
    </ol>
    <button
      className="feature-toggle"
      type="button"
      aria-controls="feature-list"
      aria-expanded={expanded}
      aria-label={expanded ? 'Show fewer features' : 'See all eight Stracker features'}
      onClick={() => setExpanded(value => !value)}
    >
      <span>{expanded ? 'Show fewer features' : 'See all features'}</span>
      {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
    </button>
    <p className="feature-footnote">
      <span aria-hidden="true">✎</span> {t('public.features.footnote')}
    </p>
  </SectionShell>
}

/* -------------------------------------------------------- product principle */

export function PrincipleSection() {
  const t = useSiteText
  return <section className="pub-section pub-section-principle" aria-labelledby="principle-title">
    <div className="pub-shell">
      <div className="principle-spread">
        <div className="principle-copy">
          <p className="pub-eyebrow"><span aria-hidden="true">✎</span> {t('public.principles.eyebrow')}</p>
          <h2 id="principle-title">{t('public.principles.title')}</h2>
          <p>{t('public.principles.body')}</p>
          <p className="principle-note"><Compass size={15} aria-hidden="true" /> <span>{t('public.principles.note')}</span></p>
        </div>
        <ul className="principle-list">
          {PRINCIPLE_COUNT_INDEXES.map(n => <li key={n}>
            <span className="principle-tick" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
            <div><strong>{t(`public.principles.item_${n}.title`)}</strong><p>{t(`public.principles.item_${n}.body`)}</p></div>
          </li>)}
        </ul>
      </div>
    </div>
  </section>
}

const PRINCIPLE_COUNT_INDEXES = [1, 2, 3, 4, 5, 6]

/* -------------------------------------------------------------- how it works */

const HOW_STEP_INDEXES = [1, 2, 3, 4]

export function HowItWorksSection() {
  const t = useSiteText
  return <SectionShell
    id="how-it-works"
    eyebrow={t('public.how.eyebrow')}
    title={t('public.how.title')}
    lede={t('public.how.lede')}
    tone="plain"
  >
    <ol className="step-list">
      {HOW_STEP_INDEXES.map((n, index) => <li className="step-entry" key={n}>
        <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="step-copy">
          <h3>{t(`public.how.step_${n}.title`)}</h3>
          <p>{t(`public.how.step_${n}.body`)}</p>
        </div>
        <span className="step-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      </li>)}
    </ol>
  </SectionShell>
}

/* --------------------------------------------------------------- AI section */

/** The example exchange is illustrative product copy, not owner content: it stays in code. */
export function AiSection() {
  const t = useSiteText
  return <section id="ai" className="pub-section pub-section-ai" aria-labelledby="ai-title">
    <div className="pub-shell">
      <div className="ai-spread">
        <div className="ai-copy">
          <p className="pub-eyebrow"><span aria-hidden="true">✎</span> {t('public.ai.eyebrow')}</p>
          <h2 id="ai-title">{t('public.ai.title')}</h2>
          <p className="pub-lede">{t('public.ai.lede')}</p>
          <dl className="ai-facts">
            {[1, 2, 3, 4].map(n => <div key={n}>
              <dt>{t(`public.ai.fact_${n}.term`)}</dt>
              <dd>{t(`public.ai.fact_${n}.body`)}</dd>
            </div>)}
          </dl>
          <div className="pub-cta-row">
            <SiteLink className="button button-secondary button-lg" href="/login">{t('public.ai.cta.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
            <span className="pub-cta-note">{t('public.ai.cta.note')}</span>
          </div>
        </div>
        <aside className="ai-example" aria-labelledby="ai-example-title">
          <p className="ai-example-label" id="ai-example-title">ILLUSTRATIVE EXCHANGE</p>
          <div className="ai-example-quote">
            <p className="ai-example-ask">“Which chapters are dragging my Physics score down?”</p>
            <p className="ai-example-answer">“Two tested chapters sit below your weak threshold: Current Electricity (48%) and Rotational Motion (52%). Both have mistakes logged as Concept errors, and one revision is due today.”</p>
          </div>
          <p className="ai-example-note"><Shield size={13} aria-hidden="true" /> An example of the kind of answer supported tools produce from your own figures — not a transcript of your data.</p>
        </aside>
      </div>
    </div>
  </section>
}

/* ------------------------------------------------------------- privacy */

export function PrivacySection() {
  const t = useSiteText
  return <SectionShell
    id="privacy"
    eyebrow={t('public.privacy.eyebrow')}
    title={t('public.privacy.title')}
    lede={t('public.privacy.lede')}
  >
    <div className="privacy-board">
      <dl className="privacy-list">
        {[1, 2, 3, 4, 5, 6].map(n => <div key={n}>
          <dt><ShieldCheck size={15} aria-hidden="true" /> {t(`public.privacy.item_${n}.title`)}</dt>
          <dd>{t(`public.privacy.item_${n}.body`)}</dd>
        </div>)}
      </dl>
      <p className="privacy-foot">
        <LockKeyhole size={14} aria-hidden="true" /> {t('public.privacy.foot')}
      </p>
    </div>
  </SectionShell>
}

/* ----------------------------------------------------------- DYPOL LABS */

export function DypolSection() {
  const t = useSiteText
  return <section id="dypol-labs" className="pub-section pub-section-dypol" aria-labelledby="dypol-title">
    <div className="pub-shell">
      <div className="dypol-band">
        <div className="dypol-mark" aria-hidden="true"><span>S</span><i>✎</i></div>
        <div>
          <h2 id="dypol-title">{t('public.dypol.title')}</h2>
          <p>{t('public.dypol.body')}</p>
        </div>
        <span className="dypol-tag">{t('public.dypol.tag')}</span>
      </div>
    </div>
  </section>
}

/* -------------------------------------------------------------- final CTA */

export function FinalCta() {
  const t = useSiteText
  return <section className="pub-section pub-final" aria-labelledby="final-title">
    <div className="pub-shell">
      <div className="final-sheet">
        <span className="final-tape" aria-hidden="true" />
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> {t('public.final.eyebrow')}</p>
        <h2 id="final-title">{t('public.final.title')} <em>{t('public.final.title_emphasis')}</em></h2>
        <p>{t('public.final.body')}</p>
        <div className="pub-cta-row pub-cta-row-center">
          <SiteLink className="button button-primary button-lg" href={t('public.final.cta_primary.href')}>{t('public.final.cta_primary.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
          <SiteLink className="button button-secondary button-lg" href={t('public.final.cta_secondary.href')}>{t('public.final.cta_secondary.label')}</SiteLink>
        </div>
        <p className="final-note"><Target size={14} aria-hidden="true" /> {t('public.final.note')}</p>
        <span className="final-doodle" aria-hidden="true">✎</span>
      </div>
    </div>
  </section>
}

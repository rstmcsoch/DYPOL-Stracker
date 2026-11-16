import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlarmClock, ArrowRight, BookOpen, CalendarCheck, Check, ChevronDown, ChevronUp, Compass,
  ListChecks, LockKeyhole, NotebookPen, Repeat2, Shield, ShieldCheck, Sparkles, Target,
  TrendingUp, Timer
} from 'lucide-react'
import { useSiteText } from '../../contexts/SiteContentContext'
import { parseOrder } from '../../lib/site-content/content'
import { fieldDefinition } from '../../lib/site-content/registry'
import { SiteLink } from './SiteLink'
import { prefersReducedMotion } from './home-motion'
import { useFeatureOrder } from './feature-order'
import { stringRecords, useBlockAttrs, useBlockProps } from './page-block'
import { DEFAULT_LOOP_STEPS } from '../../lib/site-editor/blocks-spec'

/** Splits a one-item-per-line field into clean list entries. */
function lines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

/** Pastel tones rotate through cards so neighbours never look identical. */
const TONES = ['blue', 'mint', 'orange', 'pink', 'violet', 'sky', 'teal', 'yellow'] as const
const tone = (index: number) => TONES[index % TONES.length]

function SectionHead({ id, eyebrow, title, lede, center = false }: { id: string; eyebrow: string; title: ReactNode; lede?: ReactNode; center?: boolean }) {
  return <div className={`hp-head${center ? ' hp-head-center' : ''}`} data-reveal="">
    <p className="hp-eyebrow"><span aria-hidden="true">✎</span> {eyebrow}</p>
    <h2 id={`${id}-title`} className="hp-h2">{title}</h2>
    {lede && <p className="hp-lede">{lede}</p>}
  </div>
}

/* ------------------------------------------------------------ the study loop */


export function StudyLoopSection() {
  const t = useSiteText
  // Steps can be edited, added, hidden or reordered in the Live Site Editor. A step without its
  // own text uses the registry copy for its position (public.loop.step_N.body) as shipped.
  const steps = stringRecords(useBlockProps().steps, ['step', 'link', 'body']) ?? DEFAULT_LOOP_STEPS
  const LOOP_STEPS = steps
  return <section id="why-stracker" className="hp-section" aria-labelledby="why-stracker-title" {...useBlockAttrs()}>
    <div className="hp-shell">
      <SectionHead id="why-stracker" eyebrow={t('public.loop.eyebrow')} title={t('public.loop.title')} lede={t('public.loop.lede')} />
      <ol className="hp-loop">
        {LOOP_STEPS.map((item, index) => <li className={`hp-loop-step hp-tone-${tone(index)}`} key={`${index}-${item.step}`} data-reveal="" style={{ ['--d' as string]: `${index * 60}ms` }}>
          <span className="hp-loop-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <h3>{item.step}</h3>
          <p data-se-prop={`steps.${index}.body`}>{item.body || t(`public.loop.step_${index + 1}.body`)}</p>
          {item.link && <span className="hp-loop-chip">{item.link}</span>}
          <span className="hp-loop-arrow" aria-hidden="true">{index < LOOP_STEPS.length - 1 ? '→' : '↻'}</span>
        </li>)}
      </ol>
      <p className="hp-footnote" data-reveal=""><Repeat2 size={15} aria-hidden="true" /> {t('public.loop.footnote')}</p>
    </div>
  </section>
}

/* ----------------------------------------------------------------- features */

/** Fixed icon map for owner-selectable feature icons (see FEATURE_ICON_OPTIONS in the registry). */
const FEATURE_ICONS: Record<string, ReactNode> = {
  'book-open': <BookOpen size={20} />, 'list-checks': <ListChecks size={20} />, 'notebook-pen': <NotebookPen size={20} />,
  'alarm-clock': <AlarmClock size={20} />, 'calendar-check': <CalendarCheck size={20} />, timer: <Timer size={20} />,
  'trending-up': <TrendingUp size={20} />, sparkles: <Sparkles size={20} />, target: <Target size={20} />,
  'shield-check': <ShieldCheck size={20} />, compass: <Compass size={20} />, repeat: <Repeat2 size={20} />
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']


export function FeatureSection() {
  const [expanded, setExpanded] = useState(false)
  const t = useSiteText
  const order = useFeatureOrder()
  const collapsible = order.length > 4

  return <section id="features" className="hp-section hp-section-band" aria-labelledby="features-title" {...useBlockAttrs()}>
    <span className="hp-doodle hp-doodle-features" data-px="12" aria-hidden="true">✎</span>
    <div className="hp-shell">
      <SectionHead id="features" eyebrow={t('public.features.eyebrow')} title={t('public.features.title')} lede={t('public.features.lede')} />
      <ol id="feature-list" className={`hp-features${expanded ? ' is-expanded' : ''}`}>
        {order.map((n, index) => {
          const icon = FEATURE_ICONS[t(`public.features.item_${n}.icon`)] ?? <Sparkles size={20} />
          const image = t(`public.features.item_${n}.image`)
          return <li className={`hp-feature hp-tone-${tone(index)}${image ? ' has-image' : ''}`} key={n} data-reveal="">
            {image && <img className="hp-feature-image" src={image} alt={t(`public.features.item_${n}.title`)} loading="lazy" decoding="async" width={640} height={360} />}
            <div className="hp-feature-head">
              <span className="hp-feature-icon" aria-hidden="true">{icon}</span>
              <span className="hp-feature-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <h3>{t(`public.features.item_${n}.title`)}</h3>
            <p>{t(`public.features.item_${n}.summary`)}</p>
            <ul className="hp-feature-points">
              {lines(t(`public.features.item_${n}.points`)).map(point => <li key={point}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{point}</span></li>)}
            </ul>
          </li>
        })}
      </ol>
      <div className="hp-features-foot">
        {collapsible && <button
          className="hp-btn hp-btn-secondary hp-feature-toggle"
          type="button"
          aria-controls="feature-list"
          aria-expanded={expanded}
          aria-label={expanded ? 'Show fewer features' : `See all ${NUMBER_WORDS[order.length] ?? order.length} Stracker features`}
          onClick={() => setExpanded(value => !value)}
        >
          <span>{expanded ? 'Show fewer features' : 'See all features'}</span>
          {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
        </button>}
        <p className="hp-footnote"><span aria-hidden="true">✎</span> {t('public.features.footnote')}</p>
      </div>
    </div>
  </section>
}

/* -------------------------------------------------------- product principle */

const PRINCIPLE_COUNT = fieldDefinition('public.principles.order')?.itemCount ?? 6
const PRINCIPLE_ICONS: Record<string, ReactNode> = {
  'book-open': <BookOpen size={15} />, 'list-checks': <ListChecks size={15} />, 'notebook-pen': <NotebookPen size={15} />,
  'alarm-clock': <AlarmClock size={15} />, 'calendar-check': <CalendarCheck size={15} />, timer: <Timer size={15} />,
  'trending-up': <TrendingUp size={15} />, sparkles: <Sparkles size={15} />, target: <Target size={15} />,
  'shield-check': <ShieldCheck size={15} />, compass: <Compass size={15} />, repeat: <Repeat2 size={15} />
}

export function PrincipleSection() {
  const t = useSiteText
  const principleOrder = parseOrder(t('public.principles.order'), PRINCIPLE_COUNT)
    ?? Array.from({ length: Math.min(6, PRINCIPLE_COUNT) }, (_, index) => index + 1)
  return <section className="hp-section" aria-labelledby="principle-title" {...useBlockAttrs()}>
    <div className="hp-shell hp-principles">
      <div className="hp-principles-copy" data-reveal="">
        <p className="hp-eyebrow"><span aria-hidden="true">✎</span> {t('public.principles.eyebrow')}</p>
        <h2 id="principle-title" className="hp-h2">{t('public.principles.title')}</h2>
        <p className="hp-lede">{t('public.principles.body')}</p>
        <p className="hp-note-card"><Compass size={16} aria-hidden="true" /> <span>{t('public.principles.note')}</span></p>
      </div>
      <ul className="hp-principle-list">
        {principleOrder.map((n, index) => <li key={n} className={`hp-tone-${tone(index)}`} data-reveal="">
          <span className="hp-principle-tick" aria-hidden="true">{PRINCIPLE_ICONS[t(`public.principles.item_${n}.icon`)] ?? <Check size={15} strokeWidth={3} />}</span>
          <div><strong>{t(`public.principles.item_${n}.title`)}</strong><p>{t(`public.principles.item_${n}.body`)}</p></div>
        </li>)}
      </ul>
    </div>
  </section>
}

/* -------------------------------------------------------------- how it works */

const HOW_STEP_INDEXES = [1, 2, 3, 4]

export function HowItWorksSection() {
  const t = useSiteText
  return <section id="how-it-works" className="hp-section hp-section-band" aria-labelledby="how-it-works-title" {...useBlockAttrs()}>
    <div className="hp-shell hp-shell-narrow">
      <SectionHead id="how-it-works" eyebrow={t('public.how.eyebrow')} title={t('public.how.title')} lede={t('public.how.lede')} center />
      <div className="hp-steps">
        <span className="hp-steps-line" aria-hidden="true"><span className="hp-steps-fill" /></span>
        <ol className="hp-step-list">
        {HOW_STEP_INDEXES.map((n, index) => <li className={`hp-step hp-tone-${tone(index)}`} key={n} data-reveal="">
          <span className="hp-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="hp-step-copy">
            <h3>{t(`public.how.step_${n}.title`)}</h3>
            <p>{t(`public.how.step_${n}.body`)}</p>
          </div>
          <span className="hp-step-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
        </li>)}
        </ol>
      </div>
    </div>
  </section>
}

/* --------------------------------------------------------------- AI section */

type ChatStage = 'static' | 'idle' | 'ask' | 'typing' | 'answer'

/** Plays question → typing dots → answer once the example scrolls into view. */
function useChatSequence() {
  const ref = useRef<HTMLElement>(null)
  const [stage, setStage] = useState<ChatStage>('static')
  useEffect(() => {
    const node = ref.current
    if (!node || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return undefined
    setStage('idle')
    const timers: number[] = []
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      setStage('ask')
      timers.push(window.setTimeout(() => setStage('typing'), 650))
      timers.push(window.setTimeout(() => setStage('answer'), 1900))
    }, { threshold: .45 })
    observer.observe(node)
    return () => { observer.disconnect(); timers.forEach(id => window.clearTimeout(id)) }
  }, [])
  return [ref, stage] as const
}

/** The example exchange is illustrative product copy, not owner content: it stays in code. */
export function AiSection() {
  const t = useSiteText
  const [exampleRef, stage] = useChatSequence()
  return <section id="ai" className="hp-section hp-section-ai" aria-labelledby="ai-title" {...useBlockAttrs()}>
    <div className="hp-shell hp-ai">
      <div className="hp-ai-copy" data-reveal="">
        <p className="hp-eyebrow"><span aria-hidden="true">✎</span> {t('public.ai.eyebrow')}</p>
        <h2 id="ai-title" className="hp-h2">{t('public.ai.title')}</h2>
        <p className="hp-lede">{t('public.ai.lede')}</p>
        <dl className="hp-ai-facts">
          {[1, 2, 3, 4].map(n => <div key={n} className={`hp-tone-${tone(n - 1)}`}>
            <dt>{t(`public.ai.fact_${n}.term`)}</dt>
            <dd>{t(`public.ai.fact_${n}.body`)}</dd>
          </div>)}
        </dl>
        <div className="hp-cta-row">
          <SiteLink className="hp-btn hp-btn-secondary" href="/login">{t('public.ai.cta.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
          <span className="hp-cta-note">{t('public.ai.cta.note')}</span>
        </div>
      </div>
      <aside className={`hp-chat is-${stage}`} aria-labelledby="ai-example-title" ref={exampleRef}>
        <span className="hp-tape hp-tape-blue" aria-hidden="true" />
        <p className="hp-chat-label" id="ai-example-title"><Sparkles size={13} aria-hidden="true" /> Illustrative exchange · not real student data</p>
        <div className="hp-chat-thread">
          <p className="hp-bubble hp-bubble-ask"><span className="visually-hidden">Example question: </span>“Which topics are pulling my recent mock scores down?”</p>
          <span className="hp-typing" aria-hidden="true"><i /><i /><i /></span>
          <p className="hp-bubble hp-bubble-answer"><span className="visually-hidden">Example answer: </span>“Two tested chapters sit below your weak threshold: <strong>Probability (48%)</strong> and <strong>Reading comprehension (52%)</strong>. Both have mistakes logged as concept errors, and one revision is due today.”</p>
        </div>
        <p className="hp-chat-note"><Shield size={13} aria-hidden="true" /> An example of the kind of answer supported tools produce from your own figures — not a transcript of anyone&rsquo;s data.</p>
      </aside>
    </div>
  </section>
}

/* ------------------------------------------------------------- privacy */

export function PrivacySection() {
  const t = useSiteText
  return <section id="privacy" className="hp-section hp-section-band" aria-labelledby="privacy-title" {...useBlockAttrs()}>
    <div className="hp-shell">
      <SectionHead id="privacy" eyebrow={t('public.privacy.eyebrow')} title={t('public.privacy.title')} lede={t('public.privacy.lede')} />
      <div className="hp-privacy" data-reveal="">
        <dl className="hp-privacy-list">
          {[1, 2, 3, 4, 5, 6].map(n => <div key={n}>
            <dt><span className="hp-privacy-icon" aria-hidden="true"><ShieldCheck size={16} /></span> {t(`public.privacy.item_${n}.title`)}</dt>
            <dd>{t(`public.privacy.item_${n}.body`)}</dd>
          </div>)}
        </dl>
        <p className="hp-privacy-foot"><LockKeyhole size={15} aria-hidden="true" /> {t('public.privacy.foot')}</p>
      </div>
    </div>
  </section>
}

/* ----------------------------------------------------------- DYPOL LABS */

export function DypolSection() {
  const t = useSiteText
  return <section id="dypol-labs" className="hp-section hp-section-tight" aria-labelledby="dypol-title" {...useBlockAttrs()}>
    <div className="hp-shell">
      <div className="hp-dypol" data-reveal="">
        <div className="dypol-mark" aria-hidden="true"><span>S</span><i>✎</i></div>
        <div className="hp-dypol-copy">
          <h2 id="dypol-title">{t('public.dypol.title')}</h2>
          <p>{t('public.dypol.body')}</p>
        </div>
        <span className="hp-dypol-tag">{t('public.dypol.tag')}</span>
      </div>
    </div>
  </section>
}

/* -------------------------------------------------------------- final CTA */

export function FinalCta() {
  const t = useSiteText
  return <section className="hp-section" aria-labelledby="final-title" {...useBlockAttrs()}>
    <div className="hp-shell hp-shell-narrow">
      <div className="hp-final" data-reveal="">
        <span className="hp-tape hp-tape-top" aria-hidden="true" />
        <span className="hp-final-doodle" aria-hidden="true">✎</span>
        <p className="hp-eyebrow"><span aria-hidden="true">✎</span> {t('public.final.eyebrow')}</p>
        <h2 id="final-title" className="hp-h2 hp-final-title">{t('public.final.title')} <em className="hp-highlight">{t('public.final.title_emphasis')}</em></h2>
        <p className="hp-lede">{t('public.final.body')}</p>
        <div className="hp-cta-row hp-cta-row-center">
          <SiteLink className="hp-btn hp-btn-primary hp-btn-lg" href={t('public.final.cta_primary.href')}>{t('public.final.cta_primary.label')} <ArrowRight size={17} aria-hidden="true" /></SiteLink>
          <SiteLink className="hp-btn hp-btn-secondary hp-btn-lg" href={t('public.final.cta_secondary.href')}>{t('public.final.cta_secondary.label')}</SiteLink>
        </div>
        <p className="hp-final-note"><Target size={14} aria-hidden="true" /> {t('public.final.note')}</p>
      </div>
    </div>
  </section>
}

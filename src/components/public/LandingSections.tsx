import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlarmClock, ArrowRight, BookOpen, CalendarCheck, Check, ChevronDown, ChevronUp, Compass,
  ListChecks, LockKeyhole, NotebookPen, Repeat2, Shield, ShieldCheck, Sparkles, Target,
  TrendingUp, Timer
} from 'lucide-react'
import { SYLLABUS } from '../../lib/syllabus'

const CHAPTER_COUNT = Object.values(SYLLABUS).reduce((sum, chapters) => sum + chapters.length, 0)

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

const LOOP = [
  {
    step: 'Learn',
    body: 'Work the syllabus chapter by chapter, keeping notes and formula notes on the same page as the status.',
    link: 'Syllabus notebook'
  },
  {
    step: 'Test',
    body: 'Log the chapter test, subject test, mock or PYQ session while the paper is still in front of you.',
    link: 'Test journal'
  },
  {
    step: 'Analyse',
    body: 'Read the marks, the error mix and the chapter signals instead of guessing where the score went.',
    link: 'Analytics'
  },
  {
    step: 'Revise',
    body: 'Let the intervals and the due desk bring each chapter back — including the ones that keep slipping.',
    link: 'Revision desk'
  },
  {
    step: 'Repeat',
    body: 'Fold the result into tomorrow’s tasks and this week’s goals, then start the next cycle.',
    link: 'Planner + Focus'
  }
]

export function StudyLoopSection() {
  return <SectionShell
    id="why-stracker"
    eyebrow="BUILT FOR SERIOUS JEE PREPARATION"
    title="A study loop built on evidence."
    lede="Stracker is organised around the loop you already study in. Each pass through it leaves a record, and that record is what the next decision is made from."
  >
    <ol className="loop-list">
      {LOOP.map((item, index) => <li className="loop-step" key={item.step}>
        <div className="loop-step-card">
          <span className="loop-step-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <h3>{item.step}</h3>
          <p>{item.body}</p>
          <span className="loop-step-link">{item.link}</span>
        </div>
        {index < LOOP.length - 1
          ? <span className="loop-arrow" aria-hidden="true">→</span>
          : <span className="loop-arrow loop-arrow-repeat" aria-hidden="true">↻</span>}
      </li>)}
    </ol>
    <p className="loop-footnote"><Repeat2 size={15} aria-hidden="true" /> The loop repeats all year. Nothing you log is thrown away — it is what the next revision and the next plan are built from.</p>
  </SectionShell>
}

/* ----------------------------------------------------------------- features */

type Feature = { title: string; icon: ReactNode; summary: string; points: string[] }

const FEATURES: Feature[] = [
  {
    title: 'Syllabus Notebook',
    icon: <BookOpen size={19} />,
    summary: 'The whole JEE 2027 topic list, kept like a real register.',
    points: [
      `Editable Physics, Chemistry and Maths chapters from the seeded ${CHAPTER_COUNT}-chapter grouping`,
      'Status and priority for each chapter: Not Started, Studying, Done or Revised',
      'Chapter notes, formula notes, search and custom ordering in one place'
    ]
  },
  {
    title: 'Test Journal',
    icon: <ListChecks size={19} />,
    summary: 'Every paper you write, recorded while it is still fresh.',
    points: [
      'Chapter tests, subject tests, full mocks and PYQ practice in one journal',
      'Marks with correct, wrong and skipped counts',
      'Chapter or subject breakdowns, filters and sorting across test history'
    ]
  },
  {
    title: 'Mistake + Retry Notebook',
    icon: <NotebookPen size={19} />,
    summary: 'Where a wrong answer turns into a fixed one.',
    points: [
      'File each mistake against its chapter and error type',
      'Keep solution notes and an optional private question photo',
      'Pending and retried states verify that the fix really stuck'
    ]
  },
  {
    title: 'Revision System',
    icon: <AlarmClock size={19} />,
    summary: 'Spaced revision that you configure once and follow.',
    points: [
      'Configurable intervals, with 1, 7 and 30 days ready to use',
      'A due-and-overdue desk keeps chapters from disappearing',
      'Completing a revision schedules the next one and keeps notes linked'
    ]
  },
  {
    title: 'Daily Planning + Goals',
    icon: <CalendarCheck size={19} />,
    summary: 'A finishable daily plan connected to the syllabus.',
    points: [
      'Dated tasks with subject, chapter, time estimate and priority',
      'Reorder tasks as the day changes shape',
      'Weekly goals and progress filled by the work you record'
    ]
  },
  {
    title: 'Focus Sessions',
    icon: <Timer size={19} />,
    summary: 'A timer that keeps the sitting honest and counts the day.',
    points: [
      'Pomodoro, breaks and custom focus blocks',
      'The timer survives notebook navigation and refreshes',
      'Sessions link to your subject and chapter and feed study-time goals'
    ]
  },
  {
    title: 'Analytics',
    icon: <TrendingUp size={19} />,
    summary: 'What the record says, with the working shown.',
    points: [
      'Subject signals measured against your own weak and strong thresholds',
      'Chapter and test trends instead of one flattering number',
      'Study time, mistake types, weak chapters and untested chapters in view'
    ]
  },
  {
    title: 'AI Assistant',
    icon: <Sparkles size={19} />,
    summary: 'Optional, and always on your own provider account.',
    points: [
      'Bring your own key for Gemini, OpenAI, Anthropic, DeepSeek, Qwen or compatible endpoints',
      'Ask questions grounded in your syllabus, tests, mistakes, revisions and analytics',
      'Writes are previewed first; credentials stay server-side and AI can stay switched off'
    ]
  }
]

export function FeatureSection() {
  const [expanded, setExpanded] = useState(false)

  return <SectionShell
    id="features"
    eyebrow="INSIDE THE NOTEBOOK"
    title="One notebook. Eight working parts."
    lede="Nothing here is a widget. Each part is a page you will open every week of your preparation."
  >
    <ol id="feature-list" className={`feature-list ${expanded ? 'is-expanded' : ''}`}>
      {FEATURES.map((feature, index) => <li className="feature-entry" key={feature.title}>
        <div className="feature-entry-head">
          <span className="feature-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
          <div>
            <h3>{feature.title}</h3>
            <p>{feature.summary}</p>
          </div>
        </div>
        <ul className="feature-points">
          {feature.points.map(point => <li key={point}><Check size={13} strokeWidth={3} aria-hidden="true" /> <span>{point}</span></li>)}
        </ul>
      </li>)}
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
      <span aria-hidden="true">✎</span> Also in the notebook: JSON backup and restore, CSV test history, PDF and DOCX reports, a private mistake-image bucket, and an installable app that caches the shell for offline use.
    </p>
  </SectionShell>
}

/* -------------------------------------------------------- product principle */

const PRINCIPLES = [
  { title: 'One place for the work', body: 'Syllabus, tests, mistakes, revision, planning and focus sessions in the same notebook — not five apps and a paper register.' },
  { title: 'A status you can state', body: 'Every chapter is Not Started, Studying, Done or Revised, so “where am I?” has an actual answer.' },
  { title: 'Tests become performance data', body: 'A paper is broken down by subject, chapter and error type instead of becoming a number you feel bad about.' },
  { title: 'Mistakes become revision material', body: 'Each mistake stays filed against its chapter and returns in the retry list until it is genuinely fixed.' },
  { title: 'Planning tied to the syllabus', body: 'Tasks point at real chapters, so the day’s list and the long-term syllabus are never two separate stories.' },
  { title: 'Signals instead of vibes', body: 'Thresholds, trends and untested chapters are computed from what you recorded — and shown even when the news is bad.' }
]

export function PrincipleSection() {
  return <section className="pub-section pub-section-principle" aria-labelledby="principle-title">
    <div className="pub-shell">
      <div className="principle-spread">
        <div className="principle-copy">
          <p className="pub-eyebrow"><span aria-hidden="true">✎</span> WHY NOT A GENERIC APP</p>
          <h2 id="principle-title">A JEE system, not a generic app.</h2>
          <p>A todo list has no opinion about rotation, revision intervals, or the difference between a silly mistake and a concept gap. Stracker is built around JEE preparation itself — the syllabus, the test cycle, the mistakes, and the revision that holds it together.</p>
          <p className="principle-note"><Compass size={15} aria-hidden="true" /> <span>Fewer places to look, and a clearer idea of what to do next.</span></p>
        </div>
        <ul className="principle-list">
          {PRINCIPLES.map(item => <li key={item.title}>
            <span className="principle-tick" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
            <div><strong>{item.title}</strong><p>{item.body}</p></div>
          </li>)}
        </ul>
      </div>
    </div>
  </section>
}

/* -------------------------------------------------------------- how it works */

const STEPS = [
  { title: 'Set up your preparation', body: 'Start from the seeded syllabus: set your exam dates and daily goal, mark what you have already covered, and put the first chapters in order.' },
  { title: 'Study and record', body: 'Run focus sessions, tick off the day’s tasks, log every test with its marks and counts, and file the mistakes that cost you.' },
  { title: 'Analyse', body: 'Open the analytics page and the due desk: subject signals, chapter trends, error types and the chapters sitting below your threshold.' },
  { title: 'Improve', body: 'Revise what is due, retry the mistakes, and let that decide tomorrow’s tasks and this week’s goals. Then run the loop again.' }
]

export function HowItWorksSection() {
  return <SectionShell
    id="how-it-works"
    eyebrow="HOW IT WORKS"
    title="Four steps, repeated all year."
    lede="This is the whole method. There is nothing to configure beyond your own syllabus and your own dates."
    tone="plain"
  >
    <ol className="step-list">
      {STEPS.map((step, index) => <li className="step-entry" key={step.title}>
        <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="step-copy">
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </div>
        <span className="step-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      </li>)}
    </ol>
  </SectionShell>
}

/* --------------------------------------------------------------- AI section */

export function AiSection() {
  return <section id="ai" className="pub-section pub-section-ai" aria-labelledby="ai-title">
    <div className="pub-shell">
      <div className="ai-spread">
        <div className="ai-copy">
          <p className="pub-eyebrow"><span aria-hidden="true">✎</span> STRACKER AI</p>
          <h2 id="ai-title">AI that reads your notebook.</h2>
          <p className="pub-lede">Stracker AI is a second pair of eyes on the data you already keep. It is optional, it runs on your own provider account, and it never changes anything without your confirmation.</p>
          <dl className="ai-facts">
            <div>
              <dt>Your key, your provider</dt>
              <dd>Connect Gemini, OpenAI, Anthropic, DeepSeek, Qwen, or any OpenAI- or Anthropic-compatible endpoint with your own API credentials. DYPOL does not supply or proxy a model key, so provider usage is billed by your provider, not by us.</dd>
            </div>
            <div>
              <dt>Handled server-side</dt>
              <dd>A saved key goes straight to the Stracker backend, where it is stored as authenticated AES-256-GCM ciphertext. It is never returned to the browser and never appears anywhere on this page.</dd>
            </div>
            <div>
              <dt>Grounded in your notebook</dt>
              <dd>Supported tools read your own syllabus, tests, mistakes, revisions and analytics, and answer with those figures. Writes — including deletes — are previewed first and applied only after you confirm.</dd>
            </div>
            <div>
              <dt>Entirely optional</dt>
              <dd>Everything else in Stracker works with AI switched off. Stracker AI needs an internet connection and the deployed backend, and it is not available in the device-only local preview.</dd>
            </div>
          </dl>
          <div className="pub-cta-row">
            <Link className="button button-secondary button-lg" to="/login">Explore Stracker AI <ArrowRight size={17} aria-hidden="true" /></Link>
            <span className="pub-cta-note">Sign in, then open <strong>Settings → AI Assistant</strong> to connect a provider.</span>
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

const PRIVACY_POINTS = [
  { title: 'Account-scoped data', body: 'Every notebook table is tied to your signed-in account, and row-level security policies in Postgres allow only that account to read or change its own rows.' },
  { title: 'Authenticated access', body: 'The browser holds only the public Supabase key. No policy grants the anonymous role access to study data — a signed-in session is required.' },
  { title: 'Private study records', body: 'There is no public profile, feed, share link or leaderboard. Your chapters, tests, mistakes and results are never published anywhere.' },
  { title: 'Private mistake images', body: 'Question photos live in a private storage bucket whose policies require the owner’s user ID in the path, and are served through signed, expiring links.' },
  { title: 'Server-side AI credentials', body: 'AI provider keys are encrypted with AES-256-GCM before storage, kept in the backend only, and never sent back to the browser.' },
  { title: 'Yours to take with you', body: 'Backups export the whole notebook as JSON, and test history as CSV, whenever you want it — no lock-in and no export paywall.' }
]

export function PrivacySection() {
  return <SectionShell
    id="privacy"
    eyebrow="PRIVACY & SECURITY"
    title="Your preparation stays yours."
    lede="Stracker keeps personal academic records, so the access boundary is boring on purpose: your account, your rows, nothing shared."
  >
    <div className="privacy-board">
      <dl className="privacy-list">
        {PRIVACY_POINTS.map(point => <div key={point.title}>
          <dt><ShieldCheck size={15} aria-hidden="true" /> {point.title}</dt>
          <dd>{point.body}</dd>
        </div>)}
      </dl>
      <p className="privacy-foot">
        <LockKeyhole size={14} aria-hidden="true" /> Not a claim about encryption we do not have: the notebook loads no advertising or third-party tracking scripts, and the only key in the browser is the public one.
      </p>
    </div>
  </SectionShell>
}

/* ----------------------------------------------------------- DYPOL LABS */

export function DypolSection() {
  return <section id="dypol-labs" className="pub-section pub-section-dypol" aria-labelledby="dypol-title">
    <div className="pub-shell">
      <div className="dypol-band">
        <div className="dypol-mark" aria-hidden="true"><span>S</span><i>✎</i></div>
        <div>
          <h2 id="dypol-title">Stracker by DYPOL LABS</h2>
          <p>Stracker is a DYPOL LABS product. We build practical tools for serious learners — software that does one job properly, stays quiet while you work, and keeps your data where it belongs.</p>
        </div>
        <span className="dypol-tag">A DYPOL LABS STUDY TOOL</span>
      </div>
    </div>
  </section>
}

/* -------------------------------------------------------------- final CTA */

export function FinalCta() {
  return <section className="pub-section pub-final" aria-labelledby="final-title">
    <div className="pub-shell">
      <div className="final-sheet">
        <span className="final-tape" aria-hidden="true" />
        <p className="pub-eyebrow"><span aria-hidden="true">✎</span> LAST PAGE, FIRST ENTRY</p>
        <h2 id="final-title">Build a system you can <em>actually follow.</em></h2>
        <p>Start organizing your JEE preparation with Stracker. Set your exam dates, work through the syllabus, log the next test — and let the notebook keep the record from there.</p>
        <div className="pub-cta-row pub-cta-row-center">
          <Link className="button button-primary button-lg" to="/signup">Create your Stracker account <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="button button-secondary button-lg" to="/login">I already have an account</Link>
        </div>
        <p className="final-note"><Target size={14} aria-hidden="true" /> Your notebook starts with the seeded JEE 2027 syllabus, which you can edit, reorder or replace. Set your own dates and daily goal, and the plan follows from there.</p>
        <span className="final-doodle" aria-hidden="true">✎</span>
      </div>
    </div>
  </section>
}

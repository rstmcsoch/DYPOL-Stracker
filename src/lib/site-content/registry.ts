import { SYLLABUS } from '../syllabus.js'

/**
 * Registry of owner-editable website and user-panel copy.
 *
 * Every editable item has a stable key (`<area>.<page>.<section>.<item>`), a human label,
 * the place it appears, a field type and its default. The defaults are the copy that shipped
 * before this registry existed, so a site with no saved configuration renders unchanged.
 *
 * Only text-like values are registered. Structure (which sections exist, their order, the
 * route behind a navigation item, the access rule behind a route, the chart and metric
 * calculations) is deliberately NOT here: it stays in code and is system-controlled.
 *
 * This module is shared by the browser (public site, user panel, Control Center editor)
 * and by the Vercel functions that validate owner writes. Keep it free of browser and
 * Node-only APIs.
 */

export type ContentArea = 'public' | 'user'

export type FieldType = 'text' | 'multiline' | 'link' | 'select'

/** One allowed value of a `select` field and the words the editor shows for it. */
export interface FieldOption {
  value: string
  label: string
}

export interface FieldDefinition {
  key: string
  area: ContentArea
  /** Human-readable page name shown in the editor, e.g. "Homepage". */
  page: string
  /** Human-readable section name, e.g. "Hero". */
  section: string
  /** Human-readable name of the item, e.g. "Primary button label". */
  label: string
  help?: string
  type: FieldType
  defaultValue: string
  maxLength: number
  /** Allowed values for `select` fields; any other value is rejected. */
  options?: readonly FieldOption[]
}

/** Bump when the stored shape or the meaning of a key changes; stored rows carry it. */
export const SITE_CONTENT_SCHEMA_VERSION = 1

/** Internal destinations an owner may choose for a link. Routes are the public routes only. */
export const INTERNAL_ROUTE_TARGETS = ['/', '/login', '/signup', '/reset-password'] as const

/** In-page anchors that exist on the homepage. A link may only point at one of these. */
export const HOMEPAGE_ANCHOR_TARGETS = [
  '#top', '#why-stracker', '#features', '#how-it-works', '#ai', '#privacy', '#dypol-labs'
] as const

const CHAPTER_COUNT = Object.values(SYLLABUS).reduce((sum, chapters) => sum + chapters.length, 0)

const fields: FieldDefinition[] = []

function field(
  area: ContentArea,
  page: string,
  section: string,
  key: string,
  label: string,
  type: FieldType,
  defaultValue: string,
  options: { help?: string; maxLength?: number; options?: readonly FieldOption[] } = {}
) {
  const maxLength = options.maxLength ?? (type === 'multiline' ? 600 : type === 'link' ? 500 : 160)
  if (type === 'select' && !options.options?.some(option => option.value === defaultValue)) {
    throw new Error(`Select field ${key} needs options that include its default.`)
  }
  fields.push({ key, area, page, section, label, type, defaultValue, maxLength, help: options.help, ...(options.options ? { options: options.options } : {}) })
}

/* ------------------------------------------------------------------ public site */

const HOME = 'Homepage'
const PUBLIC_SEO = 'Page & search'

field('public', PUBLIC_SEO, 'Document', 'public.meta.title', 'Browser tab title', 'text',
  'Stracker by DYPOL LABS — a serious JEE 2027 study notebook', { maxLength: 120, help: 'Shown in the browser tab and search results.' })
field('public', PUBLIC_SEO, 'Document', 'public.meta.description', 'Meta description', 'multiline',
  'Stracker by DYPOL LABS is a digital study notebook for JEE preparation: syllabus tracking, test journal, mistakes and retries, spaced revision, daily planning, focus sessions and analytics.',
  { maxLength: 300, help: 'Used by search engines and link previews.' })

field('public', 'Header', 'Navigation', 'public.header.features.label', 'Section link: Features', 'text', 'Features', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.how.label', 'Section link: How It Works', 'text', 'How It Works', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.ai.label', 'Section link: AI Assistant', 'text', 'AI Assistant', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.privacy.label', 'Section link: Privacy', 'text', 'Privacy', { maxLength: 40 })
field('public', 'Header', 'Account buttons', 'public.header.login.label', 'Log in button', 'text', 'Log In', { maxLength: 30 })
field('public', 'Header', 'Account buttons', 'public.header.signup.label', 'Sign up button', 'text', 'Sign Up', { maxLength: 30 })

field('public', HOME, 'Hero', 'public.hero.eyebrow', 'Eyebrow line', 'text', 'JEE 2027 · A DIGITAL STUDY NOTEBOOK', { maxLength: 90 })
field('public', HOME, 'Hero', 'public.hero.title', 'Heading (first part)', 'text', 'Your JEE preparation, organized in', { maxLength: 120, help: 'The main heading is this text followed by the emphasised part below.' })
field('public', HOME, 'Hero', 'public.hero.title_emphasis', 'Heading (emphasised part)', 'text', 'one serious study notebook.', { maxLength: 80 })
field('public', HOME, 'Hero', 'public.hero.lede', 'Introduction', 'multiline',
  'Stracker keeps the syllabus, the tests, the mistakes, the revision queue, the daily plan, focus sessions and the analytics on the same page — then stays quiet while you actually study.')
field('public', HOME, 'Hero', 'public.hero.pillars', 'Highlight chips (one per line)', 'multiline', 'Syllabus\nTests\nMistakes\nRevision\nAnalytics', { maxLength: 300 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.label', 'Primary button label', 'text', 'Start with Stracker', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Hero', 'public.hero.cta_secondary.label', 'Secondary button label', 'text', 'Log In', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Hero', 'public.hero.scroll.label', 'Scroll link label', 'text', 'Explore how it works', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.meta', 'Footnote line', 'text', 'Private to your account · Works on phone, tablet and desktop · Installable', { maxLength: 160 })

field('public', HOME, 'Study loop', 'public.loop.eyebrow', 'Eyebrow line', 'text', 'BUILT FOR SERIOUS JEE PREPARATION', { maxLength: 90 })
field('public', HOME, 'Study loop', 'public.loop.title', 'Heading', 'text', 'A study loop built on evidence.', { maxLength: 120 })
field('public', HOME, 'Study loop', 'public.loop.lede', 'Introduction', 'multiline', 'Stracker is organised around the loop you already study in. Each pass through it leaves a record, and that record is what the next decision is made from.')
const LOOP_BODIES = [
  'Work the syllabus chapter by chapter, keeping notes and formula notes on the same page as the status.',
  'Log the chapter test, subject test, mock or PYQ session while the paper is still in front of you.',
  'Read the marks, the error mix and the chapter signals instead of guessing where the score went.',
  'Let the intervals and the due desk bring each chapter back — including the ones that keep slipping.',
  'Fold the result into tomorrow’s tasks and this week’s goals, then start the next cycle.'
]
LOOP_BODIES.forEach((body, index) => field('public', HOME, 'Study loop', `public.loop.step_${index + 1}.body`, `Step ${index + 1} description`, 'multiline', body))
field('public', HOME, 'Study loop', 'public.loop.footnote', 'Footnote', 'multiline', 'The loop repeats all year. Nothing you log is thrown away — it is what the next revision and the next plan are built from.')

field('public', HOME, 'Features', 'public.features.eyebrow', 'Eyebrow line', 'text', 'INSIDE THE NOTEBOOK', { maxLength: 90 })
field('public', HOME, 'Features', 'public.features.title', 'Heading', 'text', 'One notebook. Eight working parts.', { maxLength: 120 })
field('public', HOME, 'Features', 'public.features.lede', 'Introduction', 'multiline', 'Nothing here is a widget. Each part is a page you will open every week of your preparation.')
field('public', HOME, 'Features', 'public.features.footnote', 'Footnote', 'multiline', 'Also in the notebook: JSON backup and restore, CSV test history, PDF and DOCX reports, a private mistake-image bucket, and an installable app that caches the shell for offline use.')

const FEATURES: Array<{ title: string; summary: string; points: string[] }> = [
  {
    title: 'Syllabus Notebook',
    summary: 'The whole JEE 2027 topic list, kept like a real register.',
    points: [
      `Editable Physics, Chemistry and Maths chapters from the seeded ${CHAPTER_COUNT}-chapter grouping`,
      'Status and priority for each chapter: Not Started, Studying, Done or Revised',
      'Chapter notes, formula notes, search and custom ordering in one place'
    ]
  },
  {
    title: 'Test Journal',
    summary: 'Every paper you write, recorded while it is still fresh.',
    points: [
      'Chapter tests, subject tests, full mocks and PYQ practice in one journal',
      'Marks with correct, wrong and skipped counts',
      'Chapter or subject breakdowns, filters and sorting across test history'
    ]
  },
  {
    title: 'Mistake + Retry Notebook',
    summary: 'Where a wrong answer turns into a fixed one.',
    points: [
      'File each mistake against its chapter and error type',
      'Keep solution notes and an optional private question photo',
      'Pending and retried states verify that the fix really stuck'
    ]
  },
  {
    title: 'Revision System',
    summary: 'Spaced revision that you configure once and follow.',
    points: [
      'Configurable intervals, with 1, 7 and 30 days ready to use',
      'A due-and-overdue desk keeps chapters from disappearing',
      'Completing a revision schedules the next one and keeps notes linked'
    ]
  },
  {
    title: 'Daily Planning + Goals',
    summary: 'A finishable daily plan connected to the syllabus.',
    points: [
      'Dated tasks with subject, chapter, time estimate and priority',
      'Reorder tasks as the day changes shape',
      'Weekly goals and progress filled by the work you record'
    ]
  },
  {
    title: 'Focus Sessions',
    summary: 'A timer that keeps the sitting honest and counts the day.',
    points: [
      'Pomodoro, breaks and custom focus blocks',
      'The timer survives notebook navigation and refreshes',
      'Sessions link to your subject and chapter and feed study-time goals'
    ]
  },
  {
    title: 'Analytics',
    summary: 'What the record says, with the working shown.',
    points: [
      'Subject signals measured against your own weak and strong thresholds',
      'Chapter and test trends instead of one flattering number',
      'Study time, mistake types, weak chapters and untested chapters in view'
    ]
  },
  {
    title: 'AI Assistant',
    summary: 'Optional, and always on your own provider account.',
    points: [
      'Bring your own key for Gemini, OpenAI, Anthropic, DeepSeek, Qwen or compatible endpoints',
      'Ask questions grounded in your syllabus, tests, mistakes, revisions and analytics',
      'Writes are previewed first; credentials stay server-side and AI can stay switched off'
    ]
  }
]
FEATURES.forEach((feature, index) => {
  const n = index + 1
  const section = `Feature cards · ${String(n).padStart(2, '0')}`
  field('public', HOME, section, `public.features.item_${n}.title`, 'Card title', 'text', feature.title, { maxLength: 60 })
  field('public', HOME, section, `public.features.item_${n}.summary`, 'Card summary', 'multiline', feature.summary, { maxLength: 200 })
  field('public', HOME, section, `public.features.item_${n}.points`, 'Card points (one per line)', 'multiline', feature.points.join('\n'), { maxLength: 1000 })
})

field('public', HOME, 'Principles', 'public.principles.eyebrow', 'Eyebrow line', 'text', 'WHY NOT A GENERIC APP', { maxLength: 90 })
field('public', HOME, 'Principles', 'public.principles.title', 'Heading', 'text', 'A JEE system, not a generic app.', { maxLength: 120 })
field('public', HOME, 'Principles', 'public.principles.body', 'Paragraph', 'multiline', 'A todo list has no opinion about rotation, revision intervals, or the difference between a silly mistake and a concept gap. Stracker is built around JEE preparation itself — the syllabus, the test cycle, the mistakes, and the revision that holds it together.')
field('public', HOME, 'Principles', 'public.principles.note', 'Closing note', 'text', 'Fewer places to look, and a clearer idea of what to do next.', { maxLength: 200 })
const PRINCIPLES: Array<[string, string]> = [
  ['One place for the work', 'Syllabus, tests, mistakes, revision, planning and focus sessions in the same notebook — not five apps and a paper register.'],
  ['A status you can state', 'Every chapter is Not Started, Studying, Done or Revised, so “where am I?” has an actual answer.'],
  ['Tests become performance data', 'A paper is broken down by subject, chapter and error type instead of becoming a number you feel bad about.'],
  ['Mistakes become revision material', 'Each mistake stays filed against its chapter and returns in the retry list until it is genuinely fixed.'],
  ['Planning tied to the syllabus', 'Tasks point at real chapters, so the day’s list and the long-term syllabus are never two separate stories.'],
  ['Signals instead of vibes', 'Thresholds, trends and untested chapters are computed from what you recorded — and shown even when the news is bad.']
]
PRINCIPLES.forEach(([title, body], index) => {
  const section = `Principle cards · ${index + 1}`
  field('public', HOME, section, `public.principles.item_${index + 1}.title`, 'Item title', 'text', title, { maxLength: 80 })
  field('public', HOME, section, `public.principles.item_${index + 1}.body`, 'Item description', 'multiline', body, { maxLength: 300 })
})

field('public', HOME, 'How it works', 'public.how.eyebrow', 'Eyebrow line', 'text', 'HOW IT WORKS', { maxLength: 90 })
field('public', HOME, 'How it works', 'public.how.title', 'Heading', 'text', 'Four steps, repeated all year.', { maxLength: 120 })
field('public', HOME, 'How it works', 'public.how.lede', 'Introduction', 'multiline', 'This is the whole method. There is nothing to configure beyond your own syllabus and your own dates.')
const STEPS: Array<[string, string]> = [
  ['Set up your preparation', 'Start from the seeded syllabus: set your exam dates and daily goal, mark what you have already covered, and put the first chapters in order.'],
  ['Study and record', 'Run focus sessions, tick off the day’s tasks, log every test with its marks and counts, and file the mistakes that cost you.'],
  ['Analyse', 'Open the analytics page and the due desk: subject signals, chapter trends, error types and the chapters sitting below your threshold.'],
  ['Improve', 'Revise what is due, retry the mistakes, and let that decide tomorrow’s tasks and this week’s goals. Then run the loop again.']
]
STEPS.forEach(([title, body], index) => {
  const section = `Steps · ${index + 1}`
  field('public', HOME, section, `public.how.step_${index + 1}.title`, 'Step title', 'text', title, { maxLength: 80 })
  field('public', HOME, section, `public.how.step_${index + 1}.body`, 'Step description', 'multiline', body, { maxLength: 300 })
})

field('public', HOME, 'Stracker AI', 'public.ai.eyebrow', 'Eyebrow line', 'text', 'STRACKER AI', { maxLength: 90 })
field('public', HOME, 'Stracker AI', 'public.ai.title', 'Heading', 'text', 'AI that reads your notebook.', { maxLength: 120 })
field('public', HOME, 'Stracker AI', 'public.ai.lede', 'Introduction', 'multiline', 'Stracker AI is a second pair of eyes on the data you already keep. It is optional, it runs on your own provider account, and it never changes anything without your confirmation.')
const AI_FACTS: Array<[string, string]> = [
  ['Your key, your provider', 'Connect Gemini, OpenAI, Anthropic, DeepSeek, Qwen, or any OpenAI- or Anthropic-compatible endpoint with your own API credentials. DYPOL does not supply or proxy a model key, so provider usage is billed by your provider, not by us.'],
  ['Handled server-side', 'A saved key goes straight to the Stracker backend, where it is stored as authenticated AES-256-GCM ciphertext. It is never returned to the browser and never appears anywhere on this page.'],
  ['Grounded in your notebook', 'Supported tools read your own syllabus, tests, mistakes, revisions and analytics, and answer with those figures. Writes — including deletes — are previewed first and applied only after you confirm.'],
  ['Entirely optional', 'Everything else in Stracker works with AI switched off. Stracker AI needs an internet connection and the deployed backend, and it is not available in the device-only local preview.']
]
AI_FACTS.forEach(([term, body], index) => {
  const section = `Facts · ${index + 1}`
  field('public', HOME, section, `public.ai.fact_${index + 1}.term`, 'Term', 'text', term, { maxLength: 80 })
  field('public', HOME, section, `public.ai.fact_${index + 1}.body`, 'Description', 'multiline', body, { maxLength: 400 })
})
field('public', HOME, 'Stracker AI', 'public.ai.cta.label', 'Button label', 'text', 'Explore Stracker AI', { maxLength: 60 })
field('public', HOME, 'Stracker AI', 'public.ai.cta.note', 'Note beside the button', 'text', 'Sign in, then open Settings → AI Assistant to connect a provider.', { maxLength: 200 })

field('public', HOME, 'Privacy', 'public.privacy.eyebrow', 'Eyebrow line', 'text', 'PRIVACY & SECURITY', { maxLength: 90 })
field('public', HOME, 'Privacy', 'public.privacy.title', 'Heading', 'text', 'Your preparation stays yours.', { maxLength: 120 })
field('public', HOME, 'Privacy', 'public.privacy.lede', 'Introduction', 'multiline', 'Stracker keeps personal academic records, so the access boundary is boring on purpose: your account, your rows, nothing shared.')
const PRIVACY: Array<[string, string]> = [
  ['Account-scoped data', 'Every notebook table is tied to your signed-in account, and row-level security policies in Postgres allow only that account to read or change its own rows.'],
  ['Authenticated access', 'The browser holds only the public Supabase key. No policy grants the anonymous role access to study data — a signed-in session is required.'],
  ['Private study records', 'There is no public profile, feed, share link or leaderboard. Your chapters, tests, mistakes and results are never published anywhere.'],
  ['Private mistake images', 'Question photos live in a private storage bucket whose policies require the owner’s user ID in the path, and are served through signed, expiring links.'],
  ['Server-side AI credentials', 'AI provider keys are encrypted with AES-256-GCM before storage, kept in the backend only, and never sent back to the browser.'],
  ['Yours to take with you', 'Backups export the whole notebook as JSON, and test history as CSV, whenever you want it — no lock-in and no export paywall.']
]
PRIVACY.forEach(([title, body], index) => {
  const section = `Privacy points · ${index + 1}`
  field('public', HOME, section, `public.privacy.item_${index + 1}.title`, 'Item title', 'text', title, { maxLength: 80 })
  field('public', HOME, section, `public.privacy.item_${index + 1}.body`, 'Item description', 'multiline', body, { maxLength: 400 })
})
field('public', HOME, 'Privacy', 'public.privacy.foot', 'Footnote', 'multiline', 'Not a claim about encryption we do not have: the notebook loads no advertising or third-party tracking scripts, and the only key in the browser is the public one.')

field('public', HOME, 'DYPOL LABS', 'public.dypol.title', 'Heading', 'text', 'Stracker by DYPOL LABS', { maxLength: 120 })
field('public', HOME, 'DYPOL LABS', 'public.dypol.body', 'Paragraph', 'multiline', 'Stracker is a DYPOL LABS product. We build practical tools for serious learners — software that does one job properly, stays quiet while you work, and keeps your data where it belongs.')
field('public', HOME, 'DYPOL LABS', 'public.dypol.tag', 'Tag', 'text', 'A DYPOL LABS STUDY TOOL', { maxLength: 60 })

field('public', HOME, 'Final call to action', 'public.final.eyebrow', 'Eyebrow line', 'text', 'LAST PAGE, FIRST ENTRY', { maxLength: 90 })
field('public', HOME, 'Final call to action', 'public.final.title', 'Heading (first part)', 'text', 'Build a system you can', { maxLength: 120 })
field('public', HOME, 'Final call to action', 'public.final.title_emphasis', 'Heading (emphasised part)', 'text', 'actually follow.', { maxLength: 80 })
field('public', HOME, 'Final call to action', 'public.final.body', 'Paragraph', 'multiline', 'Start organizing your JEE preparation with Stracker. Set your exam dates, work through the syllabus, log the next test — and let the notebook keep the record from there.')
field('public', HOME, 'Final call to action', 'public.final.cta_primary.label', 'Primary button label', 'text', 'Create your Stracker account', { maxLength: 60 })
field('public', HOME, 'Final call to action', 'public.final.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Final call to action', 'public.final.cta_secondary.label', 'Secondary button label', 'text', 'I already have an account', { maxLength: 60 })
field('public', HOME, 'Final call to action', 'public.final.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Final call to action', 'public.final.note', 'Note', 'multiline', 'Your notebook starts with the seeded JEE 2027 syllabus, which you can edit, reorder or replace. Set your own dates and daily goal, and the plan follows from there.')

field('public', 'Footer', 'Brand', 'public.footer.tagline', 'Tagline', 'text', 'A focused digital study notebook for JEE preparation.', { maxLength: 160 })
field('public', 'Footer', 'Brand', 'public.footer.copyright', 'Copyright line (after the year)', 'text', 'DYPOL LABS · Stracker for JEE 2027', { maxLength: 120, help: 'The year is added automatically: “© 2026 …”.' })
field('public', 'Footer', 'Column headings', 'public.footer.group_product.title', 'Column heading: Product', 'text', 'Product', { maxLength: 40 })
field('public', 'Footer', 'Column headings', 'public.footer.group_account.title', 'Column heading: Account', 'text', 'Account', { maxLength: 40 })
field('public', 'Footer', 'Column headings', 'public.footer.group_information.title', 'Column heading: Information', 'text', 'Information', { maxLength: 40 })
field('public', 'Footer', 'Column headings', 'public.footer.group_brand.title', 'Column heading: Brand', 'text', 'Brand', { maxLength: 40 })

/* Promotional video section. Layout values are presets so no choice can break the page. */
const PROMO = 'Promotional video'
field('public', HOME, PROMO, 'public.promo.visibility', 'Show the video section', 'select', 'show', {
  options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }],
  help: 'Hiding removes the whole section; nothing is downloaded.'
})
field('public', HOME, PROMO, 'public.promo.heading_visibility', 'Visible heading', 'select', 'hidden', {
  options: [{ value: 'hidden', label: 'Hidden (screen readers only)' }, { value: 'visible', label: 'Show eyebrow, heading and text' }]
})
field('public', HOME, PROMO, 'public.promo.eyebrow', 'Eyebrow line', 'text', 'SEE IT IN MOTION', { maxLength: 60 })
field('public', HOME, PROMO, 'public.promo.heading', 'Heading', 'text', 'Stracker in motion — a ten second product preview', { maxLength: 120 })
field('public', HOME, PROMO, 'public.promo.body', 'Supporting text', 'multiline', 'A quick look at the notebook: plan the day, log a test and see what to revise next.', { maxLength: 300 })
field('public', HOME, PROMO, 'public.promo.size', 'Player size', 'select', 'medium', {
  options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium (default)' }, { value: 'large', label: 'Large' }],
  help: 'Scales the player within the screen height; it never overflows the page width.'
})
field('public', HOME, PROMO, 'public.promo.aspect', 'Frame shape', 'select', '9:16', {
  options: [{ value: '9:16', label: 'Portrait 9:16 (matches the current video)' }, { value: '4:5', label: 'Portrait 4:5' }, { value: '1:1', label: 'Square 1:1' }, { value: '16:9', label: 'Landscape 16:9' }],
  help: 'Shapes other than the video\'s own crop its edges.'
})
field('public', HOME, PROMO, 'public.promo.position', 'Position on wide screens', 'select', 'center', {
  options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
  help: 'Phones and tablets always centre the player.'
})
field('public', 'Footer', 'Links', 'public.footer.features.label', 'Link label: Features', 'text', 'Features', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.ai.label', 'Link label: AI Assistant', 'text', 'AI Assistant', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.how.label', 'Link label: How It Works', 'text', 'How It Works', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.login.label', 'Link label: Log In', 'text', 'Log In', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.signup.label', 'Link label: Sign Up', 'text', 'Sign Up', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.reset.label', 'Link label: Reset password', 'text', 'Reset password', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.privacy.label', 'Link label: Privacy', 'text', 'Privacy', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.study.label', 'Link label: Study system', 'text', 'Study system', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.dypol.label', 'Link label: DYPOL LABS', 'text', 'DYPOL LABS', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.top.label', 'Link label: Back to top', 'text', 'Back to top', { maxLength: 40 })

/* ------------------------------------------------------------- user panel */

/**
 * Navigation items of the signed-in notebook. The key names the label only; the route,
 * icon, grouping and access rule stay in AppShell and cannot be changed from the editor.
 */
export const USER_NAV_ITEMS: ReadonlyArray<{ slug: string; to: string; label: string }> = [
  { slug: 'home', to: '/', label: 'Home' },
  { slug: 'focus', to: '/focus', label: 'Focus' },
  { slug: 'backlog', to: '/backlog', label: 'Backlog' },
  { slug: 'practice', to: '/practice', label: 'Practice' },
  { slug: 'syllabus', to: '/syllabus', label: 'Syllabus' },
  { slug: 'weak-areas', to: '/weak-areas', label: 'Weak areas' },
  { slug: 'pyqs', to: '/pyqs', label: 'PYQs' },
  { slug: 'tests', to: '/tests', label: 'Tests & mocks' },
  { slug: 'mock-analysis', to: '/mock-analysis', label: 'Mock analysis' },
  { slug: 'mistakes', to: '/mistakes', label: 'Mistake notebook' },
  { slug: 'retry', to: '/retry', label: 'Retry' },
  { slug: 'analytics', to: '/analytics', label: 'Analytics' },
  { slug: 'revision', to: '/revision', label: 'Revisions' },
  { slug: 'decks', to: '/decks', label: 'Formulas & flashcards' },
  { slug: 'study-now', to: '/study-now', label: 'Study now' },
  { slug: 'planner', to: '/planner', label: 'Study plan' },
  { slug: 'backup', to: '/backup', label: 'Export & backup' },
  { slug: 'settings', to: '/settings', label: 'Settings' }
]

export const USER_NAV_GROUP_CAPTIONS: ReadonlyArray<{ slug: string; caption: string }> = [
  { slug: 'study', caption: 'STUDY' },
  { slug: 'syllabus', caption: 'SYLLABUS' },
  { slug: 'tests', caption: 'TESTS' },
  { slug: 'revision', caption: 'REVISION' },
  { slug: 'planning', caption: 'PLANNING' },
  { slug: 'keep-going', caption: 'KEEP GOING' }
]

const NAV = 'Navigation'
for (const item of USER_NAV_ITEMS) {
  field('user', NAV, 'Items', `user.nav.${item.slug}.label`, `Label: ${item.label} (${item.to})`, 'text', item.label, { maxLength: 40, help: 'Changes the wording only. The destination and access rule are fixed.' })
}
for (const group of USER_NAV_GROUP_CAPTIONS) {
  field('user', NAV, 'Group headings', `user.nav.group.${group.slug}.label`, `Group heading: ${group.caption.toLowerCase()}`, 'text', group.caption, { maxLength: 30 })
}

/** Every editable item, in editor order. */
export const SITE_CONTENT_FIELDS: readonly FieldDefinition[] = Object.freeze(fields.slice())

const FIELD_INDEX = new Map(SITE_CONTENT_FIELDS.map(definition => [definition.key, definition]))

/** Defaults for every editable key: what the site shows with no saved configuration. */
export const SITE_CONTENT_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SITE_CONTENT_FIELDS.map(definition => [definition.key, definition.defaultValue]))
)

export function fieldDefinition(key: string): FieldDefinition | undefined {
  return FIELD_INDEX.get(key)
}

export function isEditableKey(key: string): boolean {
  return FIELD_INDEX.has(key)
}

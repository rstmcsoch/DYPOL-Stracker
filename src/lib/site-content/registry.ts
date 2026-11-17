import { DEFAULT_ABOUT_BODY, DEFAULT_PRIVACY_BODY, DEFAULT_TERMS_BODY } from './info-page-defaults.js'

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

export type FieldType = 'text' | 'multiline' | 'link' | 'select' | 'order' | 'media'

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
  /** `order` fields: how many numbered items exist (1…itemCount). */
  itemCount?: number
  /** `order` fields: minimum number of items that must stay visible. */
  minItems?: number
  /** `order` fields: key template naming each item, with `{n}` for its number. */
  itemLabelKey?: string
  /** `media` fields: the built-in file (default) or an upload of this kind from the homepage-media bucket. */
  mediaKind?: 'image' | 'video'
  /**
   * `media` image fields whose default is empty: the image is optional and can be removed.
   * `link` fields whose default is empty: the link stays hidden until the owner sets an address.
   */
  optional?: boolean
}

/** Bump when the stored shape or the meaning of a key changes; stored rows carry it. */
export const SITE_CONTENT_SCHEMA_VERSION = 1

/** Internal destinations an owner may choose for a link. Routes are the public routes only. */
export const INTERNAL_ROUTE_TARGETS = ['/', '/login', '/signup', '/reset-password', '/privacy', '/terms', '/about', '/contact'] as const

/** In-page anchors that exist on the homepage. A link may only point at one of these. */
export const HOMEPAGE_ANCHOR_TARGETS = [
  '#top', '#why-stracker', '#features', '#how-it-works', '#ai', '#privacy', '#dypol-labs'
] as const

const fields: FieldDefinition[] = []

function field(
  area: ContentArea,
  page: string,
  section: string,
  key: string,
  label: string,
  type: FieldType,
  defaultValue: string,
  options: { help?: string; maxLength?: number; options?: readonly FieldOption[]; itemCount?: number; minItems?: number; itemLabelKey?: string; mediaKind?: 'image' | 'video'; optional?: boolean } = {}
) {
  const maxLength = options.maxLength ?? (type === 'multiline' ? 600 : type === 'link' ? 500 : 160)
  if (type === 'select' && !options.options?.some(option => option.value === defaultValue)) {
    throw new Error(`Select field ${key} needs options that include its default.`)
  }
  if (type === 'order' && !(options.itemCount && options.itemCount > 0)) throw new Error(`Order field ${key} needs an itemCount.`)
  fields.push({
    key, area, page, section, label, type, defaultValue, maxLength, help: options.help,
    ...(options.options ? { options: options.options } : {}),
    ...(type === 'order' ? { itemCount: options.itemCount, minItems: options.minItems ?? 1, itemLabelKey: options.itemLabelKey } : {}),
    ...(type === 'media' ? { mediaKind: options.mediaKind ?? 'image', ...(options.optional ? { optional: true } : {}) } : {}),
    ...((type === 'link' || type === 'multiline') && options.optional ? { optional: true } : {})
  })
}

/* ------------------------------------------------------------------ public site */

const HOME = 'Homepage'
const PUBLIC_SEO = 'Page & search'

field('public', PUBLIC_SEO, 'Document', 'public.meta.title', 'Browser tab title', 'text',
  'Stracker by DYPOL LABS — a serious exam study notebook', { maxLength: 120, help: 'Shown in the browser tab and search results.' })
field('public', PUBLIC_SEO, 'Document', 'public.meta.description', 'Meta description', 'multiline',
  'Stracker is a digital study notebook for exam prep: syllabus, tests, mistakes, revision, planning, focus and analytics.',
  { maxLength: 300, help: 'Used by search engines and link previews.' })

field('public', 'Header', 'Navigation', 'public.header.features.label', 'Section link: Features', 'text', 'Features', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.how.label', 'Section link: Study Loop', 'text', 'Study Loop', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.ai.label', 'Section link: AI Assistant', 'text', 'AI Assistant', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.privacy.label', 'Section link: Privacy', 'text', 'Privacy', { maxLength: 40 })
field('public', 'Header', 'Account buttons', 'public.header.login.label', 'Log in button', 'text', 'Log In', { maxLength: 30 })
field('public', 'Header', 'Account buttons', 'public.header.signup.label', 'Sign up button', 'text', 'Sign Up', { maxLength: 30 })

field('public', HOME, 'Hero', 'public.hero.eyebrow', 'Eyebrow line', 'text', 'A DIGITAL STUDY NOTEBOOK FOR EXAM PREP', { maxLength: 90 })
field('public', HOME, 'Hero', 'public.hero.title', 'Heading (first part)', 'text', 'Your exam prep, all in', { maxLength: 120, help: 'The main heading is this text followed by the emphasised part below.' })
field('public', HOME, 'Hero', 'public.hero.title_emphasis', 'Heading (emphasised part)', 'text', 'one place.', { maxLength: 80 })
field('public', HOME, 'Hero', 'public.hero.lede', 'Introduction', 'multiline',
  'Plan your study, track tests, fix mistakes and know what to revise.')
field('public', HOME, 'Hero', 'public.hero.image', 'Hero image (optional)', 'media', '', {
  mediaKind: 'image', optional: true, maxLength: 300,
  help: 'Replaces the notebook illustration beside the heading. Leave empty to keep the illustration.'
})
field('public', HOME, 'Hero', 'public.hero.image_alt', 'Hero image description', 'text', 'Stracker study notebook on a laptop', { maxLength: 140, help: 'Read aloud by screen readers when a hero image is set.' })
field('public', HOME, 'Hero', 'public.hero.pillars', 'Highlight chips (one per line)', 'multiline', 'Syllabus\nTests\nMistakes\nRevision\nAnalytics', {
  maxLength: 300, help: 'No longer shown: the hero chips were removed in the November 2026 refresh. Kept so saved text is not lost.'
})
field('public', HOME, 'Hero', 'public.hero.cta_primary.label', 'Primary button label', 'text', 'Start with Stracker', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Hero', 'public.hero.cta_secondary.label', 'Secondary button label', 'text', 'Log In', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Hero', 'public.hero.scroll.label', 'Scroll link label', 'text', 'See the study loop', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.meta', 'Footnote line', 'text', 'Private to your account · Phone, tablet and desktop', { maxLength: 160 })

field('public', HOME, 'Study loop', 'public.loop.eyebrow', 'Eyebrow line', 'text', 'THE STUDY LOOP', { maxLength: 90 })
field('public', HOME, 'Study loop', 'public.loop.title', 'Heading', 'text', 'One simple loop, all year.', { maxLength: 120 })
field('public', HOME, 'Study loop', 'public.loop.lede', 'Introduction', 'multiline', 'Each step feeds the next, so you always know what to do.')
const LOOP_BODIES = [
  'Study chapter by chapter and keep your notes.',
  'Log every test while it’s fresh.',
  'See where you lost marks and why.',
  'Revise each chapter when it’s due.',
  'Plan tomorrow and start again.'
]
LOOP_BODIES.forEach((body, index) => field('public', HOME, 'Study loop', `public.loop.step_${index + 1}.body`, `Step ${index + 1} description`, 'multiline', body))
field('public', HOME, 'Study loop', 'public.loop.footnote', 'Footnote', 'multiline', 'Repeat it all year. Nothing you log is wasted.')

field('public', HOME, 'Features', 'public.features.eyebrow', 'Eyebrow line', 'text', 'INSIDE THE NOTEBOOK', { maxLength: 90 })
field('public', HOME, 'Features', 'public.features.title', 'Heading', 'text', 'Everything you need in one notebook.', { maxLength: 120 })
field('public', HOME, 'Features', 'public.features.lede', 'Introduction', 'multiline', 'Simple tools you’ll use every week of your prep.')
field('public', HOME, 'Features', 'public.features.footnote', 'Footnote', 'multiline', 'Also: backups, PDF and CSV reports, and an app that works offline.')

const FEATURES: Array<{ title: string; summary: string; points: string[] }> = [
  { title: 'Syllabus Notebook', summary: 'Organise your subjects, chapters and notes.', points: [
    'Subjects come from your exam',
    'Add chapters, or start with JEE’s list',
    'Track status, priority, notes and formulas'
  ] },
  { title: 'Test Journal', summary: 'Record tests and track your results.', points: [
    'Log mocks, chapter tests and PYQs',
    'Record marks and question counts',
    'Review subject and chapter performance'
  ] },
  { title: 'Mistake + Retry Notebook', summary: 'Learn from mistakes and stop repeating them.', points: [
    'Save mistakes by chapter',
    'Add solutions and question photos',
    'Retry until you get them right'
  ] },
  { title: 'Revision System', summary: 'Know what to revise and when.', points: [
    'Set your own revision intervals',
    'See due and overdue chapters',
    'Next revision is scheduled for you'
  ] },
  { title: 'Daily Planning + Goals', summary: 'Plan your day and track your progress.', points: [
    'Create tasks linked to chapters',
    'Set daily and weekly goals',
    'Reorder tasks anytime'
  ] },
  { title: 'Focus Sessions', summary: 'Stay focused and track your study time.', points: [
    'Pomodoro or custom timers',
    'Keeps running while you move around',
    'Link sessions to subjects and chapters'
  ] },
  { title: 'Analytics', summary: 'See what’s working and what needs attention.', points: [
    'Track subject and chapter trends',
    'Find weak and untested chapters',
    'Review study time and mistakes'
  ] },
  { title: 'AI Assistant', summary: 'Ask questions about your study records.', points: [
    'Built-in AI with a daily limit',
    'Or connect your own AI key',
    'Review changes before they’re saved'
  ] }
]
/** Icons an owner may pick for a feature card (lucide names; rendered from a fixed map). */
export const FEATURE_ICON_OPTIONS: readonly FieldOption[] = [
  { value: 'book-open', label: 'Open book' },
  { value: 'list-checks', label: 'Checklist' },
  { value: 'notebook-pen', label: 'Notebook' },
  { value: 'alarm-clock', label: 'Alarm clock' },
  { value: 'calendar-check', label: 'Calendar' },
  { value: 'timer', label: 'Timer' },
  { value: 'trending-up', label: 'Trend' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'target', label: 'Target' },
  { value: 'shield-check', label: 'Shield' },
  { value: 'compass', label: 'Compass' },
  { value: 'repeat', label: 'Repeat' }
]
const FEATURE_DEFAULT_ICONS = ['book-open', 'list-checks', 'notebook-pen', 'alarm-clock', 'calendar-check', 'timer', 'trending-up', 'sparkles']

/** Feature cards beyond the shipped eight start hidden; showing one "adds" it to the homepage. */
export const MAX_FEATURE_CARDS = 12
const NEW_FEATURE = { title: 'New feature', summary: 'Describe what this feature does for a student.', points: ['First point'] }
const FEATURE_SLOTS = Array.from({ length: MAX_FEATURE_CARDS }, (_, index) => FEATURES[index] ?? NEW_FEATURE)

field('public', HOME, 'Feature cards', 'public.features.order', 'Card order and visibility', 'order', FEATURES.map((_, index) => index + 1).join(','), {
  itemCount: MAX_FEATURE_CARDS, minItems: 2, itemLabelKey: 'public.features.item_{n}.title', maxLength: 60,
  help: `Move cards up or down, hide cards, or show a hidden one to add it (up to ${MAX_FEATURE_CARDS}). Edit a new card's words in its own section below.`
})
FEATURE_SLOTS.forEach((feature, index) => {
  const n = index + 1
  const section = `Feature cards · ${String(n).padStart(2, '0')}`
  field('public', HOME, section, `public.features.item_${n}.icon`, 'Card icon', 'select', FEATURE_DEFAULT_ICONS[index] ?? 'sparkles', { options: FEATURE_ICON_OPTIONS })
  field('public', HOME, section, `public.features.item_${n}.title`, 'Card title', 'text', feature.title, { maxLength: 60 })
  field('public', HOME, section, `public.features.item_${n}.summary`, 'Card summary', 'multiline', feature.summary, { maxLength: 200 })
  field('public', HOME, section, `public.features.item_${n}.points`, 'Card points (one per line)', 'multiline', feature.points.join('\n'), { maxLength: 1000 })
  field('public', HOME, section, `public.features.item_${n}.image`, 'Card image (optional)', 'media', '', {
    mediaKind: 'image', optional: true, maxLength: 300, help: 'Shown at the top of the card, cropped to 16:9. The card title is used as its description.'
  })
})

field('public', HOME, 'Principles', 'public.principles.eyebrow', 'Eyebrow line', 'text', 'WHY NOT A GENERIC APP', { maxLength: 90 })
field('public', HOME, 'Principles', 'public.principles.title', 'Heading', 'text', 'An exam system, not a generic app.', { maxLength: 120 })
field('public', HOME, 'Principles', 'public.principles.body', 'Paragraph', 'multiline', 'A todo list can’t tell a silly mistake from a concept gap. Stracker is built around exam preparation itself: syllabus, tests, mistakes and revision.')
field('public', HOME, 'Principles', 'public.principles.note', 'Closing note', 'text', 'Fewer places to look, and a clearer idea of what to do next.', { maxLength: 200 })
const PRINCIPLES: Array<[string, string]> = [
  ['One place for the work', 'Syllabus, tests, mistakes, revision, planning and focus sessions in the same notebook — not five apps and a paper register.'],
  ['A status you can state', 'Every chapter is Not Started, Studying, Done or Revised, so “where am I?” has an actual answer.'],
  ['Tests become performance data', 'A paper is broken down by subject, chapter and error type instead of becoming a number you feel bad about.'],
  ['Mistakes become revision material', 'Each mistake stays filed against its chapter and returns in the retry list until it is genuinely fixed.'],
  ['Planning tied to the syllabus', 'Tasks point at real chapters, so the day’s list and the long-term syllabus are never two separate stories.'],
  ['Signals instead of vibes', 'Thresholds, trends and untested chapters are computed from what you recorded — and shown even when the news is bad.']
]
/** Principle items beyond the shipped six start hidden; showing one adds it. */
export const MAX_PRINCIPLE_CARDS = 8
export const PRINCIPLE_ICON_OPTIONS: readonly FieldOption[] = [{ value: 'check', label: 'Tick (default)' }, ...FEATURE_ICON_OPTIONS]
field('public', HOME, 'Principle cards', 'public.principles.order', 'Item order and visibility', 'order', PRINCIPLES.map((_, index) => index + 1).join(','), {
  itemCount: MAX_PRINCIPLE_CARDS, minItems: 2, itemLabelKey: 'public.principles.item_{n}.title', maxLength: 40,
  help: `Move items up or down, hide items, or show a hidden one to add it (up to ${MAX_PRINCIPLE_CARDS}).`
})
const PRINCIPLE_SLOTS: Array<[string, string]> = Array.from({ length: MAX_PRINCIPLE_CARDS }, (_, index) => PRINCIPLES[index] ?? ['New principle', 'Describe this principle in a sentence or two.'])
PRINCIPLE_SLOTS.forEach(([title, body], index) => {
  const section = `Principle cards · ${index + 1}`
  field('public', HOME, section, `public.principles.item_${index + 1}.title`, 'Item title', 'text', title, { maxLength: 80 })
  field('public', HOME, section, `public.principles.item_${index + 1}.body`, 'Item description', 'multiline', body, { maxLength: 300 })
  field('public', HOME, section, `public.principles.item_${index + 1}.icon`, 'Item icon', 'select', 'check', { options: PRINCIPLE_ICON_OPTIONS })
})

field('public', HOME, 'How it works', 'public.how.eyebrow', 'Eyebrow line', 'text', 'HOW IT WORKS', { maxLength: 90 })
field('public', HOME, 'How it works', 'public.how.title', 'Heading', 'text', 'Four steps, repeated all year.', { maxLength: 120 })
field('public', HOME, 'How it works', 'public.how.lede', 'Introduction', 'multiline', 'This is the whole method, whichever exam you are preparing for. There is nothing to configure beyond your own syllabus and your own dates.')
const STEPS: Array<[string, string]> = [
  ['Set up your preparation', 'Pick the exam you are preparing for, set your dates and daily goal, then organise your subjects, topics and chapters and mark what you have already covered.'],
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
field('public', HOME, 'Stracker AI', 'public.ai.lede', 'Introduction', 'multiline', 'Ask about your progress. Nothing changes without your OK.')
const AI_FACTS: Array<[string, string]> = [
  ['Your AI, your choice', 'Use built-in AI with a daily limit, or add your own key.'],
  ['Understands your notebook', 'Ask about your tests, mistakes, revisions and progress.'],
  ['You stay in control', 'Review every change before it’s saved.'],
  ['Completely optional', 'Every other feature works without AI.']
]
AI_FACTS.forEach(([term, body], index) => {
  const section = `Facts · ${index + 1}`
  field('public', HOME, section, `public.ai.fact_${index + 1}.term`, 'Term', 'text', term, { maxLength: 80 })
  field('public', HOME, section, `public.ai.fact_${index + 1}.body`, 'Description', 'multiline', body, { maxLength: 400 })
})
field('public', HOME, 'Stracker AI', 'public.ai.cta.label', 'Button label', 'text', 'Explore Stracker AI', { maxLength: 60 })
field('public', HOME, 'Stracker AI', 'public.ai.cta.note', 'Note beside the button', 'text', 'Works with Gemini, OpenAI, Anthropic and more. Your provider bills your key.', { maxLength: 200 })

field('public', HOME, 'Privacy', 'public.privacy.eyebrow', 'Eyebrow line', 'text', 'PRIVACY & SECURITY', { maxLength: 90 })
field('public', HOME, 'Privacy', 'public.privacy.title', 'Heading', 'text', 'Your study stays private.', { maxLength: 120 })
field('public', HOME, 'Privacy', 'public.privacy.lede', 'Introduction', 'multiline', 'Your records belong to your account. Nothing is shared.')
const PRIVACY: Array<[string, string]> = [
  ['Private study records', 'Your notebook is private to your account.'],
  ['No public competition', 'No public profiles, feeds or leaderboards.'],
  ['Private question photos', 'Your saved question photos stay private.'],
  ['Protected AI keys', 'Your AI keys are encrypted and stored safely.'],
  ['Your data, your choice', 'Export your notebook whenever you need it.'],
  ['No ads', 'No ads and no third-party trackers.']
]
PRIVACY.forEach(([title, body], index) => {
  const section = `Privacy points · ${index + 1}`
  field('public', HOME, section, `public.privacy.item_${index + 1}.title`, 'Item title', 'text', title, { maxLength: 80 })
  field('public', HOME, section, `public.privacy.item_${index + 1}.body`, 'Item description', 'multiline', body, { maxLength: 400 })
})
field('public', HOME, 'Privacy', 'public.privacy.foot', 'Footnote', 'multiline', 'Want the details?')

field('public', HOME, 'DYPOL LABS', 'public.dypol.title', 'Heading', 'text', 'Stracker by DYPOL LABS', { maxLength: 120 })
field('public', HOME, 'DYPOL LABS', 'public.dypol.body', 'Paragraph', 'multiline', 'A study workspace built for serious exam preparation.')
field('public', HOME, 'DYPOL LABS', 'public.dypol.tag', 'Tag', 'text', 'A DYPOL LABS STUDY TOOL', { maxLength: 60 })

field('public', HOME, 'Final call to action', 'public.final.eyebrow', 'Eyebrow line', 'text', 'LAST PAGE, FIRST ENTRY', { maxLength: 90 })
field('public', HOME, 'Final call to action', 'public.final.title', 'Heading (first part)', 'text', 'Build a system you can', { maxLength: 120 })
field('public', HOME, 'Final call to action', 'public.final.title_emphasis', 'Heading (emphasised part)', 'text', 'actually follow.', { maxLength: 80 })
field('public', HOME, 'Final call to action', 'public.final.body', 'Paragraph', 'multiline', 'Pick your exam and start your first page today.')
field('public', HOME, 'Final call to action', 'public.final.cta_primary.label', 'Primary button label', 'text', 'Create your Stracker account', { maxLength: 60 })
field('public', HOME, 'Final call to action', 'public.final.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Final call to action', 'public.final.cta_secondary.label', 'Secondary button label', 'text', 'I already have an account', { maxLength: 60 })
field('public', HOME, 'Final call to action', 'public.final.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Final call to action', 'public.final.note', 'Note', 'multiline', 'Choose your exam. Set your date. Start.')

field('public', 'Footer', 'Brand', 'public.footer.tagline', 'Tagline', 'text', 'A digital study notebook for exam prep.', { maxLength: 160 })
field('public', 'Footer', 'Brand', 'public.footer.copyright', 'Copyright line (after the year)', 'text', 'DYPOL LABS · Stracker', { maxLength: 120, help: 'The year is added automatically: “© 2026 …”.' })
field('public', 'Footer', 'Column headings', 'public.footer.group_product.title', 'Column heading: Product', 'text', 'Product', { maxLength: 40 })
field('public', 'Footer', 'Column headings', 'public.footer.group_account.title', 'Column heading: Account', 'text', 'Account', { maxLength: 40, help: 'No longer shown: the footer account column was removed in the November 2026 refresh.' })
field('public', 'Footer', 'Column headings', 'public.footer.group_information.title', 'Column heading: Legal', 'text', 'Legal', { maxLength: 40 })
field('public', 'Footer', 'Column headings', 'public.footer.group_brand.title', 'Column heading: Brand', 'text', 'Brand', { maxLength: 40 })

/* Public website appearance. Presets only: every accent ships tuned light and dark values. */
const LOOK = 'Appearance'
field('public', LOOK, 'Theme', 'public.appearance.default_mode', 'Default display mode', 'select', 'light', {
  options: [{ value: 'light', label: 'Light (default)' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: "Follow the visitor's device" }],
  help: 'Used until a visitor picks light or dark with the header toggle; their own choice always wins.'
})
field('public', LOOK, 'Theme', 'public.appearance.accent', 'Accent colour', 'select', 'default', {
  options: [
    { value: 'default', label: 'Stracker blue (default)' },
    { value: 'sunset-blaze', label: 'Sunset Blaze' },
    { value: 'forest-emerald', label: 'Forest Emerald' },
    { value: 'sandalwood', label: 'Sandalwood' },
    { value: 'ocean-deep', label: 'Ocean Deep' },
    { value: 'sakura-blossom', label: 'Sakura Blossom' },
    { value: 'dracula-midnight', label: 'Dracula Midnight' },
    { value: 'lavender-mist', label: 'Lavender Mist' },
    { value: 'cyberpunk-neon', label: 'Cyberpunk Neon' }
  ],
  help: 'Links, buttons and highlights on the public website. Each preset has a readable light and dark shade.'
})

field('public', LOOK, 'Typography', 'public.appearance.font', 'Website font', 'select', 'identity', {
  options: [
    { value: 'identity', label: 'Patrick Hand — handwritten (default)' },
    { value: 'lexend', label: 'Lexend' },
    { value: 'poppins', label: 'Poppins' },
    { value: 'sora', label: 'Sora' },
    { value: 'open-sans', label: 'Open Sans' }
  ],
  help: 'Bundled fonts only, so pages stay fast and nothing loads from other sites.'
})

/* Promotional video section. Layout values are presets so no choice can break the page. */
const PROMO = 'Promotional video'
field('public', HOME, PROMO, 'public.promo.visibility', 'Show the video section', 'select', 'show', {
  options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }],
  help: 'Hiding removes the whole section; nothing is downloaded.'
})
field('public', HOME, PROMO, 'public.promo.heading_visibility', 'Visible heading', 'select', 'visible', {
  options: [{ value: 'hidden', label: 'Hidden (screen readers only)' }, { value: 'visible', label: 'Show eyebrow, heading and text' }]
})
field('public', HOME, PROMO, 'public.promo.eyebrow', 'Eyebrow line', 'text', 'SEE IT IN MOTION', { maxLength: 60 })
field('public', HOME, PROMO, 'public.promo.heading', 'Heading', 'text', 'See Stracker in action.', { maxLength: 120 })
field('public', HOME, PROMO, 'public.promo.body', 'Supporting text', 'multiline', 'A quick look at your study notebook.', { maxLength: 300 })
field('public', HOME, PROMO, 'public.promo.size', 'Player size', 'select', 'medium', {
  options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium (default)' }, { value: 'large', label: 'Large' }],
  help: 'Scales the player within the screen height; it never overflows the page width.'
})
field('public', HOME, PROMO, 'public.promo.aspect', 'Frame shape', 'select', '9:16', {
  options: [{ value: '9:16', label: 'Portrait 9:16 (matches the current video)' }, { value: '4:5', label: 'Portrait 4:5' }, { value: '1:1', label: 'Square 1:1' }, { value: '16:9', label: 'Landscape 16:9' }],
  help: 'Shapes other than the video\'s own crop its edges.'
})
field('public', HOME, PROMO, 'public.promo.video_src', 'Video file', 'media', '/videos/stracker-ad1-web.mp4', {
  mediaKind: 'video', maxLength: 300,
  help: 'MP4 (H.264), ideally under 8 MB. The built-in clip stays available as a fallback.'
})
field('public', HOME, PROMO, 'public.promo.poster_src', 'Poster image', 'media', '/videos/stracker-ad1-poster.jpg', {
  mediaKind: 'image', maxLength: 300,
  help: 'Still shown before playback. JPEG, PNG or WebP under 5 MB, same shape as the video.'
})
field('public', HOME, PROMO, 'public.promo.position', 'Position on wide screens', 'select', 'center', {
  options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
  help: 'Phones and tablets always centre the player.'
})
field('public', 'Footer', 'Links', 'public.footer.features.label', 'Link label: Features', 'text', 'Features', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.ai.label', 'Link label: AI Assistant', 'text', 'AI Assistant', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.how.label', 'Link label: Study Loop', 'text', 'Study Loop', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.login.label', 'Link label: Log In', 'text', 'Log In', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.signup.label', 'Link label: Sign Up', 'text', 'Sign Up', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.reset.label', 'Link label: Reset password', 'text', 'Reset password', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.privacy.label', 'Link label: Privacy', 'text', 'Privacy', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.study.label', 'Link label: Study system', 'text', 'Study system', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.dypol.label', 'Link label: DYPOL LABS', 'text', 'DYPOL LABS', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.top.label', 'Link label: Back to top', 'text', 'Back to top', { maxLength: 40 })
// Contact: the footer Contact link opens the built-in /contact page, whose messages arrive in
// Control Center → Messages. No email address is invented; the owner may point the link at a
// real address (mailto:) or another https:// page instead.
field('public', 'Footer', 'Links', 'public.footer.contact.label', 'Link label: Contact', 'text', 'Contact', { maxLength: 40 })
field('public', 'Footer', 'Links', 'public.footer.contact.href', 'Contact link override (optional)', 'link', '', {
  optional: true, maxLength: 200,
  help: 'Leave empty to use the built-in Contact page (messages arrive in Control Center → Messages). Or use mailto: followed by one email address, or a full https:// contact page.'
})
// Information pages (/about, /terms, /privacy). They ship with text written for Stracker by
// DYPOL LABS (info-page-defaults.ts); the owner can rewrite it here. Clearing About or Terms
// hides that page; clearing Privacy shows the homepage Privacy section there instead.
const INFO_PAGE_MAX = 20000
const INFO_FORMAT_HELP = 'A blank line starts a new paragraph. Start a paragraph with "## " for a heading, or start each line with "- " for a list.'
field('public', 'Footer', 'Information pages', 'public.footer.about.label', 'Link label: About', 'text', 'About', { maxLength: 40 })
field('public', 'Footer', 'Information pages', 'public.footer.about.body', 'About page text', 'multiline', DEFAULT_ABOUT_BODY, {
  optional: true, maxLength: INFO_PAGE_MAX,
  help: `Shown at /about. Clear it to hide the About link and page. ${INFO_FORMAT_HELP}`
})
field('public', 'Footer', 'Information pages', 'public.footer.terms.label', 'Link label: Terms', 'text', 'Terms', { maxLength: 40 })
field('public', 'Footer', 'Information pages', 'public.footer.terms.body', 'Terms page text', 'multiline', DEFAULT_TERMS_BODY, {
  optional: true, maxLength: INFO_PAGE_MAX,
  help: `Shown at /terms. Clear it to hide the Terms link and page. ${INFO_FORMAT_HELP}`
})
field('public', 'Footer', 'Information pages', 'public.footer.privacy.body', 'Privacy page text', 'multiline', DEFAULT_PRIVACY_BODY, {
  optional: true, maxLength: INFO_PAGE_MAX,
  help: `Shown at /privacy. Clear it to show the homepage Privacy section there instead. ${INFO_FORMAT_HELP}`
})

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
  { slug: 'tests', to: '/tests', label: 'Tests' },
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
  { slug: 'planning', caption: 'PLANNING' }
]

const NAV = 'Navigation'
for (const item of USER_NAV_ITEMS) {
  field('user', NAV, 'Items', `user.nav.${item.slug}.label`, `Label: ${item.label} (${item.to})`, 'text', item.label, { maxLength: 40, help: 'Changes the wording only. The destination and access rule are fixed.' })
}
for (const group of USER_NAV_GROUP_CAPTIONS) {
  field('user', NAV, 'Group headings', `user.nav.group.${group.slug}.label`, `Group heading: ${group.caption.toLowerCase()}`, 'text', group.caption, { maxLength: 30 })
}

/* Student panel theme defaults: applied once, when a new student account is set up. */
const STUDENT = 'Student panel'
field('user', STUDENT, 'Theme defaults', 'user.appearance.default_mode', 'Default display mode for new students', 'select', 'light', {
  options: [{ value: 'light', label: 'Light (default)' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: "Follow the student's device" }],
  help: 'Students can still change it in Settings; existing accounts keep their choice.'
})
field('user', STUDENT, 'Theme defaults', 'user.appearance.default_color', 'Default colour theme for new students', 'select', 'default', {
  options: [
    { value: 'default', label: 'Default' },
    { value: 'sunset-blaze', label: 'Sunset Blaze' },
    { value: 'forest-emerald', label: 'Forest Emerald' },
    { value: 'sandalwood', label: 'Sandalwood' },
    { value: 'ocean-deep', label: 'Ocean Deep' },
    { value: 'sakura-blossom', label: 'Sakura Blossom' },
    { value: 'dracula-midnight', label: 'Dracula Midnight' },
    { value: 'lavender-mist', label: 'Lavender Mist' },
    { value: 'cyberpunk-neon', label: 'Cyberpunk Neon' }
  ],
  help: 'Students can still change it in Settings; existing accounts keep their choice.'
})

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

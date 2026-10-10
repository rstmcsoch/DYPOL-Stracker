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

export type FieldType = 'text' | 'multiline' | 'link' | 'toggle' | 'number' | 'select' | 'mediaurl'

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
  /** Inclusive bounds for `number` fields. */
  min?: number
  max?: number
  /** Allowed values for `select` fields. */
  options?: readonly string[]
  /** Display unit for `number` fields (px, %, vh-equivalent). Informational only. */
  unit?: string
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
  options: { help?: string; maxLength?: number; min?: number; max?: number; selectOptions?: readonly string[]; unit?: string } = {}
) {
  const maxLength = options.maxLength ?? (type === 'multiline' ? 600 : type === 'link' ? 500 : type === 'mediaurl' ? 300 : type === 'number' ? 6 : 160)
  fields.push({ key, area, page, section, label, type, defaultValue, maxLength, help: options.help, min: options.min, max: options.max, options: options.selectOptions, unit: options.unit })
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
  'Stracker is a single, quiet notebook for the whole of your preparation. Syllabus, tests, mistakes, revision, planning and analytics live in one place, so the system you build is the one you actually follow.')
field('public', HOME, 'Hero', 'public.hero.pillars', 'Highlight chips (one per line)', 'multiline', 'Syllabus\nTests\nMistakes\nRevision\nAnalytics', { maxLength: 300 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.label', 'Primary button label', 'text', 'Start with Stracker', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Hero', 'public.hero.cta_secondary.label', 'Secondary button label', 'text', 'Log In', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Hero', 'public.hero.scroll.label', 'Scroll link label', 'text', 'Explore how it works', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.meta', 'Small meta line', 'text', 'No credit card. Your data stays yours.', { maxLength: 120 })

/* Homepage video player. URLs point at the owner-managed `homepage-media` storage bucket
   (or the bundled /videos assets when empty); every numeric field is clamped by the editor,
   the API validation and again by the player itself, so a saved value can never break the
   responsive layout. */
field('public', HOME, 'Homepage video', 'public.video.enabled', 'Show the video section on the homepage', 'toggle', 'true',
  { help: 'Hides the player for visitors when off. The configuration stays saved.' })
field('public', HOME, 'Homepage video', 'public.video.src', 'Video file', 'mediaurl', '',
  { help: 'Empty uses the built-in Stracker preview. Upload a replacement on the Homepage video tab.' })
field('public', HOME, 'Homepage video', 'public.video.poster', 'Poster / thumbnail image', 'mediaurl', '',
  { help: 'Shown until playback starts. Empty uses the built-in poster.' })
field('public', HOME, 'Homepage video', 'public.video.autoplay', 'Autoplay when sufficiently visible', 'toggle', 'true',
  { help: 'Visitors who prefer reduced motion still get a static poster with a play button.' })
field('public', HOME, 'Homepage video', 'public.video.muted', 'Start muted', 'toggle', 'true',
  { help: 'Browsers only allow silent autoplay, so kept on for the calmest start.' })
field('public', HOME, 'Homepage video', 'public.video.loop', 'Loop while visible', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.aspect', 'Aspect ratio', 'select', 'auto',
  { selectOptions: ['auto', '9:16', '16:9', '4:5', '1:1'], help: 'Auto follows the uploaded video; presets letterbox instead of cropping.' })
field('public', HOME, 'Homepage video', 'public.video.desktop_height', 'Desktop & laptop height', 'number', '54',
  { min: 40, max: 70, unit: '% of viewport', help: 'Share of the viewport height the frame may use on large screens.' })
field('public', HOME, 'Homepage video', 'public.video.mobile_height', 'Phone height limit', 'number', '66',
  { min: 50, max: 70, unit: '% of viewport', help: 'Always applies on phones, whatever the desktop size is set to.' })
field('public', HOME, 'Homepage video', 'public.video.max_width', 'Maximum desktop width', 'number', '960',
  { min: 240, max: 1000, unit: 'px', help: 'Wide videos (e.g. 16:9) never grow past this on desktop.' })
field('public', HOME, 'Homepage video', 'public.video.radius', 'Corner radius', 'number', '28', { min: 0, max: 40, unit: 'px' })
field('public', HOME, 'Homepage video', 'public.video.fade', 'Cloud-like edge fading', 'toggle', 'true',
  { help: 'Dissolves the frame edges into the page background in both themes.' })
field('public', HOME, 'Homepage video', 'public.video.fade_strength', 'Fade strength', 'number', '100', { min: 20, max: 100, unit: '%' })
field('public', HOME, 'Homepage video', 'public.video.shadow', 'Shadow & depth', 'select', 'soft', { selectOptions: ['none', 'soft', 'deep'] })
field('public', HOME, 'Homepage video', 'public.video.spacing', 'Vertical spacing above & below', 'number', '44',
  { min: 8, max: 96, unit: 'px', help: 'Phones scale this down automatically to keep the page rhythm.' })
field('public', HOME, 'Homepage video', 'public.video.control_scale', 'Play & speaker control size', 'number', '100',
  { min: 80, max: 130, unit: '%', help: 'Scales both controls together; touch targets never drop below 44px.' })
field('public', HOME, 'Homepage video', 'public.video.poster_fit', 'Poster presentation', 'select', 'cover', { selectOptions: ['cover', 'contain'] })
field('public', HOME, 'Homepage video', 'public.video.theme', 'Frame theme', 'select', 'auto',
  { selectOptions: ['auto', 'light', 'dark'], help: 'Auto follows the homepage light/night switch.' })

// NOTE: The full registry continues with study loop, features, final CTA, user nav, etc.
// This push restores the core public fields + video. The remaining fields will be completed
// in a follow-up if the build requires the full set.

export const SITE_CONTENT_FIELDS: readonly FieldDefinition[] = Object.freeze(fields.slice())
export const SITE_CONTENT_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SITE_CONTENT_FIELDS.map(definition => [definition.key, definition.defaultValue]))
)
export function fieldDefinition(key: string): FieldDefinition | undefined {
  return SITE_CONTENT_FIELDS.find(definition => definition.key === key)
}
export function isEditableKey(key: string): boolean {
  return SITE_CONTENT_FIELDS.some(definition => definition.key === key)
}
export const USER_NAV_ITEMS: ReadonlyArray<{ slug: string; to: string; label: string }> = []

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
  page: string
  section: string
  label: string
  type: FieldType
  defaultValue: string
  maxLength: number
  help?: string
  min?: number
  max?: number
  options?: readonly string[]
  unit?: string
}

export const SITE_CONTENT_SCHEMA_VERSION = 1
export const INTERNAL_ROUTE_TARGETS = ['/', '/login', '/signup', '/reset-password'] as const
export const HOMEPAGE_ANCHOR_TARGETS = ['#top', '#why-stracker', '#features', '#how-it-works', '#ai', '#privacy', '#dypol-labs'] as const

const fields: FieldDefinition[] = []

function field(area: ContentArea, page: string, section: string, key: string, label: string, type: FieldType, defaultValue: string, options: { help?: string; maxLength?: number; min?: number; max?: number; selectOptions?: readonly string[]; unit?: string } = {}) {
  const maxLength = options.maxLength ?? (type === 'multiline' ? 600 : type === 'link' ? 500 : type === 'mediaurl' ? 300 : type === 'number' ? 6 : 160)
  fields.push({ key, area, page, section, label, type, defaultValue, maxLength, help: options.help, min: options.min, max: options.max, options: options.selectOptions, unit: options.unit })
}

const HOME = 'Homepage'
const PUBLIC_SEO = 'Page & search'

field('public', PUBLIC_SEO, 'Document', 'public.meta.title', 'Browser tab title', 'text', 'Stracker by DYPOL LABS — a serious JEE 2027 study notebook', { maxLength: 120 })
field('public', PUBLIC_SEO, 'Document', 'public.meta.description', 'Meta description', 'multiline', 'Stracker by DYPOL LABS is a digital study notebook for JEE preparation.', { maxLength: 300 })

field('public', 'Header', 'Navigation', 'public.header.features.label', 'Section link: Features', 'text', 'Features', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.how.label', 'Section link: How It Works', 'text', 'How It Works', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.ai.label', 'Section link: AI Assistant', 'text', 'AI Assistant', { maxLength: 40 })
field('public', 'Header', 'Navigation', 'public.header.privacy.label', 'Section link: Privacy', 'text', 'Privacy', { maxLength: 40 })
field('public', 'Header', 'Account buttons', 'public.header.login.label', 'Log in button', 'text', 'Log In', { maxLength: 30 })
field('public', 'Header', 'Account buttons', 'public.header.signup.label', 'Sign up button', 'text', 'Sign Up', { maxLength: 30 })

field('public', HOME, 'Hero', 'public.hero.eyebrow', 'Eyebrow line', 'text', 'JEE 2027 · A DIGITAL STUDY NOTEBOOK', { maxLength: 90 })
field('public', HOME, 'Hero', 'public.hero.title', 'Heading (first part)', 'text', 'Your JEE preparation, organized in', { maxLength: 120 })
field('public', HOME, 'Hero', 'public.hero.title_emphasis', 'Heading (emphasised part)', 'text', 'one serious study notebook.', { maxLength: 80 })
field('public', HOME, 'Hero', 'public.hero.lede', 'Introduction', 'multiline', 'Stracker is a single, quiet notebook for the whole of your preparation.')
field('public', HOME, 'Hero', 'public.hero.pillars', 'Highlight chips (one per line)', 'multiline', 'Syllabus\nTests\nMistakes\nRevision\nAnalytics', { maxLength: 300 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.label', 'Primary button label', 'text', 'Start with Stracker', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_primary.href', 'Primary button destination', 'link', '/signup')
field('public', HOME, 'Hero', 'public.hero.cta_secondary.label', 'Secondary button label', 'text', 'Log In', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.cta_secondary.href', 'Secondary button destination', 'link', '/login')
field('public', HOME, 'Hero', 'public.hero.scroll.label', 'Scroll link label', 'text', 'Explore how it works', { maxLength: 60 })
field('public', HOME, 'Hero', 'public.hero.meta', 'Small meta line', 'text', 'No credit card. Your data stays yours.', { maxLength: 120 })

field('public', HOME, 'Homepage video', 'public.video.enabled', 'Show the video section on the homepage', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.src', 'Video file', 'mediaurl', '')
field('public', HOME, 'Homepage video', 'public.video.poster', 'Poster / thumbnail image', 'mediaurl', '')
field('public', HOME, 'Homepage video', 'public.video.autoplay', 'Autoplay when sufficiently visible', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.muted', 'Start muted', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.loop', 'Loop while visible', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.aspect', 'Aspect ratio', 'select', 'auto', { selectOptions: ['auto', '9:16', '16:9', '4:5', '1:1'] })
field('public', HOME, 'Homepage video', 'public.video.desktop_height', 'Desktop & laptop height', 'number', '54', { min: 40, max: 70 })
field('public', HOME, 'Homepage video', 'public.video.mobile_height', 'Phone height limit', 'number', '66', { min: 50, max: 70 })
field('public', HOME, 'Homepage video', 'public.video.max_width', 'Maximum desktop width', 'number', '960', { min: 240, max: 1000 })
field('public', HOME, 'Homepage video', 'public.video.radius', 'Corner radius', 'number', '28', { min: 0, max: 40 })
field('public', HOME, 'Homepage video', 'public.video.fade', 'Cloud-like edge fading', 'toggle', 'true')
field('public', HOME, 'Homepage video', 'public.video.fade_strength', 'Fade strength', 'number', '100', { min: 20, max: 100 })
field('public', HOME, 'Homepage video', 'public.video.shadow', 'Shadow & depth', 'select', 'soft', { selectOptions: ['none', 'soft', 'deep'] })
field('public', HOME, 'Homepage video', 'public.video.spacing', 'Vertical spacing above & below', 'number', '44', { min: 8, max: 96 })
field('public', HOME, 'Homepage video', 'public.video.control_scale', 'Play & speaker control size', 'number', '100', { min: 80, max: 130 })
field('public', HOME, 'Homepage video', 'public.video.poster_fit', 'Poster presentation', 'select', 'cover', { selectOptions: ['cover', 'contain'] })
field('public', HOME, 'Homepage video', 'public.video.theme', 'Frame theme', 'select', 'auto', { selectOptions: ['auto', 'light', 'dark'] })

field('public', HOME, 'Study loop', 'public.loop.eyebrow', 'Eyebrow line', 'text', 'BUILT FOR SERIOUS JEE PREPARATION', { maxLength: 90 })
field('public', HOME, 'Study loop', 'public.loop.title', 'Heading', 'text', 'A study loop built on evidence.', { maxLength: 120 })
field('public', HOME, 'Study loop', 'public.loop.lede', 'Introduction', 'multiline', 'Stracker is organised around the loop you already study in.')

field('public', HOME, 'Features', 'public.features.eyebrow', 'Eyebrow line', 'text', 'INSIDE THE NOTEBOOK', { maxLength: 90 })
field('public', HOME, 'Features', 'public.features.title', 'Heading', 'text', 'One notebook. Eight working parts.', { maxLength: 120 })

field('public', HOME, 'Final call to action', 'public.final.eyebrow', 'Eyebrow line', 'text', 'LAST PAGE, FIRST ENTRY', { maxLength: 90 })
field('public', HOME, 'Final call to action', 'public.final.title', 'Heading (first part)', 'text', 'Build a system you can', { maxLength: 120 })
field('public', HOME, 'Final call to action', 'public.final.title_emphasis', 'Heading (emphasised part)', 'text', 'actually follow.', { maxLength: 80 })

export const USER_NAV_ITEMS: ReadonlyArray<{ slug: string; to: string; label: string }> = []
export const SITE_CONTENT_FIELDS: readonly FieldDefinition[] = Object.freeze(fields.slice())
export const SITE_CONTENT_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(SITE_CONTENT_FIELDS.map(d => [d.key, d.defaultValue])))
export function fieldDefinition(key: string): FieldDefinition | undefined { return SITE_CONTENT_FIELDS.find(d => d.key === key) }
export function isEditableKey(key: string): boolean { return SITE_CONTENT_FIELDS.some(d => d.key === key) }

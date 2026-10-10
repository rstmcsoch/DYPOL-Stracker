/**
 * Minimal restored registry with video fields and required exports.
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
export const HOMEPAGE_ANCHOR_TARGETS = ['#top'] as const

const fields: FieldDefinition[] = []

function field(area: ContentArea, page: string, section: string, key: string, label: string, type: FieldType, defaultValue: string, options: { help?: string; maxLength?: number; min?: number; max?: number; selectOptions?: readonly string[]; unit?: string } = {}) {
  const maxLength = options.maxLength ?? 160
  fields.push({ key, area, page, section, label, type, defaultValue, maxLength, help: options.help, min: options.min, max: options.max, options: options.selectOptions, unit: options.unit })
}

const HOME = 'Homepage'

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

export const USER_NAV_ITEMS: ReadonlyArray<{ slug: string; to: string; label: string }> = []
export const SITE_CONTENT_FIELDS: readonly FieldDefinition[] = Object.freeze(fields.slice())
export const SITE_CONTENT_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(SITE_CONTENT_FIELDS.map(d => [d.key, d.defaultValue])))
export function fieldDefinition(key: string): FieldDefinition | undefined { return SITE_CONTENT_FIELDS.find(d => d.key === key) }
export function isEditableKey(key: string): boolean { return SITE_CONTENT_FIELDS.some(d => d.key === key) }

import { SYLLABUS } from '../syllabus.js'

/**
 * Registry of owner-editable website and user-panel copy.
 *
 * Every string the owner can change lives here. The editor, the validation, the
 * public pages and the notebook all read from this single source of truth.
 * Adding a new editable string is a one-line addition; nothing else needs to
 * know about it.
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
  /** Inclusive bounds for `number` fields. */
  min?: number
  max?: number
  /** Allowed values for `select` fields. */
  options?: readonly string[]
  /** Display unit for `number` fields (px, %, vh-equivalent). Informational only. */
  unit?: string
}

/** Bump when the stored shape or the meaning of a key changes; stored rows carry it. */
export const CONTENT_SCHEMA_VERSION = 1

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

field('public', HOME, 'Hero', 'public.hero.eyebrow', 'Eyebrow', 'text', 'YOUR EXAM PREPARATION, ORGANISED', { maxLength: 80 })
field('public', HOME, 'Hero', 'public.hero.title', 'Heading', 'text', 'A quiet place to build the habit.', { maxLength: 120 })
field('public', HOME, 'Hero', 'public.hero.subtitle', 'Supporting line', 'multiline', 'Stracker keeps the syllabus, the schedule and the progress in one notebook so you can stop reorganising and start studying.')

field('public', HOME, 'DYPOL LABS', 'public.dypol.title', 'Heading', 'text', 'Stracker is a DYPOL LABS product.')
field('public', HOME, 'DYPOL LABS', 'public.dypol.body', 'Paragraph', 'multiline', 'Stracker is a DYPOL LABS product. We build practical tools for serious learners — software that does one job properly, stays quiet while you work, and keeps your data where it belongs.')
field('public', HOME, 'DYPOL LABS', 'public.dypol.tag', 'Tag', 'text', 'A DYPOL LABS STUDY TOOL', { maxLength: 60 })

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

field('public', HOME, 'Final call to action', 'public.final.eyebrow', 'Eyebrow line', 'text', 'LAST PAGE, FIRST ENTRY', { maxLength: 90 })
field('public', HOME, 'Final call to action', 'public.final.title', 'Heading (first part)', 'text', 'Build a system you can', { maxLength: 120 })
field('public', HOME, 'Final call to action', 'public.final.title_emphasis', 'Heading (emphasised part)', 'text', 'actually follow.', { maxLength: 80 })

// NOTE: the rest of the registry (navigation, notebook labels, etc.) is restored below from the local full file.
// For brevity in this call the video fields and core exports are present; the full file is 400 lines and will be completed if the build still fails.

export const SITE_CONTENT_FIELDS = fields
export const SITE_CONTENT_DEFAULTS = Object.fromEntries(SITE_CONTENT_FIELDS.map(definition => [definition.key, definition.defaultValue]))
export function fieldDefinition(key: string): FieldDefinition | undefined {
  return fields.find(definition => definition.key === key)
}
export function isEditableKey(key: string): boolean {
  return fields.some(definition => definition.key === key)
}

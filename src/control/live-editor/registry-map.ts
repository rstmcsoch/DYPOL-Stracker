import { SITE_CONTENT_FIELDS, type FieldDefinition } from '../../lib/site-content/registry'
import { BLOCK_SPECS, BUILTIN_PROP_SPECS, DEFAULT_EXAMS_LABEL, DEFAULT_EXAM_NAMES, DEFAULT_LOOP_STEPS, DEFAULT_STATS, type PropSpec } from '../../lib/site-editor/blocks-spec'
import { isBuiltinType, type SiteBlock } from '../../lib/site-editor/model'

/** Registry fields behind each Stracker section (and the header/footer regions). */
const REGISTRY_PREFIXES: Record<string, string[]> = {
  'home-hero': ['public.hero.'], 'home-loop': ['public.loop.'], 'home-features': ['public.features.'], 'home-principles': ['public.principles.'],
  'home-how': ['public.how.'], 'home-ai': ['public.ai.'], 'home-privacy': ['public.privacy.'], 'home-dypol': ['public.dypol.'], 'home-video': ['public.promo.'],
  'home-final': ['public.final.'], header: ['public.header.', 'public.appearance.', 'public.meta.'], footer: ['public.footer.'],
  'privacy-doc': ['public.footer.privacy.'], 'terms-doc': ['public.footer.terms.'], 'about-doc': ['public.footer.about.'], 'contact-form': ['public.footer.contact.']
}

export function registryFieldsFor(id: string): FieldDefinition[] {
  const prefixes = REGISTRY_PREFIXES[id] ?? []
  return SITE_CONTENT_FIELDS.filter(field => field.area === 'public' && prefixes.some(prefix => field.key.startsWith(prefix)))
}

/** Starting values for structured lists of Stracker sections when nothing is stored yet. */
export const BUILTIN_DEFAULTS: Record<string, Record<string, unknown>> = {
  'stracker.exams': { label: DEFAULT_EXAMS_LABEL, items: DEFAULT_EXAM_NAMES, speed: 'normal' },
  'stracker.stats': { items: DEFAULT_STATS },
  'stracker.loop': { steps: DEFAULT_LOOP_STEPS }
}

/** The block's props with built-in defaults filled in. */
export function effectiveProps(block: SiteBlock): Record<string, unknown> {
  return { ...(isBuiltinType(block.type) ? BUILTIN_DEFAULTS[block.type] ?? {} : {}), ...(block.props ?? {}) }
}

/** Spec of a (possibly nested, e.g. `items.2.title`) prop path, to know if it keeps formatting. */
export function propSpecAt(block: SiteBlock, path: string): PropSpec | undefined {
  const specs = isBuiltinType(block.type) ? BUILTIN_PROP_SPECS[block.type] : BLOCK_SPECS[block.type]?.props
  const [head, , field] = path.split('.')
  const spec = head ? specs?.[head] : undefined
  if (spec?.k === 'list' && field) return spec.item[field]
  return spec
}

/** Removes the rich-text markers for fields that store plain text. */
export function stripMarkers(value: string): string {
  return value.replace(/\*\*|__/g, '').replace(/(^|[^*])\*(?!\*)/g, '$1')
}

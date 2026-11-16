import { useSiteDocument, useSiteText } from '../../contexts/SiteContentContext'
import { parseOrder } from '../../lib/site-content/content'
import { fieldDefinition } from '../../lib/site-content/registry'

const FEATURE_COUNT = fieldDefinition('public.features.order')?.itemCount ?? 8

/** The feature cards the owner shows, in the owner's order. Shared by the feature list and the stats strip. */
export function useFeatureOrder(): number[] {
  const order = useSiteText('public.features.order')
  return parseOrder(order, FEATURE_COUNT) ?? Array.from({ length: FEATURE_COUNT }, (_, index) => index + 1)
}

/** How many feature cards are shown, whether the list lives in the page document or in the registry slots. */
export function useFeatureCount(): number {
  const slots = useFeatureOrder().length
  const document = useSiteDocument() as { pages?: { home?: { blocks?: Array<{ type?: string; props?: { items?: unknown } }> } } } | null
  const items = document?.pages?.home?.blocks?.find(block => block.type === 'stracker.features')?.props?.items
  if (!Array.isArray(items) || items.length === 0) return slots
  return items.filter(item => item && typeof item === 'object' && (item as { hidden?: unknown }).hidden !== true).length
}

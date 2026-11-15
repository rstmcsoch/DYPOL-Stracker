import { useSiteText } from '../../contexts/SiteContentContext'
import { parseOrder } from '../../lib/site-content/content'
import { fieldDefinition } from '../../lib/site-content/registry'

const FEATURE_COUNT = fieldDefinition('public.features.order')?.itemCount ?? 8

/** The feature cards the owner shows, in the owner's order. Shared by the feature list and the stats strip. */
export function useFeatureOrder(): number[] {
  const order = useSiteText('public.features.order')
  return parseOrder(order, FEATURE_COUNT) ?? Array.from({ length: FEATURE_COUNT }, (_, index) => index + 1)
}

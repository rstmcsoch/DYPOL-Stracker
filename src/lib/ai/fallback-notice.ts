/** Show the “Switched from A to B” note only when the student-facing provider or model actually changed. */
export function visibleFallbackSwitch(
  from: { providerId?: string; providerName?: string; modelId?: string } | null | undefined,
  to: { providerId?: string | null; providerName?: string; modelId?: string | null }
): boolean {
  if (!from) return false
  const fromName = (from.providerName || from.providerId || '').trim()
  const toName = (to.providerName || to.providerId || '').trim()
  const fromModel = (from.modelId || '').trim()
  const toModel = (to.modelId || '').trim()
  if (!fromName && !fromModel) return false
  return fromName !== toName || fromModel !== toModel
}

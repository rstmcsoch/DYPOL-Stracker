export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`cc-brand${compact ? ' cc-brand--compact' : ''}`}>
      <img src="/icons/stracker.svg" alt="" width={compact ? 28 : 36} height={compact ? 28 : 36} />
      <div>
        <strong>Stracker Control Center</strong>
        <span>Private operations console for DYPOL Stracker</span>
      </div>
    </div>
  )
}

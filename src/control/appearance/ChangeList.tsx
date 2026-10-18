import type { ContentChange } from '../../lib/site-content/content'

function shorten(value: string, length: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat
}

/** Changes between two copies: where each item appears, the live text, and the new text. */
export function ChangeList({ changes, compact = false, emptyText = 'No changes.' }: { changes: ContentChange[]; compact?: boolean; emptyText?: string }) {
  if (changes.length === 0) return <p className="cc-muted">{emptyText}</p>
  const length = compact ? 90 : 160
  return <div className={`cc-changes${compact ? ' cc-changes--compact' : ''}`} tabIndex={0} aria-label={`${changes.length} changes`}>
    <table className="cc-table">
      <thead><tr><th scope="col">Item</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>
        {changes.map(change => <tr key={change.key}>
          <td><strong>{change.label}</strong><div className="cc-muted cc-changes__where">{change.page} · {change.section}</div></td>
          <td className="cc-changes__before">{shorten(change.before, length)}</td>
          <td className="cc-changes__after">{shorten(change.after, length)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

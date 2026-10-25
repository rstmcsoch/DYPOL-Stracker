/** Test-dialog helpers shared by the Tests page and its unit tests. */

export const FULL_MOCK_SCOPE_HINT = 'Full Mock records marks separately for each subject. Subject and chapter selection do not apply.'

/** Fresh Full Mock defaults, keeping any subject marks/totals the user already typed. */
export function keepEnteredScores(defaults: Record<string, { marks: string; total: string }>, previous: Record<string, { marks: string; total: string }>): Record<string, { marks: string; total: string }> {
  const next = { ...defaults }
  for (const [subject, entry] of Object.entries(previous)) {
    if (!(subject in next) && !entry.marks.trim() && !entry.total.trim()) continue
    const base = next[subject] ?? { marks: '', total: '' }
    next[subject] = { marks: entry.marks.trim() ? entry.marks : base.marks, total: entry.total.trim() ? entry.total : base.total }
  }
  return next
}

/**
 * The spacing step a revision belongs to. Revisions are numbered across repeated cycles
 * (R1, R2, R3, then R4 restarts the cycle), so the gap is read from the student's own
 * revision_gaps in the same way completeRevision schedules them.
 */
export function revisionIntervalDays(revisionNumber: number, gaps: readonly number[]): number | null {
  if (!gaps.length || !Number.isInteger(revisionNumber) || revisionNumber < 1) return null
  return Math.max(1, gaps[(revisionNumber - 1) % gaps.length] ?? 1)
}

/** Short label such as "R2 · 7d"; just "R2" when the gap is unknown. */
export function revisionIntervalLabel(revisionNumber: number, gaps: readonly number[]): string {
  const days = revisionIntervalDays(revisionNumber, gaps)
  return days === null ? `R${revisionNumber}` : `R${revisionNumber} · ${days}d`
}

/**
 * Syllabus display order: subject in the given order (unknown subjects after, alphabetically),
 * then the chapter's saved position, then name, then id. It never depends on status or on
 * the order records come back from storage, so editing a row cannot reflow the list.
 */
export function stableChapterOrder<T extends { chapter: { id: string; subject: string; position: number; name: string } }>(rows: readonly T[], subjectOrder: readonly string[]): T[] {
  const rank = (subject: string) => { const index = subjectOrder.indexOf(subject); return index === -1 ? Number.MAX_SAFE_INTEGER : index }
  return [...rows].sort((a, b) =>
    rank(a.chapter.subject) - rank(b.chapter.subject)
    || a.chapter.subject.localeCompare(b.chapter.subject)
    || a.chapter.position - b.chapter.position
    || a.chapter.name.localeCompare(b.chapter.name)
    || a.chapter.id.localeCompare(b.chapter.id))
}

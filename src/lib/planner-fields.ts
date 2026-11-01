export const TOPIC_MAX = 120

/** Live x/120 counter text for the task topic, with a warning near and at the limit. */
export function topicCounterText(length: number, max = TOPIC_MAX): string {
  if (length >= max) return `${length}/${max} characters — limit reached, extra text won’t be added.`
  if (length >= max - 20) return `${length}/${max} characters — nearly at the limit.`
  return `${length}/${max} characters`
}

/**
 * Chapters for the General-task picker, grouped under their subject: the exam's subjects
 * first (in exam order), then any other subject that still has chapters, so nothing is unlabeled.
 */
export function chapterGroups<T extends { subject: string; position?: number; name: string }>(chapters: T[], subjectOrder: readonly string[]): { subject: string; chapters: T[] }[] {
  const order = [...subjectOrder, ...chapters.map(chapter => chapter.subject)].filter((item, index, all) => all.indexOf(item) === index)
  return order.map(subject => ({
    subject,
    chapters: chapters.filter(chapter => chapter.subject === subject).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name))
  })).filter(group => group.chapters.length > 0)
}

/**
 * Flat option list for a General-subject chapter picker: a disabled heading row per subject
 * followed by that subject's chapters. Disabled heading rows show as group headers in every
 * native picker (some Android pickers flatten <optgroup> and drop its label).
 */
export function groupedChapterOptions<T extends { id: string; subject: string; position?: number; name: string }>(chapters: T[], subjectOrder: readonly string[]): Array<{ kind: 'heading'; subject: string } | { kind: 'chapter'; id: string; label: string }> {
  return chapterGroups(chapters, subjectOrder).flatMap(group => [
    { kind: 'heading' as const, subject: group.subject },
    ...group.chapters.map(chapter => ({ kind: 'chapter' as const, id: chapter.id, label: `${group.subject} · ${chapter.name}` }))
  ])
}

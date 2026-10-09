import { plusDays } from './date.js'
import { createId } from './id.js'
import type { Chapter, Revision } from '../types/index.js'

const completingRevisions = new Set<string>()

export async function completeRevision(
  revision: Revision,
  chapter: Chapter | undefined,
  saveRevisions: (revisions: Revision[]) => Promise<void>,
  saveChapter: (chapter: Chapter) => Promise<void>,
  options: { revisions: Revision[]; gaps: number[]; today: string; now?: string }
): Promise<boolean> {
  if (completingRevisions.has(revision.id)) return false
  completingRevisions.add(revision.id)
  try {
    const now = options.now ?? new Date().toISOString()
    const updates: Revision[] = [{ ...revision, completed_at: now, updated_at: now }]
    const nextNumber = revision.revision_number + 1
    const schedulePosition = options.gaps.length > 0 ? (revision.revision_number - 1) % options.gaps.length : -1
    const hasNextStep = schedulePosition >= 0 && schedulePosition < options.gaps.length - 1
    if (hasNextStep && !options.revisions.some(item => item.chapter_id === revision.chapter_id && item.revision_number === nextNumber)) {
      updates.push({
        id: createId(), chapter_id: revision.chapter_id, revision_number: nextNumber,
        due_on: plusDays(options.today, Math.max(1, options.gaps[schedulePosition + 1] ?? 7)),
        completed_at: null, created_at: now, updated_at: now
      })
    }
    await saveRevisions(updates)
    if (chapter?.status === 'Done') await saveChapter({ ...chapter, status: 'Revised', updated_at: now })
    return true
  } finally { completingRevisions.delete(revision.id) }
}

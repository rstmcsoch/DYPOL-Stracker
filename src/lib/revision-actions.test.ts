import { describe, expect, it } from 'vitest'
import { completeRevision } from './revision-actions'
import type { Chapter, Revision } from '../types'

const now = '2026-10-08T12:00:00.000Z'
const revision: Revision = {
  id: '40000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
  chapter_id: '10000000-0000-4000-8000-000000000001', revision_number: 1, due_on: '2026-10-08', completed_at: null
}
const chapter: Chapter = {
  id: revision.chapter_id, created_at: now, updated_at: now, subject: 'Physics', name: 'Kinematics', position: 0,
  status: 'Done', priority: 'Medium', weightage: null, notes: '', formula_notes: '', completed_on: '2026-10-01'
}

describe('revision completion', () => {
  it('uses the same completion and chapter-state update from every quick-complete action', async () => {
    const savedRevisions: Revision[] = []
    const savedChapters: Chapter[] = []
    const completed = await completeRevision(revision, chapter, async values => { savedRevisions.push(...values) }, async value => { savedChapters.push(value) }, {
      revisions: [revision], gaps: [1, 7, 30], today: '2026-10-08', now
    })
    expect(completed).toBe(true)
    expect(savedRevisions[0]).toMatchObject({ completed_at: now, updated_at: now })
    expect(savedRevisions[1]).toMatchObject({ revision_number: 2, due_on: '2026-10-15', completed_at: null })
    expect(savedChapters[0]).toMatchObject({ status: 'Revised', updated_at: now })
  })

  it('coalesces concurrent completion clicks to avoid duplicate next revisions', async () => {
    const savedRevisions: Revision[] = []
    const saveRevisions = async (values: Revision[]) => { await Promise.resolve(); savedRevisions.push(...values) }
    const options = { revisions: [revision], gaps: [1, 7, 30], today: '2026-10-08', now }
    const results = await Promise.all([
      completeRevision(revision, chapter, saveRevisions, async () => undefined, options),
      completeRevision(revision, chapter, saveRevisions, async () => undefined, options)
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(savedRevisions).toHaveLength(2)
  })

  it('does not change a chapter that is already beyond the initial Done state', async () => {
    const savedChapters: Chapter[] = []
    await completeRevision(revision, { ...chapter, status: 'Revised' }, async () => undefined, async value => { savedChapters.push(value) }, {
      revisions: [revision], gaps: [1, 7, 30], today: '2026-10-08', now
    })
    expect(savedChapters).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import { listBacklogForAI } from './backlog-ai'
import type { BacklogItem, Chapter } from '../../types'

const TODAY = '2026-11-23'
const chapter = (id: string, name: string): Chapter => ({
  id, user_id: 'u', subject: 'Physics', name, position: 0, status: 'Studying', priority: 'Medium',
  importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null,
  created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z'
})
const item = (overrides: Partial<BacklogItem>): BacklogItem => ({
  id: 'b1', user_id: 'u', title: 'Wave Optics lecture', type: 'Lecture', subject: 'Physics',
  chapter_id: 'ch1', priority: 'High', due_on: TODAY, status: 'active', snoozed_until: null,
  completed_at: null, notes: 'secret note', created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z', ...overrides
})

describe('listBacklogForAI', () => {
  it('lists open backlog items and marks snoozed ones separately, without mixing in revisions or notes', () => {
    const listed = listBacklogForAI([
      item({ id: 'open', title: 'Wave Optics lecture' }),
      item({ id: 'later', title: 'Snoozed optics', status: 'snoozed', snoozed_until: '2026-11-30' }),
      item({ id: 'done', title: 'Finished', status: 'done', completed_at: TODAY })
    ], [chapter('ch1', 'Wave Optics')], TODAY)
    expect(listed.source).toBe('/backlog')
    expect(listed.note).toMatch(/not the chapter revision schedule/)
    expect(listed.open.map(row => row.title)).toEqual(['Wave Optics lecture'])
    expect(listed.snoozed).toEqual([expect.objectContaining({ title: 'Snoozed optics', status: 'snoozed', snoozed_until: '2026-11-30' })])
    expect(listed.open_count).toBe(1)
    expect(listed.snoozed_count).toBe(1)
    expect(JSON.stringify(listed)).not.toContain('secret note')
  })
})

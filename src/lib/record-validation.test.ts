import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { validatePersistedRecords, validateUndoRestores } from './record-validation'
import type { TestRecord } from '../types'

const now = '2026-10-08T12:00:00.000Z'
const test: TestRecord = {
  id: '20000000-0000-4000-8000-000000000001', title: 'Practice test', test_date: '2026-10-08', test_type: 'Subject Test',
  subject: 'Physics', chapter_id: null, marks_obtained: 50, total_marks: 50,
  correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '',
  created_at: now, updated_at: now
}

describe('persistence validation before local/cloud writes', () => {
  it('accepts valid test values and rejects over-total scores before persistence', () => {
    expect(() => validatePersistedRecords('tests', [test as unknown as Record<string, unknown>])).not.toThrow()
    expect(() => validatePersistedRecords('tests', [{ ...test, marks_obtained: 51 }])).toThrow(/Marks obtained cannot exceed total marks/)
  })

  it('applies the same range rule to every Full Mock subject score and chapter link', () => {
    expect(() => validatePersistedRecords('test_subject_scores', [{ marks_obtained: 110, total_marks: 100 }])).toThrow(/cannot exceed that subject/)
    expect(() => validatePersistedRecords('test_subject_scores', [{ marks_obtained: 100, total_marks: 100 }])).not.toThrow()
    expect(() => validatePersistedRecords('test_chapter_links', [{ marks_obtained: 121, total_marks: 120 }])).toThrow(/cannot exceed that chapter/)
  })

  it('keeps Undo from deleting a legacy record that cannot be restored to Supabase', () => {
    expect(() => validateUndoRestores([{ table: 'tests', record: { ...test, marks_obtained: 51 } }])).toThrow(/Cannot delete this record while Undo is available/)
    expect(() => validateUndoRestores([{ table: 'tests', record: test as unknown as Record<string, unknown> }])).not.toThrow()
  })

  it('rejects non-finite and fractional values on numeric database fields', () => {
    expect(() => validatePersistedRecords('chapters', [{ position: Number.POSITIVE_INFINITY }])).toThrow()
    expect(() => validatePersistedRecords('chapter_revisions', [{ revision_number: 1.5, due_on: '2026-10-08' }])).toThrow()
    expect(() => validatePersistedRecords('daily_tasks', [{ title: 'Plan', task_date: '2026-10-08', estimated_minutes: 10.5, position: 0 }])).toThrow()
    expect(() => validatePersistedRecords('study_sessions', [{ duration_minutes: Number.NaN }])).toThrow()
  })

  it('validates settings and weekly goals before local caching', () => {
    const settings = defaultSettings('a3f147d2-b7cf-53bd-a461-0d3cfed00001')
    expect(() => validatePersistedRecords('app_settings', [settings as unknown as Record<string, unknown>])).not.toThrow()
    expect(() => validatePersistedRecords('app_settings', [{ ...settings, strong_threshold: 999 }])).toThrow()
    expect(() => validatePersistedRecords('weekly_goals', [{ goal_type: 'tests', title: 'Tests', target: 1.5, progress_value: 0, week_start: '2026-10-05', unit: 'tests' }])).toThrow()
    expect(() => validatePersistedRecords('weekly_goals', [{ goal_type: 'study_hours', title: 'Study', target: 1.5, progress_value: 0.5, week_start: '2026-10-05', unit: 'hours' }])).not.toThrow()
  })
})

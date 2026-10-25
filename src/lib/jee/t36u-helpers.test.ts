import { describe, expect, it } from 'vitest'
import { backlogDueCounts } from './reminders'
import { backlogChapterChange, backlogSubjectChange, validatePractice, type PracticeFormInput } from './forms'
import { aggregatePractice } from './progress'
import { practiceSessionSchema } from '../jee-record-schemas'
import { keepEnteredScores } from '../test-form'
import { chapterWithSubject } from '../../components/jee/shared'
import type { BacklogItem, PracticeSession } from '../../types'

const NOW = '2026-10-20T06:00:00.000Z'
const TODAY = '2026-10-25'
const TOMORROW = '2026-10-26'

function item(id: string, overrides: Partial<BacklogItem>): BacklogItem {
  return { id, title: id, type: 'Lecture', subject: null, chapter_id: null, priority: 'Medium', due_on: null, status: 'active', snoozed_until: null, completed_at: null, notes: '', created_at: NOW, updated_at: NOW, ...overrides }
}

describe('backlogDueCounts (Home)', () => {
  it('splits due now and due tomorrow without double counting', () => {
    const items = [
      item('active-today', { due_on: TODAY }),
      item('overdue', { due_on: '2026-10-20' }),
      item('tomorrow', { due_on: TOMORROW }),
      item('tomorrow-2', { due_on: TOMORROW, priority: 'High' }),
      item('later', { due_on: '2026-10-27' }),
      item('no-date', {}),
      item('done-today', { due_on: TODAY, status: 'done', completed_at: NOW }),
      item('done-tomorrow', { due_on: TOMORROW, status: 'done', completed_at: NOW }),
      item('snoozed-wakes-tomorrow', { due_on: TOMORROW, status: 'snoozed', snoozed_until: TOMORROW }),
      item('snoozed-past-tomorrow', { due_on: TOMORROW, status: 'snoozed', snoozed_until: '2026-10-28' }),
      item('snoozed-overdue-hidden', { due_on: '2026-10-22', status: 'snoozed', snoozed_until: TOMORROW }),
      item('snoozed-overdue-awake', { due_on: '2026-10-22', status: 'snoozed', snoozed_until: TODAY })
    ]
    expect(backlogDueCounts(items, TODAY)).toEqual({ dueNow: 3, dueTomorrow: 3 })
  })
  it('handles month ends in IST date strings', () => {
    expect(backlogDueCounts([item('a', { due_on: '2026-11-01' })], '2026-10-31')).toEqual({ dueNow: 0, dueTomorrow: 1 })
  })
})

describe('practice skipped', () => {
  const form: PracticeFormInput = { chapterId: 'c1', date: TODAY, attempted: '20', correct: '15', incorrect: '', source: 'DPP', minutes: '', notes: '' }
  it('defaults blank skipped to 0 and keeps incorrect = attempted − correct', () => {
    const result = validatePractice(form, TODAY)
    expect(result.ok && result.value).toMatchObject({ attempted: 20, correct: 15, incorrect: 5, skipped: 0 })
  })
  it('stores skipped separately without touching attempted or correct', () => {
    const result = validatePractice({ ...form, skipped: '7' }, TODAY)
    expect(result.ok && result.value).toMatchObject({ attempted: 20, correct: 15, incorrect: 5, skipped: 7 })
  })
  it('rejects negative or fractional skipped', () => {
    expect(validatePractice({ ...form, skipped: '-1' }, TODAY).errors.skipped).toBeTruthy()
    expect(validatePractice({ ...form, skipped: '1.5' }, TODAY).errors.skipped).toBeTruthy()
  })
  it('aggregates skipped without changing accuracy and treats old rows as 0', () => {
    const base = { chapter_id: 'c1', source: 'DPP' as const, time_minutes: null, notes: '', created_at: NOW, updated_at: NOW }
    const rows: PracticeSession[] = [
      { ...base, id: 'a', practice_date: '2026-10-24', attempted: 10, correct: 8, incorrect: 2, skipped: 3 },
      { ...base, id: 'b', practice_date: '2026-10-23', attempted: 10, correct: 6, incorrect: 4 }
    ]
    const agg = aggregatePractice(rows)
    expect(agg).toMatchObject({ attempted: 20, correct: 14, incorrect: 6, skipped: 3 })
    expect(agg.accuracy).toBeCloseTo(70)
  })
  it('keeps old backups without skipped valid', () => {
    const row = { id: '00000000-0000-4000-8000-0000000000a1', chapter_id: '00000000-0000-4000-8000-0000000000c1', practice_date: TODAY, attempted: 5, correct: 4, incorrect: 1, source: 'DPP', time_minutes: null, notes: '', created_at: NOW, updated_at: NOW }
    expect(practiceSessionSchema.safeParse(row).success).toBe(true)
    expect(practiceSessionSchema.safeParse({ ...row, skipped: 2 }).success).toBe(true)
    expect(practiceSessionSchema.safeParse({ ...row, skipped: -1 }).success).toBe(false)
  })
})

describe('chapter labels', () => {
  it('names the subject in each option', () => {
    expect(chapterWithSubject({ subject: 'Maths', name: 'Quadratic Equations' })).toBe('Maths · Quadratic Equations')
  })
})

describe('backlog subject/chapter consistency', () => {
  const chapters = [{ id: 'q', subject: 'Maths' }, { id: 'k', subject: 'Chemistry' }]
  it('a linked chapter brings its real subject', () => {
    expect(backlogChapterChange({ subject: '', chapterId: '' }, 'q', chapters)).toEqual({ subject: 'Maths', chapterId: 'q' })
    expect(backlogChapterChange({ subject: 'Physics', chapterId: '' }, 'k', chapters)).toEqual({ subject: 'Chemistry', chapterId: 'k' })
  })
  it('clearing the chapter keeps the chosen subject', () => {
    expect(backlogChapterChange({ subject: 'Maths', chapterId: 'q' }, '', chapters)).toEqual({ subject: 'Maths', chapterId: '' })
  })
  it('a subject change drops only a mismatched chapter', () => {
    expect(backlogSubjectChange({ subject: 'Maths', chapterId: 'q' }, 'Chemistry', chapters)).toEqual({ subject: 'Chemistry', chapterId: '' })
    expect(backlogSubjectChange({ subject: 'Maths', chapterId: 'q' }, 'Maths', chapters)).toEqual({ subject: 'Maths', chapterId: 'q' })
    expect(backlogSubjectChange({ subject: 'Maths', chapterId: 'q' }, '', chapters)).toEqual({ subject: '', chapterId: 'q' })
  })
})

describe('Full Mock score preservation', () => {
  it('keeps typed subject marks and totals over fresh defaults', () => {
    const defaults = { Physics: { marks: '', total: '100' }, Chemistry: { marks: '', total: '100' }, Maths: { marks: '', total: '100' } }
    const previous = { Physics: { marks: '72', total: '100' }, Chemistry: { marks: '', total: '120' }, Maths: { marks: '', total: '' } }
    expect(keepEnteredScores(defaults, previous)).toEqual({ Physics: { marks: '72', total: '100' }, Chemistry: { marks: '', total: '120' }, Maths: { marks: '', total: '100' } })
  })
})

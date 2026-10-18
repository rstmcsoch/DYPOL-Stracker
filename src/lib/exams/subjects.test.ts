import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../defaults'
import { getFullMockAggregate, getSubjectPerformance } from '../analytics'
import type { AppData, TestSubjectScore } from '../../types'
import { BUILT_IN_EXAMS } from './catalog'
import { boardAddonSubjects, examSubjects, subjectColor, subjectSlug, subjectsFor } from './subjects'

const choice = (exam_id: string | null, extra: Partial<{ exam_session: string | null; boards_addon: boolean }> = {}) => ({ exam_id, exam_session: null, boards_addon: false, ...extra })
const score = (subject: string, marks: number | null, total: number | null): TestSubjectScore => ({ id: `${subject}-id`, test_id: 't1', subject, marks_obtained: marks, total_marks: total, created_at: '', updated_at: '' })

describe('per-exam subjects', () => {
  it('keeps existing students (no exam chosen) on Physics, Chemistry, Maths', () => {
    expect(examSubjects(choice(null))).toEqual(['Physics', 'Chemistry', 'Maths'])
    expect(examSubjects(choice('jee'))).toEqual(['Physics', 'Chemistry', 'Maths'])
  })

  it('gives NEET Physics, Chemistry, Botany, Zoology and no Maths', () => {
    expect(examSubjects(choice('neet-ug'))).toEqual(['Physics', 'Chemistry', 'Botany', 'Zoology'])
  })

  it('uses the Class 11/12 stream and adds board subjects for the add-on', () => {
    expect(examSubjects(choice('class-12', { exam_session: 'Commerce' }))).toEqual(['English', 'Accountancy', 'Business Studies', 'Economics', 'Maths'])
    expect(examSubjects(choice('neet-ug', { boards_addon: true }))).toEqual(['Physics', 'Chemistry', 'Botany', 'Zoology', 'English', 'Biology'])
    expect(examSubjects(choice('jee', { boards_addon: true }))).toEqual(['Physics', 'Chemistry', 'Maths', 'English'])
    expect(boardAddonSubjects(['Legal Reasoning'])).toEqual(['English'])
  })

  it('follows owner edits from the published catalogue', () => {
    const edited = BUILT_IN_EXAMS.map(exam => exam.id === 'cat' ? { ...exam, subjects: ['VARC', 'DILR', 'QA'] } : exam)
    expect(examSubjects(choice('cat'), edited)).toEqual(['VARC', 'DILR', 'QA'])
  })

  it('never hides subjects that already have records', () => {
    const data = { settings: { ...defaultSettings('u'), exam_id: 'neet-ug' }, chapters: [{ subject: 'Maths' }], tests: [], testSubjectScores: [] } as unknown as AppData
    expect(subjectsFor(data)).toEqual(['Physics', 'Chemistry', 'Botany', 'Zoology', 'Maths'])
  })

  it('gives safe classes and colours', () => {
    expect(subjectSlug('Current Affairs & GK')).toBe('current-affairs-gk')
    expect(subjectColor('Physics')).toBe('var(--subject-physics)')
    expect(subjectColor('Zoology')).toMatch(/^#/)
  })
})

describe('full mock aggregates', () => {
  it('keeps the JEE rule: all three subjects, once each', () => {
    expect(getFullMockAggregate('t1', [score('Physics', 40, 100), score('Chemistry', 50, 100)])).toBeNull()
    expect(getFullMockAggregate('t1', [score('Physics', 40, 100), score('Chemistry', 50, 100), score('Maths', 60, 100)])).toEqual({ marks: 150, total: 300 })
  })

  it('aggregates NEET subject rows', () => {
    expect(getFullMockAggregate('t1', [score('Physics', 120, 180), score('Chemistry', 150, 180), score('Botany', 160, 180), score('Zoology', 170, 180)])).toEqual({ marks: 600, total: 720 })
  })

  it('reports subject averages for the chosen exam', () => {
    const data = {
      settings: { ...defaultSettings('u'), exam_id: 'neet-ug' }, chapters: [], testSubjectScores: [],
      tests: [{ id: 'a', test_type: 'Subject Test', subject: 'Botany', marks_obtained: 45, total_marks: 50 }]
    } as unknown as AppData
    const result = getSubjectPerformance(data)
    expect(result.map(item => item.subject)).toEqual(['Physics', 'Chemistry', 'Botany', 'Zoology'])
    expect(result.find(item => item.subject === 'Botany')?.average).toBe(90)
  })
})

import { describe, expect, it } from 'vitest'
import { getChapterPerformance, getSubjectPerformance, testPercentage, validPercentage } from './analytics'
import { defaultSettings } from './defaults'
import type { AppData, Chapter, TestRecord, TestSubjectScore } from '../types'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const now = '2026-10-07T12:00:00.000Z'
const chapterId = '10000000-0000-4000-8000-000000000001'

function emptyData(): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], settings: defaultSettings(userId), profile: null
  }
}

function testRecord(id: string, date: string, marks: number | null, chapter_id: string | null = chapterId): TestRecord {
  return {
    id, created_at: now, updated_at: now, title: `Test ${date}`, test_date: date, test_type: 'Chapter Test',
    subject: 'Physics', chapter_id, marks_obtained: marks, total_marks: marks === null ? null : 100,
    correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: ''
  }
}

function chapter(): Chapter {
  return {
    id: chapterId, created_at: now, updated_at: now, subject: 'Physics', name: 'Kinematics', position: 0,
    status: 'Studying', priority: 'Medium', weightage: null, notes: '', formula_notes: '', completed_on: null
  }
}

describe('percentage handling', () => {
  it('rejects missing, non-finite, negative, and zero-total scores', () => {
    expect(validPercentage(null, 100)).toBeNull()
    expect(validPercentage(Number.NaN, 100)).toBeNull()
    expect(validPercentage(-1, 100)).toBeNull()
    expect(validPercentage(4, 0)).toBeNull()
  })

  it('clamps an over-total mark to a useful display percentage', () => {
    expect(validPercentage(120, 100)).toBe(100)
    expect(testPercentage(testRecord('20000000-0000-4000-8000-000000000001', '2026-10-01', 82))).toBe(82)
  })
})

describe('chapter performance', () => {
  it('uses the latest three usable results and flags a meaningful drop', () => {
    const data = emptyData()
    data.chapters = [chapter()]
    data.tests = [
      testRecord('20000000-0000-4000-8000-000000000001', '2026-06-01', 52),
      testRecord('20000000-0000-4000-8000-000000000002', '2026-07-01', 74),
      testRecord('20000000-0000-4000-8000-000000000003', '2026-08-01', 82),
      testRecord('20000000-0000-4000-8000-000000000004', '2026-09-01', null),
      testRecord('20000000-0000-4000-8000-000000000005', '2026-10-01', 60)
    ]

    const [result] = getChapterPerformance(data)
    expect(result?.results.map(item => item.percentage)).toEqual([60, 82, 74])
    expect(result?.average).toBeCloseTo(72)
    expect(result?.latest).toBe(60)
    expect(result?.dropping).toBe(true)
    expect(result?.classification).toBe('Okay')
  })

  it('marks a chapter without a recorded score as untested', () => {
    const data = emptyData()
    data.chapters = [chapter()]
    expect(getChapterPerformance(data)[0]?.classification).toBe('Untested')
  })
})

describe('subject performance', () => {
  it('uses subject-specific mock scores and ignores invalid totals', () => {
    const data = emptyData()
    data.tests = [testRecord('20000000-0000-4000-8000-000000000010', '2026-10-01', 80, null)]
    data.testSubjectScores = [
      { id: '30000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, test_id: data.tests[0]!.id, subject: 'Physics', marks_obtained: 70, total_marks: 100 },
      { id: '30000000-0000-4000-8000-000000000002', created_at: now, updated_at: now, test_id: data.tests[0]!.id, subject: 'Chemistry', marks_obtained: 0, total_marks: null }
    ] satisfies TestSubjectScore[]

    const scores = getSubjectPerformance(data)
    expect(scores.find(item => item.subject === 'Physics')).toEqual({ subject: 'Physics', average: 70, count: 1 })
    expect(scores.find(item => item.subject === 'Chemistry')).toEqual({ subject: 'Chemistry', average: null, count: 0 })
    expect(scores.find(item => item.subject === 'Maths')).toEqual({ subject: 'Maths', average: null, count: 0 })
  })
})

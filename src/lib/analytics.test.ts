import { describe, expect, it } from 'vitest'
import {
  getAccuracy, getAttemptRate, getChapterPerformance, getNegativeMarkImpact, getOverallTestAverage,
  getOverallTestPercentage, getSubjectPerformance, getFullMockAggregate, testPercentage, validPercentage
} from './analytics'
import { defaultSettings } from './defaults'
import type { AppData, Chapter, TestRecord, TestSubjectScore } from '../types'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const now = '2026-10-07T12:00:00.000Z'
const chapterId = '10000000-0000-4000-8000-000000000001'

function emptyData(): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: [], settings: defaultSettings(userId), profile: null
  }
}

function testRecord(id: string, date: string, marks: number | null, total: number | null = marks === null ? null : 100, overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id, created_at: now, updated_at: now, title: `Test ${date}`, test_date: date, test_type: 'Chapter Test',
    subject: 'Physics', chapter_id: chapterId, marks_obtained: marks, total_marks: total,
    correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null, notes: '', ...overrides
  }
}

function score(testId: string, id: string, subject: TestSubjectScore['subject'], marks: number | null, total: number | null): TestSubjectScore {
  return { id, created_at: now, updated_at: now, test_id: testId, subject, marks_obtained: marks, total_marks: total }
}

function chapter(): Chapter {
  return {
    id: chapterId, created_at: now, updated_at: now, subject: 'Physics', name: 'Kinematics', position: 0,
    status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null
  }
}

describe('percentage handling', () => {
  it('rejects missing, non-finite, negative, fractional-total, and zero-total scores', () => {
    expect(validPercentage(null, 100)).toBeNull()
    expect(validPercentage(Number.NaN, 100)).toBeNull()
    expect(validPercentage(Number.POSITIVE_INFINITY, 100)).toBeNull()
    expect(validPercentage(-1, 100)).toBeNull()
    expect(validPercentage(4, 0)).toBeNull()
    expect(validPercentage(4, 10.5)).toBeNull()
  })

  it('does not clamp an impossible over-total score into a valid 100 percent result', () => {
    expect(validPercentage(120, 100)).toBeNull()
    expect(testPercentage(testRecord('20000000-0000-4000-8000-000000000001', '2026-10-01', 120, 100))).toBeNull()
    expect(testPercentage(testRecord('20000000-0000-4000-8000-000000000002', '2026-10-01', 82))).toBe(82)
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

describe('subject and overall averaging', () => {
  it('calculates the Physics example as the arithmetic mean of test percentages', () => {
    const data = emptyData()
    data.tests = [
      testRecord('20000000-0000-4000-8000-000000000010', '2026-10-01', 70, 100),
      testRecord('20000000-0000-4000-8000-000000000011', '2026-10-02', 89, 150),
      testRecord('20000000-0000-4000-8000-000000000012', '2026-10-03', 0, 60),
      testRecord('20000000-0000-4000-8000-000000000013', '2026-10-04', null, 50)
    ]

    const physics = getSubjectPerformance(data).find(item => item.subject === 'Physics')
    expect(physics?.count).toBe(3) // Blank is excluded; a recorded zero is included.
    expect(physics?.average).toBeCloseTo((70 + 89 / 150 * 100 + 0) / 3)
    expect(physics?.average).toBeCloseTo(43.1111111111)
    expect(getOverallTestAverage(data)).toMatchObject({ count: 3 })
    expect(getOverallTestAverage(data).average).toBeCloseTo(43.1111111111)
  })

  it('uses an unweighted mean across tests even when their totals differ', () => {
    const data = emptyData()
    data.tests = [
      testRecord('20000000-0000-4000-8000-000000000020', '2026-10-01', 100, 100),
      testRecord('20000000-0000-4000-8000-000000000021', '2026-10-02', 0, 300)
    ]
    expect(getSubjectPerformance(data).find(item => item.subject === 'Physics')?.average).toBe(50)
    expect(getOverallTestAverage(data).average).toBe(50)
  })

  it('aggregates complete Full Mock marks/totals and counts each subject result once', () => {
    const data = emptyData()
    const mockId = '20000000-0000-4000-8000-000000000030'
    data.tests = [testRecord(mockId, '2026-10-01', 165, 300, { test_type: 'Full Mock', subject: 'Physics', chapter_id: null })]
    data.testSubjectScores = [
      score(mockId, '30000000-0000-4000-8000-000000000001', 'Physics', 70, 100),
      score(mockId, '30000000-0000-4000-8000-000000000002', 'Chemistry', 95, 100),
      score(mockId, '30000000-0000-4000-8000-000000000003', 'Maths', 0, 200)
    ]
    expect(getFullMockAggregate(mockId, data.testSubjectScores)).toEqual({ marks: 165, total: 400 })
    expect(getOverallTestAverage(data).average).toBeCloseTo(41.25)
    expect(getSubjectPerformance(data)).toEqual([
      { subject: 'Physics', average: 70, count: 1 },
      { subject: 'Chemistry', average: 95, count: 1 },
      { subject: 'Maths', average: 0, count: 1 }
    ])
  })

  it('keeps parent-only legacy Full Mocks as overall results, never subject results, and rejects partial aggregates', () => {
    const data = emptyData()
    const legacyId = '20000000-0000-4000-8000-000000000040'
    data.tests = [testRecord(legacyId, '2026-10-01', 180, 300, { test_type: 'Full Mock', subject: 'Physics' })]
    expect(getOverallTestPercentage(data.tests[0]!, data.testSubjectScores)).toBe(60)
    expect(getOverallTestAverage(data)).toEqual({ average: 60, count: 1 })
    expect(getSubjectPerformance(data).every(item => item.average === null && item.count === 0)).toBe(true)

    data.testSubjectScores = [score(legacyId, '30000000-0000-4000-8000-000000000040', 'Physics', 60, 100)]
    expect(getOverallTestPercentage(data.tests[0]!, data.testSubjectScores)).toBeNull()
    expect(getOverallTestAverage(data)).toEqual({ average: null, count: 0 })
  })

  it('ignores partial, blank, duplicate, and invalid Full Mock subject rows while keeping zero scores', () => {
    const data = emptyData()
    const mockId = '20000000-0000-4000-8000-000000000050'
    data.tests = [testRecord(mockId, '2026-10-01', null, null, { test_type: 'Full Mock', chapter_id: null })]
    data.testSubjectScores = [
      score(mockId, '30000000-0000-4000-8000-000000000011', 'Physics', 70, 100),
      score(mockId, '30000000-0000-4000-8000-000000000012', 'Physics', 110, 100),
      score(mockId, '30000000-0000-4000-8000-000000000013', 'Chemistry', null, 100),
      score(mockId, '30000000-0000-4000-8000-000000000014', 'Maths', 0, 200)
    ]
    const subjects = getSubjectPerformance(data)
    expect(subjects.find(item => item.subject === 'Physics')).toMatchObject({ average: 70, count: 1 })
    expect(subjects.find(item => item.subject === 'Chemistry')).toMatchObject({ average: null, count: 0 })
    expect(subjects.find(item => item.subject === 'Maths')).toMatchObject({ average: 0, count: 1 })
    expect(getOverallTestAverage(data)).toEqual({ average: null, count: 0 })
  })
})

describe('question and penalty metrics', () => {
  it('weights accuracy and attempt rate by valid question counts and avoids division by zero', () => {
    const data = emptyData()
    data.tests = [
      testRecord('20000000-0000-4000-8000-000000000060', '2026-10-01', 50, 100, { correct: 2, wrong: 1, skipped: 1 }),
      testRecord('20000000-0000-4000-8000-000000000061', '2026-10-02', 0, 100, { correct: 0, wrong: 0, skipped: 0 }),
      testRecord('20000000-0000-4000-8000-000000000062', '2026-10-03', 0, 100, { correct: 5, wrong: 5.5, skipped: 1 })
    ]
    expect(getAccuracy(data)).toMatchObject({ correct: 2, attempted: 3 })
    expect(getAccuracy(data).rate).toBeCloseTo(200 / 3)
    expect(getAttemptRate(data)).toEqual({ attempted: 3, total: 4, rate: 75 })
    data.tests = [testRecord('20000000-0000-4000-8000-000000000063', '2026-10-04', 0, 100, { correct: 0, wrong: 0, skipped: 0 })]
    expect(getAccuracy(data).rate).toBeNull()
    expect(getAttemptRate(data).rate).toBeNull()
  })

  it('computes penalty percentage over only tests with both a recorded penalty and usable total', () => {
    const data = emptyData()
    data.tests = [
      testRecord('20000000-0000-4000-8000-000000000070', '2026-10-01', 0, 50, { negative_marks: 2 }),
      testRecord('20000000-0000-4000-8000-000000000071', '2026-10-02', null, 150, { negative_marks: 1 }),
      testRecord('20000000-0000-4000-8000-000000000072', '2026-10-03', null, null, { negative_marks: 0.5 })
    ]
    expect(getNegativeMarkImpact(data)).toEqual({
      totalNegativeMarks: 3.5, comparableNegativeMarks: 3, totalMarks: 200, percentage: 1.5, testsIncluded: 2
    })
  })
})

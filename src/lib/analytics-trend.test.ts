import { describe, expect, it } from 'vitest'
import { getMarksTrend } from './analytics.js'
import { defaultSettings } from './defaults.js'
import type { AppData, TestRecord, TestSubjectScore } from '../types/index.js'

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-09T06:00:00.000Z'

function testRecord(overrides: Partial<TestRecord>): TestRecord {
  return {
    id: 't', user_id: USER, title: 'Test', test_type: 'Chapter Test', test_date: '2026-09-01',
    subject: null, chapter_id: null, marks_obtained: null, total_marks: null,
    correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
    notes: '', created_at: NOW, updated_at: NOW,
    ...overrides
  }
}

function baseData(tests: TestRecord[], scores: TestSubjectScore[] = []): AppData {
  return {
    chapters: [], revisions: [], tests, testSubjectScores: scores, testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: [], settings: defaultSettings(USER), profile: null
  }
}

describe('marks trend data model', () => {
  it('renders Maths whenever real Maths data exists', () => {
    const data = baseData([
      testRecord({ id: 'm1', test_date: '2026-09-03', subject: 'Maths', marks_obtained: 70, total_marks: 100 })
    ])
    const rows = getMarksTrend(data, 5000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ Maths: 70, overall: 70 })
  })

  it('keeps absent values as null instead of inventing zeroes', () => {
    const data = baseData([
      testRecord({ id: 'p1', test_date: '2026-09-01', subject: 'Physics', marks_obtained: 60, total_marks: 100 }),
      testRecord({ id: 'blank', test_date: '2026-09-05' })
    ])
    const rows = getMarksTrend(data, 5000)
    expect(rows[0]).toMatchObject({ Physics: 60, Chemistry: null, Maths: null })
    expect(rows[1]).toMatchObject({ overall: null, Physics: null, Chemistry: null, Maths: null })
  })

  it('fills all three subjects from complete full mocks only', () => {
    const scores: TestSubjectScore[] = (['Physics', 'Chemistry', 'Maths'] as const).map((subject, index) => ({
      id: `s${index}`, user_id: USER, test_id: 'mock', subject,
      marks_obtained: 60 + index * 10, total_marks: 100, created_at: NOW, updated_at: NOW
    }))
    const data = baseData([testRecord({ id: 'mock', test_type: 'Full Mock', test_date: '2026-09-10' })], scores)
    const rows = getMarksTrend(data, 5000)
    expect(rows[0]).toMatchObject({ Physics: 60, Chemistry: 70, Maths: 80, overall: 70 })
  })

  it('exposes ISO dates so charts can space points by real time', () => {
    const data = baseData([
      testRecord({ id: 'a', test_date: '2026-08-01', subject: 'Physics', marks_obtained: 50, total_marks: 100 }),
      testRecord({ id: 'b', test_date: '2026-08-14', subject: 'Physics', marks_obtained: 60, total_marks: 100 }),
      testRecord({ id: 'c', test_date: '2026-08-16', subject: 'Physics', marks_obtained: 70, total_marks: 100 })
    ])
    const rows = getMarksTrend(data, 5000)
    const gaps = rows.slice(1).map((row, index) =>
      (new Date(`${row.date}T12:00:00`).getTime() - new Date(`${rows[index]!.date}T12:00:00`).getTime()) / 86_400_000)
    expect(gaps).toEqual([13, 2])
  })
})

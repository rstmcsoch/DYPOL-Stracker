import { describe, expect, it } from 'vitest'
import type {
  AppData, Chapter, Mistake, TestErrorLog, TestRecord, TestSubjectScore, StudySession
} from '../../types/index.js'
import { defaultExamTracks, defaultSettings } from '../defaults.js'
import { advanceRetry, retryDueOn, retryIsDue, startRetry, RETRY_GAP_DAYS } from '../mistake-cause.js'
import { getRepeatOffenders } from '../analytics.js'
import { chapterRepeatOffenders, estimatePercentile, percentileBand, subjectDeltas } from './mock-analysis.js'
import { speedAccuracyBand } from './progress.js'
import { personalRecords, recentBadges } from './records.js'
import { computeStreaks, hasSubjectTargets, honouredFreezes, subjectTargetRows, takeFreezeDay } from './study-time.js'

const USER = '00000000-0000-4000-8000-000000000001'
const TODAY = '2026-10-08'
const NOW = '2026-10-08T06:00:00.000Z'

function chapter(id: string, overrides: Partial<Chapter> = {}): Chapter {
  return {
    id, user_id: USER, subject: 'Physics', name: `Chapter ${id}`, position: 0, status: 'Not Started',
    priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null,
    created_at: NOW, updated_at: NOW, ...overrides
  }
}

function emptyData(overrides: Partial<AppData> = {}): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [],
    goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [],
    studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER),
    settings: defaultSettings(USER), profile: null, ...overrides
  }
}

function testRecord(id: string, overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id, user_id: USER, title: `Test ${id}`, test_date: '2026-10-01', test_type: 'Full Mock', subject: null,
    chapter_id: null, marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null,
    negative_marks: null, time_minutes: null, notes: '', percentile: null, created_at: NOW, updated_at: NOW, ...overrides
  }
}

function mistake(id: string, overrides: Partial<Mistake> = {}): Mistake {
  return {
    id, user_id: USER, chapter_id: 'c1', test_id: null, mistake_type: 'Silly', question_note: 'Q', solution_note: '',
    image_path: null, retry_later: false, retry_status: 'pending', created_at: NOW, updated_at: NOW, ...overrides
  }
}

describe('spaced retry scheduling', () => {
  it('gives a new note its first due date, then the longer one, then retires it', () => {
    expect(startRetry('2026-10-08', 0)).toEqual({ retry_due_on: '2026-10-15', retry_count: 0 })
    expect(advanceRetry('2026-10-08', 0)).toMatchObject({ retry_count: 1, retry_due_on: '2026-10-29', retry_later: true, retry_status: 'pending' })
    expect(advanceRetry('2026-10-08', 1)).toMatchObject({ retry_count: 2, retry_due_on: null, retry_later: false, retry_status: 'retried' })
  })

  it('falls back to created_at for notes saved before retry_due_on existed', () => {
    // 18:30 UTC on 1 Oct is 00:00 IST on 2 Oct, so the first retry is due on 9 Oct IST.
    expect(retryDueOn({ created_at: '2026-10-01T18:30:00.000Z' })).toBe('2026-10-09')
    // A midday timestamp stays on its own IST day.
    expect(retryDueOn({ created_at: '2026-10-01T06:00:00.000Z' })).toBe('2026-10-08')
    expect(retryDueOn({ created_at: '2026-10-01T18:30:00.000Z', retry_count: RETRY_GAP_DAYS.length })).toBeNull()
  })

  it('does not call a note due before its date', () => {
    expect(retryIsDue({ retry_due_on: '2026-10-20', created_at: NOW }, TODAY)).toBe(false)
    expect(retryIsDue({ retry_due_on: '2026-10-01', created_at: NOW }, TODAY)).toBe(true)
  })
})

describe('repeat-offender detection', () => {
  const data = emptyData({
    chapters: [chapter('c1', { name: 'Current Electricity' })],
    mistakes: [
      mistake('m1', { cause: 'Silly mistake', created_at: '2026-10-01T06:00:00.000Z' }),
      mistake('m2', { cause: 'Silly mistake', created_at: '2026-10-04T06:00:00.000Z' }),
      mistake('m3', { cause: 'Silly mistake', created_at: '2026-10-06T06:00:00.000Z' }),
      mistake('m4', { cause: 'Concept gap', created_at: '2026-10-06T06:00:00.000Z' })
    ]
  })

  it('finds a cause repeated three times in one chapter inside the window', () => {
    const rows = getRepeatOffenders(data, TODAY, { days: 30, minCount: 3 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ chapterName: 'Current Electricity', cause: 'Silly mistake', count: 3, spanDays: 6 })
    expect(rows[0]?.to).toBe('/practice?chapter=c1')
  })

  it('ignores rows outside the window', () => {
    expect(getRepeatOffenders(data, TODAY, { days: 2, minCount: 3 })).toEqual([])
  })

  it('counts chapters flagged across two or more of the recent tests', () => {
    const tests: TestRecord[] = ['t1', 't2'].map((id, index) => testRecord(id, { title: `Mock ${index + 1}`, test_date: `2026-10-0${index + 1}` }))
    const logs: TestErrorLog[] = tests.map((test, index) => ({
      id: `l${index}`, user_id: USER, test_id: test.id, subject: 'Physics', category: 'Concept gap', chapter_id: 'c1',
      questions: 2, marks_lost: 8, note: '', created_at: NOW, updated_at: NOW
    }))
    const rows = chapterRepeatOffenders({ ...data, tests, testErrorLogs: logs })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ chapterName: 'Current Electricity', mocks: 2, questions: 4 })
  })
})

describe('subject deltas against the previous mock', () => {
  const score = (testId: string, subject: 'Physics' | 'Chemistry', marks: number): TestSubjectScore => ({
    id: `${testId}-${subject}`, user_id: USER, test_id: testId, subject, marks_obtained: marks, total_marks: 100,
    created_at: NOW, updated_at: NOW
  })
  const data = emptyData({
    tests: [
      testRecord('t1', { title: 'Mock 1', test_date: '2026-09-20' }),
      testRecord('t2', { title: 'Mock 2', test_date: '2026-10-05' })
    ],
    testSubjectScores: [score('t1', 'Physics', 40), score('t2', 'Physics', 55), score('t2', 'Chemistry', 70)]
  })

  it('reports the point change per subject and stays null without an earlier score', () => {
    const rows = subjectDeltas(data.tests[1]!, data)
    expect(rows.find(row => row.subject === 'Physics')).toMatchObject({ current: 55, previous: 40, delta: 15 })
    expect(rows.find(row => row.subject === 'Chemistry')?.delta).toBeNull()
  })
})

describe('practice pace quadrant', () => {
  const base = { sessions: 1, attempted: 30, correct: 20, incorrect: 10, skipped: 0, recentAccuracy: null, timeMinutes: 30 }

  it('splits fast/slow against accurate/loose', () => {
    expect(speedAccuracyBand({ ...base, accuracy: 80, secondsPerQuestion: 60 }, 60)).toBe('fast-accurate')
    expect(speedAccuracyBand({ ...base, accuracy: 80, secondsPerQuestion: 120 }, 60)).toBe('slow-accurate')
    expect(speedAccuracyBand({ ...base, accuracy: 40, secondsPerQuestion: 60 }, 60)).toBe('fast-loose')
    expect(speedAccuracyBand({ ...base, accuracy: 40, secondsPerQuestion: 120 }, 60)).toBe('slow-loose')
  })

  it('stays silent without enough questions or without recorded time', () => {
    expect(speedAccuracyBand({ ...base, attempted: 5, accuracy: 80, secondsPerQuestion: 60 }, 60)).toBeNull()
    expect(speedAccuracyBand({ ...base, accuracy: 80, secondsPerQuestion: null }, 60)).toBeNull()
  })
})

describe('personal records and private milestones', () => {
  const session: StudySession = {
    id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'c1', activity: 'Lecture', mode: 'Pomodoro',
    duration_minutes: 50, started_at: '2026-10-07T06:00:00.000Z', ended_at: '2026-10-07T06:50:00.000Z',
    completion_state: 'completed', created_at: NOW, updated_at: NOW
  }

  it('derives records without inventing missing numbers', () => {
    const records = personalRecords(emptyData({ sessions: [session], chapters: [chapter('c1')] }), TODAY)
    expect(records.find(row => row.id === 'longest-block')?.value).toBe('50m')
    expect(records.find(row => row.id === 'best-test')).toBeUndefined()
  })

  it('awards a streak milestone only once it was actually reached', () => {
    const data = emptyData({ settings: { ...defaultSettings(USER), streak_rest_days: 0 } })
    expect(recentBadges(data, TODAY)).toEqual([])
  })
})

describe('percentile band', () => {
  it('maps a raw score onto the 300-mark band, monotonic and clamped', () => {
    expect(estimatePercentile(0, 300)).toBe(0.5)
    expect(estimatePercentile(300, 300)).toBe(99.9)
    // Same percentage of a different paper should land on the same band.
    expect(estimatePercentile(90, 300)).toBe(estimatePercentile(30, 100))
    const low = estimatePercentile(100, 300)!
    const high = estimatePercentile(200, 300)!
    expect(high).toBeGreaterThan(low)
    expect(estimatePercentile(50, 0)).toBeNull()
  })

  it('prefers the exam-reported percentile over the estimate', () => {
    const data = emptyData()
    const reported = percentileBand(data, testRecord('t1', { marks_obtained: 150, total_marks: 300, percentile: 91.2 }))
    expect(reported.percentile).toBe(91.2)
    expect(reported.label).toBe('Top 10%')
    const estimated = percentileBand(data, testRecord('t2', { marks_obtained: 150, total_marks: 300 }))
    expect(estimated.percentile).toBeCloseTo(90, 0)
    expect(estimated.note).toContain('Estimated')
    expect(percentileBand(data, testRecord('t3'))).toMatchObject({ percentile: null, position: null })
  })
})

describe('per-subject daily targets', () => {
  const settings = { ...defaultSettings(USER), subject_daily_targets: { Physics: 120, Chemistry: 60 } }
  const data = emptyData({
    settings,
    chapters: [chapter('c1', { subject: 'Physics' })],
    sessions: [
      { id: 's1', user_id: USER, subject: 'Physics', chapter_id: 'c1', activity: 'Practice', mode: 'Pomodoro', duration_minutes: 60, started_at: '2026-10-07T06:00:00.000Z', ended_at: '2026-10-07T07:00:00.000Z', completion_state: 'completed', created_at: NOW, updated_at: NOW },
      { id: 's2', user_id: USER, subject: 'Chemistry', chapter_id: null, activity: 'Revision', mode: 'Pomodoro', duration_minutes: 90, started_at: '2026-10-07T08:00:00.000Z', ended_at: '2026-10-07T09:30:00.000Z', completion_state: 'completed', created_at: NOW, updated_at: NOW }
    ]
  })

  it('only reports targets the student set, and caps the bar at 100%', () => {
    expect(hasSubjectTargets(data)).toBe(true)
    const rows = subjectTargetRows(data, '2026-10-07')
    const physics = rows.find(row => row.subject === 'Physics')!
    expect(physics).toMatchObject({ minutes: 60, target: 120 })
    expect(physics.percent).toBe(50)
    expect(rows.find(row => row.subject === 'Chemistry')!.percent).toBe(100)
    expect(rows.find(row => row.subject === 'Maths')?.target ?? null).toBeNull()
  })

  it('stays quiet when no target is set', () => {
    expect(hasSubjectTargets(emptyData())).toBe(false)
  })
})

describe('monthly streak freeze', () => {
  it('honours at most one freeze per calendar month, earliest wins', () => {
    const settings = { ...defaultSettings(USER), streak_freezes_used: ['2026-09-03', '2026-09-19', '2026-10-04'] }
    expect([...honouredFreezes(settings, TODAY)].sort()).toEqual(['2026-09-03', '2026-10-04'])
  })

  it('ignores freezes dated in the future and duplicates on the same day', () => {
    const settings = { ...defaultSettings(USER), streak_freezes_used: ['2026-12-01', '2026-10-07', '2026-10-07'] }
    expect([...honouredFreezes(settings, TODAY)]).toEqual(['2026-10-07'])
  })

  it('a spent freeze bridges the gap so the streak survives the missed day', () => {
    const base = emptyData({
      settings: { ...defaultSettings(USER), streak_rest_days: 0 },
      sessions: [sessionOn('2026-10-06'), sessionOn('2026-10-08')]
    })
    expect(computeStreaks(base, TODAY).current).toBe(1)
    const frozen = { ...base, settings: { ...base.settings, streak_freezes_used: takeFreezeDay(base.settings, '2026-10-07') } }
    expect(computeStreaks(frozen, TODAY).current).toBe(2)
  })
})

function sessionOn(day: string): StudySession {
  return {
    id: `s-${day}`, user_id: USER, subject: 'Physics', chapter_id: 'c1', activity: 'Lecture', mode: 'Pomodoro',
    duration_minutes: 30, started_at: `${day}T06:00:00.000Z`, ended_at: `${day}T06:30:00.000Z`,
    completion_state: 'completed', created_at: NOW, updated_at: NOW
  }
}

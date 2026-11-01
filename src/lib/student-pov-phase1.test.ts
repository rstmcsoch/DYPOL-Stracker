// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { AppData, Chapter, PyqRecord, StudySession, TestErrorLog, TestRecord, TestSubjectScore } from '../types/index.js'
import { defaultExamTracks, defaultSettings, normalizeSettings } from './defaults.js'
import { isValidInputDate, parseDateText, parseTimeText, stepTime } from './date-input.js'
import { settingsFieldErrors, settingsFormSchema, settingsSchema } from './settings-validation.js'
import { getFullMockAggregate, getOverallTestScore } from './analytics.js'
import { chapterStages, pyqProgressCounts, stageCounts } from './jee/progress.js'
import { activeDaysThisWeek, computeStreaks } from './jee/study-time.js'
import { buildWeeklyReport } from './jee/weekly-report.js'
import { actualLostMarks, checkLostMarks, mockInsights } from './jee/mock-analysis.js'
import { testRangeCounts, testRangeSummary, testsToCsv } from './backup.js'
import { plannerTaskHref, shouldIgnoreShortcut } from './shortcuts.js'

const USER = '00000000-0000-4000-8000-000000000001'
const NOW = '2026-10-08T06:00:00.000Z'

function emptyData(overrides: Partial<AppData> = {}): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [],
    goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [],
    studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: defaultExamTracks(USER),
    settings: defaultSettings(USER), profile: null, ...overrides
  }
}
const chapter = (id: string): Chapter => ({
  id, user_id: USER, subject: 'Physics', name: `Chapter ${id}`, position: 0, status: 'Not Started', priority: 'Medium',
  importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null, created_at: NOW, updated_at: NOW
})
const test = (id: string, overrides: Partial<TestRecord> = {}): TestRecord => ({
  id, user_id: USER, title: id, test_date: '2026-10-05', test_type: 'Full Mock', subject: null, chapter_id: null,
  marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
  notes: '', created_at: NOW, updated_at: NOW, ...overrides
})
const score = (testId: string, subject: string, marks: number | null, total: number | null): TestSubjectScore => ({
  id: `${testId}-${subject}`, user_id: USER, test_id: testId, subject, marks_obtained: marks, total_marks: total, created_at: NOW, updated_at: NOW
})
const log = (id: string, subject: string | null, marks: number | null, category: TestErrorLog['category'] = 'Silly mistake'): TestErrorLog => ({
  id, user_id: USER, test_id: 'm1', chapter_id: null, subject, category, marks_lost: marks, questions: null, note: '', created_at: NOW, updated_at: NOW
})
const pyq = (chapterId: string, year: number, exam: PyqRecord['exam'] = 'Main'): PyqRecord => ({
  id: `${chapterId}-${exam}-${year}`, user_id: USER, chapter_id: chapterId, exam, year, status: 'done', questions_total: null,
  questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW
})
const session = (id: string, startedAt: string, minutes: number): StudySession => ({
  id, user_id: USER, subject: 'Physics', chapter_id: null, started_at: startedAt, ended_at: null, duration_minutes: minutes,
  completion_state: 'completed', mode: 'Pomodoro', activity: 'Practice', created_at: NOW, updated_at: NOW
})

describe('item 1/2: date and time parsing', () => {
  it('never turns a typed date into a five-digit year', () => {
    expect(parseDateText('2025-06-15')).toBe('2025-06-15')
    expect(parseDateText('15/06/2025')).toBe('2025-06-15')
    expect(parseDateText('15.06.2025')).toBe('2025-06-15')
    expect(parseDateText('50615-02-02')).toBeNull()
    expect(parseDateText('2025-02-30')).toBeNull()
    expect(isValidInputDate('50615-02-02')).toBe(false)
    expect(isValidInputDate('2025-06-15')).toBe(true)
    expect(isValidInputDate('1800-01-01')).toBe(false)
  })
  it('parses typed and pasted reminder times', () => {
    expect(parseTimeText('8:30')).toBe('08:30')
    expect(parseTimeText('0830')).toBe('08:30')
    expect(parseTimeText('8:30 pm')).toBe('20:30')
    expect(parseTimeText('8pm')).toBe('20:00')
    expect(parseTimeText('20.30')).toBe('20:30')
    expect(parseTimeText('25:00')).toBeNull()
    expect(parseTimeText('hello')).toBeNull()
  })
  it('steps time forward with a positive delta and wraps at midnight', () => {
    expect(stepTime('08:30', 5)).toBe('08:35')
    expect(stepTime('08:30', -5)).toBe('08:25')
    expect(stepTime('23:55', 5)).toBe('00:00')
    expect(stepTime('00:00', -5)).toBe('23:55')
  })
})

describe('items 1, 10, 11: settings form rules', () => {
  const base = defaultSettings(USER)
  it('requires a non-empty display name with a field message', () => {
    const result = settingsFormSchema.safeParse({ ...base, owner_name: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(settingsFieldErrors(result.error).owner_name).toBe('Enter a display name.')
  })
  it('requires a daily goal of at least 1 minute', () => {
    const zero = settingsFormSchema.safeParse({ ...base, owner_name: 'Asha', daily_study_goal_minutes: 0 })
    expect(zero.success).toBe(false)
    if (!zero.success) expect(settingsFieldErrors(zero.error).daily_study_goal_minutes).toBe('Set a daily goal of at least 1 minute.')
    expect(settingsFormSchema.safeParse({ ...base, owner_name: 'Asha', daily_study_goal_minutes: 1 }).success).toBe(true)
  })
  it('keeps the record schema lenient for legacy rows', () => {
    expect(settingsSchema.safeParse({ ...base, owner_name: '' }).success).toBe(true)
  })
  it('accepts up to six extra exams with valid dates and rejects bad ones', () => {
    const ok = settingsFormSchema.safeParse({ ...base, owner_name: 'Asha', extra_exams: [{ id: 'e1', label: 'Board practical', exam_date: '2027-02-10' }, { id: 'e2', label: 'Olympiad', exam_date: '' }] })
    expect(ok.success).toBe(true)
    expect(settingsSchema.safeParse({ ...base, extra_exams: [{ id: 'e1', label: 'X', exam_date: '50615-02-02' }] }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...base, extra_exams: Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, label: 'X', exam_date: '' })) }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...base, extra_exams: [{ id: 'e1', label: '  ', exam_date: '' }] }).success).toBe(false)
  })
  it('normalizes missing or malformed extra exams to an empty list', () => {
    expect(normalizeSettings({ ...base, extra_exams: undefined }, USER).extra_exams).toEqual([])
    expect(normalizeSettings({ ...base, extra_exams: 'nope' }, USER).extra_exams).toEqual([])
  })
})

describe('item 5: lost-marks classification is capped at real lost marks', () => {
  const mock = test('m1', { marks_obtained: 150, total_marks: 200 })
  const scores = [score('m1', 'Physics', 90, 100), score('m1', 'Biology', 60, 100)]
  it('knows the actual marks lost per subject and overall', () => {
    const data = emptyData({ tests: [mock], testSubjectScores: scores })
    expect(actualLostMarks(mock, data, 'Physics')).toBe(10)
    expect(actualLostMarks(mock, data, 'Biology')).toBe(40)
    expect(actualLostMarks(mock, data, null)).toBe(50)
  })
  it('rejects classifying more than the subject lost, counting earlier classifications', () => {
    const data = emptyData({ tests: [mock], testSubjectScores: scores, testErrorLogs: [log('a', 'Physics', 6)] })
    expect(checkLostMarks(mock, data, 'Physics', 4).ok).toBe(true)
    const over = checkLostMarks(mock, data, 'Physics', 5)
    expect(over.ok).toBe(false)
    expect(over.message).toContain('Only 10 marks were lost in Physics')
    expect(over.remaining).toBe(4)
    // Editing the existing row excludes it from the "already classified" sum.
    expect(checkLostMarks(mock, data, 'Physics', 10, 'a').ok).toBe(true)
  })
  it('caps unspecified-subject classifications at the overall loss', () => {
    const data = emptyData({ tests: [mock], testSubjectScores: scores })
    expect(checkLostMarks(mock, data, null, 50).ok).toBe(true)
    expect(checkLostMarks(mock, data, null, 51).ok).toBe(false)
  })
  it('never quotes an inflated lost-marks number in "Fix before your next mock"', () => {
    const data = emptyData({ tests: [mock], testSubjectScores: scores, testErrorLogs: [log('a', 'Physics', 80)] })
    const text = mockInsights(mock, data).map(item => item.text).join('\n')
    expect(text).not.toContain('80')
    expect(text).toContain('Physics lost 10 marks')
  })
})

describe('item 6: Full Mock with marks equal to totals', () => {
  it('aggregates non-JEE subjects at full marks and ignores total-only rows', () => {
    const rows = [score('m', 'Physics', 100, 100), score('m', 'Chemistry', 100, 100), score('m', 'Biology', 100, 100), score('m', 'English', 100, 100)]
    expect(getFullMockAggregate('m', rows)).toEqual({ marks: 400, total: 400 })
    // A prefilled total with no marks typed does not block the overall result.
    expect(getFullMockAggregate('m', [...rows.slice(0, 3), score('m', 'Maths', null, 100)])).toEqual({ marks: 300, total: 300 })
    expect(getOverallTestScore(test('m'), [...rows, score('m', 'Maths', null, 100)])).toEqual({ marks: 400, total: 400 })
  })
  it('keeps the JEE rule: Physics/Chemistry/Maths mocks need all three', () => {
    expect(getFullMockAggregate('j', [score('j', 'Physics', 100, 100), score('j', 'Chemistry', 100, 100)])).toBeNull()
    expect(getFullMockAggregate('j', [score('j', 'Physics', 100, 100), score('j', 'Chemistry', 100, 100), score('j', 'Maths', 100, 100)])).toEqual({ marks: 300, total: 300 })
  })
})

describe('item 8: PYQ years marked done count', () => {
  it('counts a single done year immediately, for JEE and non-JEE exams', () => {
    const jee = emptyData({ chapters: [chapter('c1')], pyqRecords: [pyq('c1', 2024)] })
    expect(pyqProgressCounts(jee)).toEqual({ doneYears: 1, startedChapters: 1, completeChapters: 0 })
    const neet = emptyData({ chapters: [chapter('c1')], pyqRecords: [pyq('c1', 2024)], settings: { ...defaultSettings(USER), exam_id: 'neet-ug' } })
    expect(pyqProgressCounts(neet).doneYears).toBe(1)
  })
  it('completes the PYQ stage for non-JEE exams from the single column only', () => {
    const settings = { ...defaultSettings(USER), exam_id: 'mht-cet', pyq_from_year: 2024, pyq_to_year: 2025 }
    const data = emptyData({ chapters: [chapter('c1')], pyqRecords: [pyq('c1', 2024), pyq('c1', 2025)], settings })
    expect(chapterStages(data, chapter('c1')).find(stage => stage.key === 'pyqs')?.done).toBe(true)
    expect(stageCounts(data).pyqs).toBe(1)
    expect(pyqProgressCounts(data).completeChapters).toBe(1)
  })
  it('ignores years outside the window and records for deleted chapters', () => {
    const settings = { ...defaultSettings(USER), pyq_from_year: 2024, pyq_to_year: 2025 }
    const data = emptyData({ chapters: [chapter('c1')], pyqRecords: [pyq('c1', 2010), pyq('gone', 2024)], settings })
    expect(pyqProgressCounts(data).doneYears).toBe(0)
  })
})

describe('item 9: one active-days rule for Home and Analytics', () => {
  it('Home rhythm and the weekly report agree (Monday-start IST week, streak rule)', () => {
    const today = '2026-10-08' // Thursday
    const data = emptyData({
      sessions: [
        session('s1', '2026-10-05T04:00:00.000Z', 30), // Mon: qualifies
        session('s2', '2026-10-06T04:00:00.000Z', 5), // Tue: under 15 minutes, does not qualify
        session('s3', '2026-10-02T04:00:00.000Z', 60) // previous Friday: outside this week
      ],
      tests: [test('t', { test_date: '2026-10-07', test_type: 'Chapter Test' }), test('future', { test_date: '2026-10-10', test_type: 'Chapter Test' })]
    })
    expect(activeDaysThisWeek(data, today)).toBe(2)
    expect(computeStreaks(data, today).weeklyConsistency).toBe(2)
    expect(buildWeeklyReport(data, today).activeDays).toBe(2)
  })
})

describe('item 12: backup range counts explain skipped tests', () => {
  const tests = [test('a', { test_date: '2026-10-01' }), test('b', { test_date: '2026-10-20' }), test('c', { test_date: '2026-12-31' })]
  it('counts tests kept and skipped on each side of the range', () => {
    expect(testRangeCounts(tests, '', '2026-11-01')).toEqual({ total: 3, included: 2, before: 0, after: 1 })
    expect(testRangeCounts(tests, '2026-10-10', '2026-11-01')).toEqual({ total: 3, included: 1, before: 1, after: 1 })
    expect(testRangeSummary(testRangeCounts(tests, '', '2026-11-01'), '', '2026-11-01')).toBe('2 of 3 tests fall in this range · 1 dated after 2026-11-01 is skipped.')
    expect(testRangeSummary(testRangeCounts(tests, '', ''), '', '')).toBe('All 3 tests fall in this range.')
  })
  it('matches what the CSV export actually contains', () => {
    const data = emptyData({ tests })
    const rows = testsToCsv(data, '', '2026-11-01').trim().split('\n').length - 1
    expect(rows).toBe(testRangeCounts(tests, '', '2026-11-01').included)
  })
})

describe('item 13: single-key shortcuts', () => {
  const key = (target: EventTarget | null, extra: Partial<KeyboardEvent> = {}) => ({ key: 't', target, ...extra })
  it('ignores keys typed into inputs, inside dialogs, or while an overlay is open', () => {
    document.body.innerHTML = '<input id="i" /><div role="dialog"><button id="b">x</button></div><p id="p">text</p>'
    const input = document.getElementById('i')!
    expect(shouldIgnoreShortcut(key(input), false)).toBe(true)
    expect(shouldIgnoreShortcut(key(document.getElementById('b')), false)).toBe(true)
    // Any open dialog on the page blocks shortcuts, even if focus is outside it.
    expect(shouldIgnoreShortcut(key(document.getElementById('p')), false)).toBe(true)
    document.body.innerHTML = '<p id="p">text</p>'
    expect(shouldIgnoreShortcut(key(document.getElementById('p')), false)).toBe(false)
    expect(shouldIgnoreShortcut(key(document.getElementById('p')), true)).toBe(true)
    expect(shouldIgnoreShortcut(key(document.getElementById('p'), { repeat: true }), false)).toBe(true)
    expect(shouldIgnoreShortcut(key(document.getElementById('p'), { isComposing: true }), false)).toBe(true)
    expect(shouldIgnoreShortcut(key(document.getElementById('p'), { metaKey: true }), false)).toBe(true)
  })
})

describe('item 3: Cmd+K task results deep-link to the task', () => {
  it('points at the task week and id', () => {
    expect(plannerTaskHref({ id: 't1', task_date: '2030-12-31' })).toBe('/planner?date=2030-12-31&task=t1')
  })
})

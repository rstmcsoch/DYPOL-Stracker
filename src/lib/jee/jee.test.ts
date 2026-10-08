import { describe, expect, it } from 'vitest'
import type {
  AppData, BacklogItem, Chapter, ChapterStage, Mistake, PracticeSession, PyqRecord, Revision, StudyCard,
  StudySession, TestErrorLog, TestRecord, TestSubjectScore, TestTimeEntry
} from '../../types/index.js'
import { defaultExamTracks, defaultSettings } from '../defaults.js'
import { aggregatePractice, chapterPipelinePercent, chapterStages, pyqCompletion, syllabusProgress } from './progress.js'
import { currentExamMode, daysUntilExam, trackReadiness } from './exam.js'
import { recommendStudyNow } from './recommend.js'
import { computeStreaks, studyMinutesByActivity } from './study-time.js'
import { mockInsights, categoryTotals, subjectTimeRows } from './mock-analysis.js'
import { buildWeeklyReport } from './weekly-report.js'
import { computeReminders, shouldFireToday } from './reminders.js'
import { nextIntervalDays, reviewCard, dueCards } from './cards.js'

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

function practice(id: string, overrides: Partial<PracticeSession>): PracticeSession {
  return {
    id, user_id: USER, chapter_id: 'c1', practice_date: TODAY, attempted: 10, correct: 8, incorrect: 2,
    source: 'DPP', time_minutes: null, notes: '', created_at: NOW, updated_at: NOW, ...overrides
  }
}

describe('weighted progress', () => {
  it('keeps raw and weighted equal at default medium importance, and diverges when importance changes', () => {
    const chapters = [chapter('a', { status: 'Done' }), chapter('b', { status: 'Not Started' })]
    const settings = defaultSettings(USER)
    const equal = syllabusProgress(chapters, settings)
    expect(equal.raw).toBe(50)
    expect(equal.weighted).toBe(50)

    const weighted = syllabusProgress([chapter('a', { status: 'Done', importance: 'high' }), chapter('b', { importance: 'low' })], settings)
    expect(weighted.raw).toBe(50)
    // high = 2, low = 0.5 → 2 / 2.5 = 80%
    expect(weighted.weighted).toBeCloseTo(80, 5)
  })

  it('reads weights from settings, not from hardcoded constants', () => {
    const settings = { ...defaultSettings(USER), weight_high: 4 }
    const result = syllabusProgress([chapter('a', { status: 'Done', importance: 'high' }), chapter('b', { importance: 'medium' })], settings)
    expect(result.weighted).toBeCloseTo(80, 5) // 4 / (4 + 1)
  })
})

describe('practice log aggregation', () => {
  it('computes the spec example: 120 attempted, 92 correct, 28 incorrect → 76.7%', () => {
    const agg = aggregatePractice([practice('p1', { attempted: 120, correct: 92, incorrect: 28 })])
    expect(agg.accuracy).toBeCloseTo(76.67, 1)
    expect(agg.attempted).toBe(120)
    expect(agg.incorrect).toBe(28)
  })

  it('reports recent accuracy from the last three blocks only', () => {
    const agg = aggregatePractice([
      practice('old', { practice_date: '2026-09-01', attempted: 10, correct: 1, incorrect: 9 }),
      practice('n1', { practice_date: '2026-10-07', attempted: 10, correct: 10, incorrect: 0 }),
      practice('n2', { practice_date: '2026-10-06', attempted: 10, correct: 10, incorrect: 0 }),
      practice('n3', { practice_date: '2026-10-05', attempted: 10, correct: 10, incorrect: 0 })
    ])
    expect(agg.recentAccuracy).toBe(100)
    expect(agg.accuracy).toBeCloseTo(77.5, 5)
  })

  it('returns null accuracy when nothing was attempted', () => {
    expect(aggregatePractice([]).accuracy).toBeNull()
  })
})

describe('PYQ tracker', () => {
  it('counts done years in the configured window and lists pending years', () => {
    const settings = { ...defaultSettings(USER), pyq_from_year: 2022, pyq_to_year: 2026 }
    const records: PyqRecord[] = [2026, 2025, 2024].map(year => ({
      id: `q${year}`, user_id: USER, chapter_id: 'c1', exam: 'Main', year, status: 'done', questions_total: null,
      questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW
    }))
    const completion = pyqCompletion(records, 'c1', 'Main', settings)
    expect(completion.done).toBe(3)
    expect(completion.total).toBe(5)
    expect(completion.percent).toBe(60)
    expect(completion.pendingYears).toEqual([2023, 2022])
  })

  it('does not count a row another chapter or exam owns', () => {
    const settings = { ...defaultSettings(USER), pyq_from_year: 2025, pyq_to_year: 2025 }
    const records: PyqRecord[] = [{
      id: 'x', user_id: USER, chapter_id: 'other', exam: 'Advanced', year: 2025, status: 'done', questions_total: null,
      questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW
    }]
    expect(pyqCompletion(records, 'c1', 'Main', settings).done).toBe(0)
  })
})

describe('chapter stages', () => {
  it('lets Tested be true before Notes, and derives Revised and Tested from real evidence', () => {
    const c = chapter('c1')
    const test: TestRecord = {
      id: 't1', user_id: USER, title: 'Ch test', test_date: TODAY, test_type: 'Chapter Test', subject: 'Physics', chapter_id: 'c1',
      marks_obtained: 20, total_marks: 40, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
      notes: '', created_at: NOW, updated_at: NOW
    }
    const data = emptyData({ chapters: [c], tests: [test] })
    const stages = chapterStages(data, c)
    const byKey = Object.fromEntries(stages.map(stage => [stage.key, stage]))
    expect(byKey.tested?.done).toBe(true)
    expect(byKey.tested?.source).toBe('evidence')
    expect(byKey.notes?.done).toBe(false)
    expect(byKey.revised?.done).toBe(false)
  })

  it('computes PYQ stage progress as a fraction and keeps other stages binary', () => {
    const c = chapter('c1')
    const settings = { ...defaultSettings(USER), pyq_from_year: 2025, pyq_to_year: 2026 }
    const records: PyqRecord[] = [{
      id: 'q', user_id: USER, chapter_id: 'c1', exam: 'Main', year: 2026, status: 'done', questions_total: null,
      questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW
    }]
    const data = emptyData({ chapters: [c], pyqRecords: records, settings })
    const pyqs = chapterStages(data, c).find(stage => stage.key === 'pyqs')!
    expect(pyqs.progress).toBeCloseTo(0.25, 5) // 1 of 4 (2 years × 2 exams)
    expect(pyqs.done).toBe(false)
    expect(chapterPipelinePercent(chapterStages(data, c))).toBeGreaterThan(0)
  })

  it('honours a manual Notes toggle', () => {
    const c = chapter('c1')
    const row: ChapterStage = { id: 's', user_id: USER, chapter_id: 'c1', stage: 'notes', done: true, completed_at: NOW, created_at: NOW, updated_at: NOW }
    const notes = chapterStages(emptyData({ chapters: [c], chapterStages: [row] }), c).find(stage => stage.key === 'notes')!
    expect(notes.done).toBe(true)
    expect(notes.source).toBe('manual')
  })
})

describe('exam mode and countdown', () => {
  it('turns on automatically inside the final 30 days and stays off outside it', () => {
    const settings = { ...defaultSettings(USER), main_exam_date: '2026-11-01', active_track: 'main1' as const }
    const inside = currentExamMode(emptyData({ settings }), TODAY)
    expect(inside.active).toBe(true)
    expect(inside.daysLeft).toBe(24)
    const outside = currentExamMode(emptyData({ settings: { ...settings, main_exam_date: '2027-03-01' } }), TODAY)
    expect(outside.active).toBe(false)
  })

  it('respects manual off, manual on, and never auto-activates without a date', () => {
    expect(currentExamMode(emptyData({ settings: { ...defaultSettings(USER), exam_mode: 'off', main_exam_date: '2026-10-20' } }), TODAY).active).toBe(false)
    expect(currentExamMode(emptyData({ settings: { ...defaultSettings(USER), exam_mode: 'on' } }), TODAY).active).toBe(true)
    expect(currentExamMode(emptyData(), TODAY).active).toBe(false)
  })

  it('counts days from the track date, including Session 2 from its own track row', () => {
    const data = emptyData({ settings: { ...defaultSettings(USER), active_track: 'main2' } })
    data.examTracks = data.examTracks.map(row => row.track === 'main2' ? { ...row, exam_date: '2026-10-18' } : row)
    expect(daysUntilExam(data.examTracks.find(row => row.track === 'main2')!.exam_date, TODAY)).toBe(10)
    expect(currentExamMode(data, TODAY).daysLeft).toBe(10)
  })

  it('computes per-track readiness from shared data and skips PYQs for Boards', () => {
    const data = emptyData({ chapters: [chapter('a', { status: 'Done' })] })
    const boards = trackReadiness(data, 'boards', TODAY)
    expect(boards.components.find(item => item.label === 'PYQs')?.value).toBeNull()
    expect(boards.percent).toBe(100)
  })
})

describe('What should I study now?', () => {
  const revisionFor = (id: string, chapterId: string, dueOn: string): Revision => ({
    id, user_id: USER, chapter_id: chapterId, revision_number: 1, due_on: dueOn, completed_at: null, created_at: NOW, updated_at: NOW
  })

  it('ranks an overdue revision above a low-priority idea and explains the choice', () => {
    const data = emptyData({
      chapters: [chapter('elec', { name: 'Electrostatics', priority: 'High', status: 'Studying', importance: 'high' }), chapter('units', { name: 'Units & Measurements' })],
      revisions: [revisionFor('r1', 'elec', '2026-10-03')]
    })
    const result = recommendStudyNow(data, TODAY)
    expect(result.primary?.chapterId).toBe('elec')
    expect(result.primary?.summary).toContain('Study Electrostatics')
    expect(result.primary?.reasons.join(' ')).toMatch(/overdue/)
    expect(result.primary?.reasons.join(' ')).toMatch(/high priority/)
  })

  it('is deterministic for the same data and day', () => {
    const data = emptyData({
      chapters: [chapter('a', { name: 'A' }), chapter('b', { name: 'B' })],
      revisions: [revisionFor('r1', 'a', TODAY), revisionFor('r2', 'b', TODAY)]
    })
    expect(recommendStudyNow(data, TODAY)).toEqual(recommendStudyNow(data, TODAY))
  })

  it('surfaces a chapter with weak practice accuracy and a high incorrect count', () => {
    const data = emptyData({
      chapters: [chapter('elec', { name: 'Electrostatics', status: 'Studying' })],
      practiceSessions: [practice('p', { chapter_id: 'elec', attempted: 120, correct: 70, incorrect: 50 })]
    })
    const result = recommendStudyNow(data, TODAY)
    expect(result.primary?.kind).toBe('weak-chapter')
    expect(result.primary?.reasons.join(' ')).toMatch(/practice accuracy is 58%/)
  })

  it('in exam mode, does not recommend starting new chapters', () => {
    const data = emptyData({
      chapters: [chapter('new', { name: 'Fresh', priority: 'High' })],
      settings: { ...defaultSettings(USER), exam_mode: 'on' }
    })
    expect(recommendStudyNow(data, TODAY).alternatives.find(item => item.kind === 'start-chapter')).toBeUndefined()
  })

  it('returns an honest empty reason when there is nothing urgent', () => {
    const result = recommendStudyNow(emptyData({ chapters: [chapter('a')] }), TODAY)
    expect(result.primary).toBeNull()
    expect(result.emptyReason).toMatch(/Nothing is urgent/)
  })

  it('surfaces lost marks from recorded mock analysis', () => {
    const data = emptyData({
      chapters: [chapter('x')],
      testErrorLogs: [{ id: 'e', user_id: USER, test_id: 't', chapter_id: null, subject: 'Maths', category: 'Time pressure', marks_lost: 21, questions: null, note: '', created_at: NOW, updated_at: NOW }]
    })
    const result = recommendStudyNow(data, TODAY)
    expect(result.primary?.kind).toBe('mock-fix')
    expect(result.primary?.to).toBe('/mock-analysis')
  })
})

describe('study time split and streaks', () => {
  const session = (id: string, day: string, minutes: number, activity?: StudySession['activity']): StudySession => ({
    id, user_id: USER, subject: 'Physics', chapter_id: null, started_at: `${day}T05:00:00.000Z`, ended_at: null,
    duration_minutes: minutes, completion_state: 'completed', mode: 'Pomodoro', activity: activity ?? 'Practice', created_at: NOW, updated_at: NOW
  })

  it('splits minutes by activity for a range', () => {
    const data = emptyData({ sessions: [session('1', TODAY, 80, 'Lecture'), session('2', TODAY, 125, 'Practice'), session('3', TODAY, 45, 'Revision')] })
    const split = studyMinutesByActivity(data, TODAY, TODAY)
    expect(split.Lecture).toBe(80)
    expect(split.Practice).toBe(125)
    expect(split.Revision).toBe(45)
    expect(split.total).toBe(250)
  })

  it('does not count a day with only a few minutes toward the streak', () => {
    const data = emptyData({ sessions: [session('1', TODAY, 5)] })
    expect(computeStreaks(data, TODAY).current).toBe(0)
  })

  it('counts consecutive qualifying days and a practice log with questions', () => {
    const data = emptyData({
      sessions: [session('1', '2026-10-07', 30)],
      practiceSessions: [practice('p', { practice_date: TODAY, attempted: 5, correct: 4, incorrect: 1 })]
    })
    expect(computeStreaks(data, TODAY).current).toBe(2)
  })

  it('keeps a streak alive through today while today has not yet qualified', () => {
    const data = emptyData({ sessions: [session('1', '2026-10-07', 30), session('2', '2026-10-06', 30)] })
    expect(computeStreaks(data, TODAY).current).toBe(2)
  })
})

describe('mock deep-dive', () => {
  const test: TestRecord = {
    id: 'mock1', user_id: USER, title: 'Full mock 1', test_date: TODAY, test_type: 'Full Mock', subject: null, chapter_id: null,
    marks_obtained: null, total_marks: null, correct: null, wrong: null, skipped: null, negative_marks: null, time_minutes: null,
    notes: '', created_at: NOW, updated_at: NOW
  }
  it('explains where Maths marks went using only recorded classifications', () => {
    const logs: TestErrorLog[] = [{ id: 'e1', user_id: USER, test_id: 'mock1', chapter_id: null, subject: 'Maths', category: 'Time pressure', marks_lost: 21, questions: 7, note: '', created_at: NOW, updated_at: NOW }]
    const insights = mockInsights(test, emptyData({ tests: [test], testErrorLogs: logs }))
    expect(insights.map(item => item.text).join(' ')).toMatch(/Maths lost 21 marks; 100% of that came from time pressure/)
  })

  it('does not invent time values when none were recorded', () => {
    const scores: TestSubjectScore[] = [{ id: 's', user_id: USER, test_id: 'mock1', subject: 'Physics', marks_obtained: 40, total_marks: 100, created_at: NOW, updated_at: NOW }]
    const rows = subjectTimeRows(test, emptyData({ tests: [test], testSubjectScores: scores }))
    expect(rows[0]?.minutes).toBeNull()
    expect(rows[0]?.marksPerMinute).toBeNull()
  })

  it('reports time per subject when it was entered', () => {
    const entries: TestTimeEntry[] = [{ id: 'te', user_id: USER, test_id: 'mock1', subject: 'Maths', label: '', minutes: 60, attempted: 20, unattempted: 5, order_index: 0, created_at: NOW, updated_at: NOW }]
    const rows = subjectTimeRows(test, emptyData({ tests: [test], testTimeEntries: entries }))
    const maths = rows.find(row => row.subject === 'Maths')!
    expect(maths.minutes).toBe(60)
    expect(maths.unattempted).toBe(5)
  })

  it('tallies error categories', () => {
    const logs: TestErrorLog[] = [
      { id: 'a', user_id: USER, test_id: 'mock1', chapter_id: null, subject: 'Physics', category: 'Silly mistake', marks_lost: 4, questions: 2, note: '', created_at: NOW, updated_at: NOW },
      { id: 'b', user_id: USER, test_id: 'mock1', chapter_id: null, subject: 'Maths', category: 'Silly mistake', marks_lost: null, questions: null, note: '', created_at: NOW, updated_at: NOW }
    ]
    const totals = categoryTotals(logs)
    expect(totals).toHaveLength(1)
    expect(totals[0]).toMatchObject({ category: 'Silly mistake', entries: 2, marksLost: 4, questions: 2 })
  })
})

describe('weekly report', () => {
  it('does not fabricate a comparison without previous-week history', () => {
    const report = buildWeeklyReport(emptyData({
      practiceSessions: [practice('p', { practice_date: TODAY, attempted: 20, correct: 16, incorrect: 4 })]
    }), TODAY)
    expect(report.comparisons).toEqual([])
    expect(report.historyNote).toMatch(/Not enough history/)
    expect(report.questionsAttempted).toBe(20)
    expect(report.practiceAccuracy).toBe(80)
  })

  it('reports a real subject drop when both weeks have data', () => {
    const chapterMaths = chapter('m', { subject: 'Maths', name: 'Integrals' })
    const prior: PracticeSession = practice('prev', { chapter_id: 'm', practice_date: '2026-10-01', attempted: 20, correct: 16, incorrect: 4 })
    const now: PracticeSession = practice('now', { chapter_id: 'm', practice_date: TODAY, attempted: 20, correct: 12, incorrect: 8 })
    const report = buildWeeklyReport(emptyData({ chapters: [chapterMaths], practiceSessions: [prior, now] }), TODAY)
    expect(report.comparisons.join(' ')).toMatch(/Maths performance dropped 20 points/)
  })
})

describe('reminders and flashcards', () => {
  it('only emits enabled reminder types backed by real counts', () => {
    const settings = { ...defaultSettings(USER), reminders_enabled: true, reminder_types: ['revision' as const] }
    const revision: Revision = { id: 'r', user_id: USER, chapter_id: 'c', revision_number: 1, due_on: '2026-10-01', completed_at: null, created_at: NOW, updated_at: NOW }
    const items = computeReminders(emptyData({ settings, revisions: [revision] }), TODAY)
    expect(items.map(item => item.kind)).toEqual(['revision'])
  })

  it('fires a daily reminder at most once per IST day', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    const after = new Date('2026-10-08T03:00:00.000Z') // 08:30 IST
    expect(shouldFireToday('08:00', after, storage)).toBe(true)
    expect(shouldFireToday('08:00', after, storage)).toBe(false)
    expect(shouldFireToday('22:00', new Date('2026-10-09T03:00:00.000Z'), storage)).toBe(false)
  })

  it('schedules known cards along R1 → R7 → R30 and returns difficult cards tomorrow', () => {
    const gaps = [1, 7, 30]
    expect(nextIntervalDays(0, gaps)).toBe(1)
    expect(nextIntervalDays(1, gaps)).toBe(7)
    expect(nextIntervalDays(5, gaps)).toBe(30)
    const card: StudyCard = { id: 'k', user_id: USER, chapter_id: 'c', kind: 'formula', front: 'F', back: 'B', hint: '', position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW }
    const reviewed = reviewCard(card, 'known', gaps, new Date('2026-10-08T06:00:00.000Z'))
    expect(reviewed.next_review_at?.slice(0, 10)).toBe('2026-10-09')
    expect(reviewed.reviews).toBe(1)
    const difficult = reviewCard(reviewed, 'difficult', gaps, new Date('2026-10-08T06:00:00.000Z'))
    expect(difficult.next_review_at?.slice(0, 10)).toBe('2026-10-09')
    expect(difficult.reviews).toBe(1)
  })

  it('treats new cards as due and scheduled cards as waiting', () => {
    const base: StudyCard = { id: 'n', user_id: USER, chapter_id: 'c', kind: 'flashcard', front: 'Q', back: 'A', hint: '', position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW }
    const scheduled = { ...base, id: 's', next_review_at: '2026-10-20T00:00:00.000Z' }
    expect(dueCards([base, scheduled], TODAY).map(card => card.id)).toEqual(['n'])
  })
})

describe('mistake retry inputs', () => {
  it('a pending retry on a chapter is picked up by the engine', () => {
    const mistake: Mistake = {
      id: 'm', user_id: USER, chapter_id: 'c', test_id: null, mistake_type: 'Concept', question_note: 'Q', solution_note: '',
      image_path: null, retry_later: true, retry_status: 'pending', created_at: NOW, updated_at: NOW
    }
    const result = recommendStudyNow(emptyData({ chapters: [chapter('c', { name: 'Gauss law' })], mistakes: [mistake] }), TODAY)
    expect(result.primary?.kind).toBe('retry-mistakes')
  })
})

describe('backlog wake-up', () => {
  it('a snoozed backlog item stays hidden until its wake date', () => {
    const item: BacklogItem = {
      id: 'b', user_id: USER, title: 'Lecture 8', type: 'Lecture', subject: 'Physics', chapter_id: null, priority: 'High',
      due_on: null, status: 'snoozed', snoozed_until: '2026-10-10', completed_at: null, notes: '', created_at: NOW, updated_at: NOW
    }
    expect(recommendStudyNow(emptyData({ backlogItems: [item] }), TODAY).primary?.kind).not.toBe('backlog')
    expect(recommendStudyNow(emptyData({ backlogItems: [item] }), '2026-10-10').primary?.kind).toBe('backlog')
  })
})

import { validateBacklog, validatePractice } from './forms.js'

describe('form validation', () => {
  const base = { chapterId: 'c1', date: TODAY, attempted: '120', correct: '92', incorrect: '28', source: 'DPP' as const, minutes: '', notes: '' }
  it('accepts the spec example and rejects over-counted answers', () => {
    const ok = validatePractice(base, TODAY)
    expect(ok.ok).toBe(true)
    const bad = validatePractice({ ...base, correct: '100', incorrect: '40' }, TODAY)
    expect(bad.ok).toBe(false)
    expect(bad.errors.incorrect).toMatch(/cannot add up/)
  })
  it('rejects future dates, missing chapters and fractional counts', () => {
    expect(validatePractice({ ...base, date: '2027-01-01' }, TODAY).errors.date).toMatch(/future/)
    expect(validatePractice({ ...base, chapterId: '' }, TODAY).errors.chapterId).toBeTruthy()
    expect(validatePractice({ ...base, attempted: '12.5' }, TODAY).errors.attempted).toBeTruthy()
  })
  it('requires a backlog title and validates an optional due date', () => {
    expect(validateBacklog({ title: '  ', type: 'Lecture', subject: '', chapterId: '', priority: 'Medium', dueOn: '', notes: '' }).errors.title).toBeTruthy()
    expect(validateBacklog({ title: 'Lecture 8', type: 'Lecture', subject: 'Physics', chapterId: '', priority: 'High', dueOn: '', notes: '' }).ok).toBe(true)
    expect(validateBacklog({ title: 'x', type: 'DPP', subject: '', chapterId: '', priority: 'Low', dueOn: '2026-13-40', notes: '' }).errors.dueOn).toBeTruthy()
  })
})

import { createBackup, validateBackupText } from '../backup.js'
import { relatedRowsForRemoval } from '../data-relations.js'
import { practiceStudySessionId } from './ids.js'

const CH = '11111111-1111-4111-8111-111111111111'
const PR = '22222222-2222-4222-8222-222222222222'

describe('backup and relations for new collections', () => {
  it('round-trips practice, PYQ, stage, backlog, card, mock and track rows through the backup format', () => {
    const c = chapter(CH, { name: 'Gauss' })
    const data = emptyData({
      chapters: [c],
      practiceSessions: [practice(PR, { chapter_id: CH })],
      pyqRecords: [{ id: '7d1f0c1e-0000-4000-8000-000000000001', user_id: USER, chapter_id: CH, exam: 'Main', year: 2025, status: 'done', questions_total: null, questions_done: null, meta: null, completed_at: NOW, created_at: NOW, updated_at: NOW }],
      chapterStages: [{ id: '7d1f0c1e-0000-4000-8000-000000000002', user_id: USER, chapter_id: CH, stage: 'notes', done: true, completed_at: NOW, created_at: NOW, updated_at: NOW }],
      backlogItems: [{ id: '7d1f0c1e-0000-4000-8000-000000000003', user_id: USER, title: 'Lecture 5', type: 'Lecture', subject: 'Physics', chapter_id: CH, priority: 'High', due_on: null, status: 'active', snoozed_until: null, completed_at: null, notes: '', created_at: NOW, updated_at: NOW }],
      studyCards: [{ id: '7d1f0c1e-0000-4000-8000-000000000004', user_id: USER, chapter_id: CH, kind: 'formula', front: 'F', back: 'B', hint: '', position: 0, difficulty: null, reviews: 0, last_reviewed_at: null, next_review_at: null, created_at: NOW, updated_at: NOW }],
      examTracks: defaultExamTracks(USER).map(row => row.track === 'boards' ? { ...row, exam_date: '2027-02-15' } : row)
    })
    const backup = createBackup(data)
    const preview = validateBackupText(JSON.stringify(backup), emptyData())
    expect(preview.invalid).toEqual([])
    expect(preview.counts.practiceSessions).toBe(1)
    expect(preview.counts.pyqRecords).toBe(1)
    expect(preview.counts.backlogItems).toBe(1)
    expect(preview.backup.examTracks?.find(row => row.track === 'boards')?.exam_date).toBe('2027-02-15')
  })

  it('reads older backups that predate the new collections without losing their records', () => {
    const legacy = createBackup(emptyData({ chapters: [chapter(CH, { name: 'Old' })] }))
    const { practiceSessions, pyqRecords, chapterStages, backlogItems, studyCards, testErrorLogs, testTimeEntries, examTracks, ...rest } = legacy
    void practiceSessions; void pyqRecords; void chapterStages; void backlogItems; void studyCards; void testErrorLogs; void testTimeEntries; void examTracks
    const preview = validateBackupText(JSON.stringify(rest), emptyData())
    expect(preview.counts.chapters).toBe(1)
    expect(preview.invalid).toEqual([])
  })

  it('removing a practice block also removes its mirrored study time, so undo restores both', () => {
    const block = practice('p9', { chapter_id: CH })
    const mirror: StudySession = {
      id: practiceStudySessionId('p9'), user_id: USER, subject: 'Physics', chapter_id: CH, started_at: `${TODAY}T12:00:00.000+05:30`, ended_at: null,
      duration_minutes: 45, completion_state: 'completed', mode: 'Custom', activity: 'Practice', created_at: NOW, updated_at: NOW
    }
    const data = emptyData({ practiceSessions: [block], sessions: [mirror] })
    const changes = relatedRowsForRemoval(data, 'practice_sessions', 'p9')
    expect(changes.map(change => change.table)).toEqual(['study_sessions'])
    expect(changes[0]?.next).toBeNull()
  })

  it('splits study time by activity from the same sessions used for streaks', () => {
    const lecture: StudySession = {
      id: 'l', user_id: USER, subject: 'Physics', chapter_id: null, started_at: `${TODAY}T05:00:00.000Z`, ended_at: null,
      duration_minutes: 80, completion_state: 'completed', mode: 'Pomodoro', activity: 'Lecture', created_at: NOW, updated_at: NOW
    }
    const data = emptyData({ sessions: [lecture] })
    expect(studyMinutesByActivity(data, TODAY, TODAY).Lecture).toBe(80)
    expect(computeStreaks(data, TODAY).current).toBe(1)
  })
})

import { MIN_PASSWORD_LENGTH, passwordLengthError } from '../auth-rules.js'
describe('one password rule across sign-up, reset and settings', () => {
  it('uses the same minimum everywhere', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(passwordLengthError('1234567')).toMatch(/at least 8/)
    expect(passwordLengthError('12345678')).toBeNull()
  })
})

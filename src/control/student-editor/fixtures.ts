import { defaultSettings, defaultExamTracks, seedChapters } from '../../lib/defaults'
import { indiaToday } from '../../lib/date'
import { stableId } from '../../lib/id'
import { defaultTimerState, type TimerState } from '../../lib/focus-timer'
import type {
  AppData, BacklogItem, Chapter, ChapterStage, ChapterStageKey, DailyTask, Mistake, PracticeSession, PyqRecord, Revision,
  StudyCard, StudySession, TestRecord, TestSubjectScore, UserExamTrack, WeeklyGoal
} from '../../types'

/**
 * Synthetic students for the Student Dashboard Editor canvas.
 *
 * Every record here is generated in the browser from fixed rules: no real account, name,
 * email, mark or study history is read or copied. The editor renders the real student pages
 * against this data only, and preview interactions change an in-memory copy of it.
 */

export const PREVIEW_USER_ID = '00000000-0000-4000-8000-00000000c0de'
export const PREVIEW_EMAIL = 'sample.student@example.invalid'

export const PREVIEW_SCENARIOS = [
  { id: 'new', label: 'New student, empty notebook' },
  { id: 'partial', label: 'Partially active student' },
  { id: 'full', label: 'Fully populated notebook' },
  { id: 'exam-near', label: 'Approaching the exam' },
  { id: 'focus-active', label: 'Active focus session' },
  { id: 'focus-paused', label: 'Paused focus session' },
  { id: 'overdue', label: 'Overdue backlog and revisions' },
  { id: 'tests', label: 'Tests and analytics recorded' },
  { id: 'no-tests', label: 'No test history' },
  { id: 'offline', label: 'Offline with pending sync' },
  { id: 'no-chapters', label: 'No syllabus chapters' },
  { id: 'reminders', label: 'Reminders enabled' },
  { id: 'tracks', label: 'Different exam tracks' }
] as const
export type PreviewScenarioId = (typeof PREVIEW_SCENARIOS)[number]['id']
export const isPreviewScenario = (value: unknown): value is PreviewScenarioId => PREVIEW_SCENARIOS.some(item => item.id === value)

export interface PreviewFixture {
  data: AppData
  syncState: 'synced' | 'offline'
  pendingCount: number
  focus: TimerState
}

const UID = PREVIEW_USER_ID
const SUBJECTS = ['Physics', 'Chemistry', 'Maths'] as const

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const value = new Date(Date.UTC(y!, m! - 1, d!))
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const at = (date: string, hour = 10) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`

/** Small deterministic generator so every scenario looks the same on every open. */
function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

function stamp<T extends object>(record: T, date: string): T & { user_id: string; created_at: string; updated_at: string } {
  return { ...record, user_id: UID, created_at: at(date, 8), updated_at: at(date, 9) }
}

function emptyNotebook(today: string): AppData {
  const settings = { ...defaultSettings(UID, 'Aarav Sample'), exam_id: 'jee', exam_year: Number(today.slice(0, 4)) + 1, onboarding_completed: true }
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [], tasks: [], goals: [], sessions: [],
    practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [],
    examTracks: defaultExamTracks(UID), settings, profile: stamp({ id: UID, display_name: 'Aarav Sample', email: PREVIEW_EMAIL }, today)
  }
}

interface Level { done: number; studying: number; sessionsDays: number; tasks: number; tasksDone: number; tests: number; revisionsDue: number; overdue: number; backlog: number; cards: number; mistakes: number }
const LEVELS: Record<'light' | 'full', Level> = {
  light: { done: 0.18, studying: 0.1, sessionsDays: 5, tasks: 3, tasksDone: 1, tests: 1, revisionsDue: 1, overdue: 0, backlog: 2, cards: 4, mistakes: 1 },
  full: { done: 0.55, studying: 0.15, sessionsDays: 21, tasks: 5, tasksDone: 2, tests: 6, revisionsDue: 3, overdue: 1, backlog: 4, cards: 18, mistakes: 6 }
}

function populate(base: AppData, today: string, level: Level, seed: number): AppData {
  const next = random(seed)
  const chapters: Chapter[] = seedChapters(UID).map(chapter => {
    const roll = next()
    const status = roll < level.done ? (next() < 0.4 ? 'Revised' as const : 'Done' as const) : roll < level.done + level.studying ? 'Studying' as const : 'Not Started' as const
    const daysAgo = Math.floor(next() * 60) + 3
    return { ...chapter, status, priority: next() < 0.25 ? 'High' : next() < 0.7 ? 'Medium' : 'Low', completed_on: status === 'Done' || status === 'Revised' ? shift(today, -daysAgo) : null, created_at: at(shift(today, -90)), updated_at: at(shift(today, -daysAgo)) }
  })
  const finished = chapters.filter(chapter => chapter.status === 'Done' || chapter.status === 'Revised')
  const keys: ChapterStageKey[] = ['theory', 'notes', 'pyqs', 'revised', 'tested']
  const chapterStages: ChapterStage[] = finished.flatMap(chapter => keys.slice(0, 2 + Math.floor(next() * 4)).map(stage => stamp({ id: stableId(`${UID}:stage:${chapter.id}:${stage}`), chapter_id: chapter.id, stage, done: true, completed_at: at(chapter.completed_on ?? today) }, chapter.completed_on ?? today)))

  const revisions: Revision[] = []
  finished.slice(0, 14).forEach((chapter, index) => {
    const due = index < level.overdue ? shift(today, -3 - index) : index < level.overdue + level.revisionsDue ? today : shift(today, 2 + index)
    revisions.push(stamp({ id: stableId(`${UID}:rev:${chapter.id}:1`), chapter_id: chapter.id, revision_number: 1, due_on: due, completed_at: null }, shift(today, -10)))
    if (index % 3 === 0) revisions.push(stamp({ id: stableId(`${UID}:rev:${chapter.id}:0`), chapter_id: chapter.id, revision_number: 0, due_on: shift(today, -20), completed_at: at(shift(today, -19)) }, shift(today, -25)))
  })

  const titles = ['Read the next section and mark doubts', 'Solve 25 practice questions', 'Revise formulas from yesterday', 'Attempt one timed set', 'Summarise the chapter on one page', 'Review marked doubts']
  const tasks: DailyTask[] = Array.from({ length: level.tasks }, (_, index) => {
    const chapter = chapters[(index * 11) % chapters.length]!
    return stamp({ id: stableId(`${UID}:task:${index}`), title: titles[index % titles.length]!, subject: chapter.subject, chapter_id: chapter.id, topic: null, estimated_minutes: [30, 45, 60, 40, 25][index % 5]!, priority: index === 0 ? 'High' as const : 'Medium' as const, is_completed: index < level.tasksDone, task_date: today, position: index }, today)
  })

  const sessions: StudySession[] = []
  for (let day = 0; day < level.sessionsDays; day += 1) {
    if (day > 2 && next() < 0.2) continue
    const date = shift(today, -day)
    const blocks = 1 + Math.floor(next() * 3)
    for (let block = 0; block < blocks; block += 1) {
      const minutes = 25 + Math.floor(next() * 35)
      const subject = SUBJECTS[Math.floor(next() * 3)]!
      sessions.push(stamp({ id: stableId(`${UID}:session:${day}:${block}`), subject, chapter_id: null, started_at: at(date, 6 + block * 3), ended_at: at(date, 7 + block * 3), duration_minutes: minutes, completion_state: 'completed' as const, mode: 'Pomodoro' as const, activity: (['Lecture', 'Practice', 'Revision'] as const)[block % 3]! }, date))
    }
  }

  const tests: TestRecord[] = []
  const testSubjectScores: TestSubjectScore[] = []
  for (let index = 0; index < level.tests; index += 1) {
    const date = shift(today, -(level.tests - index) * 6)
    const full = index % 2 === 0
    const total = full ? 300 : 100
    const marks = Math.round(total * (0.42 + index * 0.05 + next() * 0.06))
    const id = stableId(`${UID}:test:${index}`)
    tests.push(stamp({ id, title: full ? `Sample full mock ${index / 2 + 1}` : `${SUBJECTS[index % 3]} chapter test`, test_date: date, test_type: full ? 'Full Mock' as const : 'Chapter Test' as const, subject: full ? null : SUBJECTS[index % 3]!, chapter_id: null, marks_obtained: marks, total_marks: total, correct: Math.round(marks / 4), wrong: 6 + index, skipped: 4, total_questions: full ? 90 : 30, negative_marks: 6 + index, time_minutes: full ? 180 : 60, notes: '' }, date))
    if (full) SUBJECTS.forEach(subject => testSubjectScores.push(stamp({ id: stableId(`${UID}:score:${index}:${subject}`), test_id: id, subject, marks_obtained: Math.round(marks / 3 + (next() - 0.5) * 12), total_marks: 100 }, date)))
  }

  const mistakes: Mistake[] = Array.from({ length: level.mistakes }, (_, index) => stamp({ id: stableId(`${UID}:mistake:${index}`), chapter_id: chapters[(index * 7) % chapters.length]!.id, test_id: tests[index % Math.max(1, tests.length)]?.id ?? null, mistake_type: (['Concept', 'Silly', 'Calculation', 'Time', 'Guess'] as const)[index % 5]!, question_note: 'Sample question summary', solution_note: 'Sample corrected approach', image_path: null, retry_later: index % 2 === 0, retry_status: 'pending' as const }, shift(today, -index * 2)))

  const backlogItems: BacklogItem[] = Array.from({ length: level.backlog }, (_, index) => stamp({ id: stableId(`${UID}:backlog:${index}`), title: ['Missed lecture recap', 'Pending practice sheet', 'Topic to re-read', 'Unfinished module set'][index % 4]!, type: (['Lecture', 'DPP', 'Topic'] as const)[index % 3]!, subject: SUBJECTS[index % 3]!, chapter_id: null, priority: index === 0 ? 'High' as const : 'Medium' as const, due_on: shift(today, index < level.overdue + 1 ? -2 - index : 3 + index), status: 'active' as const, snoozed_until: null, completed_at: null, notes: '' }, shift(today, -7)))

  const practiceSessions: PracticeSession[] = finished.slice(0, 8).map((chapter, index) => stamp({ id: stableId(`${UID}:practice:${index}`), chapter_id: chapter.id, practice_date: shift(today, -index * 2), attempted: 30, correct: 18 + (index % 8), incorrect: 12 - (index % 8), skipped: 0, source: 'DPP' as const, time_minutes: 50, notes: '' }, shift(today, -index * 2)))
  const pyqRecords: PyqRecord[] = finished.slice(0, 10).flatMap((chapter, index) => [2023, 2024].map(year => stamp({ id: stableId(`${UID}:pyq:${chapter.id}:${year}`), chapter_id: chapter.id, exam: 'Main' as const, year, status: (index + year) % 3 === 0 ? 'pending' as const : 'done' as const, questions_total: 8, questions_done: (index + year) % 3 === 0 ? 3 : 8, meta: null, completed_at: (index + year) % 3 === 0 ? null : at(shift(today, -index)) }, shift(today, -index))))
  const studyCards: StudyCard[] = Array.from({ length: level.cards }, (_, index) => stamp({ id: stableId(`${UID}:card:${index}`), chapter_id: (finished[index % Math.max(1, finished.length)] ?? chapters[0]!).id, kind: index % 2 ? 'flashcard' as const : 'formula' as const, front: `Sample card ${index + 1}`, back: 'Sample answer', hint: '', position: index, difficulty: null, reviews: index % 4, last_reviewed_at: null, next_review_at: index % 3 === 0 ? at(today, 6) : null }, shift(today, -12)))
  const weekStart = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
  const goals: WeeklyGoal[] = [stamp({ id: stableId(`${UID}:goal:hours`), goal_type: 'study_hours' as const, title: 'Study hours', target: 30, progress_value: 12, week_start: weekStart, unit: 'hours' }, weekStart)]

  return {
    ...base, chapters, chapterStages, revisions, tasks, sessions, tests, testSubjectScores, mistakes, backlogItems, practiceSessions, pyqRecords, studyCards, goals,
    settings: { ...base.settings, main_exam_date: shift(today, 140), advanced_exam_date: shift(today, 190), daily_study_goal_minutes: 300 }
  }
}

function withTracks(data: AppData, dates: Partial<Record<UserExamTrack['track'], string>>): AppData {
  return { ...data, examTracks: data.examTracks.map(track => ({ ...track, exam_date: dates[track.track] ?? track.exam_date })) }
}

/** Builds one synthetic student; `today` is injectable for tests. */
export function buildPreviewFixture(id: PreviewScenarioId, today = indiaToday()): PreviewFixture {
  const empty = emptyNotebook(today)
  const fixture = (data: AppData, extra: Partial<PreviewFixture> = {}): PreviewFixture => ({ data, syncState: 'synced', pendingCount: 0, focus: defaultTimerState, ...extra })
  const full = () => withTracks(populate(empty, today, LEVELS.full, 7), { main1: shift(today, 140), advanced: shift(today, 190) })
  const now = Date.now()
  switch (id) {
    case 'new': return fixture(emptyNotebook(today))
    case 'partial': return fixture(withTracks(populate(empty, today, LEVELS.light, 3), { main1: shift(today, 200) }))
    case 'full': return fixture(full())
    case 'exam-near': {
      const data = withTracks(populate(empty, today, LEVELS.full, 11), { main1: shift(today, 12), advanced: shift(today, 60) })
      return fixture({ ...data, settings: { ...data.settings, main_exam_date: shift(today, 12), exam_mode: 'auto' } })
    }
    case 'focus-active': {
      const data = full()
      const chapter = data.chapters.find(item => item.status === 'Studying') ?? data.chapters[0]!
      return fixture(data, { focus: { ...defaultTimerState, running: true, remainingSeconds: 17 * 60, endsAt: now + 17 * 60_000, segmentStartedAt: now - 8 * 60_000, focusStartedAt: new Date(now - 8 * 60_000).toISOString(), subject: chapter.subject, chapterId: chapter.id, blockId: '11111111-2222-4333-8444-555555555555' } })
    }
    case 'focus-paused': {
      const data = full()
      return fixture(data, { focus: { ...defaultTimerState, running: false, remainingSeconds: 11 * 60, elapsedSeconds: 14 * 60, focusStartedAt: new Date(now - 20 * 60_000).toISOString(), subject: 'Chemistry', blockId: '11111111-2222-4333-8444-666666666666' } })
    }
    case 'overdue': return fixture(withTracks(populate(empty, today, { ...LEVELS.full, overdue: 4, backlog: 6, revisionsDue: 4 }, 5), { main1: shift(today, 140) }))
    case 'tests': return fixture(withTracks(populate(empty, today, { ...LEVELS.full, tests: 10, mistakes: 10 }, 13), { main1: shift(today, 140) }))
    case 'no-tests': {
      const data = full()
      return fixture({ ...data, tests: [], testSubjectScores: [], testChapterLinks: [], testErrorLogs: [], testTimeEntries: [], mistakes: data.mistakes.map(item => ({ ...item, test_id: null })) })
    }
    case 'offline': return fixture(full(), { syncState: 'offline', pendingCount: 4 })
    case 'no-chapters': return fixture({ ...emptyNotebook(today), settings: { ...empty.settings, exam_id: 'cuet-ug' } })
    case 'reminders': {
      const data = full()
      return fixture({ ...data, settings: { ...data.settings, reminders_enabled: true, reminder_time: '07:30', reminder_types: ['revision', 'backlog', 'practice', 'pyq', 'mock', 'plan'] } })
    }
    case 'tracks': {
      const data = withTracks(full(), { main1: shift(today, 45), main2: shift(today, 110), advanced: shift(today, 160), boards: shift(today, 80) })
      return fixture({ ...data, settings: { ...data.settings, active_track: 'main2', boards_addon: true, extra_exams: [{ id: 'sample-extra', label: 'State entrance (sample)', exam_date: shift(today, 130) }] } })
    }
  }
}

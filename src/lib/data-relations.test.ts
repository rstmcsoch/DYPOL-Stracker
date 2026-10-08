import { describe, expect, it } from 'vitest'
import { relatedRowsForRemoval } from './data-relations'
import { defaultSettings } from './defaults'
import type { AppData, Chapter, DailyTask, Mistake, Revision, StudySession, TestChapterLink, TestRecord, TestSubjectScore } from '../types'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const chapterId = '10000000-0000-4000-8000-000000000001'
const testId = '20000000-0000-4000-8000-000000000001'
const now = '2026-10-08T12:00:00.000Z'

function dataWithRelations(): AppData {
  const chapter: Chapter = {
    id: chapterId, created_at: now, updated_at: now, subject: 'Physics', name: 'Kinematics', position: 0,
    status: 'Done', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: '2026-10-01'
  }
  const test: TestRecord = {
    id: testId, created_at: now, updated_at: now, title: 'Mock', test_date: '2026-10-08', test_type: 'Full Mock',
    subject: null, chapter_id: chapterId, marks_obtained: 80, total_marks: 100, correct: null, wrong: null,
    skipped: null, negative_marks: null, time_minutes: null, notes: ''
  }
  const mistake: Mistake = {
    id: '30000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, chapter_id: chapterId,
    test_id: testId, mistake_type: 'Concept', question_note: 'Review this.', solution_note: '', image_path: null,
    retry_later: false, retry_status: 'pending'
  }
  const revision: Revision = {
    id: '40000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
    chapter_id: chapterId, revision_number: 1, due_on: '2026-10-02', completed_at: null
  }
  const task: DailyTask = {
    id: '50000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, title: 'Revise', subject: 'Physics',
    chapter_id: chapterId, estimated_minutes: 30, priority: 'Medium', is_completed: false, task_date: '2026-10-08', position: 0
  }
  const session: StudySession = {
    id: '60000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, subject: 'Physics',
    chapter_id: chapterId, started_at: now, ended_at: now, duration_minutes: 25, completion_state: 'completed', mode: 'Pomodoro', activity: 'Practice'
  }
  const score: TestSubjectScore = {
    id: '70000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
    test_id: testId, subject: 'Physics', marks_obtained: 80, total_marks: 100
  }
  const link: TestChapterLink = {
    id: '80000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
    test_id: testId, chapter_id: chapterId, marks_obtained: 80, total_marks: 100
  }
  return {
    chapters: [chapter], revisions: [revision], tests: [test], testSubjectScores: [score], testChapterLinks: [link],
    mistakes: [mistake], tasks: [task], goals: [], sessions: [session], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: [], settings: defaultSettings(userId), profile: null
  }
}

describe('delete relationship snapshots', () => {
  it('captures cascaded test scores and links and preserves test-linked mistakes by detaching them', () => {
    const changes = relatedRowsForRemoval(dataWithRelations(), 'tests', testId)
    expect(changes.filter(change => change.table === 'test_subject_scores' || change.table === 'test_chapter_links')).toHaveLength(2)
    const mistake = changes.find(change => change.table === 'mistakes')
    expect(mistake?.record.test_id).toBe(testId)
    expect(mistake?.next?.test_id).toBeNull()
    expect(mistake?.next?.chapter_id).toBe(chapterId)
  })

  it('captures chapter cascades and models database set-null relationships for undo', () => {
    const changes = relatedRowsForRemoval(dataWithRelations(), 'chapters', chapterId)
    expect(changes.filter(change => change.next === null).map(change => change.table)).toEqual(expect.arrayContaining([
      'chapter_revisions', 'mistakes', 'test_chapter_links'
    ]))
    expect(changes.filter(change => change.next !== null).map(change => change.table)).toEqual(expect.arrayContaining([
      'tests', 'daily_tasks', 'study_sessions'
    ]))
    expect(changes.find(change => change.table === 'tests')?.next?.chapter_id).toBeNull()
  })
})

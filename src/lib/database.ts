import Dexie, { type Table } from 'dexie'
import type {
  AppSettings, BacklogItem, Chapter, ChapterStage, DailyTask, Mistake, PracticeSession, Profile,
  PyqRecord, QueuedChange, Revision, StudyCard, StudySession, TestChapterLink, TestErrorLog,
  TestRecord, TestSubjectScore, TestTimeEntry, UserExamTrack, WeeklyGoal
} from '../types'

export interface CachedAsset {
  id: string
  mistake_id: string
  user_id: string
  data_url: string
  updated_at: string
}

class StrackerDatabase extends Dexie {
  chapters!: Table<Chapter, string>
  chapter_revisions!: Table<Revision, string>
  tests!: Table<TestRecord, string>
  test_subject_scores!: Table<TestSubjectScore, string>
  test_chapter_links!: Table<TestChapterLink, string>
  mistakes!: Table<Mistake, string>
  daily_tasks!: Table<DailyTask, string>
  weekly_goals!: Table<WeeklyGoal, string>
  study_sessions!: Table<StudySession, string>
  practice_sessions!: Table<PracticeSession, string>
  pyq_records!: Table<PyqRecord, string>
  chapter_stages!: Table<ChapterStage, string>
  backlog_items!: Table<BacklogItem, string>
  study_cards!: Table<StudyCard, string>
  test_error_logs!: Table<TestErrorLog, string>
  test_time_entries!: Table<TestTimeEntry, string>
  user_exam_tracks!: Table<UserExamTrack, string>
  app_settings!: Table<AppSettings, string>
  profiles!: Table<Profile, string>
  sync_queue!: Table<QueuedChange, number>
  assets!: Table<CachedAsset, string>

  constructor() {
    super('stracker-v1')
    this.version(1).stores({
      chapters: '&id, subject, status, updated_at',
      chapter_revisions: '&id, chapter_id, due_on, completed_at',
      tests: '&id, test_date, test_type, subject, chapter_id',
      test_subject_scores: '&id, test_id, subject',
      test_chapter_links: '&id, test_id, chapter_id',
      mistakes: '&id, chapter_id, test_id, mistake_type, retry_status',
      daily_tasks: '&id, task_date, is_completed, position',
      weekly_goals: '&id, week_start, goal_type',
      study_sessions: '&id, started_at, completion_state',
      app_settings: '&id, user_id',
      profiles: '&id, email',
      sync_queue: '++queueId, user_id, [table+id], table, id, queued_at',
      assets: '&id, user_id, updated_at'
    })
    this.version(2).stores({
      chapters: '&id, user_id, subject, status, updated_at',
      chapter_revisions: '&id, user_id, chapter_id, due_on, completed_at',
      tests: '&id, user_id, test_date, test_type, subject, chapter_id',
      test_subject_scores: '&id, user_id, test_id, subject',
      test_chapter_links: '&id, user_id, test_id, chapter_id',
      mistakes: '&id, user_id, chapter_id, test_id, mistake_type, retry_status',
      daily_tasks: '&id, user_id, task_date, is_completed, position',
      weekly_goals: '&id, user_id, week_start, goal_type',
      study_sessions: '&id, user_id, started_at, completion_state',
      app_settings: '&id, user_id',
      profiles: '&id, user_id, email',
      sync_queue: '++queueId, user_id, [user_id+table+id], table, id, queued_at',
      assets: '&id, user_id, updated_at, mistake_id'
    }).upgrade(async transaction => {
      const assets = await transaction.table('assets').toArray() as CachedAsset[]
      if (!assets.length) return
      await transaction.table('assets').clear()
      await transaction.table('assets').bulkPut(assets.map(asset => ({
        ...asset, mistake_id: asset.mistake_id ?? asset.id, id: assetKey(asset.user_id, asset.mistake_id ?? asset.id)
      })))
    })
    this.version(3).stores({
      practice_sessions: '&id, user_id, chapter_id, practice_date, source',
      pyq_records: '&id, user_id, chapter_id, exam, year, status',
      chapter_stages: '&id, user_id, chapter_id, stage',
      backlog_items: '&id, user_id, status, chapter_id, type, due_on',
      study_cards: '&id, user_id, chapter_id, kind, next_review_at',
      test_error_logs: '&id, user_id, test_id, chapter_id, category',
      test_time_entries: '&id, user_id, test_id, subject',
      user_exam_tracks: '&id, user_id, track'
    })
  }
}

export const localDb = new StrackerDatabase()

export async function clearLocalUserData(userId: string): Promise<void> {
  const tables = [
    localDb.chapters, localDb.chapter_revisions, localDb.tests, localDb.test_subject_scores,
    localDb.test_chapter_links, localDb.mistakes, localDb.daily_tasks, localDb.weekly_goals,
    localDb.study_sessions, localDb.practice_sessions, localDb.pyq_records, localDb.chapter_stages,
    localDb.backlog_items, localDb.study_cards, localDb.test_error_logs, localDb.test_time_entries,
    localDb.user_exam_tracks, localDb.app_settings, localDb.profiles
  ]
  await localDb.transaction('rw', [...tables, localDb.sync_queue, localDb.assets], async () => {
    for (const table of tables) {
      await table.where('user_id').equals(userId).delete()
    }
    await localDb.sync_queue.where('user_id').equals(userId).delete()
    await localDb.assets.where('user_id').equals(userId).delete()
  })
}

export function assetKey(userId: string, recordId: string): string {
  return `${userId}:${recordId}`
}

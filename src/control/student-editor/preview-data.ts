import type { AppData, AppSettings, TableName } from '../../types'

export const PREVIEW_DISABLED = 'Not available in the synthetic student preview.'

type Key = Exclude<keyof AppData, 'settings' | 'profile'>
const TABLE_KEYS: Record<Exclude<TableName, 'app_settings' | 'profiles'>, Key> = {
  chapters: 'chapters', chapter_revisions: 'revisions', tests: 'tests', test_subject_scores: 'testSubjectScores', test_chapter_links: 'testChapterLinks',
  mistakes: 'mistakes', daily_tasks: 'tasks', weekly_goals: 'goals', study_sessions: 'sessions', practice_sessions: 'practiceSessions', pyq_records: 'pyqRecords',
  chapter_stages: 'chapterStages', backlog_items: 'backlogItems', study_cards: 'studyCards', test_error_logs: 'testErrorLogs', test_time_entries: 'testTimeEntries',
  user_exam_tracks: 'examTracks'
}

/** Pure in-memory upsert/remove used by the preview data provider (exported for tests). */
export function applyPreviewUpsert(data: AppData, table: TableName, records: Record<string, unknown>[]): AppData {
  if (table === 'app_settings') return records[0] ? { ...data, settings: { ...data.settings, ...(records[0] as Partial<AppSettings>) } } : data
  if (table === 'profiles') return records[0] ? { ...data, profile: { ...(data.profile ?? {}), ...records[0] } as AppData['profile'] } : data
  const key = TABLE_KEYS[table]
  const rows = [...(data[key] as unknown as Record<string, unknown>[])]
  for (const record of records) {
    const index = rows.findIndex(row => row.id === record.id)
    const stamped = { ...record, updated_at: new Date().toISOString() }
    if (index >= 0) rows[index] = { ...rows[index], ...stamped }
    else rows.push(stamped)
  }
  return { ...data, [key]: rows }
}
export function applyPreviewRemove(data: AppData, table: TableName, id: string): AppData {
  if (table === 'app_settings' || table === 'profiles') return data
  const key = TABLE_KEYS[table]
  return { ...data, [key]: (data[key] as unknown as Record<string, unknown>[]).filter(row => row.id !== id) }
}


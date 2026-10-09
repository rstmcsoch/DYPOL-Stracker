import type { TableName } from '../../shared/types'

/**
 * Cloud tables mirrored on the device. The names are the Supabase table names, so the cache and the
 * database speak the same vocabulary. Order matters for the initial pull and for display.
 */
export const SYNC_TABLES: readonly TableName[] = [
  'profiles', 'app_settings', 'chapters', 'chapter_revisions', 'tests', 'test_subject_scores',
  'test_chapter_links', 'mistakes', 'daily_tasks', 'weekly_goals', 'study_sessions',
  'practice_sessions', 'pyq_records', 'chapter_stages', 'backlog_items', 'study_cards',
  'test_error_logs', 'test_time_entries', 'user_exam_tracks'
]

const SYNC_TABLE_SET = new Set<string>(SYNC_TABLES)

export function assertSyncTable(table: string): asserts table is TableName {
  if (!SYNC_TABLE_SET.has(table)) throw new Error(`Unknown table: ${table}`)
}

/** Current local schema version. Increase it and add a step in `sqlite-store.ts` for every change. */
export const LOCAL_SCHEMA_VERSION = 1

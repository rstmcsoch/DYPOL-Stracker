import type { AppData, AppSettings, QueuedChange, TableName } from '../../shared/types'
import { defaultSettings, normalizeSettings } from '../../shared/lib/defaults'
import type { LocalStore } from '../local-db/types'

export const UNDO_WINDOW_MS = 8000
export const SIGNED_IMAGE_SECONDS = 3600

export function assetKey(userId: string, recordId: string): string {
  return `${userId}:${recordId}`
}

/** Offline or transport failures are queued and retried; anything else is reported as an error. */
export function isNetworkError(error: unknown, online: boolean): boolean {
  if (!online) return true
  const raw = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error)
  const message = raw.toLowerCase()
  return message.includes('failed to fetch') || message.includes('network') || message.includes('load failed') || message.includes('timeout')
}

export function emptyData(userId: string): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [],
    backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: [],
    settings: defaultSettings(userId), profile: null
  }
}

export function rowsFor(data: AppData, table: TableName): Record<string, unknown>[] {
  switch (table) {
    case 'profiles': return data.profile ? [data.profile as unknown as Record<string, unknown>] : []
    case 'app_settings': return [data.settings as unknown as Record<string, unknown>]
    case 'chapters': return data.chapters as unknown as Record<string, unknown>[]
    case 'chapter_revisions': return data.revisions as unknown as Record<string, unknown>[]
    case 'tests': return data.tests as unknown as Record<string, unknown>[]
    case 'test_subject_scores': return data.testSubjectScores as unknown as Record<string, unknown>[]
    case 'test_chapter_links': return data.testChapterLinks as unknown as Record<string, unknown>[]
    case 'mistakes': return data.mistakes as unknown as Record<string, unknown>[]
    case 'daily_tasks': return data.tasks as unknown as Record<string, unknown>[]
    case 'weekly_goals': return data.goals as unknown as Record<string, unknown>[]
    case 'study_sessions': return data.sessions as unknown as Record<string, unknown>[]
    case 'practice_sessions': return data.practiceSessions as unknown as Record<string, unknown>[]
    case 'pyq_records': return data.pyqRecords as unknown as Record<string, unknown>[]
    case 'chapter_stages': return data.chapterStages as unknown as Record<string, unknown>[]
    case 'backlog_items': return data.backlogItems as unknown as Record<string, unknown>[]
    case 'study_cards': return data.studyCards as unknown as Record<string, unknown>[]
    case 'test_error_logs': return data.testErrorLogs as unknown as Record<string, unknown>[]
    case 'test_time_entries': return data.testTimeEntries as unknown as Record<string, unknown>[]
    case 'user_exam_tracks': return data.examTracks as unknown as Record<string, unknown>[]
  }
}

export function replaceRows(data: AppData, table: TableName, rows: Record<string, unknown>[]): AppData {
  switch (table) {
    case 'profiles': return { ...data, profile: (rows[0] as unknown as AppData['profile']) ?? null }
    case 'app_settings': return { ...data, settings: (rows[0] as unknown as AppSettings | undefined) ?? data.settings }
    case 'chapters': return { ...data, chapters: rows as unknown as AppData['chapters'] }
    case 'chapter_revisions': return { ...data, revisions: rows as unknown as AppData['revisions'] }
    case 'tests': return { ...data, tests: rows as unknown as AppData['tests'] }
    case 'test_subject_scores': return { ...data, testSubjectScores: rows as unknown as AppData['testSubjectScores'] }
    case 'test_chapter_links': return { ...data, testChapterLinks: rows as unknown as AppData['testChapterLinks'] }
    case 'mistakes': return { ...data, mistakes: rows as unknown as AppData['mistakes'] }
    case 'daily_tasks': return { ...data, tasks: rows as unknown as AppData['tasks'] }
    case 'weekly_goals': return { ...data, goals: rows as unknown as AppData['goals'] }
    case 'study_sessions': return { ...data, sessions: rows as unknown as AppData['sessions'] }
    case 'practice_sessions': return { ...data, practiceSessions: rows as unknown as AppData['practiceSessions'] }
    case 'pyq_records': return { ...data, pyqRecords: rows as unknown as AppData['pyqRecords'] }
    case 'chapter_stages': return { ...data, chapterStages: rows as unknown as AppData['chapterStages'] }
    case 'backlog_items': return { ...data, backlogItems: rows as unknown as AppData['backlogItems'] }
    case 'study_cards': return { ...data, studyCards: rows as unknown as AppData['studyCards'] }
    case 'test_error_logs': return { ...data, testErrorLogs: rows as unknown as AppData['testErrorLogs'] }
    case 'test_time_entries': return { ...data, testTimeEntries: rows as unknown as AppData['testTimeEntries'] }
    case 'user_exam_tracks': return { ...data, examTracks: rows as unknown as AppData['examTracks'] }
  }
}

/** Replaces one record by id, keeping the collection's order for existing records and appending new ones. */
export function updateOne(data: AppData, table: TableName, row: Record<string, unknown>): AppData {
  const current = rowsFor(data, table).filter(item => item.id !== row.id)
  return replaceRows(data, table, [...current, row])
}

export function removeOne(data: AppData, table: TableName, id: string): AppData {
  return replaceRows(data, table, rowsFor(data, table).filter(row => row.id !== id))
}

export function cleanForCloud(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row }
  if (clean.main_exam_date === '') clean.main_exam_date = null
  if (clean.advanced_exam_date === '') clean.advanced_exam_date = null
  if (clean.exam_date === '') clean.exam_date = null
  delete clean.image_data
  delete clean.image_preview
  delete clean.image_pending
  delete clean.image_previous_path
  return clean
}

export function withOwner(table: TableName, row: Record<string, unknown>, userId: string, now: string): Record<string, unknown> {
  const record: Record<string, unknown> = { ...row, user_id: userId, updated_at: now }
  if (table === 'profiles' || table === 'app_settings') record.id = userId
  if (!record.created_at) record.created_at = now
  return record
}

/** Builds the in-memory view of the cache: every synced table for one account, plus cached photos. */
export async function readLocal(store: LocalStore, userId: string): Promise<AppData> {
  const byUser = (table: TableName) => store.listRows(table, userId)
  const [
    chapters, revisions, tests, subjectScores, chapterLinks, mistakes, tasks, goals, sessions,
    practiceSessions, pyqRecords, chapterStages, backlogItems, studyCards, testErrorLogs,
    testTimeEntries, examTracks, settings, profiles, assets
  ] = await Promise.all([
    byUser('chapters'), byUser('chapter_revisions'), byUser('tests'), byUser('test_subject_scores'),
    byUser('test_chapter_links'), byUser('mistakes'), byUser('daily_tasks'), byUser('weekly_goals'),
    byUser('study_sessions'), byUser('practice_sessions'), byUser('pyq_records'), byUser('chapter_stages'),
    byUser('backlog_items'), byUser('study_cards'), byUser('test_error_logs'), byUser('test_time_entries'),
    byUser('user_exam_tracks'), byUser('app_settings'), byUser('profiles'), store.listAssets(userId)
  ])
  const localSettings = settings[0]
  const enrichedMistakes = mistakes.map(row => {
    const asset = assets.find(item => item.mistake_id === row.id || item.id === assetKey(userId, String(row.id)))
    const dataUrl = (row.image_data as string | null | undefined) ?? asset?.data_url ?? null
    return { ...row, image_data: dataUrl, image_preview: (row.image_preview as string | null | undefined) ?? dataUrl }
  })
  return {
    chapters: chapters as unknown as AppData['chapters'],
    revisions: revisions as unknown as AppData['revisions'],
    tests: tests as unknown as AppData['tests'],
    testSubjectScores: subjectScores as unknown as AppData['testSubjectScores'],
    testChapterLinks: chapterLinks as unknown as AppData['testChapterLinks'],
    mistakes: enrichedMistakes as unknown as AppData['mistakes'],
    tasks: tasks as unknown as AppData['tasks'],
    goals: goals as unknown as AppData['goals'],
    sessions: sessions as unknown as AppData['sessions'],
    practiceSessions: practiceSessions as unknown as AppData['practiceSessions'],
    pyqRecords: pyqRecords as unknown as AppData['pyqRecords'],
    chapterStages: chapterStages as unknown as AppData['chapterStages'],
    backlogItems: backlogItems as unknown as AppData['backlogItems'],
    studyCards: studyCards as unknown as AppData['studyCards'],
    testErrorLogs: testErrorLogs as unknown as AppData['testErrorLogs'],
    testTimeEntries: testTimeEntries as unknown as AppData['testTimeEntries'],
    examTracks: examTracks as unknown as AppData['examTracks'],
    settings: localSettings ? normalizeSettings(localSettings, userId) : defaultSettings(userId),
    profile: (profiles[0] as unknown as AppData['profile']) ?? null
  }
}

export function queuedUpsert(userId: string, table: TableName, id: string, record: Record<string, unknown>, queuedAt: string): Omit<QueuedChange, 'queueId'> {
  return { user_id: userId, table, operation: 'upsert', id, record, queued_at: queuedAt }
}


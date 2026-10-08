import type { AppData, TableName } from '../types'

export interface RelatedRemoval {
  table: TableName
  record: Record<string, unknown>
  next: Record<string, unknown> | null
}

function rowsFor(data: AppData, table: TableName): Record<string, unknown>[] {
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
  }
}

export function relatedRowsForRemoval(data: AppData, table: TableName, id: string): RelatedRemoval[] {
  const changes: RelatedRemoval[] = []
  const capture = (relatedTable: TableName, predicate: (row: Record<string, unknown>) => boolean, detachField?: string): void => {
    for (const row of rowsFor(data, relatedTable)) {
      if (!predicate(row)) continue
      changes.push({
        table: relatedTable, record: row,
        next: detachField ? { ...row, [detachField]: null, updated_at: new Date().toISOString() } : null
      })
    }
  }

  if (table === 'tests') {
    capture('test_subject_scores', row => row.test_id === id)
    capture('test_chapter_links', row => row.test_id === id)
    capture('mistakes', row => row.test_id === id, 'test_id')
  } else if (table === 'chapters') {
    capture('chapter_revisions', row => row.chapter_id === id)
    capture('mistakes', row => row.chapter_id === id)
    capture('test_chapter_links', row => row.chapter_id === id)
    capture('tests', row => row.chapter_id === id, 'chapter_id')
    capture('daily_tasks', row => row.chapter_id === id, 'chapter_id')
    capture('study_sessions', row => row.chapter_id === id, 'chapter_id')
  }
  return changes
}

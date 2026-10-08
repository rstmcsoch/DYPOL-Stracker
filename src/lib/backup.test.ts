import { describe, expect, it } from 'vitest'
import { createBackup, testsToCsv, validateBackupText } from './backup'
import { defaultSettings } from './defaults'
import type { AppData, Chapter, Revision, TestRecord } from '../types'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const chapterId = '10000000-0000-4000-8000-000000000001'
const testId = '20000000-0000-4000-8000-000000000001'
const now = '2026-10-07T12:00:00.000Z'

function emptyData(): AppData {
  return {
    chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
    tasks: [], goals: [], sessions: [], practiceSessions: [], pyqRecords: [], chapterStages: [], backlogItems: [], studyCards: [], testErrorLogs: [], testTimeEntries: [], examTracks: [], settings: defaultSettings(userId), profile: null
  }
}

function sampleChapter(): Chapter {
  return {
    id: chapterId, created_at: now, updated_at: now, subject: 'Physics', name: 'Kinematics', position: 0,
    status: 'Studying', priority: 'Medium', importance: 'medium', weightage: null, notes: '', formula_notes: '', completed_on: null
  }
}

function sampleTest(): TestRecord {
  return {
    id: testId, created_at: now, updated_at: now, title: 'Chapter quiz', test_date: '2026-10-06',
    test_type: 'Chapter Test', subject: 'Physics', chapter_id: chapterId, marks_obtained: 18, total_marks: 20,
    correct: 9, wrong: 1, skipped: 0, negative_marks: 1, time_minutes: 25, notes: '=1+1'
  }
}

describe('JSON backup', () => {
  it('creates a re-importable owner notebook without UI-only fields', () => {
    const data = emptyData()
    data.chapters = [sampleChapter()]
    data.mistakes = [{
      id: '40000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, chapter_id: chapterId,
      test_id: null, mistake_type: 'Concept', question_note: 'Review the sign.', solution_note: '',
      image_path: null, image_data: 'data:image/webp;base64,AA==', image_preview: 'blob:private-preview', image_pending: true, retry_later: false, retry_status: 'pending'
    }]

    const backup = createBackup(data)
    expect(backup.mistakes[0]?.image_data).toBe('data:image/webp;base64,AA==')
    expect(backup.mistakes[0]).not.toHaveProperty('image_preview')
    expect(backup.mistakes[0]).not.toHaveProperty('image_pending')
    expect(validateBackupText(JSON.stringify(backup), emptyData()).backup.chapters).toHaveLength(1)
  })

  it('rejects the wrong application or malformed JSON', () => {
    expect(() => validateBackupText('{', emptyData())).toThrow('not valid JSON')
    const backup = createBackup(emptyData())
    expect(() => validateBackupText(JSON.stringify({ ...backup, app: 'Other app' }), emptyData())).toThrow('Stracker v1')
  })

  it('filters broken relationships during import preview', () => {
    const backup = createBackup(emptyData())
    backup.chapters = [sampleChapter()]
    backup.tests = [sampleTest()]
    const validRevision: Revision = {
      id: '50000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
      chapter_id: chapterId, revision_number: 1, due_on: '2026-10-08', completed_at: null
    }
    const brokenRevision: Revision = { ...validRevision, id: '50000000-0000-4000-8000-000000000002', chapter_id: '60000000-0000-4000-8000-000000000001' }
    backup.revisions = [validRevision, brokenRevision]

    const preview = validateBackupText(JSON.stringify(backup), emptyData())
    expect(preview.backup.revisions).toHaveLength(1)
    expect(preview.invalid).toHaveLength(1)
    expect(preview.invalid[0]?.collection).toBe('revisions')
  })

  it('rejects over-total subject and chapter scores plus scores with no denominator during import', () => {
    const backup = createBackup(emptyData())
    backup.chapters = [sampleChapter()]
    backup.tests = [sampleTest()]
    backup.testSubjectScores = [
      { id: '70000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, test_id: testId, subject: 'Physics', marks_obtained: 101, total_marks: 100 },
      { id: '70000000-0000-4000-8000-000000000002', created_at: now, updated_at: now, test_id: testId, subject: 'Chemistry', marks_obtained: 10, total_marks: null }
    ]
    backup.testChapterLinks = [{
      id: '80000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
      test_id: testId, chapter_id: chapterId, marks_obtained: 21, total_marks: 20
    }]

    const preview = validateBackupText(JSON.stringify(backup), emptyData())
    expect(preview.backup.testSubjectScores).toHaveLength(0)
    expect(preview.backup.testChapterLinks).toHaveLength(0)
    expect(preview.invalid.map(item => item.collection)).toEqual(expect.arrayContaining(['testSubjectScores', 'testChapterLinks']))
  })

  it('skips a test whose linked chapter is absent and keeps preview counts accurate', () => {
    const backup = createBackup(emptyData())
    backup.tests = [{ ...sampleTest(), chapter_id: '70000000-0000-4000-8000-000000000001' }]
    const preview = validateBackupText(JSON.stringify(backup), emptyData())
    expect(preview.backup.tests).toHaveLength(0)
    expect(preview.counts.tests).toBe(0)
    expect(preview.invalid[0]?.collection).toBe('tests')
  })

  it('preflights unique composite relationships and rejects fractional count goals', () => {
    const current = emptyData()
    current.chapters = [{ ...sampleChapter(), id: '10000000-0000-4000-8000-000000000002' }]
    const backup = createBackup(emptyData())
    backup.chapters = [sampleChapter()]
    const revision: Revision = {
      id: '50000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
      chapter_id: current.chapters[0]!.id, revision_number: 1, due_on: '2026-10-08', completed_at: null
    }
    backup.revisions = [revision, { ...revision, id: '50000000-0000-4000-8000-000000000002' }]
    backup.goals = [{
      id: '80000000-0000-4000-8000-000000000001', created_at: now, updated_at: now,
      goal_type: 'tests', title: 'Practice tests', target: 2.5, progress_value: 0,
      week_start: '2026-10-05', unit: 'tests'
    }]

    const preview = validateBackupText(JSON.stringify(backup), current)
    expect(preview.backup.chapters).toHaveLength(0)
    expect(preview.backup.revisions).toHaveLength(1)
    expect(preview.backup.goals).toHaveLength(0)
    expect(preview.invalid.map(item => item.collection)).toEqual(expect.arrayContaining(['chapters', 'revisions', 'goals']))
  })

  it('imports backups written before the interface-font preference existed', () => {
    const legacySettings = { ...defaultSettings(userId) } as Record<string, unknown>
    delete legacySettings.interface_font
    const backup = { ...createBackup(emptyData()), settings: legacySettings }

    const preview = validateBackupText(JSON.stringify(backup), emptyData())
    expect(preview.invalid.filter(item => item.collection === 'settings')).toHaveLength(0)
    expect(preview.backup.settings?.interface_font).toBe('default')
  })

  it('warns when an older backup points to an image that is not embedded', () => {
    const data = emptyData()
    data.chapters = [sampleChapter()]
    data.mistakes = [{
      id: '40000000-0000-4000-8000-000000000001', created_at: now, updated_at: now, chapter_id: chapterId,
      test_id: null, mistake_type: 'Concept', question_note: 'Review this diagram.', solution_note: '',
      image_path: `${userId}/old-image.webp`, retry_later: false, retry_status: 'pending'
    }]
    const preview = validateBackupText(JSON.stringify(createBackup(data)), emptyData())
    expect(preview.backup.mistakes).toHaveLength(1)
    expect(preview.warnings).toHaveLength(1)
  })
})

describe('test CSV', () => {
  it('filters dates and escapes spreadsheet formula-like notes', () => {
    const data = emptyData()
    data.tests = [sampleTest(), { ...sampleTest(), id: '20000000-0000-4000-8000-000000000002', test_date: '2026-09-01', title: 'Older test' }]
    const csv = testsToCsv(data, '2026-10-01', '2026-10-31')
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain("'=1+1")
    expect(csv).toContain('Chapter quiz')
    expect(csv).not.toContain('Older test')
  })

  it('preserves an invalid raw score for review while leaving its percentage blank', () => {
    const data = emptyData()
    data.tests = [{ ...sampleTest(), marks_obtained: 110, total_marks: 100 }]
    const csv = testsToCsv(data)
    expect(csv).toContain('"110","100",""')
  })

  it('exports the same complete Full Mock aggregate and label used by analytics', () => {
    const data = emptyData()
    data.tests = [{ ...sampleTest(), test_type: 'Full Mock', subject: 'Physics', chapter_id: null, marks_obtained: null, total_marks: null }]
    data.testSubjectScores = [
      { id: '70000000-0000-4000-8000-000000000011', created_at: now, updated_at: now, test_id: testId, subject: 'Physics', marks_obtained: 70, total_marks: 100 },
      { id: '70000000-0000-4000-8000-000000000012', created_at: now, updated_at: now, test_id: testId, subject: 'Chemistry', marks_obtained: 95, total_marks: 100 },
      { id: '70000000-0000-4000-8000-000000000013', created_at: now, updated_at: now, test_id: testId, subject: 'Maths', marks_obtained: 0, total_marks: 200 }
    ]
    const csv = testsToCsv(data)
    expect(csv).toContain('All subjects')
    expect(csv).toContain('165')
    expect(csv).toContain('400')
    expect(csv).toContain('41.3%')
  })
})

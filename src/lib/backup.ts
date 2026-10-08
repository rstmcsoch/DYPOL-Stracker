import { z } from 'zod'
import { testPercentage } from './analytics'
import type { AppData, ExportBackup } from '../types'
import { settingsSchema as appSettingsSchema } from './settings-validation'
import { goalSchema as appGoalSchema } from './goal-validation'
import { marksObtainedSchema, subjectScoreInputSchema, testFormSchema, totalMarksSchema } from './test-validation'

const dateValue = z.iso.date()
const timestampValue = z.iso.datetime({ offset: true })
const optionalDateValue = dateValue.nullable()
const baseFields = { id: z.string().uuid(), created_at: timestampValue, updated_at: timestampValue, user_id: z.string().uuid().optional() }
const chapterSchema = z.object({ ...baseFields, subject: z.enum(['Physics','Chemistry','Maths']), name: z.string().min(1).max(140), position: z.number().int().min(0), status: z.enum(['Not Started','Studying','Done','Revised']), priority: z.enum(['High','Medium','Low']), weightage: z.string().max(80).nullable(), notes: z.string().max(20000), formula_notes: z.string().max(20000), completed_on: optionalDateValue })
const revisionSchema = z.object({ ...baseFields, chapter_id: z.string().uuid(), revision_number: z.number().int().positive(), due_on: dateValue, completed_at: timestampValue.nullable() })
const testSchema = z.object({ ...baseFields, ...testFormSchema.shape, subject: z.enum(['Physics','Chemistry','Maths']).nullable(), chapter_id: z.string().uuid().nullable() }).superRefine((value, context) => {
  const result = testFormSchema.safeParse(value)
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: issue.path })
})
const subjectScoreSchema = z.object({ ...baseFields, test_id: z.string().uuid(), subject: z.enum(['Physics','Chemistry','Maths']), marks_obtained: marksObtainedSchema, total_marks: totalMarksSchema }).superRefine((value, context) => {
  const result = subjectScoreInputSchema.safeParse(value)
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: issue.path })
})
const chapterLinkSchema = z.object({ ...baseFields, test_id: z.string().uuid(), chapter_id: z.string().uuid(), marks_obtained: marksObtainedSchema, total_marks: totalMarksSchema }).superRefine((value, context) => {
  const result = subjectScoreInputSchema.safeParse(value)
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: issue.path })
})
const mistakeSchema = z.object({ ...baseFields, chapter_id: z.string().uuid(), test_id: z.string().uuid().nullable(), mistake_type: z.enum(['Concept','Silly','Calculation','Time','Guess']), question_note: z.string().min(1).max(10000), solution_note: z.string().max(10000), image_path: z.string().max(500).nullable(), image_data: z.string().max(7_000_000).regex(/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/).nullable().optional(), retry_later: z.boolean(), retry_status: z.enum(['pending','retried']) })
const taskSchema = z.object({ ...baseFields, title: z.string().min(1).max(200), subject: z.enum(['Physics','Chemistry','Maths']).nullable(), chapter_id: z.string().uuid().nullable(), estimated_minutes: z.number().int().nonnegative().max(1440), priority: z.enum(['High','Medium','Low']), is_completed: z.boolean(), task_date: dateValue, position: z.number().int().nonnegative() })
const goalSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('progress_value' in value)) return { ...value, progress_value: 0 }
  return value
}, appGoalSchema.extend(baseFields))
const sessionSchema = z.object({ ...baseFields, subject: z.enum(['Physics','Chemistry','Maths']).nullable(), chapter_id: z.string().uuid().nullable(), started_at: timestampValue, ended_at: timestampValue.nullable(), duration_minutes: z.number().int().nonnegative().max(1440), completion_state: z.enum(['completed','interrupted']), mode: z.enum(['Pomodoro','Short Break','Long Break','Custom']) })
const settingsSchema = appSettingsSchema.extend({ ...baseFields, last_backup_at: timestampValue.nullable() })
const profileSchema = z.object({ ...baseFields, display_name: z.string().max(100), email: z.string().max(320) })
const envelopeSchema = z.object({
  app: z.literal('Stracker'), version: z.literal(1), exported_at: timestampValue, settings: z.unknown(), profile: z.unknown().nullable(),
  chapters: z.array(z.unknown()), revisions: z.array(z.unknown()), tests: z.array(z.unknown()),
  testSubjectScores: z.array(z.unknown()), testChapterLinks: z.array(z.unknown()), mistakes: z.array(z.unknown()),
  tasks: z.array(z.unknown()), goals: z.array(z.unknown()), sessions: z.array(z.unknown())
})

export interface InvalidImportRow { collection: string; index: number; reason: string }
export interface ValidatedImport {
  backup: Partial<ExportBackup>
  invalid: InvalidImportRow[]
  counts: Record<string, number>
  warnings: string[]
}

export function createBackup(data: AppData): ExportBackup {
  return {
    app: 'Stracker', version: 1, exported_at: new Date().toISOString(), settings: data.settings,
    profile: data.profile, chapters: data.chapters, revisions: data.revisions, tests: data.tests,
    testSubjectScores: data.testSubjectScores, testChapterLinks: data.testChapterLinks,
    mistakes: data.mistakes.map(mistake => {
      const saved = { ...mistake }
      delete saved.image_preview
      delete saved.image_pending
      delete (saved as typeof saved & { image_previous_path?: string }).image_previous_path
      return saved
    }),
    tasks: data.tasks, goals: data.goals, sessions: data.sessions
  }
}

function filterCompositeConflicts<T extends { id: string }>(
  rows: T[], current: T[], collection: string, keyOf: (row: T) => string, invalid: InvalidImportRow[]
): T[] {
  const ownerByKey = new Map(current.map(row => [keyOf(row), row.id]))
  const safe: T[] = []
  rows.forEach((row, index) => {
    const key = keyOf(row)
    const existingId = ownerByKey.get(key)
    if (existingId && existingId !== row.id) {
      invalid.push({ collection, index: index + 1, reason: 'Conflicts with a record that already uses this unique relationship.' })
      return
    }
    ownerByKey.set(key, row.id)
    safe.push(row)
  })
  return safe
}

export function validateBackupText(text: string, current: AppData): ValidatedImport {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) throw new Error('This does not look like a Stracker v1 JSON backup. Check that you selected the original export.')
  const invalid: InvalidImportRow[] = []
  const valid: Partial<ExportBackup> = { app: 'Stracker', version: 1, exported_at: envelope.data.exported_at }
  const counts: Record<string, number> = {}
  const warnings: string[] = []

  const settings = settingsSchema.safeParse(envelope.data.settings)
  if (settings.success) valid.settings = settings.data as ExportBackup['settings']
  else invalid.push({ collection: 'settings', index: 0, reason: settings.error.issues[0]?.message ?? 'Invalid settings record.' })
  if (envelope.data.profile !== null) {
    const profile = profileSchema.safeParse(envelope.data.profile)
    if (profile.success) valid.profile = profile.data as ExportBackup['profile']
    else invalid.push({ collection: 'profile', index: 0, reason: profile.error.issues[0]?.message ?? 'Invalid profile record.' })
  } else valid.profile = null

  const parseRows = <T>(key: keyof ExportBackup, values: unknown[], schema: z.ZodType<T>): T[] => {
    const parsed: T[] = []
    const seenIds = new Set<string>()
    values.forEach((value, index) => {
      const result = schema.safeParse(value)
      if (result.success) {
        const id = typeof result.data === 'object' && result.data !== null && 'id' in result.data ? String(result.data.id) : ''
        if (id && seenIds.has(id)) invalid.push({ collection: String(key), index: index + 1, reason: 'Duplicate record ID in this backup.' })
        else { if (id) seenIds.add(id); parsed.push(result.data) }
      } else invalid.push({ collection: String(key), index: index + 1, reason: result.error.issues[0]?.message ?? 'Invalid record.' })
    })
    counts[String(key)] = parsed.length
    return parsed
  }
  const chapters = filterCompositeConflicts(parseRows('chapters', envelope.data.chapters, chapterSchema), current.chapters, 'chapters', row => `${row.subject}\u0000${row.name.trim().toLowerCase()}`, invalid)
  const revisions = filterCompositeConflicts(parseRows('revisions', envelope.data.revisions, revisionSchema), current.revisions, 'revisions', row => `${row.chapter_id}\u0000${row.revision_number}`, invalid)
  const tests = parseRows('tests', envelope.data.tests, testSchema)
  const testSubjectScores = filterCompositeConflicts(parseRows('testSubjectScores', envelope.data.testSubjectScores, subjectScoreSchema), current.testSubjectScores, 'testSubjectScores', row => `${row.test_id}\u0000${row.subject}`, invalid)
  const testChapterLinks = filterCompositeConflicts(parseRows('testChapterLinks', envelope.data.testChapterLinks, chapterLinkSchema), current.testChapterLinks, 'testChapterLinks', row => `${row.test_id}\u0000${row.chapter_id}`, invalid)
  counts.chapters = chapters.length
  counts.revisions = revisions.length
  counts.testSubjectScores = testSubjectScores.length
  counts.testChapterLinks = testChapterLinks.length
  const mistakes = parseRows('mistakes', envelope.data.mistakes, mistakeSchema)
  const tasks = parseRows('tasks', envelope.data.tasks, taskSchema)
  const goals = parseRows('goals', envelope.data.goals, goalSchema)
  const sessions = parseRows('sessions', envelope.data.sessions, sessionSchema)

  const chapterIds = new Set([...current.chapters.map(row => row.id), ...chapters.map(row => row.id)])
  const validTests = tests.filter((test, index) => {
    if (!test.chapter_id || chapterIds.has(test.chapter_id)) return true
    invalid.push({ collection: 'tests', index: index + 1, reason: 'Linked chapter was not found in the backup or current notebook.' })
    return false
  })
  counts.tests = validTests.length
  const testIds = new Set([...current.tests.map(row => row.id), ...validTests.map(row => row.id)])
  const ensureRelation = <T>(items: T[], collection: string, references: (item: T) => { id: string; collection: string }[]) => items.filter((item, index) => {
    const missing = references(item).find(ref => (ref.collection === 'chapters' ? !chapterIds.has(ref.id) : !testIds.has(ref.id)))
    if (!missing) return true
    invalid.push({ collection, index: index + 1, reason: `Linked ${missing.collection.slice(0, -1)} was not found in the backup or current notebook.` })
    return false
  })
  const validRevisions = ensureRelation(revisions, 'revisions', item => [{ id: item.chapter_id, collection: 'chapters' }])
  const validTestChapterLinks = ensureRelation(testChapterLinks, 'testChapterLinks', item => [{ id: item.test_id, collection: 'tests' }, { id: item.chapter_id, collection: 'chapters' }])
  const validTestSubjectScores = ensureRelation(testSubjectScores, 'testSubjectScores', item => [{ id: item.test_id, collection: 'tests' }])
  const validMistakes = ensureRelation(mistakes, 'mistakes', item => [{ id: item.chapter_id, collection: 'chapters' }, ...(item.test_id ? [{ id: item.test_id, collection: 'tests' }] : [])])
  const validTasks = ensureRelation(tasks, 'tasks', item => item.chapter_id ? [{ id: item.chapter_id, collection: 'chapters' }] : [])
  const validSessions = ensureRelation(sessions, 'sessions', item => item.chapter_id ? [{ id: item.chapter_id, collection: 'chapters' }] : [])
  if (validMistakes.some(item => item.image_path && !item.image_data)) warnings.push('Some mistakes refer to stored images that are not embedded in this file. Their text will import, but those images cannot be restored from this backup.')
  counts.revisions = validRevisions.length
  counts.testChapterLinks = validTestChapterLinks.length
  counts.testSubjectScores = validTestSubjectScores.length
  counts.mistakes = validMistakes.length
  counts.tasks = validTasks.length
  counts.sessions = validSessions.length
  valid.chapters = chapters as ExportBackup['chapters']
  valid.tests = validTests as ExportBackup['tests']
  valid.revisions = validRevisions as ExportBackup['revisions']
  valid.testChapterLinks = validTestChapterLinks as ExportBackup['testChapterLinks']
  valid.testSubjectScores = validTestSubjectScores as ExportBackup['testSubjectScores']
  valid.mistakes = validMistakes as ExportBackup['mistakes']
  valid.tasks = validTasks as ExportBackup['tasks']
  valid.sessions = validSessions as ExportBackup['sessions']
  valid.goals = goals as ExportBackup['goals']

  return { backup: valid, invalid, counts, warnings }
}

export function testsToCsv(data: AppData, from = '', to = ''): string {
  const escape = (value: unknown) => {
    let text = value == null ? '' : String(value)
    if (/^[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const headers = ['Date','Test','Type','Subject','Chapter','Marks','Total','Percentage','Correct','Wrong','Skipped','Negative marks','Time minutes','Notes','Physics marks','Physics total','Chemistry marks','Chemistry total','Maths marks','Maths total']
  const rows = data.tests.filter(test => (!from || test.test_date >= from) && (!to || test.test_date <= to)).sort((a, b) => a.test_date.localeCompare(b.test_date)).map(test => {
    const scores = data.testSubjectScores.filter(score => score.test_id === test.id)
    const subject = test.subject ?? ''
    const chapter = data.chapters.find(item => item.id === test.chapter_id)?.name ?? ''
    const score = testPercentage(test)
    const percentage = score === null ? '' : `${score.toFixed(1)}%`
    const scoreFor = (name: string, field: 'marks_obtained' | 'total_marks') => scores.find(score => score.subject === name)?.[field] ?? ''
    return [test.test_date, test.title, test.test_type, subject, chapter, test.marks_obtained ?? '', test.total_marks ?? '', percentage, test.correct ?? '', test.wrong ?? '', test.skipped ?? '', test.negative_marks ?? '', test.time_minutes ?? '', test.notes, scoreFor('Physics','marks_obtained'), scoreFor('Physics','total_marks'), scoreFor('Chemistry','marks_obtained'), scoreFor('Chemistry','total_marks'), scoreFor('Maths','marks_obtained'), scoreFor('Maths','total_marks')].map(escape).join(',')
  })
  return `\ufeff${[headers.map(escape).join(','), ...rows].join('\r\n')}`
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = fileName; link.style.display = 'none'
  document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

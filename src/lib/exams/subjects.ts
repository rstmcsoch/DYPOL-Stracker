import type { AppData, AppSettings } from '../../types/index.js'
import { BUILT_IN_EXAMS, LEGACY_DEFAULT_EXAM_ID, LEGACY_SUBJECTS, SCHOOL_STREAMS, type ExamDefinition } from './catalog.js'

/**
 * Subjects for the student's chosen exam.
 *
 * - No exam chosen (every notebook from before exam choice) = JEE = Physics, Chemistry, Maths,
 *   exactly the list the app always used, so existing students see no change.
 * - Class 11/12 with a known stream use that stream's subjects.
 * - The 12th-boards add-on adds English plus the board versions of the exam's science subjects.
 */

let activeCatalog: readonly ExamDefinition[] = BUILT_IN_EXAMS
const listeners = new Set<() => void>()

/** Called when the published catalogue is fetched, so owner edits reach every subject list. */
export function setSubjectCatalog(catalog: readonly ExamDefinition[]) {
  if (!catalog.length || catalog === activeCatalog) return
  activeCatalog = catalog
  for (const listener of listeners) listener()
}

export function subscribeSubjectCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function currentSubjectCatalog(): readonly ExamDefinition[] {
  return activeCatalog
}

type ExamChoice = Pick<AppSettings, 'exam_id' | 'exam_session' | 'boards_addon'> | null | undefined

const BOARD_SCIENCE = ['Physics', 'Chemistry', 'Maths', 'Biology']

export function boardAddonSubjects(examSubjects: readonly string[]): string[] {
  const has = new Set(examSubjects)
  const science = BOARD_SCIENCE.filter(subject => has.has(subject) || (subject === 'Biology' && (has.has('Botany') || has.has('Zoology'))))
  return ['English', ...science]
}

export function examSubjects(settings: ExamChoice, catalog: readonly ExamDefinition[] = activeCatalog): string[] {
  const id = settings?.exam_id ?? LEGACY_DEFAULT_EXAM_ID
  const exam = catalog.find(item => item.id === id) ?? BUILT_IN_EXAMS.find(item => item.id === id)
  let base = exam?.subjects.length ? [...exam.subjects] : [...LEGACY_SUBJECTS]
  const stream = settings?.exam_session ? SCHOOL_STREAMS[settings.exam_session] : undefined
  if (stream && (id === 'class-11' || id === 'class-12')) base = [...stream]
  if (settings?.boards_addon && exam?.boards_addon) base = [...base, ...boardAddonSubjects(base)]
  return [...new Set(base)]
}

/**
 * Subjects to report on: the exam's subjects first, then any other subject that already has
 * records (e.g. after switching exam), so nothing a student logged ever disappears from analytics.
 */
export function subjectsFor(data: Pick<AppData, 'settings' | 'chapters' | 'tests' | 'testSubjectScores'>, catalog?: readonly ExamDefinition[]): string[] {
  const list = examSubjects(data.settings, catalog)
  const seen = new Set(list)
  const add = (subject: string | null | undefined) => {
    if (subject && !seen.has(subject)) { seen.add(subject); list.push(subject) }
  }
  for (const chapter of data.chapters) add(chapter.subject)
  for (const test of data.tests) add(test.subject)
  for (const score of data.testSubjectScores) add(score.subject)
  return list
}

/** Class-safe slug for subject colours; the original three keep their existing classes. */
export function subjectSlug(subject: string): string {
  return subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other'
}

const JEE_COLOURS: Record<string, string> = { Physics: 'var(--subject-physics)', Chemistry: 'var(--subject-chemistry)', Maths: 'var(--subject-maths)' }
const PALETTE = ['#7a5ea8', '#b0475f', '#2f8a8a', '#9a7b1f', '#4d6fb0', '#a8552b', '#5b7f3a', '#8a4f8f']

/** Chart colour for a subject: the original three keep their theme colours; others get a stable palette colour. */
export function subjectColor(subject: string): string {
  const known = JEE_COLOURS[subject]
  if (known) return known
  let hash = 0
  for (const char of subject) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!
}

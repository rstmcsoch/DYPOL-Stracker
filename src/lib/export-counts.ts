import { indiaDate, indiaToday } from './date'
import type { AppData } from '../types'

/**
 * The slice of the notebook a study report covers: tests dated in the range (with their
 * subject scores and chapter links), mistakes and focus sessions recorded in it, and
 * revisions completed or due in it. Shared by the PDF/DOCX builders and the counts shown
 * beside the export buttons, so the number on screen is the number in the file.
 */
export function scopedReportData(data: AppData, from: string, to: string): AppData {
  const between = (date: string) => (!from || date >= from) && (!to || date <= to)
  const tests = data.tests.filter(test => between(test.test_date))
  const testIds = new Set(tests.map(test => test.id))
  const mistakeIds = new Set(data.mistakes.filter(mistake => between(indiaDate(mistake.created_at))).map(mistake => mistake.id))
  const sessions = data.sessions.filter(session => between(indiaDate(session.started_at)))
  return {
    ...data, tests, testSubjectScores: data.testSubjectScores.filter(item => testIds.has(item.test_id)),
    testChapterLinks: data.testChapterLinks.filter(item => testIds.has(item.test_id)),
    mistakes: data.mistakes.filter(item => mistakeIds.has(item.id)), sessions,
    revisions: data.revisions.filter(item => (item.completed_at && between(indiaDate(item.completed_at))) || between(item.due_on))
  }
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** Records in a full JSON backup: every list in it (settings and profile are single objects, not counted). */
export function backupRecordCount(backup: object): number {
  return Object.values(backup).reduce<number>((count, value) => count + (Array.isArray(value) ? value.length : 0), 0)
}

export function backupCountLabel(count: number): string {
  return `${plural(count, 'record')} in this backup`
}

/** Tests the CSV will contain for the chosen range. */
export function csvCountLabel(included: number): string {
  return `${plural(included, 'test')} in this export`
}

/** What a PDF/DOCX report for the range is built from. */
export function reportCountLabel(data: AppData, from: string, to: string): string {
  const scoped = scopedReportData(data, from, to)
  return `Covers ${plural(scoped.tests.length, 'test')}, ${plural(scoped.mistakes.length, 'mistake')} and ${plural(scoped.sessions.length, 'study session')} in this range.`
}

/** Dated download names, matching the JSON and CSV exports (e.g. stracker-study-report-2026-11-01.pdf). */
export function reportFileName(kind: 'pdf' | 'docx', date = indiaToday()): string {
  return `stracker-study-report-${date}.${kind}`
}

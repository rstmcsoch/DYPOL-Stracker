import { differenceInCalendarDays, parseISO } from 'date-fns'
import { getMeanTestPercentage } from '../analytics.js'
import { pyqCompletion, syllabusProgress } from './progress.js'
import type { AppData, PYQExam, TrackId, UserExamTrack } from '../../types/index.js'
import { TRACK_IDS } from '../../types/index.js'

/**
 * Exam tracks share one master syllabus. Only dates and targets differ per track, and
 * the dates live in one place each: Main Session 1 and Advanced keep using the existing
 * Settings dates; Session 2 and Boards use `user_exam_tracks.exam_date`. No official
 * date is assumed anywhere in code.
 */

export const TRACK_LABEL: Record<TrackId, string> = {
  main1: 'JEE Main — Session 1',
  main2: 'JEE Main — Session 2',
  advanced: 'JEE Advanced',
  boards: 'Boards'
}

/** Which PYQ exam a track is measured against. Boards has no JEE PYQ relevance. */
export const TRACK_PYQ_EXAM: Record<TrackId, PYQExam | null> = {
  main1: 'Main', main2: 'Main', advanced: 'Advanced', boards: null
}

export const EXAM_MODE_WINDOW_DAYS = 30
export const EXAM_MODE_BOOST = 1.35

export function trackExamDate(data: AppData, track: TrackId): string | null {
  if (track === 'main1') return data.settings.main_exam_date || null
  if (track === 'advanced') return data.settings.advanced_exam_date || null
  const row = data.examTracks.find(item => item.track === track)
  return row?.exam_date ?? null
}

export function trackConfig(data: AppData, track: TrackId): UserExamTrack {
  const row = data.examTracks.find(item => item.track === track)
  const now = new Date().toISOString()
  return row ?? {
    id: `track-${track}`, track, label: TRACK_LABEL[track], exam_date: null, enabled: true,
    target_score: null, notes: '', created_at: now, updated_at: now
  }
}

/** Whole calendar days from `today` to the exam date (negative once it has passed). */
export function daysUntilExam(date: string | null, today: string): number | null {
  if (!date) return null
  return differenceInCalendarDays(parseISO(`${date}T12:00:00`), parseISO(`${today}T12:00:00`))
}

export function countdownLabel(days: number | null): string {
  if (days === null) return 'Date not set'
  if (days < 0) return 'Exam date has passed'
  if (days === 0) return 'Today'
  return `${days} day${days === 1 ? '' : 's'} left`
}

export interface ExamModeState {
  active: boolean
  /** Why it is on or off, shown to the student. */
  reason: string
  label: string | null
  daysLeft: number | null
  track: TrackId
  boost: number
}

/**
 * Exam Mode turns on automatically inside the final 30 days before the active track's
 * exam, or manually via Settings ("on"), and can be disabled ("off"). Auto mode never
 * activates without a configured date.
 */
export function currentExamMode(data: AppData, today: string): ExamModeState {
  const track = data.settings.active_track
  const days = daysUntilExam(trackExamDate(data, track), today)
  const label = TRACK_LABEL[track]
  const setting = data.settings.exam_mode
  if (setting === 'off') return { active: false, reason: 'Exam Mode is switched off in Settings.', label, daysLeft: days, track, boost: 1 }
  if (setting === 'on') return { active: true, reason: 'Exam Mode is switched on manually in Settings.', label, daysLeft: days, track, boost: EXAM_MODE_BOOST }
  if (days === null) return { active: false, reason: 'Add the exam date in Settings to enable automatic Exam Mode.', label, daysLeft: null, track, boost: 1 }
  if (days >= 0 && days <= EXAM_MODE_WINDOW_DAYS) {
    return { active: true, reason: `${label} is ${countdownLabel(days).toLowerCase()} away — inside the final ${EXAM_MODE_WINDOW_DAYS} days.`, label, daysLeft: days, track, boost: EXAM_MODE_BOOST }
  }
  return { active: false, reason: days !== null && days > EXAM_MODE_WINDOW_DAYS ? `Exam Mode starts ${EXAM_MODE_WINDOW_DAYS} days before ${label}.` : 'The active exam date has passed.', label, daysLeft: days, track, boost: 1 }
}

export interface TrackReadiness {
  track: TrackId
  label: string
  percent: number | null
  components: { label: string; value: number | null; note: string }[]
  daysLeft: number | null
  target: number | null
}

/**
 * Readiness for one track, derived from shared data: weighted syllabus completion,
 * PYQ completion for the track's exam (not Boards), and the average of the three most
 * recent tests. Components with no data are left out of the average and marked as such.
 */
export function trackReadiness(data: AppData, track: TrackId, today: string): TrackReadiness {
  const progress = syllabusProgress(data.chapters, data.settings)
  const pyqExam = TRACK_PYQ_EXAM[track]
  const pyq = pyqExam ? pyqCompletion(data.pyqRecords, null, pyqExam, data.settings) : null
  const recent = [...data.tests].sort((a, b) => b.test_date.localeCompare(a.test_date)).slice(0, 3)
  const testAverage = getMeanTestPercentage(recent, data.testSubjectScores).average
  const components = [
    { label: 'Weighted syllabus', value: progress.weighted, note: progress.weighted === null ? 'No chapters yet' : 'Shared syllabus' },
    { label: pyqExam ? `${pyqExam === 'Main' ? 'JEE Main' : 'JEE Advanced'} PYQs` : 'PYQs', value: pyq?.percent ?? null, note: pyq ? `${pyq.done} of ${pyq.total} years` : 'Not used for Boards' },
    { label: 'Recent tests', value: testAverage, note: recent.length ? `Last ${recent.length} test${recent.length === 1 ? '' : 's'}` : 'No tests yet' }
  ]
  const usable = components.map(item => item.value).filter((value): value is number => value !== null)
  const config = trackConfig(data, track)
  return {
    track,
    label: config.label || TRACK_LABEL[track],
    percent: usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null,
    components,
    daysLeft: daysUntilExam(trackExamDate(data, track), today),
    target: config.target_score
  }
}

export function allTrackReadiness(data: AppData, today: string): TrackReadiness[] {
  return TRACK_IDS.map(track => trackReadiness(data, track, today))
}

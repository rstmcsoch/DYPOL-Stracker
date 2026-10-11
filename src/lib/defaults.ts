import { SYLLABUS } from './syllabus.js'
import { createId, stableId } from './id.js'
import { indiaToday } from './date.js'
import { normalizeReadingFont } from './fonts.js'
import { normalizeColorTheme } from './themes.js'
import { EXAM_ID_PATTERN } from './exams/catalog.js'
import type {
  AppSettings, Chapter, ChapterImportance, ChapterStage, ChapterStageKey, ReminderKind, Subject,
  TrackId, UserExamTrack
} from '../types/index.js'
import { REMINDER_KINDS, TRACK_IDS } from '../types/index.js'

export function defaultSettings(userId: string, ownerName = ''): AppSettings {
  const now = new Date().toISOString()
  return {
    id: userId,
    user_id: userId,
    owner_name: ownerName,
    main_exam_date: '',
    advanced_exam_date: '',
    target_score: 240,
    theme: 'light',
    interface_font: 'default',
    color_theme: 'default',
    weak_threshold: 60,
    strong_threshold: 80,
    dropping_threshold: 10,
    revision_gaps: [1, 7, 30],
    daily_study_goal_minutes: 360,
    last_backup_at: null,
    sound_enabled: false,
    weight_high: 2,
    weight_medium: 1,
    weight_low: 0.5,
    pyq_from_year: 2019,
    pyq_to_year: 2026,
    active_track: 'main1',
    exam_mode: 'auto',
    reminders_enabled: false,
    reminder_time: '08:00',
    reminder_types: ['revision', 'backlog'],
    exam_id: null,
    exam_year: null,
    exam_session: null,
    exam_board: null,
    boards_addon: false,
    created_at: now,
    updated_at: now
  }
}

/**
 * Fill any fields missing from settings rows written before the JEE-preparation
 * extensions existed, so legacy student data keeps loading without silent wipes.
 */
export function normalizeSettings(row: Record<string, unknown>, userId: string): AppSettings {
  const fallback = defaultSettings(userId)
  const asNumber = (value: unknown, fallbackValue: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue
  const asInt = (value: unknown, fallbackValue: number): number =>
    typeof value === 'number' && Number.isInteger(value) ? value : fallbackValue
  const asBool = (value: unknown, fallbackValue: boolean): boolean =>
    typeof value === 'boolean' ? value : fallbackValue
  const reminderTypes = Array.isArray(row.reminder_types)
    ? row.reminder_types.filter((item): item is ReminderKind => REMINDER_KINDS.includes(item as ReminderKind))
    : fallback.reminder_types
  const track = typeof row.active_track === 'string' && (TRACK_IDS as readonly string[]).includes(row.active_track)
    ? row.active_track as TrackId
    : fallback.active_track
  return {
    ...(row as unknown as AppSettings),
    id: String(row.id ?? userId),
    user_id: String(row.user_id ?? userId),
    owner_name: typeof row.owner_name === 'string' ? row.owner_name : fallback.owner_name,
    main_exam_date: typeof row.main_exam_date === 'string' ? row.main_exam_date : '',
    advanced_exam_date: typeof row.advanced_exam_date === 'string' ? row.advanced_exam_date : '',
    target_score: asNumber(row.target_score, fallback.target_score),
    theme: row.theme === 'dark' || row.theme === 'auto' || row.theme === 'light' ? row.theme : fallback.theme,
    interface_font: normalizeReadingFont(row.interface_font),
    // Older accounts (and rows synced from before the palette existed) simply
    // fall back to the Default theme; invalid values can never leak through.
    color_theme: normalizeColorTheme(row.color_theme),
    weak_threshold: asNumber(row.weak_threshold, fallback.weak_threshold),
    strong_threshold: asNumber(row.strong_threshold, fallback.strong_threshold),
    dropping_threshold: asNumber(row.dropping_threshold, fallback.dropping_threshold),
    revision_gaps: Array.isArray(row.revision_gaps) && row.revision_gaps.length
      ? row.revision_gaps.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
      : fallback.revision_gaps,
    daily_study_goal_minutes: asInt(row.daily_study_goal_minutes, fallback.daily_study_goal_minutes),
    last_backup_at: typeof row.last_backup_at === 'string' ? row.last_backup_at : null,
    sound_enabled: asBool(row.sound_enabled, fallback.sound_enabled),
    weight_high: asNumber(row.weight_high, fallback.weight_high),
    weight_medium: asNumber(row.weight_medium, fallback.weight_medium),
    weight_low: asNumber(row.weight_low, fallback.weight_low),
    pyq_from_year: asInt(row.pyq_from_year, fallback.pyq_from_year),
    pyq_to_year: asInt(row.pyq_to_year, fallback.pyq_to_year),
    active_track: track,
    exam_mode: row.exam_mode === 'on' || row.exam_mode === 'off' || row.exam_mode === 'auto' ? row.exam_mode : fallback.exam_mode,
    reminders_enabled: asBool(row.reminders_enabled, fallback.reminders_enabled),
    reminder_time: typeof row.reminder_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.reminder_time) ? row.reminder_time : fallback.reminder_time,
    reminder_types: reminderTypes,
    exam_id: typeof row.exam_id === 'string' && EXAM_ID_PATTERN.test(row.exam_id) ? row.exam_id : null,
    exam_year: typeof row.exam_year === 'number' && Number.isInteger(row.exam_year) && row.exam_year >= 2020 && row.exam_year <= 2100 ? row.exam_year : null,
    exam_session: typeof row.exam_session === 'string' && row.exam_session.length <= 40 ? row.exam_session : null,
    exam_board: typeof row.exam_board === 'string' && row.exam_board.length <= 40 ? row.exam_board : null,
    boards_addon: row.boards_addon === true,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString()
  }
}

export function seedChapters(userId: string): Chapter[] {
  const now = new Date().toISOString()
  return (Object.entries(SYLLABUS) as [Subject, string[]][]).flatMap(([subject, names]) =>
    names.map((name, position) => ({
      id: stableId(`${userId}:${subject}:${name}`), user_id: userId, subject, name, position,
      status: 'Not Started' as const, priority: 'Medium' as const, importance: 'medium' as ChapterImportance,
      weightage: null, notes: '', formula_notes: '', completed_on: null,
      created_at: now, updated_at: now
    }))
  )
}

export function emptyChapter(userId: string, subject: Subject): Chapter {
  const now = new Date().toISOString()
  return {
    id: createId(), user_id: userId, subject, name: '', position: 0,
    status: 'Not Started', priority: 'Medium', importance: 'medium',
    weightage: null, notes: '', formula_notes: '', completed_on: null,
    created_at: now, updated_at: now
  }
}

export function emptyChapterStage(userId: string, chapterId: string, stage: ChapterStageKey, done: boolean): ChapterStage {
  const now = new Date().toISOString()
  return {
    id: stableId(`${userId}:stage:${chapterId}:${stage}`), user_id: userId, chapter_id: chapterId,
    stage, done, completed_at: done ? now : null, created_at: now, updated_at: now
  }
}

/** Default track configuration — dates stay blank and editable; no official dates are assumed. */
export function defaultExamTracks(userId: string): UserExamTrack[] {
  const now = new Date().toISOString()
  const labels: Record<TrackId, string> = {
    main1: 'JEE Main — Session 1', main2: 'JEE Main — Session 2',
    advanced: 'JEE Advanced', boards: 'Boards'
  }
  return TRACK_IDS.map(track => ({
    id: stableId(`${userId}:track:${track}`), user_id: userId, track,
    label: labels[track], exam_date: null, enabled: true, target_score: null, notes: '',
    created_at: now, updated_at: now
  }))
}

export function todayTaskDate(): string {
  return indiaToday()
}

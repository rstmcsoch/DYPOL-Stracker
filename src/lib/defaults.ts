import { SYLLABUS } from './syllabus'
import { createId, stableId } from './id'
import { indiaToday } from './date'
import type { AppSettings, Chapter, Subject } from '../types'

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
    weak_threshold: 60,
    strong_threshold: 80,
    dropping_threshold: 10,
    revision_gaps: [1, 7, 30],
    daily_study_goal_minutes: 360,
    last_backup_at: null,
    sound_enabled: false,
    created_at: now,
    updated_at: now
  }
}

export function seedChapters(userId: string): Chapter[] {
  const now = new Date().toISOString()
  return (Object.entries(SYLLABUS) as [Subject, string[]][]).flatMap(([subject, names]) =>
    names.map((name, position) => ({
      id: stableId(`${userId}:${subject}:${name}`), user_id: userId, subject, name, position,
      status: 'Not Started' as const, priority: 'Medium' as const,
      weightage: null, notes: '', formula_notes: '', completed_on: null,
      created_at: now, updated_at: now
    }))
  )
}

export function emptyChapter(userId: string, subject: Subject): Chapter {
  const now = new Date().toISOString()
  return {
    id: createId(), user_id: userId, subject, name: '', position: 0,
    status: 'Not Started', priority: 'Medium', weightage: null,
    notes: '', formula_notes: '', completed_on: null,
    created_at: now, updated_at: now
  }
}

export function todayTaskDate(): string {
  return indiaToday()
}

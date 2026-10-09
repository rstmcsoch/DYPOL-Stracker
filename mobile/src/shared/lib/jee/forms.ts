import { z } from 'zod'
import { BACKLOG_TYPES, ERROR_CATEGORIES, PRACTICE_SOURCES, PYQ_EXAMS, type BacklogType, type ErrorCategory, type PracticeSource, type Priority, type PYQExam, type Subject } from '../../types/index.js'

/**
 * Form validation shared by the JEE dialogs. Each validator returns field-keyed copy so
 * the UI can highlight the exact field, and a typed `value` when everything is valid.
 */

export type FieldErrors = Record<string, string>
export type Validated<T> = { ok: true; value: T; errors: FieldErrors } | { ok: false; value: null; errors: FieldErrors }

const isoDate = z.iso.date()
const MAX_COUNT = 100_000

export interface PracticeFormInput {
  chapterId: string; date: string; attempted: string; correct: string; incorrect: string
  source: PracticeSource; minutes: string; notes: string
}

export interface PracticeValue {
  chapter_id: string; practice_date: string; attempted: number; correct: number; incorrect: number
  source: PracticeSource; time_minutes: number | null; notes: string
}

function count(raw: string, field: string, errors: FieldErrors, { min = 0, max = MAX_COUNT, label }: { min?: number; max?: number; label: string }): number | null {
  if (raw.trim() === '') { errors[field] = `Enter ${label}.`; return null }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    errors[field] = `${label[0]!.toUpperCase()}${label.slice(1)} must be a whole number from ${min} to ${max.toLocaleString('en-IN')}.`
    return null
  }
  return value
}

export function validatePractice(input: PracticeFormInput, today: string): Validated<PracticeValue> {
  const errors: FieldErrors = {}
  if (!input.chapterId) errors.chapterId = 'Choose the chapter you practised.'
  if (!isoDate.safeParse(input.date).success) errors.date = 'Choose a valid date.'
  else if (input.date > today) errors.date = 'Practice dates cannot be in the future.'
  const attempted = count(input.attempted, 'attempted', errors, { min: 1, label: 'questions attempted' })
  const correct = count(input.correct, 'correct', errors, { label: 'correct answers' })
  const incorrect = count(input.incorrect, 'incorrect', errors, { label: 'incorrect answers' })
  if (attempted !== null && correct !== null && incorrect !== null && correct + incorrect > attempted) {
    errors.incorrect = `Correct (${correct}) and incorrect (${incorrect}) cannot add up to more than attempted (${attempted}).`
  }
  let minutes: number | null = null
  if (input.minutes.trim() !== '') {
    const parsed = count(input.minutes, 'minutes', errors, { max: 1440, label: 'minutes spent' })
    minutes = parsed
  }
  if (!PRACTICE_SOURCES.includes(input.source)) errors.source = 'Choose a source.'
  if (Object.keys(errors).length || attempted === null || correct === null || incorrect === null) return { ok: false, value: null, errors }
  return {
    ok: true, errors,
    value: { chapter_id: input.chapterId, practice_date: input.date, attempted, correct, incorrect, source: input.source, time_minutes: minutes, notes: input.notes.trim() }
  }
}

export interface BacklogFormInput {
  title: string; type: BacklogType; subject: Subject | ''; chapterId: string; priority: Priority; dueOn: string; notes: string
}
export interface BacklogValue {
  title: string; type: BacklogType; subject: Subject | null; chapter_id: string | null; priority: Priority; due_on: string | null; notes: string
}

export function validateBacklog(input: BacklogFormInput): Validated<BacklogValue> {
  const errors: FieldErrors = {}
  const title = input.title.trim()
  if (!title) errors.title = 'Give the item a short name, e.g. “Lecture 8 — EMI”.'
  else if (title.length > 200) errors.title = 'Keep the name under 200 characters.'
  if (!BACKLOG_TYPES.includes(input.type)) errors.type = 'Choose a type.'
  if (input.dueOn && !isoDate.safeParse(input.dueOn).success) errors.dueOn = 'Choose a valid date or leave it blank.'
  if (input.notes.length > 5000) errors.notes = 'Notes must be 5000 characters or fewer.'
  if (Object.keys(errors).length) return { ok: false, value: null, errors }
  return {
    ok: true, errors,
    value: {
      title, type: input.type, subject: input.subject || null, chapter_id: input.chapterId || null,
      priority: input.priority, due_on: input.dueOn || null, notes: input.notes.trim()
    }
  }
}

export interface PyqFormKey { chapterId: string; exam: PYQExam; year: number }

export interface ErrorLogFormInput { testId: string; subject: Subject | ''; category: ErrorCategory; marksLost: string; questions: string; note: string }
export interface ErrorLogValue { test_id: string; subject: Subject | null; category: ErrorCategory; marks_lost: number | null; questions: number | null; note: string }

export function validateErrorLog(input: ErrorLogFormInput): Validated<ErrorLogValue> {
  const errors: FieldErrors = {}
  if (!ERROR_CATEGORIES.includes(input.category)) errors.category = 'Choose a category.'
  let marks: number | null = null
  if (input.marksLost.trim() !== '') {
    const parsed = Number(input.marksLost)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999.99 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 1e-6) errors.marksLost = 'Enter marks lost as a number, 0 or more.'
    else marks = parsed
  }
  let questions: number | null = null
  if (input.questions.trim() !== '') {
    const parsed = Number(input.questions)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) errors.questions = 'Enter a whole number of questions.'
    else questions = parsed
  }
  if (input.note.length > 5000) errors.note = 'Keep the note under 5000 characters.'
  if (Object.keys(errors).length) return { ok: false, value: null, errors }
  return { ok: true, errors, value: { test_id: input.testId, subject: input.subject || null, category: input.category, marks_lost: marks, questions, note: input.note.trim() } }
}

export const PYQ_EXAM_OPTIONS = PYQ_EXAMS

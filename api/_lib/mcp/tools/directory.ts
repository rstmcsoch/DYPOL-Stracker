import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listStudentDirectory,
  loadStudentAccount,
  loadStudentActivity,
  loadStudentModerationHistory,
  loadStudentStudyOverview,
  updateStudentDisplayProfile
} from '../../services/student-directory.js'

const studentId = z.uuid()
const pageFields = {
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  status: z.enum(['all', 'verified', 'unverified', 'suspended']).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'last_sign_in']).optional()
}

export const listStudentsInput = z.object({ q: z.string().max(120).optional(), ...pageFields }).strict()
export const LIST_STUDENTS_SCHEMA = {
  type: 'object',
  properties: {
    q: { type: 'string', maxLength: 120, description: 'Optional email or display-name search' },
    status: { type: 'string', enum: ['all', 'verified', 'unverified', 'suspended'] },
    sort: { type: 'string', enum: ['created_desc', 'created_asc', 'last_sign_in'] },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 }
  },
  additionalProperties: false
} as const
export const LIST_STUDENTS_DESCRIPTION = 'List student accounts with pagination and filters. Never returns passwords, MFA, passkeys or other authentication secrets.'

export const searchStudentsInput = z.object({ q: z.string().min(1).max(120), ...pageFields }).strict()
export const SEARCH_STUDENTS_SCHEMA = {
  type: 'object',
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 120 },
    status: { type: 'string', enum: ['all', 'verified', 'unverified', 'suspended'] },
    sort: { type: 'string', enum: ['created_desc', 'created_asc', 'last_sign_in'] },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 }
  },
  required: ['q'],
  additionalProperties: false
} as const
export const SEARCH_STUDENTS_DESCRIPTION = 'Search student accounts by email or display name, with the same pagination and filters as list_students. Authentication secrets are never returned.'

const studentInput = z.object({ studentId }).strict()
const STUDENT_ID_SCHEMA = {
  type: 'object',
  properties: { studentId: { type: 'string', format: 'uuid', description: 'Target student account ID' } },
  required: ['studentId'],
  additionalProperties: false
} as const

export const getStudentAccountInput = studentInput
export const GET_STUDENT_ACCOUNT_SCHEMA = STUDENT_ID_SCHEMA
export const GET_STUDENT_ACCOUNT_DESCRIPTION = "Permitted profile and account metadata for one student: display name, registration, verification, last sign-in, exam tracks (without notes), and usage counts. Passwords, MFA and passkeys are never included."

export const getStudentActivityInput = studentInput
export const GET_STUDENT_ACTIVITY_SCHEMA = STUDENT_ID_SCHEMA
export const GET_STUDENT_ACTIVITY_DESCRIPTION = 'Activity summary for one student: record counts and recent test dates and study-session times. Marks, notes and other study content are not returned.'

export const getStudentStudyOverviewInput = studentInput
export const GET_STUDENT_STUDY_OVERVIEW_SCHEMA = STUDENT_ID_SCHEMA
export const GET_STUDENT_STUDY_OVERVIEW_DESCRIPTION = "Counts of the student's study-record tables. Row contents, notes and marks are not returned."

export const getStudentModerationHistoryInput = studentInput
export const GET_STUDENT_MODERATION_HISTORY_SCHEMA = STUDENT_ID_SCHEMA
export const GET_STUDENT_MODERATION_HISTORY_DESCRIPTION = 'Warning and ban history for one student. This tool does not apply sanctions.'

export const updateStudentDisplayProfileInput = z.object({ studentId, displayName: z.string().min(1).max(100) }).strict()
export const UPDATE_STUDENT_DISPLAY_PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    studentId: { type: 'string', format: 'uuid' },
    displayName: { type: 'string', minLength: 1, maxLength: 100 }
  },
  required: ['studentId', 'displayName'],
  additionalProperties: false
} as const
export const UPDATE_STUDENT_DISPLAY_PROFILE_DESCRIPTION = 'Update a student display name only. Email, passwords and other authentication identity cannot be changed. The Owner and Control Centre role holders are protected.'

export function directoryTools(admin: SupabaseClient) {
  return [
    {
      name: 'list_students',
      description: LIST_STUDENTS_DESCRIPTION,
      inputSchema: { ...LIST_STUDENTS_SCHEMA },
      parse: (args: unknown) => listStudentsInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => listStudentDirectory(admin, args)
    },
    {
      name: 'search_students',
      description: SEARCH_STUDENTS_DESCRIPTION,
      inputSchema: { ...SEARCH_STUDENTS_SCHEMA },
      parse: (args: unknown) => searchStudentsInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => listStudentDirectory(admin, { ...args, requireQuery: true })
    },
    {
      name: 'get_student_account',
      description: GET_STUDENT_ACCOUNT_DESCRIPTION,
      inputSchema: { ...GET_STUDENT_ACCOUNT_SCHEMA },
      parse: (args: unknown) => getStudentAccountInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentAccount(admin, String(args.studentId))
    },
    {
      name: 'get_student_activity',
      description: GET_STUDENT_ACTIVITY_DESCRIPTION,
      inputSchema: { ...GET_STUDENT_ACTIVITY_SCHEMA },
      parse: (args: unknown) => getStudentActivityInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentActivity(admin, String(args.studentId))
    },
    {
      name: 'get_student_study_overview',
      description: GET_STUDENT_STUDY_OVERVIEW_DESCRIPTION,
      inputSchema: { ...GET_STUDENT_STUDY_OVERVIEW_SCHEMA },
      parse: (args: unknown) => getStudentStudyOverviewInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentStudyOverview(admin, String(args.studentId))
    },
    {
      name: 'update_student_display_profile',
      description: UPDATE_STUDENT_DISPLAY_PROFILE_DESCRIPTION,
      inputSchema: { ...UPDATE_STUDENT_DISPLAY_PROFILE_SCHEMA },
      parse: (args: unknown) => updateStudentDisplayProfileInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => updateStudentDisplayProfile(admin, String(args.studentId), args.displayName)
    },
    {
      name: 'get_student_moderation_history',
      description: GET_STUDENT_MODERATION_HISTORY_DESCRIPTION,
      inputSchema: { ...GET_STUDENT_MODERATION_HISTORY_SCHEMA },
      parse: (args: unknown) => getStudentModerationHistoryInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentModerationHistory(admin, String(args.studentId))
    }
  ]
}

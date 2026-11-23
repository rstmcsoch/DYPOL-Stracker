import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudentAnalytics, loadStudentDashboard, loadStudentSettings } from '../../services/student-insights.js'

const studentInput = z.object({ studentId: z.uuid() }).strict()
const STUDENT_ID_SCHEMA = {
  type: 'object',
  properties: { studentId: { type: 'string', format: 'uuid' } },
  required: ['studentId'],
  additionalProperties: false
} as const

export const GET_STUDENT_DASHBOARD_DESCRIPTION = "Summary of one student's chapters, tests, mistakes, tasks due, and recent scored tests. Uses the same percentage maths as the student app. Notes are not included."
export const GET_STUDENT_SETTINGS_DESCRIPTION = "The student's app settings after the standard settings schema. Authentication secrets and AI keys are never included."
export const GET_STUDENT_ANALYTICS_DESCRIPTION = "Test averages by type and subject for one student, computed with the shared analytics helpers. Notes are not included."

export function insightTools(admin: SupabaseClient) {
  return [
    {
      name: 'get_student_dashboard',
      description: GET_STUDENT_DASHBOARD_DESCRIPTION,
      inputSchema: { ...STUDENT_ID_SCHEMA },
      parse: (args: unknown) => studentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentDashboard(admin, String(args.studentId))
    },
    {
      name: 'get_student_settings',
      description: GET_STUDENT_SETTINGS_DESCRIPTION,
      inputSchema: { ...STUDENT_ID_SCHEMA },
      parse: (args: unknown) => studentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentSettings(admin, String(args.studentId))
    },
    {
      name: 'get_student_analytics',
      description: GET_STUDENT_ANALYTICS_DESCRIPTION,
      inputSchema: { ...STUDENT_ID_SCHEMA },
      parse: (args: unknown) => studentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadStudentAnalytics(admin, String(args.studentId))
    }
  ]
}

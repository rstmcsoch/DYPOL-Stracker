import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import { banStudent, unbanStudent, warnStudent, loadSanctionTarget } from '../../services/student-moderation.js'

const reason = z.string().trim().min(5).max(500)
const confirmationToken = z.string().min(1).optional()
const studentId = z.uuid()

export const warnStudentInput = z.object({ studentId, reason, confirmationToken }).strict()
export const WARN_STUDENT_SCHEMA = {
  type: 'object',
  properties: {
    studentId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 5, maxLength: 500 },
    confirmationToken: { type: 'string', description: 'One-use token from the preview. Omit to preview the warning.' }
  },
  required: ['studentId', 'reason'],
  additionalProperties: false
} as const
export const WARN_STUDENT_DESCRIPTION = 'Issue a warning to a student. This is student-facing, so a preview and confirmation token are required before the warning is stored. The Owner and Control Centre role holders cannot be warned. Never delete an account.'

export const banStudentInput = z.object({
  studentId,
  reason,
  permanent: z.boolean(),
  until: z.iso.datetime().optional(),
  confirmationToken
}).strict().superRefine((value, context) => {
  if (!value.permanent && !value.until) {
    context.addIssue({ code: 'custom', path: ['until'], message: 'Give a ban end time, or mark the ban as permanent.' })
  }
})
export const BAN_STUDENT_SCHEMA = {
  type: 'object',
  properties: {
    studentId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 5, maxLength: 500 },
    permanent: { type: 'boolean' },
    until: { type: 'string', format: 'date-time' },
    confirmationToken: { type: 'string', description: 'One-use token from the preview. Omit to preview the ban.' }
  },
  required: ['studentId', 'reason', 'permanent'],
  additionalProperties: false
} as const
export const BAN_STUDENT_DESCRIPTION = 'Ban a student account after a confirmation preview. Permanent or timed bans revoke sessions. The Owner and Control Centre role holders cannot be banned. User-account deletion is permanently prohibited.'

export const unbanStudentInput = z.object({ studentId, reason: z.string().trim().min(5).max(500).optional(), confirmationToken }).strict()
export const UNBAN_STUDENT_SCHEMA = {
  type: 'object',
  properties: {
    studentId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 5, maxLength: 500 },
    confirmationToken: { type: 'string', description: 'One-use token from the preview. Omit to preview the unban.' }
  },
  required: ['studentId'],
  additionalProperties: false
} as const
export const UNBAN_STUDENT_DESCRIPTION = 'Lift a student ban after a confirmation preview. The Owner and Control Centre role holders cannot be unsanctioned through Master MCP.'

export function moderationTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    {
      name: 'warn_student',
      description: WARN_STUDENT_DESCRIPTION,
      inputSchema: { ...WARN_STUDENT_SCHEMA },
      parse: (args: unknown) => warnStudentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const target = await loadSanctionTarget(admin, String(args.studentId), actor.credentialId)
        const preview = await previewOrConfirm(confirmations, actor, 'warn_student', withoutConfirmationToken(args), { type: 'student', id: target.id, studentId: target.id }, args.confirmationToken, async () => ({
          operation: 'warn_student',
          targetType: 'student',
          targetId: target.id,
          targetStudentId: target.id,
          existing: { email: target.user.email ?? '', banned: target.activeBan },
          proposed: { kind: 'warning', reason: String(args.reason) },
          effects: ['A warning is stored on the student account and shown in Control Centre and Master moderation history.'],
          irreversible: false,
          validation: 'A confirmed warning writes one account_sanctions row with created_by_role master_mcp. It does not ban or delete the account.'
        }))
        if (preview) return preview
        return warnStudent(admin, { studentId: target.id, reason: String(args.reason), credentialId: actor.credentialId })
      }
    },
    {
      name: 'ban_student',
      description: BAN_STUDENT_DESCRIPTION,
      inputSchema: { ...BAN_STUDENT_SCHEMA },
      parse: (args: unknown) => banStudentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const target = await loadSanctionTarget(admin, String(args.studentId), actor.credentialId)
        const preview = await previewOrConfirm(confirmations, actor, 'ban_student', withoutConfirmationToken(args), { type: 'student', id: target.id, studentId: target.id }, args.confirmationToken, async () => ({
          operation: 'ban_student',
          targetType: 'student',
          targetId: target.id,
          targetStudentId: target.id,
          existing: { email: target.user.email ?? '', banned: target.activeBan, until: target.banRow?.banned_until ?? null },
          proposed: { permanent: args.permanent === true, until: args.until ?? null, reason: String(args.reason) },
          effects: [
            'The student is blocked from signing in for the stated duration.',
            'Active sessions are revoked.',
            'A ban record is stored for Control Centre and Master moderation history.'
          ],
          irreversible: args.permanent === true,
          validation: 'A confirmed ban updates Auth ban_duration and writes account_sanctions plus account_bans. It never deletes the user account.'
        }))
        if (preview) return preview
        return banStudent(admin, {
          studentId: target.id,
          reason: String(args.reason),
          permanent: args.permanent === true,
          until: typeof args.until === 'string' ? args.until : undefined,
          credentialId: actor.credentialId
        })
      }
    },
    {
      name: 'unban_student',
      description: UNBAN_STUDENT_DESCRIPTION,
      inputSchema: { ...UNBAN_STUDENT_SCHEMA },
      parse: (args: unknown) => unbanStudentInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (actor: MasterActor, args: Record<string, unknown>) => {
        const target = await loadSanctionTarget(admin, String(args.studentId), actor.credentialId)
        const preview = await previewOrConfirm(confirmations, actor, 'unban_student', withoutConfirmationToken(args), { type: 'student', id: target.id, studentId: target.id }, args.confirmationToken, async () => ({
          operation: 'unban_student',
          targetType: 'student',
          targetId: target.id,
          targetStudentId: target.id,
          existing: { email: target.user.email ?? '', banned: target.activeBan, until: target.banRow?.banned_until ?? null },
          proposed: { banned: false, reason: args.reason ?? null },
          effects: ['The student can sign in again.', 'The active ban record is cleared.', 'An unban notice is stored in the sanction history.'],
          irreversible: false,
          validation: 'A confirmed unban sets Auth ban_duration to none and removes the account_bans row. It does not delete the account.'
        }))
        if (preview) return preview
        return unbanStudent(admin, { studentId: target.id, reason: typeof args.reason === 'string' ? args.reason : undefined, credentialId: actor.credentialId })
      }
    }
  ]
}

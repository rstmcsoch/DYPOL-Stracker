import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as layout from '../../services/student-layout-editor.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const empty = z.object({}).strict()
const noteField = z.string().trim().max(280).optional()
const confirmation = z.string().min(1).optional()
const expectedUpdatedAt = z.string().max(40).nullable().optional()
const pageFields = { page: z.number().int().min(1).max(10_000).optional(), pageSize: z.number().int().min(1).max(100).optional() }

export function studentLayoutTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool('get_student_dashboard_layout', 'Read the published Student Dashboard Editor layout. This is presentation configuration only, not live student data.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => layout.getStudentDashboardLayout(admin)),
    tool('get_student_dashboard_layout_draft', 'Read the unpublished student layout draft. If none exists, the published layout is returned as the working document with exists: false.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => layout.getStudentDashboardLayoutDraft(admin)),
    tool('update_student_dashboard_layout', 'Replace the unpublished student layout draft after the existing layout validator runs. Required and data-bound components stay protected. Nothing is published.', jsonSchema({ document: { type: 'object' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['document']), args => z.object({ document: z.unknown(), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.updateStudentDashboardLayout(admin, args as { document: unknown; expectedUpdatedAt?: string | null })),
    tool('update_student_dashboard_component', 'Update one registered student component in the draft (supported text, props, style, visibility or lock). Essential components cannot be hidden; data-bound values cannot be written. Nothing is published.', jsonSchema({ id: { type: 'string' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' }, text: { type: 'object' }, props: { type: 'object' }, style: { type: 'object' }, responsive: { type: 'object' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['id']), args => z.object({
      id: z.string().min(1).max(80),
      hidden: z.boolean().optional(),
      locked: z.boolean().optional(),
      text: z.record(z.string(), z.string()).optional(),
      props: z.record(z.string(), z.unknown()).optional(),
      style: z.record(z.string(), z.string()).optional(),
      responsive: z.object({ tablet: z.record(z.string(), z.string()).optional(), mobile: z.record(z.string(), z.string()).optional() }).strict().optional(),
      expectedUpdatedAt
    }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.updateStudentDashboardComponent(admin, args as Parameters<typeof layout.updateStudentDashboardComponent>[1])),
    tool('reorder_student_dashboard_components', 'Set the order of a container’s parts in the draft. Fixed-position and required parts cannot move. Nothing is published.', jsonSchema({ containerId: { type: 'string' }, order: { type: 'array', items: { type: 'string' } }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['containerId', 'order']), args => z.object({ containerId: z.string().min(1).max(80), order: z.array(z.string().min(1).max(80)).min(1), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.reorderStudentDashboardComponents(admin, args as { containerId: string; order: string[]; expectedUpdatedAt?: string | null })),
    tool('preview_student_dashboard_layout', 'Validate the current draft (or a supplied layout) and return a validation report plus compiled CSS for phone, tablet and desktop. This does not publish.', jsonSchema({ document: { type: 'object' } }, []), args => z.object({ document: z.unknown().optional() }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.previewStudentDashboardLayout(admin, args)),
    tool('validate_student_dashboard_layout', 'Validate the current draft (or a supplied layout) with the existing Student Dashboard Editor validator. This does not publish.', jsonSchema({ document: { type: 'object' } }, []), args => z.object({ document: z.unknown().optional() }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.validateStudentDashboardLayout(admin, args)),
    tool('publish_student_dashboard_layout', 'Publish the validated student layout draft atomically through student_layout_commit and append version history. Requires confirmation. Never writes student_layout_published directly.', jsonSchema({ note: { type: 'string' }, confirmationToken: { type: 'string' } }, []), args => z.object({ note: noteField, confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const prepared = await layout.prepareLayoutPublish(admin)
      if (!prepared.ok) return prepared
      const preview = await previewOrConfirm(confirmations, actor, 'publish_student_dashboard_layout', withoutConfirmationToken(args), { type: 'student_layout', id: 'workspace', version: String(prepared.before) }, args.confirmationToken, async () => ({
        operation: 'publish_student_dashboard_layout',
        targetType: 'student_layout',
        targetId: 'workspace',
        existing: { version: prepared.before },
        proposed: { areas: prepared.areas },
        effects: [
          'The validated draft is published atomically through student_layout_commit.',
          'A new version is appended to the existing history.',
          'The draft is consumed. The published layout row is not written directly.'
        ],
        irreversible: false,
        validation: 'The draft is re-validated immediately before the commit. Required and data-bound protections stay in force.'
      }))
      if (preview) return preview
      return layout.publishStudentDashboardLayout(admin, typeof args.note === 'string' ? args.note : '')
    }),
    tool('list_student_layout_versions', 'List student layout version history (metadata only).', jsonSchema({ page: { type: 'integer' }, pageSize: { type: 'integer' } }, []), args => z.object(pageFields).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => layout.listStudentLayoutVersions(admin, args as { page?: number; pageSize?: number })),
    tool('restore_student_dashboard_layout_version', 'Restore an earlier student layout as a new version through student_layout_commit. Requires confirmation. The version is re-validated first. Never writes student_layout_published directly.', jsonSchema({ version: { type: 'integer' }, note: { type: 'string' }, confirmationToken: { type: 'string' } }, ['version']), args => z.object({ version: z.number().int().min(1).max(1_000_000), note: noteField, confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const version = Number(args.version)
      const prepared = await layout.prepareLayoutRestore(admin, version)
      if (!prepared.ok) return prepared
      const preview = await previewOrConfirm(confirmations, actor, 'restore_student_dashboard_layout_version', withoutConfirmationToken(args), { type: 'student_layout', id: 'workspace', version: String(version) }, args.confirmationToken, async () => ({
        operation: 'restore_student_dashboard_layout_version',
        targetType: 'student_layout',
        targetId: 'workspace',
        existing: { version: prepared.before },
        proposed: { restore: version, areas: prepared.areas },
        effects: [
          'The chosen version is re-validated against the current editor.',
          'It is published as a new version through student_layout_commit.',
          'The published layout row is not written directly.'
        ],
        irreversible: false,
        validation: 'A version that no longer validates is refused.'
      }))
      if (preview) return preview
      return layout.restoreStudentDashboardLayoutVersion(admin, version, typeof args.note === 'string' ? args.note : '')
    })
  ]
}

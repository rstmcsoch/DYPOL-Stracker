import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import { CONTACT_REASON_VALUES, CONTACT_STATUSES } from '../../../../src/lib/contact/reasons.js'
import * as messages from '../../services/contact-messages.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const confirmation = z.string().min(1).optional()
const idInput = z.object({ id: z.string().uuid() }).strict()

export function contactMessageTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool(
      'list_contact_messages',
      'List and search the public website contact inbox. Filter by status or reason. Pending uploads are hidden. This tool does not send email.',
      jsonSchema({
        status: { type: 'string', enum: ['all', 'active', ...CONTACT_STATUSES] },
        reason: { type: 'string', enum: ['all', ...CONTACT_REASON_VALUES] },
        q: { type: 'string' },
        page: { type: 'integer' }
      }, []),
      args => z.object({
        status: z.enum(['all', 'active', ...CONTACT_STATUSES]).optional(),
        reason: z.enum(['all', ...CONTACT_REASON_VALUES]).optional(),
        q: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).max(10_000).optional()
      }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => messages.listContactMessages(admin, args)
    ),
    tool(
      'get_contact_message',
      'Read one contact message, including short-lived signed attachment URLs. Permanent storage URLs and bucket credentials are never returned. This tool does not send email.',
      jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']),
      args => idInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => messages.getContactMessage(admin, String(args.id))
    ),
    tool(
      'update_contact_message_status',
      'Mark a contact message as new, read or archived. The change is audited by message id only, never by email or body text.',
      jsonSchema({ id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: [...CONTACT_STATUSES] } }, ['id', 'status']),
      args => z.object({ id: z.string().uuid(), status: z.enum(CONTACT_STATUSES) }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => messages.updateContactMessageStatus(admin, String(args.id), args.status)
    ),
    tool(
      'archive_contact_message',
      'Archive a contact message. This does not delete it and does not send email.',
      jsonSchema({ id: { type: 'string', format: 'uuid' } }, ['id']),
      args => idInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => messages.archiveContactMessage(admin, String(args.id))
    ),
    tool(
      'delete_contact_message',
      'Permanently delete a contact message and its attachments. Requires confirmation. This does not send email.',
      jsonSchema({ id: { type: 'string', format: 'uuid' }, confirmationToken: { type: 'string' } }, ['id']),
      args => z.object({ id: z.string().uuid(), confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (actor, args) => {
        const current = await messages.getContactMessage(admin, String(args.id))
        const fileCount = Array.isArray(current.message.files) ? current.message.files.length : 0
        const preview = await previewOrConfirm(confirmations, actor, 'delete_contact_message', withoutConfirmationToken(args), { type: 'contact_message', id: String(args.id) }, args.confirmationToken, async () => ({
          operation: 'delete_contact_message',
          targetType: 'contact_message',
          targetId: String(args.id),
          existing: { status: current.message.status, fileCount },
          proposed: { deleted: true },
          effects: [
            'The message is permanently removed from the inbox.',
            fileCount ? `${fileCount} attached file${fileCount === 1 ? '' : 's'} will also be deleted.` : 'There are no attached files to delete.',
            'No email is sent.'
          ],
          relatedRecords: { attachments: fileCount },
          irreversible: true,
          validation: 'If attached files cannot be removed, the message is kept.'
        }))
        if (preview) return preview
        return messages.deleteContactMessage(admin, String(args.id))
      }
    )
  ]
}

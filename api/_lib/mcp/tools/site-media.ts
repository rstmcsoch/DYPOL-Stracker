import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as media from '../../services/site-media.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const confirmation = z.string().min(1).optional()
const listInput = z.object({
  q: z.string().trim().max(80).optional(),
  kind: z.enum(['image', 'video', 'all']).optional(),
  usage: z.enum(['all', 'unused', 'in_use']).optional()
}).strict()
const pathInput = z.object({ path: z.string().min(1).max(200) }).strict()

export function siteMediaTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool(
      'list_site_media',
      'List and search the public website media library. Filter by kind or whether a file is unused. Approved JPEG, PNG, WebP and MP4 files only. Public URLs are returned; storage credentials are not.',
      jsonSchema({
        q: { type: 'string', description: 'Search name, alt text, path or MIME type.' },
        kind: { type: 'string', enum: ['image', 'video', 'all'] },
        usage: { type: 'string', enum: ['all', 'unused', 'in_use'] }
      }, []),
      args => listInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => media.listSiteMedia(admin, args)
    ),
    tool(
      'get_site_media',
      'Inspect one media library file: metadata, size, public URL and where it is used (draft, live site, saved versions).',
      jsonSchema({ path: { type: 'string' } }, ['path']),
      args => pathInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => media.getSiteMedia(admin, String(args.path))
    ),
    tool(
      'upload_site_media',
      'Add an image or MP4 to the media library. Only approved MIME types are accepted. Small files may be sent as base64; larger files receive a single-use signed upload URL. The file is not published until a site draft uses it.',
      jsonSchema({
        kind: { type: 'string', enum: ['image', 'video'] },
        mime: { type: 'string' },
        bytes: { type: 'integer' },
        name: { type: 'string' },
        contentBase64: { type: 'string', description: 'Optional file content for small images. Larger files should use the signed URL flow.' }
      }, ['mime']),
      args => z.object({
        kind: z.enum(['image', 'video']).optional(),
        mime: z.string().trim().min(1).max(40),
        bytes: z.number().int().positive().optional(),
        name: z.string().max(80).optional(),
        contentBase64: z.string().min(1).max(260_000).optional()
      }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => media.uploadSiteMedia(admin, args)
    ),
    tool(
      'update_site_media',
      'Update the display name and alt text of a library file. This does not change any page by itself.',
      jsonSchema({ path: { type: 'string' }, name: { type: 'string' }, alt: { type: 'string' } }, ['path']),
      args => z.object({ path: z.string().min(1).max(200), name: z.string().max(80).optional(), alt: z.string().max(200).optional() }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => media.updateSiteMedia(admin, args)
    ),
    tool(
      'get_media_usage',
      'Show whether a media file is referenced by the draft, the live site or any saved version. Referenced files cannot be deleted.',
      jsonSchema({ path: { type: 'string' } }, ['path']),
      args => pathInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => media.getMediaUsage(admin, String(args.path))
    ),
    tool(
      'delete_site_media',
      'Delete a genuinely unused media file from the library and storage. Requires confirmation. Files still referenced by a draft, the live site or a saved version are refused.',
      jsonSchema({ path: { type: 'string' }, confirmationToken: { type: 'string' } }, ['path']),
      args => z.object({ path: z.string().min(1).max(200), confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (actor, args) => {
        const usage = await media.getMediaUsage(admin, String(args.path))
        if (usage.used) {
          return media.deleteSiteMedia(admin, String(args.path))
        }
        const preview = await previewOrConfirm(confirmations, actor, 'delete_site_media', withoutConfirmationToken(args), { type: 'site_media', id: String(args.path) }, args.confirmationToken, async () => ({
          operation: 'delete_site_media',
          targetType: 'site_media',
          targetId: String(args.path),
          existing: usage,
          proposed: { deleted: true },
          effects: [
            'The file is removed from the homepage-media bucket and the site_media library.',
            'Nothing on the live site or in saved versions currently references this path.'
          ],
          relatedRecords: { references: 0 },
          irreversible: true,
          validation: 'Deletion is refused if the draft, live site or any saved version still refers to the file.'
        }))
        if (preview) return preview
        return media.deleteSiteMedia(admin, String(args.path))
      }
    )
  ]
}

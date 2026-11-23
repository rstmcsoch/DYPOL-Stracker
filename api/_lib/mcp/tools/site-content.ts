import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as site from '../../services/site-content.js'

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

export function siteContentTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool('get_site_content', 'Read the current public-site draft and published copy (overrides plus Live Site Editor document). Drafts are never treated as live.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => site.getSiteContent(admin)),
    tool('get_site_published_version', 'Read the currently published public-site version only.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => site.getSitePublishedVersion(admin)),
    tool('get_site_draft', 'Read the unpublished public-site draft. If none exists, the published copy is returned as the working document with exists: false.', jsonSchema({}, []), args => empty.parse(args ?? {}) as Record<string, unknown>, async () => site.getSiteDraft(admin)),
    tool('update_site_content_draft', 'Replace the unpublished public-site draft using the existing Live Site Editor validators. Nothing is published. A revision check is applied when expectedUpdatedAt is sent.', jsonSchema({ overrides: { type: 'object' }, document: { type: 'object' }, expectedUpdatedAt: { type: ['string', 'null'] } }, []), args => z.object({ overrides: z.record(z.string(), z.unknown()).optional(), document: z.unknown().optional(), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.updateSiteContentDraft(admin, args)),
    tool('update_site_page', 'Replace the blocks on one public page in the draft (home, privacy, terms, about or contact). The change is validated with checkSiteDocument and is not published.', jsonSchema({ page: { type: 'string' }, blocks: { type: 'array' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['page', 'blocks']), args => z.object({ page: z.string().min(1).max(40), blocks: z.array(z.unknown()), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.updateSitePage(admin, args as { page: string; blocks: unknown; expectedUpdatedAt?: string | null })),
    tool('update_site_blocks', 'Replace the blocks on one public page in the draft. Unsupported block types or properties are rejected by the existing validator. Nothing is published.', jsonSchema({ page: { type: 'string' }, blocks: { type: 'array' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['page', 'blocks']), args => z.object({ page: z.string().min(1).max(40), blocks: z.array(z.unknown()), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.updateSiteBlocks(admin, args as { page: string; blocks: unknown; expectedUpdatedAt?: string | null })),
    tool('update_site_navigation_labels', 'Update only existing public-header and notebook navigation label keys in the draft. Destinations and access rules stay fixed. Nothing is published.', jsonSchema({ labels: { type: 'object' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['labels']), args => z.object({ labels: z.record(z.string(), z.unknown()), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.updateSiteNavigationLabels(admin, args as { labels: Record<string, unknown>; expectedUpdatedAt?: string | null })),
    tool('update_site_design_tokens', 'Merge Live Site Editor design tokens (light:name / dark:name) into the draft document. Unknown or disallowed values are rejected. Nothing is published.', jsonSchema({ tokens: { type: 'object' }, expectedUpdatedAt: { type: ['string', 'null'] } }, ['tokens']), args => z.object({ tokens: z.record(z.string(), z.string().nullable()), expectedUpdatedAt }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.updateSiteDesignTokens(admin, args as { tokens: Record<string, string | null>; expectedUpdatedAt?: string | null })),
    tool('preview_site_content', 'Validate the current draft (or a supplied document) and return a validation report plus compiled CSS for one page. This does not publish.', jsonSchema({ overrides: { type: 'object' }, document: { type: 'object' }, page: { type: 'string' } }, []), args => z.object({ overrides: z.record(z.string(), z.unknown()).optional(), document: z.unknown().optional(), page: z.string().min(1).max(40).optional() }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.previewSiteContent(admin, args)),
    tool('validate_site_content', 'Validate the current draft (or a supplied document) with the existing Live Site Editor and copy validators. This does not publish.', jsonSchema({ overrides: { type: 'object' }, document: { type: 'object' } }, []), args => z.object({ overrides: z.record(z.string(), z.unknown()).optional(), document: z.unknown().optional() }).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.validateSiteContent(admin, args)),
    tool('publish_site_content', 'Publish the validated public-site draft atomically through site_content_commit_document and append version history. Requires confirmation. Never writes site_content_published directly.', jsonSchema({ note: { type: 'string' }, confirmationToken: { type: 'string' } }, []), args => z.object({ note: noteField, confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const prepared = await site.prepareSitePublish(admin)
      if (!prepared.ok) return prepared
      const preview = await previewOrConfirm(confirmations, actor, 'publish_site_content', withoutConfirmationToken(args), { type: 'site_content', id: 'site', version: String(prepared.before) }, args.confirmationToken, async () => ({
        operation: 'publish_site_content',
        targetType: 'site_content',
        targetId: 'site',
        existing: { version: prepared.before },
        proposed: { changed: prepared.changed },
        effects: [
          'The validated draft is published atomically through site_content_commit_document.',
          'A new version is appended to the existing history.',
          'The draft is consumed. The live site is not written directly.'
        ],
        irreversible: false,
        validation: 'The draft is re-validated immediately before the commit. An invalid or unchanged draft is refused.'
      }))
      if (preview) return preview
      return site.publishSiteContent(admin, typeof args.note === 'string' ? args.note : '')
    }),
    tool('list_site_content_versions', 'List public-site version history (metadata only). Restore publishes a previous version as a new version through the same commit function.', jsonSchema({ page: { type: 'integer' }, pageSize: { type: 'integer' } }, []), args => z.object(pageFields).strict().parse(args ?? {}) as Record<string, unknown>, async (_actor, args) => site.listSiteContentVersions(admin, args as { page?: number; pageSize?: number })),
    tool('restore_site_content_version', 'Restore an earlier public-site version as a new version through site_content_commit_document. Requires confirmation. The version is re-validated first. Never writes site_content_published directly.', jsonSchema({ version: { type: 'integer' }, note: { type: 'string' }, confirmationToken: { type: 'string' } }, ['version']), args => z.object({ version: z.number().int().min(1).max(1_000_000), note: noteField, confirmationToken: confirmation }).strict().parse(args ?? {}) as Record<string, unknown>, async (actor, args) => {
      const version = Number(args.version)
      const prepared = await site.prepareSiteRestore(admin, version)
      if (!prepared.ok) return prepared
      const preview = await previewOrConfirm(confirmations, actor, 'restore_site_content_version', withoutConfirmationToken(args), { type: 'site_content', id: 'site', version: String(version) }, args.confirmationToken, async () => ({
        operation: 'restore_site_content_version',
        targetType: 'site_content',
        targetId: 'site',
        existing: { version: prepared.before },
        proposed: { restore: version, changed: prepared.changed },
        effects: [
          'The chosen version is re-validated against the current editor.',
          'It is published as a new version through site_content_commit_document.',
          'The live site is not written directly.'
        ],
        irreversible: false,
        validation: 'A version that no longer validates, or that already matches the live site, is refused.'
      }))
      if (preview) return preview
      return site.restoreSiteContentVersion(admin, version, typeof args.note === 'string' ? args.note : '')
    })
  ]
}

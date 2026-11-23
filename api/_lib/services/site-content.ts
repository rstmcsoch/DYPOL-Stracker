import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { SITE_CONTENT_SCHEMA_VERSION, SITE_CONTENT_FIELDS } from '../../../src/lib/site-content/registry.js'
import {
  diffSiteValues,
  resolveSiteValues,
  sanitizeStoredOverrides,
  validateOverrides,
  type SiteOverrides
} from '../../../src/lib/site-content/content.js'
import { checkSiteDocument, problemsToErrors } from '../../../src/lib/site-editor/validate.js'
import { SITE_DOCUMENT_SCHEMA_VERSION, SITE_PAGE_IDS, type SiteDocument, type SitePageId } from '../../../src/lib/site-editor/model.js'
import { compileBlocksCss } from '../../../src/lib/site-editor/compile-css.js'

const VERSION_LIST_LIMIT = 20
const NAV_KEY = /^(user\.nav\.|public\.header\.)/
const KNOWN_FIELDS = new Set(SITE_CONTENT_FIELDS.map(field => field.key))

type Row = Record<string, unknown>

export type DraftSaveResult =
  | { ok: true; updatedAt: string; fieldsChanged: number; hasDocument: boolean }
  | { ok: false; error: 'invalid_content' | 'invalid_document'; message: string; errors: Record<string, string> }

function asOverrides(value: unknown): SiteOverrides {
  return sanitizeStoredOverrides(value)
}

function checkDocument(raw: unknown): { ok: true; document: SiteDocument | null } | { ok: false; errors: Record<string, string> } {
  if (raw === null || raw === undefined) return { ok: true, document: null }
  const { document, problems } = checkSiteDocument(raw)
  if (problems.length) return { ok: false, errors: problemsToErrors(problems) }
  return { ok: true, document }
}

function sameDocument(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function countChanges(before: SiteOverrides, after: SiteOverrides, beforeDoc: unknown, afterDoc: unknown): number {
  return diffSiteValues(resolveSiteValues(before), resolveSiteValues(after)).length + (sameDocument(beforeDoc, afterDoc) ? 0 : 1)
}

async function readDraft(admin: SupabaseClient): Promise<Row | null> {
  const { data, error } = await admin.from('site_content_draft').select('content, document, schema_version, updated_at, updated_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The draft could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

async function readPublished(admin: SupabaseClient): Promise<Row | null> {
  const { data, error } = await admin.from('site_content_published').select('content, document, schema_version, version, published_at, published_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The published copy could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

export async function workingSite(admin: SupabaseClient) {
  const [draft, published] = await Promise.all([readDraft(admin), readPublished(admin)])
  return {
    draft,
    published,
    hasDraft: Boolean(draft),
    overrides: asOverrides(draft?.content ?? published?.content),
    document: ((draft ? draft.document : published?.document) as SiteDocument | null | undefined) ?? null,
    draftUpdatedAt: (draft?.updated_at as string | undefined) ?? null,
    publishedVersion: typeof published?.version === 'number' ? published.version : 0,
    publishedAt: (published?.published_at as string | undefined) ?? null
  }
}

function assertRevision(currentAt: string | null, expected: string | null | undefined) {
  if (expected === undefined) return
  const same = currentAt === expected || (currentAt !== null && expected !== null && Date.parse(currentAt) === Date.parse(expected))
  if (!same) throw new ApiError(409, 'draft_conflict', 'The draft was changed in another tab or by another administrator. Reload to see it; nothing was saved.')
}

export async function saveSiteDraft(admin: SupabaseClient, input: { overrides: unknown; document: unknown; expectedUpdatedAt?: string | null }): Promise<DraftSaveResult> {
  const overrides = validateOverrides(input.overrides)
  const document = checkDocument(input.document)
  if (!overrides.ok) return { ok: false, error: 'invalid_content', message: 'Some fields need attention. Nothing was saved.', errors: overrides.errors }
  if (!document.ok) return { ok: false, error: 'invalid_document', message: 'Some blocks need attention. Nothing was saved.', errors: document.errors }
  const current = await readDraft(admin)
  assertRevision((current?.updated_at as string | undefined) ?? null, input.expectedUpdatedAt)
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from('site_content_draft').upsert({
    id: 1,
    content: overrides.overrides,
    document: document.document,
    schema_version: SITE_CONTENT_SCHEMA_VERSION,
    updated_at: updatedAt,
    updated_by: null
  }, { onConflict: 'id' })
  if (error) throw new ApiError(503, 'content_unavailable', 'The draft could not be saved. Nothing was changed; try again.')
  return { ok: true, updatedAt, fieldsChanged: Object.keys(overrides.overrides).length, hasDocument: document.document !== null }
}

export async function getSiteContent(admin: SupabaseClient) {
  const state = await workingSite(admin)
  return {
    schemaVersion: SITE_CONTENT_SCHEMA_VERSION,
    draft: { exists: state.hasDraft, overrides: state.overrides, document: state.document, updatedAt: state.draftUpdatedAt },
    published: { version: state.publishedVersion, overrides: asOverrides(state.published?.content), document: state.published?.document ?? null, publishedAt: state.publishedAt }
  }
}

export async function getSitePublishedVersion(admin: SupabaseClient) {
  const published = await readPublished(admin)
  return {
    version: typeof published?.version === 'number' ? published.version : 0,
    overrides: asOverrides(published?.content),
    document: published?.document ?? null,
    publishedAt: (published?.published_at as string | undefined) ?? null,
    schemaVersion: published?.schema_version ?? SITE_CONTENT_SCHEMA_VERSION
  }
}

export async function getSiteDraft(admin: SupabaseClient) {
  const state = await workingSite(admin)
  return { exists: state.hasDraft, overrides: state.overrides, document: state.document, updatedAt: state.draftUpdatedAt, basedOnPublished: !state.hasDraft }
}

export async function updateSiteContentDraft(admin: SupabaseClient, input: { overrides?: unknown; document?: unknown; expectedUpdatedAt?: string | null }) {
  if (input.overrides === undefined && input.document === undefined) {
    throw new ApiError(400, 'invalid_request', 'Send the draft overrides, the page document, or both.')
  }
  const state = await workingSite(admin)
  return saveSiteDraft(admin, {
    overrides: input.overrides !== undefined ? input.overrides : state.overrides,
    document: input.document !== undefined ? input.document : state.document,
    expectedUpdatedAt: input.expectedUpdatedAt
  })
}

function withPage(document: SiteDocument | null, page: SitePageId, blocks: unknown): SiteDocument {
  if (!Array.isArray(blocks)) throw new ApiError(400, 'invalid_request', 'Send the page as a list of blocks.')
  return {
    schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION,
    pages: { ...(document?.pages ?? {}), [page]: { blocks } },
    tokens: document?.tokens
  }
}

export async function updateSitePage(admin: SupabaseClient, input: { page: string; blocks: unknown; expectedUpdatedAt?: string | null }) {
  if (!(SITE_PAGE_IDS as readonly string[]).includes(input.page)) {
    throw new ApiError(400, 'invalid_request', 'Choose a public site page (home, privacy, terms, about or contact).')
  }
  const state = await workingSite(admin)
  return saveSiteDraft(admin, {
    overrides: state.overrides,
    document: withPage(state.document, input.page as SitePageId, input.blocks),
    expectedUpdatedAt: input.expectedUpdatedAt ?? state.draftUpdatedAt
  })
}

export async function updateSiteBlocks(admin: SupabaseClient, input: { page: string; blocks: unknown; expectedUpdatedAt?: string | null }) {
  return updateSitePage(admin, input)
}

export async function updateSiteNavigationLabels(admin: SupabaseClient, input: { labels: Record<string, unknown>; expectedUpdatedAt?: string | null }) {
  const labels = input.labels
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || !Object.keys(labels).length) {
    throw new ApiError(400, 'invalid_request', 'Send at least one navigation label to update.')
  }
  for (const key of Object.keys(labels)) {
    if (!NAV_KEY.test(key) || !KNOWN_FIELDS.has(key)) {
      throw new ApiError(400, 'invalid_request', 'Only existing public header and notebook navigation label keys can be changed. Destinations stay fixed.')
    }
  }
  const state = await workingSite(admin)
  return saveSiteDraft(admin, {
    overrides: { ...state.overrides, ...labels },
    document: state.document,
    expectedUpdatedAt: input.expectedUpdatedAt ?? state.draftUpdatedAt
  })
}

export async function updateSiteDesignTokens(admin: SupabaseClient, input: { tokens: Record<string, string | null>; expectedUpdatedAt?: string | null }) {
  const tokens = input.tokens
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || !Object.keys(tokens).length) {
    throw new ApiError(400, 'invalid_request', 'Send at least one design token to update.')
  }
  const state = await workingSite(admin)
  const current = state.document ?? { schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION, pages: {} }
  const merged: Record<string, string> = { ...(current.tokens ?? {}) }
  for (const [key, value] of Object.entries(tokens)) {
    if (value === null || value === '') delete merged[key]
    else merged[key] = value
  }
  return saveSiteDraft(admin, {
    overrides: state.overrides,
    document: { schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION, pages: { ...current.pages }, tokens: Object.keys(merged).length ? merged : undefined },
    expectedUpdatedAt: input.expectedUpdatedAt ?? state.draftUpdatedAt
  })
}

export function validateSiteDocumentAndOverrides(overrides: unknown, document: unknown) {
  const checkedOverrides = validateOverrides(overrides ?? {})
  const checkedDocument = checkDocument(document)
  return {
    valid: checkedOverrides.ok && checkedDocument.ok,
    errors: {
      ...(checkedOverrides.ok ? {} : checkedOverrides.errors),
      ...(checkedDocument.ok ? {} : checkedDocument.errors)
    },
    overrides: checkedOverrides.ok ? checkedOverrides.overrides : asOverrides(overrides),
    document: checkedDocument.ok ? checkedDocument.document : null
  }
}

export async function validateSiteContent(admin: SupabaseClient, input?: { overrides?: unknown; document?: unknown }) {
  const state = await workingSite(admin)
  const overrides = input?.overrides !== undefined ? input.overrides : state.overrides
  const document = input?.document !== undefined ? input.document : state.document
  const source = input?.overrides !== undefined || input?.document !== undefined ? 'input' : (state.hasDraft ? 'draft' : 'published')
  return { ...validateSiteDocumentAndOverrides(overrides, document), source }
}

export async function previewSiteContent(admin: SupabaseClient, input?: { overrides?: unknown; document?: unknown; page?: string }) {
  const report = await validateSiteContent(admin, input)
  const page = ((SITE_PAGE_IDS as readonly string[]).includes(input?.page ?? '') ? input?.page : 'home') as SitePageId
  const css = report.valid && report.document ? compileBlocksCss(report.document.pages[page]?.blocks ?? [], report.document.tokens) : ''
  return { ...report, page, css, breakpoints: { desktop: 'base', tablet: 1024, mobile: 640 } }
}

export async function prepareSitePublish(admin: SupabaseClient) {
  const state = await workingSite(admin)
  if (!state.hasDraft) throw new ApiError(409, 'no_draft', 'There are no unpublished changes to publish.')
  const report = validateSiteDocumentAndOverrides(state.overrides, state.document)
  if (!report.valid) {
    return { ok: false as const, error: 'invalid_draft' as const, message: 'The draft no longer validates. Fix it and save again; nothing was published.', errors: report.errors }
  }
  const changed = countChanges(asOverrides(state.published?.content), report.overrides, state.published?.document, report.document)
  if (changed === 0) throw new ApiError(409, 'no_changes', 'The draft is identical to the published copy. Nothing was published.')
  return { ok: true as const, report, changed, before: state.publishedVersion }
}

/** Publishes only through site_content_commit_document. Never writes site_content_published directly. */
export async function publishSiteContent(admin: SupabaseClient, note = '') {
  const prepared = await prepareSitePublish(admin)
  if (!prepared.ok) return prepared
  const { data: newVersion, error } = await admin.rpc('site_content_commit_document', {
    p_actor: null,
    p_action: 'publish',
    p_content: prepared.report.overrides,
    p_document: prepared.report.document,
    p_schema_version: SITE_CONTENT_SCHEMA_VERSION,
    p_restored_from: null,
    p_note: note
  })
  if (error) {
    if (error.message?.includes('no_changes')) throw new ApiError(409, 'no_changes', 'The draft is identical to the published copy. Nothing was published.')
    throw new ApiError(503, 'publish_failed', 'The changes were not published. The live site is unchanged; try again.')
  }
  return { ok: true as const, version: typeof newVersion === 'number' ? newVersion : Number(newVersion), before: prepared.before, changed: prepared.changed }
}

export async function listSiteContentVersions(admin: SupabaseClient, input?: { page?: number; pageSize?: number }) {
  const page = input?.page ?? 1
  const pageSize = Math.min(input?.pageSize ?? VERSION_LIST_LIMIT, 100)
  const { data, error, count } = await admin.from('site_content_versions')
    .select('version, action, restored_from, note, created_at, schema_version', { count: 'exact' })
    .order('version', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw new ApiError(503, 'content_unavailable', 'The version history could not be read.')
  return {
    versions: (data ?? []).map(row => ({
      version: row.version,
      action: row.action,
      restoredFrom: row.restored_from ?? null,
      note: typeof row.note === 'string' ? row.note : null,
      createdAt: row.created_at,
      schemaVersion: row.schema_version
    })),
    total: count ?? (data ?? []).length,
    page,
    pageSize
  }
}

export async function prepareSiteRestore(admin: SupabaseClient, version: number) {
  const { data: source, error } = await admin.from('site_content_versions').select('version, content, document').eq('version', version).maybeSingle()
  if (error) throw new ApiError(503, 'content_unavailable', 'The version could not be read. Nothing was changed.')
  if (!source) throw new ApiError(404, 'version_not_found', 'That version does not exist.')
  const report = validateSiteDocumentAndOverrides((source as Row).content, (source as Row).document)
  if (!report.valid) {
    return { ok: false as const, error: 'invalid_document' as const, message: 'That version no longer validates against the current editor, so it cannot be restored. Nothing was changed.', errors: report.errors }
  }
  const published = await readPublished(admin)
  const changed = countChanges(asOverrides(published?.content), report.overrides, published?.document, report.document)
  if (changed === 0 && (published?.version ?? 0) !== 0) throw new ApiError(409, 'no_changes', 'The live site already shows this version. Nothing was changed.')
  return { ok: true as const, report, changed, before: typeof published?.version === 'number' ? published.version : 0, restored: version }
}

/** Restores only through site_content_commit_document. Never writes site_content_published directly. */
export async function restoreSiteContentVersion(admin: SupabaseClient, version: number, note = '') {
  const prepared = await prepareSiteRestore(admin, version)
  if (!prepared.ok) return prepared
  const { data: newVersion, error } = await admin.rpc('site_content_commit_document', {
    p_actor: null,
    p_action: 'restore',
    p_content: prepared.report.overrides,
    p_document: prepared.report.document,
    p_schema_version: SITE_CONTENT_SCHEMA_VERSION,
    p_restored_from: version,
    p_note: note
  })
  if (error) {
    if (error.message?.includes('no_changes')) throw new ApiError(409, 'no_changes', 'The live site already shows this version. Nothing was changed.')
    throw new ApiError(503, 'restore_failed', 'The version was not restored. The live site is unchanged; try again.')
  }
  return { ok: true as const, version: typeof newVersion === 'number' ? newVersion : Number(newVersion), restored: version, before: prepared.before, changed: prepared.changed }
}

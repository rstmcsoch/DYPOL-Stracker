import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { COMPONENT_MAP, STUDENT_LAYOUT_SCHEMA_VERSION } from '../../../src/lib/student-layout/registry.js'
import { changedAreas } from '../../../src/lib/student-layout/diff.js'
import { checkStudentLayout, layoutProblemsToErrors, type ComponentConfig, type StudentLayoutDocument } from '../../../src/lib/student-layout/validate.js'
import { compileStudentLayoutCss as compileCss } from '../../../src/lib/student-layout/compile-css.js'

const VERSION_LIST_LIMIT = 20
const EMPTY: StudentLayoutDocument = { schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
type Row = Record<string, unknown>

export type LayoutWriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: 'invalid_layout' | 'data_locked'; message: string; errors: Record<string, string> }

export function checkLayoutForWrite(raw: unknown): { ok: true; document: StudentLayoutDocument } | { ok: false; errors: Record<string, string>; dataLocked: boolean } {
  const { document, problems } = checkStudentLayout(raw ?? {})
  if (problems.length || !document) {
    return {
      ok: false,
      errors: layoutProblemsToErrors(problems.length ? problems : [{ path: 'layout', code: 'invalid', message: 'The layout is not valid.' }]),
      dataLocked: problems.some(item => item.code === 'data_locked')
    }
  }
  return { ok: true, document }
}

function asLayout(value: unknown): StudentLayoutDocument | null {
  return value && typeof value === 'object' ? value as StudentLayoutDocument : null
}

async function readDraft(admin: SupabaseClient): Promise<Row | null> {
  const { data, error } = await admin.from('student_layout_draft').select('document, schema_version, updated_at, updated_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'layout_unavailable', 'The draft could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

async function readPublished(admin: SupabaseClient): Promise<Row | null> {
  const { data, error } = await admin.from('student_layout_published').select('document, schema_version, version, published_at, published_by').eq('id', 1).maybeSingle()
  if (error) throw new ApiError(503, 'layout_unavailable', 'The published layout could not be read. Nothing was changed.')
  return (data as Row | null) ?? null
}

export async function workingLayout(admin: SupabaseClient) {
  const [draft, published] = await Promise.all([readDraft(admin), readPublished(admin)])
  return {
    draft,
    published,
    hasDraft: Boolean(draft),
    document: asLayout(draft ? draft.document : published?.document) ?? EMPTY,
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

export async function saveLayoutDraft(admin: SupabaseClient, document: unknown, expectedUpdatedAt?: string | null): Promise<LayoutWriteResult> {
  const checked = checkLayoutForWrite(document)
  if (!checked.ok) {
    return {
      ok: false,
      error: checked.dataLocked ? 'data_locked' : 'invalid_layout',
      message: checked.dataLocked
        ? 'Live student data (dates, marks, scores, names, streaks, counts…) cannot be set in the layout. Nothing was saved.'
        : 'Some parts of the layout need attention. Nothing was saved.',
      errors: checked.errors
    }
  }
  const current = await readDraft(admin)
  assertRevision((current?.updated_at as string | undefined) ?? null, expectedUpdatedAt)
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from('student_layout_draft').upsert({
    id: 1,
    document: checked.document,
    schema_version: STUDENT_LAYOUT_SCHEMA_VERSION,
    updated_at: updatedAt,
    updated_by: null
  }, { onConflict: 'id' })
  if (error) throw new ApiError(503, 'layout_unavailable', 'The draft could not be saved. Nothing was changed; try again.')
  return { ok: true, updatedAt }
}

export async function getStudentDashboardLayout(admin: SupabaseClient) {
  const published = await readPublished(admin)
  return {
    schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION,
    version: typeof published?.version === 'number' ? published.version : 0,
    document: published?.document ?? null,
    publishedAt: (published?.published_at as string | undefined) ?? null
  }
}

export async function getStudentDashboardLayoutDraft(admin: SupabaseClient) {
  const state = await workingLayout(admin)
  return { exists: state.hasDraft, document: state.document, updatedAt: state.draftUpdatedAt, basedOnPublished: !state.hasDraft, schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION }
}

export async function updateStudentDashboardLayout(admin: SupabaseClient, input: { document: unknown; expectedUpdatedAt?: string | null }) {
  return saveLayoutDraft(admin, input.document, input.expectedUpdatedAt)
}

export async function updateStudentDashboardComponent(admin: SupabaseClient, input: { id: string; hidden?: boolean; locked?: boolean; text?: Record<string, string>; props?: Record<string, unknown>; style?: Record<string, string>; responsive?: { tablet?: Record<string, string>; mobile?: Record<string, string> }; expectedUpdatedAt?: string | null }) {
  const def = COMPONENT_MAP.get(input.id)
  if (!def) throw new ApiError(400, 'unknown_component', 'That is not a registered student component.')
  const state = await workingLayout(admin)
  const existing: ComponentConfig = { ...(state.document.components?.[input.id] ?? {}) }
  const next: ComponentConfig = { ...existing }
  if (input.hidden !== undefined) next.hidden = input.hidden
  if (input.locked !== undefined) next.locked = input.locked
  if (input.text !== undefined) next.text = { ...(existing.text ?? {}), ...input.text }
  if (input.props !== undefined) next.props = { ...(existing.props ?? {}), ...(input.props as Record<string, string | number>) }
  if (input.style !== undefined) next.style = { ...(existing.style ?? {}), ...input.style }
  if (input.responsive !== undefined) next.responsive = { ...(existing.responsive ?? {}), ...input.responsive }
  const document: StudentLayoutDocument = {
    ...state.document,
    schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION,
    components: { ...(state.document.components ?? {}), [input.id]: next }
  }
  return saveLayoutDraft(admin, document, input.expectedUpdatedAt ?? state.draftUpdatedAt)
}

export async function reorderStudentDashboardComponents(admin: SupabaseClient, input: { containerId: string; order: string[]; expectedUpdatedAt?: string | null }) {
  if (!COMPONENT_MAP.get(input.containerId)) throw new ApiError(400, 'unknown_component', 'That is not a registered student component.')
  if (!Array.isArray(input.order) || !input.order.length) throw new ApiError(400, 'invalid_request', 'Send the container’s parts in their new order.')
  const state = await workingLayout(admin)
  const document: StudentLayoutDocument = {
    ...state.document,
    schemaVersion: STUDENT_LAYOUT_SCHEMA_VERSION,
    order: { ...(state.document.order ?? {}), [input.containerId]: input.order }
  }
  return saveLayoutDraft(admin, document, input.expectedUpdatedAt ?? state.draftUpdatedAt)
}

export async function validateStudentDashboardLayout(admin: SupabaseClient, input?: { document?: unknown }) {
  const state = await workingLayout(admin)
  const raw = input?.document !== undefined ? input.document : state.document
  const checked = checkLayoutForWrite(raw)
  return {
    valid: checked.ok,
    errors: checked.ok ? {} : checked.errors,
    dataLocked: checked.ok ? false : checked.dataLocked,
    document: checked.ok ? checked.document : null,
    source: input?.document !== undefined ? 'input' : (state.hasDraft ? 'draft' : 'published')
  }
}

export async function previewStudentDashboardLayout(admin: SupabaseClient, input?: { document?: unknown }) {
  const report = await validateStudentDashboardLayout(admin, input)
  return { ...report, css: report.valid && report.document ? compileCss(report.document) : '', breakpoints: { desktop: 'base', tablet: 1024, mobile: 640 } }
}

export async function prepareLayoutPublish(admin: SupabaseClient) {
  const state = await workingLayout(admin)
  if (!state.hasDraft) throw new ApiError(409, 'no_draft', 'There are no unpublished layout changes.')
  const checked = checkLayoutForWrite(state.document)
  if (!checked.ok) {
    return { ok: false as const, error: (checked.dataLocked ? 'data_locked' : 'invalid_layout') as 'data_locked' | 'invalid_layout', message: 'The draft no longer validates. Fix it and save again; nothing was published.', errors: checked.errors }
  }
  const areas = changedAreas(asLayout(state.published?.document), checked.document)
  if (state.published && areas.length === 0) throw new ApiError(409, 'no_changes', 'The draft matches the published layout. Nothing was published.')
  return { ok: true as const, document: checked.document, areas, before: state.publishedVersion }
}

/** Publishes only through student_layout_commit. Never writes student_layout_published directly. */
export async function publishStudentDashboardLayout(admin: SupabaseClient, note = '') {
  const prepared = await prepareLayoutPublish(admin)
  if (!prepared.ok) return prepared
  const { data: newVersion, error } = await admin.rpc('student_layout_commit', {
    p_actor: null,
    p_action: 'publish',
    p_document: prepared.document,
    p_schema_version: STUDENT_LAYOUT_SCHEMA_VERSION,
    p_restored_from: null,
    p_note: note
  })
  if (error) {
    if (error.message?.includes('no_changes')) throw new ApiError(409, 'no_changes', 'Student workspaces already show this layout. Nothing was changed.')
    throw new ApiError(503, 'publish_failed', 'The layout was not published. Student workspaces are unchanged; try again.')
  }
  return { ok: true as const, version: typeof newVersion === 'number' ? newVersion : Number(newVersion), before: prepared.before, areas: prepared.areas }
}

export async function listStudentLayoutVersions(admin: SupabaseClient, input?: { page?: number; pageSize?: number }) {
  const page = input?.page ?? 1
  const pageSize = Math.min(input?.pageSize ?? VERSION_LIST_LIMIT, 100)
  const { data, error, count } = await admin.from('student_layout_versions')
    .select('version, action, restored_from, note, created_at, schema_version', { count: 'exact' })
    .order('version', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw new ApiError(503, 'layout_unavailable', 'The version history could not be read.')
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

export async function prepareLayoutRestore(admin: SupabaseClient, version: number) {
  const { data: source, error } = await admin.from('student_layout_versions').select('version, document').eq('version', version).maybeSingle()
  if (error) throw new ApiError(503, 'layout_unavailable', 'The version could not be read. Nothing was changed.')
  if (!source) throw new ApiError(404, 'version_not_found', 'That version does not exist.')
  const checked = checkLayoutForWrite((source as Row).document)
  if (!checked.ok) {
    return { ok: false as const, error: 'invalid_layout' as const, message: 'That version no longer validates against the current editor, so it cannot be restored. Nothing was changed.', errors: checked.errors }
  }
  const published = await readPublished(admin)
  const areas = changedAreas(asLayout(published?.document), checked.document)
  return { ok: true as const, document: checked.document, areas, before: typeof published?.version === 'number' ? published.version : 0, restored: version }
}

/** Restores only through student_layout_commit. Never writes student_layout_published directly. */
export async function restoreStudentDashboardLayoutVersion(admin: SupabaseClient, version: number, note = '') {
  const prepared = await prepareLayoutRestore(admin, version)
  if (!prepared.ok) return prepared
  const { data: newVersion, error } = await admin.rpc('student_layout_commit', {
    p_actor: null,
    p_action: 'restore',
    p_document: prepared.document,
    p_schema_version: STUDENT_LAYOUT_SCHEMA_VERSION,
    p_restored_from: version,
    p_note: note
  })
  if (error) {
    if (error.message?.includes('no_changes')) throw new ApiError(409, 'no_changes', 'Student workspaces already show this layout. Nothing was changed.')
    throw new ApiError(503, 'restore_failed', 'The layout was not restored. Student workspaces are unchanged; try again.')
  }
  return { ok: true as const, version: typeof newVersion === 'number' ? newVersion : Number(newVersion), restored: version, before: prepared.before, areas: prepared.areas }
}

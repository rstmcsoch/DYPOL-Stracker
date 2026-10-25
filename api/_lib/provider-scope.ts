import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from './http.js'
import { withAuthenticatedRequest } from './handler.js'
import { controlHandler, recordAuditEvent } from './control.js'

/**
 * Whose AI providers a request manages. Students manage their own rows in ai_provider_configs.
 * The owner manages Stracker AI (Default) rows in site_ai_providers through the same handlers,
 * reached with `?scope=site` and authorized by the Control Center gate (owner role + MFA).
 */
export interface ProviderScope {
  kind: 'user' | 'site'
  /** The signed-in account: the student, or the owner editing the site default. */
  actorId: string
  admin: SupabaseClient
  table: 'ai_provider_configs' | 'site_ai_providers'
  /** Site scope only: durable Control Center audit of owner changes (never keys or endpoints). */
  audit?: (action: string, targetId: string, outcome: 'success' | 'failed', summary?: Record<string, string | number | boolean | null>) => Promise<void>
}

export const SITE_PROVIDER_TABLE = 'site_ai_providers'

export function userScope(actorId: string, admin: SupabaseClient): ProviderScope {
  return { kind: 'user', actorId, admin, table: 'ai_provider_configs' }
}

export function siteScope(actorId: string, admin: SupabaseClient): ProviderScope {
  return { kind: 'site', actorId, admin, table: SITE_PROVIDER_TABLE }
}

export function isSiteScopeRequest(req: Pick<ApiRequest, 'url'>): boolean {
  return new URL(req.url ?? '/', 'http://localhost').searchParams.get('scope') === 'site'
}

/** Restricts a query to the scope's rows: a student only ever touches rows with their user_id. */
export function scoped<Q>(scope: ProviderScope, query: Q): Q {
  return scope.kind === 'user' ? (query as unknown as { eq: (column: string, value: string) => Q }).eq('user_id', scope.actorId) : query
}

/** Ownership columns written on insert/update for the scope. */
export function scopeColumns(scope: ProviderScope): Record<string, unknown> {
  return scope.kind === 'user' ? { user_id: scope.actorId } : { updated_by: scope.actorId }
}

/** Authenticates the request for its scope, then runs the shared provider logic. */
export async function withProviderScope(req: ApiRequest, res: ApiResponse, methods: string[], run: (scope: ProviderScope) => Promise<void>): Promise<void> {
  if (isSiteScopeRequest(req)) {
    await controlHandler(req, res, methods, { requireAal2: true }, context => run({
      ...siteScope(context.userId, context.admin),
      audit: async (action, targetId, outcome, summary = {}) => {
        await recordAuditEvent(context.admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType: 'site_ai_provider', targetId, outcome, severity: outcome === 'success' ? 'notice' : 'warning', summary })
      }
    }))
    return
  }
  await withAuthenticatedRequest(req, res, methods, context => run(userScope(context.userId, context.adminClient)))
}

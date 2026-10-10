import type { ApiRequest, ApiResponse } from '../_lib/http.js'
import { ApiError, sendJson } from '../_lib/http.js'
import { controlHandler, recordAuditEvent } from '../_lib/control.js'
import { isUuid } from '../_lib/control-policy.js'

/**
 * GET /api/control/user?id=<uuid>
 * Account administration fields, aggregate study counts, and this account's audit history.
 * Study content (chapter notes, mistakes, test answers) is never returned here.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true }, async context => {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id')
    if (!isUuid(id)) throw new ApiError(400, 'invalid_user_id', 'Choose a valid account.')
    const admin = context.admin

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(id)
    if (authError || !authData?.user) throw new ApiError(404, 'user_not_found', 'That account could not be found.')
    const target = authData.user

    const [profile, role, chapters, tests, mistakes, sessions, lastTest, audit] = await Promise.all([
      admin.from('profiles').select('display_name, created_at').eq('user_id', id).maybeSingle(),
      admin.from('control_roles').select('role, revoked_at, granted_at').eq('user_id', id).maybeSingle(),
      admin.from('chapters').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('tests').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('mistakes').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('tests').select('test_date').eq('user_id', id).order('test_date', { ascending: false }).limit(1).maybeSingle(),
      admin.from('control_audit_events').select('id, created_at, action, result, actor_role, error_category, reason, before_summary, after_summary').eq('target_id', id).order('created_at', { ascending: false }).limit(25)
    ])
    const failures = [profile, role, chapters, tests, mistakes, sessions, lastTest, audit].filter(result => result.error)
    if (failures.length) throw new ApiError(503, 'user_detail_unavailable', 'Part of this account could not be loaded. Try again shortly.')

    // Viewing an account is itself a privileged read, so it is recorded.
    await recordAuditEvent(admin, {
      requestId: context.requestId,
      actorId: context.userId,
      actorRole: context.role,
      action: 'user.viewed',
      targetType: 'user',
      targetId: id,
      outcome: 'success',
      severity: 'info'
    })

    const bannedUntil = target.banned_until ?? null
    const suspended = Boolean(bannedUntil && Date.parse(bannedUntil) > Date.now())
    const provider = typeof target.app_metadata?.provider === 'string' ? target.app_metadata.provider : null
    const roleActive = Boolean(role.data && !role.data.revoked_at)

    sendJson(res, 200, {
      user: {
        id: target.id,
        email: target.email ?? '',
        displayName: profile.data?.display_name ?? '',
        createdAt: target.created_at ?? profile.data?.created_at ?? null,
        lastSignInAt: target.last_sign_in_at ?? null,
        emailConfirmedAt: target.email_confirmed_at ?? null,
        provider,
        suspended,
        bannedUntil: suspended ? bannedUntil : null,
        adminRole: roleActive ? role.data?.role ?? null : null
      },
      activity: {
        chapters: chapters.count ?? 0,
        tests: tests.count ?? 0,
        mistakes: mistakes.count ?? 0,
        studySessions: sessions.count ?? 0,
        lastTestDate: lastTest.data?.test_date ?? null
      },
      audit: ((audit.data ?? []) as Array<Record<string, unknown>>).map(row => ({
        id: row.id,
        occurred_at: row.created_at,
        action: row.action,
        outcome: row.result === 'error' ? 'failed' : row.result,
        severity: row.result === 'error' ? 'warning' : row.result === 'denied' ? 'notice' : 'info',
        actor_role: row.actor_role,
        error_code: row.error_category,
        reason: row.reason,
        summary: { ...((row.before_summary ?? {}) as Record<string, unknown>), ...((row.after_summary ?? {}) as Record<string, unknown>) }
      }))
    })
  })
}

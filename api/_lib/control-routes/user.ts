import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent } from '../control.js'
import { isUuid } from '../control-policy.js'
import { isControlRole, sanctionRefusal } from '../../../src/lib/control-permissions.js'

/**
 * GET /api/control/user?id=<uuid>
 * Account administration fields, aggregate study counts, and this account's audit history.
 * Study content (chapter notes, mistakes, test answers) is never returned here.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET'], { requireAal2: true, permission: 'users.view' }, async context => {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id')
    if (!isUuid(id)) throw new ApiError(400, 'invalid_user_id', 'Choose a valid account.')
    const admin = context.admin

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(id)
    if (authError || !authData?.user) throw new ApiError(404, 'user_not_found', 'That account could not be found.')
    const target = authData.user

    const [profile, role, chapters, tests, mistakes, sessions, lastTest, audit, ban, sanctions] = await Promise.all([
      admin.from('profiles').select('display_name, created_at').eq('user_id', id).maybeSingle(),
      admin.from('control_roles').select('role, revoked_at, granted_at').eq('user_id', id).maybeSingle(),
      admin.from('chapters').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('tests').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('mistakes').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id),
      admin.from('tests').select('test_date').eq('user_id', id).order('test_date', { ascending: false }).limit(1).maybeSingle(),
      admin.from('control_audit_events').select('id, created_at, action, result, actor_role, error_category, reason, before_summary, after_summary').eq('target_id', id).order('created_at', { ascending: false }).limit(25),
      admin.from('account_bans').select('banned_until, reason, created_at').eq('user_id', id).maybeSingle(),
      admin.from('account_sanctions').select('id, kind, reason, banned_until, permanent, created_by_role, created_at, acknowledged_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50)
    ])
    const failures = [profile, role, chapters, tests, mistakes, sessions, lastTest, audit, ban, sanctions].filter(result => result.error)
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
    const targetRole = roleActive && isControlRole(role.data?.role) ? role.data.role : null
    const banData = ban.data as { banned_until: string | null; reason: string; created_at: string } | null
    const banActive = Boolean(banData && (banData.banned_until === null || Date.parse(banData.banned_until) > Date.now()))
    // What the signed-in operator may do here (the action route re-checks all of this).
    const allowedOnTarget = sanctionRefusal({ id: context.userId, role: context.role }, { id, role: targetRole }) === null

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
      ban: banActive && banData ? { until: banData.banned_until, permanent: banData.banned_until === null, reason: banData.reason, since: banData.created_at } : null,
      sanctions: ((sanctions.data ?? []) as Array<Record<string, unknown>>).map(row => ({
        id: row.id,
        kind: row.kind,
        reason: row.reason ?? null,
        until: row.banned_until ?? null,
        permanent: row.permanent === true,
        byRole: row.created_by_role ?? null,
        createdAt: row.created_at,
        seenAt: row.acknowledged_at ?? null
      })),
      can: {
        warn: allowedOnTarget && context.permissions.has('users.warn'),
        ban: allowedOnTarget && context.permissions.has('users.ban'),
        delete: allowedOnTarget && context.permissions.has('users.delete')
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

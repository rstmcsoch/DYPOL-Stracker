/**
 * Catalogue of Control Center audit actions. Shared by the Vercel functions (which write
 * these names) and the console UI (which offers them as filters and renders them as plain
 * language). Pure data and formatting only: no network, no secrets.
 *
 * Durable audit log vs. application logs
 *   - The audit log (public.control_audit_events) records security-relevant console events:
 *     access grants and denials, privileged account changes, exports, and refused privileged
 *     actions. Each row stores who (actor id when known), what (action), the target when
 *     relevant, the result, and a server timestamp. Never credentials, codes or payloads.
 *   - Validation failures of audit filters, rate-limit decisions and operational errors go to
 *     the structured server log (diagnostics.ts) so a bad request cannot create audit noise or
 *     a recursive audit failure.
 *   - Authenticator (TOTP) code checks happen inside Supabase Auth; their pass/fail detail is
 *     in Supabase's own auth logs. The console records the consequence (access granted at
 *     aal2, or a request denied for lack of aal2 / a fresh verification).
 */

export type AuditOutcome = 'success' | 'denied' | 'failed'

export interface AuditActionDefinition {
  action: string
  /** Short noun phrase for menus. */
  label: string
  /** Where it is used in the console. */
  group: 'Access' | 'Accounts' | 'Audit log' | 'Roles'
  /** Plain-language sentence per outcome; `{target}` is replaced with the target label. */
  sentence: Record<AuditOutcome, string>
}

export const AUDIT_ACTIONS: readonly AuditActionDefinition[] = [
  {
    action: 'control.access',
    label: 'Console access',
    group: 'Access',
    sentence: { success: 'Opened the Control Center', denied: 'Console access refused', failed: 'Console access check failed' }
  },
  {
    action: 'user.viewed',
    label: 'Account viewed',
    group: 'Accounts',
    sentence: { success: 'Viewed account {target}', denied: 'Account view refused for {target}', failed: 'Account view failed for {target}' }
  },
  {
    action: 'user.suspend',
    label: 'Sign-in suspended',
    group: 'Accounts',
    sentence: { success: 'Suspended sign-in for {target}', denied: 'Suspension refused for {target}', failed: 'Suspension failed for {target}' }
  },
  {
    action: 'user.restore',
    label: 'Sign-in restored',
    group: 'Accounts',
    sentence: { success: 'Restored sign-in for {target}', denied: 'Restore refused for {target}', failed: 'Restore failed for {target}' }
  },
  {
    action: 'audit.export',
    label: 'Audit log exported',
    group: 'Audit log',
    sentence: { success: 'Exported the audit log', denied: 'Audit export refused', failed: 'Audit export failed' }
  },
  {
    action: 'owner.provisioned',
    label: 'Owner role provisioned',
    group: 'Roles',
    sentence: { success: 'Owner role provisioned for {target}', denied: 'Owner provisioning refused for {target}', failed: 'Owner provisioning failed for {target}' }
  }
] as const

export const AUDIT_ACTION_NAMES: readonly string[] = AUDIT_ACTIONS.map(entry => entry.action)

/** Server-side error codes and what they mean to an operator. */
export const AUDIT_ERROR_LABELS: Record<string, string> = {
  not_owner: 'account has no console role',
  mfa_required: 'session had no two-step verification',
  recent_mfa_required: 'a fresh authenticator code was required',
  rate_limited: 'request limit reached',
  owner_protected: 'administrator accounts cannot be suspended here',
  self_action_blocked: 'the acting account cannot change itself',
  auth_update_failed: 'the authentication service rejected the change',
  audit_unavailable: 'the audit log was unavailable',
  invalid_filter: 'a filter was not valid'
}

export function auditActionDefinition(action: string): AuditActionDefinition | undefined {
  return AUDIT_ACTIONS.find(entry => entry.action === action)
}

/** "user.viewed" → "User viewed" for actions outside the catalogue (for example legacy rows). */
export function humanizeAction(action: string): string {
  const words = action.replace(/[._]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Event'
}

export interface AuditEventLike {
  action: string
  outcome: AuditOutcome
  actor_id?: string | null
  actor_role?: string | null
  target_type?: string | null
  target_id?: string | null
  error_code?: string | null
  reason?: string | null
  summary?: Record<string, unknown> | null
}

export interface AuditDescription {
  /** What happened, in one sentence. */
  title: string
  /** Who did it: "You", a shortened id, a role, or "System". */
  actor: string
  /** Extra context (error meaning, operator reason, export size). */
  detail: string | null
}

export function shortIdentifier(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

/**
 * Plain-language rendering of an audit row. Identifiers are shortened so a list never shows
 * a full account id; the full id remains available on the account page it links to.
 */
export function describeAuditEvent(event: AuditEventLike, options: { selfId?: string | null } = {}): AuditDescription {
  const definition = auditActionDefinition(event.action)
  const targetLabel = event.target_id
    ? (event.target_type === 'user' || !event.target_type ? `account ${shortIdentifier(event.target_id)}` : `${event.target_type} ${shortIdentifier(event.target_id)}`)
    : 'an unknown target'
  const template = definition?.sentence[event.outcome] ?? `${humanizeAction(event.action)}${event.outcome === 'success' ? '' : ` (${event.outcome})`}`
  const title = template.replace('{target}', targetLabel)

  const actor = event.actor_id
    ? (options.selfId && event.actor_id === options.selfId ? 'You' : shortIdentifier(event.actor_id))
    : event.actor_role ? capitalize(event.actor_role) : 'System'

  const details: string[] = []
  if (event.error_code) details.push(AUDIT_ERROR_LABELS[event.error_code] ?? event.error_code)
  if (event.reason) details.push(`Reason: ${event.reason}`)
  if (event.action === 'audit.export' && event.summary && typeof event.summary.rows === 'number') {
    details.push(`${event.summary.rows.toLocaleString()} row${event.summary.rows === 1 ? '' : 's'}${event.summary.filtered ? ', filtered' : ''}`)
  }
  return { title, actor, detail: details.length ? details.join(' · ') : null }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

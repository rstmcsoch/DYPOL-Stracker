import type { SupabaseClient } from '@supabase/supabase-js'
import { logAIEvent } from '../diagnostics.js'
import { cleanText, isUuid, sanitizeAuditSummary, type AuditSummaryValue } from '../control-policy.js'
import type { MasterAuditEvent } from './types.js'

export interface AuditSink {
  write(event: MasterAuditEvent): Promise<boolean>
}

const EXTRA_BLOCKED = /note|notes|mark|marks|payload|body|content|message_body|question|solution/i

function sanitizeMasterSummary(input: Record<string, unknown> | undefined): Record<string, AuditSummaryValue> | null {
  if (!input) return null
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (EXTRA_BLOCKED.test(key)) continue
    filtered[key] = value
  }
  const sanitized = sanitizeAuditSummary(filtered)
  return Object.keys(sanitized).length ? sanitized : null
}

export function sanitizeMasterAuditEvent(event: MasterAuditEvent): MasterAuditEvent {
  return {
    requestId: cleanText(event.requestId, 80),
    credentialId: event.credentialId && isUuid(event.credentialId) ? event.credentialId : null,
    credentialLabel: event.credentialLabel ? cleanText(event.credentialLabel, 80) : null,
    toolName: event.toolName ? cleanText(event.toolName, 80) : null,
    action: cleanText(event.action, 80) || 'master.unknown',
    targetType: event.targetType ? cleanText(event.targetType, 40) : undefined,
    targetId: event.targetId ? cleanText(event.targetId, 120) : undefined,
    targetStudentId: event.targetStudentId && isUuid(event.targetStudentId) ? event.targetStudentId : undefined,
    result: event.result,
    errorCategory: event.errorCategory ? cleanText(event.errorCategory, 60) : undefined,
    reason: event.reason ? cleanText(event.reason, 500) : undefined,
    changedFields: event.changedFields
      ?.map(field => cleanText(field, 40))
      .filter(Boolean)
      .slice(0, 30),
    beforeSummary: event.beforeSummary ? sanitizeMasterSummary(event.beforeSummary) ?? undefined : undefined,
    afterSummary: event.afterSummary ? sanitizeMasterSummary(event.afterSummary) ?? undefined : undefined,
    relatedVersion: event.relatedVersion ? cleanText(event.relatedVersion, 80) : undefined,
    relatedTaskId: event.relatedTaskId ? cleanText(event.relatedTaskId, 80) : undefined
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly events: MasterAuditEvent[] = []

  async write(event: MasterAuditEvent): Promise<boolean> {
    this.events.push(sanitizeMasterAuditEvent(event))
    return true
  }
}

export class SupabaseAuditSink implements AuditSink {
  constructor(private readonly admin: SupabaseClient) {}

  async write(event: MasterAuditEvent): Promise<boolean> {
    const safe = sanitizeMasterAuditEvent(event)
    const { error } = await this.admin.from('master_mcp_audit_events').insert({
      request_id: safe.requestId || null,
      credential_id: safe.credentialId,
      credential_label: safe.credentialLabel,
      tool_name: safe.toolName,
      action: safe.action,
      target_type: safe.targetType ?? null,
      target_id: safe.targetId ?? null,
      target_student_id: safe.targetStudentId ?? null,
      result: safe.result,
      error_category: safe.errorCategory ?? null,
      reason: safe.reason ?? null,
      changed_fields: safe.changedFields && safe.changedFields.length ? safe.changedFields : null,
      before_summary: safe.beforeSummary ?? null,
      after_summary: safe.afterSummary ?? null,
      related_version: safe.relatedVersion ?? null,
      related_task_id: safe.relatedTaskId ?? null
    })
    if (error) {
      logAIEvent('error', 'master_mcp_audit_write_failed', { action: safe.action, code: error.code ?? '' })
      return false
    }
    return true
  }
}

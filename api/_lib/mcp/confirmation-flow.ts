import type { MasterActor } from './types.js'
import {
  issueConfirmation,
  consumeConfirmation,
  type ConfirmationStore
} from './confirmations.js'
import { ApiError } from '../http.js'

export interface ConfirmationPreview {
  needsConfirmation: true
  confirmationToken: string
  expiresAt: string
  operation: string
  targetType: string
  targetId: string
  targetStudentId?: string
  existing?: unknown
  proposed?: unknown
  effects: string[]
  relatedRecords?: Record<string, number>
  irreversible: boolean
  validation: string
}

export async function previewOrConfirm(
  store: ConfirmationStore | undefined,
  actor: MasterActor,
  toolName: string,
  operationArgs: Record<string, unknown>,
  target: { type: string; id: string; studentId?: string; version?: string },
  confirmationToken: unknown,
  buildPreview: () => Promise<Omit<ConfirmationPreview, 'needsConfirmation' | 'confirmationToken' | 'expiresAt'>>
): Promise<ConfirmationPreview | null> {
  if (!store) throw new ApiError(503, 'master_mcp_unavailable', 'Confirmations are not available in this deployment yet.')
  const request = {
    credentialId: actor.credentialId,
    toolName,
    targetType: target.type,
    targetId: target.id,
    targetStudentId: target.studentId,
    resourceVersion: target.version,
    arguments: operationArgs
  }
  const token = typeof confirmationToken === 'string' && confirmationToken ? confirmationToken : null
  if (!token) {
    const issued = issueConfirmation(request)
    await store.insert(issued.record)
    const preview = await buildPreview()
    return {
      needsConfirmation: true,
      confirmationToken: issued.token,
      expiresAt: issued.record.expiresAt,
      ...preview
    }
  }
  await consumeConfirmation(store, token, request)
  return null
}

export function withoutConfirmationToken(args: Record<string, unknown>): Record<string, unknown> {
  const { confirmationToken: _ignored, ...rest } = args
  void _ignored
  return rest
}

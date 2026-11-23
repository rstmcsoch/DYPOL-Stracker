import { z } from 'zod'
import type { MasterActor } from '../types.js'
import { masterCapabilityOverview } from '../capabilities.js'
import { MASTER_ACTOR_TYPE } from '../types.js'

export const getMasterPermissionsInput = z.object({}).strict()

export const GET_MASTER_PERMISSIONS_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false
} as const

export const GET_MASTER_PERMISSIONS_DESCRIPTION =
  'Show the Master MCP principal, the tools that are actually implemented, the operational capabilities that are authorized, and the actions that are permanently refused (roles, owner controls, security, user-account deletion, infrastructure and secrets).'

export function getMasterPermissions(actor: MasterActor, implementedTools: readonly string[]) {
  return {
    actor: {
      type: actor.actorType,
      isOwner: false,
      connectionId: actor.connectionId,
      credentialLabel: actor.credentialLabel,
      authenticationMethod: actor.authenticationMethod
    },
    ...masterCapabilityOverview(implementedTools),
    notes: [
      `This principal is ${MASTER_ACTOR_TYPE} and is not the Owner.`,
      'tools/list only advertises implemented tools.',
      'Forbidden tools are refused even if they are called by an alternate name.'
    ]
  }
}

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import type { ConfirmationStore } from '../confirmations.js'
import { previewOrConfirm, withoutConfirmationToken } from '../confirmation-flow.js'
import * as settings from '../../services/operational-settings.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const empty = z.object({}).strict()
const confirmation = z.string().min(1).optional()

export function operationalSettingsTools(admin: SupabaseClient, confirmations?: ConfirmationStore) {
  return [
    tool(
      'get_operational_settings',
      'Read permitted operational settings: maintenance notice, maintenance message and site-down state. Sign-up, sign-in, domain rules, authentication and security settings are not returned.',
      jsonSchema({}, []),
      args => empty.parse(args ?? {}) as Record<string, unknown>,
      async () => settings.getOperationalSettings(admin)
    ),
    tool(
      'update_operational_settings',
      'Update the maintenance notice flag and/or message. Use set_maintenance_mode to take the site down. Sign-up, sign-in, domain, authentication and security settings are rejected.',
      jsonSchema({ maintenanceEnabled: { type: 'boolean' }, maintenanceMessage: { type: 'string' } }, []),
      args => (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
      async (_actor, args) => settings.updateOperationalSettings(admin, args)
    ),
    tool(
      'set_maintenance_mode',
      'Turn the public site down or bring it back up. Always returns an impact preview and requires confirmation before the change is applied. Does not change sign-up or sign-in switches.',
      jsonSchema({
        siteDown: { type: 'boolean' },
        maintenanceEnabled: { type: 'boolean' },
        maintenanceMessage: { type: 'string' },
        confirmationToken: { type: 'string' }
      }, ['siteDown']),
      args => z.object({
        siteDown: z.boolean(),
        maintenanceEnabled: z.boolean().optional(),
        maintenanceMessage: z.string().max(500).optional(),
        confirmationToken: confirmation
      }).passthrough().parse(args ?? {}) as Record<string, unknown>,
      async (actor, args) => {
        const current = await settings.readOperationalSettings(admin)
        const siteDown = args.siteDown === true
        const effects = settings.maintenanceImpact(current, siteDown, typeof args.maintenanceEnabled === 'boolean' ? args.maintenanceEnabled : undefined)
        const preview = await previewOrConfirm(confirmations, actor, 'set_maintenance_mode', withoutConfirmationToken(args), { type: 'site_settings', id: 'site', version: current.updatedAt ?? undefined }, args.confirmationToken, async () => ({
          operation: 'set_maintenance_mode',
          targetType: 'site_settings',
          targetId: 'site',
          existing: { status: current.status, siteDown: current.siteDown, maintenanceEnabled: current.maintenanceEnabled, maintenanceMessage: current.maintenanceMessage },
          proposed: { siteDown, maintenanceEnabled: args.maintenanceEnabled ?? current.maintenanceEnabled, maintenanceMessage: args.maintenanceMessage ?? current.maintenanceMessage },
          effects,
          relatedRecords: { publicSite: 1 },
          irreversible: false,
          validation: 'Confirmation applies only this site-down change. Sign-up and sign-in switches are not modified.'
        }))
        if (preview) return preview
        return settings.setMaintenanceMode(admin, {
          siteDown,
          maintenanceEnabled: typeof args.maintenanceEnabled === 'boolean' ? args.maintenanceEnabled : undefined,
          maintenanceMessage: typeof args.maintenanceMessage === 'string' ? args.maintenanceMessage : undefined
        })
      }
    ),
    tool(
      'update_maintenance_message',
      'Update only the public maintenance message (up to 500 characters). This does not take the site down by itself.',
      jsonSchema({ message: { type: 'string' } }, ['message']),
      args => (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
      async (_actor, args) => settings.updateMaintenanceMessage(admin, args)
    ),
    tool(
      'get_operational_status',
      'Read whether the public site is live, showing a maintenance notice, or down, plus the current message. Sign-up and sign-in switches are not included.',
      jsonSchema({}, []),
      args => empty.parse(args ?? {}) as Record<string, unknown>,
      async () => settings.getOperationalStatus(admin)
    )
  ]
}

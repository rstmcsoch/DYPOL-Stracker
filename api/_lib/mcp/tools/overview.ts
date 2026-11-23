import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../../http.js'
import { isValidTimeZone, parseTimeZone } from '../../../../src/lib/time-window.js'
import { loadAccountOverview, loadDailyActivity, loadPlatformOverview } from '../../services/platform-overview.js'
import { loadSiteHealth } from '../../services/site-health.js'
import { listAuditEvents } from '../../services/audit-read.js'
import { loadRecentErrors } from '../../services/recent-errors.js'

const rangeInput = z.object({
  range: z.enum(['today', '7d', '30d']).optional(),
  timeZone: z.string().max(64).optional()
}).strict()

function zoneOf(timeZone: string | undefined): string {
  if (timeZone === undefined || timeZone === '') return parseTimeZone(null)
  if (!isValidTimeZone(timeZone)) throw new ApiError(400, 'invalid_filter', 'Use a valid IANA time zone such as Asia/Calcutta.')
  return timeZone
}

export const getMasterOverviewInput = rangeInput
export const GET_MASTER_OVERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    range: { type: 'string', enum: ['today', '7d', '30d'], description: 'Reporting window. Defaults to 7d.' },
    timeZone: { type: 'string', description: 'IANA time zone used for calendar days. Defaults to UTC.' }
  },
  additionalProperties: false
} as const
export const GET_MASTER_OVERVIEW_DESCRIPTION = 'Operational snapshot of Stracker accounts, recent activity and database reachability for a reporting window. Metrics come from the live backend; nothing is fabricated.'

export const getSiteHealthInput = z.object({}).strict()
export const GET_SITE_HEALTH_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const
export const GET_SITE_HEALTH_DESCRIPTION = 'Run the same bounded, read-only health probes as the Control Centre: database connectivity, server configuration (variable names only), Supabase Auth, and email-delivery status when known.'

export const getAccountOverviewInput = rangeInput
export const GET_ACCOUNT_OVERVIEW_SCHEMA = GET_MASTER_OVERVIEW_SCHEMA
export const GET_ACCOUNT_OVERVIEW_DESCRIPTION = 'Account-level totals for the selected window: registrations, verification, pending confirmations, active and suspended accounts, and tracker adoption. No per-account security fields are included.'

export const getDailyActivityInput = rangeInput
export const GET_DAILY_ACTIVITY_SCHEMA = GET_MASTER_OVERVIEW_SCHEMA
export const GET_DAILY_ACTIVITY_DESCRIPTION = 'Daily registrations, verified sign-ups and test-journal rows for a reporting window and time zone.'

export const getRecentErrorsInput = z.object({
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  status: z.enum(['open', 'resolved', 'ignored']).optional()
}).strict()
export const GET_RECENT_ERRORS_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10000 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    status: { type: 'string', enum: ['open', 'resolved', 'ignored'] }
  },
  additionalProperties: false
} as const
export const GET_RECENT_ERRORS_DESCRIPTION = 'Recent grouped application errors from analytics. Messages are already length-bounded; student notes and request payloads are not included.'

export const getAuditEventsInput = z.object({
  source: z.enum(['control', 'master_mcp', 'all']).optional(),
  outcome: z.enum(['success', 'denied', 'failed']).optional(),
  action: z.string().max(80).optional(),
  target: z.string().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timeZone: z.string().max(64).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional()
}).strict()
export const GET_AUDIT_EVENTS_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['control', 'master_mcp', 'all'] },
    outcome: { type: 'string', enum: ['success', 'denied', 'failed'] },
    action: { type: 'string' },
    target: { type: 'string', description: 'Target account UUID' },
    from: { type: 'string', description: 'Inclusive calendar day YYYY-MM-DD' },
    to: { type: 'string', description: 'Inclusive calendar day YYYY-MM-DD' },
    timeZone: { type: 'string' },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 }
  },
  additionalProperties: false
} as const
export const GET_AUDIT_EVENTS_DESCRIPTION = 'Read permitted Control Centre and Master MCP audit events. This tool cannot edit or delete audit history.'

export function overviewTools(admin: SupabaseClient) {
  return [
    {
      name: 'get_master_overview',
      description: GET_MASTER_OVERVIEW_DESCRIPTION,
      inputSchema: { ...GET_MASTER_OVERVIEW_SCHEMA },
      parse: (args: unknown) => getMasterOverviewInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadPlatformOverview(admin, { range: args.range, timeZone: zoneOf(args.timeZone as string | undefined) })
    },
    {
      name: 'get_site_health',
      description: GET_SITE_HEALTH_DESCRIPTION,
      inputSchema: { ...GET_SITE_HEALTH_SCHEMA },
      parse: (args: unknown) => getSiteHealthInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async () => loadSiteHealth(admin)
    },
    {
      name: 'get_account_overview',
      description: GET_ACCOUNT_OVERVIEW_DESCRIPTION,
      inputSchema: { ...GET_ACCOUNT_OVERVIEW_SCHEMA },
      parse: (args: unknown) => getAccountOverviewInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadAccountOverview(admin, { range: args.range, timeZone: zoneOf(args.timeZone as string | undefined) })
    },
    {
      name: 'get_daily_activity',
      description: GET_DAILY_ACTIVITY_DESCRIPTION,
      inputSchema: { ...GET_DAILY_ACTIVITY_SCHEMA },
      parse: (args: unknown) => getDailyActivityInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadDailyActivity(admin, { range: args.range, timeZone: zoneOf(args.timeZone as string | undefined) })
    },
    {
      name: 'get_recent_errors',
      description: GET_RECENT_ERRORS_DESCRIPTION,
      inputSchema: { ...GET_RECENT_ERRORS_SCHEMA },
      parse: (args: unknown) => getRecentErrorsInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => loadRecentErrors(admin, args)
    },
    {
      name: 'get_audit_events',
      description: GET_AUDIT_EVENTS_DESCRIPTION,
      inputSchema: { ...GET_AUDIT_EVENTS_SCHEMA },
      parse: (args: unknown) => getAuditEventsInput.parse(args ?? {}) as Record<string, unknown>,
      execute: async (_actor: unknown, args: Record<string, unknown>) => listAuditEvents(admin, args)
    }
  ]
}

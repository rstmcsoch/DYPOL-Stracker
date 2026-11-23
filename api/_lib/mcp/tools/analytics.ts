import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from '../types.js'
import { PRESETS } from '../../../../src/lib/telemetry/metrics.js'
import { CONFIG_SCHEMAS, REPORTS } from '../../../../src/lib/telemetry/report-config.js'
import * as analytics from '../../services/master-analytics.js'

function jsonSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required, additionalProperties: false } as const
}

function tool(name: string, description: string, schema: Record<string, unknown>, parse: (args: unknown) => Record<string, unknown>, execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>) {
  return { name, description, inputSchema: { ...schema }, parse, execute }
}

const filterProperties = {
  preset: { type: 'string', enum: [...PRESETS], description: 'Reporting window. Default 7d.' },
  from: { type: 'string', description: 'Start of a custom range.' },
  to: { type: 'string', description: 'End of a custom range.' },
  timeZone: { type: 'string', description: 'IANA time zone. Defaults to Asia/Kolkata. Asia/Calcutta is also accepted.' },
  tz: { type: 'string' },
  compare: { type: 'boolean' },
  env: { type: 'string', enum: ['production', 'preview', 'all'] },
  audience: { type: 'string', enum: ['all', 'public', 'signed_in'] },
  device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] },
  path: { type: 'string' },
  source: { type: 'string', enum: ['public', 'app', 'auth', 'control'] },
  visitor: { type: 'string', enum: ['all', 'new', 'returning'] },
  includeTest: { type: 'boolean' },
  page: { type: 'integer' },
  status: { type: 'string' }
}

const filterInput = z.object({
  report: z.enum(REPORTS).optional(),
  preset: z.enum(PRESETS).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  timeZone: z.string().max(80).optional(),
  tz: z.string().max(80).optional(),
  compare: z.boolean().optional(),
  env: z.enum(['production', 'preview', 'all']).optional(),
  audience: z.enum(['all', 'public', 'signed_in']).optional(),
  device: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  path: z.string().max(120).optional(),
  source: z.enum(['public', 'app', 'auth', 'control']).optional(),
  visitor: z.enum(['all', 'new', 'returning']).optional(),
  includeTest: z.boolean().optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  status: z.string().max(40).optional()
}).strict()

export function analyticsTools(admin: SupabaseClient) {
  return [
    tool(
      'get_analytics_overview',
      'Read the website analytics overview (visitors, sessions, page views, signups, writes, errors and daily series) in the requested time zone. Defaults to Asia/Kolkata. Missing data is labelled, never invented.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'overview')
    ),
    tool(
      'get_analytics_report',
      'Read a named first-party analytics report (overview, traffic, pages, audience, funnels, student, adoption, retention, journeys, performance, errors, dataops, custom, alerts, health or realtime). Defaults to Asia/Kolkata.',
      jsonSchema({ report: { type: 'string', enum: [...REPORTS] }, ...filterProperties }, ['report']),
      args => filterInput.extend({ report: z.enum(REPORTS) }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args)
    ),
    tool(
      'get_analytics_timeseries',
      'Read daily traffic timeseries (sessions by day, channels and sources) in the requested time zone. Defaults to Asia/Kolkata.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'traffic')
    ),
    tool(
      'get_account_analytics',
      'Read account-level analytics: registrations in the period and active-account / retention figures. Unavailable feeds are labelled rather than invented.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAccountAnalytics(admin, args)
    ),
    tool(
      'get_student_activity_analytics',
      'Read student activity analytics (tests logged, study writes, feature activity and daily historical series) in the requested time zone.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'student')
    ),
    tool(
      'get_feature_usage',
      'Read most- and least-used product features (live feature_opened events and historical account adoption).',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'adoption')
    ),
    tool(
      'get_traffic_sources',
      'Read visitor sources, channels, referrer domains and UTM breakdowns. Full URLs and geography are not collected.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'traffic')
    ),
    tool(
      'get_error_groups',
      'List application error groups (scrubbed messages) with optional status filter and paging.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'errors')
    ),
    tool(
      'update_error_group',
      'Mark an error group as open, resolved or ignored and attach an operational note. Historical event rows and audit records are not rewritten.',
      jsonSchema({ fingerprint: { type: 'string' }, status: { type: 'string', enum: ['open', 'resolved', 'ignored'] }, note: { type: 'string' } }, ['fingerprint', 'status', 'note']),
      args => z.object({ fingerprint: z.string().regex(/^[a-z0-9]{1,64}$/i), status: z.enum(['open', 'resolved', 'ignored']), note: z.string().max(1000) }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.updateErrorGroup(admin, args)
    ),
    tool(
      'get_analytics_alerts',
      'Read analytics alert rules, current evaluations and recent alert events.',
      jsonSchema(filterProperties, []),
      args => filterInput.parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.getAnalyticsReport(admin, args, 'alerts')
    ),
    tool(
      'update_analytics_alert',
      'Update an analytics alert event (acknowledge, mute, resolve or reopen). Historical audit records are not deleted or rewritten.',
      jsonSchema({ id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['acknowledged', 'muted', 'resolved', 'open'] } }, ['id', 'status']),
      args => z.object({ id: z.string().uuid(), status: z.enum(['acknowledged', 'muted', 'resolved', 'open']) }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.updateAnalyticsAlert(admin, args)
    ),
    tool(
      'update_analytics_configuration',
      'Update a supported analytics configuration document (overview widgets, funnels, custom reports or alert rules) using the existing schemas.',
      jsonSchema({ key: { type: 'string', enum: Object.keys(CONFIG_SCHEMAS) }, value: {} }, ['key', 'value']),
      args => z.object({ key: z.enum(Object.keys(CONFIG_SCHEMAS) as [string, ...string[]]), value: z.unknown() }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.updateAnalyticsConfiguration(admin, args)
    ),
    tool(
      'export_analytics_report',
      'Export a named analytics report as CSV in the requested time zone. The export never includes passwords or credentials and never deletes or rewrites historical audit records.',
      jsonSchema({ report: { type: 'string', enum: [...REPORTS] }, ...filterProperties }, ['report']),
      args => filterInput.extend({ report: z.enum(REPORTS) }).strict().parse(args ?? {}) as Record<string, unknown>,
      async (_actor, args) => analytics.exportAnalyticsReport(admin, args)
    )
  ]
}

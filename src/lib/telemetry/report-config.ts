/**
 * Owner-editable analytics configuration (shared by the Control Center UI and the server,
 * which validates every save with these schemas). No raw SQL anywhere: custom reports are
 * a closed set of metrics and dimensions.
 */
import { z } from 'zod'
import { EVENT_NAMES } from './taxonomy.js'

export const REPORTS = ['overview', 'realtime', 'traffic', 'pages', 'audience', 'funnels', 'student', 'adoption', 'retention', 'journeys', 'performance', 'errors', 'dataops', 'custom', 'alerts', 'health'] as const
export type ReportName = (typeof REPORTS)[number]

export const WIDGETS = ['kpi_visitors', 'kpi_sessions', 'kpi_page_views', 'kpi_signups', 'kpi_writes', 'kpi_errors', 'kpi_lcp', 'chart_traffic', 'chart_writes', 'top_pages', 'top_channels', 'historical_activity'] as const
export const DEFAULT_WIDGETS: (typeof WIDGETS)[number][] = ['kpi_visitors', 'kpi_sessions', 'kpi_page_views', 'kpi_signups', 'kpi_writes', 'kpi_errors', 'kpi_lcp', 'chart_traffic', 'chart_writes', 'top_pages', 'top_channels', 'historical_activity']

export const DIMENSIONS = ['day', 'route', 'source', 'device', 'browser', 'channel', 'referrer', 'utm_campaign', 'feature', 'op', 'cta', 'section', 'metric'] as const
export const MEASURES = ['events', 'visitors', 'sessions'] as const

const id = z.string().regex(/^[a-z0-9-]{2,40}$/)
const name = z.string().trim().min(1).max(60)
const eventName = z.enum(EVENT_NAMES as [string, ...string[]])

export const funnelSchema = z.object({
  id, name,
  steps: z.array(z.object({ name: eventName, match: z.object({ prop: z.string().regex(/^[a-z_]{1,30}$/), value: z.string().trim().min(1).max(80) }).optional() })).min(2).max(8)
})
export const customReportSchema = z.object({ id, name, event: eventName.nullable(), measure: z.enum(MEASURES), dimension: z.enum(DIMENSIONS), limit: z.number().int().min(1).max(100) })
export const alertRuleSchema = z.object({
  id, label: name,
  metric: z.enum(['errors', 'write_failures', 'page_views', 'signups', 'poor_lcp_share', 'no_events_minutes']),
  comparator: z.enum(['above', 'below']),
  threshold: z.number().min(0).max(1_000_000),
  windowMinutes: z.number().int().min(5).max(10_080),
  muted: z.boolean().optional()
})

export const CONFIG_SCHEMAS = {
  'overview.widgets': z.array(z.enum(WIDGETS)).max(WIDGETS.length),
  funnels: z.array(funnelSchema).max(10),
  reports: z.array(customReportSchema).max(20),
  'alerts.rules': z.array(alertRuleSchema).max(20)
} as const
export type ConfigKey = keyof typeof CONFIG_SCHEMAS

export const BUILT_IN_FUNNELS: z.infer<typeof funnelSchema>[] = [
  { id: 'signup', name: 'Homepage → signup → first use', steps: [
    { name: 'page_view', match: { prop: 'source', value: 'public' } },
    { name: 'cta_clicked' },
    { name: 'signup_started' },
    { name: 'signup_completed' },
    { name: 'onboarding_completed' },
    { name: 'student_record_write_succeeded' }
  ] },
  { id: 'activation', name: 'Login → dashboard → saved work', steps: [
    { name: 'login_succeeded' },
    { name: 'dashboard_viewed' },
    { name: 'student_record_write_succeeded' }
  ] },
  { id: 'video', name: 'Promo video engagement', steps: [
    { name: 'video_started' }, { name: 'video_progress_25' }, { name: 'video_progress_50' }, { name: 'video_progress_75' }, { name: 'video_completed' }
  ] }
]

export const DEFAULT_ALERTS: z.infer<typeof alertRuleSchema>[] = [
  { id: 'error-spike', label: 'More than 10 app errors in an hour', metric: 'errors', comparator: 'above', threshold: 10, windowMinutes: 60 },
  { id: 'write-failures', label: 'More than 5 failed student saves in an hour', metric: 'write_failures', comparator: 'above', threshold: 5, windowMinutes: 60 }
]

/** Data status labels shown on every section. */
export type DataStatus = 'live' | 'historical' | 'partial' | 'unavailable'

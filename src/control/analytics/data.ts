import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { controlFetch } from '../api'
import type { DataStatus, ReportName } from '../../lib/telemetry/report-config'

export interface Section { status: DataStatus; coverageStart: string | null; note: string }
export interface ReportResponse<T = Record<string, unknown>> {
  ok: true; generatedAt: string; report: ReportName; preset: string; truncated: boolean
  period: { from: string; to: string; fromDay: string; toDay: string; prevFrom: string; prevTo: string; timeZone: string }
  filters: { timeZone: string; compare: boolean; includeTest: boolean }
  sections: Record<string, Section>; data: T; table: Record<string, unknown>[]
}

/** Filter keys kept in the URL so they survive switching subtabs and reloads. */
export const FILTER_KEYS = ['preset', 'from', 'to', 'tz', 'compare', 'env', 'audience', 'device', 'path', 'source', 'visitor', 'test'] as const

export function useFilterQuery(extra: Record<string, string | null> = {}): string {
  const [params] = useSearchParams()
  const query = new URLSearchParams()
  for (const key of FILTER_KEYS) { const value = params.get(key); if (value) query.set(key, value) }
  if (!query.get('tz')) query.set('tz', 'Asia/Kolkata')
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value)
  return query.toString()
}

export function useReport<T>(report: ReportName, extra: Record<string, string | null> = {}, refetchInterval?: number) {
  const query = useFilterQuery(extra)
  return useQuery({
    queryKey: ['control', 'analytics', report, query],
    queryFn: () => controlFetch<ReportResponse<T>>(`analytics?report=${report}&${query}`),
    refetchInterval,
    staleTime: refetchInterval ? 0 : 30_000
  })
}

export function formatDay(iso: string | null, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}
export function formatTime(iso: string | null, timeZone = 'Asia/Kolkata'): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export type Ranked = { key: string; count: number; visitors: number }
export const rankedColumns = (label: string) => [
  { key: 'key', label },
  { key: 'count', label: 'Events', tip: 'Number of events in the period.' },
  { key: 'visitors', label: 'Visitors', tip: 'Distinct signed-in accounts, or browser sessions for visitors who are not signed in.' }
]

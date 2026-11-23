import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { cleanText, isUuid, parsePage, parseSearch, parseUserSort, parseUserStatus } from '../control-policy.js'
import { isControlRole } from '../../../src/lib/control-permissions.js'
import { getAuthUser, isAccountSuspended, listAuthUsers, signInMethodOf, type AuthUserRecord } from './auth-users.js'

export interface DirectoryQuery {
  q?: unknown
  status?: unknown
  sort?: unknown
  page?: unknown
  pageSize?: unknown
  requireQuery?: boolean
}

const parseTimestamp = (value: string | null | undefined): number => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Mirrors OWNER_DATA_TABLES in src/lib/database.ts without importing Dexie into the server. */
export const STUDY_COUNT_TABLES = [
  'mistakes', 'test_chapter_links', 'test_subject_scores', 'test_error_logs', 'test_time_entries',
  'chapter_revisions', 'tests', 'practice_sessions', 'pyq_records', 'chapter_stages', 'backlog_items',
  'study_cards', 'daily_tasks', 'weekly_goals', 'study_sessions', 'user_exam_tracks', 'chapters',
  'app_settings', 'profiles'
] as const

const STUDY_COUNT_LABELS: Record<(typeof STUDY_COUNT_TABLES)[number], string> = {
  mistakes: 'mistakes',
  test_chapter_links: 'test chapter links',
  test_subject_scores: 'subject scores',
  test_error_logs: 'error notes',
  test_time_entries: 'time entries',
  chapter_revisions: 'revisions',
  tests: 'tests',
  practice_sessions: 'practice logs',
  pyq_records: 'PYQ records',
  chapter_stages: 'chapter stages',
  backlog_items: 'backlog items',
  study_cards: 'cards',
  daily_tasks: 'tasks',
  weekly_goals: 'goals',
  study_sessions: 'study sessions',
  user_exam_tracks: 'exam tracks',
  chapters: 'chapters',
  app_settings: 'settings',
  profiles: 'profile'
}

type ProfileRow = { user_id: string; display_name: string | null }

export async function listStudentDirectory(admin: SupabaseClient, query: DirectoryQuery) {
  const search = parseSearch(query.q).toLowerCase()
  if (query.requireQuery && !search) throw new ApiError(400, 'invalid_request', 'Provide a search query of at least one character.')
  const status = parseUserStatus(query.status)
  const sort = parseUserSort(query.sort)
  const { limit, offset, page } = parsePage(query.page, query.pageSize)

  const allUsers = await listAuthUsers(admin)
  const { data: profiles, error: profileError } = await admin.from('profiles').select('user_id, display_name').limit(10000)
  if (profileError) throw new ApiError(503, 'directory_unavailable', 'Profile labels could not be loaded. Try again shortly.')
  const labels = new Map(((profiles ?? []) as ProfileRow[]).map(row => [row.user_id, row.display_name ?? '']))

  const now = Date.now()
  const filtered = allUsers.filter(user => {
    const email = (user.email ?? '').toLowerCase()
    const displayName = (labels.get(user.id) ?? '').toLowerCase()
    if (search && !email.includes(search) && !displayName.includes(search)) return false
    if (status === 'verified' && !user.email_confirmed_at) return false
    if (status === 'unverified' && user.email_confirmed_at) return false
    if (status === 'suspended' && !isAccountSuspended(user, now)) return false
    return true
  })

  filtered.sort((a, b) => {
    if (sort === 'created_asc') return parseTimestamp(a.created_at) - parseTimestamp(b.created_at)
    if (sort === 'last_sign_in') return parseTimestamp(b.last_sign_in_at) - parseTimestamp(a.last_sign_in_at)
    return parseTimestamp(b.created_at) - parseTimestamp(a.created_at)
  })
  const pageUsers = filtered.slice(offset, offset + limit)
  const ids = pageUsers.map(user => user.id)
  const testCounts = new Map<string, number>()
  if (ids.length) {
    const { data: tests, error: testsError } = await admin.from('tests').select('user_id').in('user_id', ids).limit(10000)
    if (testsError) throw new ApiError(503, 'directory_unavailable', 'Activity counts could not be loaded. Try again shortly.')
    for (const row of (tests ?? []) as Array<{ user_id: string }>) testCounts.set(row.user_id, (testCounts.get(row.user_id) ?? 0) + 1)
  }

  return {
    users: pageUsers.map(user => publicDirectoryUser(user, labels.get(user.id) ?? '', testCounts.get(user.id) ?? 0, now)),
    total: filtered.length,
    page,
    pageSize: limit,
    filters: { q: search, status, sort }
  }
}

function publicDirectoryUser(user: AuthUserRecord, displayName: string, testsCount: number, now: number) {
  return {
    id: user.id,
    email: user.email ?? '',
    displayName,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    suspended: isAccountSuspended(user, now),
    testsCount
  }
}

export async function loadStudentAccount(admin: SupabaseClient, studentId: string) {
  const id = requireStudentId(studentId)
  const target = await getAuthUser(admin, id)
  const [profile, role, tracks, chapters, tests, mistakes, sessions, lastTest] = await Promise.all([
    admin.from('profiles').select('display_name, created_at').eq('user_id', id).maybeSingle(),
    admin.from('control_roles').select('role, revoked_at').eq('user_id', id).maybeSingle(),
    admin.from('user_exam_tracks').select('id, track, label, exam_date, enabled, target_score').eq('user_id', id).order('track', { ascending: true }),
    admin.from('chapters').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('tests').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('mistakes').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('tests').select('test_date').eq('user_id', id).order('test_date', { ascending: false }).limit(1).maybeSingle()
  ])
  const failures = [profile, role, tracks, chapters, tests, mistakes, sessions, lastTest].filter(result => result.error)
  if (failures.length) throw new ApiError(503, 'user_detail_unavailable', 'Part of this account could not be loaded. Try again shortly.')

  const now = Date.now()
  const suspended = isAccountSuspended(target, now)
  const roleActive = Boolean(role.data && !role.data.revoked_at)
  const controlRole = roleActive && isControlRole(role.data?.role) ? role.data.role : null

  return {
    student: {
      id: target.id,
      email: target.email ?? '',
      displayName: profile.data?.display_name ?? '',
      createdAt: target.created_at ?? profile.data?.created_at ?? null,
      lastSignInAt: target.last_sign_in_at ?? null,
      emailConfirmedAt: target.email_confirmed_at ?? null,
      emailVerified: Boolean(target.email_confirmed_at),
      signInMethod: signInMethodOf(target),
      suspended,
      bannedUntil: suspended ? target.banned_until ?? null : null,
      controlRole
    },
    examTracks: ((tracks.data ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: row.id,
      track: row.track,
      label: row.label,
      examDate: row.exam_date ?? null,
      enabled: row.enabled === true,
      targetScore: row.target_score ?? null
    })),
    usage: {
      chapters: chapters.count ?? 0,
      tests: tests.count ?? 0,
      mistakes: mistakes.count ?? 0,
      studySessions: sessions.count ?? 0,
      lastTestDate: lastTest.data?.test_date ?? null
    }
  }
}

export async function loadStudentActivity(admin: SupabaseClient, studentId: string) {
  const id = requireStudentId(studentId)
  await getAuthUser(admin, id)
  const [tests, sessions, tasks, revisions, lastTest, lastSession] = await Promise.all([
    admin.from('tests').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('study_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('daily_tasks').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('chapter_revisions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    admin.from('tests').select('test_date, created_at').eq('user_id', id).order('test_date', { ascending: false }).limit(10),
    admin.from('study_sessions').select('started_at, ended_at, duration_minutes').eq('user_id', id).order('started_at', { ascending: false }).limit(10)
  ])
  const failures = [tests, sessions, tasks, revisions, lastTest, lastSession].filter(result => result.error)
  if (failures.length) throw new ApiError(503, 'user_detail_unavailable', 'Student activity could not be loaded. Try again shortly.')
  return {
    studentId: id,
    counts: {
      tests: tests.count ?? 0,
      studySessions: sessions.count ?? 0,
      dailyTasks: tasks.count ?? 0,
      revisions: revisions.count ?? 0
    },
    recentTests: ((lastTest.data ?? []) as Array<{ test_date: string | null; created_at: string }>).map(row => ({
      testDate: row.test_date,
      createdAt: row.created_at
    })),
    recentStudySessions: ((lastSession.data ?? []) as Array<{ started_at: string; ended_at: string | null; duration_minutes: number | null }>).map(row => ({
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMinutes: row.duration_minutes
    }))
  }
}

export async function loadStudentStudyOverview(admin: SupabaseClient, studentId: string) {
  const id = requireStudentId(studentId)
  await getAuthUser(admin, id)
  const counts = await Promise.all(STUDY_COUNT_TABLES.map(async table => {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('user_id', id)
    if (error) throw new ApiError(503, 'user_detail_unavailable', 'Study-record counts could not be loaded. Try again shortly.')
    return { table, label: STUDY_COUNT_LABELS[table], count: count ?? 0 }
  }))
  return { studentId: id, records: counts, totalRows: counts.reduce((sum, row) => sum + row.count, 0) }
}

export async function loadStudentModerationHistory(admin: SupabaseClient, studentId: string) {
  const id = requireStudentId(studentId)
  await getAuthUser(admin, id)
  const [ban, sanctions] = await Promise.all([
    admin.from('account_bans').select('banned_until, reason, created_at').eq('user_id', id).maybeSingle(),
    admin.from('account_sanctions').select('id, kind, reason, banned_until, permanent, created_by_role, created_at, acknowledged_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50)
  ])
  if (ban.error || sanctions.error) throw new ApiError(503, 'user_detail_unavailable', 'Moderation history could not be loaded. Try again shortly.')
  const banData = ban.data as { banned_until: string | null; reason: string; created_at: string } | null
  const banActive = Boolean(banData && (banData.banned_until === null || Date.parse(banData.banned_until) > Date.now()))
  return {
    studentId: id,
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
    }))
  }
}

export async function updateStudentDisplayProfile(admin: SupabaseClient, studentId: string, displayName: unknown) {
  const id = requireStudentId(studentId)
  const name = cleanText(displayName, 100)
  if (!name) throw new ApiError(400, 'invalid_display_name', 'Give the student a display name of 1 to 100 characters.')
  await getAuthUser(admin, id)
  const { data: role, error: roleError } = await admin.from('control_roles').select('role, revoked_at').eq('user_id', id).maybeSingle()
  if (roleError) throw new ApiError(503, 'user_detail_unavailable', 'This account could not be verified right now. Nothing was changed.')
  if (role && !role.revoked_at && isControlRole(role.role)) {
    throw new ApiError(403, 'account_protected', 'Master MCP cannot change the display name of the Owner or a Control Centre role holder.')
  }
  const { data: existing, error: readError } = await admin.from('profiles').select('display_name').eq('user_id', id).maybeSingle()
  if (readError) throw new ApiError(503, 'user_detail_unavailable', 'The student profile could not be loaded. Nothing was changed.')
  const previous = existing?.display_name ?? ''
  if (!existing) throw new ApiError(404, 'user_not_found', 'That account has no student profile yet.')
  const { data, error } = await admin.from('profiles').update({ display_name: name, updated_at: new Date().toISOString() }).eq('user_id', id).select('user_id, display_name, updated_at').maybeSingle()
  if (error || !data) throw new ApiError(503, 'user_detail_unavailable', 'The display name could not be saved. Try again in a moment.')
  return {
    studentId: id,
    displayName: data.display_name as string,
    previousDisplayName: previous,
    updatedAt: data.updated_at as string,
    changedFields: previous === data.display_name ? [] : ['displayName']
  }
}

export function requireStudentId(value: unknown): string {
  if (!isUuid(value)) throw new ApiError(400, 'invalid_user_id', 'Choose a valid student account.')
  return value
}

/**
 * Control Center roles and permissions. Shared by the Vercel functions (which enforce them on
 * every console request) and the console UI (which hides what a person cannot use). Pure data.
 *
 * The permission set follows the usual admin-panel RBAC split (view vs manage per area,
 * separate export / publish rights, settings and role management reserved for senior roles),
 * mapped onto the sections Stracker's console actually has.
 */

export const CONTROL_ROLES = ['owner', 'administrator', 'moderator', 'viewer'] as const
export type ControlRole = (typeof CONTROL_ROLES)[number]
/** Roles whose permissions are stored in the matrix. The owner always has every permission. */
export const EDITABLE_ROLES = ['administrator', 'moderator', 'viewer'] as const
export type EditableRole = (typeof EDITABLE_ROLES)[number]

export const ROLE_LABELS: Record<ControlRole, string> = {
  owner: 'Owner',
  administrator: 'Admin',
  moderator: 'Moderator',
  viewer: 'Viewer'
}

export const ROLE_DESCRIPTIONS: Record<ControlRole, string> = {
  owner: 'Supreme access to everything, including roles, permissions and passkeys. Cannot be restricted.',
  administrator: 'Runs the site day to day: settings, users, content and exports. No role management by default.',
  moderator: 'Messages, account lookup, content drafts and exams, and reading the numbers. No publishing, exports or settings by default.',
  viewer: 'Read-only: overview, analytics, health and the audit log.'
}

export const PERMISSIONS = [
  'overview.view',
  'messages.view',
  'messages.manage',
  'users.view',
  'users.manage',
  'analytics.view',
  'analytics.manage',
  'audit.view',
  'audit.export',
  'health.view',
  'security.view',
  'appearance.edit',
  'appearance.publish',
  'exams.manage',
  'ai.manage',
  'settings.site',
  'settings.access',
  'roles.manage'
] as const
export type Permission = (typeof PERMISSIONS)[number]

export interface PermissionDefinition { id: Permission; label: string; area: string; description: string }

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  { id: 'overview.view', area: 'Overview', label: 'View overview', description: 'Open the Overview dashboard with account and activity totals.' },
  { id: 'messages.view', area: 'Messages', label: 'Read messages', description: 'Read Contact page messages and their attachments.' },
  { id: 'messages.manage', area: 'Messages', label: 'Manage messages', description: 'Mark, archive and delete messages.' },
  { id: 'users.view', area: 'Users', label: 'View users', description: 'Search the account directory and open account details.' },
  { id: 'users.manage', area: 'Users', label: 'Suspend or restore users', description: 'Turn sign-in off or on for a student account.' },
  { id: 'analytics.view', area: 'Analytics', label: 'View analytics', description: 'Traffic, signups, activity, performance and errors.' },
  { id: 'analytics.manage', area: 'Analytics', label: 'Configure analytics', description: 'Change alert thresholds and analytics settings, export CSV.' },
  { id: 'audit.view', area: 'Audit log', label: 'View audit log', description: 'Read the audit log of console actions.' },
  { id: 'audit.export', area: 'Audit log', label: 'Export audit log', description: 'Download the audit log as CSV.' },
  { id: 'health.view', area: 'System', label: 'View system health', description: 'Database, auth and configuration checks.' },
  { id: 'security.view', area: 'System', label: 'View security center', description: 'MFA status, sessions and refused access attempts.' },
  { id: 'appearance.edit', area: 'Appearance', label: 'Edit website content', description: 'Edit and preview homepage, footer and page text as a draft.' },
  { id: 'appearance.publish', area: 'Appearance', label: 'Publish website content', description: 'Make a draft live, or restore an earlier version.' },
  { id: 'exams.manage', area: 'Exams', label: 'Manage exams', description: 'Add, edit, hide and reorder exams students can choose.' },
  { id: 'ai.manage', area: 'Stracker AI', label: 'Manage Stracker AI', description: 'Default AI providers, models and limits for all students.' },
  { id: 'settings.site', area: 'Settings', label: 'Site status', description: 'Maintenance notice and full site-down mode.' },
  { id: 'settings.access', area: 'Settings', label: 'Sign-up and sign-in switches', description: 'Pause new sign-ups or student sign-ins.' },
  { id: 'roles.manage', area: 'Settings', label: 'Manage team roles', description: 'Give and remove Moderator and Viewer roles. Only the owner can manage Admins and Owners and edit permissions.' }
]

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

export function isControlRole(value: unknown): value is ControlRole {
  return typeof value === 'string' && (CONTROL_ROLES as readonly string[]).includes(value)
}

export function isEditableRole(value: unknown): value is EditableRole {
  return typeof value === 'string' && (EDITABLE_ROLES as readonly string[]).includes(value)
}

/**
 * Effective permissions: owner → all. Otherwise the role's matrix row, then per-person
 * overrides (allow or deny) on top. Unknown permission names are ignored (deny by default).
 */
export function effectivePermissions(
  role: ControlRole,
  rolePermissions: ReadonlyArray<{ permission: string; allowed: boolean }>,
  memberOverrides: ReadonlyArray<{ permission: string; allowed: boolean }> = []
): Permission[] {
  if (role === 'owner') return [...PERMISSIONS]
  const granted = new Set<Permission>()
  for (const row of rolePermissions) if (row.allowed && isPermission(row.permission)) granted.add(row.permission)
  for (const row of memberOverrides) {
    if (!isPermission(row.permission)) continue
    if (row.allowed) granted.add(row.permission)
    else granted.delete(row.permission)
  }
  return PERMISSIONS.filter(permission => granted.has(permission))
}

/** Roles an actor may give or remove. Only the owner manages Owner and Admin roles. */
export function assignableRoles(actorRole: ControlRole): ControlRole[] {
  return actorRole === 'owner' ? [...CONTROL_ROLES] : ['moderator', 'viewer']
}

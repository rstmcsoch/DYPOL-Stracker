/**
 * Master MCP capability catalogue and the permanent deny-list.
 *
 * Allowed names follow spec section 20. Forbidden names are never advertised
 * in tools/list and are refused by tools/call, including alternate spellings
 * that would otherwise reach role, security, owner, deletion or infrastructure
 * operations. The Master principal cannot override this list.
 */

/** Full intended Master tool set from the spec. tools/list only advertises implemented tools. */
export const MASTER_TOOL_CATALOGUE = [
  'get_master_overview',
  'get_master_permissions',
  'get_site_health',
  'get_account_overview',
  'get_daily_activity',
  'get_recent_errors',
  'get_audit_events',
  'list_students',
  'search_students',
  'get_student_account',
  'get_student_activity',
  'get_student_study_overview',
  'update_student_display_profile',
  'get_student_moderation_history',
  'warn_student',
  'ban_student',
  'unban_student',
  'get_student_dashboard',
  'get_student_settings',
  'manage_student_chapters',
  'manage_student_revisions',
  'manage_student_tests',
  'manage_student_subject_scores',
  'manage_student_test_chapter_links',
  'manage_student_mistakes',
  'manage_student_tasks',
  'manage_student_weekly_goals',
  'manage_student_study_sessions',
  'manage_student_practice_records',
  'manage_student_pyq_records',
  'manage_student_chapter_stages',
  'manage_student_backlog',
  'manage_student_study_cards',
  'manage_student_mock_analysis',
  'manage_student_exam_tracks',
  'get_student_analytics',
  'export_student_notebook',
  'list_exam_catalogue',
  'get_exam_definition',
  'create_exam',
  'update_exam',
  'hide_exam',
  'restore_exam',
  'reorder_exams',
  'update_exam_marking_scheme',
  'update_exam_ai_model_preferences',
  'get_site_ai_status',
  'list_site_ai_providers',
  'add_site_ai_provider',
  'update_site_ai_provider',
  'replace_site_ai_api_key',
  'discover_site_ai_models',
  'test_site_ai_provider',
  'enable_site_ai_provider',
  'disable_site_ai_provider',
  'set_default_site_ai_provider',
  'reorder_site_ai_providers',
  'remove_site_ai_provider',
  'update_site_ai_limits',
  'get_ai_model_preferences',
  'update_ai_model_preferences',
  'get_ai_usage',
  'get_ai_provider_health',
  'list_ai_tasks',
  'get_ai_task',
  'cancel_ai_task',
  'get_site_content',
  'get_site_published_version',
  'get_site_draft',
  'update_site_content_draft',
  'update_site_page',
  'update_site_blocks',
  'update_site_navigation_labels',
  'update_site_design_tokens',
  'preview_site_content',
  'validate_site_content',
  'publish_site_content',
  'list_site_content_versions',
  'restore_site_content_version',
  'get_student_dashboard_layout',
  'get_student_dashboard_layout_draft',
  'update_student_dashboard_layout',
  'update_student_dashboard_component',
  'reorder_student_dashboard_components',
  'preview_student_dashboard_layout',
  'validate_student_dashboard_layout',
  'publish_student_dashboard_layout',
  'list_student_layout_versions',
  'restore_student_dashboard_layout_version',
  'list_site_media',
  'get_site_media',
  'upload_site_media',
  'update_site_media',
  'get_media_usage',
  'delete_site_media',
  'list_contact_messages',
  'get_contact_message',
  'update_contact_message_status',
  'archive_contact_message',
  'delete_contact_message',
  'get_analytics_overview',
  'get_analytics_report',
  'get_analytics_timeseries',
  'get_account_analytics',
  'get_student_activity_analytics',
  'get_feature_usage',
  'get_traffic_sources',
  'get_error_groups',
  'update_error_group',
  'get_analytics_alerts',
  'update_analytics_alert',
  'update_analytics_configuration',
  'export_analytics_report',
  'get_operational_settings',
  'update_operational_settings',
  'set_maintenance_mode',
  'update_maintenance_message',
  'get_operational_status'
] as const

export type MasterToolName = (typeof MASTER_TOOL_CATALOGUE)[number]

export const MASTER_TOOL_NAME_SET: ReadonlySet<string> = new Set(MASTER_TOOL_CATALOGUE)

/**
 * Names the Master MCP must never expose or execute, including common
 * aliases for prohibited owner, role, security, deletion and infrastructure acts.
 */
export const FORBIDDEN_TOOL_NAMES = [
  'delete_student',
  'delete_user',
  'delete_auth_user',
  'delete_account',
  'permanently_delete_user',
  'delete_exam',
  'drop_exam',
  'physically_delete_exam',
  'remove_user_account',
  'assign_role',
  'remove_role',
  'change_role',
  'update_role',
  'promote_user',
  'demote_user',
  'manage_roles',
  'update_role_permissions',
  'update_member_permissions',
  'change_permission_matrix',
  'create_administrator',
  'create_owner',
  'change_owner',
  'set_owner',
  'delete_owner',
  'ban_owner',
  'suspend_owner',
  'update_owner',
  'remove_owner_role',
  'change_password',
  'reset_password',
  'update_password',
  'add_passkey',
  'remove_passkey',
  'update_passkey',
  'list_passkeys',
  'replace_passkey',
  'change_mfa',
  'disable_mfa',
  'enable_mfa',
  'reset_mfa',
  'list_mfa_factors',
  'add_totp',
  'remove_totp',
  'update_sessions',
  'revoke_session',
  'revoke_control_session',
  'change_session_lifetime',
  'update_auth_settings',
  'update_authentication_providers',
  'update_email_identity',
  'change_email',
  'change_login_method',
  'update_captcha',
  'update_turnstile',
  'update_security_policy',
  'update_security_settings',
  'update_security_env',
  'read_secrets',
  'read_service_role_key',
  'read_encryption_key',
  'update_env',
  'execute_sql',
  'run_sql',
  'execute_javascript',
  'execute_shell',
  'delete_supabase_project',
  'delete_vercel_project',
  'delete_database',
  'drop_schema',
  'update_github_permissions',
  'set_signup_enabled',
  'set_signin_enabled',
  'update_email_domains',
  'create_master_credential',
  'rotate_master_credential',
  'revoke_master_credential',
  'delete_storage_bucket',
  'delete_storage_infrastructure',
  'destroy_infrastructure',
  'drop_storage',
  'run_javascript',
  'eval_javascript',
  'run_code',
  'list_security_factors',
  'read_security_factors',
  'read_deployment_secrets',
  'read_env',
  'delete_audit_events',
  'rewrite_audit_events',
  'modify_permission_matrix',
  'modify_member_permission_overrides',
  'change_owner_identity',
  'change_owner_email',
  'update_owner_password',
  'disable_owner_mfa',
  'delete_user_account',
  'auth_admin_delete_user',
  'revoke_all_sessions',
  'dump_secrets',
  'drop_database'
] as const

export const FORBIDDEN_TOOL_NAME_SET: ReadonlySet<string> = new Set(FORBIDDEN_TOOL_NAMES)

export const FORBIDDEN_SCOPE_MESSAGE =
  'This action is outside the Master MCP authorized scope. The Master principal cannot manage roles, permissions, owner accounts, security controls, authentication factors, user-account deletion, infrastructure or secrets.'

export const CAPABILITY_SUMMARY = {
  allowed: {
    studentData: 'Full operational access to permitted student study records, scoped to an explicit student id.',
    userModeration: 'Warn, temporarily or permanently ban, and lift bans on ordinary student accounts. Owner and Control Center role holders are protected. Account deletion is prohibited.',
    websiteManagement: 'Read, draft, validate, preview, publish and restore public website content through the existing validator.',
    studentLayoutManagement: 'Read, draft, validate, preview, publish and restore the Student Dashboard Editor layout. Live student data is not overwritten.',
    strackerAi: 'Manage global Stracker AI providers, model order and limits. Student BYOK credentials are inaccessible. Saved keys are returned masked only.',
    analytics: 'Read operational analytics, acknowledge alerts and export permitted reports. Historical audit records cannot be edited or deleted.',
    exams: 'Manage the exam catalogue and marking schemes. In-use exams are hidden, not physically deleted.',
    mediaAndMessages: 'Manage the public media library and contact inbox, with confirmation for destructive actions.',
    operationalSettings: 'Inspect and change maintenance mode and the maintenance message. Sign-up, sign-in, domain and security switches stay Owner-controlled.'
  },
  restricted: {
    rolesAndPermissions: 'Cannot assign, remove or change Control Center roles or permission matrices.',
    ownerProtection: 'Cannot change, ban, delete or restrict the Owner, or alter owner authentication.',
    securityControls: 'Cannot change passwords, passkeys, MFA, sessions, Turnstile, authentication providers or security policies.',
    userDeletion: 'Cannot delete a user account, including through the existing deletion sanction.',
    infrastructure: 'Cannot change deployments, environment variables, secrets, or execute arbitrary SQL, shell or server-side code.',
    studentByok: 'Cannot read or change individual students\' private AI provider credentials.',
    masterCredentials: 'Cannot create, rotate or revoke Master MCP credentials. Only the Owner can do that from Settings.'
  }
} as const

export function isMasterCatalogueTool(name: string): name is MasterToolName {
  return MASTER_TOOL_NAME_SET.has(name)
}

const FORBIDDEN_TOOL_PATTERNS: readonly RegExp[] = [
  /^(assign|remove|change|update|manage|promote|demote|create|modify)_?(roles?|permissions?|permission_matrix|member_permissions?)/,
  /^(change|update|delete|ban|suspend|remove|set)_owner/,
  /^(change|reset|update|remove|add|list|replace)_?(passwords?|passkeys?|totps?)$/,
  /^(change|disable|enable|reset|list|add|remove)_?(mfa|mfa_factors?|auth_factors?|security_factors?)/,
  /^(update|revoke|change)_?(sessions?|session_lifetime|control_session)/,
  /^(read|list|dump|export|get)_(secrets?|deployment_secrets?|service_role(?:_key)?|encryption_key|env(?:_vars?)?)$/,
  /^(execute|run|eval)_(sql|javascript|js|shell|code|query)$/,
  /^(delete|drop|destroy)_(supabase(?:_project)?|vercel(?:_project)?|database|schema|storage(?:_bucket|_infrastructure)?|infrastructure|project)$/,
  /^(create|rotate|revoke)_master_credential$/,
  /^(set|update)_(signup|signin)_enabled$/,
  /^update_email_domains$/,
  /^(delete|rewrite)_audit(_events|_records)?$/,
  /^auth_admin_delete_user$/
]

export function isForbiddenTool(name: string): boolean {
  const normalised = name.trim().toLowerCase()
  if (FORBIDDEN_TOOL_NAME_SET.has(name) || FORBIDDEN_TOOL_NAME_SET.has(normalised)) return true
  if (normalised.startsWith('delete_auth') || normalised.includes('execute_sql') || normalised.includes('execute_shell')) return true
  return FORBIDDEN_TOOL_PATTERNS.some(pattern => pattern.test(normalised))
}

export function normalizeToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > 80) return null
  return name
}

export function masterCapabilityOverview(implementedTools: readonly string[]) {
  return {
    implementedTools: [...implementedTools],
    authorizedCatalogue: [...MASTER_TOOL_CATALOGUE],
    capabilities: CAPABILITY_SUMMARY.allowed,
    restricted: CAPABILITY_SUMMARY.restricted,
    forbiddenToolNames: [...FORBIDDEN_TOOL_NAMES]
  }
}

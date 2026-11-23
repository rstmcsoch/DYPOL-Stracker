import { z, ZodError } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from './types.js'
import { ApiError } from '../http.js'
import { FORBIDDEN_SCOPE_MESSAGE, isForbiddenTool, normalizeToolName } from './capabilities.js'
import { GET_MASTER_PERMISSIONS_DESCRIPTION, GET_MASTER_PERMISSIONS_SCHEMA, getMasterPermissions, getMasterPermissionsInput } from './tools/permissions.js'
import { overviewTools } from './tools/overview.js'
import { directoryTools } from './tools/directory.js'
import { moderationTools } from './tools/moderation.js'
import { recordTools } from './tools/records.js'
import { insightTools } from './tools/insights.js'
import { studyTools } from './tools/study.js'
import { examTools } from './tools/exams.js'
import { siteAiTools } from './tools/site-ai.js'
import { siteContentTools } from './tools/site-content.js'
import { studentLayoutTools } from './tools/student-layout.js'
import type { ConfirmationStore } from './confirmations.js'
import type { ToolListItem } from './protocol.js'

export class MasterToolError extends Error {
  constructor(
    readonly code: 'forbidden_tool' | 'unknown_tool' | 'invalid_arguments' | 'not_implemented' | 'not_found' | 'forbidden' | 'unavailable',
    message: string
  ) {
    super(message)
    this.name = 'MasterToolError'
  }
}

export interface RegisteredTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  parse: (args: unknown) => Record<string, unknown>
  execute: (actor: MasterActor, args: Record<string, unknown>) => Promise<unknown>
}

function emptyArgs(schema: z.ZodType<object>) {
  return (args: unknown): Record<string, unknown> => {
    const parsed = schema.parse(args ?? {})
    return parsed as Record<string, unknown>
  }
}

export const IMPLEMENTED_MASTER_TOOL_NAMES = [
  'get_master_permissions',
  'get_master_overview',
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
  'manage_student_chapters',
  'manage_student_tests',
  'manage_student_subject_scores',
  'manage_student_test_chapter_links',
  'manage_student_mistakes',
  'get_student_dashboard',
  'get_student_settings',
  'get_student_analytics',
  'manage_student_revisions',
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
  'restore_student_dashboard_layout_version'
] as const

export interface MasterToolDependencies {
  admin?: SupabaseClient
  confirmations?: ConfirmationStore
}

export function createMasterToolRegistry(tools?: RegisteredTool[], deps: MasterToolDependencies = {}): ToolRegistry {
  return new ToolRegistry(tools ?? defaultImplementedTools(deps))
}

export function defaultImplementedTools(deps: MasterToolDependencies = {}): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  tools.push({
    name: 'get_master_permissions',
    description: GET_MASTER_PERMISSIONS_DESCRIPTION,
    inputSchema: { ...GET_MASTER_PERMISSIONS_SCHEMA },
    parse: emptyArgs(getMasterPermissionsInput),
    execute: async (actor) => getMasterPermissions(actor, IMPLEMENTED_MASTER_TOOL_NAMES)
  })
  const admin = deps.admin ?? unavailableAdmin()
  tools.push(
    ...overviewTools(admin),
    ...directoryTools(admin),
    ...moderationTools(admin, deps.confirmations),
    ...recordTools(admin, deps.confirmations),
    ...insightTools(admin),
    ...studyTools(admin, deps.confirmations),
    ...examTools(admin, deps.confirmations),
    ...siteAiTools(admin, deps.confirmations),
    ...siteContentTools(admin, deps.confirmations),
    ...studentLayoutTools(admin, deps.confirmations)
  )
  return tools
}

function unavailableAdmin(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get() {
      throw new ApiError(503, 'master_mcp_unavailable', 'The Master MCP backend is not configured for this deployment yet.')
    }
  })
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()

  constructor(tools: RegisteredTool[]) {
    for (const tool of tools) this.tools.set(tool.name, tool)
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  list(): ToolListItem[] {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }

  async call(actor: MasterActor, rawName: unknown, rawArgs: unknown): Promise<unknown> {
    const name = normalizeToolName(rawName)
    if (!name) throw new MasterToolError('invalid_arguments', 'A tool name is required.')
    if (isForbiddenTool(name) || name.startsWith('delete_auth') || name.includes('execute_sql') || name.includes('execute_shell')) {
      throw new MasterToolError('forbidden_tool', FORBIDDEN_SCOPE_MESSAGE)
    }
    const tool = this.tools.get(name)
    if (!tool) throw new MasterToolError('unknown_tool', 'Unknown tool. Use tools/list for the tools this Master MCP connection may call.')
    try {
      const args = tool.parse(rawArgs ?? {})
      return await tool.execute(actor, args)
    } catch (error) {
      if (error instanceof MasterToolError) throw error
      if (error instanceof ZodError) {
        throw new MasterToolError('invalid_arguments', 'The tool arguments were not valid. Check the required fields and try again.')
      }
      if (error instanceof ApiError) {
        const code = error.status === 400 ? 'invalid_arguments' : error.status === 403 ? 'forbidden' : error.status === 404 ? 'not_found' : 'unavailable'
        throw new MasterToolError(code, error.message)
      }
      throw error
    }
  }
}

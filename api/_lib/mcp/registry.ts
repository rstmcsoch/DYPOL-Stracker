import { z, ZodError } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MasterActor } from './types.js'
import { ApiError } from '../http.js'
import { FORBIDDEN_SCOPE_MESSAGE, isForbiddenTool, normalizeToolName } from './capabilities.js'
import { GET_MASTER_PERMISSIONS_DESCRIPTION, GET_MASTER_PERMISSIONS_SCHEMA, getMasterPermissions, getMasterPermissionsInput } from './tools/permissions.js'
import { overviewTools } from './tools/overview.js'
import { directoryTools } from './tools/directory.js'
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
  'get_student_moderation_history'
] as const

export interface MasterToolDependencies {
  admin?: SupabaseClient
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
  tools.push(...overviewTools(admin), ...directoryTools(admin))
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

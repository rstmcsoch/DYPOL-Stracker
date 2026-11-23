import { z, ZodError } from 'zod'
import type { MasterActor } from './types.js'
import { FORBIDDEN_SCOPE_MESSAGE, isForbiddenTool, normalizeToolName } from './capabilities.js'
import { GET_MASTER_PERMISSIONS_DESCRIPTION, GET_MASTER_PERMISSIONS_SCHEMA, getMasterPermissions, getMasterPermissionsInput } from './tools/permissions.js'
import type { ToolListItem } from './protocol.js'

export class MasterToolError extends Error {
  constructor(
    readonly code: 'forbidden_tool' | 'unknown_tool' | 'invalid_arguments' | 'not_implemented',
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

export function createMasterToolRegistry(tools: RegisteredTool[] = defaultImplementedTools()): ToolRegistry {
  return new ToolRegistry(tools)
}

export function defaultImplementedTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  tools.push({
    name: 'get_master_permissions',
    description: GET_MASTER_PERMISSIONS_DESCRIPTION,
    inputSchema: { ...GET_MASTER_PERMISSIONS_SCHEMA },
    parse: emptyArgs(getMasterPermissionsInput),
    execute: async (actor) => getMasterPermissions(actor, tools.map(tool => tool.name))
  })
  return tools
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
      throw error
    }
  }
}

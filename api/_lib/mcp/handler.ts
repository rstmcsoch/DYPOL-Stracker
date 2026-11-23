import type { ApiRequest, ApiResponse } from '../http.js'
import { methodNotAllowed, publicError, sendJson } from '../http.js'
import { MCP_MAX_REQUEST_BYTES, type MasterActor } from './types.js'
import { authorizeMaster, productionClients, type MasterRuntimeClients } from './auth.js'
import { createMasterToolRegistry, MasterToolError, type ToolRegistry } from './registry.js'
import type { AuditSink } from './audit.js'
import { MemoryAuditSink } from './audit.js'
import { SupabaseAuditSink } from './audit.js'
import { SupabaseConfirmationStore } from './confirmations.js'
import { masterServiceClient } from './auth.js'
import {
  JSON_RPC,
  assertRequestSize,
  initializeResult,
  isNotification,
  jsonRpcError,
  jsonRpcSuccess,
  negotiateProtocolVersion,
  parseJsonRpcBody,
  toolTextResult,
  McpProtocolError,
  type JsonRpcId,
  type JsonRpcRequest
} from './protocol.js'

export interface McpHandlerOptions {
  clients: MasterRuntimeClients
  registry: ToolRegistry
  audit: AuditSink
}

export function productionHandlerOptions(): McpHandlerOptions {
  const clients = productionClients()
  const admin = masterServiceClient()
  return {
    clients,
    registry: createMasterToolRegistry(undefined, { admin, confirmations: new SupabaseConfirmationStore(admin) }),
    audit: new SupabaseAuditSink(admin)
  }
}

export async function handleMasterMcp(
  req: ApiRequest,
  res: ApiResponse,
  options: McpHandlerOptions = productionHandlerOptions()
): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST', 'OPTIONS'], 'The Master MCP endpoint accepts POST (and OPTIONS) only.')
    return
  }

  try {
    const actor = await authorizeMaster(req, options.clients)
    const body = await readMcpJson(req)
    const request = parseJsonRpcBody(body)
    const response = await dispatch(request, actor, options)
    if (response === null) {
      res.statusCode = 202
      res.end()
      return
    }
    sendJson(res, 200, response)
  } catch (error) {
    if (error instanceof McpProtocolError) {
      sendJson(res, error.httpStatus, { error: error.code, message: error.message })
      return
    }
    const result = publicError(error)
    sendJson(res, result.status, result.body)
  }
}

async function dispatch(request: JsonRpcRequest, actor: MasterActor, options: McpHandlerOptions) {
  const id: JsonRpcId = Object.prototype.hasOwnProperty.call(request, 'id') ? request.id ?? null : null
  const notification = isNotification(request)

  if (request.method === 'notifications/initialized') {
    return notification ? null : jsonRpcSuccess(id, {})
  }
  if (notification) return null

  if (request.method === 'initialize') {
    const params = isRecord(request.params) ? request.params : {}
    return jsonRpcSuccess(id, initializeResult(negotiateProtocolVersion(params.protocolVersion)))
  }
  if (request.method === 'ping') {
    return jsonRpcSuccess(id, {})
  }
  if (request.method === 'tools/list') {
    return jsonRpcSuccess(id, { tools: options.registry.list() })
  }
  if (request.method === 'tools/call') {
    return jsonRpcSuccess(id, await callTool(request.params, actor, options))
  }
  return jsonRpcError(id, JSON_RPC.methodNotFound, 'That Master MCP method is not supported.')
}

async function callTool(params: unknown, actor: MasterActor, options: McpHandlerOptions) {
  const record = isRecord(params) ? params : {}
  const name = typeof record.name === 'string' ? record.name : ''
  try {
    const result = await options.registry.call(actor, record.name, record.arguments)
    const args = isRecord(record.arguments) ? record.arguments : {}
    const studentId = typeof args.studentId === 'string' ? args.studentId : undefined
    await options.audit.write({
      requestId: actor.requestId,
      credentialId: actor.credentialId,
      credentialLabel: actor.credentialLabel,
      toolName: name,
      action: `mcp.${name || 'unknown'}`,
      targetType: studentId ? 'student' : undefined,
      targetId: studentId,
      targetStudentId: studentId,
      result: 'success',
      changedFields: name === 'update_student_display_profile' ? ['displayName'] : undefined
    })
    return toolTextResult(result)
  } catch (error) {
    if (error instanceof MasterToolError) {
      await options.audit.write({
        requestId: actor.requestId,
        credentialId: actor.credentialId,
        credentialLabel: actor.credentialLabel,
        toolName: name || null,
        action: `mcp.${name || 'unknown'}`,
        result: 'denied',
        errorCategory: error.code,
        reason: error.message
      })
      return toolTextResult({ error: error.code, message: error.message }, true)
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function invalidJson(): McpProtocolError {
  return new McpProtocolError(400, 'invalid_json', 'The Master MCP request could not be read as JSON.')
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidJson()
  }
}

async function readMcpJson(req: ApiRequest, maxBytes = MCP_MAX_REQUEST_BYTES): Promise<unknown> {
  try {
    if (req.body !== undefined && req.body !== null && !Buffer.isBuffer(req.body)) {
      if (typeof req.body === 'string') return parseJsonText(req.body)
      return req.body
    }
  } catch (error) {
    // Some hosts (including Vercel) throw SyntaxError when application/json
    // cannot be parsed, lazily, on first access of req.body.
    if (error instanceof McpProtocolError) throw error
    if (error instanceof SyntaxError) throw invalidJson()
    throw error
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.byteLength
    assertRequestSize(length, maxBytes)
    chunks.push(buffer)
  }
  if (!chunks.length) throw new McpProtocolError(400, 'invalid_json', 'The Master MCP request body was empty.')
  return parseJsonText(Buffer.concat(chunks).toString('utf8'))
}

/** Exposed for tests that want a complete in-process runtime without Supabase. */
export function testHandlerOptions(
  clients: MasterRuntimeClients,
  registry = createMasterToolRegistry(),
  audit: AuditSink = new MemoryAuditSink()
): McpHandlerOptions {
  return { clients, registry, audit }
}

export { productionClients }

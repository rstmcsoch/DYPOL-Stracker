/**
 * MCP Streamable HTTP + JSON-RPC 2.0, kept stateless. No SSE channel is opened.
 * Supported methods: initialize, ping, notifications/initialized, tools/list, tools/call.
 */
import { MCP_MAX_REQUEST_BYTES, MASTER_SERVER_INFO } from './types.js'

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export type McpProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]
export const DEFAULT_PROTOCOL_VERSION: McpProtocolVersion = '2025-06-18'

export const MCP_INSTRUCTIONS =
  'You are connected to the Stracker Master MCP, a privileged operational control plane. Use only the advertised tools. You are not the Owner and you cannot manage roles, permissions, owner accounts, security controls, authentication factors, user-account deletion, infrastructure or secrets. Every write is audited. Destructive or high-impact operations require a preview and a one-use confirmation token. Never ask for or repeat raw API keys, passwords or tokens.'

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}

export class McpProtocolError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'McpProtocolError'
  }
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.jsonrpc === '2.0' && typeof record.method === 'string' && record.method.length > 0 && record.method.length <= 80
}

export function isNotification(request: JsonRpcRequest): boolean {
  return !Object.prototype.hasOwnProperty.call(request, 'id')
}

export function negotiateProtocolVersion(requested: unknown): McpProtocolVersion {
  if (typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested as McpProtocolVersion
  }
  return DEFAULT_PROTOCOL_VERSION
}

export function initializeResult(protocolVersion: McpProtocolVersion) {
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: MASTER_SERVER_INFO.name, version: MASTER_SERVER_INFO.version },
    instructions: MCP_INSTRUCTIONS
  }
}

export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcError = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

export const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603
} as const

export function parseJsonRpcBody(raw: unknown): JsonRpcRequest {
  if (Array.isArray(raw)) {
    throw new McpProtocolError(400, 'batch_not_supported', 'JSON-RPC batches are not supported. Send one Master MCP request at a time.')
  }
  if (!isJsonRpcRequest(raw)) {
    throw new McpProtocolError(400, 'invalid_request', 'The Master MCP request was not a valid JSON-RPC 2.0 object.')
  }
  return raw
}

export function assertRequestSize(length: number, maxBytes = MCP_MAX_REQUEST_BYTES): void {
  if (length > maxBytes) throw new McpProtocolError(413, 'request_too_large', 'That Master MCP request is too large. Shorten it and try again.')
}

export interface ToolListItem {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolCallSuccess {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: unknown
  isError?: boolean
}

export function toolTextResult(value: unknown, isError = false): ToolCallSuccess {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError
  }
}

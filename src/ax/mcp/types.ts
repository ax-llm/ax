import type { AxFunctionJSONSchema } from '../ai/types.js'

export interface JSONRPCRequest<T> {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: T
}

export interface JSONRPCSuccessResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string | number
  result: T
}

export interface JSONRPCErrorResponse {
  jsonrpc: '2.0'
  id: string | number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JSONRPCResponse<T = unknown> =
  | JSONRPCSuccessResponse<T>
  | JSONRPCErrorResponse

export interface MCPInitializeParams {
  protocolVersion: string
  capabilities: Record<string, unknown>
  clientInfo: {
    name: string
    version: string
  }
}

export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: {
    tools?: unknown[]
    resources?: Record<string, unknown>
    prompts?: unknown[]
  }
  serverInfo: {
    name: string
    version: string
  }
}

export interface MCPFunctionDescription {
  name: string
  description: string
  inputSchema: AxFunctionJSONSchema
}

export interface MCPToolsListResult {
  name: string
  description: string
  tools: MCPFunctionDescription[]
}

export interface JSONRPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

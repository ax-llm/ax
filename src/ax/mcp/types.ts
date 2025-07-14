import type { AxFunctionJSONSchema } from '../ai/types.js';

export interface AxMCPJSONRPCRequest<T> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface AxMCPJSONRPCSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: T;
}

export interface AxMCPJSONRPCErrorResponse {
  jsonrpc: '2.0';
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type AxMCPJSONRPCResponse<T = unknown> =
  | AxMCPJSONRPCSuccessResponse<T>
  | AxMCPJSONRPCErrorResponse;

export interface AxMCPInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface AxMCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: unknown[];
    resources?: Record<string, unknown>;
    prompts?: unknown[];
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface AxMCPFunctionDescription {
  name: string;
  description: string;
  inputSchema: AxFunctionJSONSchema;
}

export interface AxMCPToolsListResult {
  name: string;
  description: string;
  tools: AxMCPFunctionDescription[];
}

export interface AxMCPJSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

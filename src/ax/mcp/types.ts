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

// Content types
export interface AxMCPTextContent {
  type: 'text';
  text: string;
}

export interface AxMCPImageContent {
  type: 'image';
  data: string; // base64-encoded
  mimeType: string;
}

export interface AxMCPEmbeddedResource {
  type: 'resource';
  resource: AxMCPTextResourceContents | AxMCPBlobResourceContents;
}

// Resource types
export interface AxMCPTextResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface AxMCPBlobResourceContents {
  uri: string;
  mimeType?: string;
  blob: string; // base64-encoded
}

export interface AxMCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface AxMCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface AxMCPResourcesListResult {
  resources: AxMCPResource[];
  nextCursor?: string;
}

export interface AxMCPResourceTemplatesListResult {
  resourceTemplates: AxMCPResourceTemplate[];
  nextCursor?: string;
}

export interface AxMCPResourceReadResult {
  contents: (AxMCPTextResourceContents | AxMCPBlobResourceContents)[];
}

// Prompt types
export interface AxMCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface AxMCPPrompt {
  name: string;
  description?: string;
  arguments?: AxMCPPromptArgument[];
}

export interface AxMCPPromptMessage {
  role: 'user' | 'assistant';
  content: AxMCPTextContent | AxMCPImageContent | AxMCPEmbeddedResource;
}

export interface AxMCPPromptsListResult {
  prompts: AxMCPPrompt[];
  nextCursor?: string;
}

export interface AxMCPPromptGetResult {
  description?: string;
  messages: AxMCPPromptMessage[];
}

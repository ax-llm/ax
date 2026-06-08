import type { AxFunctionJSONSchema } from '../ai/types.js';

export const AX_MCP_PROTOCOL_VERSION = '2025-11-25';

export const AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  AX_MCP_PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export type AxMCPProtocolVersion =
  (typeof AX_MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

export type AxMCPJSONSchema = Record<string, unknown>;

export type AxMCPMeta = Record<string, unknown>;

export interface AxMCPJSONRPCRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface AxMCPJSONRPCSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result: T;
}

export interface AxMCPJSONRPCErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type AxMCPJSONRPCResponse<T = unknown> =
  | AxMCPJSONRPCSuccessResponse<T>
  | AxMCPJSONRPCErrorResponse;

export interface AxMCPJSONRPCNotification<T = Record<string, unknown>> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export type AxMCPJSONRPCMessage =
  | AxMCPJSONRPCRequest
  | AxMCPJSONRPCNotification
  | AxMCPJSONRPCResponse;

export interface AxMCPIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

export interface AxMCPImplementationInfo {
  name: string;
  title?: string;
  version: string;
  description?: string;
  icons?: AxMCPIcon[];
  websiteUrl?: string;
}

export interface AxMCPClientCapabilities {
  roots?: {
    listChanged?: boolean;
  };
  sampling?: Record<string, unknown>;
  elicitation?: Record<string, unknown>;
  tasks?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

export interface AxMCPServerCapabilities {
  logging?: Record<string, unknown>;
  prompts?: {
    listChanged?: boolean;
    [key: string]: unknown;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
    [key: string]: unknown;
  };
  tools?: {
    listChanged?: boolean;
    [key: string]: unknown;
  };
  completions?: Record<string, unknown>;
  tasks?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AxMCPInitializeParams {
  protocolVersion: string;
  capabilities: AxMCPClientCapabilities;
  clientInfo: AxMCPImplementationInfo;
  _meta?: AxMCPMeta;
}

export interface AxMCPInitializeResult {
  protocolVersion: string;
  capabilities: AxMCPServerCapabilities;
  serverInfo: AxMCPImplementationInfo;
  instructions?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPAnnotations {
  audience?: ('user' | 'assistant')[];
  priority?: number;
  lastModified?: string;
  [key: string]: unknown;
}

export interface AxMCPBaseAnnotated {
  annotations?: AxMCPAnnotations;
  _meta?: AxMCPMeta;
}

export interface AxMCPTextContent extends AxMCPBaseAnnotated {
  type: 'text';
  text: string;
}

export interface AxMCPImageContent extends AxMCPBaseAnnotated {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface AxMCPAudioContent extends AxMCPBaseAnnotated {
  type: 'audio';
  data: string;
  mimeType: string;
}

export interface AxMCPTextResourceContents extends AxMCPBaseAnnotated {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface AxMCPBlobResourceContents extends AxMCPBaseAnnotated {
  uri: string;
  mimeType?: string;
  blob: string;
}

export interface AxMCPEmbeddedResource extends AxMCPBaseAnnotated {
  type: 'resource';
  resource: AxMCPTextResourceContents | AxMCPBlobResourceContents;
}

export interface AxMCPResourceLink extends AxMCPBaseAnnotated {
  type: 'resource_link';
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export type AxMCPContent =
  | AxMCPTextContent
  | AxMCPImageContent
  | AxMCPAudioContent
  | AxMCPResourceLink
  | AxMCPEmbeddedResource;

export interface AxMCPResource extends AxMCPBaseAnnotated {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  icons?: AxMCPIcon[];
}

export interface AxMCPResourceTemplate extends AxMCPBaseAnnotated {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  icons?: AxMCPIcon[];
}

export interface AxMCPTool extends AxMCPBaseAnnotated {
  name: string;
  title?: string;
  description?: string;
  icons?: AxMCPIcon[];
  inputSchema: AxMCPJSONSchema;
  outputSchema?: AxMCPJSONSchema;
  execution?: {
    taskSupport?: 'forbidden' | 'optional' | 'required';
    [key: string]: unknown;
  };
}

export type AxMCPFunctionDescription = AxMCPTool;

export interface AxMCPPaginatedRequest {
  cursor?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPToolsListResult {
  tools: AxMCPTool[];
  nextCursor?: string;
  _meta?: AxMCPMeta;
  /**
   * Older Ax tests/examples accepted these fields. Keep them optional so
   * older servers and fixtures remain type-compatible.
   */
  name?: string;
  description?: string;
}

export interface AxMCPToolCallParams {
  name: string;
  arguments?: unknown;
  _meta?: AxMCPMeta;
}

export interface AxMCPToolCallResult {
  content?: AxMCPContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: AxMCPMeta;
}

export interface AxMCPResourcesListResult {
  resources: AxMCPResource[];
  nextCursor?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPResourceTemplatesListResult {
  resourceTemplates: AxMCPResourceTemplate[];
  nextCursor?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPResourceReadResult {
  contents: (AxMCPTextResourceContents | AxMCPBlobResourceContents)[];
  _meta?: AxMCPMeta;
}

export interface AxMCPPromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface AxMCPPrompt extends AxMCPBaseAnnotated {
  name: string;
  title?: string;
  description?: string;
  arguments?: AxMCPPromptArgument[];
  icons?: AxMCPIcon[];
}

export interface AxMCPPromptMessage {
  role: 'user' | 'assistant';
  content: AxMCPContent;
}

export interface AxMCPPromptsListResult {
  prompts: AxMCPPrompt[];
  nextCursor?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPPromptGetResult {
  description?: string;
  messages: AxMCPPromptMessage[];
  _meta?: AxMCPMeta;
}

export type AxMCPCompletionReference =
  | {
      type: 'ref/prompt';
      name: string;
      title?: string;
    }
  | {
      type: 'ref/resource';
      uri: string;
    };

export interface AxMCPCompletionArgument {
  name: string;
  value: string;
}

export interface AxMCPCompletionRequest {
  ref: AxMCPCompletionReference;
  argument: AxMCPCompletionArgument;
  context?: {
    arguments?: Record<string, string>;
  };
  _meta?: AxMCPMeta;
}

export interface AxMCPCompletionResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
  _meta?: AxMCPMeta;
}

export type AxMCPLoggingLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

export interface AxMCPRoot {
  uri: string;
  name?: string;
  _meta?: AxMCPMeta;
}

export interface AxMCPListRootsResult {
  roots: AxMCPRoot[];
}

export function axMCPToolInputSchemaToFunctionSchema(
  schema: AxMCPJSONSchema | undefined
): AxFunctionJSONSchema {
  const candidate =
    schema && typeof schema === 'object'
      ? schema
      : { type: 'object', properties: {} };
  if (!('type' in candidate)) {
    return { type: 'object', ...candidate } as AxFunctionJSONSchema;
  }
  return candidate as AxFunctionJSONSchema;
}

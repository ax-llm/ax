import type {
  AxMCPClientCapabilities,
  AxMCPImplementationInfo,
  AxMCPLoggingLevel,
  AxMCPMeta,
} from './types.js';

export const AX_MCP_META_KEYS = {
  PROTOCOL_VERSION: 'io.modelcontextprotocol/protocolVersion',
  CLIENT_CAPABILITIES: 'io.modelcontextprotocol/clientCapabilities',
  CLIENT_INFO: 'io.modelcontextprotocol/clientInfo',
  LOG_LEVEL: 'io.modelcontextprotocol/logLevel',
  SERVER_INFO: 'io.modelcontextprotocol/serverInfo',
  SUBSCRIPTION_ID: 'io.modelcontextprotocol/subscriptionId',
} as const;

export interface AxMCPRequestMetaOptions {
  protocolVersion: string;
  clientCapabilities: AxMCPClientCapabilities;
  clientInfo: AxMCPImplementationInfo;
  logLevel?: AxMCPLoggingLevel;
  traceparent?: string;
  tracestate?: string;
  existing?: Readonly<AxMCPMeta>;
}

/** Builds the required per-request metadata for MCP 2026-07-28. */
export function axMCPBuildRequestMeta(
  options: Readonly<AxMCPRequestMetaOptions>
): AxMCPMeta {
  return {
    ...(options.existing ?? {}),
    [AX_MCP_META_KEYS.PROTOCOL_VERSION]: options.protocolVersion,
    [AX_MCP_META_KEYS.CLIENT_CAPABILITIES]: options.clientCapabilities,
    [AX_MCP_META_KEYS.CLIENT_INFO]: options.clientInfo,
    ...(options.logLevel === undefined
      ? {}
      : { [AX_MCP_META_KEYS.LOG_LEVEL]: options.logLevel }),
    ...(options.traceparent ? { traceparent: options.traceparent } : {}),
    ...(options.tracestate ? { tracestate: options.tracestate } : {}),
  };
}

/** Reads a well-formed server identity from modern result metadata. */
export function axMCPServerInfoFromMeta(
  meta: Readonly<AxMCPMeta> | undefined
): AxMCPImplementationInfo | undefined {
  const value = meta?.[AX_MCP_META_KEYS.SERVER_INFO];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const info = value as Partial<AxMCPImplementationInfo>;
  if (typeof info.name !== 'string' || typeof info.version !== 'string') {
    return;
  }
  return info as AxMCPImplementationInfo;
}

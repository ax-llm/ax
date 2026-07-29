export const AX_MCP_ERROR_CODES = {
  HEADER_MISMATCH: -32020,
  MISSING_REQUIRED_CLIENT_CAPABILITY: -32021,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
  RESOURCE_NOT_FOUND: -32602,
  LEGACY_RESOURCE_NOT_FOUND: -32002,
} as const;

/** A JSON-RPC protocol error returned by an MCP peer. */
export class AxMCPProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`RPC Error ${code}: ${message}`);
    this.name = 'AxMCPProtocolError';
    this.code = code;
    this.data = data;
  }
}

/** An HTTP failure that did not yield an in-band MCP response. */
export class AxMCPHTTPStatusError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body?: unknown;

  constructor(status: number, statusText: string, body?: unknown) {
    super(`HTTP error ${status}: ${statusText}`);
    this.name = 'AxMCPHTTPStatusError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

import type { AxMCPOAuthOptions } from '../oauth/types.js';
import type { AxMCPSSRFProtectionOptions } from '../util/ssrf.js';

export interface AxMCPStreamableHTTPTransportOptions {
  headers?: Record<string, string>;
  authorization?: string;
  oauth?: AxMCPOAuthOptions;
  /**
   * SSRF protection for the configured MCP endpoint. HTTPS and public hosts are
   * required by default; set allowHTTP/allowLoopback for controlled local
   * development, or disabled for trusted test fixtures.
   */
  ssrfProtection?: AxMCPSSRFProtectionOptions;
  /**
   * Attempt legacy HTTP+SSE fallback when an initialize POST gets a legacy
   * status. Defaults to false; use AxMCPHTTPSSETransport when you know the
   * server is legacy SSE-only.
   */
  legacySSEFallback?: boolean;
}

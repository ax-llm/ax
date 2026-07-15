import type { AxMCPAuthentication } from '../authentication.js';
import type { AxMCPMTLSOptions, AxMCPOAuthOptions } from '../oauth/types.js';
import type { AxMCPSSRFProtectionOptions } from '../util/ssrf.js';

export interface AxMCPStreamableHTTPTransportOptions {
  headers?: Record<string, string>;
  authorization?: string;
  /** Composable bearer, API key, Basic, HMAC, or caller-defined authentication. */
  authentication?: AxMCPAuthentication;
  oauth?: AxMCPOAuthOptions;
  /** Host-provided fetch implementation for all HTTP transport requests. */
  fetch?: typeof globalThis.fetch;
  /** RFC 8705 mutual-TLS channel; also inherited by OAuth unless overridden. */
  mtls?: AxMCPMTLSOptions;
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
  /** Per-request timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum decoded response body size. Defaults to 16 MiB. */
  maxResponseBytes?: number;
  /** Maximum validated redirect hops for GET/HEAD requests. Defaults to 5. */
  maxRedirects?: number;
  /** Retry policy for safe MCP operations on 429/502/503/504. */
  retry?:
    | false
    | {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        statuses?: readonly number[];
      };
}

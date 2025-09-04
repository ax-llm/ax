import type { AxMCPOAuthOptions } from '../oauth/types.js';

export interface AxMCPStreamableHTTPTransportOptions {
  headers?: Record<string, string>;
  authorization?: string;
  oauth?: AxMCPOAuthOptions;
}

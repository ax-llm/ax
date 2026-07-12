export const AX_MCP_EXTENSION_APPS = 'io.modelcontextprotocol/ui';
export const AX_MCP_EXTENSION_OAUTH_CLIENT_CREDENTIALS =
  'io.modelcontextprotocol/oauth-client-credentials';
export const AX_MCP_EXTENSION_ENTERPRISE_MANAGED_AUTHORIZATION =
  'io.modelcontextprotocol/enterprise-managed-authorization';

export type AxMCPOfficialExtension =
  | typeof AX_MCP_EXTENSION_APPS
  | typeof AX_MCP_EXTENSION_OAUTH_CLIENT_CREDENTIALS
  | typeof AX_MCP_EXTENSION_ENTERPRISE_MANAGED_AUTHORIZATION;

export interface AxMCPExtensionCapability {
  version?: string;
  [key: string]: unknown;
}
